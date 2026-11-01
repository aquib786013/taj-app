/* Taj Fast Food Corner - offline database (IndexedDB wrapper).
   Every record gets: id (uuid), createdAt, updatedAt, synced (0 = waiting for cloud), deleted (soft delete).
   These fields are what the Google Sheets sync (next stage) will use. */
(function (root) {
  'use strict';
  const NAME = 'taj-fastfood-db';
  const VERSION = 1;
  // All stores are created now so later stages never need a risky database upgrade.
  const STORES = ['items', 'sales', 'expenses', 'inventory', 'wastage', 'staff', 'settings', 'syncQueue'];
  let db = null;

  function uuid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = function (e) {
        const d = e.target.result;
        STORES.forEach(function (s) {
          if (d.objectStoreNames.contains(s)) return;
          const st = d.createObjectStore(s, { keyPath: s === 'settings' ? 'key' : 'id' });
          if (s !== 'settings') st.createIndex('updatedAt', 'updatedAt');
          if (s === 'sales') st.createIndex('date', 'date');
        });
      };
      r.onsuccess = function () { db = r.result; resolve(db); };
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
    return rec;
  }

  // Save several records in ONE transaction: all saved or none saved.
  function putMany(name, recs) {
    const now = new Date().toISOString();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(name, 'readwrite');
      const st = tx.objectStore(name);
      recs.forEach(function (r) { stamp(name, r, now); st.put(r); });
      tx.oncomplete = function () { resolve(recs); };
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
    return r ? r.value : def;
  }
  function setSetting(key, value) { return put('settings', { key: key, value: value }); }

  async function countPending() {
    let n = 0;
    for (const s of STORES) {
      if (s === 'settings' || s === 'syncQueue') continue;
      const all = await getAll(s, { includeDeleted: true });
      n += all.filter(function (r) { return r.synced === 0; }).length;
    }
    return n;
  }

  async function exportAll() {
    const out = { app: 'taj-fast-food', version: 1, exportedAt: new Date().toISOString(), data: {} };
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

  const api = { STORES: STORES, open: open, put: put, putMany: putMany, getAll: getAll, get: get,
                remove: remove, setting: setting, setSetting: setSetting, countPending: countPending,
                exportAll: exportAll, importAll: importAll, validateBackup: validateBackup, uuid: uuid };
  root.DB = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
