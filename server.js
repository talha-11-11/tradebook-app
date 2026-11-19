// TradeBook — wholesale/retail distribution app (offline-first)
// Server: stores an append-only event log + users. Clients sync by pushing
// their offline outbox and pulling every event after their last sequence number.
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { seedUsers, seedEvents } = require('./seed');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'dev-secret-change-me';
const SEED_DEMO = process.env.SEED_DEMO === 'true';
const BIZ = { bizName: process.env.BIZ_NAME || 'Bhawan Das Traders', address: process.env.BIZ_ADDRESS || 'Hyderabad, Sindh', phone: process.env.BIZ_PHONE || '', footer: 'Thank you for your business', paper: 't80' };
const ROLES = ['owner', 'dispatch', 'taker'];
const ALLOWED = {
  owner: ['product', 'stock_in', 'customer', 'opening', 'cash_open', 'order', 'status', 'payment', 'expense', 'counter',
    'supplier', 'sopening', 'purchase', 'supplier_pay', 'pay_review', 'settings', 'stock_adj', 'product_upd', 'customer_upd', 'cust_price'],
  dispatch: ['customer', 'opening', 'status', 'payment'],
  taker: ['customer', 'opening', 'order', 'status', 'payment'],
};

/* ---------------- storage ---------------- */
function fileStore() {
  const file = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let d = { events: [], users: [], seq: 0, epoch: 'e1' };
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  const ids = new Set(d.events.map(e => e.id));
  let timer;
  const persist = () => { clearTimeout(timer); timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(d)), 150); };
  return {
    kind: 'file (' + file + ')',
    async init() {},
    async insert(evs) {
      for (const e of evs) { if (ids.has(e.id)) continue; ids.add(e.id); d.seq += 1; d.events.push({ ...e, seq: d.seq }); }
      persist();
    },
    async since(s) { return d.events.filter(e => e.seq > s); },
    async epoch() { return d.epoch || 'e1'; },
    async clearEvents(ep) { d.events = []; ids.clear(); d.epoch = ep; persist(); },
    async count() { return d.events.length; },
    async users() { return d.users; },
    async addUser(u) { d.users.push(u); persist(); },
    async updateUser(id, f) { const u = d.users.find(x => x.id === id); if (u) Object.assign(u, f); persist(); },
  };
}

