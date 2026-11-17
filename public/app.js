/* TradeBook client — offline-first.
   Every change is an "event" saved on the phone first (outbox), then pushed to the
   server when internet is available. The screen is rebuilt from all events. */

const ROLE = {
  owner: { label: 'Owner', icon: '📊' },
  dispatch: { label: 'Dispatcher', icon: '🚚' },
  taker: { label: 'Order Taker', icon: '🧾' },
};
const TABS = {
  taker: [['today', 'Today', '🏠'], ['new', 'New Order', '➕'], ['shops', 'Shops', '🏪'], ['mine', 'My Orders', '🧾']],
  dispatch: [['queue', 'To Dispatch', '📦'], ['route', 'On Route', '🚚'], ['shops', 'Khata', '📒'], ['stock', 'Stock', '🏬']],
  owner: [['dash', 'Home', '📊'], ['orders', 'Dispatch', '🚚'], ['shops', 'Khata', '📒'], ['cash', 'Cash Book', '💵'], ['stock', 'Stock', '🏬']],
};
const VEHICLES = ['Suzuki Pickup LES-4521', 'Shehzore FSD-889', 'Loader Rickshaw FDA-212', 'Bike'];
const STATUS = { pending: 'Pending', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const METHODS = ['Cash', 'JazzCash', 'EasyPaisa', 'Bank Transfer', 'Cheque'];

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const rs = n => 'Rs ' + Math.round(n || 0).toLocaleString('en-PK');
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const isToday = t => sod(t) === sod(now());
const fmtT = t => new Date(t).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
const fmtD = t => isToday(t) ? 'Today ' + fmtT(t) : new Date(t).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) + ' ' + fmtT(t);
const ago = t => { if (!t) return 'never'; const s = (now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hr ago'; return Math.floor(s / 86400) + ' days ago'; };
const empty = m => `<div class="empty">${m}</div>`;
const jget = k => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('⚠️ Phone storage full — please sync and contact admin'); return false; } };

/* ---------- state ---------- */
let sess = jget('tb_sess');           // {token, user}
let D = null;                          // {events, seq, outbox, ctr, lastSync, users}
const ui = { tab: null, cart: {}, shop: '', rate: 'w', q: '', note: '', filter: 'all', syncing: false, online: navigator.onLine, sheet: null, ccart: {}, ccust: '', busy: false };
const me = () => sess.user;
const role = () => sess.user.role;
const dkey = () => 'tb_data_' + sess.user.id;
function loadData() { D = jget(dkey()) || { events: [], seq: 0, outbox: [], ctr: 0, lastSync: 0, users: [] }; }
function saveData() { jset(dkey(), D); }
const isOnline = () => navigator.onLine && ui.online;

/* ---------- rebuild state from events ---------- */
function view() { return build(D.events.concat(D.outbox.map(e => ({ ...e, _p: 1 })))); }
function profit(items, S) { return sum(items, i => { const p = S.products[i.pid]; return p ? (i.rate - p.cost) * i.qty : 0; }); }
function build(evs) {
  const S = { products: {}, customers: {}, orders: {}, ledger: [], cash: [], sales: [] };
  for (const e of [...evs].sort((a, b) => a.ts - b.ts)) {
    const p = e.p, pend = !!e._p;
    switch (e.t) {
      case 'product': S.products[p.id] = { ...p, pend }; break;
      case 'stock_in': {
        const pr = S.products[p.pid]; if (!pr) break;
        pr.stock += p.qty; if (p.cost) pr.cost = p.cost;
        S.cash.push({ ts: e.ts, type: 'out', cat: 'Purchase', desc: `${pr.name} × ${p.qty} — ${p.supplier || 'Supplier'}`, amt: p.qty * (p.cost || pr.cost), pend, byName: e.byName });
        break;
      }
      case 'customer': S.customers[p.id] = { ...p, bal: 0, pend }; break;
      case 'opening': { const c = S.customers[p.cid]; if (c) { c.bal += p.amt; S.ledger.push({ ts: e.ts, cid: p.cid, desc: 'Opening balance', dr: p.amt, cr: 0, pend }); } break; }
      case 'cash_open': S.cash.push({ ts: e.ts, type: 'in', cat: 'Opening', desc: 'Opening cash in hand', amt: p.amt, pend }); break;
      case 'order': S.orders[p.id] = { ...p, status: 'pending', by: e.by, byName: e.byName, ts: e.ts, pend, hist: [{ s: 'pending', ts: e.ts, byName: e.byName, pend }] }; break;
      case 'status': {
        const o = S.orders[p.oid]; if (!o || o.status === p.status) break;
        if (p.status === 'cancelled' && o.status !== 'pending') break;
        if (p.status === 'delivered' && o.status !== 'dispatched') break;
        if (p.status === 'dispatched') {
          if (o.status !== 'pending') break;
          o.items.forEach(i => { const pr = S.products[i.pid]; if (pr) pr.stock -= i.qty; });
          const c = S.customers[o.cid]; if (c) c.bal += o.total;
          S.ledger.push({ ts: e.ts, cid: o.cid, desc: `Bill ${o.no}`, oid: o.id, dr: o.total, cr: 0, pend });
          S.sales.push({ ts: e.ts, amt: o.total, profit: profit(o.items, S), kind: 'wholesale' });
          o.vehicle = p.vehicle;
        }
        o.status = p.status; o.hist.push({ s: p.status, ts: e.ts, byName: e.byName, pend }); if (pend) o.pend = true;
        break;
      }
      case 'payment': {
        const c = S.customers[p.cid]; if (c) c.bal -= p.amt;
        S.ledger.push({ ts: e.ts, cid: p.cid, desc: (p.note || 'Payment received') + (p.method ? ` (${p.method})` : ''), dr: 0, cr: p.amt, pend, byName: e.byName });
        S.cash.push({ ts: e.ts, type: 'in', cat: 'Recovery', desc: `${c ? c.name : ''} — ${p.note || 'Payment'}${p.method ? ' · ' + p.method : ''}`, amt: p.amt, pend, by: e.by, byName: e.byName });
        break;
      }
      case 'expense': S.cash.push({ ts: e.ts, type: 'out', cat: p.cat, desc: p.desc, amt: p.amt, pend, byName: e.byName }); break;
      case 'counter': {
        const pf = profit(p.items, S);
        p.items.forEach(i => { const pr = S.products[i.pid]; if (pr) pr.stock -= i.qty; });
        S.cash.push({ ts: e.ts, type: 'in', cat: 'Counter Sale', desc: (p.cust || 'Walk-in') + ': ' + p.items.map(i => (S.products[i.pid] || {}).name + ' ×' + i.qty).join(', '), amt: p.total, pend, byName: e.byName });
        S.sales.push({ ts: e.ts, amt: p.total, profit: pf, kind: 'retail' });
        break;
      }
    }
  }
  return S;
}

