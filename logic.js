/* Taj Fast Food Corner - pure business logic (no DOM, no database).
   Kept separate so it can be tested automatically. */
(function (root) {
  'use strict';

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  // Local date as YYYY-MM-DD (NOT toISOString, which shifts the date in India at night)
  function todayStr(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function money(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function lineTotal(qty, rate, discount) {
    return Math.max(0, round2(Number(qty) * Number(rate) - Number(discount || 0)));
  }

  // One bill = several sales rows sharing a bill number.
  function groupBills(rows) {
    const map = new Map();
    rows.forEach(function (r) {
      let b = map.get(r.billNo);
      if (!b) {
        b = { billNo: r.billNo, date: r.date, payment: r.payment, staff: r.staff,
              type: r.type, customers: r.customers || 0, lines: [], total: 0 };
        map.set(r.billNo, b);
      }
      b.lines.push(r);
      b.total = round2(b.total + r.total);
    });
    return Array.from(map.values()).sort(function (a, b) {
      return String(b.billNo).localeCompare(String(a.billNo));
    });
  }

  // Next bill number: highest existing + 1 (deleted rows included so numbers are never reused)
  function nextBillNo(rows) {
    let max = 0;
    rows.forEach(function (r) {
      const m = /^B(\d+)$/.exec(r.billNo || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'B' + String(max + 1).padStart(4, '0');
  }

  function dashboard(sales, items, today, threshold) {
    const live = sales.filter(function (s) { return !s.deleted; });
    const month = today.slice(0, 7);
    const mSales = live.filter(function (s) { return s.date.slice(0, 7) === month; });
    const tSales = live.filter(function (s) { return s.date === today; });
    const sum = function (a) { return round2(a.reduce(function (x, s) { return x + s.total; }, 0)); };
    const billCount = function (a) { return new Set(a.map(function (s) { return s.billNo; })).size; };

    const todaySale = sum(tSales), monthSale = sum(mSales);
    const monthOrders = billCount(mSales), todayOrders = billCount(tSales);

    // item quantities this month, keyed by item id (falls back to name)
    const qty = {}, names = {};
    mSales.forEach(function (s) {
      const k = s.itemId || s.itemName;
      qty[k] = (qty[k] || 0) + s.qty;
      names[k] = s.itemName;
    });
    const itemById = {};
    items.forEach(function (i) { itemById[i.id] = i; });

    let best = null;
    Object.keys(qty).forEach(function (k) {
      if (!best || qty[k] > best.qty) best = { name: (itemById[k] ? itemById[k].name : names[k]), qty: qty[k] };
    });

    let weak = null;
    if (mSales.length) {
      items.filter(function (i) { return !i.deleted && i.active !== false; }).forEach(function (i) {
        const q = qty[i.id] || 0;
        if (!weak || q < weak.qty) weak = { name: i.name, qty: q };
      });
    }

    const byDay = {};
    mSales.forEach(function (s) { byDay[s.date] = round2((byDay[s.date] || 0) + s.total); });
    const days = Object.keys(byDay);
    const daysBelow = days.filter(function (d) { return byDay[d] < threshold; }).length;

    return {
      todaySale: todaySale, monthSale: monthSale,
      todayOrders: todayOrders, monthOrders: monthOrders,
      avgBill: monthOrders ? round2(monthSale / monthOrders) : 0,
      best: best, weak: weak,
      threshold: threshold,
      todayBelow: tSales.length > 0 && todaySale < threshold,
      shortfall: round2(Math.max(0, threshold - todaySale)),
      daysTotal: days.length, daysBelow: daysBelow
    };
  }

  const api = { round2: round2, todayStr: todayStr, money: money, lineTotal: lineTotal,
                groupBills: groupBills, nextBillNo: nextBillNo, dashboard: dashboard };
  root.Logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