function pgStore() {
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  // SSL for any hosted DB (Neon, Render external, Supabase…); none for localhost / Render internal hosts.
  const host = (url.match(/@([^:/?]+)/) || [])[1] || '';
  const needSsl = !/^(localhost|127\.0\.0\.1)$/.test(host) && host.includes('.');
  const pool = new Pool({ connectionString: url.replace(/[?&](sslmode|channel_binding)=[^&]*/g, ''), ssl: needSsl ? { rejectUnauthorized: false } : false, max: 5 });
  const q = (s, a) => pool.query(s, a);
  const COLS = { name: 'name', pinHash: 'pin_hash', active: 'active', role: 'role', lastSeen: 'last_seen' };
  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users(
        id text PRIMARY KEY, name text NOT NULL, username text UNIQUE NOT NULL, pin_hash text NOT NULL,
        role text NOT NULL, active boolean DEFAULT true, last_seen bigint DEFAULT 0)`);
      await q(`CREATE TABLE IF NOT EXISTS events(
        seq bigserial PRIMARY KEY, id text UNIQUE NOT NULL, t text NOT NULL, p jsonb NOT NULL, ts bigint NOT NULL,
        by_id text, by_name text, by_role text, received bigint)`);
      await q(`CREATE TABLE IF NOT EXISTS meta(k text PRIMARY KEY, v text)`);
    },
    async epoch() { const r = await q(`SELECT v FROM meta WHERE k='epoch'`); return r.rows[0] ? r.rows[0].v : 'e1'; },
    async clearEvents(ep) {
      await q('DELETE FROM events');
      await q(`INSERT INTO meta(k,v) VALUES('epoch',$1) ON CONFLICT(k) DO UPDATE SET v=$1`, [ep]);
    },
    async insert(evs) {
      if (!evs.length) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const e of evs) {
          await c.query(
            'INSERT INTO events(id,t,p,ts,by_id,by_name,by_role,received) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',
            [e.id, e.t, JSON.stringify(e.p), Math.round(e.ts), e.by, e.byName, e.byRole, Date.now()]);
        }
        await c.query('COMMIT');
      } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
    },
    async since(s) {
      const r = await q(`SELECT seq::int AS seq, id, t, p, ts::float8 AS ts, by_id AS "by", by_name AS "byName", by_role AS "byRole"
                         FROM events WHERE seq > $1 ORDER BY seq`, [s]);
      return r.rows;
    },
    async count() { return (await q('SELECT count(*)::int AS n FROM events')).rows[0].n; },
    async users() {
      return (await q(`SELECT id, name, username, pin_hash AS "pinHash", role, active, last_seen::float8 AS "lastSeen" FROM users ORDER BY name`)).rows;
    },
    async addUser(u) {
      await q('INSERT INTO users(id,name,username,pin_hash,role,active) VALUES($1,$2,$3,$4,$5,true)', [u.id, u.name, u.username, u.pinHash, u.role]);
    },
    async updateUser(id, f) {
      const keys = Object.keys(f).filter(k => COLS[k]);
      if (!keys.length) return;
      await q(`UPDATE users SET ${keys.map((k, i) => `${COLS[k]}=$${i + 2}`).join(',')} WHERE id=$1`, [id, ...keys.map(k => f[k])]);
    },
  };
}

const store = process.env.DATABASE_URL ? pgStore() : fileStore();

/* ---------------- auth ---------------- */
function hashPin(pin) {
  const salt = crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function checkPin(pin, stored) {
  const [salt, h] = String(stored).split(':');
  const x = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h));
}
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeToken(uid) { const body = uid + '.' + (Date.now() + 60 * 864e5); return body + '.' + sign(body); }
function readToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  const body = parts[0] + '.' + parts[1];
  if (sign(body) !== parts[2] || Number(parts[1]) < Date.now()) return null;
  return parts[0];
}
const publicUser = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active !== false, lastSeen: u.lastSeen || 0 });

async function auth(req, res, next) {
  const uid = readToken((req.headers.authorization || '').replace('Bearer ', ''));
  const u = uid && (await store.users()).find(x => x.id === uid);
  if (!u || u.active === false) return res.status(401).json({ error: 'Please log in again' });
  req.user = u; next();
}
const ownerOnly = (req, res, next) => req.user.role === 'owner' ? next() : res.status(403).json({ error: 'Owner only' });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });

/* ---------------- app ---------------- */
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/login', wrap(async (req, res) => {
  const { username, pin } = req.body || {};
  const u = (await store.users()).find(x => x.username === String(username || '').trim().toLowerCase());
  if (!u || u.active === false || !checkPin(pin, u.pinHash)) return res.status(401).json({ error: 'Wrong username or PIN' });
  res.json({ token: makeToken(u.id), user: publicUser(u) });
}));

app.post('/api/sync', auth, wrap(async (req, res) => {
  const u = req.user;
  const since = Number(req.body.since) || 0;
  const incoming = Array.isArray(req.body.events) ? req.body.events.slice(0, 1000) : [];
  const ok = [], rejected = [];
  for (const e of incoming) {
    if (!e || typeof e.id !== 'string' || !ALLOWED[u.role].includes(e.t)) { if (e && e.id) rejected.push(e.id); continue; }
    ok.push({ id: e.id.slice(0, 64), t: e.t, p: e.p || {}, ts: Math.min(Number(e.ts) || Date.now(), Date.now() + 6e4), by: u.id, byName: u.name, byRole: u.role });
  }
  await store.insert(ok);
  await store.updateUser(u.id, { lastSeen: Date.now() });
  const events = await store.since(since);
  const users = (await store.users()).map(publicUser);
  res.json({ events, seq: events.length ? events[events.length - 1].seq : since, rejected, users, me: publicUser(u), epoch: await store.epoch() });
}));

app.get('/api/users', auth, ownerOnly, wrap(async (req, res) => res.json((await store.users()).map(publicUser))));

app.post('/api/users', auth, ownerOnly, wrap(async (req, res) => {
  const { name, username, pin, role } = req.body || {};
  const un = String(username || '').trim().toLowerCase();
  if (!name || !/^[a-z0-9_.-]{3,20}$/.test(un)) return res.status(400).json({ error: 'Username: 3–20 letters/numbers, no spaces' });
  if (!/^\d{4,8}$/.test(String(pin || ''))) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if ((await store.users()).some(x => x.username === un)) return res.status(400).json({ error: 'Username already taken' });
  const u = { id: 'u_' + crypto.randomBytes(6).toString('hex'), name: String(name).trim(), username: un, pinHash: hashPin(pin), role, active: true };
  await store.addUser(u);
  res.json(publicUser(u));
}));

app.patch('/api/users/:id', auth, ownerOnly, wrap(async (req, res) => {
  const f = {};
  if (typeof req.body.active === 'boolean') {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself" });
    f.active = req.body.active;
  }
  if (req.body.pin) {
    if (!/^\d{4,8}$/.test(String(req.body.pin))) return res.status(400).json({ error: 'PIN must be 4–8 digits' });
    f.pinHash = hashPin(req.body.pin);
  }
  await store.updateUser(req.params.id, f);
  res.json({ ok: true });
}));

// Owner: wipe all records (keeps users). demo=true reloads sample data.
app.post('/api/reset', auth, ownerOnly, wrap(async (req, res) => {
  if (req.body.confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm' });
  const keep = (await store.since(0)).filter(e => e.t === 'settings').pop(); // keep business details
  await store.clearEvents('e' + Date.now());
  if (req.body.demo) await store.insert(seedEvents());
  else await store.insert([keep ? { ...keep, id: 'set' + Date.now(), ts: Date.now() } : settingsEvent()]);
  res.json({ ok: true });
}));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (/sw\.js$|index\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); },
}));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function settingsEvent() { return { id: 'set' + Date.now(), t: 'settings', p: BIZ, ts: Date.now(), by: 'u_owner', byName: 'Owner', byRole: 'owner' }; }

/* ---------------- boot ---------------- */
(async () => {
  await store.init();
  if (!(await store.users()).length) {
    for (const u of seedUsers.filter(u => SEED_DEMO || u.role === 'owner')) await store.addUser({ ...u, pinHash: hashPin(u.pin), active: true });
    console.log('Created owner login: owner / 1234 (change the PIN after first login)');
    if ((await store.count()) === 0) {
      if (SEED_DEMO) { await store.insert(seedEvents()); console.log('Loaded demo data'); }
      else await store.insert([settingsEvent()]);
    }
  }
  app.listen(PORT, () => console.log(`TradeBook running on :${PORT} using ${store.kind}`));
})().catch(e => { console.error(e); process.exit(1); });
