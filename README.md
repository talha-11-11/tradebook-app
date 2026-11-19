# TradeBook — Distribution App (offline-first)

Demo set up for **Bhawan Das Traders, Hyderabad** (change under Owner ▾ → Business details).

Orders · Dispatch · Customer khata (ledger) · Cash book · Stock — for a wholesale/retail distributor.
Works without internet on each phone and syncs automatically when the connection returns.

## Who uses it
| Role | What they do |
|---|---|
| **Order Taker** | Visits shops, takes orders (wholesale/retail rate), adds new shops, collects recovery |
| **Owner** (also dispatches) | Dispatch tab: new orders → dispatch (stock out + bill to shop khata) → delivered with cash collected. Plus dashboard (sales, profit, cash, udhaar), every shop's khata, cash book (counter sale, expense, purchase), stock in, users |

First start creates only the owner login `owner / 1234` and an empty database (no demo data). Add order takers from Owner ▾ → Users.
Set `SEED_DEMO=true` before the first start if you want sample data for a demo.
Change these PINs from **Owner → Name ▾ → Manage users** before real use.

## Features
- **Orders → Dispatch → Delivery** with bills added to each shop's khata
- **Counter sales** (walk-in cash, or to a customer with full / partial / no payment → udhaar in khata), receipts
- **Recovery approval**: payments collected by order takers wait for the owner's approval before hitting the khata
- **Supplier accounts**: purchases (multi-item, partly paid), supplier payments, payable balances
- **PDFs** (open / print / download / share on WhatsApp, work offline): order slip, bill/invoice, cash memo, purchase voucher,
  customer & supplier statements (date range, or all in one PDF), loading sheet, pick-list, orders report, cash book,
  business summary, customer balances, supplier balances, stock report
- **Partial dispatch**: load only what's available; missing items are excluded from the bill (optional back-order), with a printable **dispatch slip / delivery challan**
- **Inventory**: purchases add stock, dispatch & counter sales remove it; stock adjustments (damage, count correction) and per-product movement history
- **Price per customer**: each customer gets Wholesale, Retail or Custom price (own price list); orders and counter sales start with it
- **Supplier advance**: pay before goods arrive — advance is adjusted automatically in the next purchase
- **Approve all** pending recoveries in one tap; payment receipts for every recovery
- **Thermal printing** (80mm / 58mm) for order slip, bill, dispatch slip, cash memo, purchase voucher, payment receipt, statements — switch to A4 any time
- **Product report** (monthly): opening, purchased (from which supplier, at what price), sold (to whom, at what price), closing, profit
- **Business details** (name/address/phone on PDFs) and **Reset data** (start empty to go live) under Owner → name ▾

## Deploy (GitHub + Render + Neon)
1. **Neon** → create a project → copy the connection string (`postgresql://…neon.tech/neondb?sslmode=require`).
2. **GitHub** → new repo → *Add file → Upload files* → drag in everything from this folder (package.json must be at the top level, not inside a sub-folder).
3. **Render** → *New → Web Service* → pick the repo:
   - Runtime: Node · Build: `npm install` · Start: `npm start` · Plan: Free
   - Environment: `DATABASE_URL` = Neon string, `SECRET` = any long random text
4. Deploy. Log shows `TradeBook running … using postgres`. Tables + demo data are created automatically on first start.
5. Open the `*.onrender.com` link on each phone → log in → *Add to Home screen*.

Notes
- Render free web services sleep after ~15 min idle; first open then takes ~30–60 s. Offline work on phones is unaffected.
- Set `SEED_DEMO=false` before the first start to begin with an empty database.

## Run locally
```bash
npm install
npm start            # http://localhost:3000 — stores data in ./data/db.json when DATABASE_URL is not set
```

## How offline sync works
- Every action (order, dispatch, payment, expense…) is saved on the phone first as a record in an outbox.
- Every 10 s, and whenever internet returns, the phone sends its outbox and downloads everyone else's new records.
- Each record has a unique ID, so retries never create duplicates; order numbers are per user (`ALI-1001`), so phones never clash offline.
- The app itself is cached by a service worker, so it opens with no internet after the first login.
- Records marked ⏳ haven't reached the server yet. Logging out with unsynced records shows a warning.

## Env vars
| Var | Default | |
|---|---|---|
| `DATABASE_URL` | – | Postgres connection string (if missing, uses a JSON file) |
| `SECRET` | dev value | Login token signing key — Render generates one |
| `SEED_DEMO` | `true` | Load sample products/shops/orders on an empty DB |
| `PORT` | 3000 | |
