/* Taj Fast Food Corner - Google Sheets sync engine (Stage 2).
   Rules:
   1. Everything is saved on the phone first. Sync only copies it to Google Sheets.
   2. A record is marked "synced" only after Google confirms it. A failed or lost upload is simply sent again.
   3. Every record has a unique id and Google stores it by id, so a resend can never create a duplicate bill.
   4. If the same record changed in two places, the newer updatedAt wins. */
(function (root) {
  'use strict';
  const DB = root.DB;
  const PUSH_ORDER = ['staff', 'items', 'inventory', 'recipes', 'sales', 'stockMoves', 'expenses', 'wastage', 'credits'];
  const SETTING_KEYS = ['bizName', 'threshold', 'expenseCats'];
  const CHUNK = 100;
  const URL_RE = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+\/|macros\/)s\/[\w-]+\/exec$/;

  const st = { syncing: false, pending: 0, configured: false, last: null, fails: 0, lastTry: 0, auto: true, started: false };
  const listeners = [];
  let debounce = null, pendingDebounce = null;

  function SyncError(msg) { const e = new Error(msg); e.name = 'SyncError'; return e; }

  function status() {
    return { syncing: st.syncing, pending: st.pending, configured: st.configured, last: st.last,
             online: typeof navigator === 'undefined' ? true : navigator.onLine, auto: st.auto };
  }
  function notify() { const s = status(); listeners.forEach(function (f) { try { f(s); } catch (e) { /* ignore */ } }); }
  function onStatus(fn) { listeners.push(fn); }

  async function config() {
    return { url: await DB.setting('syncUrl', ''), token: await DB.setting('syncToken', ''),
             auto: (await DB.setting('autoSync', true)) !== false };
  }
  function isConfigured(c) { return !!(c.url && c.token && URL_RE.test(c.url)); }

  async function refreshPending() {
    try {
      st.pending = await DB.countPending();
      const c = await config();
      st.configured = isConfigured(c); st.auto = c.auto;
      if (!st.last) st.last = await DB.setting('lastSync', null);
    } catch (e) { /* database not ready yet */ }
    notify();
  }
  function schedulePending() { clearTimeout(pendingDebounce); pendingDebounce = setTimeout(refreshPending, 400); }

  async function post(url, body) {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, 60000);
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify(body), signal: ctl.signal, redirect: 'follow' });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw SyncError('Google took too long to answer. Will retry.');
      throw SyncError('Could not reach Google. Check the internet and the Web App URL.');
    }
    clearTimeout(timer);
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw SyncError(res.ok
        ? 'Google sent a web page instead of data. Deploy the script again with "Who has access: Anyone".'
        : 'Google server error (' + res.status + '). Will retry.');
    }
    if (!res.ok) throw SyncError('Google server error (' + res.status + '). Will retry.');
    if (!j.ok) throw SyncError(j.error || 'Google refused the request.');
    return j;
  }

  // The photo of a wastage entry stays on the phone only (too big for a sheet cell).
  function forCloud(store, rec) {
    const c = Object.assign({}, rec);
    if (store === 'wastage' && c.photo) { delete c.photo; c.hasPhoto = 1; }
    delete c.synced;
    return c;
  }

  async function pushAll(c, stats) {
    for (const store of PUSH_ORDER) {
      const rows = await DB.getUnsynced(store);
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const r = await post(c.url, { action: 'push', token: c.token, store: store,
                                      records: chunk.map(function (x) { return forCloud(store, x); }) });
        const ok = new Set(r.saved || []);
        await DB.markSynced(store, chunk.filter(function (x) { return ok.has(x.id); })
          .map(function (x) { return { id: x.id, updatedAt: x.updatedAt }; }));
        stats.pushed += ok.size;
        (r.skipped || []).forEach(function (s) { if (s.reason === 'server_newer') stats.conflicts++; else stats.bad++; });
      }
    }
    const recs = [];
    for (const k of SETTING_KEYS) {
      const r = await DB.get('settings', k);
      if (r && r.value !== undefined) recs.push({ key: k, value: r.value, updatedAt: r.updatedAt });
    }
    if (recs.length) await post(c.url, { action: 'push', token: c.token, store: 'settings', records: recs });
  }


  // A new phone creates the standard starter menu with fixed ids. If the cloud already has the same
  // item/staff name under a different id (an older phone), keep the cloud copy and remove the starter copy.
  async function dropDuplicateSeeds(records) {
    const plan = [['items', 'seed-item-'], ['staff', 'seed-staff-']];
    for (const p of plan) {
      const store = p[0], prefix = p[1];
      const remote = (records[store] || []).filter(function (r) { return r && !r.deleted && r.id && r.id.indexOf(prefix) !== 0; });
      if (!remote.length) continue;
      const names = new Set(remote.map(function (r) { return String(r.name || '').trim().toLowerCase(); }));
      const local = await DB.getAll(store);
      for (const l of local) {
        if (l.id.indexOf(prefix) === 0 && names.has(String(l.name || '').trim().toLowerCase())) { l.deleted = true; await DB.put(store, l); }
      }
    }
  }

  async function mergeRemote(records, settings, stats) {
    for (const store of Object.keys(records || {})) {
      if (DB.SYNC_STORES.indexOf(store) < 0) continue;
      for (const r of records[store]) {
        if (!r || !r.id) continue;
        const local = await DB.get(store, r.id);
        if (local && String(local.updatedAt) >= String(r.updatedAt)) continue;   // our copy is the same or newer
        if (local && local.synced === 0) stats.conflicts++;                       // our unsent change loses to a newer cloud copy
        const merged = Object.assign({}, r, { synced: 1 });
        if (local && local.photo) merged.photo = local.photo;
        await DB.putRaw(store, merged);
        stats.pulled++;
      }
    }
    await dropDuplicateSeeds(records || {});
    for (const s of settings || []) {
      if (SETTING_KEYS.indexOf(s.key) < 0) continue;
      const local = await DB.get('settings', s.key);
      if (local && String(local.updatedAt) >= String(s.updatedAt)) continue;
      await DB.putRaw('settings', { key: s.key, value: s.value, updatedAt: s.updatedAt });
      stats.pulled++;
    }
  }

  async function pullAll(c, stats, full) {
    const since = full ? '' : await DB.setting('lastPull', '');
    const r = await post(c.url, { action: 'pull', token: c.token, since: since });
    await mergeRemote(r.records, r.settings, stats);
    await DB.setSetting('lastPull', r.serverTime || '');
    if (stats.pulled) root.dispatchEvent && root.dispatchEvent(new root.Event('taj:pulled'));
  }

  function fmtResult(ok, stats, err) {
    if (!ok) return err;
    const parts = ['sent ' + stats.pushed, 'received ' + stats.pulled];
    if (stats.conflicts) parts.push(stats.conflicts + ' conflict(s) resolved by newest change');
    if (stats.bad) parts.push(stats.bad + ' record(s) refused');
    return parts.join(', ');
  }

  /** opts: { auto: true } for background runs, { full: true } to download everything from the cloud */
  async function syncNow(opts) {
    opts = opts || {};
    if (st.syncing) return { ok: false, message: 'Sync already running' };
    const c = await config();
    st.configured = isConfigured(c);
    if (!st.configured) { notify(); return { ok: false, message: 'Cloud sync is not set up yet.', notConfigured: true }; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      notify(); return { ok: false, message: 'No internet. Data is safe on this phone and will sync automatically.', offline: true };
    }
    st.syncing = true; st.lastTry = Date.now(); notify();
    const stats = { pushed: 0, pulled: 0, conflicts: 0, bad: 0 };
    let result;
    try {
      const firstTime = !(await DB.setting('lastPull', ''));
      if (firstTime) {
        await pullAll(c, stats, true);      // new phone: read the cloud first so starter items never duplicate
        await pushAll(c, stats);
        if (stats.conflicts > 0) await pullAll(c, stats, true);
      } else {
        await pushAll(c, stats);
        await pullAll(c, stats, !!opts.full || stats.conflicts > 0);   // conflicts: re-read the cloud so the newer copy wins
      }
      st.fails = 0;
      result = { ok: true, at: new Date().toISOString(), message: fmtResult(true, stats), pushed: stats.pushed, pulled: stats.pulled };
    } catch (e) {
      st.fails++;
      result = { ok: false, at: new Date().toISOString(), message: e && e.name === 'SyncError' ? e.message : 'Unexpected error: ' + (e && e.message ? e.message : e) };
    }
    st.syncing = false;
    st.last = result;
    try { await DB.setSetting('lastSync', result); } catch (e) { /* ignore */ }
    st.pending = await DB.countPending();
    notify();
    return result;
  }

  async function testConnection(url, token) {
    if (!URL_RE.test(url)) throw SyncError('That does not look like a Google Apps Script Web App URL (it must end with /exec).');
    if (!token) throw SyncError('Enter the secret token.');
    const r = await post(url, { action: 'ping', token: token });
    return r.spreadsheet || 'your Google Sheet';
  }

  function autoTick() {
    if (!st.configured || !st.auto || st.syncing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const wait = Math.min(600000, 120000 * Math.max(1, st.fails));      // back off after repeated failures
    if (Date.now() - st.lastTry < wait && st.fails > 0) return;
    if (st.pending > 0 || Date.now() - st.lastTry > 600000) syncNow({ auto: true });
  }

  function start() {
    if (st.started) return;
    st.started = true;
    refreshPending();
    root.addEventListener('taj:changed', function () {
      schedulePending();
      clearTimeout(debounce);
      debounce = setTimeout(function () { st.fails = 0; autoTick(); }, 4000);
    });
    root.addEventListener('online', function () { st.fails = 0; notify(); setTimeout(function () { autoTick(); }, 1500); });
    root.addEventListener('offline', notify);
    setInterval(autoTick, 120000);
    setTimeout(function () { refreshPending().then(autoTick); }, 2500);
  }

  root.TajSync = { start: start, syncNow: syncNow, status: status, onStatus: onStatus, refreshPending: refreshPending,
                   testConnection: testConnection, isValidUrl: function (u) { return URL_RE.test(u); } };
})(typeof window !== 'undefined' ? window : globalThis);