/* ---------- server calls & sync ---------- */
async function api(path, body, method) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(sess ? { Authorization: 'Bearer ' + sess.token } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error(j.error || 'HTTP ' + r.status); err.status = r.status; throw err; }
    return j;
  } finally { clearTimeout(to); }
}

async function sync(manual) {
  if (!sess || ui.syncing) return;
  if (!navigator.onLine) { ui.online = false; if (manual) toast('📴 No internet — data is safe on this phone', 'off'); render(); return; }
  ui.syncing = true; render();
  const sending = D.outbox.slice(0, 500);
  try {
    const j = await api('/api/sync', { since: D.seq, events: sending });
    const have = new Set(D.events.map(e => e.id));
    const fresh = j.events.filter(e => !have.has(e.id));
    D.events.push(...fresh);
    D.seq = j.seq;
    const sent = new Set(sending.map(e => e.id));
    D.outbox = D.outbox.filter(e => !sent.has(e.id));
    D.users = j.users; D.lastSync = now();
    sess.user = j.me; jset('tb_sess', sess);
    ui.online = true; saveData();
    if (sending.length) toast(`☁️ ${sending.length} record${sending.length > 1 ? 's' : ''} synced`, 'ok');
    else if (manual) toast('✓ Up to date', 'ok');
    if (j.rejected && j.rejected.length) toast(`⚠️ ${j.rejected.length} record(s) not allowed for your role`);
    const newOrders = fresh.filter(e => e.t === 'order' && e.by !== me().id).length;
    if (newOrders && role() !== 'taker' && D.lastSync) toast(`📥 ${newOrders} new order${newOrders > 1 ? 's' : ''} received`, 'ok');
  } catch (e) {
    if (e.status === 401) { ui.syncing = false; toast('Session expired — please log in again'); logout(true); return; }
    ui.online = false;
    if (manual) toast('Could not reach server — data stays on this phone', 'off');
  }
  ui.syncing = false; render();
  if (D.outbox.length && ui.online) setTimeout(sync, 300);
}
setInterval(() => sync(), 10000);
window.addEventListener('online', () => { ui.online = true; toast('📶 Internet back — syncing…', 'ok'); sync(); });
window.addEventListener('offline', () => { ui.online = false; toast('📴 Internet lost. Keep working — data is saved on this phone.', 'off'); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });

function emit(t, p) {
  const e = { id: uid(), t, p, ts: now(), by: me().id, byName: me().name, byRole: role() };
  D.outbox.push(e); saveData(); render();
  if (!isOnline()) toast('📴 Saved on this phone — will sync automatically', 'off');
  sync();
}

/* ---------- auth ---------- */
async function login(ev) {
  ev.preventDefault();
  const username = val('lu').trim().toLowerCase(), pin = val('lp');
  if (!username || !pin) return;
  ui.busy = true; render();
  try {
    sess = null;
    const j = await api('/api/login', { username, pin });
    sess = j; jset('tb_sess', sess); loadData(); ui.tab = null;
    ui.busy = false; render(); sync();
  } catch (e) {
    ui.busy = false; render();
    toast(e.status === 401 ? '❌ Wrong username or PIN' : '📴 Internet is needed for the first login', 'off');
  }
}
function logout(force) {
  if (!force && D && D.outbox.length) { openSheet({ type: 'logoutwarn' }); return; }
  try { localStorage.removeItem('tb_sess'); } catch (e) {}
  sess = null; D = null; ui.sheet = null; drawSheet(); render();
}

/* ---------- UI actions ---------- */
function go(t) { ui.tab = t; ui.filter = t === 'orders' ? 'pending' : 'all'; render(); window.scrollTo(0, 0); }
function toast(m, c) { const el = document.createElement('div'); el.className = 't ' + (c || ''); el.textContent = m; document.getElementById('toast').appendChild(el); setTimeout(() => el.remove(), 3200); }
function qty(pid, dl) { const q = Math.max(0, (ui.cart[pid] || 0) + dl); if (q) ui.cart[pid] = q; else delete ui.cart[pid]; render(); }
function filterRows(v, sel) { ui.q = v; const q = v.toLowerCase(); document.querySelectorAll(sel).forEach(r => r.style.display = r.dataset.n.includes(q) ? '' : 'none'); }
function nextNo() {
  const pre = me().username.toUpperCase().slice(0, 4);
  const used = D.events.concat(D.outbox).filter(e => e.t === 'order' && String(e.p.no).startsWith(pre + '-')).map(e => parseInt(String(e.p.no).split('-')[1]) || 0);
  D.ctr = Math.max(D.ctr || 1000, ...used) + 1;
  return pre + '-' + D.ctr;
}
function saveOrder() {
  const S = view();
  if (!ui.shop) { toast('Please select a shop first'); return; }
  const items = Object.entries(ui.cart).map(([pid, qty]) => { const p = S.products[pid]; return { pid, qty, rate: ui.rate === 'w' ? p.w : p.r }; });
  if (!items.length) { toast('Add at least one product'); return; }
  const total = sum(items, i => i.qty * i.rate), no = nextNo(), online = isOnline();
  emit('order', { id: uid(), no, cid: ui.shop, items, total, rateType: ui.rate, note: ui.note });
  if (online) toast(`✅ Order ${no} saved — sent to dispatch`, 'ok');
  ui.cart = {}; ui.shop = ''; ui.note = ''; ui.q = ''; go('today');
}
function setStatus(oid, status, extra) { emit('status', { oid, status, ...(extra || {}) }); }

