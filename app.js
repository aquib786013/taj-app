/* Taj Fast Food Corner - Smart Business Manager (Stage 2)
   Screens: PIN login, Dashboard, New Bill, Sales, Items + Recipes, Inventory, Expenses, Wastage,
   Udhaar (credit), Profit & Loss, Settings (cloud sync, backup/restore). */
(function () {
  'use strict';
  const L = window.Logic, DB = window.DB, SYNC = window.TajSync;
  const PAYMENTS = ['Cash', 'UPI', 'Card', 'Credit'];
  const PAY_SIMPLE = ['Cash', 'UPI', 'Card'];
  const TYPES = ['Dine-in', 'Parcel'];
  const UNITS = ['Kg', 'Gram', 'Litre', 'ML', 'Piece'];
  const REASONS = ['Expired', 'Burnt', 'Damaged', 'Unsold', 'Preparation Waste', 'Other'];
  const DEFAULT_CATS = ['Gas', 'Rent', 'Salary', 'Electricity', 'Water', 'Transport', 'Packaging', 'Repair', 'Other'];
  const MODES = { none: 'No stock tracking', recipe: 'Recipe (made in-house)', direct: 'Direct stock (sold as bought)', hybrid: 'Hybrid (recipe + ready item)' };
  const NAV = {
    admin: [['dashboard', '📊', 'Home'], ['bill', '🧾', 'New Bill'], ['sales', '📋', 'Sales'],
            ['items', '🍜', 'Items'], ['more', '☰', 'More']],
    staff: [['bill', '🧾', 'New Bill'], ['sales', '📋', 'Today'], ['wastage', '🗑️', 'Wastage']]
  };
  const MORE_VIEWS = ['expenses', 'inventory', 'udhaar', 'pl', 'settings'];
  const STAFF_VIEWS = ['bill', 'sales', 'wastage'];
  // fixed ids: a second phone that seeds the same menu merges instead of duplicating
  const SEED_ITEMS = [['Veg Momo', 60], ['Paneer Momo', 80], ['Kurkure Momo', 90], ['Veg Noodles', 70],
    ['Paneer Noodles', 90], ['Spring Roll', 50], ['Burger', 50], ['Fried Rice', 80],
    ['Chilli Potato', 80], ['Pasta', 90], ['Cold Drinks', 20]];

  const state = { role: null, view: null, items: [], staff: [], materials: [], recipes: [], cats: DEFAULT_CATS.slice(),
                  biz: 'Taj Fast Food Corner', threshold: 1800, bill: null, cart: [], nextBillNo: '', saving: false,
                  salesDate: null, fails: 0, lockUntil: 0, plMode: 'day', plDay: null, plMonth: null,
                  expDate: null, wMonth: null, invMonth: null, ledger: null };

  const $ = function (s) { return document.querySelector(s); };
  const num = function (v) { const n = Number(v); return isFinite(n) ? n : NaN; };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3200);
  }
  async function sha(pin) {
    const salt = 'taj-v1:' + pin;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt));
      return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    let h = 5381; for (const c of salt) h = ((h << 5) + h + c.charCodeAt(0)) | 0;
    return 'x' + h;
  }
  function modal(html) {
    closeModal();
    const m = document.createElement('div'); m.id = 'modal';
    m.innerHTML = '<div class="sheet">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m.querySelector('.sheet');
  }
  function closeModal() { const m = $('#modal'); if (m) m.remove(); }
  function opts(arr, sel) {
    return arr.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
  }
  function matOpts(sel, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + state.materials.map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + ' (' + esc(m.unit) + ')</option>';
    }).join('');
  }
  // one click handler per screen: buttons carry data-act="name" and optional data-id
  function bind(handlers) {
    $('#main').onclick = function (e) {
      const b = e.target.closest('[data-act]');
      if (b && handlers[b.dataset.act]) handlers[b.dataset.act](b.dataset, b);
    };
  }
  function backLink() { return '<button class="ghost back" data-act="back">‹ More</button>'; }
  function card(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="lbl">' + label + '</div><div class="val">' + value + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }
  function fmtQty(n) { return String(L.round4(n)); }
  function fmtTime(iso) { return iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }

  async function allData() {
    const g = function (n) { return DB.getAll(n); };
    const r = await Promise.all([g('sales'), g('expenses'), g('wastage'), g('stockMoves'), g('credits'), g('inventory'), g('items'), g('recipes')]);
    return { sales: r[0], expenses: r[1], wastage: r[2], stockMoves: r[3], credits: r[4], materials: r[5], items: r[6], recipes: r[7] };
  }

  async function loadData() {
    const items = await DB.getAll('items');
    state.items = items.sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name); });
    state.staff = await DB.getAll('staff');
    state.materials = (await DB.getAll('inventory')).sort(function (a, b) { return a.name.localeCompare(b.name); });
    state.recipes = await DB.getAll('recipes');
    state.biz = await DB.setting('bizName', 'Taj Fast Food Corner');
    state.threshold = Number(await DB.setting('threshold', 1800)) || 1800;
    const cats = await DB.setting('expenseCats', DEFAULT_CATS);
    state.cats = Array.isArray(cats) && cats.length ? cats : DEFAULT_CATS.slice();
  }

  async function seedIfEmpty() {
    if (await DB.setting('seeded', false)) return;
    const now = new Date().toISOString();
    const items = SEED_ITEMS.map(function (x, i) {
      return { id: 'seed-item-' + (i + 1), createdAt: now, name: x[0], rate: x[1], active: true, order: i + 1, stockMode: 'none' };
    });
    await DB.putMany('items', items);
    await DB.putMany('staff', [{ id: 'seed-staff-owner', createdAt: now, name: 'Owner' }]);
    await DB.setSetting('bizName', 'Taj Fast Food Corner');
    await DB.setSetting('threshold', 1800);
    await DB.setSetting('seeded', true);
  }

  // Stage 1 -> Stage 2: old bill lines get a unique bill id. Safe to run any number of times; never removes anything.
  async function migrateSales() {
    const all = await DB.getAll('sales', { includeDeleted: true });
    const missing = all.filter(function (s) { return !s.billId; });
    if (!missing.length) return 0;
    const ids = {};
    all.forEach(function (s) { if (s.billId) ids[s.billNo] = s.billId; });
    missing.forEach(function (s) {
      if (!ids[s.billNo]) ids[s.billNo] = DB.uuid();
      s.billId = ids[s.billNo];
      if (s.cogs === undefined) s.cogs = 0;
      if (s.tracked === undefined) s.tracked = 0;
    });
    const before = all.length;
    await DB.putMany('sales', missing);
    const after = (await DB.getAll('sales', { includeDeleted: true })).length;
    if (after !== before) throw new Error('Upgrade check failed: sales count changed');
    return missing.length;
  }

  /* ---------- Login / setup ---------- */
  function authShell(inner) {
    $('#app').innerHTML = '<div class="auth"><img src="icon-192.png" width="84" height="84" alt="">' +
      '<h1>Taj Fast Food Corner</h1><p class="muted">Smart Business Manager</p>' + inner + '</div>';
  }
  function renderSetup() {
    authShell('<p>First time setup. Create an <b>Admin PIN</b> (4 to 6 digits).</p>' +
      '<form id="f"><input id="p1" type="password" inputmode="numeric" maxlength="6" placeholder="New PIN" autocomplete="off" required>' +
      '<input id="p2" type="password" inputmode="numeric" maxlength="6" placeholder="Confirm PIN" autocomplete="off" required>' +
      '<button class="btn">Create PIN</button></form>');
    $('#f').onsubmit = async function (e) {
      e.preventDefault();
      const a = $('#p1').value, b = $('#p2').value;
      if (!/^\d{4,6}$/.test(a)) return toast('PIN must be 4 to 6 digits', 1);
      if (a !== b) return toast('PINs do not match', 1);
      await DB.setSetting('adminPin', await sha(a));
      state.role = 'admin'; await loadData(); renderShell();
    };
  }
  function renderLogin() {
    authShell('<form id="f"><input id="p1" type="password" inputmode="numeric" maxlength="6" placeholder="Enter PIN" autocomplete="off" required autofocus>' +
      '<button class="btn">Unlock</button></form>');
    $('#f').onsubmit = async function (e) {
      e.preventDefault();
      if (Date.now() < state.lockUntil) return toast('Too many wrong tries. Wait ' + Math.ceil((state.lockUntil - Date.now()) / 1000) + ' seconds.', 1);
      const h = await sha($('#p1').value);
      const admin = await DB.setting('adminPin'), staff = await DB.setting('staffPin');
      let role = null;
      if (h === admin) role = 'admin'; else if (staff && h === staff) role = 'staff';
      if (!role) {
        state.fails++;
        if (state.fails >= 5) { state.fails = 0; state.lockUntil = Date.now() + 30000; }
        $('#p1').value = ''; return toast('Wrong PIN', 1);
      }
      state.fails = 0; state.role = role; await loadData(); renderShell();
    };
  }
  function lock() { state.role = null; state.cart = []; state.bill = null; closeModal(); renderLogin(); }

  /* ---------- Shell + sync status ---------- */
  function renderStatus() {
    const el = $('#status'); if (!el) return;
    const s = SYNC.status();
    let text, cls;
    if (!s.configured) { text = s.online ? 'Online' : 'Offline'; cls = s.online ? 'on' : 'off'; }
    else if (s.syncing) { text = 'Syncing…'; cls = 'on'; }
    else if (!s.online) { text = 'Offline' + (s.pending ? ' · ' + s.pending + ' waiting' : ''); cls = 'off'; }
    else if (s.pending) { text = s.pending + ' waiting'; cls = 'warn'; }
    else if (s.last && !s.last.ok) { text = 'Sync error'; cls = 'bad'; }
    else { text = 'Synced ✓'; cls = 'on'; }
    el.innerHTML = '<span class="pill ' + cls + '">' + esc(text) + '</span>';
    const info = $('#syncInfo'); if (info) info.innerHTML = syncInfoHtml(s);
    const b = $('#syncBtn'); if (b) b.classList.toggle('spin', !!s.syncing);
  }
  function syncInfoHtml(s) {
    if (!s.configured) return '<b>Not set up.</b> Enter your Web App URL and token below.';
    const l = s.last;
    let h = '<b>' + s.pending + '</b> record(s) waiting. ';
    if (!l) return h + 'Not synced yet.';
    return h + 'Last sync: <b class="' + (l.ok ? 'okc' : 'badc') + '">' + (l.ok ? 'Success' : 'Failed') + '</b> at ' + esc(fmtTime(l.at)) +
      '<div class="muted">' + esc(l.message || '') + '</div>';
  }
  async function doSync(full) {
    const r = await SYNC.syncNow({ full: !!full });
    if (r.notConfigured) toast('Set up Cloud Sync first: More > Settings', 1);
    else toast(r.ok ? 'Synced: ' + r.message : r.message, !r.ok);
    return r;
  }

  function renderShell() {
    const nav = NAV[state.role];
    $('#app').innerHTML = '<header><div><b>' + esc(state.biz) + '</b><div class="sub">' + (state.role === 'admin' ? 'Admin' : 'Staff') +
      '</div></div><div class="hr"><div id="status"></div><button id="syncBtn" aria-label="Sync now">↻</button></div></header><main id="main"></main>' +
      '<nav>' + nav.map(function (n) { return '<button data-nav="' + n[0] + '"><span>' + n[1] + '</span>' + n[2] + '</button>'; }).join('') + '</nav>';
    document.querySelector('nav').addEventListener('click', function (e) {
      const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav);
    });
    $('#syncBtn').onclick = function () { doSync(false); };
    renderStatus();
    go(nav[0][0]);
  }

  const VIEWS = {};
  async function go(view) {
    const allowed = state.role === 'admin' ? NAV.admin.map(function (n) { return n[0]; }).concat(MORE_VIEWS, ['wastage']) : STAFF_VIEWS;
    if (allowed.indexOf(view) < 0) view = NAV[state.role][0][0];
    state.view = view;
    const navKey = state.role === 'admin' && (MORE_VIEWS.indexOf(view) >= 0 || view === 'wastage') ? 'more' : view;
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.nav === navKey); });
    const main = $('#main'); main.onclick = null; main.oninput = null; main.onchange = null;
    try {
      await loadData();
      await VIEWS[view]();
    } catch (err) {
      console.error(err);
      main.innerHTML = '<div class="card"><b>Something went wrong.</b><p class="muted">' + esc(err.message || err) + '</p></div>';
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('taj:pulled', async function () {
    if (!state.role || $('#modal')) return;
    if (state.view === 'bill' && state.cart.length) { await loadData(); return; }
    go(state.view);
  });

  /* ---------- More menu ---------- */
  VIEWS.more = async function () {
    const tile = function (v, ic, t, s) { return '<button class="tile" data-act="go" data-id="' + v + '"><span>' + ic + '</span><b>' + t + '</b><small>' + s + '</small></button>'; };
    $('#main').innerHTML = '<h2>More</h2><div class="tiles">' +
      tile('expenses', '💸', 'Expenses', 'Gas, rent, salary…') +
      tile('inventory', '📦', 'Inventory', 'Raw material stock') +
      tile('wastage', '🗑️', 'Wastage', 'Burnt, expired…') +
      tile('udhaar', '📒', 'Udhaar', 'Customer credit') +
      tile('pl', '📈', 'Profit &amp; Loss', 'Daily / Monthly') +
      tile('settings', '⚙️', 'Settings', 'Sync, PIN, backup') + '</div>';
    bind({ go: function (d) { go(d.id); } });
  };

  /* ---------- Dashboard (admin) ---------- */
  VIEWS.dashboard = async function () {
    const D = await allData(), today = L.todayStr();
    const d = L.dashboard(D.sales, state.items, today, state.threshold);
    const x = L.dashboardExtra(D, today);
    const th = L.money(d.threshold);
    const low = x.lowStock.map(function (m) { return esc(m.name); });
    $('#main').innerHTML = '<h2>Dashboard</h2><div class="grid">' +
      card('Today’s Sale', L.money(d.todaySale), d.todayOrders + ' bills today') +
      card('Monthly Sale', L.money(d.monthSale), d.monthOrders + ' bills this month') +
      card('Monthly Expenses', L.money(x.monthExpenses), 'this month') +
      card('Net Profit (month)', L.money(x.monthNet), 'after cost, expenses, wastage', x.monthNet < 0 ? 'warn' : '') +
      card('Total Orders', d.monthOrders, 'this month') +
      card('Average Bill', L.money(d.avgBill), 'this month') +
      card('Best Selling Item', d.best ? esc(d.best.name) : '—', d.best ? d.best.qty + ' sold this month' : 'No sales yet') +
      card('Weak Selling Item', d.weak ? esc(d.weak.name) : '—', d.weak ? d.weak.qty + ' sold this month' : 'No sales yet') +
      card('Wastage Loss', L.money(x.monthWastage), 'this month', x.monthWastage > 0 ? 'warn' : '') +
      card('Stock Alerts', x.lowStock.length ? x.lowStock.length + ' low' : 'All OK', low.slice(0, 3).join(', ') + (low.length > 3 ? '…' : ''), x.lowStock.length ? 'warn' : '') +
      card('Udhaar Pending', L.money(x.udhaar), 'customers owe you', x.udhaar > 0 ? 'warn' : '') +
      card('Sales vs ' + th, d.todayBelow ? 'Below target' : (d.todaySale >= d.threshold ? 'Target met' : 'No sales yet'),
        d.todayBelow ? 'Short by ' + L.money(d.shortfall) + ' today' : '', d.todayBelow ? 'warn' : '') +
      card('Days below ' + th, d.daysBelow + ' of ' + d.daysTotal, 'days with sales this month', d.daysBelow ? 'warn' : '') +
      '</div><p class="note">Business score, forecasts and PDF/WhatsApp reports come in later stages.</p>';
  };

  /* ---------- New Bill ---------- */
  VIEWS.bill = async function () {
    state.nextBillNo = L.nextBillNo(await DB.getAll('sales', { includeDeleted: true }));
    const staffNames = state.staff.map(function (s) { return s.name; });
    if (!staffNames.length) staffNames.push('Owner');
    if (!state.bill) state.bill = { date: L.todayStr(), type: 'Dine-in', payment: 'Cash', customers: 1, staff: staffNames[0], customer: '', phone: '' };
    const b = state.bill;
    if (!state.cart.length) b.date = L.todayStr();
    if (staffNames.indexOf(b.staff) < 0) b.staff = staffNames[0];
    const active = state.items.filter(function (i) { return i.active !== false; });
    const names = L.customerBalances(await DB.getAll('credits'));
    $('#main').innerHTML = '<h2>New Bill <small>' + state.nextBillNo + '</small></h2>' +
      '<div class="card form"><div class="two"><label>Date<input type="date" id="b-date" value="' + b.date + '"></label>' +
      '<label>Customers<input type="number" id="b-cust" min="1" step="1" inputmode="numeric" value="' + b.customers + '"></label></div>' +
      '<div class="two"><label>Dine-in / Parcel<select id="b-type">' + opts(TYPES, b.type) + '</select></label>' +
      '<label>Payment<select id="b-pay">' + opts(PAYMENTS, b.payment) + '</select></label></div>' +
      '<div id="credit-box" class="' + (b.payment === 'Credit' ? '' : 'hidden') + '">' +
      '<label>Customer name (udhaar)<input id="b-cname" maxlength="40" list="cnames" autocomplete="off" value="' + esc(b.customer) + '"></label>' +
      '<datalist id="cnames">' + names.map(function (n) { return '<option value="' + esc(n.name) + '">'; }).join('') + '</datalist>' +
      '<label>Phone (optional)<input id="b-cphone" type="tel" inputmode="tel" maxlength="15" value="' + esc(b.phone) + '"></label></div>' +
      '<label>Staff<select id="b-staff">' + opts(staffNames, b.staff) + '</select></label></div>' +
      '<h3>Tap items to add</h3><div class="chips">' +
      (active.map(function (i) { return '<button class="chip" data-add="' + i.id + '">' + esc(i.name) + '<small>' + L.money(i.rate) + '</small></button>'; }).join('') ||
        '<p class="muted">No items. Ask the admin to add items.</p>') + '</div>' +
      '<div id="cart"></div>';
    $('#b-date').onchange = function (e) { b.date = e.target.value; };
    $('#b-cust').oninput = function (e) { b.customers = e.target.value; };
    $('#b-type').onchange = function (e) { b.type = e.target.value; };
    $('#b-pay').onchange = function (e) { b.payment = e.target.value; $('#credit-box').classList.toggle('hidden', b.payment !== 'Credit'); };
    $('#b-cname').oninput = function (e) { b.customer = e.target.value; };
    $('#b-cphone').oninput = function (e) { b.phone = e.target.value; };
    $('#b-staff').onchange = function (e) { b.staff = e.target.value; };
    $('#main').querySelector('.chips').onclick = function (e) {
      const c = e.target.closest('[data-add]'); if (!c) return;
      const it = state.items.find(function (i) { return i.id === c.dataset.add; }); if (!it) return;
      const ex = state.cart.find(function (l) { return l.itemId === it.id; });
      if (ex) ex.qty += 1; else state.cart.push({ itemId: it.id, name: it.name, qty: 1, rate: it.rate, discount: 0 });
      renderCart();
    };
    renderCart();
  };
  function cartTotal() {
    return L.round2(state.cart.reduce(function (s, l) { return s + L.lineTotal(l.qty, l.rate, l.discount); }, 0));
  }
  function updateTotals() {
    state.cart.forEach(function (l, i) { const e = $('#lt-' + i); if (e) e.textContent = L.money(L.lineTotal(l.qty, l.rate, l.discount)); });
    const t = $('#bt'); if (t) t.textContent = L.money(cartTotal());
  }
  function renderCart() {
    const el = $('#cart'); if (!el) return;
    if (!state.cart.length) { el.innerHTML = '<p class="muted center">Bill is empty.</p>'; return; }
    el.innerHTML = '<h3>Bill items</h3>' + state.cart.map(function (l, i) {
      return '<div class="line"><div class="lh"><b>' + esc(l.name) + '</b><button class="ghost red" data-del="' + i + '">Remove</button></div>' +
        '<div class="lr"><div class="qty"><button data-dec="' + i + '">−</button><span>' + l.qty + '</span><button data-inc="' + i + '">+</button></div>' +
        '<label>Rate<input type="number" min="0" step="0.5" inputmode="decimal" data-rate="' + i + '" value="' + l.rate + '"></label>' +
        '<label>Discount<input type="number" min="0" step="0.5" inputmode="decimal" data-disc="' + i + '" value="' + l.discount + '"></label>' +
        '<div class="lt" id="lt-' + i + '">' + L.money(L.lineTotal(l.qty, l.rate, l.discount)) + '</div></div></div>';
    }).join('') + '<div class="total"><span>Total</span><b id="bt">' + L.money(cartTotal()) + '</b></div>' +
      '<button class="btn big" id="saveBill">Save Bill</button>';
    el.onclick = function (e) {
      const t = e.target.closest('button'); if (!t) return;
      const d = t.dataset;
      if (d.inc !== undefined) { state.cart[+d.inc].qty += 1; renderCart(); }
      else if (d.dec !== undefined) { const l = state.cart[+d.dec]; l.qty = Math.max(1, l.qty - 1); renderCart(); }
      else if (d.del !== undefined) { state.cart.splice(+d.del, 1); renderCart(); }
      else if (t.id === 'saveBill') saveBill();
    };
    el.oninput = function (e) {
      const d = e.target.dataset;
      if (d.rate !== undefined) state.cart[+d.rate].rate = Number(e.target.value) || 0;
      else if (d.disc !== undefined) state.cart[+d.disc].discount = Number(e.target.value) || 0;
      else return;
      updateTotals();
    };
  }
  async function saveBill() {
    if (state.saving) return;
    const b = state.bill;
    if (!state.cart.length) return toast('Add at least one item', 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return toast('Choose a valid date', 1);
    const customers = parseInt(b.customers, 10);
    if (!(customers >= 1)) return toast('Customer count must be 1 or more', 1);
    const isCredit = b.payment === 'Credit', cname = String(b.customer || '').trim();
    if (isCredit && !cname) return toast('Enter the customer name for udhaar', 1);
    for (const l of state.cart) {
      if (!(l.qty >= 1)) return toast('Quantity must be at least 1 for ' + l.name, 1);
      if (!(l.rate >= 0)) return toast('Rate is invalid for ' + l.name, 1);
      if (l.discount < 0 || l.discount > l.qty * l.rate) return toast('Discount is invalid for ' + l.name, 1);
    }
    state.saving = true;
    try {
      const billId = DB.uuid(), billNo = state.nextBillNo;
      const materials = await DB.getAll('inventory'), recipes = await DB.getAll('recipes');
      const rows = state.cart.map(function (l) {
        return { id: DB.uuid(), billId: billId, date: b.date, billNo: billNo, itemId: l.itemId, itemName: l.name, qty: l.qty, rate: l.rate,
                 discount: l.discount, total: L.lineTotal(l.qty, l.rate, l.discount), payment: b.payment,
                 customer: isCredit ? cname : '', customers: customers, staff: b.staff, type: b.type };
      });
      const fx = L.saleStockEffects({ billId: billId, billNo: billNo, date: b.date, rows: rows, items: state.items, recipes: recipes, materials: materials });
      rows.forEach(function (r) { const p = fx.perRow[r.id]; r.cogs = p.cogs; r.tracked = p.tracked ? 1 : 0; });
      const total = cartTotal();
      const credits = isCredit ? [{ date: b.date, customer: cname, phone: String(b.phone || '').trim(), entryType: 'udhaar', amount: total,
                                    billNo: billNo, billId: billId, mode: '', note: 'Bill ' + billNo }] : [];
      // bill + stock + udhaar are saved together: all or nothing
      await DB.putBatch({ sales: rows, stockMoves: fx.moves, credits: credits });
      const used = {}; fx.moves.forEach(function (m) { used[m.materialId] = 1; });
      state.cart = []; b.customers = 1; b.customer = ''; b.phone = '';
      if (b.payment === 'Credit') b.payment = 'Cash';   // never leave the next bill on udhaar by accident
      let msg = 'Bill ' + billNo + ' saved: ' + L.money(total);
      const lv = L.stockLevels(await DB.getAll('inventory'), await DB.getAll('stockMoves'));
      const low = L.lowStockList(await DB.getAll('inventory'), lv).filter(function (m) { return used[m.id]; }).map(function (m) { return m.name; });
      if (low.length) msg += '. Low stock: ' + low.join(', ');
      toast(msg);
      await VIEWS.bill();
    } catch (err) {
      toast('Could not save bill: ' + (err.message || err), 1);
    } finally { state.saving = false; }
  }

  /* ---------- Sales list ---------- */
  VIEWS.sales = async function () {
    const isAdmin = state.role === 'admin';
    const date = isAdmin ? (state.salesDate || L.todayStr()) : L.todayStr();
    const bills = L.groupBills((await DB.getAll('sales')).filter(function (s) { return s.date === date; }));
    const total = L.round2(bills.reduce(function (s, x) { return s + x.total; }, 0));
    $('#main').innerHTML = '<h2>' + (isAdmin ? 'Sales' : 'Today’s Bills') + '</h2>' +
      (isAdmin ? '<div class="card form"><label>Date<input type="date" id="s-date" value="' + date + '"></label></div>' : '') +
      '<div class="total"><span>' + bills.length + ' bills</span><b>' + L.money(total) + '</b></div>' +
      (bills.map(function (b) {
        return '<div class="card"><div class="lh"><b>' + esc(b.billNo) + '</b><b>' + L.money(b.total) + '</b></div>' +
          '<div class="muted">' + esc(b.type) + ' · ' + esc(b.payment) + (b.customer ? ' (' + esc(b.customer) + ')' : '') + ' · ' + esc(b.staff) + ' · ' + b.customers + ' customer(s)</div>' +
          '<ul>' + b.lines.map(function (l) {
            return '<li>' + l.qty + ' × ' + esc(l.itemName) + ' @ ' + L.money(l.rate) + (l.discount ? ' (−' + L.money(l.discount) + ')' : '') +
              '<span>' + L.money(l.total) + '</span></li>';
          }).join('') + '</ul>' +
          (isAdmin ? '<button class="ghost red" data-act="delbill" data-id="' + esc(b.billId || b.billNo) + '" data-no="' + esc(b.billNo) + '">Delete bill</button>' : '') + '</div>';
      }).join('') || '<p class="muted center">No bills for this date.</p>');
    if (isAdmin) {
      $('#s-date').onchange = function (e) { state.salesDate = e.target.value || L.todayStr(); VIEWS.sales(); };
      bind({ delbill: async function (d) {
        if (state.role !== 'admin') return;
        if (!confirm('Delete bill ' + d.no + '? Its stock deduction and udhaar entry are reversed. This cannot be undone.')) return;
        const key = function (r) { return (r.billId || r.billNo) === d.id; };
        const rows = (await DB.getAll('sales')).filter(key);
        rows.forEach(function (r) { r.deleted = true; });
        const moves = (await DB.getAll('stockMoves')).filter(function (m) { return m.refId === d.id && m.type === 'sale'; });
        moves.forEach(function (m) { m.deleted = true; });
        const cr = (await DB.getAll('credits')).filter(function (c) { return c.billId === d.id; });
        cr.forEach(function (c) { c.deleted = true; });
        await DB.putBatch({ sales: rows, stockMoves: moves, credits: cr });
        toast('Bill ' + d.no + ' deleted'); VIEWS.sales();
      } });
    }
  };

  /* ---------- Items + recipes (admin) ---------- */
  VIEWS.items = async function () {
    const mats = state.materials;
    $('#main').innerHTML = '<div class="row between"><h2>Items</h2><button class="btn sm" data-act="add">+ Add Item</button></div>' +
      (state.items.map(function (i) {
        const mode = i.stockMode || 'none';
        const cost = mode === 'none' ? 0 : L.itemCost(i, state.recipes, mats);
        return '<div class="card li"><div><b>' + esc(i.name) + '</b>' + (i.active === false ? ' <span class="tag">hidden</span>' : '') +
          '<div class="muted">' + L.money(i.rate) + (mode !== 'none' ? ' · cost ' + L.money(cost) : '') + '</div>' +
          '<div class="muted small">' + esc(MODES[mode]) + '</div></div><div class="btns">' +
          ((mode === 'recipe' || mode === 'hybrid') ? '<button class="ghost" data-act="recipe" data-id="' + i.id + '">Recipe</button>' : '') +
          '<button class="ghost" data-act="edit" data-id="' + i.id + '">Edit</button>' +
          '<button class="ghost red" data-act="del" data-id="' + i.id + '">Delete</button></div></div>';
      }).join('') || '<p class="muted center">No items yet.</p>');
    const find = function (id) { return state.items.find(function (i) { return i.id === id; }); };
    bind({
      add: function () { itemForm(null); },
      edit: function (d) { itemForm(find(d.id)); },
      recipe: function (d) { recipeEditor(find(d.id)); },
      del: async function (d) {
        const it = find(d.id);
        if (!it || !confirm('Delete "' + it.name + '"? Old bills keep their record.')) return;
        const rec = state.recipes.filter(function (r) { return r.itemId === it.id; });
        rec.forEach(function (r) { r.deleted = true; });
        it.deleted = true;
        await DB.putBatch({ items: [it], recipes: rec });
        toast('Item deleted'); go('items');
      }
    });
  };
  function itemForm(item) {
    const mode = (item && item.stockMode) || 'none';
    modal('<h3>' + (item ? 'Edit' : 'Add') + ' Item</h3><form id="if" class="form">' +
      '<label>Item name<input id="in" required maxlength="40" value="' + esc(item ? item.name : '') + '"></label>' +
      '<label>Rate (₹)<input id="ir" type="number" min="0" step="0.5" inputmode="decimal" required value="' + (item ? item.rate : '') + '"></label>' +
      '<label>Stock type<select id="im">' + Object.keys(MODES).map(function (k) {
        return '<option value="' + k + '"' + (k === mode ? ' selected' : '') + '>' + esc(MODES[k]) + '</option>'; }).join('') + '</select></label>' +
      '<div id="direct-box" class="' + (mode === 'direct' || mode === 'hybrid' ? '' : 'hidden') + '">' +
      '<label>Ready item used from inventory<select id="idm">' + matOpts(item && item.directMaterialId, 'Choose…') + '</select></label>' +
      '<label>Quantity used per 1 sold<input id="idq" type="number" min="0" step="any" inputmode="decimal" value="' + (item && item.directQty ? item.directQty : 1) + '"></label></div>' +
      '<p class="muted small" id="mode-help"></p>' +
      '<label class="chk"><input type="checkbox" id="ia" ' + (item && item.active === false ? '' : 'checked') + '> Show on billing screen</label>' +
      '<div class="row"><button type="button" class="btn ghost" id="ic">Cancel</button><button class="btn">Save</button></div></form>');
    const help = { none: 'Selling this item does not change inventory.', recipe: 'After saving, tap Recipe to list the raw materials used per piece.',
                   direct: 'Each sale reduces the chosen inventory item (example: Cold Drinks bottle).',
                   hybrid: 'Each sale uses the recipe AND the ready item (example: momo + bottle combo).' };
    const upd = function () {
      const m = $('#im').value;
      $('#direct-box').classList.toggle('hidden', !(m === 'direct' || m === 'hybrid'));
      $('#mode-help').textContent = help[m];
    };
    $('#im').onchange = upd; upd();
    $('#ic').onclick = closeModal;
    $('#if').onsubmit = async function (e) {
      e.preventDefault();
      const name = $('#in').value.trim(), rate = Number($('#ir').value), m = $('#im').value;
      if (!name) return toast('Enter item name', 1);
      if (!(rate >= 0)) return toast('Enter a valid rate', 1);
      if (state.items.some(function (i) { return i.name.toLowerCase() === name.toLowerCase() && (!item || i.id !== item.id); }))
        return toast('An item with this name already exists', 1);
      const rec = item ? Object.assign({}, item) : { order: state.items.reduce(function (mx, i) { return Math.max(mx, i.order || 0); }, 0) + 1 };
      rec.name = name; rec.rate = rate; rec.active = $('#ia').checked; rec.stockMode = m;
      if (m === 'direct' || m === 'hybrid') {
        const mid = $('#idm').value, q = Number($('#idq').value);
        if (!mid) return toast('Choose the ready item from inventory (add it in Inventory first)', 1);
        if (!(q > 0)) return toast('Quantity used must be more than 0', 1);
        rec.directMaterialId = mid; rec.directQty = q;
      } else { rec.directMaterialId = ''; rec.directQty = 0; }
      await DB.put('items', rec); closeModal(); toast('Item saved'); go('items');
    };
  }
  function recipeEditor(item) {
    if (!item) return;
    const lines = state.recipes.filter(function (r) { return r.itemId === item.id; });
    const cost = L.itemCost(item, state.recipes, state.materials);
    const matById = {}; state.materials.forEach(function (m) { matById[m.id] = m; });
    modal('<h3>Recipe: ' + esc(item.name) + '</h3><p class="muted small">Raw material used to make <b>1 piece</b>. Use the same unit as in Inventory.</p>' +
      (lines.map(function (r) {
        const m = matById[r.materialId];
        return '<div class="li"><span>' + esc(m ? m.name : r.materialName + ' (removed)') + ' — ' + fmtQty(r.qty) + ' ' + esc(m ? m.unit : r.unit || '') +
          (m ? ' <small class="muted">(' + L.money(L.round4(r.qty * (m.costPerUnit || 0))) + ')</small>' : '') + '</span>' +
          '<button class="ghost red" data-rdel="' + r.id + '">Remove</button></div>';
      }).join('') || '<p class="muted center">No ingredients yet.</p>') +
      '<div class="total"><span>Cost per piece</span><b>' + L.money(cost) + '</b></div>' +
      '<div class="muted small">Selling price ' + L.money(item.rate) + ' · margin ' + L.money(L.round2(item.rate - cost)) + '</div>' +
      (state.materials.length ? '<form id="rf" class="form two3"><label>Material<select id="rm">' + matOpts('', '') + '</select></label>' +
        '<label>Qty per piece<input id="rq" type="number" min="0" step="any" inputmode="decimal" required></label><button class="btn sm">Add</button></form>'
        : '<p class="muted">Add raw materials in Inventory first.</p>') +
      '<button class="btn ghost big" id="rclose">Done</button>');
    $('#rclose').onclick = function () { closeModal(); go('items'); };
    $('#modal').onclick = async function (e) {
      const b = e.target.closest('[data-rdel]');
      if (e.target.id === 'modal') { closeModal(); go('items'); return; }
      if (!b) return;
      const r = state.recipes.find(function (x) { return x.id === b.dataset.rdel; });
      if (r) { r.deleted = true; await DB.put('recipes', r); await loadData(); recipeEditor(item); }
    };
    const f = $('#rf');
    if (f) f.onsubmit = async function (e) {
      e.preventDefault();
      const mid = $('#rm').value, q = Number($('#rq').value), m = matById[mid];
      if (!m) return toast('Choose a material', 1);
      if (!(q > 0)) return toast('Quantity must be more than 0', 1);
      const ex = lines.find(function (r) { return r.materialId === mid; });
      const rec = ex ? Object.assign({}, ex) : { itemId: item.id };
      Object.assign(rec, { itemName: item.name, materialId: mid, materialName: m.name, unit: m.unit, qty: q });
      await DB.put('recipes', rec); await loadData(); recipeEditor(item);
    };
  }

  /* ---------- Inventory (admin) ---------- */
  VIEWS.inventory = async function () {
    const moves = await DB.getAll('stockMoves');
    const lv = L.stockLevels(state.materials, moves);
    const ym = state.invMonth || L.todayStr().slice(0, 7);
    const rep = L.inventoryReport(state.materials, moves, ym);
    $('#main').innerHTML = '<div class="row between">' + backLink() + '<button class="btn sm" data-act="add">+ Add Material</button></div><h2>Inventory</h2>' +
      (state.materials.map(function (m) {
        const low = (lv[m.id] <= (m.lowLevel || 0));
        return '<div class="card"><div class="lh"><b>' + esc(m.name) + '</b><b class="' + (low ? 'badc' : '') + '">' + fmtQty(lv[m.id]) + ' ' + esc(m.unit) + '</b></div>' +
          '<div class="muted">' + L.money(m.costPerUnit || 0) + ' per ' + esc(m.unit) + ' · alert at ' + fmtQty(m.lowLevel || 0) + (low ? ' <span class="tag red">LOW</span>' : '') + '</div>' +
          '<div class="btns"><button class="ghost" data-act="buy" data-id="' + m.id + '">Purchase</button>' +
          '<button class="ghost" data-act="count" data-id="' + m.id + '">Stock count</button>' +
          '<button class="ghost" data-act="edit" data-id="' + m.id + '">Edit</button>' +
          '<button class="ghost red" data-act="del" data-id="' + m.id + '">Delete</button></div></div>';
      }).join('') || '<p class="muted center">No raw materials yet. Tap + Add Material.</p>') +
      '<h3>Monthly inventory report</h3><div class="card form"><label>Month<input type="month" id="i-month" value="' + ym + '"></label></div>' +
      '<div class="scroll"><table class="tbl"><tr><th>Material</th><th>Open</th><th>Bought</th><th>Used</th><th>Waste</th><th>Adj</th><th>Close</th></tr>' +
      rep.map(function (r) {
        return '<tr><td>' + esc(r.name) + ' <small>' + esc(r.unit) + '</small></td><td>' + fmtQty(r.opening) + '</td><td>' + fmtQty(r.purchase) + '</td><td>' + fmtQty(r.used) +
          '</td><td>' + fmtQty(r.wastage) + '</td><td>' + fmtQty(r.adjust) + '</td><td><b>' + fmtQty(r.closing) + '</b></td></tr>';
      }).join('') + '</table></div>' +
      '<p class="note">Used = deducted automatically from billing. Waste = from the Wastage screen. Adj = stock count corrections.</p>';
    const find = function (id) { return state.materials.find(function (m) { return m.id === id; }); };
    $('#i-month').onchange = function (e) { state.invMonth = e.target.value || null; VIEWS.inventory(); };
    bind({
      back: function () { go('more'); },
      add: function () { materialForm(null); },
      edit: function (d) { materialForm(find(d.id)); },
      buy: function (d) { purchaseForm(find(d.id)); },
      count: function (d) { countForm(find(d.id), lv[d.id]); },
      del: async function (d) {
        const m = find(d.id);
        if (!m || !confirm('Delete "' + m.name + '"? Recipes using it will stop deducting it.')) return;
        m.deleted = true; await DB.put('inventory', m); toast('Material deleted'); go('inventory');
      }
    });
  };
  function materialForm(m) {
    modal('<h3>' + (m ? 'Edit' : 'Add') + ' Raw Material</h3><form id="mf" class="form">' +
      '<label>Name<input id="mn" required maxlength="40" value="' + esc(m ? m.name : '') + '"></label>' +
      '<div class="two"><label>Unit<select id="mu">' + opts(UNITS, m ? m.unit : 'Kg') + '</select></label>' +
      '<label>Opening stock<input id="mo" type="number" min="0" step="any" inputmode="decimal" value="' + (m ? m.opening : 0) + '"></label></div>' +
      '<div class="two"><label>Cost per unit (₹)<input id="mc" type="number" min="0" step="any" inputmode="decimal" required value="' + (m ? m.costPerUnit : '') + '"></label>' +
      '<label>Low stock alert at<input id="ml" type="number" min="0" step="any" inputmode="decimal" value="' + (m ? m.lowLevel : 0) + '"></label></div>' +
      '<p class="muted small">Opening stock is what you have right now. After that, use Purchase and Stock count.</p>' +
      '<div class="row"><button type="button" class="btn ghost" id="mx">Cancel</button><button class="btn">Save</button></div></form>');
    $('#mx').onclick = closeModal;
    $('#mf').onsubmit = async function (e) {
      e.preventDefault();
      const name = $('#mn').value.trim(), open = num($('#mo').value), cost = num($('#mc').value), low = num($('#ml').value);
      if (!name) return toast('Enter a name', 1);
      if (!(open >= 0) || !(cost >= 0) || !(low >= 0)) return toast('Numbers cannot be negative', 1);
      if (state.materials.some(function (x) { return x.name.toLowerCase() === name.toLowerCase() && (!m || x.id !== m.id); })) return toast('This material already exists', 1);
      const rec = m ? Object.assign({}, m) : { active: true };
      Object.assign(rec, { name: name, unit: $('#mu').value, opening: open, costPerUnit: cost, lowLevel: low });
      await DB.put('inventory', rec); closeModal(); toast('Material saved'); go('inventory');
    };
  }
  function purchaseForm(m) {
    if (!m) return;
    modal('<h3>Purchase: ' + esc(m.name) + '</h3><form id="pf2" class="form">' +
      '<div class="two"><label>Date<input type="date" id="pd" value="' + L.todayStr() + '"></label>' +
      '<label>Quantity (' + esc(m.unit) + ')<input id="pq" type="number" min="0" step="any" inputmode="decimal" required></label></div>' +
      '<label>Price per ' + esc(m.unit) + ' (₹)<input id="pp" type="number" min="0" step="any" inputmode="decimal" required value="' + (m.costPerUnit || '') + '"></label>' +
      '<div class="total"><span>Total paid</span><b id="pt">₹0</b></div>' +
      '<p class="muted small">This adds stock and updates the cost per unit used in profit. Do not also enter it under Expenses.</p>' +
      '<div class="row"><button type="button" class="btn ghost" id="px">Cancel</button><button class="btn">Save purchase</button></div></form>');
    const tot = function () { $('#pt').textContent = L.money(L.round2((num($('#pq').value) || 0) * (num($('#pp').value) || 0))); };
    $('#pq').oninput = tot; $('#pp').oninput = tot; $('#px').onclick = closeModal;
    $('#pf2').onsubmit = async function (e) {
      e.preventDefault();
      const q = num($('#pq').value), p = num($('#pp').value), date = $('#pd').value;
      if (!(q > 0)) return toast('Quantity must be more than 0', 1);
      if (!(p >= 0)) return toast('Enter a valid price', 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Choose a valid date', 1);
      const mat = Object.assign({}, m, { costPerUnit: p });
      await DB.putBatch({ stockMoves: [{ date: date, materialId: m.id, materialName: m.name, type: 'purchase', qty: q, unitCost: p, refId: '', note: 'Purchase' }], inventory: [mat] });
      closeModal(); toast('Purchase saved: ' + fmtQty(q) + ' ' + m.unit + ' ' + m.name); go('inventory');
    };
  }
  function countForm(m, current) {
    if (!m) return;
    modal('<h3>Stock count: ' + esc(m.name) + '</h3><form id="cf" class="form">' +
      '<p>App says you have <b>' + fmtQty(current) + ' ' + esc(m.unit) + '</b>.</p>' +
      '<label>Actually counted now (' + esc(m.unit) + ')<input id="cq" type="number" min="0" step="any" inputmode="decimal" required></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn">Save count</button></div></form>');
    $('#cx').onclick = closeModal;
    $('#cf').onsubmit = async function (e) {
      e.preventDefault();
      const c = num($('#cq').value);
      if (!(c >= 0)) return toast('Enter the counted quantity', 1);
      const diff = L.round4(c - current);
      if (diff === 0) { closeModal(); return toast('Stock already matches'); }
      await DB.put('stockMoves', { date: L.todayStr(), materialId: m.id, materialName: m.name, type: 'adjust', qty: diff,
                                   unitCost: m.costPerUnit || 0, refId: '', note: 'Stock count' });
      closeModal(); toast('Stock corrected by ' + (diff > 0 ? '+' : '') + fmtQty(diff) + ' ' + m.unit); go('inventory');
    };
  }

  /* ---------- Expenses (admin) ---------- */
  VIEWS.expenses = async function () {
    const date = state.expDate || L.todayStr(), ym = date.slice(0, 7);
    const all = await DB.getAll('expenses');
    const day = all.filter(function (e) { return e.date === date; });
    const sum = function (a) { return L.round2(a.reduce(function (s, e) { return s + e.amount; }, 0)); };
    $('#main').innerHTML = '<div class="row between">' + backLink() + '<button class="btn sm" data-act="add">+ Add Expense</button></div><h2>Expenses</h2>' +
      '<div class="card form"><label>Date<input type="date" id="e-date" value="' + date + '"></label></div>' +
      '<div class="total"><span>Day total</span><b>' + L.money(sum(day)) + '</b></div>' +
      '<div class="muted">Month total (' + ym + '): <b>' + L.money(sum(all.filter(function (e) { return e.date.slice(0, 7) === ym; }))) + '</b></div>' +
      (day.map(function (e) {
        return '<div class="card li"><div><b>' + esc(e.category) + '</b> · ' + L.money(e.amount) + '<div class="muted">' + esc(e.description || '') + ' ' + esc(e.payment) + '</div></div>' +
          '<div class="btns"><button class="ghost" data-act="edit" data-id="' + e.id + '">Edit</button><button class="ghost red" data-act="del" data-id="' + e.id + '">Delete</button></div></div>';
      }).join('') || '<p class="muted center">No expenses on this date.</p>') +
      '<p class="note">Do not enter raw material purchases here. Use Inventory &gt; Purchase, otherwise the cost is counted twice in profit.</p>';
    $('#e-date').onchange = function (e) { state.expDate = e.target.value || null; VIEWS.expenses(); };
    const find = function (id) { return all.find(function (x) { return x.id === id; }); };
    bind({
      back: function () { go('more'); },
      add: function () { expenseForm(null, date); },
      edit: function (d) { expenseForm(find(d.id), date); },
      del: async function (d) { if (confirm('Delete this expense?')) { await DB.remove('expenses', d.id); toast('Expense deleted'); VIEWS.expenses(); } }
    });
  };
  function expenseForm(ex, date) {
    modal('<h3>' + (ex ? 'Edit' : 'Add') + ' Expense</h3><form id="xf" class="form">' +
      '<label>Date<input type="date" id="xd" value="' + (ex ? ex.date : date) + '"></label>' +
      '<div class="two"><label>Category<select id="xc">' + opts(state.cats, ex ? ex.category : state.cats[0]) + '</select></label>' +
      '<label>Amount (₹)<input id="xa" type="number" min="0" step="any" inputmode="decimal" required value="' + (ex ? ex.amount : '') + '"></label></div>' +
      '<label>Description<input id="xt" maxlength="80" value="' + esc(ex ? ex.description : '') + '"></label>' +
      '<label>Payment<select id="xp">' + opts(PAY_SIMPLE, ex ? ex.payment : 'Cash') + '</select></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="xx">Cancel</button><button class="btn">Save</button></div></form>');
    $('#xx').onclick = closeModal;
    $('#xf').onsubmit = async function (e) {
      e.preventDefault();
      const amt = num($('#xa').value), d = $('#xd').value;
      if (!(amt > 0)) return toast('Amount must be more than 0', 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('Choose a valid date', 1);
      const rec = ex ? Object.assign({}, ex) : {};
      Object.assign(rec, { date: d, category: $('#xc').value, amount: amt, description: $('#xt').value.trim(), payment: $('#xp').value });
      await DB.put('expenses', rec); state.expDate = d; closeModal(); toast('Expense saved'); VIEWS.expenses();
    };
  }

  /* ---------- Wastage ---------- */
  function resizeImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        const max = 700, k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read this photo')); };
      img.src = url;
    });
  }
  VIEWS.wastage = async function () {
    const isAdmin = state.role === 'admin';
    const D = await allData(), today = L.todayStr();
    const ym = state.wMonth || today.slice(0, 7);
    const monthSales = L.round2(D.sales.filter(function (s) { return s.date.slice(0, 7) === today.slice(0, 7); }).reduce(function (s, x) { return s + x.total; }, 0));
    const w = L.wastageSummary(D.wastage, monthSales, today);
    const list = D.wastage.filter(function (x) { return x.date.slice(0, 7) === ym; }).sort(function (a, b) { return b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)); });
    const showAmounts = isAdmin;
    $('#main').innerHTML = '<div class="row between">' + (isAdmin ? backLink() : '<span></span>') + '<button class="btn sm" data-act="add">+ Add Wastage</button></div><h2>Wastage</h2>' +
      (showAmounts ? '<div class="grid">' + card('Today', L.money(w.today)) + card('Last 7 days', L.money(w.week)) + card('This month', L.money(w.month), w.pct + '% of monthly sale', w.month > 0 ? 'warn' : '') +
        card('Highest wastage', w.highest ? esc(w.highest.name) : '—', w.highest ? L.money(w.highest.loss) + ' this month' : '') + '</div>' +
        (w.byItem.length ? '<h3>Item-wise (this month)</h3><div class="card">' + w.byItem.slice(0, 8).map(function (x) {
          return '<div class="li"><span>' + esc(x.name) + '</span><b>' + L.money(x.loss) + '</b></div>'; }).join('') + '</div>' : '') : '') +
      '<h3>Entries</h3><div class="card form"><label>Month<input type="month" id="w-month" value="' + ym + '"></label></div>' +
      (list.map(function (x) {
        return '<div class="card"><div class="lh"><b>' + esc(x.targetName) + '</b>' + (showAmounts ? '<b class="badc">' + L.money(x.totalLoss) + '</b>' : '') + '</div>' +
          '<div class="muted">' + esc(x.date) + ' · ' + fmtQty(x.qty) + ' ' + esc(x.unit) + ' · ' + esc(x.reason) + ' · ' + esc(x.staff) + '</div>' +
          (x.remarks ? '<div class="muted small">' + esc(x.remarks) + '</div>' : '') +
          (x.photo ? '<img class="wph" src="' + x.photo + '" alt="wastage photo">' : '') +
          (isAdmin ? '<button class="ghost red" data-act="del" data-id="' + x.id + '">Delete</button>' : '') + '</div>';
      }).join('') || '<p class="muted center">No wastage entries this month.</p>');
    $('#w-month').onchange = function (e) { state.wMonth = e.target.value || null; VIEWS.wastage(); };
    bind({
      back: function () { go('more'); },
      add: function () { wastageForm(); },
      del: async function (d) {
        if (state.role !== 'admin' || !confirm('Delete this wastage entry? Stock deducted for it is returned.')) return;
        const rec = D.wastage.find(function (x) { return x.id === d.id; }); if (!rec) return;
        rec.deleted = true;
        const mv = D.stockMoves.filter(function (m) { return m.refId === rec.id && m.type === 'wastage'; });
        mv.forEach(function (m) { m.deleted = true; });
        await DB.putBatch({ wastage: [rec], stockMoves: mv });
        toast('Wastage deleted'); VIEWS.wastage();
      }
    });
  };
  async function wastageForm() {
    const materials = state.materials, items = state.items.filter(function (i) { return i.active !== false; });
    const staffNames = state.staff.map(function (s) { return s.name; }); if (!staffNames.length) staffNames.push('Owner');
    let photo = '';
    modal('<h3>Add Wastage</h3><form id="wf" class="form">' +
      '<div class="two"><label>Date<input type="date" id="wd" value="' + L.todayStr() + '"></label>' +
      '<label>Category<select id="wk"><option value="material">Raw material</option><option value="item">Menu item</option></select></label></div>' +
      '<label>Item / material<select id="wt"></select></label>' +
      '<div class="two"><label>Quantity <span id="wu"></span><input id="wq" type="number" min="0" step="any" inputmode="decimal" required></label>' +
      '<label>Cost per unit (₹)<input id="wc" type="number" min="0" step="any" inputmode="decimal" required></label></div>' +
      '<div class="total"><span>Total loss</span><b id="wtot">₹0</b></div><p class="muted small" id="wdeduct"></p>' +
      '<div class="two"><label>Reason<select id="wr">' + opts(REASONS, 'Unsold') + '</select></label>' +
      '<label>Staff<select id="ws">' + opts(staffNames, state.role === 'staff' ? staffNames[0] : staffNames[0]) + '</select></label></div>' +
      '<label>Remarks<input id="wm" maxlength="100"></label>' +
      '<label>Photo (optional)<input id="wp" type="file" accept="image/*"></label><img id="wpv" class="wph hidden" alt="">' +
      '<div class="row"><button type="button" class="btn ghost" id="wx">Cancel</button><button class="btn">Save wastage</button></div></form>');
    const kind = function () { return $('#wk').value; };
    const target = function () {
      const id = $('#wt').value;
      return kind() === 'material' ? materials.find(function (m) { return m.id === id; }) : items.find(function (i) { return i.id === id; });
    };
    const unit = function () { const t = target(); return kind() === 'material' ? (t ? t.unit : '') : 'Piece'; };
    const refreshTargets = function () {
      const list = kind() === 'material' ? materials : items;
      $('#wt').innerHTML = list.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join('');
      refreshCost();
    };
    const refreshCost = function () {
      const t = target();
      $('#wu').textContent = t ? '(' + unit() + ')' : '';
      if (t) $('#wc').value = kind() === 'material' ? (t.costPerUnit || 0) : L.itemCost(t, state.recipes, materials);
      refreshTotal();
    };
    const refreshTotal = function () {
      const t = L.round2((num($('#wq').value) || 0) * (num($('#wc').value) || 0));
      $('#wtot').textContent = L.money(t);
      const tg = target(), q = num($('#wq').value) || 0;
      if (!tg) { $('#wdeduct').textContent = ''; return; }
      const mv = L.wastageStockMoves({ kind: kind(), targetId: tg.id, targetName: tg.name, qty: q, wastageId: 'x', date: '', materials: materials, items: items, recipes: state.recipes });
      $('#wdeduct').textContent = mv.length ? 'Stock deducted: ' + mv.map(function (m) { return fmtQty(-m.qty) + ' ' + (materials.find(function (x) { return x.id === m.materialId; }) || {}).unit + ' ' + m.materialName; }).join(', ')
        : 'No stock is deducted for this entry (no inventory link), the loss is still counted.';
    };
    $('#wk').onchange = refreshTargets; $('#wt').onchange = refreshCost;
    $('#wq').oninput = refreshTotal; $('#wc').oninput = refreshTotal;
    $('#wx').onclick = closeModal;
    $('#wp').onchange = async function (e) {
      const f = e.target.files[0]; if (!f) { photo = ''; $('#wpv').classList.add('hidden'); return; }
      try { photo = await resizeImage(f); $('#wpv').src = photo; $('#wpv').classList.remove('hidden'); } catch (err) { photo = ''; toast(err.message, 1); }
    };
    refreshTargets();
    $('#wf').onsubmit = async function (e) {
      e.preventDefault();
      const t = target(), q = num($('#wq').value), c = num($('#wc').value), d = $('#wd').value;
      if (!t) return toast('Choose an item or material (add it first)', 1);
      if (!(q > 0)) return toast('Quantity must be more than 0', 1);
      if (!(c >= 0)) return toast('Enter the cost per unit', 1);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return toast('Choose a valid date', 1);
      const id = DB.uuid();
      const rec = { id: id, createdAt: new Date().toISOString(), date: d, kind: kind(), targetId: t.id, targetName: t.name, qty: q, unit: unit(), costPerUnit: c,
                    totalLoss: L.round2(q * c), reason: $('#wr').value, staff: $('#ws').value, remarks: $('#wm').value.trim() };
      if (photo) rec.photo = photo;
      const mv = L.wastageStockMoves({ kind: kind(), targetId: t.id, targetName: t.name, qty: q, wastageId: id, date: d, materials: materials, items: items, recipes: state.recipes });
      try {
        await DB.putBatch({ wastage: [rec], stockMoves: mv });
        closeModal(); toast('Wastage saved: ' + L.money(rec.totalLoss)); go('wastage');
      } catch (err) { toast('Could not save: ' + (err.message || err), 1); }
    };
  }

  /* ---------- Udhaar (admin) ---------- */
  VIEWS.udhaar = async function () {
    const credits = await DB.getAll('credits');
    const cust = L.customerBalances(credits);
    $('#main').innerHTML = '<div class="row between">' + backLink() + '<button class="btn sm" data-act="addu">+ Add Udhaar</button></div><h2>Udhaar</h2>' +
      '<div class="stat warn"><div class="lbl">Total pending</div><div class="val">' + L.money(L.udhaarOutstanding(credits)) + '</div></div><div style="height:10px"></div>' +
      (cust.map(function (c) {
        return '<div class="card"><div class="lh"><b>' + esc(c.name) + '</b><b class="' + (c.balance > 0 ? 'badc' : 'okc') + '">' + (c.balance < 0 ? 'Advance ' + L.money(-c.balance) : L.money(c.balance)) + '</b></div>' +
          '<div class="muted">' + (c.phone ? esc(c.phone) + ' · ' : '') + 'given ' + L.money(c.given) + ' · received ' + L.money(c.received) + '</div>' +
          '<div class="btns"><button class="ghost" data-act="pay" data-id="' + esc(c.key) + '">Receive payment</button><button class="ghost" data-act="ledger" data-id="' + esc(c.key) + '">Ledger</button></div></div>';
      }).join('') || '<p class="muted center">No udhaar yet. Choose payment mode "Credit" while billing, or tap + Add Udhaar.</p>');
    const byKey = function (k) { return cust.find(function (c) { return c.key === k; }); };
    bind({
      back: function () { go('more'); },
      addu: function () { udhaarForm(); },
      pay: function (d) { paymentForm(byKey(d.id)); },
      ledger: function (d) { ledgerView(byKey(d.id), credits); }
    });
  };
  function udhaarForm() {
    modal('<h3>Add Udhaar</h3><form id="uf" class="form">' +
      '<label>Customer name<input id="un" required maxlength="40"></label><label>Phone (optional)<input id="up" type="tel" inputmode="tel" maxlength="15"></label>' +
      '<div class="two"><label>Amount (₹)<input id="ua" type="number" min="0" step="any" inputmode="decimal" required></label><label>Date<input type="date" id="ud" value="' + L.todayStr() + '"></label></div>' +
      '<label>Note<input id="uno" maxlength="80"></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="ux">Cancel</button><button class="btn">Save</button></div></form>');
    $('#ux').onclick = closeModal;
    $('#uf').onsubmit = async function (e) {
      e.preventDefault();
      const n = $('#un').value.trim(), a = num($('#ua').value);
      if (!n) return toast('Enter customer name', 1);
      if (!(a > 0)) return toast('Amount must be more than 0', 1);
      await DB.put('credits', { date: $('#ud').value, customer: n, phone: $('#up').value.trim(), entryType: 'udhaar', amount: a, billNo: '', billId: '', mode: '', note: $('#uno').value.trim() });
      closeModal(); toast('Udhaar saved'); VIEWS.udhaar();
    };
  }
  function paymentForm(c) {
    if (!c) return;
    modal('<h3>Payment from ' + esc(c.name) + '</h3><form id="pyf" class="form"><p>Pending: <b>' + L.money(c.balance) + '</b></p>' +
      '<div class="two"><label>Amount received (₹)<input id="pa" type="number" min="0" step="any" inputmode="decimal" required value="' + (c.balance > 0 ? c.balance : '') + '"></label>' +
      '<label>Date<input type="date" id="pd2" value="' + L.todayStr() + '"></label></div>' +
      '<label>Mode<select id="pm">' + opts(PAY_SIMPLE, 'Cash') + '</select></label><label>Note<input id="pn" maxlength="80"></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="pyx">Cancel</button><button class="btn">Save payment</button></div></form>');
    $('#pyx').onclick = closeModal;
    $('#pyf').onsubmit = async function (e) {
      e.preventDefault();
      const a = num($('#pa').value);
      if (!(a > 0)) return toast('Amount must be more than 0', 1);
      if (a > c.balance && !confirm('This is more than the pending ' + L.money(c.balance) + '. Save the rest as advance?')) return;
      await DB.put('credits', { date: $('#pd2').value, customer: c.name, phone: c.phone, entryType: 'payment', amount: a, billNo: '', billId: '', mode: $('#pm').value, note: $('#pn').value.trim() });
      closeModal(); toast('Payment saved: ' + L.money(a)); VIEWS.udhaar();
    };
  }
  function ledgerView(c, credits) {
    if (!c) return;
    const rows = credits.filter(function (x) { return L.customerKey(x.customer) === c.key; }).sort(function (a, b) { return a.date.localeCompare(b.date) || String(a.createdAt).localeCompare(String(b.createdAt)); });
    modal('<h3>' + esc(c.name) + ' — Ledger</h3>' + rows.map(function (x) {
      return '<div class="li"><span>' + esc(x.date) + ' · ' + (x.entryType === 'payment' ? 'Received' + (x.mode ? ' (' + esc(x.mode) + ')' : '') : 'Udhaar' + (x.billNo ? ' ' + esc(x.billNo) : '')) +
        (x.note && !x.billNo ? ' <small class="muted">' + esc(x.note) + '</small>' : '') + '</span><b class="' + (x.entryType === 'payment' ? 'okc' : 'badc') + '">' +
        (x.entryType === 'payment' ? '−' : '+') + L.money(x.amount) + '</b></div>';
    }).join('') + '<div class="total"><span>Pending</span><b>' + L.money(c.balance) + '</b></div><button class="btn ghost big" id="lx">Close</button>');
    $('#lx').onclick = closeModal;
  }

  /* ---------- Profit & Loss (admin) ---------- */
  VIEWS.pl = async function () {
    const D = await allData(), today = L.todayStr();
    const mode = state.plMode, day = state.plDay || today, month = state.plMonth || today.slice(0, 7);
    const r = mode === 'day' ? { from: day, to: day } : L.monthRange(month);
    const p = L.profitReport(D, r.from, r.to);
    const row = function (label, val, cls, sub) { return '<tr class="' + (cls || '') + '"><td>' + label + (sub ? '<div class="muted small">' + sub + '</div>' : '') + '</td><td>' + val + '</td></tr>'; };
    $('#main').innerHTML = '<div class="row between">' + backLink() + '<span></span></div><h2>Profit &amp; Loss</h2>' +
      '<div class="seg"><button data-act="mode" data-id="day" class="' + (mode === 'day' ? 'on' : '') + '">Daily</button><button data-act="mode" data-id="month" class="' + (mode === 'month' ? 'on' : '') + '">Monthly</button></div>' +
      '<div class="card form">' + (mode === 'day' ? '<label>Date<input type="date" id="pl-day" value="' + day + '"></label>' : '<label>Month<input type="month" id="pl-month" value="' + month + '"></label>') + '</div>' +
      '<table class="tbl pl">' +
      row('Total sales', L.money(p.sales), '', p.bills + ' bills' + (p.discount ? ', discounts ' + L.money(p.discount) + ' already deducted' : '')) +
      row('− Raw material cost', L.money(p.cogs), '', 'from recipes, at the time of each sale') +
      row('= Gross profit', L.money(p.gross), 'sub') +
      row('− Operating expenses', L.money(p.expenses), '', p.byCategory.map(function (c) { return esc(c.category) + ' ' + L.money(c.amount); }).join(' · ')) +
      row('− Wastage loss', L.money(p.wastage)) +
      row('= Net profit', L.money(p.net), 'net ' + (p.net < 0 ? 'neg' : 'pos')) +
      row('Profit %', p.pct + '%', 'sub') + '</table>' +
      '<div class="card small">' +
      '<div>Raw material <b>purchases</b> in this period: ' + L.money(p.purchases) + ' (stock buying, not subtracted again: only what was used is counted as cost).</div>' +
      '<div>Udhaar given in sales: ' + L.money(p.udhaarSales) + ' (counted as sale, cash not yet received). Collected in period: ' + L.money(p.udhaarCollected) + '.</div>' +
      (p.untrackedSales > 0 ? '<div class="badc">' + L.money(p.untrackedSales) + ' of sales are from items without a recipe or stock link, so their raw material cost is not included. Profit may look higher than real.</div>' : '') +
      '</div>';
    const redraw = function () { VIEWS.pl(); };
    if (mode === 'day') $('#pl-day').onchange = function (e) { state.plDay = e.target.value || null; redraw(); };
    else $('#pl-month').onchange = function (e) { state.plMonth = e.target.value || null; redraw(); };
    bind({ back: function () { go('more'); }, mode: function (d) { state.plMode = d.id; redraw(); } });
  };

  /* ---------- Settings (admin) ---------- */
  VIEWS.settings = async function () {
    const hasStaffPin = !!(await DB.setting('staffPin'));
    const lastBackup = await DB.setting('lastBackup', null);
    const url = await DB.setting('syncUrl', ''), token = await DB.setting('syncToken', ''), auto = (await DB.setting('autoSync', true)) !== false;
    await SYNC.refreshPending();
    $('#main').innerHTML = '<div class="row between">' + backLink() + '<span></span></div><h2>Settings</h2>' +
      '<div class="card form"><h3>Cloud Sync (Google Sheets)</h3>' +
      '<div class="syncbox" id="syncInfo"></div>' +
      '<label>Web App URL<input id="s-url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(url) + '"></label>' +
      '<label>Secret token<input id="s-token" type="password" autocomplete="off" value="' + esc(token) + '"></label>' +
      '<label class="chk"><input type="checkbox" id="s-auto" ' + (auto ? 'checked' : '') + '> Sync automatically when internet is available</label>' +
      '<div class="btns"><button class="btn sm" data-act="savesync">Save</button><button class="btn sm ghost" data-act="testsync">Test connection</button>' +
      '<button class="btn sm" data-act="syncnow">Sync Now</button></div>' +
      '<div class="btns"><button class="btn sm ghost" data-act="fullsync">Download everything from cloud</button></div></div>' +
      '<div class="card form"><h3>Business</h3><label>Business name<input id="s-biz" maxlength="50" value="' + esc(state.biz) + '"></label>' +
      '<label>Daily sales target (₹)<input id="s-th" type="number" min="0" inputmode="numeric" value="' + state.threshold + '"></label>' +
      '<label>Expense categories (comma separated)<input id="s-cats" value="' + esc(state.cats.join(', ')) + '"></label>' +
      '<p class="muted small">Do not add "Raw Material" here: purchases go in Inventory.</p>' +
      '<button class="btn" data-act="savebiz">Save</button></div>' +
      '<div class="card"><h3>Staff names</h3>' + (state.staff.map(function (s) {
        return '<div class="li"><span>' + esc(s.name) + '</span><button class="ghost red" data-act="rmstaff" data-id="' + s.id + '">Remove</button></div>';
      }).join('') || '<p class="muted">No staff added.</p>') +
      '<form id="sf" class="row"><input id="s-name" maxlength="30" placeholder="New staff name" required><button class="btn sm">Add</button></form></div>' +
      '<div class="card"><h3>PIN</h3><button class="btn ghost" data-act="chadmin">Change Admin PIN</button> ' +
      '<button class="btn ghost" data-act="chstaff">' + (hasStaffPin ? 'Change' : 'Set') + ' Staff PIN</button> ' +
      (hasStaffPin ? '<button class="btn ghost red" data-act="rmstaffpin">Remove Staff PIN</button>' : '') +
      '<p class="muted">Staff PIN opens only New Bill, Today’s Bills and Wastage entry.</p></div>' +
      '<div class="card"><h3>Backup &amp; Restore</h3><p class="muted">Last backup: ' + (lastBackup ? new Date(lastBackup).toLocaleString('en-IN') : 'never') + '</p>' +
      '<button class="btn" data-act="bk">Download Backup</button> <button class="btn ghost" data-act="rs">Restore from Backup</button>' +
      '<input type="file" id="rsFile" accept=".json,application/json" hidden>' +
      '<p class="muted small">The backup file contains your PIN code hash and sync token. Keep it private.</p></div>' +
      '<button class="btn ghost red big" data-act="lock">Lock app</button>';
    renderStatus();
    const readSync = function () { return { url: $('#s-url').value.trim(), token: $('#s-token').value.trim() }; };
    $('#sf').onsubmit = async function (e) {
      e.preventDefault();
      const n = $('#s-name').value.trim(); if (!n) return;
      if (state.staff.some(function (s) { return s.name.toLowerCase() === n.toLowerCase(); })) return toast('Name already exists', 1);
      await DB.put('staff', { name: n }); go('settings');
    };
    $('#rsFile').onchange = doRestore;
    bind({
      back: function () { go('more'); },
      savesync: async function () {
        const s = readSync();
        if (s.url && !SYNC.isValidUrl(s.url)) return toast('The URL must start with https://script.google.com/macros/s/ and end with /exec', 1);
        if (s.url && s.token.length < 8) return toast('Secret token must be at least 8 characters', 1);
        await DB.setSetting('syncUrl', s.url); await DB.setSetting('syncToken', s.token); await DB.setSetting('autoSync', $('#s-auto').checked);
        await SYNC.refreshPending(); toast(s.url ? 'Sync settings saved' : 'Cloud sync turned off');
      },
      testsync: async function () {
        const s = readSync();
        try { toast('Testing…'); const name = await SYNC.testConnection(s.url, s.token); toast('Connected to: ' + name); }
        catch (err) { toast(err.message || String(err), 1); }
      },
      syncnow: function () { doSync(false); },
      fullsync: function () { if (confirm('Download all data from Google Sheets and merge it with this phone? Nothing on this phone is deleted.')) doSync(true); },
      savebiz: async function () {
        const name = $('#s-biz').value.trim(), th = Number($('#s-th').value);
        const cats = $('#s-cats').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!name) return toast('Enter business name', 1);
        if (!(th >= 0)) return toast('Enter a valid target', 1);
        if (!cats.length) return toast('Add at least one expense category', 1);
        if (cats.some(function (c) { return /^raw\s*material/i.test(c); })) return toast('Remove "Raw Material": buy stock from Inventory > Purchase', 1);
        await DB.setSetting('bizName', name); await DB.setSetting('threshold', th); await DB.setSetting('expenseCats', Array.from(new Set(cats)));
        toast('Saved'); renderShell();
      },
      rmstaff: async function (d) {
        if (state.staff.length <= 1) return toast('Keep at least one staff name', 1);
        await DB.remove('staff', d.id); go('settings');
      },
      chadmin: function () { pinForm('admin'); },
      chstaff: function () { pinForm('staff'); },
      rmstaffpin: async function () {
        if (!confirm('Remove the Staff PIN? Staff will not be able to log in.')) return;
        await DB.setSetting('staffPin', null); toast('Staff PIN removed'); go('settings');
      },
      bk: doBackup,
      rs: function () { $('#rsFile').click(); },
      lock: lock
    });
  };
  function pinForm(which) {
    modal('<h3>' + (which === 'admin' ? 'Change Admin PIN' : 'Set Staff PIN') + '</h3><form id="pf" class="form">' +
      (which === 'admin' ? '<label>Current PIN<input id="p0" type="password" inputmode="numeric" maxlength="6" required></label>' : '') +
      '<label>New PIN (4 to 6 digits)<input id="p1" type="password" inputmode="numeric" maxlength="6" required></label>' +
      '<label>Confirm new PIN<input id="p2" type="password" inputmode="numeric" maxlength="6" required></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="pc">Cancel</button><button class="btn">Save PIN</button></div></form>');
    $('#pc').onclick = closeModal;
    $('#pf').onsubmit = async function (e) {
      e.preventDefault();
      const a = $('#p1').value, b = $('#p2').value;
      if (which === 'admin' && (await sha($('#p0').value)) !== (await DB.setting('adminPin'))) return toast('Current PIN is wrong', 1);
      if (!/^\d{4,6}$/.test(a)) return toast('PIN must be 4 to 6 digits', 1);
      if (a !== b) return toast('PINs do not match', 1);
      const h = await sha(a);
      const other = await DB.setting(which === 'admin' ? 'staffPin' : 'adminPin');
      if (other && h === other) return toast('Admin PIN and Staff PIN must be different', 1);
      await DB.setSetting(which === 'admin' ? 'adminPin' : 'staffPin', h);
      closeModal(); toast('PIN saved'); go('settings');
    };
  }
  async function doBackup() {
    try {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'taj-backup-' + L.todayStr() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      await DB.setSetting('lastBackup', new Date().toISOString());
      toast('Backup downloaded. Keep the file safe (Google Drive / WhatsApp to yourself).');
    } catch (err) { toast('Backup failed: ' + (err.message || err), 1); }
  }
  async function doRestore(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const bad = DB.validateBackup(obj); if (bad) return toast(bad, 1);
      const n = (obj.data.sales || []).filter(function (s) { return !s.deleted; }).length;
      if (!confirm('Restore this backup?\n\nIt contains ' + n + ' sale line(s), saved ' + new Date(obj.exportedAt).toLocaleString('en-IN') +
        '.\n\nThis REPLACES all data on this phone, including PINs.')) return;
      await DB.importAll(obj);
      await DB.markAllUnsynced();          // everything goes to the cloud again; uploads never create duplicates
      await DB.setSetting('lastPull', '');
      toast('Restored. Please unlock again.'); state.bill = null; state.cart = []; state.role = null;
      setTimeout(function () { location.reload(); }, 900);
    } catch (err) { toast('Restore failed: ' + (err.message || err), 1); }
  }

  /* ---------- Boot ---------- */
  async function boot() {
    try {
      await DB.open();
      await seedIfEmpty();
      await migrateSales();
      SYNC.onStatus(renderStatus);
      SYNC.start();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW', e); });
      if (await DB.setting('adminPin')) renderLogin(); else renderSetup();
    } catch (err) {
      $('#app').innerHTML = '<div class="auth"><h1>Cannot start</h1><p>' + esc(err.message || err) +
        '</p><p class="muted">Open the app in Chrome (not private/incognito mode) and allow site storage.</p></div>';
    }
  }
  window.TajApp = { boot: boot, state: state };
  boot();
})();
