/* TradeBook client — offline-first.
   Every change is an "event" saved on the phone first (outbox), then pushed to the
   server when internet is available. The screens are rebuilt from all events. */

const ROLE = {
  owner: { label: 'Owner', icon: '📊' },
  dispatch: { label: 'Dispatcher', icon: '🚚' },
  taker: { label: 'Order Taker', icon: '🧾' },
};
const TABS = {
  taker: [['today', 'Today', '🏠'], ['new', 'New Order', '➕'], ['shops', 'Shops', '🏪'], ['mine', 'My Orders', '🧾']],
  dispatch: [['orders', 'Dispatch', '🚚'], ['shops', 'Khata', '📒'], ['stock', 'Stock', '🏬']],
  owner: [['dash', 'Home', '📊'], ['orders', 'Dispatch', '🚚'], ['counter', 'Counter', '🛒'], ['shops', 'Khata', '📒'], ['cash', 'Cash', '💵'], ['stock', 'Stock', '🏬']],
};
const VEHICLES = ['Suzuki Pickup HDA-4521', 'Shehzore HDB-889', 'Loader Rickshaw HDC-212', 'Bike'];
const STATUS = { pending: 'Pending', dispatched: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' };
const METHODS = ['Cash', 'JazzCash', 'EasyPaisa', 'Bank Transfer', 'Cheque'];

/* ---------- helpers ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const rs = n => 'Rs ' + Math.round(n || 0).toLocaleString('en-PK');
const n0 = n => Math.round(n || 0).toLocaleString('en-PK');
const sum = (a, f) => a.reduce((s, x) => s + (f ? f(x) : x), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const eod = t => sod(t) + 864e5 - 1;
const isToday = t => sod(t) === sod(now());
const fmtT = t => new Date(t).toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' });
const fmtD = t => isToday(t) ? 'Today ' + fmtT(t) : new Date(t).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) + ' ' + fmtT(t);
const dstr = t => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dshort = t => new Date(t).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
const isoDay = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const ago = t => { if (!t) return 'never'; const s = (now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hr ago'; return Math.floor(s / 86400) + ' days ago'; };
const empty = m => `<div class="empty">${m}</div>`;
const jget = k => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('⚠️ Phone storage full — please sync and contact admin'); return false; } };

/* ---------- state ---------- */
let sess = jget('tb_sess');           // {token, user}
let D = null;                          // {events, seq, outbox, lastSync, users, epoch}
const ui = { tab: null, cart: {}, shop: '', rate: 'w', q: '', note: '', filter: 'all', syncing: false, online: navigator.onLine, sheet: null,
  dq: {}, dbko: true, dveh: '', adjm: 'chg', ccart: {}, ccid: '', crate: 'r', cq: '', plines: [], psid: '', ppaid: null, busy: false, pdf: null };
const me = () => sess.user;
const role = () => sess.user.role;
const isOwner = () => sess.user.role === 'owner';
const dkey = () => 'tb_data_' + sess.user.id;
function loadData() { D = jget(dkey()) || { events: [], seq: 0, outbox: [], lastSync: 0, users: [] }; }
function saveData() { jset(dkey(), D); }
const isOnline = () => navigator.onLine && ui.online;

/* ---------- rebuild business state from events ---------- */
function view() { return build(D.events.concat(D.outbox.map(e => ({ ...e, _p: 1 })))); }
function profit(items, S) { return sum(items, i => { const p = S.products[i.pid]; return p ? (i.rate - p.cost) * i.qty : 0; }); }
function build(evs) {
  const S = { products: {}, customers: {}, suppliers: {}, orders: {}, counters: {}, purchases: {}, pays: {},
    ledger: [], sledger: [], cash: [], sales: [], moves: [], settings: { bizName: 'My Business', address: '', phone: '', footer: 'Thank you for your business' } };
  const applyPay = (p, ts, cashTs, byName, pend, extra) => {
    const c = S.customers[p.cid]; if (c) c.bal -= p.amt;
    S.ledger.push({ ts, cid: p.cid, desc: (p.note || 'Payment received') + (p.method ? ` (${p.method})` : ''), dr: 0, cr: p.amt, pend, byName });
    S.cash.push({ ts: cashTs, type: 'in', cat: 'Recovery', desc: `${c ? c.name : ''} — ${p.note || 'Payment'}${p.method ? ' · ' + p.method : ''}${extra || ''}`, amt: p.amt, pend, byName });
  };
  const mv = (ts, pid, qty, type, ref, pend) => { if (qty) S.moves.push({ ts, pid, qty, type, ref, pend }); };
  for (const e of [...evs].sort((a, b) => a.ts - b.ts)) {
    const p = e.p, pend = !!e._p;
    switch (e.t) {
      case 'settings': Object.assign(S.settings, p); break;
      case 'product': S.products[p.id] = { ...p, pend }; mv(e.ts, p.id, p.stock, 'Opening stock', '', pend); break;
      case 'product_upd': { const pr = S.products[p.id]; if (pr) Object.assign(pr, { name: p.name ?? pr.name, unit: p.unit ?? pr.unit, cost: p.cost ?? pr.cost, w: p.w ?? pr.w, r: p.r ?? pr.r }); break; }
      case 'stock_adj': { const pr = S.products[p.pid]; if (pr) { pr.stock += p.qty; mv(e.ts, p.pid, p.qty, 'Adjustment', p.reason || '', pend); } break; }
      case 'stock_in': { // legacy single-item purchase
        const pr = S.products[p.pid]; if (!pr) break;
        pr.stock += p.qty; if (p.cost) pr.cost = p.cost; mv(e.ts, p.pid, p.qty, 'Purchase', p.supplier || '', pend);
        S.cash.push({ ts: e.ts, type: 'out', cat: 'Purchase', desc: `${pr.name} × ${p.qty} — ${p.supplier || 'Supplier'}`, amt: p.qty * (p.cost || pr.cost), pend });
        break;
      }
      case 'customer': S.customers[p.id] = { type: 'shop', ...p, bal: 0, pend }; break;
      case 'opening': { const c = S.customers[p.cid]; if (c) { c.bal += p.amt; S.ledger.push({ ts: e.ts, cid: p.cid, desc: 'Opening balance', dr: p.amt, cr: 0, pend }); } break; }
      case 'cash_open': S.cash.push({ ts: e.ts, type: 'in', cat: 'Opening', desc: 'Opening cash in hand', amt: p.amt, pend }); break;
      case 'order': S.orders[p.id] = { ...p, status: 'pending', by: e.by, byName: e.byName, ts: e.ts, pend, hist: [{ s: 'pending', ts: e.ts, byName: e.byName, pend }] }; break;
      case 'status': {
        const o = S.orders[p.oid]; if (!o || o.status === p.status) break;
        if (p.status === 'cancelled' && o.status !== 'pending') break;
        if (p.status === 'delivered' && o.status !== 'dispatched') break;
        if (p.status === 'dispatched') {
          if (o.status !== 'pending') break;
          if (Array.isArray(p.items)) { // partial dispatch: only what was actually sent is billed
            o.ordered = o.items; o.short = p.short || [];
            o.items = p.items.filter(i => i.qty > 0); o.total = sum(o.items, i => i.qty * i.rate);
          }
          o.items.forEach(i => { const pr = S.products[i.pid]; if (pr) pr.stock -= i.qty; mv(e.ts, i.pid, -i.qty, 'Dispatch', o.no, pend); });
          const c = S.customers[o.cid]; if (c) c.bal += o.total;
          S.ledger.push({ ts: e.ts, cid: o.cid, desc: `Bill ${o.no}`, oid: o.id, dr: o.total, cr: 0, pend });
          S.sales.push({ ts: e.ts, amt: o.total, profit: profit(o.items, S), kind: 'wholesale', ref: o.id });
          o.vehicle = p.vehicle; o.dispatchedAt = e.ts;
        }
        if (p.status === 'delivered') o.deliveredAt = e.ts;
        o.status = p.status; o.hist.push({ s: p.status, ts: e.ts, byName: e.byName, pend }); if (pend) o.pend = true;
        break;
      }
      case 'payment': {
        if (e.byRole === 'taker') { // recovery by order taker → waits for owner approval
          S.pays[e.id] = { id: e.id, ...p, ts: e.ts, byName: e.byName, by: e.by, status: 'pending', pend };
          const c = S.customers[p.cid]; if (c) c.awaiting = (c.awaiting || 0) + p.amt;
        } else applyPay(p, e.ts, e.ts, e.byName, pend);
        break;
      }
      case 'pay_review': {
        const py = S.pays[p.payId]; if (!py || py.status !== 'pending') break;
        const c = S.customers[py.cid]; if (c) c.awaiting -= py.amt;
        py.status = p.ok ? 'approved' : 'rejected'; py.reviewedAt = e.ts;
        if (p.ok) applyPay(py, py.ts, e.ts, py.byName, pend, ` · via ${py.byName}`);
        break;
      }
      case 'expense': S.cash.push({ ts: e.ts, type: 'out', cat: p.cat, desc: p.desc, amt: p.amt, pend, byName: e.byName }); break;
      case 'counter': {
        const paid = p.paid ?? p.total; const pf = profit(p.items, S);
        p.items.forEach(i => { const pr = S.products[i.pid]; if (pr) pr.stock -= i.qty; mv(e.ts, i.pid, -i.qty, 'Counter sale', p.no || '', pend); });
        const c = p.cid && S.customers[p.cid];
        const custName = c ? c.name : (p.cust || 'Walk-in');
        S.counters[p.id || e.id] = { ...p, id: p.id || e.id, paid, ts: e.ts, custName, pend, byName: e.byName };
        if (c) {
          c.bal += p.total - paid;
          S.ledger.push({ ts: e.ts, cid: c.id, desc: `Counter sale ${p.no || ''}`, csid: p.id, dr: p.total, cr: 0, pend });
          if (paid) S.ledger.push({ ts: e.ts + 1, cid: c.id, desc: `Paid at counter (${p.method || 'Cash'})`, dr: 0, cr: paid, pend });
        }
        if (paid) S.cash.push({ ts: e.ts, type: 'in', cat: 'Counter Sale', desc: `${p.no || ''} ${custName}${paid < p.total ? ` (Rs ${n0(p.total - paid)} on udhaar)` : ''}`, amt: paid, pend, ref: { t: 'counter', id: p.id || e.id } });
        S.sales.push({ ts: e.ts, amt: p.total, profit: pf, kind: 'retail', ref: p.id });
        break;
      }
      case 'supplier': S.suppliers[p.id] = { ...p, bal: 0, pend }; break;
      case 'sopening': { const s = S.suppliers[p.sid]; if (s) { s.bal += p.amt; S.sledger.push({ ts: e.ts, sid: p.sid, desc: 'Opening balance (payable)', bill: p.amt, paid: 0, pend }); } break; }
      case 'purchase': {
        const s = S.suppliers[p.sid];
        p.items.forEach(i => { const pr = S.products[i.pid]; if (pr) { pr.stock += i.qty; if (i.cost) pr.cost = i.cost; mv(e.ts, i.pid, i.qty, 'Purchase', p.no, pend); } });
        S.purchases[p.id] = { ...p, ts: e.ts, supName: s ? s.name : (p.supName || 'Cash purchase'), pend };
        if (s) {
          s.bal += p.total - (p.paid || 0);
          S.sledger.push({ ts: e.ts, sid: s.id, desc: `Purchase ${p.no}`, puid: p.id, bill: p.total, paid: 0, pend });
          if (p.paid) S.sledger.push({ ts: e.ts + 1, sid: s.id, desc: `Paid with purchase (${p.method || 'Cash'})`, bill: 0, paid: p.paid, pend });
        }
        if (p.paid) S.cash.push({ ts: e.ts, type: 'out', cat: 'Purchase', desc: `${p.no} — ${s ? s.name : 'Cash purchase'}${p.paid < p.total ? ` (Rs ${n0(p.total - p.paid)} payable)` : ''}`, amt: p.paid, pend, ref: { t: 'purchase', id: p.id } });
        break;
      }
      case 'supplier_pay': {
        const s = S.suppliers[p.sid]; if (s) s.bal -= p.amt;
        S.sledger.push({ ts: e.ts, sid: p.sid, desc: (p.note || 'Payment') + ` (${p.method || 'Cash'})`, bill: 0, paid: p.amt, pend });
        S.cash.push({ ts: e.ts, type: 'out', cat: 'Supplier Payment', desc: `${s ? s.name : ''} — ${p.note || 'Payment'} · ${p.method || 'Cash'}`, amt: p.amt, pend });
        break;
      }
    }
  }
  return S;
}
function custLedger(S, cid) { let run = 0; return S.ledger.filter(l => l.cid === cid).sort((a, b) => a.ts - b.ts).map(l => { run += l.dr - l.cr; return { ...l, run }; }); }
function supLedger(S, sid) { let run = 0; return S.sledger.filter(l => l.sid === sid).sort((a, b) => a.ts - b.ts).map(l => { run += l.bill - l.paid; return { ...l, run }; }); }
const pendingPays = S => Object.values(S.pays).filter(p => p.status === 'pending').sort((a, b) => a.ts - b.ts);

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
  const sending = D.outbox.slice(0, 500); const first = !D.seq;
  try {
    const j = await api('/api/sync', { since: D.seq, events: sending });
    if (D.epoch && j.epoch && D.epoch !== j.epoch) { // owner reset the data on the server
      D.events = []; D.seq = 0; D.outbox = []; D.epoch = j.epoch; saveData(); ui.syncing = false;
      toast('🔄 Data was reset by owner — reloading', 'ok'); return sync();
    }
    D.epoch = j.epoch;
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
    if (!first) {
      const others = fresh.filter(e => e.by !== me().id);
      const no = others.filter(e => e.t === 'order').length, rec = others.filter(e => e.t === 'payment' && e.byRole === 'taker').length;
      if (no && role() !== 'taker') toast(`📥 ${no} new order${no > 1 ? 's' : ''} received`, 'ok');
      if (rec && isOwner()) toast(`💰 ${rec} recovery payment${rec > 1 ? 's' : ''} waiting for your approval`, 'ok');
    }
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

function emit(t, p, quiet) {
  const e = { id: uid(), t, p, ts: now(), by: me().id, byName: me().name, byRole: role() };
  D.outbox.push(e); saveData(); render();
  if (!isOnline() && !quiet) toast('📴 Saved on this phone — will sync automatically', 'off');
  sync();
  return e.id;
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
function go(t) { ui.tab = t; ui.filter = t === 'orders' ? 'pending' : t === 'shops' ? 'shop' : 'all'; ui.q = ''; ui.cq = ''; render(); window.scrollTo(0, 0); }
function toast(m, c) { const el = document.createElement('div'); el.className = 't ' + (c || ''); el.textContent = m; document.getElementById('toast').appendChild(el); setTimeout(() => el.remove(), 3400); }
function qty(pid, dl) { const q = Math.max(0, (ui.cart[pid] || 0) + dl); if (q) ui.cart[pid] = q; else delete ui.cart[pid]; render(); }
function cqty(pid, dl) { const q = Math.max(0, (ui.ccart[pid] || 0) + dl); if (q) ui.ccart[pid] = q; else delete ui.ccart[pid]; render(); }
function filterRows(v, sel, key) { ui[key || 'q'] = v; const q = v.toLowerCase(); document.querySelectorAll(sel).forEach(r => r.style.display = r.dataset.n.includes(q) ? '' : 'none'); }
function nextNo(type, pre) {
  const used = D.events.concat(D.outbox).filter(e => e.t === type && String(e.p.no || '').startsWith(pre + '-')).map(e => parseInt(String(e.p.no).split('-')[1]) || 0);
  return pre + '-' + (Math.max(1000, ...used) + 1);
}
function saveOrder() {
  const S = view();
  if (!ui.shop) { toast('Please select a shop first'); return; }
  const items = Object.entries(ui.cart).map(([pid, qty]) => { const p = S.products[pid]; return { pid, qty, rate: ui.rate === 'w' ? p.w : p.r }; });
  if (!items.length) { toast('Add at least one product'); return; }
  const total = sum(items, i => i.qty * i.rate), no = nextNo('order', me().username.toUpperCase().slice(0, 4)), online = isOnline();
  const id = uid();
  emit('order', { id, no, cid: ui.shop, items, total, rateType: ui.rate, note: ui.note });
  if (online) toast(`✅ Order ${no} saved — sent to owner`, 'ok');
  ui.cart = {}; ui.shop = ''; ui.note = ''; ui.q = ''; go('today');
  openSheet({ type: 'order', oid: id });
}
function setStatus(oid, status, extra) { emit('status', { oid, status, ...(extra || {}) }); }
function review(payId, ok) { emit('pay_review', { payId, ok }); toast(ok ? '✅ Recovery approved — added to khata' : 'Recovery rejected', ok ? 'ok' : ''); if (ui.sheet) drawSheet(); }

/* ---------- components ---------- */
function orderCard(o, S, actions) {
  const c = S.customers[o.cid] || {};
  return `<div class="card click" onclick="openSheet({type:'order',oid:'${o.id}'})">
  <div class="row"><b>${esc(c.name)}</b><span class="badge ${o.status}">${STATUS[o.status]}</span></div>
  <div class="muted">${esc(o.no)} · ${esc(c.area)} · ${fmtD(o.ts)}${role() !== 'taker' ? ' · ' + esc(o.byName || '') : ''} ${o.pend ? '<span class="pendtag">· ⏳ not synced</span>' : ''}</div>
  <div class="items">${o.items.map(i => `${esc((S.products[i.pid] || {}).name)} <b>×${i.qty}</b>`).join(' · ')}</div>
  ${o.short && o.short.length ? `<div class="muted red" style="margin:-4px 0 6px">⚠️ Short / not sent: ${o.short.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}</div>` : ''}
  <div class="row"><b style="font-size:16px">${rs(o.total)}</b><span onclick="event.stopPropagation()">${actions || ''}</span></div></div>`;
}
function chips(opts) { return `<div class="chips">${opts.map(([k, l]) => `<button class="chip ${ui.filter === k ? 'act' : ''}" onclick="ui.filter='${k}';render()">${l}</button>`).join('')}</div>`; }
const kpi = (l, v, cls, click) => `<div class="kpi ${click ? 'click' : ''}" ${click ? `onclick="${click}"` : ''}><div class="l">${l}</div><div class="v ${cls || ''}">${v}</div></div>`;
const cashBal = S => sum(S.cash, c => c.type === 'in' ? c.amt : -c.amt);
function approvalCard(p, S) {
  const c = S.customers[p.cid] || {};
  return `<div class="card"><div class="row"><div><b>${esc(c.name)}</b><div class="muted">${esc(p.method || 'Cash')} · by ${esc(p.byName)} · ${fmtD(p.ts)}${p.pend ? ' · ⏳' : ''}</div>${p.note && p.note !== 'Recovery' ? `<div class="muted">📝 ${esc(p.note)}</div>` : ''}</div><b style="white-space:nowrap">${rs(p.amt)}</b></div>
  ${isOwner() ? `<div class="btns" style="margin-top:8px"><button class="btn sm" onclick="review('${p.id}',true)">✓ Approve</button><button class="btn sm red" onclick="review('${p.id}',false)">✕ Reject</button></div>` : '<div class="muted" style="color:#b45309">⏳ Waiting for owner approval</div>'}</div>`;
}
function prodPicker(S, cart, rateKey, qtyFn, qKey) {
  const prods = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name)); const qq = (ui[qKey] || '').toLowerCase();
  return `<input placeholder="Search product…" value="${esc(ui[qKey] || '')}" oninput="filterRows(this.value,'.prod.pk','${qKey}')" id="srch-${qKey}">
  <div class="card" style="padding:2px 14px;margin-top:8px">${prods.map(p => {
    const q = cart[p.id] || 0; const rate = ui[rateKey] === 'w' ? p.w : p.r;
    return `<div class="prod pk" data-n="${esc(p.name.toLowerCase())}" style="${p.name.toLowerCase().includes(qq) ? '' : 'display:none'}"><div><div class="pn">${esc(p.name)}</div><div class="muted">${rs(rate)} / ${esc(p.unit)} · <span class="${p.stock < 10 ? 'red' : ''}">stock ${p.stock}</span></div>${q > p.stock ? '<div class="muted red">More than available stock</div>' : ''}</div>
    <div class="step"><button onclick="${qtyFn}('${p.id}',-1)">−</button><span>${q}</span><button onclick="${qtyFn}('${p.id}',1)">+</button></div></div>`;
  }).join('') || empty('No products — add from Stock tab')}</div>`;
}

/* ---------- screens ---------- */
const V = {
  today(S) {
    const mine = Object.values(S.orders).filter(o => o.by === me().id && isToday(o.ts)).sort((a, b) => b.ts - a.ts);
    const myPays = Object.values(S.pays).filter(p => p.by === me().id && isToday(p.ts));
    const waiting = Object.values(S.pays).filter(p => p.by === me().id && p.status === 'pending');
    return `<div class="kpis">${kpi('Orders today', mine.length)}${kpi('Order value', rs(sum(mine, o => o.total)))}${kpi('Recovery today', rs(sum(myPays, p => p.amt)))}${kpi('Awaiting approval', rs(sum(waiting, p => p.amt)), waiting.length ? 'red' : '')}</div>
    ${D.outbox.length ? `<div class="warn">⏳ ${D.outbox.length} record(s) waiting to sync</div>` : ''}
    <div class="btns" style="margin-top:12px"><button class="btn" style="flex:1" onclick="go('new')">+ Take New Order</button><button class="btn alt" onclick="pdfOrders(sod(now()),eod(now()),me().id)">📄 Today PDF</button></div>
    ${waiting.length ? `<h2>Recovery waiting for owner</h2>${waiting.map(p => approvalCard(p, S)).join('')}` : ''}
    <h2>Today's orders</h2>${mine.map(o => orderCard(o, S)).join('') || empty('No orders yet today')}`;
  },
  new(S) {
    const shops = Object.values(S.customers).filter(c => c.type !== 'retail').sort((a, b) => a.name.localeCompare(b.name));
    const items = Object.entries(ui.cart).filter(([pid]) => S.products[pid]);
    const tot = sum(items, ([pid, q]) => { const p = S.products[pid]; return q * (ui.rate === 'w' ? p.w : p.r); });
    const n = sum(items, x => x[1]); const c = S.customers[ui.shop];
    return `<label style="margin-top:0">Shop / Customer</label>
    <select onchange="ui.shop=this.value;render()"><option value="">Select shop…</option>${shops.map(c => `<option value="${c.id}" ${ui.shop === c.id ? 'selected' : ''}>${esc(c.name)} — ${esc(c.area)}</option>`).join('')}</select>
    <div class="row" style="margin-top:6px"><span class="muted">${c ? `Previous balance: <b class="${c.bal > 0 ? 'red' : ''}">${rs(c.bal)}</b>` : ''}</span><button class="btn sm alt" onclick="openSheet({type:'addshop',fromOrder:1})">+ New shop</button></div>
    <label>Rate list</label><div class="seg"><button class="${ui.rate === 'w' ? 'act' : ''}" onclick="ui.rate='w';render()">Wholesale</button><button class="${ui.rate === 'r' ? 'act' : ''}" onclick="ui.rate='r';render()">Retail</button></div>
    <label>Products</label>${prodPicker(S, ui.cart, 'rate', 'qty', 'q')}
    <label>Note (optional)</label><input id="onote" placeholder="e.g. deliver before 2pm" value="${esc(ui.note)}" oninput="ui.note=this.value">
    <div style="height:80px"></div>
    <div class="cartbar"><div><div class="muted" style="margin:0">${n} unit(s) · ${ui.rate === 'w' ? 'Wholesale' : 'Retail'}</div><b style="font-size:18px">${rs(tot)}</b></div>
    <button class="btn" onclick="saveOrder()" ${n ? '' : 'disabled'}>Save Order</button></div>`;
  },
  counter(S) {
    const custs = Object.values(S.customers).sort((a, b) => (a.type === 'retail' ? 0 : 1) - (b.type === 'retail' ? 0 : 1) || a.name.localeCompare(b.name));
    const items = Object.entries(ui.ccart).filter(([pid]) => S.products[pid]);
    const tot = sum(items, ([pid, q]) => { const p = S.products[pid]; return q * (ui.crate === 'w' ? p.w : p.r); });
    const n = sum(items, x => x[1]); const c = S.customers[ui.ccid];
    const today = Object.values(S.counters).filter(x => isToday(x.ts)).sort((a, b) => b.ts - a.ts);
    return `<div class="kpis">${kpi("Today's counter sales", rs(sum(today, x => x.total)))}${kpi('On udhaar today', rs(sum(today, x => x.total - x.paid)), 'red')}</div>
    <label>Customer</label>
    <select onchange="ui.ccid=this.value;render()"><option value="">🚶 Walk-in (cash only)</option>${custs.map(c => `<option value="${c.id}" ${ui.ccid === c.id ? 'selected' : ''}>${c.type === 'retail' ? '🛒' : '🏪'} ${esc(c.name)} — bal ${n0(c.bal)}</option>`).join('')}</select>
    <div class="row" style="margin-top:6px"><span class="muted">${c ? `Khata balance: <b class="${c.bal > 0 ? 'red' : ''}">${rs(c.bal)}</b>` : 'Choose a customer to sell on udhaar'}</span><button class="btn sm alt" onclick="openSheet({type:'addshop',fromCounter:1})">+ New customer</button></div>
    <label>Rate</label><div class="seg"><button class="${ui.crate === 'r' ? 'act' : ''}" onclick="ui.crate='r';render()">Retail</button><button class="${ui.crate === 'w' ? 'act' : ''}" onclick="ui.crate='w';render()">Wholesale</button></div>
    <label>Products</label>${prodPicker(S, ui.ccart, 'crate', 'cqty', 'cq')}
    <h2>Today's counter sales</h2>${today.map(x => `<div class="card row click" onclick="pdfCounter('${x.id}')"><div><b>${esc(x.no || 'Sale')}</b> · ${esc(x.custName)}${x.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${fmtT(x.ts)} · paid ${rs(x.paid)}${x.total > x.paid ? ` · <span class="red">udhaar ${rs(x.total - x.paid)}</span>` : ''}</div></div><div style="text-align:right"><b>${rs(x.total)}</b><div class="muted">📄 receipt</div></div></div>`).join('') || empty('No counter sales today')}
    <div style="height:80px"></div>
    <div class="cartbar"><div><div class="muted" style="margin:0">${n} unit(s) · ${c ? esc(c.name) : 'Walk-in'}</div><b style="font-size:18px">${rs(tot)}</b></div>
    <button class="btn" onclick="openSheet({type:'checkout'})" ${n ? '' : 'disabled'}>Checkout →</button></div>`;
  },
  shops(S) {
    const own = isOwner();
    if (own && ui.filter === 'sup') {
      const sups = Object.values(S.suppliers).sort((a, b) => b.bal - a.bal);
      return chips([['shop', 'Shops'], ['retail', 'Counter customers'], ['sup', 'Suppliers']]) +
      `<div class="card row"><div><div class="muted" style="margin:0">Total payable to suppliers</div><div style="font-size:21px;font-weight:700" class="red">${rs(sum(sups, s => s.bal))}</div><div class="muted">${sups.length} suppliers</div></div><div class="btns" style="flex-direction:column"><button class="btn sm alt" onclick="openSheet({type:'addsup'})">+ Supplier</button><button class="btn sm alt" onclick="pdfPayables()">📄 PDF</button></div></div>
      ${sups.map(s => `<div class="card row click" onclick="openSheet({type:'sup',sid:'${s.id}'})"><div><b>${esc(s.name)}</b>${s.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${esc(s.city || '')} · ${esc(s.phone || '')}</div></div><div style="text-align:right"><b class="${s.bal > 0 ? 'red' : 'green'}">${rs(s.bal)}</b><div class="muted">${s.bal > 0 ? 'to pay' : s.bal < 0 ? 'advance' : 'clear'}</div></div></div>`).join('') || empty('No suppliers yet')}`;
    }
    let list = Object.values(S.customers);
    if (own) list = list.filter(c => ui.filter === 'retail' ? c.type === 'retail' : c.type !== 'retail');
    list.sort((a, b) => b.bal - a.bal);
    const pp = pendingPays(S);
    return (own ? chips([['shop', 'Shops'], ['retail', 'Counter customers'], ['sup', 'Suppliers']]) : '') +
    `<div class="card row"><div><div class="muted" style="margin:0">Total receivable (udhaar)</div><div style="font-size:21px;font-weight:700" class="red">${rs(sum(list, c => c.bal))}</div><div class="muted">${list.length} customers</div></div><div class="btns" style="flex-direction:column"><button class="btn sm alt" onclick="openSheet({type:'addshop',ctype:'${ui.filter === 'retail' ? 'retail' : 'shop'}'})">+ Add</button>${own ? '<button class="btn sm alt" onclick="pdfReceivables()">📄 PDF</button>' : ''}</div></div>
    ${own && pp.length ? `<div class="warn click" onclick="go('dash')">💰 ${pp.length} recovery payment(s) waiting for your approval →</div>` : ''}
    <input placeholder="Search name or area…" oninput="filterRows(this.value,'.li')" style="margin:10px 0">
    ${list.map(c => `<div class="card row click li" data-n="${esc((c.name + ' ' + c.area).toLowerCase())}" onclick="openSheet({type:'shop',cid:'${c.id}'})">
      <div><b>${esc(c.name)}</b>${c.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${esc(c.area)} · ${esc(c.phone)}</div>${c.awaiting ? `<div class="muted" style="color:#b45309">⏳ ${rs(c.awaiting)} recovery awaiting approval</div>` : ''}</div>
      <div style="text-align:right"><b class="${c.bal > 0 ? 'red' : 'green'}">${rs(c.bal)}</b><div class="muted">${c.bal > 0 ? 'to receive' : c.bal < 0 ? 'advance' : 'clear'}</div></div></div>`).join('') || empty('No customers yet')}`;
  },
  mine(S) {
    let l = Object.values(S.orders).filter(o => o.by === me().id).sort((a, b) => b.ts - a.ts);
    if (ui.filter !== 'all') l = l.filter(o => o.status === ui.filter);
    return chips([['all', 'All'], ['pending', 'Pending'], ['dispatched', 'Dispatched'], ['delivered', 'Delivered']]) + (l.slice(0, 100).map(o => orderCard(o, S)).join('') || empty('No orders'));
  },
  stock(S) {
    const ps = Object.values(S.products).sort((a, b) => a.stock - b.stock); const own = isOwner();
    return `<div class="kpis">${kpi('Products', ps.length)}${own ? kpi('Stock value (cost)', rs(sum(ps, p => p.stock * p.cost))) : kpi('Low stock', ps.filter(p => p.stock < 10).length, 'red')}</div>
    ${own ? `<div class="btns" style="margin-top:12px"><button class="btn" onclick="openPurchase()">+ Purchase (Stock In)</button><button class="btn alt" onclick="openSheet({type:'addprod'})">+ Product</button><button class="btn alt" onclick="pdfStock()">📄 PDF</button></div>` : ''}
    <h2>Current stock${own ? ' <span class="muted" style="text-transform:none">(tap a product for history / adjust)</span>' : ''}</h2><div class="card" style="padding:2px 14px">${ps.map(p => `<div class="prod ${own ? 'click' : ''}" ${own ? `onclick="openSheet({type:'prod',pid:'${p.id}'})"` : ''}><div><div class="pn">${esc(p.name)}${p.pend ? ' <span class="pendtag">⏳</span>' : ''}</div><div class="muted">W ${rs(p.w)} · R ${rs(p.r)}${own ? ' · Cost ' + rs(p.cost) : ''}</div></div>
      <div style="text-align:right"><b class="${p.stock < 10 ? 'red' : ''}" style="font-size:17px">${p.stock}</b><div class="muted">${esc(p.unit)}${p.stock < 10 ? ' · LOW' : ''}</div></div></div>`).join('') || empty('No products')}</div>
    ${own ? `<h2>Recent purchases</h2>${Object.values(S.purchases).sort((a, b) => b.ts - a.ts).slice(0, 15).map(pu => `<div class="card row click" onclick="pdfPurchase('${pu.id}')"><div><b>${esc(pu.no)}</b> · ${esc(pu.supName)}${pu.pend ? ' <span class="pendtag">⏳</span>' : ''}<div class="muted">${dshort(pu.ts)} · ${pu.items.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}</div></div><div style="text-align:right"><b>${rs(pu.total)}</b><div class="muted">${pu.paid < pu.total ? `<span class="red">due ${rs(pu.total - pu.paid)}</span>` : 'paid'}</div></div></div>`).join('') || empty('No purchases yet')}` : ''}`;
  },
  dash(S) {
    const ts = S.sales.filter(s => isToday(s.ts)); const recv = sum(Object.values(S.customers), c => c.bal);
    const pend = Object.values(S.orders).filter(o => o.status === 'pending'); const low = Object.values(S.products).filter(p => p.stock < 10);
    const days = []; for (let d = 6; d >= 0; d--) { const st = sod(now()) - d * 864e5; days.push({ l: d ? new Date(st).toLocaleDateString('en-PK', { weekday: 'short' }) : 'Today', v: sum(S.sales.filter(s => sod(s.ts) === st), s => s.amt) }); }
    const mx = Math.max(...days.map(x => x.v), 1);
    const todayOut = sum(S.cash.filter(c => c.type === 'out' && isToday(c.ts)), c => c.amt);
    const top = Object.values(S.customers).filter(c => c.bal > 0).sort((a, b) => b.bal - a.bal).slice(0, 5);
    const pp = pendingPays(S); const payable = sum(Object.values(S.suppliers), s => s.bal);
    return `${pp.length ? `<h2 style="margin-top:0">💰 Recovery to approve (${pp.length})</h2>${pp.map(p => approvalCard(p, S)).join('')}` : ''}
    <div class="kpis">${kpi("Today's sales", rs(sum(ts, s => s.amt)))}${kpi('Gross profit today', rs(sum(ts, s => s.profit)), 'green')}${kpi('Cash in hand', rs(cashBal(S)))}${kpi("Today's expenses", rs(todayOut))}${kpi('Receivable (udhaar)', rs(recv), 'red', "go('shops')")}${kpi('Payable to suppliers', rs(payable), 'red', "go('shops');ui.filter='sup';render()")}${kpi('Orders to dispatch', pend.length + ' →', pend.length ? 'red' : '', "go('orders')")}${kpi('Low stock items', low.length, low.length ? 'red' : '', "go('stock')")}</div>
    <button class="btn block alt" style="margin-top:12px" onclick="openSheet({type:'reports'})">📄 Reports & PDFs</button>
    <h2>Sales — last 7 days</h2><div class="card"><div class="bars">${days.map(x => `<div class="bw"><span class="bv">${x.v ? Math.round(x.v / 1000) + 'k' : ''}</span><div class="bar" style="height:${x.v / mx * 85}%"></div><span class="bl">${x.l}</span></div>`).join('')}</div></div>
    ${low.length ? `<h2>Low stock</h2><div class="card">${low.map(p => `<div class="row" style="padding:4px 0"><span>${esc(p.name)}</span><b class="red">${p.stock} ${esc(p.unit)}</b></div>`).join('')}<button class="btn sm alt" style="margin-top:8px" onclick="openPurchase()">+ Purchase</button></div>` : ''}
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
      : o.status === 'dispatched' ? `<button class="btn sm alt" onclick="pdfDispatchSlip('${o.id}')">📄 Slip</button> <button class="btn sm" onclick="openSheet({type:'deliver',oid:'${o.id}'})">Delivered ✓</button>` : `<button class="btn sm alt" onclick="pdfInvoice('${o.id}')">📄 Bill</button>`;
    const v = sum(all.filter(o => o.status === 'pending'), o => o.total);
    return `<div class="kpis" style="margin-bottom:10px">${kpi('To dispatch', cnt('pending') + ' · ' + rs(v))}${kpi('On route', cnt('dispatched'))}</div>
    <div class="btns" style="margin-bottom:10px"><button class="btn sm alt" onclick="pdfLoading(sod(now()))">📄 Today's loading sheet</button><button class="btn sm alt" onclick="pdfPicklist()">📄 Pending orders pick-list</button></div>`
      + chips([['pending', `To dispatch (${cnt('pending')})`], ['dispatched', `On route (${cnt('dispatched')})`], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']])
      + (l.slice(0, 100).map(o => orderCard(o, S, act(o))).join('') || empty(ui.filter === 'pending' ? 'All caught up 🎉 No orders to dispatch' : 'No orders'));
  },
  cash(S) {
    const tin = sum(S.cash.filter(c => c.type === 'in' && isToday(c.ts)), c => c.amt), tout = sum(S.cash.filter(c => c.type === 'out' && isToday(c.ts)), c => c.amt);
    const list = [...S.cash].sort((a, b) => b.ts - a.ts).slice(0, 150); let lastDay = null;
    return `<div class="card"><div class="muted" style="margin:0">Cash in hand</div><div style="font-size:24px;font-weight:700">${rs(cashBal(S))}</div>
    <div class="row" style="margin-top:8px"><span class="green">▲ In today ${rs(tin)}</span><span class="red">▼ Out today ${rs(tout)}</span></div></div>
    <div class="btns"><button class="btn alt" onclick="openSheet({type:'expense'})">+ Expense</button><button class="btn alt" onclick="openPurchase()">+ Purchase</button><button class="btn alt" onclick="openSheet({type:'suppay'})">+ Pay Supplier</button><button class="btn alt" onclick="openSheet({type:'reports'})">📄 PDF</button></div>
    ${list.map(c => {
      const d = sod(c.ts); const hd = d !== lastDay ? `<h2>${isToday(c.ts) ? 'Today' : new Date(c.ts).toLocaleDateString('en-PK', { weekday: 'short', day: 'numeric', month: 'short' })}</h2>` : ''; lastDay = d;
      const click = c.ref ? `onclick="${c.ref.t === 'counter' ? 'pdfCounter' : 'pdfPurchase'}('${c.ref.id}')"` : '';
      return hd + `<div class="card row ${click ? 'click' : ''}" ${click}><div><b style="font-size:13px">${esc(c.cat)}</b>${c.pend ? ' <span class="pendtag">⏳</span>' : ''}${click ? ' <span class="muted">📄</span>' : ''}<div class="muted">${esc(c.desc)}${c.byName ? ' · ' + esc(c.byName) : ''}</div></div><b class="${c.type === 'in' ? 'green' : 'red'}" style="white-space:nowrap">${c.type === 'in' ? '+' : '−'} ${rs(c.amt)}</b></div>`;
    }).join('')}`;
  },
};

/* ---------- sheets (pop-up forms) ---------- */
function openSheet(s) { ui.sheet = s; if (s.type === 'dispatch' && !s._keep) initDispatch(s.oid); drawSheet(); if (s.type === 'users') loadUsers(); }
function closeSheet() { ui.sheet = null; drawSheet(); }
function sh(title, body) { return `<div class="ov" onclick="if(event.target===this)closeSheet()"><div class="sh"><div class="row" style="margin-bottom:6px"><h3>${title}</h3><button class="x" onclick="closeSheet()">✕</button></div>${body}</div></div>`; }
const val = id => (document.getElementById(id) || {}).value || '';
const num = id => parseFloat(val(id)) || 0;
const methodSel = id => `<select id="${id}">${METHODS.map(m => `<option>${m}</option>`).join('')}</select>`;
const dateRange = () => `<div class="kpis"><div><label>From</label><input id="rf" type="date" value="${isoDay(now() - 29 * 864e5)}"></div><div><label>To</label><input id="rt" type="date" value="${isoDay(now())}"></div></div>`;
const rangeVals = () => [parseDay(val('rf') || isoDay(now())), eod(parseDay(val('rt') || isoDay(now())))];
function openPurchase(sid) { ui.plines = []; ui.psid = sid || ''; ui.ppaid = null; openSheet({ type: 'purchase' }); }

function drawSheet() {
  const el = document.getElementById('sheet'); const s = ui.sheet; if (!s || !sess) { el.innerHTML = ''; return; }
  const S = view(); let h = '';
  switch (s.type) {
    case 'account': h = sh(`${ROLE[role()].icon} ${esc(me().name)}`, `<div class="muted">${ROLE[role()].label} · @${esc(me().username)}</div>
      <div class="card" style="margin-top:12px;background:#f9fafb">
        <div class="row"><span>Internet</span><b class="${isOnline() ? 'green' : 'red'}">${isOnline() ? 'Connected' : 'Offline'}</b></div>
        <div class="row" style="margin-top:6px"><span>Waiting to sync</span><b class="${D.outbox.length ? 'red' : ''}">${D.outbox.length}</b></div>
        <div class="row" style="margin-top:6px"><span>Last synced</span><b>${ago(D.lastSync)}</b></div></div>
      <div class="btns"><button class="btn" onclick="sync(true)">⟳ Sync now</button>${isOwner() ? `<button class="btn alt" onclick="openSheet({type:'users'})">👥 Users</button><button class="btn alt" onclick="openSheet({type:'settings'})">🏢 Business details</button>` : ''}<button class="btn red" onclick="logout()">Log out</button></div>
      ${isOwner() ? `<button class="btn sm red" style="margin-top:14px" onclick="openSheet({type:'reset'})">🗑 Reset data…</button>` : ''}
      <p class="muted" style="margin-top:14px">Tip: add this app to your home screen (browser menu → “Add to Home screen” / “Install app”). It opens and works without internet.</p>`); break;
    case 'settings': { const st = S.settings; h = sh('🏢 Business details', `<p class="muted">Shown at the top of every bill, statement and report PDF.</p>
      <label>Business name</label><input id="bn" value="${esc(st.bizName)}"><label>Address</label><input id="ba" value="${esc(st.address)}">
      <label>Phone</label><input id="bp" value="${esc(st.phone)}"><label>Footer note on PDFs</label><input id="bf" value="${esc(st.footer)}">
      <button class="btn block" style="margin-top:14px" onclick="emit('settings',{bizName:val('bn'),address:val('ba'),phone:val('bp'),footer:val('bf')});closeSheet();toast('✅ Saved','ok')">Save</button>`); break; }
    case 'reset': h = sh('🗑 Reset data', `<p>This deletes <b>all</b> orders, khata, cash book, stock and suppliers on the server and on every phone. Users and PINs are kept.</p>
      <label>Type RESET to confirm</label><input id="rc" autocapitalize="characters">
      <div class="btns" style="margin-top:12px"><button class="btn red" onclick="doReset(false)">Start empty (go live)</button><button class="btn alt" onclick="doReset(true)">Reload demo data</button></div>`); break;
    case 'logoutwarn': h = sh('⚠️ Unsynced data', `<p>${D.outbox.length} record(s) on this phone have not reached the server yet. If you log out now they will be lost.</p>
      <div class="btns"><button class="btn" onclick="closeSheet();sync(true)">Sync first</button><button class="btn red" onclick="logout(true)">Log out anyway</button></div>`); break;
    case 'users': {
      const list = ui.userList || D.users || [];
      h = sh('👥 Users', `<p class="muted">Each person logs in on their own phone with username + PIN. Needs internet.</p>
      ${list.map(u => `<div class="card row"><div><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="badge cancelled">inactive</span>'}<div class="muted">@${esc(u.username)} · ${ROLE[u.role].label} · seen ${ago(u.lastSeen)}</div></div>
        <div class="btns" style="justify-content:flex-end"><button class="btn sm alt" onclick="openSheet({type:'pin',uid:'${u.id}'})">PIN</button>${u.id !== me().id ? `<button class="btn sm ${u.active ? 'red' : 'alt'}" onclick="toggleUser('${u.id}',${!u.active})">${u.active ? 'Disable' : 'Enable'}</button>` : ''}</div></div>`).join('')}
      <h2>Add user</h2>
      <label>Full name</label><input id="un" placeholder="e.g. Bilal">
      <label>Username</label><input id="uu" placeholder="e.g. bilal" autocapitalize="none">
      <label>PIN (4–8 digits)</label><input id="up" inputmode="numeric" placeholder="e.g. 4321">
      <label>Role</label><select id="ur"><option value="taker">Order Taker</option><option value="owner">Owner / Admin (also dispatches)</option></select>
      <button class="btn block" style="margin-top:14px" onclick="addUser()">Add user</button>`); break;
    }
    case 'pin': h = sh('Set new PIN', `<label>New PIN (4–8 digits)</label><input id="np1" inputmode="numeric"><button class="btn block" style="margin-top:14px" onclick="savePin('${s.uid}')">Save PIN</button>`); break;
    case 'reports': h = sh('📄 Reports & PDFs', `<p class="muted">Pick dates, then tap a report. Every PDF can be printed, downloaded or shared on WhatsApp.</p>${dateRange()}
      <div class="rgrid">
        <button class="btn alt" onclick="pdfSummary(...rangeVals())">📊 Business summary<br><span>sales, profit, cash</span></button>
        <button class="btn alt" onclick="pdfOrders(...rangeVals())">🧾 Orders report<br><span>by order taker</span></button>
        <button class="btn alt" onclick="pdfCashbook(...rangeVals())">💵 Cash book<br><span>all in / out</span></button>
        <button class="btn alt" onclick="pdfLoading(rangeVals()[0])">🚚 Loading sheet<br><span>"From" date</span></button>
        <button class="btn alt" onclick="pdfReceivables()">📒 Customer balances<br><span>all udhaar</span></button>
        <button class="btn alt" onclick="pdfPayables()">🏭 Supplier balances<br><span>all payables</span></button>
        <button class="btn alt" onclick="pdfStock()">🏬 Stock report<br><span>qty & value</span></button>
        <button class="btn alt" onclick="pdfAllStatements('c',...rangeVals())">📚 All customer statements<br><span>one PDF</span></button>
        <button class="btn alt" onclick="pdfAllStatements('s',...rangeVals())">📚 All supplier statements<br><span>one PDF</span></button>
      </div>`); break;
    case 'pdf': { const f = ui.pdf; if (!f) { closeSheet(); return; } const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([f.blob], f.name, { type: 'application/pdf' })] }));
      h = sh('📄 PDF ready', `<div class="card row" style="background:#f9fafb"><div><b>${esc(f.title)}</b><div class="muted">${esc(f.name)} · ${Math.max(1, Math.round(f.blob.size / 1024))} KB</div></div><span style="font-size:28px">📄</span></div>
      <div class="btns" style="flex-direction:column">
        <a class="btn block" href="${f.url}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">🖨️ Open / Print</a>
        <a class="btn block alt" href="${f.url}" download="${esc(f.name)}" style="text-align:center;text-decoration:none">⬇️ Download</a>
        ${canShare ? `<button class="btn block alt" onclick="sharePdf()">📤 Share (WhatsApp, etc.)</button>` : ''}
      </div><p class="muted" style="margin-top:10px">To print from a phone: Open → share/menu → Print.</p>`); break; }
    case 'order': {
      const o = S.orders[s.oid]; if (!o) { closeSheet(); return; } const c = S.customers[o.cid] || {};
      const r = role();
      h = sh(`Order ${esc(o.no)}`, `<div class="row"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.area)} · ${esc(c.phone)}</div></div><span class="badge ${o.status}">${STATUS[o.status]}</span></div>
      <table style="margin-top:10px"><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr>${o.items.map(i => `<tr><td>${esc((S.products[i.pid] || {}).name)}</td><td class="r">${i.qty}</td><td class="r">${n0(i.rate)}</td><td class="r">${n0(i.qty * i.rate)}</td></tr>`).join('')}
      <tr><td colspan="3"><b>Total</b> <span class="muted">(${o.rateType === 'r' ? 'retail' : 'wholesale'} rate)</span></td><td class="r"><b>${rs(o.total)}</b></td></tr></table>
      ${o.note ? `<div class="muted" style="margin-top:8px">📝 ${esc(o.note)}</div>` : ''}${o.vehicle ? `<div class="muted">🚚 ${esc(o.vehicle)}</div>` : ''}
      ${o.short && o.short.length ? `<div class="warn">⚠️ Not sent (short): ${o.short.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}. Bill is only for items sent.</div>` : ''}
      <div class="btns" style="margin-top:10px"><button class="btn sm alt" onclick="pdfOrderSlip('${o.id}')">📄 Order slip</button>${o.status === 'dispatched' || o.status === 'delivered' ? `<button class="btn sm alt" onclick="pdfDispatchSlip('${o.id}')">📄 Dispatch slip</button><button class="btn sm alt" onclick="pdfInvoice('${o.id}')">📄 Bill / Invoice</button>` : ''}<button class="btn sm alt" onclick="openSheet({type:'shop',cid:'${o.cid}'})">📒 Khata</button></div>
      <h2>History</h2><div class="hist">${o.hist.map(x => `<div><b>${STATUS[x.s]}</b> · ${fmtD(x.ts)}<br><span class="muted">by ${esc(x.byName || '')}${x.pend ? ' · ⏳ not synced' : ''}</span></div>`).join('')}</div>
      <div class="btns">${o.status === 'pending' && r !== 'taker' ? `<button class="btn" onclick="openSheet({type:'dispatch',oid:'${o.id}'})">Dispatch</button>` : ''}
      ${o.status === 'dispatched' && r !== 'taker' ? `<button class="btn" onclick="openSheet({type:'deliver',oid:'${o.id}'})">Mark delivered</button>` : ''}
      ${o.status === 'pending' && (r === 'owner' || o.by === me().id) ? `<button class="btn red" onclick="setStatus('${o.id}','cancelled');closeSheet();toast('Order cancelled')">Cancel order</button>` : ''}</div>`);
      break;
    }
    case 'dispatch': {
      const o = S.orders[s.oid]; if (!o) { closeSheet(); return; } const c = S.customers[o.cid] || {};
      const sendTot = sum(o.items, i => (ui.dq[i.pid] || 0) * i.rate); const nShort = o.items.filter(i => (ui.dq[i.pid] || 0) < i.qty).length;
      h = sh(`Dispatch ${esc(o.no)}`, `<b>${esc(c.name)}</b><div class="muted">${esc(c.area)} · ${esc(c.phone)}</div>
      <p class="muted" style="margin:8px 0 4px">Set the quantity you are actually loading. Missing items → set to 0 (or tap “Missing”).</p>
      ${o.items.map(i => { const p = S.products[i.pid] || {}; const q = ui.dq[i.pid] || 0; const short = q < i.qty;
        return `<div class="prod" style="${short ? 'background:#fff7ed;margin:0 -8px;padding:10px 8px;border-radius:8px' : ''}"><div><div class="pn">${esc(p.name)}</div>
        <div class="muted">Ordered <b>${i.qty}</b> · in stock <span class="${p.stock < i.qty ? 'red' : ''}">${p.stock}</span>${short ? ` · <span class="red">short ${i.qty - q}</span>` : ''}</div></div>
        <div style="text-align:right"><div class="step"><button onclick="dq('${i.pid}',-1)">−</button><span>${q}</span><button onclick="dq('${i.pid}',1)">+</button></div>
        <div style="margin-top:4px">${q ? `<button class="btn sm red" style="padding:3px 8px" onclick="dqSet('${i.pid}',0)">Missing</button>` : `<button class="btn sm alt" style="padding:3px 8px" onclick="dqSet('${i.pid}',${i.qty})">Full ${i.qty}</button>`}</div></div></div>`; }).join('')}
      <div class="row" style="margin-top:10px"><span>Bill for items sent</span><b style="font-size:18px">${rs(sendTot)}</b></div>
      ${nShort ? `<div class="muted red">Ordered total was ${rs(o.total)} — ${nShort} item(s) short</div>
        <label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" id="bko" style="width:auto" ${ui.dbko ? 'checked' : ''} onchange="ui.dbko=this.checked"> Keep missing items as a new pending order (back-order)</label>` : ''}
      <label>Vehicle / Rider</label><select id="veh" onchange="ui.dveh=this.value">${VEHICLES.map(v => `<option ${ui.dveh === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <p class="muted">Dispatching adds the bill to the shop's khata, reduces stock and opens the printable dispatch slip.</p>
      <button class="btn block" onclick="confirmDispatch('${o.id}')" ${sendTot ? '' : 'disabled'}>Confirm Dispatch</button>`);
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
      const led = custLedger(S, c.id); const rows = [...led].reverse();
      const aw = Object.values(S.pays).filter(p => p.cid === c.id && p.status === 'pending');
      h = sh(esc(c.name), `<div class="muted">${c.type === 'retail' ? '🛒 Counter customer' : '🏪 Shop'} · ${esc(c.area)} · ${esc(c.phone)}</div>
      <div class="card row" style="margin-top:10px;background:#f9fafb"><span>Balance</span><b class="${c.bal > 0 ? 'red' : 'green'}" style="font-size:20px">${rs(c.bal)}</b></div>
      <div class="btns"><button class="btn" onclick="openSheet({type:'pay',cid:'${c.id}'})">Receive Payment</button>${role() === 'taker' && c.type !== 'retail' ? `<button class="btn alt" onclick="ui.shop='${c.id}';closeSheet();go('new')">New Order</button>` : ''}${isOwner() ? `<button class="btn alt" onclick="ui.ccid='${c.id}';closeSheet();go('counter')">Counter sale</button>` : ''}</div>
      ${aw.length ? `<h2>Awaiting owner approval</h2>${aw.map(p => approvalCard(p, S)).join('')}` : ''}
      <div class="kpis" style="margin-top:10px">${kpi('Total billed', rs(sum(led, l => l.dr)))}${kpi('Total received', rs(sum(led, l => l.cr)), 'green')}</div>
      <div class="row"><h2>Khata (ledger)</h2><div class="btns" style="margin:0"><button class="btn sm alt" onclick="openSheet({type:'stmt',kind:'c',id:'${c.id}'})">📄 Statement PDF</button><button class="btn sm alt" onclick="copyStmt('${c.id}')">📋 Text</button></div></div>
      <table><tr><th>Date</th><th>Detail</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Bal</th></tr>
      ${rows.map(l => { const sub = l.oid && S.orders[l.oid] ? S.orders[l.oid].items : l.csid && S.counters[l.csid] ? S.counters[l.csid].items : null;
        return `<tr><td class="muted" style="white-space:nowrap">${dshort(l.ts)}</td><td>${esc(l.desc)}${l.pend ? ' ⏳' : ''}${sub ? `<div class="muted">${sub.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}</div>` : ''}</td><td class="r">${l.dr ? n0(l.dr) : ''}</td><td class="r green">${l.cr ? n0(l.cr) : ''}</td><td class="r"><b>${n0(l.run)}</b></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No entries yet</td></tr>'}</table>`);
      break;
    }
    case 'stmt': { const name = s.kind === 'c' ? (S.customers[s.id] || {}).name : (S.suppliers[s.id] || {}).name;
      h = sh('📄 Statement — ' + esc(name), `${dateRange()}<div class="btns" style="margin-top:8px"><button class="btn sm alt" onclick="document.getElementById('rf').value='2000-01-01'">All time</button><button class="btn sm alt" onclick="document.getElementById('rf').value=isoDay(new Date(new Date().getFullYear(),new Date().getMonth(),1))">This month</button></div>
      <button class="btn block" style="margin-top:14px" onclick="${s.kind === 'c' ? 'pdfCustStmt' : 'pdfSupStmt'}('${s.id}',...rangeVals())">Create PDF</button>`); break; }
    case 'pay': {
      const c = S.customers[s.cid]; const tk = role() === 'taker';
      h = sh('Receive Payment', `<b>${esc(c.name)}</b><div class="muted">Current balance ${rs(c.bal)}</div>
      ${tk ? '<div class="warn" style="background:#fffbeb;color:#92400e">This recovery will be added to the khata after the owner approves it.</div>' : ''}
      <label>Amount</label><input id="amt" type="number" inputmode="numeric" placeholder="e.g. 10000">
      <label>Method</label>${methodSel('meth')}
      <label>Note</label><input id="pnote" placeholder="Recovery">
      <button class="btn block" style="margin-top:14px" onclick="confirmPay('${c.id}')">${tk ? 'Send for approval' : 'Save Payment'}</button>`);
      break;
    }
    case 'addshop': { const t = s.fromCounter ? 'retail' : (s.ctype || 'shop');
      h = sh('Add Customer', `<label>Type</label><select id="st"><option value="shop" ${t === 'shop' ? 'selected' : ''}>🏪 Shop (distribution)</option><option value="retail" ${t === 'retail' ? 'selected' : ''}>🛒 Counter customer</option></select>
      <label>Name</label><input id="sn" placeholder="e.g. Lal Chand Karyana">
      <label>Area</label><input id="sa" placeholder="e.g. Latifabad No. 8"><label>Phone</label><input id="sp" type="tel" placeholder="03xx-xxxxxxx">
      <label>Opening balance (old udhaar)</label><input id="sob" type="number" placeholder="0">
      <button class="btn block" style="margin-top:14px" onclick="confirmShop(${s.fromOrder ? 1 : 0},${s.fromCounter ? 1 : 0})">Save</button>`); break; }
    case 'checkout': {
      const items = Object.entries(ui.ccart).filter(([pid]) => S.products[pid]).map(([pid, qty]) => { const p = S.products[pid]; return { pid, qty, rate: ui.crate === 'w' ? p.w : p.r }; });
      const tot = sum(items, i => i.qty * i.rate); const c = S.customers[ui.ccid];
      h = sh('🛒 Checkout', `<div class="row"><b>${c ? esc(c.name) : '🚶 Walk-in customer'}</b><b style="font-size:20px">${rs(tot)}</b></div>
      ${c ? `<div class="muted">Previous khata balance ${rs(c.bal)}</div>` : ''}
      <table style="margin-top:8px">${items.map(i => `<tr><td>${esc(S.products[i.pid].name)}</td><td class="r">${i.qty} × ${n0(i.rate)}</td><td class="r">${n0(i.qty * i.rate)}</td></tr>`).join('')}</table>
      <label>Amount received now</label><input id="cpaid" type="number" inputmode="numeric" value="${tot}" oninput="ckUpd(${tot},${c ? 1 : 0})">
      <div class="btns" style="margin-top:6px"><button class="btn sm alt" onclick="document.getElementById('cpaid').value=${tot};ckUpd(${tot},${c ? 1 : 0})">Full cash</button>${c ? `<button class="btn sm alt" onclick="document.getElementById('cpaid').value=0;ckUpd(${tot},1)">All on udhaar</button>` : ''}</div>
      <div id="ckmsg" class="muted" style="margin-top:6px"></div>
      <label>Method</label>${methodSel('cmeth')}
      <button class="btn block" style="margin-top:14px" id="ckbtn" onclick="confirmCounter()">Save Sale</button>`);
      setTimeout(() => ckUpd(tot, c ? 1 : 0)); break;
    }
    case 'cdone': { const x = S.counters[s.id];
      h = sh('✅ Sale saved', `<div class="card" style="background:#f0fdf4"><div class="row"><b>${esc(x ? x.no : '')}</b><b>${rs(x ? x.total : 0)}</b></div><div class="muted">${esc(x ? x.custName : '')} · paid ${rs(x ? x.paid : 0)}${x && x.total > x.paid ? ` · <span class="red">${rs(x.total - x.paid)} added to khata</span>` : ''}</div></div>
      <div class="btns"><button class="btn" onclick="pdfCounter('${s.id}')">📄 Receipt PDF</button><button class="btn alt" onclick="closeSheet()">New sale</button></div>`); break; }
    case 'expense': h = sh('Add Expense', `<label>Category</label><select id="ec"><option>Fuel</option><option>Loading / Labour</option><option>Salary</option><option>Rent</option><option>Electricity / Utility</option><option>Vehicle Repair</option><option>Other</option></select>
      <label>Detail</label><input id="ed" placeholder="e.g. Diesel for pickup"><label>Amount</label><input id="ea" type="number" inputmode="numeric">
      <button class="btn block" style="margin-top:14px" onclick="confirmExpense()">Save Expense</button>`); break;
    case 'purchase': {
      const ps = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name)); const sups = Object.values(S.suppliers).sort((a, b) => a.name.localeCompare(b.name));
      window._costs = Object.fromEntries(ps.map(p => [p.id, p.cost]));
      const tot = sum(ui.plines, l => l.qty * l.cost); const sp = S.suppliers[ui.psid]; const paid = ui.ppaid == null ? tot : ui.ppaid;
      h = sh('🏭 Purchase / Stock In', `<label style="margin-top:0">Supplier</label>
      <select onchange="ui.psid=this.value;ui.sheet._keep=1;drawSheet()"><option value="">Cash purchase (no supplier account)</option>${sups.map(x => `<option value="${x.id}" ${ui.psid === x.id ? 'selected' : ''}>${esc(x.name)} — payable ${n0(x.bal)}</option>`).join('')}</select>
      <div class="row" style="margin-top:6px"><span class="muted">${sp ? `Currently payable: <b class="red">${rs(sp.bal)}</b>` : ''}</span><button class="btn sm alt" onclick="openSheet({type:'addsup',fromPurchase:1})">+ New supplier</button></div>
      <h2>Items</h2>${ui.plines.map((l, i) => `<div class="row" style="padding:6px 0;border-bottom:1px solid #f1f2f4"><span>${esc((S.products[l.pid] || {}).name)}<div class="muted">${l.qty} × ${n0(l.cost)}</div></span><span><b>${n0(l.qty * l.cost)}</b> <button class="x" onclick="ui.plines.splice(${i},1);ui.sheet._keep=1;drawSheet()">✕</button></span></div>`).join('') || '<div class="muted">No items yet — add below</div>'}
      <div class="card" style="margin-top:10px;background:#f9fafb"><label style="margin-top:0">Product</label><select id="lp2" onchange="document.getElementById('lc').value=_costs[this.value]">${ps.map(p => `<option value="${p.id}">${esc(p.name)} (stock ${p.stock})</option>`).join('')}</select>
      <div class="kpis"><div><label>Qty</label><input id="lq" type="number" inputmode="numeric" placeholder="e.g. 50"></div><div><label>Cost / unit</label><input id="lc" type="number" value="${ps[0] ? ps[0].cost : ''}"></div></div>
      <button class="btn sm alt" style="margin-top:10px" onclick="addPLine()">+ Add item</button></div>
      <div class="row" style="margin-top:12px"><b>Total</b><b style="font-size:19px">${rs(tot)}</b></div>
      <label>Paid now</label><input id="ppd" type="number" inputmode="numeric" value="${paid}" oninput="ui.ppaid=parseFloat(this.value)||0">
      ${sp ? `<div class="muted">Unpaid amount is added to ${esc(sp.name)}'s account.</div>` : '<div class="muted">Without a supplier, the full amount must be paid now.</div>'}
      <label>Method</label>${methodSel('pmeth')}
      <button class="btn block" style="margin-top:14px" onclick="confirmPurchase()" ${ui.plines.length ? '' : 'disabled'}>Save Purchase</button>`);
      break;
    }
    case 'addsup': h = sh('Add Supplier', `<label>Name</label><input id="sun" placeholder="e.g. Sindh Ghee Mills"><label>City</label><input id="suc" placeholder="Hyderabad"><label>Phone</label><input id="sup" type="tel">
      <label>Opening balance (we already owe)</label><input id="suo" type="number" placeholder="0">
      <button class="btn block" style="margin-top:14px" onclick="confirmSup(${s.fromPurchase ? 1 : 0})">Save Supplier</button>`); break;
    case 'sup': {
      const sp = S.suppliers[s.sid]; if (!sp) { closeSheet(); return; }
      const led = supLedger(S, sp.id); const rows = [...led].reverse();
      h = sh('🏭 ' + esc(sp.name), `<div class="muted">${esc(sp.city || '')} · ${esc(sp.phone || '')}</div>
      <div class="card row" style="margin-top:10px;background:#f9fafb"><span>Payable</span><b class="${sp.bal > 0 ? 'red' : 'green'}" style="font-size:20px">${rs(sp.bal)}</b></div>
      <div class="btns"><button class="btn" onclick="openSheet({type:'suppay',sid:'${sp.id}'})">Pay Supplier</button><button class="btn alt" onclick="openPurchase('${sp.id}')">+ Purchase</button><button class="btn alt" onclick="openSheet({type:'stmt',kind:'s',id:'${sp.id}'})">📄 Statement PDF</button></div>
      <div class="kpis" style="margin-top:10px">${kpi('Total purchased', rs(sum(led, l => l.bill)))}${kpi('Total paid', rs(sum(led, l => l.paid)), 'green')}</div>
      <h2>Supplier account</h2><table><tr><th>Date</th><th>Detail</th><th class="r">Purchase</th><th class="r">Paid</th><th class="r">Bal</th></tr>
      ${rows.map(l => { const pu = l.puid && S.purchases[l.puid]; return `<tr><td class="muted" style="white-space:nowrap">${dshort(l.ts)}</td><td>${esc(l.desc)}${l.pend ? ' ⏳' : ''}${pu ? `<div class="muted">${pu.items.map(i => esc((S.products[i.pid] || {}).name) + ' ×' + i.qty).join(', ')}</div>` : ''}</td><td class="r">${l.bill ? n0(l.bill) : ''}</td><td class="r green">${l.paid ? n0(l.paid) : ''}</td><td class="r"><b>${n0(l.run)}</b></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No entries yet</td></tr>'}</table>`);
      break;
    }
    case 'suppay': { const sups = Object.values(S.suppliers).sort((a, b) => b.bal - a.bal);
      h = sh('Pay Supplier', `<label style="margin-top:0">Supplier</label><select id="ssid">${sups.map(x => `<option value="${x.id}" ${s.sid === x.id ? 'selected' : ''}>${esc(x.name)} — payable ${n0(x.bal)}</option>`).join('')}</select>
      <label>Amount</label><input id="samt" type="number" inputmode="numeric"><label>Method</label>${methodSel('smeth')}<label>Note</label><input id="snote" placeholder="Payment">
      <button class="btn block" style="margin-top:14px" onclick="confirmSupPay()" ${sups.length ? '' : 'disabled'}>Save Payment</button>`); break; }
    case 'prod': {
      const p = S.products[s.pid]; if (!p) { closeSheet(); return; }
      let run = 0; const mvs = S.moves.filter(m => m.pid === p.id).sort((a, b) => a.ts - b.ts).map(m => { run += m.qty; return { ...m, run }; }).reverse();
      h = sh(esc(p.name), `<div class="muted">${esc(p.unit)} · cost ${rs(p.cost)} · wholesale ${rs(p.w)} · retail ${rs(p.r)}</div>
      <div class="card row" style="margin-top:10px;background:#f9fafb"><span>In stock</span><b class="${p.stock < 10 ? 'red' : ''}" style="font-size:22px">${p.stock} <span class="muted">${esc(p.unit)}</span></b></div>
      <div class="btns"><button class="btn" onclick="openPurchase()">+ Purchase</button><button class="btn alt" onclick="openSheet({type:'adj',pid:'${p.id}'})">± Adjust stock</button><button class="btn alt" onclick="openSheet({type:'editprod',pid:'${p.id}'})">✏️ Edit rates</button></div>
      <h2>Stock movements</h2><table><tr><th>Date</th><th>Type</th><th class="r">In</th><th class="r">Out</th><th class="r">Stock</th></tr>
      ${mvs.slice(0, 80).map(m => `<tr><td class="muted" style="white-space:nowrap">${dshort(m.ts)}</td><td>${esc(m.type)} <span class="muted">${esc(m.ref)}</span>${m.pend ? ' ⏳' : ''}</td><td class="r green">${m.qty > 0 ? m.qty : ''}</td><td class="r red">${m.qty < 0 ? -m.qty : ''}</td><td class="r"><b>${m.run}</b></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No movements</td></tr>'}</table>`);
      break;
    }
    case 'adj': { const p = S.products[s.pid];
      h = sh('± Adjust stock — ' + esc(p.name), `<p class="muted">Use for damaged / expired goods, free samples, or to correct the count after a physical stock check. Purchases and sales already update stock automatically.</p>
      <div class="card row" style="background:#f9fafb"><span>Stock in app</span><b>${p.stock} ${esc(p.unit)}</b></div>
      <div class="seg"><button class="${ui.adjm !== 'count' ? 'act' : ''}" onclick="ui.adjm='chg';ui.sheet._keep=1;drawSheet()">Add / remove</button><button class="${ui.adjm === 'count' ? 'act' : ''}" onclick="ui.adjm='count';ui.sheet._keep=1;drawSheet()">Set counted stock</button></div>
      ${ui.adjm === 'count' ? `<label>Actual stock counted</label><input id="adq" type="number" inputmode="numeric" value="${p.stock}">` : `<label>Quantity (+ to add, − to remove)</label><input id="adq" type="number" inputmode="numeric" placeholder="e.g. -2">`}
      <label>Reason</label><select id="adr"><option>Damaged / expired</option><option>Physical count correction</option><option>Free sample / gift</option><option>Returned by customer</option><option>Returned to supplier</option><option>Other</option></select>
      <button class="btn block" style="margin-top:14px" onclick="confirmAdj('${p.id}',${p.stock})">Save adjustment</button>`); break; }
    case 'editprod': { const p = S.products[s.pid];
      h = sh('✏️ Edit ' + esc(p.name), `<label>Name</label><input id="ep" value="${esc(p.name)}"><label>Unit</label><input id="eu" value="${esc(p.unit)}">
      <div class="kpis"><div><label>Cost</label><input id="ec2" type="number" value="${p.cost}"></div><div><label>Wholesale rate</label><input id="ew" type="number" value="${p.w}"></div><div><label>Retail rate</label><input id="er" type="number" value="${p.r}"></div></div>
      <p class="muted">New rates apply to new orders and sales. Old bills keep their rates.</p>
      <button class="btn block" onclick="emit('product_upd',{id:'${p.id}',name:val('ep'),unit:val('eu'),cost:num('ec2'),w:num('ew'),r:num('er')});openSheet({type:'prod',pid:'${p.id}'});toast('✅ Updated','ok')">Save</button>`); break; }
    case 'addprod': h = sh('New Product', `<label>Name</label><input id="np" placeholder="e.g. Olpers 1L"><label>Unit</label><input id="nu" placeholder="ctn (12)">
      <div class="kpis"><div><label>Cost</label><input id="nc" type="number"></div><div><label>Wholesale rate</label><input id="nw" type="number"></div><div><label>Retail rate</label><input id="nr" type="number"></div><div><label>Opening stock</label><input id="ns" type="number" value="0"></div></div>
      <button class="btn block" style="margin-top:14px" onclick="confirmProd()">Save Product</button>`); break;
  }
  const old = el.querySelector('.sh'); const top = old ? old.scrollTop : 0;
  el.innerHTML = h; const ns = el.querySelector('.sh'); if (ns && s._keep) { ns.scrollTop = top; s._keep = 0; }
}
function ckUpd(tot, hasC) {
  const p = parseFloat(val('cpaid')) || 0; const m = document.getElementById('ckmsg'); const b = document.getElementById('ckbtn'); if (!m) return;
  if (p > tot) { m.innerHTML = `<span class="green">Change to return: ${rs(p - tot)}</span>`; b.disabled = false; }
  else if (p < tot && !hasC) { m.innerHTML = '<span class="red">Walk-in sale must be paid in full. Choose a customer to give udhaar.</span>'; b.disabled = true; }
  else if (p < tot) { m.innerHTML = `<span class="red">${rs(tot - p)} will be added to the customer's khata (udhaar)</span>`; b.disabled = false; }
  else { m.textContent = 'Paid in full'; b.disabled = false; }
}
function initDispatch(oid) {
  const S = view(); const o = S.orders[oid]; if (!o) return; ui.dq = {}; ui.dbko = true; ui.dveh = ui.dveh || VEHICLES[0];
  o.items.forEach(i => { const st = (S.products[i.pid] || {}).stock || 0; ui.dq[i.pid] = Math.max(0, Math.min(i.qty, st)); });
}
function dq(pid, d) { const o = view().orders[ui.sheet.oid]; const max = (o.items.find(i => i.pid === pid) || {}).qty || 0; ui.dq[pid] = Math.max(0, Math.min(max, (ui.dq[pid] || 0) + d)); ui.sheet._keep = 1; drawSheet(); }
function dqSet(pid, v) { ui.dq[pid] = v; ui.sheet._keep = 1; drawSheet(); }
function confirmDispatch(oid) {
  const S = view(); const o = S.orders[oid];
  const items = o.items.map(i => ({ ...i, qty: ui.dq[i.pid] || 0 })).filter(i => i.qty > 0);
  if (!items.length) { toast('Nothing to dispatch — cancel the order instead'); return; }
  const short = o.items.map(i => ({ ...i, qty: i.qty - (ui.dq[i.pid] || 0) })).filter(i => i.qty > 0);
  setStatus(oid, 'dispatched', { vehicle: val('veh') || ui.dveh, items, short });
  if (short.length && ui.dbko) {
    emit('order', { id: uid(), no: o.no + '-B', cid: o.cid, items: short, total: sum(short, i => i.qty * i.rate), rateType: o.rateType, note: 'Back-order of ' + o.no + ' (items short at dispatch)' }, true);
    toast(`🚚 ${o.no} dispatched · back-order ${o.no}-B created for missing items`, 'ok');
  } else toast(`🚚 ${o.no} dispatched${short.length ? ` · ${short.length} item(s) excluded` : ''}`, 'ok');
  pdfDispatchSlip(oid);
}
function confirmAdj(pid, cur) {
  let q = num('adq'); if (ui.adjm === 'count') q = q - cur;
  if (!q) { toast('No change'); return; }
  emit('stock_adj', { pid, qty: q, reason: val('adr') }); toast(`✅ Stock ${q > 0 ? '+' : ''}${q}`, 'ok'); openSheet({ type: 'prod', pid });
}
function addPLine() { const pid = val('lp2'), q = num('lq'), c = num('lc'); if (!pid || q <= 0) { toast('Enter quantity'); return; } ui.plines.push({ pid, qty: q, cost: c }); ui.ppaid = null; ui.sheet._keep = 1; drawSheet(); }
function confirmDeliver(oid) {
  const o = view().orders[oid]; const amt = num('amt'); const m = val('meth');
  setStatus(oid, 'delivered');
  if (amt > 0) emit('payment', { cid: o.cid, amt, method: m, note: 'Collected on delivery ' + o.no }, true);
  closeSheet(); toast(`✅ ${o.no} delivered${amt ? ' · ' + rs(amt) + ' collected' : ' · on credit'}`, 'ok');
}
function confirmPay(cid) {
  const amt = num('amt'); if (amt <= 0) { toast('Enter an amount'); return; }
  emit('payment', { cid, amt, method: val('meth'), note: val('pnote') || 'Recovery' });
  toast(role() === 'taker' ? `📨 ${rs(amt)} sent to owner for approval` : `✅ ${rs(amt)} received`, 'ok'); openSheet({ type: 'shop', cid });
}
function confirmShop(fromOrder, fromCounter) {
  const name = val('sn').trim(); if (!name) { toast('Enter name'); return; } const id = uid(); const ob = num('sob');
  emit('customer', { id, name, area: val('sa') || (val('st') === 'retail' ? 'Counter customer' : ''), phone: val('sp'), type: val('st') }); if (ob) emit('opening', { cid: id, amt: ob }, true);
  toast('✅ Customer added', 'ok');
  if (fromOrder) ui.shop = id; if (fromCounter) ui.ccid = id; closeSheet(); render();
}
function confirmSup(fromPurchase) {
  const name = val('sun').trim(); if (!name) { toast('Enter supplier name'); return; } const id = uid(); const ob = num('suo');
  emit('supplier', { id, name, city: val('suc'), phone: val('sup') }); if (ob) emit('sopening', { sid: id, amt: ob }, true);
  toast('✅ Supplier added', 'ok'); if (fromPurchase) { ui.psid = id; openSheet({ type: 'purchase' }); } else closeSheet();
}
function confirmPurchase() {
  const tot = sum(ui.plines, l => l.qty * l.cost); let paid = num('ppd'); const sid = ui.psid;
  if (!sid && paid < tot) { toast('Choose a supplier to buy on credit, or pay in full'); return; }
  if (paid > tot) paid = tot;
  const id = uid(); const no = nextNo('purchase', 'PO');
  emit('purchase', { id, no, sid, items: ui.plines, total: tot, paid, method: val('pmeth'), note: '' });
  ui.plines = []; closeSheet(); toast(`✅ ${no} saved — stock updated${tot > paid ? ` · ${rs(tot - paid)} payable` : ''}`, 'ok');
}
function confirmSupPay() { const amt = num('samt'); if (amt <= 0) { toast('Enter an amount'); return; } emit('supplier_pay', { sid: val('ssid'), amt, method: val('smeth'), note: val('snote') || 'Payment' }); closeSheet(); toast('✅ Supplier payment saved', 'ok'); }
function confirmExpense() { const amt = num('ea'); if (amt <= 0) { toast('Enter an amount'); return; } emit('expense', { cat: val('ec'), desc: val('ed') || val('ec'), amt }); closeSheet(); toast('✅ Expense saved', 'ok'); }
function confirmProd() {
  const name = val('np').trim(); if (!name) { toast('Enter product name'); return; }
  emit('product', { id: uid(), name, unit: val('nu') || 'pcs', cost: num('nc'), w: num('nw'), r: num('nr'), stock: num('ns') }); closeSheet(); toast('✅ Product added', 'ok');
}
function confirmCounter() {
  const S = view(); const items = Object.entries(ui.ccart).filter(([pid]) => S.products[pid]).map(([pid, qty]) => { const p = S.products[pid]; return { pid, qty, rate: ui.crate === 'w' ? p.w : p.r }; });
  if (!items.length) return; const total = sum(items, i => i.qty * i.rate); let paid = Math.min(num('cpaid'), total);
  if (!ui.ccid && paid < total) { toast('Walk-in sale must be paid in full'); return; }
  const id = uid(); const no = nextNo('counter', 'CS');
  emit('counter', { id, no, cid: ui.ccid, cust: ui.ccid ? '' : 'Walk-in', items, total, paid, method: val('cmeth') });
  ui.ccart = {}; ui.ccid = ''; ui.cq = ''; render(); openSheet({ type: 'cdone', id });
}
async function doReset(demo) {
  if (val('rc').trim().toUpperCase() !== 'RESET') { toast('Type RESET to confirm'); return; }
  try { await api('/api/reset', { confirm: 'RESET', demo }); D.events = []; D.seq = 0; D.outbox = []; D.epoch = null; saveData(); closeSheet(); toast(demo ? 'Demo data reloaded' : 'All data cleared — ready to go live', 'ok'); sync(); }
  catch (e) { toast('❌ ' + (e.status ? e.message : 'Needs internet')); }
}
function copyStmt(cid) {
  const S = view(); const c = S.customers[cid];
  const lines = custLedger(S, cid).map(l => `${dshort(l.ts)}  ${l.desc}  ${l.dr ? '+' + n0(l.dr) : '-' + n0(l.cr)}  = ${n0(l.run)}`);
  const t = `*${S.settings.bizName}*\n*${c.name}* — Account Statement\n\n${lines.slice(-20).join('\n')}\n\n*Balance due: ${rs(c.bal)}*`;
  try { navigator.clipboard.writeText(t).then(() => toast('📋 Statement copied — paste in WhatsApp', 'ok'), () => toast('Copy not allowed here')); } catch (e) { toast('Copy not allowed here'); }
}
/* user admin (owner, online only) */
async function loadUsers() { try { ui.userList = await api('/api/users'); if (ui.sheet && ui.sheet.type === 'users') drawSheet(); } catch (e) { toast('Connect to internet to manage users', 'off'); } }
async function addUser() {
  try { await api('/api/users', { name: val('un').trim(), username: val('uu').trim().toLowerCase(), pin: val('up').trim(), role: val('ur') }); toast('✅ User added', 'ok'); loadUsers(); }
  catch (e) { toast('❌ ' + e.message); }
}
async function toggleUser(id, active) { try { await api('/api/users/' + id, { active }, 'PATCH'); loadUsers(); } catch (e) { toast('❌ ' + e.message); } }
async function savePin(id) { try { await api('/api/users/' + id, { pin: val('np1').trim() }, 'PATCH'); toast('✅ PIN updated', 'ok'); openSheet({ type: 'users' }); } catch (e) { toast('❌ ' + e.message); } }

/* =================== PDF =================== */
function loadPdfLib() {
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
  const add = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load PDF tool')); document.head.appendChild(s); });
  return add('/vendor/jspdf.umd.min.js').then(() => add('/vendor/jspdf.plugin.autotable.min.js'));
}
const PDFRS = n => 'Rs ' + n0(n);
async function makePdf(title, fname, draw, landscape) {
  try {
    await loadPdfLib();
    const S = view(); const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'l' : 'p' });
    draw(doc, S);
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(); const np = doc.getNumberOfPages();
    for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(140); doc.text(`${S.settings.footer || ''}  ·  Printed ${new Date().toLocaleString('en-PK')}  ·  TradeBook`, 14, H - 8); doc.text(`Page ${i} of ${np}`, W - 14, H - 8, { align: 'right' }); }
    const blob = doc.output('blob');
    if (ui.pdf && ui.pdf.url) URL.revokeObjectURL(ui.pdf.url);
    ui.pdf = { blob, title, name: fname.replace(/[^\w.-]+/g, '_') + '.pdf', url: URL.createObjectURL(blob) };
    openSheet({ type: 'pdf' });
  } catch (e) { console.error(e); toast('❌ PDF failed: ' + e.message); }
}
async function sharePdf() {
  const f = ui.pdf; try { await navigator.share({ files: [new File([f.blob], f.name, { type: 'application/pdf' })], title: f.title }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing not available — use Download'); }
}
function pHead(doc, S, title, sub) {
  const W = doc.internal.pageSize.getWidth(); const st = S.settings;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(15, 118, 110); doc.text(st.bizName || 'My Business', 14, 15);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(95); doc.text([st.address, st.phone].filter(Boolean).join('  ·  '), 14, 20.5);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(25); doc.text(title, W - 14, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(95); if (sub) doc.text(sub, W - 14, 20.5, { align: 'right' });
  doc.setDrawColor(15, 118, 110); doc.setLineWidth(0.6); doc.line(14, 24, W - 14, 24); doc.setTextColor(25);
  return 31;
}
function pKV(doc, y, pairs, x) {
  x = x || 14; doc.setFontSize(9);
  pairs.forEach(([k, v], i) => { doc.setTextColor(110); doc.text(k, x, y + i * 5); doc.setTextColor(25); doc.text(String(v ?? ''), x + 26, y + i * 5); });
  return y + pairs.length * 5 + 2;
}
function pTable(doc, y, head, body, opts) {
  const right = (opts && opts.right) || []; const cs = {}; right.forEach(i => cs[i] = { halign: 'right' });
  doc.autoTable({ startY: y, head: [head], body, theme: 'grid', margin: { left: 14, right: 14 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold', fontSize: 8.5 }, styles: { fontSize: 8.5, cellPadding: 1.7, textColor: 25, lineColor: [215, 220, 225] },
    columnStyles: { ...cs, ...((opts && opts.cs) || {}) }, foot: opts && opts.foot ? [opts.foot] : undefined,
    footStyles: { fillColor: [240, 245, 244], textColor: 25, fontStyle: 'bold' }, showFoot: 'lastPage' });
  return doc.lastAutoTable.finalY + 6;
}
function pTotals(doc, y, rows) {
  const W = doc.internal.pageSize.getWidth(); if (y > 255) { doc.addPage(); y = 20; }
  rows.forEach(([k, v, b], i) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(b ? 10.5 : 9.5); doc.text(k, W - 80, y + i * 6); doc.text(v, W - 14, y + i * 6, { align: 'right' }); });
  doc.setFont('helvetica', 'normal'); return y + rows.length * 6 + 4;
}
function pH2(doc, y, t) { if (y > 260) { doc.addPage(); y = 20; } doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(15, 118, 110); doc.text(t, 14, y); doc.setFont('helvetica', 'normal'); doc.setTextColor(25); return y + 3; }
function pSign(doc, y, a, b) {
  const W = doc.internal.pageSize.getWidth(); if (y > 262) { doc.addPage(); y = 30; } y += 14; doc.setDrawColor(150); doc.setLineWidth(0.3); doc.setFontSize(8.5); doc.setTextColor(110);
  doc.line(14, y, 74, y); doc.text(a || 'Prepared by', 14, y + 4.5); doc.line(W - 74, y, W - 14, y); doc.text(b || 'Received by (sign & stamp)', W - 74, y + 4.5); doc.setTextColor(25);
}
const pname = (S, pid) => (S.products[pid] || {}).name || '?';
const punit = (S, pid) => (S.products[pid] || {}).unit || '';

function pdfOrderSlip(oid) {
  const S0 = view(); const o0 = S0.orders[oid]; if (!o0) return;
  makePdf('Order slip ' + o0.no, 'Order_' + o0.no, (doc, S) => {
    const o = S.orders[oid]; const c = S.customers[o.cid] || {};
    let y = pHead(doc, S, 'ORDER SLIP', `${o.no}  ·  ${dstr(o.ts)} ${fmtT(o.ts)}`);
    y = pKV(doc, y, [['Customer', c.name], ['Area', c.area], ['Phone', c.phone], ['Order taker', o.byName], ['Status', STATUS[o.status]], ['Rate', o.rateType === 'r' ? 'Retail' : 'Wholesale']]);
    y = pTable(doc, y, ['#', 'Item', 'Unit', 'Qty', 'Rate', 'Amount'], o.items.map((i, k) => [k + 1, pname(S, i.pid), punit(S, i.pid), i.qty, n0(i.rate), n0(i.qty * i.rate)]), { right: [3, 4, 5], foot: ['', 'Total', '', sum(o.items, i => i.qty), '', PDFRS(o.total)] });
    if (o.note) { doc.setFontSize(9); doc.text('Note: ' + o.note, 14, y); y += 6; }
    pSign(doc, y, 'Order taker', 'Shopkeeper');
  });
}
function pdfDispatchSlip(oid) {
  const S0 = view(); const o0 = S0.orders[oid]; if (!o0) return;
  makePdf('Dispatch slip ' + o0.no, 'Dispatch_slip_' + o0.no, (doc, S) => {
    const o = S.orders[oid]; const c = S.customers[o.cid] || {}; const ord = o.ordered || o.items;
    let y = pHead(doc, S, 'DISPATCH SLIP / DELIVERY CHALLAN', `${o.no}  ·  ${dstr(o.dispatchedAt || now())} ${fmtT(o.dispatchedAt || now())}`);
    pKV(doc, y, [['Deliver to', c.name], ['Area', c.area], ['Phone', c.phone]]);
    y = pKV(doc, y, [['Vehicle', o.vehicle || '-'], ['Order date', dstr(o.ts)], ['Booked by', o.byName]], 110);
    const body = ord.map((i, k) => { const sent = (o.items.find(x => x.pid === i.pid) || {}).qty || 0; return [k + 1, pname(S, i.pid), punit(S, i.pid), i.qty, sent, i.qty - sent ? i.qty - sent : '', '']; });
    y = pTable(doc, y + 2, ['#', 'Item', 'Unit', 'Ordered', 'Dispatched', 'Short', 'Checked'], body, { right: [3, 4, 5], cs: { 4: { fontStyle: 'bold' }, 6: { cellWidth: 18 } }, foot: ['', 'Total', '', sum(ord, i => i.qty), sum(o.items, i => i.qty), sum(o.short || [], i => i.qty) || '', ''] });
    if (o.short && o.short.length) { doc.setFontSize(9); doc.setTextColor(170, 40, 40); doc.text('Short / not sent: ' + o.short.map(i => pname(S, i.pid) + ' x' + i.qty).join(', ') + '. These are NOT billed.', 14, y, { maxWidth: 180 }); doc.setTextColor(25); y += 8; }
    doc.setFontSize(9.5); doc.text(`Bill amount for goods dispatched: ${PDFRS(o.total)}`, 14, y); y += 4;
    const W = doc.internal.pageSize.getWidth(); y += 16; doc.setDrawColor(150); doc.setLineWidth(0.3); doc.setFontSize(8.5); doc.setTextColor(110);
    [['Loaded by', 14], ['Driver', 80], ['Received by (shop)', 146]].forEach(([t, x]) => { doc.line(x, y, x + 50, y); doc.text(t, x, y + 4.5); });
  });
}
function pdfInvoice(oid) {
  const S0 = view(); const o0 = S0.orders[oid]; if (!o0) return;
  makePdf('Bill ' + o0.no, 'Bill_' + o0.no, (doc, S) => {
    const o = S.orders[oid]; const c = S.customers[o.cid] || {};
    const L = custLedger(S, o.cid); const idx = L.findIndex(l => l.oid === o.id); const prev = idx > 0 ? L[idx - 1].run : 0;
    const recv = sum(L.filter(l => l.cr && l.desc.includes(o.no)), l => l.cr);
    let y = pHead(doc, S, 'SALES INVOICE / BILL', `${o.no}  ·  ${dstr(o.dispatchedAt || o.ts)}`);
    pKV(doc, y, [['Bill to', c.name], ['Area', c.area], ['Phone', c.phone]]);
    y = pKV(doc, y, [['Order date', dstr(o.ts)], ['Booked by', o.byName], ['Vehicle', o.vehicle || '-']], 110);
    y = pTable(doc, y + 2, ['#', 'Item', 'Unit', 'Qty', 'Rate', 'Amount'], o.items.map((i, k) => [k + 1, pname(S, i.pid), punit(S, i.pid), i.qty, n0(i.rate), n0(i.qty * i.rate)]), { right: [3, 4, 5], foot: ['', 'Bill total', '', sum(o.items, i => i.qty), '', PDFRS(o.total)] });
    if (o.short && o.short.length) { doc.setFontSize(8.5); doc.setTextColor(170, 40, 40); doc.text('Not supplied (short, not billed): ' + o.short.map(i => pname(S, i.pid) + ' x' + i.qty).join(', '), 14, y - 2, { maxWidth: 180 }); doc.setTextColor(25); y += 5; }
    const after = prev + o.total - recv; const rows = [['Previous balance', PDFRS(prev)], ['This bill', PDFRS(o.total)], ['Total due', PDFRS(prev + o.total), true], ['Received on delivery', PDFRS(recv)], ['Balance after this bill', PDFRS(after), true]];
    if (Math.round(after) !== Math.round(c.bal)) rows.push(['Current balance (today)', PDFRS(c.bal)]);
    y = pTotals(doc, y, rows);
    pSign(doc, y, 'For ' + (S.settings.bizName || ''), 'Received goods (sign & stamp)');
  });
}
function pdfCounter(id) {
  const S0 = view(); const x0 = S0.counters[id]; if (!x0) { toast('Sync first'); return; }
  makePdf('Receipt ' + (x0.no || ''), 'Receipt_' + (x0.no || id), (doc, S) => {
    const x = S.counters[id]; const c = x.cid && S.customers[x.cid];
    let y = pHead(doc, S, 'CASH MEMO / RECEIPT', `${x.no || ''}  ·  ${dstr(x.ts)} ${fmtT(x.ts)}`);
    y = pKV(doc, y, [['Customer', x.custName], ['Phone', c ? c.phone : '-'], ['Payment', x.method || 'Cash']]);
    y = pTable(doc, y, ['#', 'Item', 'Qty', 'Rate', 'Amount'], x.items.map((i, k) => [k + 1, pname(S, i.pid), i.qty, n0(i.rate), n0(i.qty * i.rate)]), { right: [2, 3, 4], foot: ['', 'Total', sum(x.items, i => i.qty), '', PDFRS(x.total)] });
    const rows = [['Total', PDFRS(x.total), true], ['Paid', PDFRS(x.paid)]];
    if (x.total > x.paid) rows.push(['Added to khata (udhaar)', PDFRS(x.total - x.paid), true]);
    if (c) rows.push(['Khata balance now', PDFRS(c.bal), true]);
    pTotals(doc, y, rows);
  });
}
function pdfPurchase(id) {
  const S0 = view(); const p0 = S0.purchases[id]; if (!p0) return;
  makePdf('Purchase ' + p0.no, 'Purchase_' + p0.no, (doc, S) => {
    const p = S.purchases[id]; const s = p.sid && S.suppliers[p.sid];
    let y = pHead(doc, S, 'PURCHASE VOUCHER', `${p.no}  ·  ${dstr(p.ts)}`);
    y = pKV(doc, y, [['Supplier', p.supName], ['City', s ? s.city : '-'], ['Phone', s ? s.phone : '-'], ['Payment', p.method || 'Cash']]);
    y = pTable(doc, y, ['#', 'Item', 'Unit', 'Qty', 'Cost', 'Amount'], p.items.map((i, k) => [k + 1, pname(S, i.pid), punit(S, i.pid), i.qty, n0(i.cost), n0(i.qty * i.cost)]), { right: [3, 4, 5], foot: ['', 'Total', '', sum(p.items, i => i.qty), '', PDFRS(p.total)] });
    const rows = [['Purchase total', PDFRS(p.total), true], ['Paid now', PDFRS(p.paid)], ['Unpaid (added to account)', PDFRS(p.total - p.paid), true]];
    if (s) rows.push(['Supplier balance now', PDFRS(s.bal), true]);
    y = pTotals(doc, y, rows); pSign(doc, y, 'Received by', 'Supplier');
  });
}
function stmtPage(doc, S, kind, id, from, to) {
  const isC = kind === 'c'; const ent = isC ? S.customers[id] : S.suppliers[id];
  const L = isC ? custLedger(S, id) : supLedger(S, id);
  const before = L.filter(l => l.ts < from); const open = before.length ? before[before.length - 1].run : 0;
  const rows = L.filter(l => l.ts >= from && l.ts <= to);
  const shownFrom = L.length && from < L[0].ts ? L[0].ts : from;
  let y = pHead(doc, S, isC ? 'CUSTOMER STATEMENT' : 'SUPPLIER STATEMENT', `${dstr(shownFrom)} – ${dstr(to)}`);
  y = pKV(doc, y, isC ? [['Customer', ent.name], ['Area', ent.area], ['Phone', ent.phone]] : [['Supplier', ent.name], ['City', ent.city], ['Phone', ent.phone]]);
  const body = [['', 'Opening balance', '', '', n0(open)]];
  rows.forEach(l => {
    let det = l.desc;
    if (isC && l.oid && S.orders[l.oid]) det += '\n' + S.orders[l.oid].items.map(i => pname(S, i.pid) + ' x' + i.qty).join(', ');
    if (isC && l.csid && S.counters[l.csid]) det += '\n' + S.counters[l.csid].items.map(i => pname(S, i.pid) + ' x' + i.qty).join(', ');
    if (!isC && l.puid && S.purchases[l.puid]) det += '\n' + S.purchases[l.puid].items.map(i => pname(S, i.pid) + ' x' + i.qty).join(', ');
    body.push([dstr(l.ts), det, isC ? (l.dr ? n0(l.dr) : '') : (l.bill ? n0(l.bill) : ''), isC ? (l.cr ? n0(l.cr) : '') : (l.paid ? n0(l.paid) : ''), n0(l.run)]);
  });
  const tA = sum(rows, l => isC ? l.dr : l.bill), tB = sum(rows, l => isC ? l.cr : l.paid); const close = rows.length ? rows[rows.length - 1].run : open;
  y = pTable(doc, y, ['Date', 'Detail', isC ? 'Debit (bill)' : 'Purchase', isC ? 'Credit (paid)' : 'Paid', 'Balance'], body, { right: [2, 3, 4], cs: { 0: { cellWidth: 24 } }, foot: ['', 'Totals for period', n0(tA), n0(tB), n0(close)] });
  y = pTotals(doc, y, [['Opening balance', PDFRS(open)], [isC ? 'Billed in period' : 'Purchased in period', PDFRS(tA)], [isC ? 'Received in period' : 'Paid in period', PDFRS(tB)], [isC ? 'Balance due' : 'Balance payable', PDFRS(close), true]]);
  if (isC && ent.awaiting) { doc.setFontSize(8.5); doc.setTextColor(150, 90, 0); doc.text(`Note: ${PDFRS(ent.awaiting)} recovery is awaiting approval and is not included above.`, 14, y); doc.setTextColor(25); }
}
function pdfCustStmt(cid, from, to) { const c = view().customers[cid]; makePdf('Statement — ' + c.name, 'Statement_' + c.name + '_' + isoDay(to), (doc, S) => stmtPage(doc, S, 'c', cid, from, to)); }
function pdfSupStmt(sid, from, to) { const s = view().suppliers[sid]; makePdf('Supplier statement — ' + s.name, 'Supplier_' + s.name + '_' + isoDay(to), (doc, S) => stmtPage(doc, S, 's', sid, from, to)); }
function pdfAllStatements(kind, from, to) {
  const S0 = view(); const ids = kind === 'c' ? Object.values(S0.customers).filter(c => c.bal !== 0 || S0.ledger.some(l => l.cid === c.id && l.ts >= from && l.ts <= to)).map(c => c.id) : Object.values(S0.suppliers).map(s => s.id);
  if (!ids.length) { toast('Nothing to print'); return; }
  makePdf(`All ${kind === 'c' ? 'customer' : 'supplier'} statements (${ids.length})`, `${kind === 'c' ? 'Customer' : 'Supplier'}_statements_${isoDay(to)}`, (doc, S) => ids.forEach((id, i) => { if (i) doc.addPage(); stmtPage(doc, S, kind, id, from, to); }));
}
function pdfLoading(day) {
  makePdf('Loading sheet ' + dstr(day), 'Loading_sheet_' + isoDay(day), (doc, S) => {
    const os = Object.values(S.orders).filter(o => o.dispatchedAt && sod(o.dispatchedAt) === sod(day)).sort((a, b) => a.dispatchedAt - b.dispatchedAt);
    let y = pHead(doc, S, 'LOADING SHEET / DISPATCH', dstr(day));
    if (!os.length) { doc.setFontSize(10); doc.text('No orders dispatched on this date.', 14, y + 4); return; }
    const byV = {}; os.forEach(o => (byV[o.vehicle || 'No vehicle'] = byV[o.vehicle || 'No vehicle'] || []).push(o));
    Object.entries(byV).forEach(([v, list]) => {
      y = pH2(doc, y, `${v}  —  ${list.length} order(s)`);
      y = pTable(doc, y + 2, ['Bill #', 'Shop', 'Area', 'Items', 'Amount', 'Cash rec.', 'Sign'], list.map(o => { const c = S.customers[o.cid] || {}; return [o.no, c.name, c.area, o.items.map(i => pname(S, i.pid) + ' x' + i.qty).join(', '), n0(o.total), '', '']; }), { right: [4], cs: { 3: { cellWidth: 55 }, 5: { cellWidth: 18 }, 6: { cellWidth: 18 } }, foot: ['', 'Total', '', '', n0(sum(list, o => o.total)), '', ''] });
      const qty = {}; list.forEach(o => o.items.forEach(i => qty[i.pid] = (qty[i.pid] || 0) + i.qty));
      y = pTable(doc, y, ['Load summary — item', 'Unit', 'Total qty'], Object.entries(qty).map(([pid, q]) => [pname(S, pid), punit(S, pid), q]), { right: [2] });
    });
    pSign(doc, y, 'Loaded by', 'Driver');
  });
}
function pdfPicklist() {
  makePdf('Pending orders pick-list', 'Picklist_' + isoDay(now()), (doc, S) => {
    const os = Object.values(S.orders).filter(o => o.status === 'pending').sort((a, b) => a.ts - b.ts);
    let y = pHead(doc, S, 'PENDING ORDERS / PICK-LIST', dstr(now()));
    y = pTable(doc, y, ['Order #', 'Date', 'Shop', 'Area', 'Booker', 'Items', 'Amount'], os.map(o => { const c = S.customers[o.cid] || {}; return [o.no, dshort(o.ts), c.name, c.area, o.byName, o.items.map(i => pname(S, i.pid) + ' x' + i.qty).join(', '), n0(o.total)]; }), { right: [6], cs: { 5: { cellWidth: 50 } }, foot: ['', '', '', '', '', 'Total', n0(sum(os, o => o.total))] });
    const qty = {}; os.forEach(o => o.items.forEach(i => qty[i.pid] = (qty[i.pid] || 0) + i.qty));
    y = pH2(doc, y, 'Items to pick');
    pTable(doc, y + 2, ['Item', 'Unit', 'Qty needed', 'In stock', 'Short'], Object.entries(qty).map(([pid, q]) => { const p = S.products[pid] || {}; return [p.name, p.unit, q, p.stock, Math.max(0, q - p.stock) || '']; }), { right: [2, 3, 4] });
  });
}
function pdfOrders(from, to, userId) {
  makePdf('Orders report', 'Orders_' + isoDay(from) + (from !== sod(to) ? '_to_' + isoDay(to) : ''), (doc, S) => {
    let os = Object.values(S.orders).filter(o => o.ts >= from && o.ts <= to); if (userId) os = os.filter(o => o.by === userId);
    os.sort((a, b) => a.ts - b.ts);
    let y = pHead(doc, S, userId ? 'MY ORDERS REPORT' : 'ORDERS REPORT', `${dstr(from)} – ${dstr(to)}`);
    if (userId) y = pKV(doc, y, [['Order taker', me().name]]);
    y = pTable(doc, y, ['Order #', 'Date', 'Shop', 'Area', 'Booker', 'Status', 'Amount'], os.map(o => { const c = S.customers[o.cid] || {}; return [o.no, dshort(o.ts) + ' ' + fmtT(o.ts), c.name, c.area, o.byName, STATUS[o.status], n0(o.total)]; }), { right: [6], foot: ['', '', `${os.length} orders`, '', '', '', n0(sum(os, o => o.total))] });
    const by = {}; os.forEach(o => { const k = o.byName || '-'; by[k] = by[k] || { n: 0, v: 0 }; by[k].n++; by[k].v += o.total; });
    if (!userId) { y = pH2(doc, y, 'By order taker'); y = pTable(doc, y + 2, ['Order taker', 'Orders', 'Value'], Object.entries(by).map(([k, v]) => [k, v.n, n0(v.v)]), { right: [1, 2] }); }
    const qty = {}; os.filter(o => o.status !== 'cancelled').forEach(o => o.items.forEach(i => { qty[i.pid] = qty[i.pid] || { q: 0, v: 0 }; qty[i.pid].q += i.qty; qty[i.pid].v += i.qty * i.rate; }));
    y = pH2(doc, y, 'Items ordered'); pTable(doc, y + 2, ['Item', 'Unit', 'Qty', 'Value'], Object.entries(qty).map(([pid, x]) => [pname(S, pid), punit(S, pid), x.q, n0(x.v)]), { right: [2, 3] });
    const rec = Object.values(S.pays).filter(p => p.ts >= from && p.ts <= to && (!userId || p.by === userId));
    if (rec.length) { y = doc.lastAutoTable.finalY + 6; y = pH2(doc, y, 'Recovery collected by order takers'); pTable(doc, y + 2, ['Date', 'Customer', 'By', 'Method', 'Status', 'Amount'], rec.map(p => [dshort(p.ts), (S.customers[p.cid] || {}).name, p.byName, p.method, p.status, n0(p.amt)]), { right: [5], foot: ['', '', '', '', 'Total', n0(sum(rec, p => p.amt))] }); }
  });
}
function pdfReceivables() {
  makePdf('Customer balances', 'Customer_balances_' + isoDay(now()), (doc, S) => {
    let y = pHead(doc, S, 'CUSTOMER BALANCES (RECEIVABLE)', 'As of ' + dstr(now()));
    [['shop', 'Shops'], ['retail', 'Counter customers']].forEach(([t, lbl]) => {
      const list = Object.values(S.customers).filter(c => (t === 'retail') === (c.type === 'retail')).sort((a, b) => b.bal - a.bal);
      if (!list.length) return; y = pH2(doc, y, lbl);
      y = pTable(doc, y + 2, ['#', 'Name', 'Area', 'Phone', 'Last activity', 'Balance'], list.map((c, i) => { const L = custLedger(S, c.id); return [i + 1, c.name, c.area, c.phone, L.length ? dshort(L[L.length - 1].ts) : '-', n0(c.bal)]; }), { right: [5], foot: ['', 'Total', '', '', '', PDFRS(sum(list, c => c.bal))] });
    });
    pTotals(doc, y, [['Total receivable', PDFRS(sum(Object.values(S.customers), c => c.bal)), true]]);
  });
}
function pdfPayables() {
  makePdf('Supplier balances', 'Supplier_balances_' + isoDay(now()), (doc, S) => {
    let y = pHead(doc, S, 'SUPPLIER BALANCES (PAYABLE)', 'As of ' + dstr(now()));
    const list = Object.values(S.suppliers).sort((a, b) => b.bal - a.bal);
    y = pTable(doc, y, ['#', 'Supplier', 'City', 'Phone', 'Total purchased', 'Total paid', 'Payable'], list.map((s, i) => { const L = supLedger(S, s.id); return [i + 1, s.name, s.city, s.phone, n0(sum(L, l => l.bill)), n0(sum(L, l => l.paid)), n0(s.bal)]; }), { right: [4, 5, 6], foot: ['', 'Total', '', '', '', '', PDFRS(sum(list, s => s.bal))] });
  });
}
function pdfStock() {
  makePdf('Stock report', 'Stock_' + isoDay(now()), (doc, S) => {
    let y = pHead(doc, S, 'STOCK REPORT', 'As of ' + dstr(now()));
    const ps = Object.values(S.products).sort((a, b) => a.name.localeCompare(b.name));
    pTable(doc, y, ['#', 'Product', 'Unit', 'Stock', 'Cost', 'Wholesale', 'Retail', 'Stock value'], ps.map((p, i) => [i + 1, p.name + (p.stock < 10 ? '  (LOW)' : ''), p.unit, p.stock, n0(p.cost), n0(p.w), n0(p.r), n0(p.stock * p.cost)]), { right: [3, 4, 5, 6, 7], foot: ['', 'Total', '', sum(ps, p => p.stock), '', '', '', PDFRS(sum(ps, p => p.stock * p.cost))] });
  });
}
function pdfCashbook(from, to) {
  makePdf('Cash book', 'Cashbook_' + isoDay(from) + '_to_' + isoDay(to), (doc, S) => {
    const before = S.cash.filter(c => c.ts < from); const open = sum(before, c => c.type === 'in' ? c.amt : -c.amt);
    const list = S.cash.filter(c => c.ts >= from && c.ts <= to).sort((a, b) => a.ts - b.ts);
    let y = pHead(doc, S, 'CASH BOOK', `${dstr(from)} – ${dstr(to)}`); let run = open;
    const body = [['', '', 'Opening cash', '', '', n0(open)]].concat(list.map(c => { run += c.type === 'in' ? c.amt : -c.amt; return [dshort(c.ts), c.cat, c.desc, c.type === 'in' ? n0(c.amt) : '', c.type === 'out' ? n0(c.amt) : '', n0(run)]; }));
    y = pTable(doc, y, ['Date', 'Type', 'Detail', 'In', 'Out', 'Balance'], body, { right: [3, 4, 5], cs: { 2: { cellWidth: 70 } }, foot: ['', '', 'Totals', n0(sum(list.filter(c => c.type === 'in'), c => c.amt)), n0(sum(list.filter(c => c.type === 'out'), c => c.amt)), n0(run)] });
    pTotals(doc, y, [['Opening cash', PDFRS(open)], ['Cash in', PDFRS(sum(list.filter(c => c.type === 'in'), c => c.amt))], ['Cash out', PDFRS(sum(list.filter(c => c.type === 'out'), c => c.amt))], ['Closing cash', PDFRS(run), true]]);
  });
}
function pdfSummary(from, to) {
  makePdf('Business summary', 'Summary_' + isoDay(from) + '_to_' + isoDay(to), (doc, S) => {
    const inR = t => t >= from && t <= to;
    const sales = S.sales.filter(s => inR(s.ts)); const ws = sales.filter(s => s.kind === 'wholesale'), rt = sales.filter(s => s.kind === 'retail');
    const cash = S.cash.filter(c => inR(c.ts)); const byCat = {}; cash.forEach(c => { const k = c.type + '|' + c.cat; byCat[k] = (byCat[k] || 0) + c.amt; });
    const purch = Object.values(S.purchases).filter(p => inR(p.ts));
    const cs = Object.values(S.counters).filter(x => inR(x.ts));
    let y = pHead(doc, S, 'BUSINESS SUMMARY', `${dstr(from)} – ${dstr(to)}`);
    y = pTable(doc, y, ['Item', 'Amount'], [
      ['Wholesale sales (bills dispatched)', n0(sum(ws, s => s.amt))], ['Counter sales', n0(sum(rt, s => s.amt))], ['   of which given on udhaar', n0(sum(cs, x => x.total - x.paid))],
      ['Total sales', n0(sum(sales, s => s.amt))], ['Gross profit (sale - cost)', n0(sum(sales, s => s.profit))],
      ['Recovery received', n0(byCat['in|Recovery'] || 0)], ['Purchases (total value)', n0(sum(purch, p => p.total))], ['   paid at purchase', n0(byCat['out|Purchase'] || 0)],
      ['Paid to suppliers', n0(byCat['out|Supplier Payment'] || 0)], ['Expenses', n0(sum(cash.filter(c => c.type === 'out' && !['Purchase', 'Supplier Payment'].includes(c.cat)), c => c.amt))],
      ['Cash in (all)', n0(sum(cash.filter(c => c.type === 'in'), c => c.amt))], ['Cash out (all)', n0(sum(cash.filter(c => c.type === 'out'), c => c.amt))],
    ], { right: [1] });
    y = pTotals(doc, y, [['Cash in hand now', PDFRS(cashBal(S)), true], ['Total receivable now', PDFRS(sum(Object.values(S.customers), c => c.bal))], ['Total payable now', PDFRS(sum(Object.values(S.suppliers), s => s.bal))]]);
    const exp = {}; cash.filter(c => c.type === 'out' && !['Purchase', 'Supplier Payment'].includes(c.cat)).forEach(c => exp[c.cat] = (exp[c.cat] || 0) + c.amt);
    if (Object.keys(exp).length) { y = pH2(doc, y, 'Expenses by category'); y = pTable(doc, y + 2, ['Category', 'Amount'], Object.entries(exp).map(([k, v]) => [k, n0(v)]), { right: [1] }); }
    const days = {}; sales.forEach(s => { const k = sod(s.ts); days[k] = days[k] || { w: 0, r: 0, p: 0 }; days[k][s.kind === 'wholesale' ? 'w' : 'r'] += s.amt; days[k].p += s.profit; });
    y = pH2(doc, y, 'Day by day'); pTable(doc, y + 2, ['Date', 'Wholesale', 'Counter', 'Total', 'Profit'], Object.keys(days).sort().map(k => [dstr(+k), n0(days[k].w), n0(days[k].r), n0(days[k].w + days[k].r), n0(days[k].p)]), { right: [1, 2, 3, 4] });
  });
}

/* ---------- render ---------- */
function header(S) {
  const on = isOnline(), pend = D.outbox.length, sy = ui.syncing;
  return `<header><div><div class="brand">${esc(S.settings.bizName && S.settings.bizName !== 'My Business' ? S.settings.bizName : 'TradeBook')}</div><div class="who">${ROLE[role()].label}</div></div>
  <div class="hd-r"><button class="net ${on ? 'on' : 'off'} ${sy ? 'sy' : ''}" onclick="sync(true)"><span class="dot"></span>${on ? (sy ? 'Syncing…' : 'Online') : 'Offline'}${pend ? ` · ${pend}` : ''}</button>
  <button class="uchip" onclick="openSheet({type:'account'})">${ROLE[role()].icon} ${esc(me().name.split(' ')[0])} ▾</button></div></header>
  ${!on ? `<div class="banner off">📴 <b>No internet.</b> Keep working — ${pend} record${pend === 1 ? '' : 's'} saved on this phone will sync automatically.</div>` : pend ? `<div class="banner sync">⟳ ${pend} record${pend === 1 ? '' : 's'} waiting to sync…</div>` : ''}`;
}
function loginView() {
  return `<form class="login" onsubmit="login(event)"><div class="logo">📦</div><h1>TradeBook</h1><div class="muted" style="margin-bottom:18px">Orders · Dispatch · Khata · Suppliers · Cash book — works offline</div>
  <label>Username</label><input id="lu" autocapitalize="none" autocomplete="username" placeholder="e.g. ali">
  <label>PIN</label><input id="lp" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••">
  <button class="btn block" style="margin-top:16px" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Logging in…' : 'Log in'}</button>
  <div class="card" style="margin-top:18px;font-size:13px"><b>Demo logins</b><div class="muted">Owner: <b>owner</b> / 1234<br>Order taker: <b>ali</b> / 1111</div></div></form>`;
}
function render() {
  const app = document.getElementById('app'); app.className = sess ? 'in' : 'out';
  if (!sess) { if (!document.getElementById('lu')) app.innerHTML = loginView(); else app.querySelector('button.btn').disabled = ui.busy; return; }
  if (!D) loadData();
  const S = view(); const tabs = TABS[role()] || TABS.owner;
  if (!ui.tab || !tabs.find(t => t[0] === ui.tab)) { ui.tab = tabs[0][0]; ui.filter = ui.tab === 'orders' ? 'pending' : ui.tab === 'shops' ? 'shop' : 'all'; }
  const a = document.activeElement; const fid = a && a.id && a.tagName === 'INPUT' && app.contains(a) ? a.id : null; const sel = fid ? [a.selectionStart, a.selectionEnd] : null;
  app.innerHTML = header(S) + `<main>${V[ui.tab](S)}</main><nav><div class="navbrand">📦 ${esc(S.settings.bizName || 'TradeBook')}<span>${ROLE[role()].label} · ${esc(me().name)}</span></div>${tabs.map(([k, l, ic]) => `<button class="${k === ui.tab ? 'act' : ''}" onclick="go('${k}')"><span class="ic">${ic}</span>${l}</button>`).join('')}</nav>`;
  if (fid) { const n = document.getElementById(fid); if (n) { n.focus(); try { n.setSelectionRange(sel[0], sel[1]); } catch (e) {} } }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (sess) loadData();
render();
if (sess) sync();