/* ---------- components ---------- */
function orderCard(o, S, actions) {
  const c = S.customers[o.cid] || {};
  return `<div class="card click" onclick="openSheet({type:'order',oid:'${o.id}'})">
  <div class="row"><b>${esc(c.name)}</b><span class="badge ${o.status}">${STATUS[o.status]}</span></div>
  <div class="muted">${esc(o.no)} · ${esc(c.area)} · ${fmtD(o.ts)}${role() !== 'taker' ? ' · ' + esc(o.byName || '') : ''} ${o.pend ? '<span class="pendtag">· ⏳ not synced</span>' : ''}</div>
  <div class="items">${o.items.map(i => `${esc((S.products[i.pid] || {}).name)} <b>×${i.qty}</b>`).join(' · ')}</div>
  <div class="row"><b style="font-size:16px">${rs(o.total)}</b><span onclick="event.stopPropagation()">${actions || ''}</span></div></div>`;
}
function chips(opts) { return `<div class="chips">${opts.map(([k, l]) => `<button class="chip ${ui.filter === k ? 'act' : ''}" onclick="ui.filter='${k}';render()">${l}</button>`).join('')}</div>`; }
const kpi = (l, v, cls) => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls || ''}">${v}</div></div>`;
const cashBal = S => sum(S.cash, c => c.type === 'in' ? c.amt : -c.amt);

