// Demo users and sample data (loaded only on an empty database).
const seedUsers = [
  { id: 'u_owner', name: 'Owner', username: 'owner', pin: '1234', role: 'owner' },
  { id: 'u_ali', name: 'Ali (Order Taker)', username: 'ali', pin: '1111', role: 'taker' },
];

function seedEvents() {
  const U = Object.fromEntries(seedUsers.map(u => [u.role, u]));
  U.dispatch = U.owner; // owner does dispatching
  const ev = [];
  let k = 0, oc = 0, ctr = 1000, s = 11;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const sum = (a, f) => a.reduce((x, y) => x + f(y), 0);
  const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const now = Date.now();
  const add = (t, p, role, ts) => { const id = 'seed' + (k++); ev.push({ id, t, p, ts, by: U[role].id, byName: U[role].name, byRole: role }); return id; };
  const T0 = sod(now) - 7 * 864e5;
  const VEH = ['Suzuki Pickup HDA-4521', 'Shehzore HDB-889', 'Loader Rickshaw HDC-212'];

  const P = [
    ['p1', 'Dalda Cooking Oil 1L', 'ctn (12)', 6000, 6240, 6480, 140],
    ['p2', 'Tapal Danedar 950g', 'ctn (12)', 17400, 17950, 18600, 90],
    ['p3', 'Surf Excel 1kg', 'ctn (12)', 6900, 7180, 7560, 95],
    ['p4', 'Lifebuoy Soap 98g', 'box (72)', 6700, 6950, 7200, 80],
    ['p5', 'Nestle Milkpak 1L', 'ctn (12)', 3480, 3600, 3780, 150],
    ['p6', 'National Salt 800g', 'bag (24)', 1500, 1620, 1800, 120],
    ['p7', 'Shan Biryani Masala', 'box (12)', 1560, 1650, 1800, 7],
    ['p8', 'Sooper Biscuit', 'ctn (24)', 1080, 1150, 1200, 160],
    ['p9', 'Pepsi 1.5L', 'crate (6)', 1260, 1320, 1440, 5],
    ['p10', 'Basmati Rice 5kg', 'bag', 1650, 1750, 1900, 110],
  ];
  add('settings', { bizName: 'Bhawan Das Traders', address: 'Resham Gali, Hyderabad, Sindh', phone: '022-2780000', footer: 'Thank you for your business' }, 'owner', T0 - 1);
  P.push(['p11', 'Banaspati Ghee 2.5kg', 'tin', 1300, 1360, 1420, 0]);
  P.forEach(([id, name, unit, cost, w, r, stock], i) => add('product', { id, name, unit, cost, w, r, stock }, 'owner', T0 + i));
  const C = [
    ['c1', 'Lal Chand Karyana Store', 'Latifabad No. 7', '0300-3012345', 42500],
    ['c2', 'Memon General Store', 'Hirabad', '0321-3654321', 18000],
    ['c3', 'Sindh Super Mart', 'Qasimabad', '0333-2655667', 96000],
    ['c4', 'Abbasi Kiryana', 'Paretabad', '0345-3988776', 0],
    ['c5', 'Kishore Kumar & Sons', 'Shahi Bazaar', '0301-3233445', 27500],
    ['c6', 'Qasimabad Mart', 'Qasimabad Phase 1', '0312-3677889', 61200],
  ];
  C.forEach(([id, name, area, phone, ob], i) => {
    add('customer', { id, name, area, phone, type: 'shop' }, 'owner', T0 + 100 + i);
    if (ob) add('opening', { cid: id, amt: ob }, 'owner', T0 + 200 + i);
  });
  add('customer', { id: 'c7', name: 'Ramesh Kumar', area: 'Counter customer', phone: '0302-3112223', type: 'retail' }, 'owner', T0 + 120);
  add('customer', { id: 'c8', name: 'Ghulam Rasool', area: 'Counter customer', phone: '0306-3445556', type: 'retail' }, 'owner', T0 + 121);
  add('cash_open', { amt: 185000 }, 'owner', T0 + 300);
  // suppliers
  add('supplier', { id: 's1', name: 'Sindh Ghee Mills', phone: '022-3870123', city: 'Kotri' }, 'owner', T0 + 400);
  add('supplier', { id: 's2', name: 'Hassan Enterprises', phone: '021-32556667', city: 'Karachi' }, 'owner', T0 + 401);
  add('supplier', { id: 's3', name: 'Rafiq & Sons Tea House', phone: '022-2778889', city: 'Hyderabad' }, 'owner', T0 + 402);
  add('sopening', { sid: 's2', amt: 45000 }, 'owner', T0 + 410);
  add('purchase', { id: 'pu1', no: 'PO-1001', sid: 's1', items: [{ pid: 'p11', qty: 60, cost: 1300 }], total: 78000, paid: 50000, method: 'Cash', note: '' }, 'owner', sod(now) - 4 * 864e5 + 11 * 36e5);
  add('purchase', { id: 'pu2', no: 'PO-1002', sid: 's3', items: [{ pid: 'p2', qty: 10, cost: 17400 }], total: 174000, paid: 100000, method: 'Bank Transfer', note: '' }, 'owner', sod(now) - 3 * 864e5 + 11 * 36e5);
  add('purchase', { id: 'pu3', no: 'PO-1003', sid: 's2', items: [{ pid: 'p3', qty: 12, cost: 6900 }, { pid: 'p4', qty: 8, cost: 6700 }], total: 136400, paid: 136400, method: 'Cash', note: '' }, 'owner', sod(now) - 2 * 864e5 + 11 * 36e5);
  add('supplier_pay', { sid: 's3', amt: 40000, method: 'JazzCash', note: 'Part payment' }, 'owner', sod(now) - 1 * 864e5 + 13 * 36e5);
  let cs = 2000;

  const mk = (ts, cid, status) => {
    const items = [], used = new Set();
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const pid = pick(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p8', 'p10']);
      if (used.has(pid)) continue; used.add(pid);
      const pr = P.find(x => x[0] === pid);
      items.push({ pid, qty: 1 + Math.floor(rnd() * 4), rate: pr[4] });
    }
    const total = sum(items, i => i.qty * i.rate);
    const id = 'so' + (oc++), no = 'ALI-' + (++ctr);
    add('order', { id, no, cid, items, total, rateType: 'w', note: '' }, 'taker', ts);
    if (status !== 'pending') add('status', { oid: id, status: 'dispatched', vehicle: pick(VEH) }, 'dispatch', ts + 2 * 36e5);
    if (status === 'delivered') {
      add('status', { oid: id, status: 'delivered' }, 'dispatch', ts + 4 * 36e5);
      if (rnd() < 0.65) add('payment', { cid, amt: Math.round(total * (rnd() < 0.5 ? 1 : 0.5) / 100) * 100, method: 'Cash', note: 'Collected on delivery ' + no }, 'dispatch', ts + 4 * 36e5 + 1);
    }
  };
  for (let d = 6; d >= 1; d--) {
    const day = sod(now) - d * 864e5;
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) mk(day + 9.5 * 36e5 + i * 75 * 6e4, pick(C)[0], 'delivered');
    add('expense', { cat: 'Fuel', desc: 'Pickup diesel', amt: 3000 + Math.floor(rnd() * 4) * 500 }, 'owner', day + 18 * 36e5);
    add('expense', { cat: 'Loading / Labour', desc: 'Loading labour', amt: 1500 }, 'owner', day + 18 * 36e5 + 1);
    add('counter', { id: 'cs' + d, no: 'CS-' + (++cs), items: [{ pid: 'p5', qty: 2, rate: 3780 }, { pid: 'p8', qty: 1, rate: 1200 }], total: 2 * 3780 + 1200, paid: 2 * 3780 + 1200, method: 'Cash', cust: 'Walk-in' }, 'owner', day + 15 * 36e5);
    if (d % 2 === 0) add('counter', { id: 'csr' + d, no: 'CS-' + (++cs), cid: d === 4 ? 'c7' : 'c8', cust: '', items: [{ pid: 'p11', qty: 3, rate: 1420 }, { pid: 'p1', qty: 1, rate: 6480 }], total: 3 * 1420 + 6480, paid: 5000, method: 'Cash' }, 'owner', day + 16 * 36e5);
    if (rnd() < 0.5) { const pid = add('payment', { cid: pick(C)[0], amt: 5000 + Math.floor(rnd() * 6) * 2500, method: 'JazzCash', note: 'Recovery' }, 'taker', day + 12 * 36e5); add('pay_review', { payId: pid, ok: true }, 'owner', day + 19 * 36e5); }
  }
  add('expense', { cat: 'Salary', desc: 'Weekly wages — helpers', amt: 28000 }, 'owner', sod(now) - 3 * 864e5 + 19 * 36e5);
  mk(now - 8 * 36e5, 'c3', 'delivered');
  mk(now - 7 * 36e5, 'c1', 'delivered');
  mk(now - 5 * 36e5, 'c6', 'dispatched');
  mk(now - 3 * 36e5, 'c2', 'pending');
  mk(now - 2 * 36e5, 'c5', 'pending');
  mk(now - 40 * 6e4, 'c4', 'pending');
  add('payment', { cid: 'c6', amt: 15000, method: 'Cash', note: 'Recovery' }, 'taker', now - 90 * 6e4);
  return ev.sort((a, b) => a.ts - b.ts);
}

module.exports = { seedUsers, seedEvents };
