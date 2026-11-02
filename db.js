/* Taj Fast Food Corner - offline database (IndexedDB wrapper).
   Every record gets: id (uuid), createdAt, updatedAt, synced (0 = waiting for cloud), deleted (soft delete).
   Stage 2: database version 2 adds recipes, credits, stockMoves. Existing data is kept. */
(function (root) {
  'use strict';
  const NAME = 'taj-fastfood-db';
  const VERSION = 2;
  const STORES = ['items', 'sales', 'expenses', 'inventory', 'wastage', 'staff', 'settings', 'syncQueue',
                  'recipes', 'credits', 'stockMoves'];
  // stores whose records are synced to Google Sheets (settings are handled separately)
  const SYNC_STORES = ['items', 'sales', 'expenses', 'inventory', 'wastage', 'staff', 'recipes', 'credits', 'stockMoves'];
  let db = null;

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function changed(name) {
    // tells the sync engine something new is waiting (settings excluded: sync itself writes settings)
    if (name === 'settings') return;
    try { if (typeof root.dispatchEvent === 'function' && root.Event) root.dispatchEvent(new root.Event('taj:changed')); } catch (e) { /* ignore */ }
  }

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = function (e) {
        const d = e.target.result;
        STORES.forEach(function (s) {
          if (d.objectStoreNames.contains(s)) return;   // existing stores and their data are untouched
          const st = d.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
          if (s !== 'settings') st.createIndex('updatedAt', 'updatedAt');
          if (s === 'sales') st.createIndex('date', 'date');
        });
      };
      r.onsuccess = function () {
        db = r.result;
        db.onversionchange = function () { db.close(); db = null; };   // let a newer version upgrade
        resolve(db);
      };
      r.onerror = function () { reject(r.error); };
    });
  }

  function req(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function store(name, mode) { return db.transaction(name, mode).objectStore(name); }

  function stamp(store_, rec, now) {
    if (store_ === 'settings') { rec.updatedAt = now; return rec; }
    if (!rec.id) { rec.id = uuid(); rec.createdAt = now; }
    rec.updatedAt = now;
    rec.synced = 0;
    return rec;
  }

  async function put(name, rec) {
    stamp(name, rec, new Date().toISOString());
    await req(store(name, 'readwrite').put(rec));
    changed(name);
    return rec;
  }

  // Save several records in ONE transaction: all saved or none saved.
  function putMany(name, recs) {
    const now = new Date().toISOString();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(name, 'readwrite');
      const st = tx.objectStore(name);
      recs.forEach(function (r) { stamp(name, r, now); st.put(r); });
      tx.oncomplete = function () { changed(name); resolve(recs); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Save cancelled')); };
    });
  }

  // Save records into SEVERAL stores in ONE transaction (e.g. bill + stock + udhaar): all or nothing.
  function putBatch(map) {
    const names = Object.keys(map).filter(function (k) { return map[k] && map[k].length; });
    if (!names.length) return Promise.resolve();
    const now = new Date().toISOString();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(names, 'readwrite');
      names.forEach(function (n) {
        const st = tx.objectStore(n);
        map[n].forEach(function (r) { stamp(n, r, now); st.put(r); });
      });
      tx.oncomplete = function () { changed('batch'); resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Save cancelled')); };
    });
  }

  async function getAll(name, opts) {
    const all = await req(store(name, 'readonly').getAll());
    return opts && opts.includeDeleted ? all : all.filter(function (r) { return !r.deleted; });
  }
  function get(name, key) { return req(store(name, 'readonly').get(key)); }

  // Soft delete: the record stays (marked deleted) so the deletion can reach the cloud later.
  async function remove(name, id) {
    const r = await get(name, id);
    if (!r) return;
    r.deleted = true;
    await put(name, r);
  }

  async function setting(key, def) {
    const r = await get('settings', key);
    return r && r.value !== undefined && r.value !== null ? r.value : def;
  }
  function setSetting(key, value) { return put('settings', { key: key, value: value }); }

  async function countPending() {
    let n = 0;
    for (const s of SYNC_STORES) {
      const all = await getAll(s, { includeDeleted: true });
      n += all.filter(function (r) { return r.synced === 0; }).length;
    }
    return n;
  }

  /* ---- helpers used by the sync engine (they never change updatedAt and never trigger a new sync) ---- */

  async function getUnsynced(name) {
    return (await getAll(name, { includeDeleted: true })).filter(function (r) { return r.synced === 0; });
  }

  // Mark records as synced ONLY if they were not edited while the upload was running.
  function markSynced(name, sent) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(name, 'readwrite');
      const st = tx.objectStore(name);
      sent.forEach(function (s) {
        const g = st.get(s.id);
        g.onsuccess = function () {
          const rec = g.result;
          if (rec && rec.updatedAt === s.updatedAt && rec.synced !== 1) { rec.synced = 1; st.put(rec); }
        };
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error); };
    });
  }

  // Store a record exactly as received from the cloud.
  function putRaw(name, rec) { return req(store(name, 'readwrite').put(rec)); }

  // After a restore from a backup file, send everything to the cloud again (safe: uploads never duplicate).
  function markAllUnsynced() {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(SYNC_STORES, 'readwrite');
      SYNC_STORES.forEach(function (n) {
        const st = tx.objectStore(n);
        const c = st.openCursor();
        c.onsuccess = function () {
          const cur = c.result;
          if (!cur) return;
          const rec = cur.value; rec.synced = 0; cur.update(rec); cur.continue();
        };
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function exportAll() {
    const out = { app: 'taj-fast-food', version: 2, exportedAt: new Date().toISOString(), data: {} };
    for (const s of STORES) out.data[s] = await getAll(s, { includeDeleted: true });
    return out;
  }

  function validateBackup(obj) {
    if (!obj || obj.app !== 'taj-fast-food' || !obj.data) return 'This is not a Taj Fast Food backup file.';
    for (const s of STORES) {
      if (obj.data[s] !== undefined && !Array.isArray(obj.data[s])) return 'Backup file is damaged (' + s + ').';
    }
    return null;
  }

  // Replace everything in one transaction: if anything fails, nothing changes.
  function importAll(obj) {
    const err = validateBackup(obj);
    if (err) return Promise.reject(new Error(err));
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORES, 'readwrite');
      STORES.forEach(function (s) {
        const st = tx.objectStore(s);
        st.clear();
        (obj.data[s] || []).forEach(function (r) { st.put(r); });
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.onabort = function () { reject(tx.error || new Error('Restore cancelled')); };
    });
  }

  const api = { STORES: STORES, SYNC_STORES: SYNC_STORES, open: open, put: put, putMany: putMany, putBatch: putBatch,
                getAll: getAll, get: get, remove: remove, setting: setting, setSetting: setSetting,
                countPending: countPending, getUnsynced: getUnsynced, markSynced: markSynced, putRaw: putRaw,
                markAllUnsynced: markAllUnsynced, exportAll: exportAll, importAll: importAll,
                validateBackup: validateBackup, uuid: uuid };
  root.DB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