/* ---------- screens ---------- */
const V = {
  today(S) {
    const mine = Object.values(S.orders).filter(o => o.by === me().id && isToday(o.ts)).sort((a, b) => b.ts - a.ts);
    const rec = sum(S.cash.filter(c => c.cat === 'Recovery' && c.by === me().id && isToday(c.ts)), c => c.amt);
    return `<div class="kpis">${kpi('Orders today', mine.length)}${kpi('Order value', rs(sum(mine, o => o.total)))}${kpi('Recovery collected', rs(rec))}${kpi('Waiting to sync', D.outbox.length, D.outbox.length ? 'red' : '')}</div>
    <button class="btn block" style="margin-top:12px" onclick="go('new')">+ Take New Order</button>
    <h2>Today's orders</h2>${mine.map(o => orderCard(o, S)).join('') || empty('No orders yet today')}`;
  },
  new(S) {
    const shops = Object.values(S.customers).sort((a, b) => a.name.localeCompare(b.name));
    const prods = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name));
    const items = Object.entries(ui.cart).filter(([pid]) => S.products[pid]);
    const tot = sum(items, ([pid, q]) => { const p = S.products[pid]; return q * (ui.rate === 'w' ? p.w : p.r); });
    const n = sum(items, x => x[1]); const c = S.customers[ui.shop]; const qq = ui.q.toLowerCase();
    return `<label style="margin-top:0">Shop / Customer</label>
    <select onchange="ui.shop=this.value;render()"><option value="">Select shop…</option>${shops.map(c => `<option value="${c.id}" ${ui.shop === c.id ? 'selected' : ''}>${esc(c.name)} — ${esc(c.area)}</option>`).join('')}</select>
    <div class="row" style="margin-top:6px"><span class="muted">${c ? `Previous balance: <b class="${c.bal > 0 ? 'red' : ''}">${rs(c.bal)}</b>` : ''}</span><button class="btn sm alt" onclick="openSheet({type:'addshop',fromOrder:1})">+ New shop</button></div>
    <label>Rate list</label><div class="seg"><button class="${ui.rate === 'w' ? 'act' : ''}" onclick="ui.rate='w';render()">Wholesale</button><button class="${ui.rate === 'r' ? 'act' : ''}" onclick="ui.rate='r';render()">Retail</button></div>
    <label>Products</label><input id="psearch" placeholder="Search product…" value="${esc(ui.q)}" oninput="filterRows(this.value,'.prod')">
    <div class="card" style="padding:2px 14px;margin-top:8px">${prods.map(p => {
      const q = ui.cart[p.id] || 0; const rate = ui.rate === 'w' ? p.w : p.r;
      return `<div class="prod" data-n="${esc(p.name.toLowerCase())}" style="${p.name.toLowerCase().includes(qq) ? '' : 'display:none'}"><div><div class="pn">${esc(p.name)}</div><div class="muted">${rs(rate)} / ${esc(p.unit)} · <span class="${p.stock < 10 ? 'red' : ''}">stock ${p.stock}</span></div>${q > p.stock ? '<div class="muted red">More than available stock</div>' : ''}</div>
      <div class="step"><button onclick="qty('${p.id}',-1)">−</button><span>${q}</span><button onclick="qty('${p.id}',1)">+</button></div></div>`;
    }).join('')}</div>
    <label>Note (optional)</label><input id="onote" placeholder="e.g. deliver before 2pm" value="${esc(ui.note)}" oninput="ui.note=this.value">
    <div style="height:80px"></div>
    <div class="cartbar"><div><div class="muted" style="margin:0">${n} unit(s) · ${ui.rate === 'w' ? 'Wholesale' : 'Retail'}</div><b style="font-size:18px">${rs(tot)}</b></div>
    <button class="btn" onclick="saveOrder()" ${n ? '' : 'disabled'}>Save Order</button></div>`;
  },
  shops(S) {
    const list = Object.values(S.customers).sort((a, b) => b.bal - a.bal);
    return `<div class="card row"><div><div class="muted" style="margin:0">Total receivable (udhaar)</div><div style="font-size:21px;font-weight:700" class="red">${rs(sum(list, c => c.bal))}</div><div class="muted">${list.length} customers</div></div><button class="btn sm alt" onclick="openSheet({type:'addshop'})">+ Add Shop</button></div>
    <input placeholder="Search shop or area…" oninput="filterRows(this.value,'.li')" style="margin-bottom:10px">
    ${list.map(c => `<div class="card row click li" data-n="${esc((c.name + ' ' + c.area).toLowerCase())}" onclick="openSheet({type:'shop',cid:'${c.id}'})">
      <div><b>${esc(c.name)}</b>${c.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${esc(c.area)} · ${esc(c.phone)}</div></div>
      <div style="text-align:right"><b class="${c.bal > 0 ? 'red' : 'green'}">${rs(c.bal)}</b><div class="muted">${c.bal > 0 ? 'to receive' : c.bal < 0 ? 'advance' : 'clear'}</div></div></div>`).join('') || empty('No shops yet')}`;
  },
  mine(S) {
    let l = Object.values(S.orders).filter(o => o.by === me().id).sort((a, b) => b.ts - a.ts);
    if (ui.filter !== 'all') l = l.filter(o => o.status === ui.filter);
    return chips([['all', 'All'], ['pending', 'Pending'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered']]) + (l.slice(0, 100).map(o => orderCard(o, S)).join('') || empty('No orders'));
  },
  queue(S) {
    const q = Object.values(S.orders).filter(o => o.status === 'pending').sort((a, b) => a.ts - b.ts);
    return `<div class="kpis">${kpi('Orders waiting', q.length)}${kpi('Value to dispatch', rs(sum(q, o => o.total)))}</div>
    ${!isOnline() ? '<div class="warn">📴 Offline — new orders from order takers will appear when internet returns.</div>' : ''}
    <h2>Oldest first</h2>${q.map(o => orderCard(o, S, `<button class="btn sm" onclick="openSheet({type:'dispatch',oid:'${o.id}'})">Dispatch →</button>`)).join('') || empty('All caught up 🎉 No pending orders')}`;
  },
  route(S) {
    const r = Object.values(S.orders).filter(o => o.status === 'dispatched').sort((a, b) => a.ts - b.ts);
    const dd = Object.values(S.orders).filter(o => o.status === 'delivered' && isToday(o.hist[o.hist.length - 1].ts)).sort((a, b) => b.ts - a.ts);
    return `<h2 style="margin-top:4px">On route (${r.length})</h2>${r.map(o => orderCard(o, S, `<span class="muted" style="margin-right:6px">${esc(o.vehicle || '')}</span><button class="btn sm" onclick="openSheet({type:'deliver',oid:'${o.id}'})">Delivered ✓</button>`)).join('') || empty('Nothing on route')}
    <h2>Delivered today (${dd.length})</h2>${dd.map(o => orderCard(o, S)).join('') || empty('No deliveries yet today')}`;
  },
  stock(S) {
    const ps = Object.values(S.products).sort((a, b) => a.stock - b.stock); const own = role() === 'owner';
    return `<div class="kpis">${kpi('Products', ps.length)}${own ? kpi('Stock value (cost)', rs(sum(ps, p => p.stock * p.cost))) : kpi('Low stock', ps.filter(p => p.stock < 10).length, 'red')}</div>
    ${own ? `<div class="btns" style="margin-top:12px"><button class="btn" onclick="openSheet({type:'stockin'})">+ Stock In (Purchase)</button><button class="btn alt" onclick="openSheet({type:'addprod'})">+ New Product</button></div>` : ''}
    <h2>Current stock</h2><div class="card" style="padding:2px 14px">${ps.map(p => `<div class="prod"><div><div class="pn">${esc(p.name)}${p.pend ? ' <span class="pendtag">⏳</span>' : ''}</div><div class="muted">W ${rs(p.w)} · R ${rs(p.r)}${own ? ' · Cost ' + rs(p.cost) : ''}</div></div>
      <div style="text-align:right"><b class="${p.stock < 10 ? 'red' : ''}" style="font-size:17px">${p.stock}</b><div class="muted">${esc(p.unit)}${p.stock < 10 ? ' · LOW' : ''}</div></div></div>`).join('') || empty('No products')}</div>`;
  },
  dash(S) {
    const ts = S.sales.filter(s => isToday(s.ts)); const recv = sum(Object.values(S.customers), c => c.bal);
    const pend = Object.values(S.orders).filter(o => o.status === 'pending'); const low = Object.values(S.products).filter(p => p.stock < 10);
    const days = []; for (let d = 6; d >= 0; d--) { const st = sod(now()) - d * 864e5; days.push({ l: d ? new Date(st).toLocaleDateString('en-PK', { weekday: 'short' }) : 'Today', v: sum(S.sales.filter(s => sod(s.ts) === st), s => s.amt) }); }
    const mx = Math.max(...days.map(x => x.v), 1);
    const todayOut = sum(S.cash.filter(c => c.type === 'out' && isToday(c.ts)), c => c.amt);
    const top = Object.values(S.customers).filter(c => c.bal > 0).sort((a, b) => b.bal - a.bal).slice(0, 5);
    return `<div class="kpis">${kpi("Today's sales", rs(sum(ts, s => s.amt)))}${kpi('Gross profit today', rs(sum(ts, s => s.profit)), 'green')}${kpi('Cash in hand', rs(cashBal(S)))}${kpi('Receivable (udhaar)', rs(recv), 'red')}<div class="kpi click" onclick="go('orders')"><div class="l">Orders to dispatch</div><div class="v ${pend.length ? 'red' : ''}">${pend.length} →</div></div>${kpi("Today's expenses", rs(todayOut))}</div>
    <h2>Sales — last 7 days</h2><div class="card"><div class="bars">${days.map(x => `<div class="bw"><span class="bv">${x.v ? Math.round(x.v / 1000) + 'k' : ''}</span><div class="bar" style="height:${x.v / mx * 85}%"></div><span class="bl">${x.l}</span></div>`).join('')}</div></div>
    ${low.length ? `<h2>Low stock</h2><div class="card">${low.map(p => `<div class="row" style="padding:4px 0"><span>${esc(p.name)}</span><b class="red">${p.stock} ${esc(p.unit)}</b></div>`).join('')}<button class="btn sm alt" style="margin-top:8px" onclick="openSheet({type:'stockin'})">+ Stock In</button></div>` : ''}
    <h2>Highest balances</h2>${top.map(c => `<div class="card row click" onclick="openSheet({type:'shop',cid:'${c.id}'})"><span><b>${esc(c.name)}</b><div class="muted">${esc(c.area)}</div></span><b class="red">${rs(c.bal)}</b></div>`).join('') || empty('No outstanding balances')}
    <h2>Team — last sync</h2><div class="card">${(D.users || []).filter(u => u.active).map(u => `<div class="row" style="padding:5px 0"><span>${ROLE[u.role].icon} ${esc(u.name)}</span><span class="muted" style="margin:0">${ago(u.lastSeen)}</span></div>`).join('') || '<span class="muted">Sync to see your team</span>'}
    <button class="btn sm alt" style="margin-top:8px" onclick="openSheet({type:'users'})">Manage users</button></div>`;
  },
  orders(S) {
    const all = Object.values(S.orders);
    const cnt = st => all.filter(o => o.status === st).length;
    let l = ui.filter === 'all' ? all : all.filter(o => o.status === ui.filter);
    l.sort((a, b) => ui.filter === 'pending' || ui.filter === 'dispatched' ? a.ts - b.ts : b.ts - a.ts);
    const act = o => o.status === 'pending' ? `<button class="btn sm" onclick="openSheet({type:'dispatch',oid:'${o.id}'})">Dispatch →</button>`
      : o.status === 'dispatched' ? `<button class="btn sm" onclick="openSheet({type:'deliver',oid:'${o.id}'})">Delivered ✓</button>` : '';
    const val = sum(all.filter(o => o.status === 'pending'), o => o.total);
    return `<div class="kpis" style="margin-bottom:12px">${kpi('To dispatch', cnt('pending') + ' · ' + rs(val))}${kpi('On route', cnt('dispatched'))}</div>`
      + chips([['pending', `To dispatch (${cnt('pending')})`], ['dispatched', `On route (${cnt('dispatched')})`], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']])
      + (l.slice(0, 100).map(o => orderCard(o, S, act(o))).join('') || empty(ui.filter === 'pending' ? 'All caught up 🎉 No orders to dispatch' : 'No orders'));
  },
  cash(S) {
    const tin = sum(S.cash.filter(c => c.type === 'in' && isToday(c.ts)), c => c.amt), tout = sum(S.cash.filter(c => c.type === 'out' && isToday(c.ts)), c => c.amt);
    const list = [...S.cash].sort((a, b) => b.ts - a.ts).slice(0, 150); let lastDay = null;
    return `<div class="card"><div class="muted" style="margin:0">Cash in hand</div><div style="font-size:24px;font-weight:700">${rs(cashBal(S))}</div>
    <div class="row" style="margin-top:8px"><span class="green">▲ In today ${rs(tin)}</span><span class="red">▼ Out today ${rs(tout)}</span></div></div>
    <div class="btns"><button class="btn" onclick="openSheet({type:'counter'})">+ Counter Sale</button><button class="btn alt" onclick="openSheet({type:'expense'})">+ Expense</button><button class="btn alt" onclick="openSheet({type:'stockin'})">+ Purchase</button></div>
    ${list.map(c => {
      const d = sod(c.ts); const hd = d !== lastDay ? `<h2>${isToday(c.ts) ? 'Today' : new Date(c.ts).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}</h2>` : ''; lastDay = d;
      return hd + `<div class="card row"><div><b style="font-size:13px">${esc(c.cat)}</b>${c.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${esc(c.desc)}${c.byName ? ' · ' + esc(c.byName) : ''}</div></div><b class="${c.type === 'in' ? 'green' : 'red'}" style="white-space:nowrap">${c.type === 'in' ? '+' : '−'} ${rs(c.amt)}</b></div>`;
    }).join('')}`;
  },
};

/* ---------- sheets (pop-up forms) ---------- */
function openSheet(s) { ui.sheet = s; if (s.type === 'counter') { ui.ccart = {}; ui.ccust = ''; } drawSheet(); if (s.type === 'users') loadUsers(); }
function closeSheet() { ui.sheet = null; drawSheet(); }
function sh(title, body) { return `<div class="ov" onclick="if(event.target===this)closeSheet()"><div class="sh"><div class="row" style="margin-bottom:6px"><h3>${title}</h3><button class="x" onclick="closeSheet()">✕</button></div>${body}</div></div>`; }
const val = id => (document.getElementById(id) || {}).value || '';
const num = id => parseFloat(val(id)) || 0;
const methodSel = id => `<select id="${id}">${METHODS.map(m => `<option>${m}</option>`).join('')}</select>`;

function drawSheet() {
  const el = document.getElementById('sheet'); const s = ui.sheet; if (!s || !sess) { el.innerHTML = ''; return; }
  const S = view(); let h = '';
  switch (s.type) {
    case 'account': h = sh(`${ROLE[role()].icon} ${esc(me().name)}`, `<div class="muted">${ROLE[role()].label} · @${esc(me().username)}</div>
      <div class="card" style="margin-top:12px;background:#f9fafb">
        <div class="row"><span>Internet</span><b class="${isOnline() ? 'green' : 'red'}">${isOnline() ? 'Connected' : 'Offline'}</b></div>
        <div class="row" style="margin-top:6px"><span>Waiting to sync</span><b class="${D.outbox.length ? 'red' : ''}">${D.outbox.length}</b></div>
        <div class="row" style="margin-top:6px"><span>Last synced</span><b>${ago(D.lastSync)}</b></div></div>
      <div class="btns"><button class="btn" onclick="sync(true)">⟳ Sync now</button>${role() === 'owner' ? `<button class="btn alt" onclick="openSheet({type:'users'})">👥 Manage users</button>` : ''}<button class="btn red" onclick="logout()">Log out</button></div>
      <p class="muted" style="margin-top:14px">Tip: add this app to your home screen (browser menu → “Add to Home screen” / “Install app”). It opens and works without internet.</p>`); break;
    case 'logoutwarn': h = sh('⚠️ Unsynced data', `<p>${D.outbox.length} record(s) on this phone have not reached the server yet. If you log out now they will be lost.</p>
      <div class="btns"><button class="btn" onclick="closeSheet();sync(true)">Sync first</button><button class="btn red" onclick="logout(true)">Log out anyway</button></div>`); break;
    case 'users': {
      const list = ui.userList || D.users || [];
      h = sh('👥 Users', `<p class="muted">Each person logs in on their own phone with username + PIN. Needs internet.</p>
      ${list.map(u => `<div class="card row"><div><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="badge cancelled">inactive</span>'}<div class="muted">@${esc(u.username)} · ${ROLE[u.role].label} · seen ${ago(u.lastSeen)}</div></div>
        <div class="btns" style="justify-content:flex-end"><button class="btn sm alt" onclick="resetPin('${u.id}')">PIN</button>${u.id !== me().id ? `<button class="btn sm ${u.active ? 'red' : 'alt'}" onclick="toggleUser('${u.id}',${!u.active})">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</div></div>`).join('')}
      <h2>Add user</h2>
      <label>Full name</label><input id="un" placeholder="e.g. Bilal">
      <label>Username</label><input id="uu" placeholder="e.g. bilal" autocapitalize="none">
      <label>PIN (4–8 digits)</label><input id="up" inputmode="numeric" placeholder="e.g. 4321">
      <label>Role</label><select id="ur"><option value="taker">Order Taker</option><option value="owner">Owner / Admin (also dispatches)</option></select>
      <div id="pinbox"></div>
      <button class="btn block" style="margin-top:14px" onclick="addUser()">Add user</button>`); break;
    }
    case 'pin': h = sh('Set new PIN', `<label>New PIN (4–8 digits)</label><input id="np1" inputmode="numeric"><button class="btn block" style="margin-top:14px" onclick="savePin('${s.uid}')">Save PIN</button>`); break;
    case 'order': {
      const o = S.orders[s.oid]; if (!o) { closeSheet(); return; } const c = S.customers[o.cid] || {};
      const r = role();
      h = sh(`Order ${esc(o.no)}`, `<div class="row"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.area)} · ${esc(c.phone)}</div></div><span class="badge ${o.status}">${STATUS[o.status]}</span></div>
      <table style="margin-top:10px"><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${o.items.map(i => `<tr><td>${esc((S.products[i.pid] || {}).name)}</td><td class="r">${i.qty}</td><td class="r">${rs(i.rate)}</td><td class="r">${rs(i.qty * i.rate)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b> <span class="muted">(${o.rateType === 'r' ? 'retail' : 'wholesale'} rate)</span></td><td class="r"><b>${rs(o.total)}</b></td></tr></table>
      ${o.note ? `<div class="muted" style="margin-top:8px">📝 ${esc(o.note)}</div>` : ''}${o.vehicle ? `<div class="muted">🚚 ${esc(o.vehicle)}</div>` : ''}
      <h2>History</h2><div class="hist">${o.hist.map(x => `<div><b>${STATUS[x.s]}</b> · ${fmtD(x.ts)}<br><span class="muted">by ${esc(x.byName || '')}${x.pend ? ' · ⏳ not synced' : ''}</span></div>`).join('')}</div>
      <div class="btns"><button class="btn alt" onclick="openSheet({type:'shop',cid:'${o.cid}'})">📒 Shop khata</button>
      ${o.status === 'pending' && r !== 'taker' ? `<button class="btn" onclick="openSheet({type:'dispatch',oid:'${o.id}'})">Dispatch</button>` : ''}
      ${o.status === 'dispatched' && r !== 'taker' ? `<button class="btn" onclick="openSheet({type:'deliver',oid:'${o.id}'})">Mark delivered</button>` : ''}
      ${o.status === 'pending' && (r === 'owner' || o.by === me().id) ? `<button class="btn red" onclick="setStatus('${o.id}','cancelled');closeSheet();toast('Order cancelled')">Cancel order</button>` : ''}</div>`);
      break;
    }
    case 'dispatch': {
      const o = S.orders[s.oid]; if (!o) { closeSheet(); return; } const c = S.customers[o.cid] || {};
      const short = o.items.filter(i => (S.products[i.pid] || {}).stock < i.qty);
      h = sh(`Dispatch ${esc(o.no)}`, `<b>${esc(c.name)}</b><div class="muted">${esc(c.area)} · ${esc(c.phone)}</div>
      <table style="margin-top:10px"><tr><th>Load item</th><th class="r">Qty</th><th class="r">In stock</th></tr>${o.items.map(i => { const p = S.products[i.pid] || {}; return `<tr><td>${esc(p.name)}</td><td class="r"><b>${i.qty}</b></td><td class="r ${p.stock < i.qty ? 'red' : ''}">${p.stock}</td></tr>`; }).join('')}</table>
      ${short.length ? `<div class="warn">⚠️ Not enough stock for ${short.length} item(s). You can still dispatch; stock will go negative.</div>` : ''}
      <label>Vehicle / Rider</label><select id="veh">${VEHICLES.map(v => `<option>${v}</option>`).join('')}</select>
      <p class="muted">Dispatching adds ${rs(o.total)} to the shop's khata and reduces stock.</p>
      <button class="btn block" onclick="setStatus('${o.id}','dispatched',{vehicle:val('veh')});closeSheet();toast('🚚 ${esc(o.no)} dispatched','ok')">Confirm Dispatch</button>`);
      break;
    }
    case 'deliver': {
      const o = S.orders[s.oid]; if (!o) { closeSheet(); return; } const c = S.customers[o.cid] || {};
      h = sh(`Deliver ${esc(o.no)}`, `<b>${esc(c.name)}</b><div class="muted">Bill ${rs(o.total)} · Shop balance now ${rs(c.bal)}</div>
      <label>Cash collected</label><input id="amt" type="number" inputmode="numeric" placeholder="0">
      <div class="btns" style="margin-top:6px"><button class="btn sm alt" onclick="document.getElementById('amt').value=${o.total}">Full bill</button><button class="btn sm alt" onclick="document.getElementById('amt').value=${Math.max(0, c.bal)}">Full balance</button><button class="btn sm alt" onclick="document.getElementById('amt').value=0">On credit</button></div>
      <label>Method</label>${methodSel('meth')}
      <button class="btn block" style="margin-top:14px" onclick="confirmDeliver('${o.id}')">Confirm Delivery</button>`);
      break;
    }
    case 'shop': {
      const c = S.customers[s.cid]; if (!c) { closeSheet(); return; }
      let run = 0; const led = S.ledger.filter(l => l.cid === c.id).map(l => { run += l.dr - l.cr; return { ...l, run }; });
      const rows = [...led].reverse();
      const n = x => x ? Math.round(x).toLocaleString('en-PK') : '';
      h = sh(esc(c.name), `<div class="muted">${esc(c.area)} · ${esc(c.phone)}</div>
      <div class="card row" style="margin-top:10px;background:#f9fafb"><span>Balance</span><b class="${c.bal > 0 ? 'red' : 'green'}" style="font-size:20px">${rs(c.bal)}</b></div>
      <div class="btns"><button class="btn" onclick="openSheet({type:'pay',cid:'${c.id}'})">Receive Payment</button>${role() === 'taker' ? `<button class="btn alt" onclick="ui.shop='${c.id}';closeSheet();go('new')">New Order</button>` : ''}</div>
      <div class="kpis" style="margin-top:10px">${kpi('Total billed', rs(sum(led, l => l.dr)))}${kpi('Total received', rs(sum(led, l => l.cr)), 'green')}</div>
      <div class="row"><h2>Khata (ledger)</h2><button class="btn sm alt" onclick="copyStmt('${c.id}')">📋 Copy statement</button></div>
      <table><tr><th>Date</th><th>Detail</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Bal</th></tr>
      ${rows.map(l => `<tr><td class="muted" style="white-space:nowrap">${new Date(l.ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}</td><td>${esc(l.desc)}${l.pend ? ' ⏳' : ''}${l.oid && S.orders[l.oid] ? `<div class="muted">${S.orders[l.oid].items.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}</div>` : ''}</td><td class="r">${n(l.dr)}</td><td class="r green">${n(l.cr)}</td><td class="r"><b>${n(l.run) || '0'}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No entries yet</td></tr>'}</table>`);
      break;
    }
    case 'pay': {
      const c = S.customers[s.cid];
      h = sh('Receive Payment', `<b>${esc(c.name)}</b><div class="muted">Current balance ${rs(c.bal)}</div>
      <label>Amount</label><input id="amt" type="number" inputmode="numeric" placeholder="e.g. 10000">
      <label>Method</label>${methodSel('meth')}
      <label>Note</label><input id="pnote" placeholder="Recovery">
      <button class="btn block" style="margin-top:14px" onclick="confirmPay('${c.id}')">Save Payment</button>`);
      break;
    }
    case 'addshop': h = sh('Add Shop / Customer', `<label>Shop name</label><input id="sn" placeholder="e.g. Usman Karyana">
      <label>Area</label><input id="sa" placeholder="e.g. Batala Colony"><label>Phone</label><input id="sp" type="tel" placeholder="03xx-xxxxxxx">
      <label>Opening balance (old udhaar)</label><input id="sob" type="number" placeholder="0">
      <button class="btn block" style="margin-top:14px" onclick="confirmShop(${s.fromOrder ? 1 : 0})">Save Shop</button>`); break;
    case 'expense': h = sh('Add Expense', `<label>Category</label><select id="ec"><option>Fuel</option><option>Loading / Labour</option><option>Salary</option><option>Rent</option><option>Electricity / Utility</option><option>Vehicle Repair</option><option>Other</option></select>
      <label>Detail</label><input id="ed" placeholder="e.g. Diesel for pickup"><label>Amount</label><input id="ea" type="number" inputmode="numeric">
      <button class="btn block" style="margin-top:14px" onclick="confirmExpense()">Save Expense</button>`); break;
    case 'stockin': {
      const ps = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name));
      window._costs = Object.fromEntries(ps.map(p => [p.id, p.cost]));
      h = sh('Stock In / Purchase', `<label>Product</label><select id="sip" onchange="document.getElementById('sic').value=_costs[this.value]">${ps.map(p => `<option value="${p.id}">${esc(p.name)} (${p.stock} in stock)</option>`).join('')}</select>
      <label>Quantity</label><input id="siq" type="number" inputmode="numeric" placeholder="e.g. 50"><label>Cost per unit</label><input id="sic" type="number" value="${ps[0] ? ps[0].cost : ''}">
      <label>Supplier</label><input id="sis" placeholder="e.g. Unilever distributor">
      <p class="muted">Paid from cash — shows in the cash book as a purchase.</p>
      <button class="btn block" onclick="confirmStock()">Add Stock</button>`);
      break;
    }
    case 'addprod': h = sh('New Product', `<label>Name</label><input id="np" placeholder="e.g. Olpers 1L"><label>Unit</label><input id="nu" placeholder="ctn (12)">
      <div class="kpis"><div><label>Cost</label><input id="nc" type="number"></div><div><label>Wholesale rate</label><input id="nw" type="number"></div><div><label>Retail rate</label><input id="nr" type="number"></div><div><label>Opening stock</label><input id="ns" type="number" value="0"></div></div>
      <button class="btn block" style="margin-top:14px" onclick="confirmProd()">Save Product</button>`); break;
    case 'counter': {
      const ps = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name)); const it = Object.entries(ui.ccart); const tot = sum(it, ([pid, q]) => q * S.products[pid].r);
      h = sh('Counter Sale (Retail)', `<label style="margin-top:0">Customer (optional)</label><input id="ccu" placeholder="Walk-in" value="${esc(ui.ccust)}" oninput="ui.ccust=this.value">
      <div style="margin-top:8px">${ps.map(p => { const q = ui.ccart[p.id] || 0; return `<div class="prod"><div><div class="pn">${esc(p.name)}</div><div class="muted">${rs(p.r)} · stock ${p.stock}</div></div><div class="step"><button onclick="cq('${p.id}',-1)">−</button><span>${q}</span><button onclick="cq('${p.id}',1)">+</button></div></div>`; }).join('')}</div>
      <button class="btn block" style="margin-top:12px" onclick="confirmCounter()" ${tot ? '' : 'disabled'}>Save Sale · ${rs(tot)}</button>`);
      break;
    }
  }
  const old = el.querySelector('.sh'); const top = old ? old.scrollTop : 0;
  el.innerHTML = h; const ns = el.querySelector('.sh'); if (ns && s._keep) ns.scrollTop = top;
}
function cq(pid, d) { const q = Math.max(0, (ui.ccart[pid] || 0) + d); if (q) ui.ccart[pid] = q; else delete ui.ccart[pid]; ui.sheet._keep = 1; drawSheet(); }
function confirmDeliver(oid) {
  const o = view().orders[oid]; const amt = num('amt'); const m = val('meth');
  setStatus(oid, 'delivered');
  if (amt > 0) emit('payment', { cid: o.cid, amt, method: m, note: 'Collected on delivery ' + o.no });
  closeSheet(); toast(`✅ ${o.no} delivered${amt ? ' · ' + rs(amt) + ' collected' : ' · on credit'}`, 'ok');
}
function confirmPay(cid) {
  const amt = num('amt'); if (amt <= 0) { toast('Enter an amount'); return; }
  emit('payment', { cid, amt, method: val('meth'), note: val('pnote') || 'Recovery' }); toast(`✅ ${rs(amt)} received`, 'ok'); openSheet({ type: 'shop', cid });
}
function confirmShop(fromOrder) {
  const name = val('sn').trim(); if (!name) { toast('Enter shop name'); return; } const id = uid(); const ob = num('sob');
  emit('customer', { id, name, area: val('sa'), phone: val('sp') }); if (ob) emit('opening', { cid: id, amt: ob });
  toast('✅ Shop added', 'ok'); if (fromOrder) { ui.shop = id; closeSheet(); render(); } else closeSheet();
}
function confirmExpense() { const amt = num('ea'); if (amt <= 0) { toast('Enter an amount'); return; } emit('expense', { cat: val('ec'), desc: val('ed') || val('ec'), amt }); closeSheet(); toast('✅ Expense saved', 'ok'); }
function confirmStock() { const q = num('siq'); if (q <= 0) { toast('Enter quantity'); return; } emit('stock_in', { pid: val('sip'), qty: q, cost: num('sic'), supplier: val('sis') }); closeSheet(); toast('✅ Stock added', 'ok'); }
function confirmProd() {
  const name = val('np').trim(); if (!name) { toast('Enter product name'); return; }
  emit('product', { id: uid(), name, unit: val('nu') || 'pcs', cost: num('nc'), w: num('nw'), r: num('nr'), stock: num('ns') }); closeSheet(); toast('✅ Product added', 'ok');
}
function confirmCounter() {
  const S = view(); const items = Object.entries(ui.ccart).map(([pid, qty]) => ({ pid, qty, rate: S.products[pid].r }));
  if (!items.length) return; const total = sum(items, i => i.qty * i.rate);
  emit('counter', { items, total, cust: ui.ccust || 'Walk-in' }); closeSheet(); toast(`✅ Sale ${rs(total)} saved`, 'ok');
}
function copyStmt(cid) {
  const S = view(); const c = S.customers[cid]; let run = 0;
  const lines = S.ledger.filter(l => l.cid === cid).map(l => { run += l.dr - l.cr; return `${new Date(l.ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}  ${l.desc}  ${l.dr ? '+' + l.dr : '-' + l.cr}  = ${run}`; });
  const t = `*${c.name}* — Account Statement\n${c.area}\n\n${lines.slice(-20).join('\n')}\n\n*Balance due: ${rs(c.bal)}*`;
  try { navigator.clipboard.writeText(t).then(() => toast('📋 Statement copied — paste in WhatsApp', 'ok'), () => toast('Copy not allowed here')); } catch (e) { toast('Copy not allowed here'); }
}
/* user admin (owner, online only) */
async function loadUsers() { try { ui.userList = await api('/api/users'); if (ui.sheet && ui.sheet.type === 'users') drawSheet(); } catch (e) { toast('Connect to internet to manage users', 'off'); } }
async function addUser() {
  try { await api('/api/users', { name: val('un').trim(), username: val('uu').trim().toLowerCase(), pin: val('up').trim(), role: val('ur') }); toast('✅ User added', 'ok'); loadUsers(); }
  catch (e) { toast('❌ ' + e.message); }
}
async function toggleUser(id, active) { try { await api('/api/users/' + id, { active }, 'PATCH'); loadUsers(); } catch (e) { toast('❌ ' + e.message); } }
function resetPin(id) { openSheet({ type: 'pin', uid: id }); }
async function savePin(id) { try { await api('/api/users/' + id, { pin: val('np1').trim() }, 'PATCH'); toast('✅ PIN updated', 'ok'); openSheet({ type: 'users' }); } catch (e) { toast('❌ ' + e.message); } }

/* ---------- render ---------- */
function header() {
  const on = isOnline(), pend = D.outbox.length, sy = ui.syncing;
  return `<header><div><div class="brand">TradeBook</div><div class="who">${ROLE[role()].label}</div></div>
  <div class="hd-r"><button class="net ${on ? 'on' : 'off'} ${sy ? 'sy' : ''}" onclick="sync(true)"><span class="dot"></span>${on ? (sy ? 'Syncing…' : 'Online') : 'Offline'}${pend ? ` · ${pend}` : ''}</button>
  <button class="uchip" onclick="openSheet({type:'account'})">${ROLE[role()].icon} ${esc(me().name.split(' ')[0])} ▾</button></div></header>
  ${!on ? `<div class="banner off">📴 <b>No internet.</b> Keep working — ${pend} record${pend === 1 ? '' : 's'} saved on this phone will sync automatically.</div>` : pend ? `<div class="banner sync">⟳ ${pend} record${pend === 1 ? '' : 's'} waiting to sync…</div>` : ''}`;
}
function loginView() {
  return `<form class="login" onsubmit="login(event)"><div class="logo">📦</div><h1>TradeBook</h1><div class="muted" style="margin-bottom:18px">Orders · Dispatch · Khata · Cash book — works offline</div>
  <label>Username</label><input id="lu" autocapitalize="none" autocomplete="username" placeholder="e.g. ali">
  <label>PIN</label><input id="lp" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••">
  <button class="btn block" style="margin-top:16px" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Logging in…' : 'Log in'}</button>
  <div class="card" style="margin-top:18px;font-size:13px"><b>Demo logins</b><div class="muted">Owner: <b>owner</b> / 1234<br>Order taker: <b>ali</b> / 1111</div></div></form>`;
}
function render() {
  const app = document.getElementById('app');
  if (!sess) { if (!document.getElementById('lu')) app.innerHTML = loginView(); else app.querySelector('button.btn').disabled = ui.busy; return; }
  if (!D) loadData();
  const S = view(); const tabs = TABS[role()];
  if (!ui.tab || !tabs.find(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  const a = document.activeElement; const fid = a && a.id && a.tagName === 'INPUT' && app.contains(a) ? a.id : null; const sel = fid ? [a.selectionStart, a.selectionEnd] : null;
  app.innerHTML = header() + `<main>${V[ui.tab](S)}</main><nav>${tabs.map(([k, l, ic]) => `<button class="${k === ui.tab ? 'act' : ''}" onclick="go('${k}')"><span class="ic">${ic}</span>${l}</button>`).join('')}</nav>`;
  if (fid) { const n = document.getElementById(fid); if (n) { n.focus(); try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (sess) loadData();
render();
if (sess) sync();
