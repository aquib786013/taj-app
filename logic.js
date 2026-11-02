/* Taj Fast Food Corner - pure business logic (no DOM, no database).
   Kept separate so it can be tested automatically.
   Stage 1: billing totals, dashboard.  Stage 2: stock, recipes, wastage, udhaar, profit & loss. */
(function (root) {
  'use strict';

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
  function round4(n) { return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000; }
  function live(a) { return (a || []).filter(function (x) { return !x.deleted; }); }
  function byId(a) { const m = {}; (a || []).forEach(function (x) { m[x.id] = x; }); return m; }

  // Local date as YYYY-MM-DD (NOT toISOString, which shifts the date in India at night)
  function todayStr(d) {
    d = d || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function addDays(dateStr, n) {
    const p = dateStr.split('-').map(Number);
    return todayStr(new Date(p[0], p[1] - 1, p[2] + n));
  }

  function money(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function lineTotal(qty, rate, discount) {
    return Math.max(0, round2(Number(qty) * Number(rate) - Number(discount || 0)));
  }

  // One bill = several sales rows sharing a bill id (older rows: bill number).
  function groupBills(rows) {
    const map = new Map();
    rows.forEach(function (r) {
      const key = r.billId || r.billNo;
      let b = map.get(key);
      if (!b) {
        b = { billId: r.billId || '', billNo: r.billNo, date: r.date, payment: r.payment, staff: r.staff,
              type: r.type, customers: r.customers || 0, customer: r.customer || '', lines: [], total: 0 };
        map.set(key, b);
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
    const lv = sales.filter(function (s) { return !s.deleted; });
    const month = today.slice(0, 7);
    const mSales = lv.filter(function (s) { return s.date.slice(0, 7) === month; });
    const tSales = lv.filter(function (s) { return s.date === today; });
    const sum = function (a) { return round2(a.reduce(function (x, s) { return x + s.total; }, 0)); };
    const billCount = function (a) { return new Set(a.map(function (s) { return s.billId || s.billNo; })).size; };

    const todaySale = sum(tSales), monthSale = sum(mSales);
    const monthOrders = billCount(mSales), todayOrders = billCount(tSales);

    // item quantities this month, keyed by item id (falls back to name)
    const qty = {}, names = {};
    mSales.forEach(function (s) {
      const k = s.itemId || s.itemName;
      qty[k] = (qty[k] || 0) + s.qty;
      names[k] = s.itemName;
    });
    const itemById = byId(items);

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

  /* ================= Stage 2: stock, recipes (BOM), hybrid items ================= */

  // What one unit of an item consumes. stockMode:
  //   none   - nothing is deducted
  //   recipe - made in-house: ingredients from its recipe
  //   direct - sold as bought: one linked ready item (e.g. a cold drink bottle)
  //   hybrid - both: recipe ingredients AND a linked ready item (e.g. momo + drink combo)
  function consumptionPlan(item, recipes) {
    const plan = [];
    const mode = (item && item.stockMode) || 'none';
    if (!item || mode === 'none') return plan;
    if (mode === 'recipe' || mode === 'hybrid') {
      live(recipes).filter(function (r) { return r.itemId === item.id; }).forEach(function (r) {
        plan.push({ materialId: r.materialId, qty: Number(r.qty) || 0 });
      });
    }
    if ((mode === 'direct' || mode === 'hybrid') && item.directMaterialId) {
      plan.push({ materialId: item.directMaterialId, qty: Number(item.directQty) || 1 });
    }
    return plan.filter(function (p) { return p.qty > 0; });
  }

  function planCost(plan, materials) {
    const m = byId(materials);
    return round4(plan.reduce(function (s, p) {
      return s + (m[p.materialId] ? p.qty * (Number(m[p.materialId].costPerUnit) || 0) : 0);
    }, 0));
  }

  function itemCost(item, recipes, materials) { return planCost(consumptionPlan(item, recipes), live(materials)); }

  // Stock rows + cost for the lines of one bill. Does not touch the database.
  function saleStockEffects(o) {
    const items = byId(o.items), mats = byId(live(o.materials));
    const moves = [], perRow = {};
    o.rows.forEach(function (row) {
      const plan = consumptionPlan(items[row.itemId], o.recipes);
      let cogs = 0, n = 0;
      plan.forEach(function (p) {
        const m = mats[p.materialId];
        if (!m) return;
        const q = round4(p.qty * row.qty);
        const unitCost = Number(m.costPerUnit) || 0;
        cogs += q * unitCost; n++;
        moves.push({ date: o.date, materialId: m.id, materialName: m.name, type: 'sale', qty: -q,
                     unitCost: unitCost, refId: o.billId, lineId: row.id, note: 'Bill ' + o.billNo });
      });
      perRow[row.id] = { cogs: round2(cogs), tracked: n > 0 };
    });
    return { moves: moves, perRow: perRow };
  }

  // Stock rows for wasted raw material or a wasted menu item.
  function wastageStockMoves(o) {
    const mats = byId(live(o.materials));
    const moves = [];
    let plan;
    if (o.kind === 'material') plan = [{ materialId: o.targetId, qty: 1 }];
    else plan = consumptionPlan(byId(o.items)[o.targetId], o.recipes);
    plan.forEach(function (p) {
      const m = mats[p.materialId];
      if (!m) return;
      moves.push({ date: o.date, materialId: m.id, materialName: m.name, type: 'wastage',
                   qty: -round4(p.qty * o.qty), unitCost: Number(m.costPerUnit) || 0,
                   refId: o.wastageId, note: 'Wastage: ' + o.targetName });
    });
    return moves;
  }

  // Current stock = opening stock + all movements (purchases +, sales -, wastage -, counts +/-)
  function stockLevels(materials, moves) {
    const lv = {};
    live(materials).forEach(function (m) { lv[m.id] = Number(m.opening) || 0; });
    live(moves).forEach(function (mv) { if (mv.materialId in lv) lv[mv.materialId] += Number(mv.qty) || 0; });
    Object.keys(lv).forEach(function (k) { lv[k] = round4(lv[k]); });
    return lv;
  }

  function lowStockList(materials, levels) {
    return live(materials).filter(function (m) {
      return m.active !== false && levels[m.id] <= (Number(m.lowLevel) || 0);
    });
  }

  // Opening / Purchase / Used / Wastage / Adjust / Closing for one month (YYYY-MM)
  function inventoryReport(materials, moves, ym) {
    const from = ym + '-01', to = ym + '-31';
    const mv = live(moves);
    return live(materials).map(function (m) {
      let open = Number(m.opening) || 0, buy = 0, used = 0, waste = 0, adj = 0, buyCost = 0;
      mv.filter(function (x) { return x.materialId === m.id; }).forEach(function (x) {
        const q = Number(x.qty) || 0;
        if (x.date < from) { open += q; return; }
        if (x.date > to) return;
        if (x.type === 'purchase') { buy += q; buyCost += q * (Number(x.unitCost) || 0); }
        else if (x.type === 'sale') used += -q;
        else if (x.type === 'wastage') waste += -q;
        else adj += q;
      });
      return { id: m.id, name: m.name, unit: m.unit, opening: round4(open), purchase: round4(buy), used: round4(used),
               wastage: round4(waste), adjust: round4(adj), closing: round4(open + buy - used - waste + adj),
               purchaseCost: round2(buyCost) };
    });
  }

  /* ================= Stage 2: udhaar (credit) ================= */

  function customerKey(name) { return String(name || '').trim().toLowerCase(); }

  function customerBalances(credits) {
    const map = {};
    live(credits).slice().sort(function (a, b) {
      return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    }).forEach(function (c) {
      const k = customerKey(c.customer);
      if (!k) return;
      const e = map[k] || (map[k] = { key: k, name: c.customer.trim(), phone: '', balance: 0, given: 0, received: 0, lastDate: '' });
      const amt = Number(c.amount) || 0;
      if (c.entryType === 'payment') { e.balance -= amt; e.received += amt; } else { e.balance += amt; e.given += amt; }
      e.name = c.customer.trim();
      if (c.phone) e.phone = c.phone;
      e.lastDate = c.date;
    });
    return Object.keys(map).map(function (k) {
      const e = map[k]; e.balance = round2(e.balance); e.given = round2(e.given); e.received = round2(e.received); return e;
    }).sort(function (a, b) { return b.balance - a.balance; });
  }

  function udhaarOutstanding(credits) {
    return round2(customerBalances(credits).reduce(function (s, c) { return s + Math.max(0, c.balance); }, 0));
  }

  /* ================= Stage 2: wastage ================= */

  function wastageSummary(wastage, monthSales, today) {
    const w = live(wastage);
    const sum = function (a) { return round2(a.reduce(function (s, x) { return s + (Number(x.totalLoss) || 0); }, 0)); };
    const month = today.slice(0, 7), weekFrom = addDays(today, -6);
    const mW = w.filter(function (x) { return x.date.slice(0, 7) === month; });
    const byName = {};
    mW.forEach(function (x) { byName[x.targetName] = round2((byName[x.targetName] || 0) + (Number(x.totalLoss) || 0)); });
    const items = Object.keys(byName).map(function (n) { return { name: n, loss: byName[n] }; })
      .sort(function (a, b) { return b.loss - a.loss; });
    const monthLoss = sum(mW);
    return {
      today: sum(w.filter(function (x) { return x.date === today; })),
      week: sum(w.filter(function (x) { return x.date >= weekFrom && x.date <= today; })),
      month: monthLoss,
      pct: monthSales > 0 ? round2(monthLoss / monthSales * 100) : 0,
      byItem: items, highest: items[0] || null
    };
  }

  /* ================= Stage 2: profit & loss ================= */

  function monthRange(ym) { return { from: ym + '-01', to: ym + '-31' }; }

  // Net profit = Sales - raw material cost (recipe cost saved on each bill line)
  //              - operating expenses - wastage loss.
  // Purchases are NOT subtracted (that would count the same material twice).
  function profitReport(d, from, to) {
    const inR = function (x) { return x.date >= from && x.date <= to; };
    const sales = live(d.sales).filter(inR);
    const exps = live(d.expenses).filter(inR);
    const wst = live(d.wastage).filter(inR);
    const sum = function (a, f) { return round2(a.reduce(function (s, x) { return s + (Number(f(x)) || 0); }, 0)); };

    const totalSales = sum(sales, function (s) { return s.total; });
    const cogs = sum(sales, function (s) { return s.cogs; });
    const untracked = sum(sales.filter(function (s) { return !s.tracked; }), function (s) { return s.total; });
    const expenses = sum(exps, function (e) { return e.amount; });
    const wastage = sum(wst, function (w) { return w.totalLoss; });
    const gross = round2(totalSales - cogs);
    const net = round2(gross - expenses - wastage);

    const cat = {};
    exps.forEach(function (e) { cat[e.category] = round2((cat[e.category] || 0) + (Number(e.amount) || 0)); });
    const byCategory = Object.keys(cat).map(function (k) { return { category: k, amount: cat[k] }; })
      .sort(function (a, b) { return b.amount - a.amount; });

    const mv = live(d.stockMoves).filter(function (m) { return inR(m) && m.type === 'purchase'; });
    const cr = live(d.credits).filter(inR);
    return {
      from: from, to: to,
      bills: new Set(sales.map(function (s) { return s.billId || s.billNo; })).size,
      sales: totalSales, discount: sum(sales, function (s) { return s.discount; }),
      udhaarSales: sum(sales.filter(function (s) { return s.payment === 'Credit'; }), function (s) { return s.total; }),
      cogs: cogs, gross: gross, expenses: expenses, byCategory: byCategory, wastage: wastage, net: net,
      pct: totalSales > 0 ? round2(net / totalSales * 100) : 0,
      untrackedSales: untracked,
      purchases: round2(mv.reduce(function (s, m) { return s + (Number(m.qty) || 0) * (Number(m.unitCost) || 0); }, 0)),
      udhaarGiven: sum(cr.filter(function (c) { return c.entryType !== 'payment'; }), function (c) { return c.amount; }),
      udhaarCollected: sum(cr.filter(function (c) { return c.entryType === 'payment'; }), function (c) { return c.amount; })
    };
  }

  function dashboardExtra(d, today) {
    const month = monthRange(today.slice(0, 7));
    const pl = profitReport(d, month.from, month.to);
    const levels = stockLevels(d.materials, d.stockMoves);
    return {
      monthExpenses: pl.expenses, monthNet: pl.net, monthWastage: pl.wastage,
      lowStock: lowStockList(d.materials, levels),
      udhaar: udhaarOutstanding(d.credits)
    };
  }

  const api = { round2: round2, round4: round4, todayStr: todayStr, addDays: addDays, money: money, lineTotal: lineTotal,
                groupBills: groupBills, nextBillNo: nextBillNo, dashboard: dashboard,
                consumptionPlan: consumptionPlan, itemCost: itemCost, saleStockEffects: saleStockEffects,
                wastageStockMoves: wastageStockMoves, stockLevels: stockLevels, lowStockList: lowStockList,
                inventoryReport: inventoryReport, customerBalances: customerBalances, customerKey: customerKey,
                udhaarOutstanding: udhaarOutstanding, wastageSummary: wastageSummary, monthRange: monthRange,
                profitReport: profitReport, dashboardExtra: dashboardExtra };
  root.Logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
