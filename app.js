/* Taj Fast Food Corner - Smart Business Manager (Stage 1)
   UI + screens: PIN login, Dashboard, New Bill, Sales list, Items, Settings, Backup/Restore. */
(function () {
  'use strict';
  const L = window.Logic, DB = window.DB;
  const PAYMENTS = ['Cash', 'UPI', 'Card'];
  const TYPES = ['Dine-in', 'Parcel'];
  const NAV = {
    admin: [['dashboard', '📊', 'Home'], ['bill', '🧾', 'New Bill'], ['sales', '📋', 'Sales'],
            ['items', '🍜', 'Items'], ['settings', '⚙️', 'Settings']],
    staff: [['bill', '🧾', 'New Bill'], ['sales', '📋', 'Today']]
  };
  const SEED_ITEMS = [['Veg Momo', 60], ['Paneer Momo', 80], ['Kurkure Momo', 90], ['Veg Noodles', 70],
    ['Paneer Noodles', 90], ['Spring Roll', 50], ['Burger', 50], ['Fried Rice', 80],
    ['Chilli Potato', 80], ['Pasta', 90], ['Cold Drinks', 20]];

  const state = { role: null, view: null, items: [], staff: [], biz: 'Taj Fast Food Corner', threshold: 1800,
                  bill: null, cart: [], nextBillNo: '', saving: false, salesDate: null, fails: 0, lockUntil: 0 };

  const $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = ''; }, 3000);
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

  async function loadData() {
    const items = await DB.getAll('items');
    state.items = items.sort(function (a, b) { return (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name); });
    state.staff = await DB.getAll('staff');
    state.biz = await DB.setting('bizName', 'Taj Fast Food Corner');
    state.threshold = Number(await DB.setting('threshold', 1800)) || 1800;
  }

  async function seedIfEmpty() {
    if (await DB.setting('seeded', false)) return;
    const items = SEED_ITEMS.map(function (x, i) { return { name: x[0], rate: x[1], active: true, order: i + 1 }; });
    await DB.putMany('items', items);
    await DB.putMany('staff', [{ name: 'Owner' }]);
    await DB.setSetting('bizName', 'Taj Fast Food Corner');
    await DB.setSetting('threshold', 1800);
    await DB.setSetting('seeded', true);
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
  function lock() { state.role = null; state.cart = []; state.bill = null; renderLogin(); }

  /* ---------- Shell ---------- */
  function statusHtml() {
    const on = navigator.onLine;
    return '<span class="pill ' + (on ? 'on' : 'off') + '">' + (on ? 'Online' : 'Offline') + '</span>';
  }
  function renderShell() {
    const nav = NAV[state.role];
    $('#app').innerHTML = '<header><div><b>' + esc(state.biz) + '</b><div class="sub">' + (state.role === 'admin' ? 'Admin' : 'Staff') +
      '</div></div><div id="status">' + statusHtml() + '</div></header><main id="main"></main>' +
      '<nav>' + nav.map(function (n) { return '<button data-nav="' + n[0] + '"><span>' + n[1] + '</span>' + n[2] + '</button>'; }).join('') + '</nav>';
    document.querySelector('nav').addEventListener('click', function (e) {
      const b = e.target.closest('[data-nav]'); if (b) go(b.dataset.nav);
    });
    go(nav[0][0]);
  }
  window.addEventListener('online', function () { const s = $('#status'); if (s) s.innerHTML = statusHtml(); });
  window.addEventListener('offline', function () { const s = $('#status'); if (s) s.innerHTML = statusHtml(); });

  async function go(view) {
    if (!NAV[state.role] || !NAV[state.role].some(function (n) { return n[0] === view; })) view = NAV[state.role][0][0];
    state.view = view;
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.nav === view); });
    try {
      await loadData();
      await ({ dashboard: viewDashboard, bill: viewBill, sales: viewSales, items: viewItems, settings: viewSettings })[view]();
    } catch (err) {
      console.error(err);
      $('#main').innerHTML = '<div class="card"><b>Something went wrong.</b><p class="muted">' + esc(err.message || err) + '</p></div>';
    }
    window.scrollTo(0, 0);
  }

  /* ---------- Dashboard (admin) ---------- */
  function card(label, value, sub, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="lbl">' + label + '</div><div class="val">' + value + '</div>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  }
  async function viewDashboard() {
    const d = L.dashboard(await DB.getAll('sales'), state.items, L.todayStr(), state.threshold);
    const th = L.money(d.threshold);
    $('#main').innerHTML = '<h2>Dashboard</h2><div class="grid">' +
      card('Today’s Sale', L.money(d.todaySale), d.todayOrders + ' bills today') +
      card('Monthly Sale', L.money(d.monthSale), d.monthOrders + ' bills this month') +
      card('Average Bill', L.money(d.avgBill), 'this month') +
      card('Best Selling Item', d.best ? esc(d.best.name) : '—', d.best ? d.best.qty + ' sold this month' : 'No sales yet') +
      card('Weak Selling Item', d.weak ? esc(d.weak.name) : '—', d.weak ? d.weak.qty + ' sold this month' : 'No sales yet') +
      card('Sales vs ' + th, d.todayBelow ? 'Below target' : (d.todaySale >= d.threshold ? 'Target met' : 'No sales yet'),
        d.todayBelow ? 'Short by ' + L.money(d.shortfall) + ' today' : '', d.todayBelow ? 'warn' : '') +
      card('Days below ' + th, d.daysBelow + ' of ' + d.daysTotal, 'days with sales this month', d.daysBelow ? 'warn' : '') +
      '</div><p class="note">Expenses, profit, stock, wastage and business score are added in the next stages.</p>';
  }

  /* ---------- New Bill ---------- */
  async function viewBill() {
    state.nextBillNo = L.nextBillNo(await DB.getAll('sales', { includeDeleted: true }));
    const staffNames = state.staff.map(function (s) { return s.name; });
    if (!staffNames.length) staffNames.push('Owner');
    if (!state.bill) state.bill = { date: L.todayStr(), type: 'Dine-in', payment: 'Cash', customers: 1, staff: staffNames[0] };
    const b = state.bill;
    if (!state.cart.length) b.date = L.todayStr();
    if (staffNames.indexOf(b.staff) < 0) b.staff = staffNames[0];
    const opts = function (arr, sel) { return arr.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); };
    const active = state.items.filter(function (i) { return i.active !== false; });
    $('#main').innerHTML = '<h2>New Bill <small>' + state.nextBillNo + '</small></h2>' +
      '<div class="card form"><div class="two"><label>Date<input type="date" id="b-date" value="' + b.date + '"></label>' +
      '<label>Customers<input type="number" id="b-cust" min="1" step="1" inputmode="numeric" value="' + b.customers + '"></label></div>' +
      '<div class="two"><label>Dine-in / Parcel<select id="b-type">' + opts(TYPES, b.type) + '</select></label>' +
      '<label>Payment<select id="b-pay">' + opts(PAYMENTS, b.payment) + '</select></label></div>' +
      '<label>Staff<select id="b-staff">' + opts(staffNames, b.staff) + '</select></label></div>' +
      '<h3>Tap items to add</h3><div class="chips">' +
      (active.map(function (i) { return '<button class="chip" data-add="' + i.id + '">' + esc(i.name) + '<small>' + L.money(i.rate) + '</small></button>'; }).join('') ||
        '<p class="muted">No items. Ask the admin to add items.</p>') + '</div>' +
      '<div id="cart"></div>';
    $('#b-date').onchange = function (e) { b.date = e.target.value; };
    $('#b-cust').oninput = function (e) { b.customers = e.target.value; };
    $('#b-type').onchange = function (e) { b.type = e.target.value; };
    $('#b-pay').onchange = function (e) { b.payment = e.target.value; };
    $('#b-staff').onchange = function (e) { b.staff = e.target.value; };
    $('#main').querySelector('.chips').onclick = function (e) {
      const c = e.target.closest('[data-add]'); if (!c) return;
      const it = state.items.find(function (i) { return i.id === c.dataset.add; }); if (!it) return;
      const ex = state.cart.find(function (l) { return l.itemId === it.id; });
      if (ex) ex.qty += 1; else state.cart.push({ itemId: it.id, name: it.name, qty: 1, rate: it.rate, discount: 0 });
      renderCart();
    };
    renderCart();
  }
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
    for (const l of state.cart) {
      if (!(l.qty >= 1)) return toast('Quantity must be at least 1 for ' + l.name, 1);
      if (!(l.rate >= 0)) return toast('Rate is invalid for ' + l.name, 1);
      if (l.discount < 0 || l.discount > l.qty * l.rate) return toast('Discount is invalid for ' + l.name, 1);
    }
    state.saving = true;
    try {
      const billNo = state.nextBillNo;
      const rows = state.cart.map(function (l) {
        return { date: b.date, billNo: billNo, itemId: l.itemId, itemName: l.name, qty: l.qty, rate: l.rate,
                 discount: l.discount, total: L.lineTotal(l.qty, l.rate, l.discount), payment: b.payment,
                 customers: customers, staff: b.staff, type: b.type };
      });
      const total = cartTotal();
      await DB.putMany('sales', rows);
      state.cart = []; b.customers = 1;
      toast('Bill ' + billNo + ' saved: ' + L.money(total));
      await viewBill();
    } catch (err) {
      toast('Could not save bill: ' + (err.message || err), 1);
    } finally { state.saving = false; }
  }

  /* ---------- Sales list ---------- */
  async function viewSales() {
    const isAdmin = state.role === 'admin';
    const date = isAdmin ? (state.salesDate || L.todayStr()) : L.todayStr();
    const bills = L.groupBills((await DB.getAll('sales')).filter(function (s) { return s.date === date; }));
    const total = L.round2(bills.reduce(function (s, x) { return s + x.total; }, 0));
    $('#main').innerHTML = '<h2>' + (isAdmin ? 'Sales' : 'Today’s Bills') + '</h2>' +
      (isAdmin ? '<div class="card form"><label>Date<input type="date" id="s-date" value="' + date + '"></label></div>' : '') +
      '<div class="total"><span>' + bills.length + ' bills</span><b>' + L.money(total) + '</b></div>' +
      (bills.map(function (b) {
        return '<div class="card"><div class="lh"><b>' + esc(b.billNo) + '</b><b>' + L.money(b.total) + '</b></div>' +
          '<div class="muted">' + esc(b.type) + ' · ' + esc(b.payment) + ' · ' + esc(b.staff) + ' · ' + b.customers + ' customer(s)</div>' +
          '<ul>' + b.lines.map(function (l) {
            return '<li>' + l.qty + ' × ' + esc(l.itemName) + ' @ ' + L.money(l.rate) + (l.discount ? ' (−' + L.money(l.discount) + ')' : '') +
              '<span>' + L.money(l.total) + '</span></li>';
          }).join('') + '</ul>' +
          (isAdmin ? '<button class="ghost red" data-delbill="' + esc(b.billNo) + '">Delete bill</button>' : '') + '</div>';
      }).join('') || '<p class="muted center">No bills for this date.</p>');
    if (isAdmin) {
      $('#s-date').onchange = function (e) { state.salesDate = e.target.value || L.todayStr(); viewSales(); };
      $('#main').onclick = async function (e) {
        const t = e.target.closest('[data-delbill]'); if (!t) return;
        if (state.role !== 'admin') return;
        const no = t.dataset.delbill;
        if (!confirm('Delete bill ' + no + '? This cannot be undone.')) return;
        const rows = (await DB.getAll('sales')).filter(function (s) { return s.billNo === no; });
        rows.forEach(function (r) { r.deleted = true; });
        await DB.putMany('sales', rows);
        toast('Bill ' + no + ' deleted'); viewSales();
      };
    }
  }

  /* ---------- Items (admin) ---------- */
  async function viewItems() {
    $('#main').innerHTML = '<div class="row between"><h2>Items</h2><button class="btn sm" id="addItem">+ Add Item</button></div>' +
      (state.items.map(function (i) {
        return '<div class="card li"><div><b>' + esc(i.name) + '</b>' + (i.active === false ? ' <span class="tag">hidden</span>' : '') +
          '<div class="muted">' + L.money(i.rate) + '</div></div><div><button class="ghost" data-edit="' + i.id + '">Edit</button> ' +
          '<button class="ghost red" data-del="' + i.id + '">Delete</button></div></div>';
      }).join('') || '<p class="muted center">No items yet.</p>');
    $('#addItem').onclick = function () { itemForm(null); };
    $('#main').onclick = async function (e) {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.edit) itemForm(state.items.find(function (i) { return i.id === t.dataset.edit; }));
      else if (t.dataset.del) {
        const it = state.items.find(function (i) { return i.id === t.dataset.del; });
        if (it && confirm('Delete "' + it.name + '"? Old bills keep their record.')) { await DB.remove('items', it.id); toast('Item deleted'); go('items'); }
      }
    };
  }
  function itemForm(item) {
    modal('<h3>' + (item ? 'Edit' : 'Add') + ' Item</h3><form id="if" class="form">' +
      '<label>Item name<input id="in" required maxlength="40" value="' + esc(item ? item.name : '') + '"></label>' +
      '<label>Rate (₹)<input id="ir" type="number" min="0" step="0.5" inputmode="decimal" required value="' + (item ? item.rate : '') + '"></label>' +
      '<label class="chk"><input type="checkbox" id="ia" ' + (item && item.active === false ? '' : 'checked') + '> Show on billing screen</label>' +
      '<div class="row"><button type="button" class="btn ghost" id="ic">Cancel</button><button class="btn">Save</button></div></form>');
    $('#ic').onclick = closeModal;
    $('#if').onsubmit = async function (e) {
      e.preventDefault();
      const name = $('#in').value.trim(), rate = Number($('#ir').value);
      if (!name) return toast('Enter item name', 1);
      if (!(rate >= 0)) return toast('Enter a valid rate', 1);
      if (state.items.some(function (i) { return i.name.toLowerCase() === name.toLowerCase() && (!item || i.id !== item.id); }))
        return toast('An item with this name already exists', 1);
      const rec = item ? Object.assign({}, item) : { order: state.items.reduce(function (m, i) { return Math.max(m, i.order || 0); }, 0) + 1 };
      rec.name = name; rec.rate = rate; rec.active = $('#ia').checked;
      await DB.put('items', rec); closeModal(); toast('Item saved'); go('items');
    };
  }

  /* ---------- Settings (admin) ---------- */
  async function viewSettings() {
    const pending = await DB.countPending();
    const hasStaffPin = !!(await DB.setting('staffPin'));
    const lastBackup = await DB.setting('lastBackup', null);
    $('#main').innerHTML = '<h2>Settings</h2>' +
      '<div class="card form"><h3>Business</h3><label>Business name<input id="s-biz" maxlength="50" value="' + esc(state.biz) + '"></label>' +
      '<label>Daily sales target (₹)<input id="s-th" type="number" min="0" inputmode="numeric" value="' + state.threshold + '"></label>' +
      '<button class="btn" id="saveBiz">Save</button></div>' +
      '<div class="card"><h3>Staff names</h3>' + (state.staff.map(function (s) {
        return '<div class="li"><span>' + esc(s.name) + '</span><button class="ghost red" data-rmstaff="' + s.id + '">Remove</button></div>';
      }).join('') || '<p class="muted">No staff added.</p>') +
      '<form id="sf" class="row"><input id="s-name" maxlength="30" placeholder="New staff name" required><button class="btn sm">Add</button></form></div>' +
      '<div class="card"><h3>PIN</h3><button class="btn ghost" id="chAdmin">Change Admin PIN</button> ' +
      '<button class="btn ghost" id="chStaff">' + (hasStaffPin ? 'Change' : 'Set') + ' Staff PIN</button> ' +
      (hasStaffPin ? '<button class="btn ghost red" id="rmStaff">Remove Staff PIN</button>' : '') +
      '<p class="muted">Staff PIN opens only New Bill and Today’s Bills.</p></div>' +
      '<div class="card"><h3>Backup &amp; Restore</h3><p class="muted">Last backup: ' + (lastBackup ? new Date(lastBackup).toLocaleString('en-IN') : 'never') + '</p>' +
      '<button class="btn" id="bk">Download Backup</button> <button class="btn ghost" id="rs">Restore from Backup</button>' +
      '<input type="file" id="rsFile" accept=".json,application/json" hidden></div>' +
      '<div class="card"><h3>Cloud sync</h3><p>Status: <b>Not built yet (Stage 2)</b></p><p class="muted">' + pending +
      ' record(s) saved on this phone are waiting to be synced once Google Sheets sync is added. Your data is safe locally; use Download Backup meanwhile.</p></div>' +
      '<button class="btn ghost red big" id="lock">Lock app</button>';
    $('#saveBiz').onclick = async function () {
      const name = $('#s-biz').value.trim(), th = Number($('#s-th').value);
      if (!name) return toast('Enter business name', 1);
      if (!(th >= 0)) return toast('Enter a valid target', 1);
      await DB.setSetting('bizName', name); await DB.setSetting('threshold', th);
      toast('Saved'); renderShell();
    };
    $('#sf').onsubmit = async function (e) {
      e.preventDefault();
      const n = $('#s-name').value.trim(); if (!n) return;
      if (state.staff.some(function (s) { return s.name.toLowerCase() === n.toLowerCase(); })) return toast('Name already exists', 1);
      await DB.put('staff', { name: n }); go('settings');
    };
    $('#main').onclick = async function (e) {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.rmstaff) {
        if (state.staff.length <= 1) return toast('Keep at least one staff name', 1);
        await DB.remove('staff', t.dataset.rmstaff); go('settings');
      }
    };
    $('#chAdmin').onclick = function () { pinForm('admin'); };
    $('#chStaff').onclick = function () { pinForm('staff'); };
    if (hasStaffPin) $('#rmStaff').onclick = async function () {
      if (!confirm('Remove the Staff PIN? Staff will not be able to log in.')) return;
      await DB.setSetting('staffPin', null); toast('Staff PIN removed'); go('settings');
    };
    $('#bk').onclick = doBackup;
    $('#rs').onclick = function () { $('#rsFile').click(); };
    $('#rsFile').onchange = doRestore;
    $('#lock').onclick = lock;
  }
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
      toast('Restored. Please unlock again.'); state.bill = null; state.cart = []; state.role = null;
      setTimeout(function () { location.reload(); }, 900);
    } catch (err) { toast('Restore failed: ' + (err.message || err), 1); }
  }

  /* ---------- Boot ---------- */
  async function boot() {
    try {
      await DB.open();
      await seedIfEmpty();
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
