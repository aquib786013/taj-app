/**
 * TAJ FAST FOOD CORNER - Google Sheets sync backend (Stage 2)
 * Paste this whole file into Extensions > Apps Script of your Google Sheet.
 * Then change SECRET_TOKEN below, run setupSheets once, and deploy as a Web app.
 * (Full steps: SHEETS_SETUP.md)
 */

// ====== 1. CHANGE THIS: a long random secret. The same text goes into the app (Settings > Cloud Sync). ======
var SECRET_TOKEN = 'PUT-A-LONG-RANDOM-TEXT-HERE';

// ====== 2. Leave empty when this script was opened from inside your Google Sheet (recommended). ======
var SPREADSHEET_ID = '';

// ---------------------------------------------------------------------------------------------
// Tabs and columns. A column name ending with # holds numbers. The last column "data" holds the
// complete record as text; the app uses it to restore everything exactly. Do not edit "data".
// ---------------------------------------------------------------------------------------------
var SETTING_KEYS = ['bizName', 'threshold', 'expenseCats'];
var TABS = {
  items: { tab: 'Items', key: 'id', cols: ['id', 'name', 'rate#', 'stockMode', 'directMaterialId', 'directQty#', 'active#', 'order#', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  sales: { tab: 'SaleItems', key: 'id', cols: ['id', 'billId', 'billNo', 'date', 'itemId', 'itemName', 'qty#', 'rate#', 'discount#', 'total#', 'cogs#', 'tracked#', 'payment', 'customer', 'customers#', 'staff', 'type', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  expenses: { tab: 'Expenses', key: 'id', cols: ['id', 'date', 'category', 'amount#', 'description', 'payment', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  inventory: { tab: 'Inventory', key: 'id', cols: ['id', 'name', 'unit', 'opening#', 'costPerUnit#', 'lowLevel#', 'currentStock#', 'active#', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  recipes: { tab: 'Recipes', key: 'id', cols: ['id', 'itemId', 'itemName', 'materialId', 'materialName', 'qty#', 'unit', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  wastage: { tab: 'Wastage', key: 'id', cols: ['id', 'date', 'kind', 'targetName', 'qty#', 'unit', 'costPerUnit#', 'totalLoss#', 'reason', 'staff', 'remarks', 'hasPhoto#', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  credits: { tab: 'Credit', key: 'id', cols: ['id', 'date', 'customer', 'phone', 'entryType', 'amount#', 'billNo', 'billId', 'mode', 'note', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  staff: { tab: 'Staff', key: 'id', cols: ['id', 'name', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  stockMoves: { tab: 'StockMoves', key: 'id', cols: ['id', 'date', 'materialId', 'materialName', 'type', 'qty#', 'unitCost#', 'refId', 'note', 'createdAt', 'updatedAt', 'serverAt', 'deleted#', 'data'] },
  settings: { tab: 'Settings', key: 'key', cols: ['key', 'value', 'updatedAt'] },
  // one row per bill, built automatically from SaleItems (never sent by the app)
  salesHeader: { tab: 'Sales', key: 'billId', cols: ['billId', 'billNo', 'date', 'type', 'payment', 'customer', 'customers#', 'staff', 'items#', 'subtotal#', 'discount#', 'total#', 'cogs#', 'updatedAt', 'deleted#'] }
};
var PUSHABLE = ['items', 'sales', 'expenses', 'inventory', 'recipes', 'wastage', 'credits', 'staff', 'stockMoves'];
var MAX_CELL = 45000;

// ----------------------------------------------------------------------------------- web app entry
function doGet() {
  return out_({ ok: true, app: 'taj-fast-food', message: 'Taj sync is running. Open the app to sync.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return out_({ ok: false, error: 'Server is busy, try again in a minute.' });
  }
  try {
    var body;
    try { body = JSON.parse(e.postData.contents); } catch (err2) { return out_({ ok: false, error: 'Bad request.' }); }
    if (SECRET_TOKEN === 'PUT-A-LONG-RANDOM-TEXT-HERE') return out_({ ok: false, error: 'Set SECRET_TOKEN in Code.gs first.' });
    if (!body || body.token !== SECRET_TOKEN) return out_({ ok: false, error: 'Wrong secret token.' });

    var ss = book_();
    var serverTime = new Date().toISOString();
    if (body.action === 'ping') {
      ensureAll_(ss);
      return out_({ ok: true, serverTime: serverTime, spreadsheet: ss.getName() });
    }
    if (body.action === 'push') return out_(push_(ss, body, serverTime));
    if (body.action === 'pull') return out_(pull_(ss, body, serverTime));
    return out_({ ok: false, error: 'Unknown action.' });
  } catch (err3) {
    return out_({ ok: false, error: 'Server error: ' + (err3 && err3.message ? err3.message : err3) });
  } finally {
    lock.releaseLock();
  }
}

/** Run this ONCE by hand (Run button). It creates every tab and asks for Google permission. */
function setupSheets() {
  ensureAll_(book_());
}

// ----------------------------------------------------------------------------------- helpers
function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function spec_(key) {
  var t = TABS[key];
  if (!t._p) {
    t._p = { names: [], num: [] };
    t.cols.forEach(function (c) {
      var n = c.charAt(c.length - 1) === '#';
      t._p.names.push(n ? c.slice(0, -1) : c);
      t._p.num.push(n);
    });
  }
  return t._p;
}

function ensureAll_(ss) {
  Object.keys(TABS).forEach(function (k) { ensureSheet_(ss, k); });
}

function ensureSheet_(ss, key) {
  var t = TABS[key], sp = spec_(key);
  var sh = ss.getSheetByName(t.tab);
  if (!sh) sh = ss.insertSheet(t.tab);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, sp.names.length).setValues([sp.names]);
    sh.setFrozenRows(1);
    // text columns stay text (so Sheets never turns "2026-11-02" or "007" into something else)
    sp.names.forEach(function (n, i) {
      if (!sp.num[i]) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  } else {
    var head = sh.getRange(1, 1, 1, sp.names.length).getValues()[0];
    for (var i = 0; i < sp.names.length; i++) {
      if (String(head[i]) !== sp.names[i]) throw new Error('Tab "' + t.tab + '" has changed columns. Do not edit row 1.');
    }
  }
  return sh;
}

function readAll_(sh, ncols) {
  var lr = sh.getLastRow();
  if (lr < 2) return [];
  return sh.getRange(2, 1, lr - 1, ncols).getValues();
}

function cell_(v, numeric) {
  if (numeric) {
    if (v === true) return 1;
    if (v === false) return 0;
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  var s = String(v);
  if (/^[=+\-@]/.test(s)) s = ' ' + s;      // a typed customer name can never run as a formula
  return s.length > MAX_CELL ? s.slice(0, MAX_CELL) : s;
}

function ts_(v) {
  if (v instanceof Date) return v.toISOString();
  return v === null || v === undefined ? '' : String(v);
}

function buildRow_(key, rec, serverTime) {
  var sp = spec_(key);
  var vals = sp.names.map(function (n, i) {
    if (n === 'data') return JSON.stringify(rec);
    if (n === 'serverAt') return serverTime;
    return cell_(rec[n], sp.num[i]);
  });
  var di = sp.names.indexOf('data');
  if (di >= 0 && String(vals[di]).length > MAX_CELL) return null;
  return vals;
}

/** Insert or update rows by id. Nothing is ever added twice. entries: [{id, vals, updatedAt}] */
function upsert_(sh, key, entries, force) {
  var sp = spec_(key), n = sp.names.length, k = TABS[key].key;
  var keyIdx = sp.names.indexOf(k), updIdx = sp.names.indexOf('updatedAt');
  var rows = readAll_(sh, n), index = {};
  rows.forEach(function (r, i) { index[String(r[keyIdx])] = i + 2; });

  var saved = [], skipped = [], updates = [], appends = [], appendPos = {};
  entries.forEach(function (en) {
    var rowNo = index[en.id];
    if (rowNo) {
      var existing = ts_(rows[rowNo - 2][updIdx]);
      if (!force && existing && en.updatedAt && existing > en.updatedAt) { skipped.push({ id: en.id, reason: 'server_newer' }); return; }
      updates.push([rowNo, en.vals]);
    } else if (appendPos[en.id] !== undefined) {
      appends[appendPos[en.id]] = en.vals;               // same id twice in one request: keep one row
    } else {
      appendPos[en.id] = appends.length; appends.push(en.vals);
    }
    saved.push(en.id);
  });

  updates.forEach(function (u) { sh.getRange(u[0], 1, 1, n).setValues([u[1]]); });
  if (appends.length) {
    var start = sh.getLastRow() + 1, need = start + appends.length - 1;
    if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 200);
    sh.getRange(start, 1, appends.length, n).setValues(appends);
  }
  return { saved: saved, skipped: skipped };
}

// ----------------------------------------------------------------------------------- push
function push_(ss, body, serverTime) {
  var store = body.store, records = body.records;
  if (!Array.isArray(records)) return { ok: false, error: 'No records.' };
  if (records.length > 500) return { ok: false, error: 'Too many records in one request.' };

  if (store === 'settings') return pushSettings_(ss, records, serverTime);
  if (PUSHABLE.indexOf(store) < 0) return { ok: false, error: 'Unknown data type: ' + store };

  var sh = ensureSheet_(ss, store);
  var entries = [], skipped = [];
  records.forEach(function (rec) {
    if (!rec || typeof rec.id !== 'string' || !rec.id || rec.id.length > 80) { skipped.push({ id: rec && rec.id, reason: 'bad_id' }); return; }
    var vals = buildRow_(store, rec, serverTime);
    if (!vals) { skipped.push({ id: rec.id, reason: 'too_big' }); return; }
    entries.push({ id: rec.id, vals: vals, updatedAt: String(rec.updatedAt || '') });
  });
  var res = upsert_(sh, store, entries, false);

  if (store === 'sales') rebuildHeaders_(ss, records);
  if (store === 'stockMoves' || store === 'inventory') refreshStock_(ss);
  return { ok: true, saved: res.saved, skipped: skipped.concat(res.skipped), serverTime: serverTime };
}

function pushSettings_(ss, records, serverTime) {
  var sh = ensureSheet_(ss, 'settings');
  var entries = [];
  records.forEach(function (r) {
    if (!r || SETTING_KEYS.indexOf(r.key) < 0) return;
    entries.push({ id: r.key, vals: [r.key, JSON.stringify(r.value === undefined ? null : r.value), String(r.updatedAt || '')], updatedAt: String(r.updatedAt || '') });
  });
  var res = upsert_(sh, 'settings', entries, false);
  return { ok: true, saved: res.saved, skipped: res.skipped, serverTime: serverTime };
}

/** Rebuild the one-row-per-bill "Sales" tab for the bills touched by this push. */
function rebuildHeaders_(ss, records) {
  var want = {};
  records.forEach(function (r) { if (r && r.billId) want[r.billId] = true; });
  if (!Object.keys(want).length) return;

  var sp = spec_('sales'), n = sp.names.length;
  var ix = function (name) { return sp.names.indexOf(name); };
  var lines = readAll_(ensureSheet_(ss, 'sales'), n);
  var bills = {};
  lines.forEach(function (r) {
    var id = String(r[ix('billId')]);
    if (!want[id]) return;
    var b = bills[id] || (bills[id] = { first: r, count: 0, sub: 0, disc: 0, total: 0, cogs: 0, upd: '' });
    var u = ts_(r[ix('updatedAt')]);
    if (u > b.upd) b.upd = u;
    if (Number(r[ix('deleted')]) === 1) return;
    b.count++;
    b.sub += Number(r[ix('qty')]) * Number(r[ix('rate')]);
    b.disc += Number(r[ix('discount')]);
    b.total += Number(r[ix('total')]);
    b.cogs += Number(r[ix('cogs')]);
  });

  var hs = spec_('salesHeader');
  var entries = Object.keys(bills).map(function (id) {
    var b = bills[id], f = b.first;
    var rec = { billId: id, billNo: f[ix('billNo')], date: f[ix('date')], type: f[ix('type')], payment: f[ix('payment')],
                customer: f[ix('customer')], customers: f[ix('customers')], staff: f[ix('staff')], items: b.count,
                subtotal: Math.round(b.sub * 100) / 100, discount: Math.round(b.disc * 100) / 100,
                total: Math.round(b.total * 100) / 100, cogs: Math.round(b.cogs * 100) / 100,
                updatedAt: b.upd, deleted: b.count === 0 ? 1 : 0 };
    var vals = hs.names.map(function (nm, i) { return cell_(rec[nm], hs.num[i]); });
    return { id: id, vals: vals, updatedAt: b.upd };
  });
  upsert_(ensureSheet_(ss, 'salesHeader'), 'salesHeader', entries, true);
}

/** Write each material's current stock (opening + all movements) into the Inventory tab. */
function refreshStock_(ss) {
  var isp = spec_('inventory'), msp = spec_('stockMoves');
  var inv = ensureSheet_(ss, 'inventory'), mv = ensureSheet_(ss, 'stockMoves');
  var mats = readAll_(inv, isp.names.length);
  if (!mats.length) return;
  var total = {};
  readAll_(mv, msp.names.length).forEach(function (r) {
    if (Number(r[msp.names.indexOf('deleted')]) === 1) return;
    var id = String(r[msp.names.indexOf('materialId')]);
    total[id] = (total[id] || 0) + Number(r[msp.names.indexOf('qty')]);
  });
  var idI = isp.names.indexOf('id'), opI = isp.names.indexOf('opening'), csI = isp.names.indexOf('currentStock');
  var col = mats.map(function (r) {
    return [Math.round((Number(r[opI]) + (total[String(r[idI])] || 0)) * 10000) / 10000];
  });
  inv.getRange(2, csI + 1, col.length, 1).setValues(col);
}

// ----------------------------------------------------------------------------------- pull
function pull_(ss, body, serverTime) {
  // "since" is Google's own clock (serverAt), so a phone that was offline for days and uploads old
  // records later still has them delivered to the other phone.
  var since = String(body.since || '');
  var records = {};
  PUSHABLE.forEach(function (key) {
    var t = TABS[key], sp = spec_(key);
    var sh = ss.getSheetByName(t.tab);
    records[key] = [];
    if (!sh) return;
    var di = sp.names.indexOf('data'), si = sp.names.indexOf('serverAt');
    readAll_(sh, sp.names.length).forEach(function (r) {
      if (ts_(r[si]) < since) return;      // equal is included on purpose: re-sending a row is harmless
      try { records[key].push(JSON.parse(r[di])); } catch (err) { /* skip a damaged row */ }
    });
  });
  var set = [], ssh = ss.getSheetByName(TABS.settings.tab);
  if (ssh) {
    readAll_(ssh, 3).forEach(function (r) {
      if (SETTING_KEYS.indexOf(String(r[0])) < 0) return;
      try { set.push({ key: String(r[0]), value: JSON.parse(r[1]), updatedAt: ts_(r[2]) }); } catch (err) { /* skip */ }
    });
  }
  return { ok: true, records: records, settings: set, serverTime: serverTime };
}
