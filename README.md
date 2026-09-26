# Anzala Chikankari

A full e-commerce site for a Lucknowi chikankari fashion brand: storefront, shopping
cart & checkout, a booking engine for in-store/bridal appointments, customer accounts,
and an admin panel with a dashboard, catalogue, order and booking management.

Single Node.js/Express app, backed by Postgres (built and deployed against Supabase).
Deployed on Vercel as a single serverless function; product images are stored in
Supabase Storage since serverless hosts don't offer a persistent local filesystem.

**Live:** https://anzala-chikankari.vercel.app
**Admin:** https://anzala-chikankari.vercel.app/admin

## Features

**Storefront**
- Home, category browsing, search & filters (price, category, sort)
- Product detail pages with image gallery, sizes, stock, ratings & verified reviews
- Cart drawer with live server-side pricing, coupons and free-shipping threshold
- Checkout with address form, COD / UPI payment, and stock-safe order placement
- Customer accounts: order history + cancellation, appointment history, wishlist, profile
- Guest order tracking by order number + email
- Booking engine: pick a service, see a live calendar with real slot availability
  (respects opening hours, slot length, per-slot capacity, blocked dates, lead time)
- Contact form, WhatsApp button, responsive layout

**Admin panel** (`/admin`) — see [ADMIN_GUIDE.md](./ADMIN_GUIDE.md) for the full walkthrough
- Dashboard: revenue (30d), orders today, pending orders, low stock, upcoming
  bookings, a sales chart and top-products table
- Products: create/edit/delete (soft-archives if it has order history), image
  upload (to Supabase Storage), sizes, pricing, stock, featured flag
- Categories, Coupons (percent/flat, min order, usage caps, expiry)
- Orders: search/filter, status workflow (placed → confirmed → packed → shipped →
  delivered, or cancelled with automatic restock), payment status, tracking number
- Bookings: confirm/complete/cancel, block out dates
- Services (what can be booked), Customers (lifetime value), Contact messages
- Store settings: shipping fee/threshold, contact details, booking hours & capacity
- Multiple admin users

## Getting started (local development)

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL etc.
npm run seed                 # creates schema, an admin user and sample products/services
npm start                    # http://localhost:3000  (storefront)  /admin (admin panel)
```

`DATABASE_URL` must point at a real Postgres database (a local Postgres, or your
Supabase project directly — see `.env.example` for the connection string format).
The seed step prints the generated admin login if `ADMIN_EMAIL`/`ADMIN_PASSWORD`
aren't set in the environment — **change that password after your first login**.

For development with auto-restart: `npm run dev`.

## Configuration

Copy `.env.example` to `.env` and fill in:
- `DATABASE_URL` — Postgres connection string (Supabase pooler recommended for serverless)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — used only by the admin image-upload endpoint
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — first-run admin account (ignored once one exists)
- `STORE_TIMEZONE` — used for "today" in the booking engine and order numbers

All store-facing settings (shipping fee, contact info, booking hours, UPI ID, etc.)
are edited from **Admin → Settings** at runtime — no redeploy or env var change needed.

## Deployment (Vercel)

This repo is already wired for Vercel:
- `vercel.json` + `api/index.js` route every request through one serverless function
  wrapping the Express app in `server.js`
- Environment variables are set on the Vercel project (`DATABASE_URL` pointed at
  Supabase's transaction pooler on port 6543, `PG_POOL_MAX=1` to avoid exhausting
  Postgres connections across many function instances, plus `SUPABASE_URL`/`SUPABASE_ANON_KEY`)
- Pushing to `main` auto-deploys (GitHub integration)

Two things Vercel-specific to know:
1. **Schema migrations don't run automatically on deploy.** `seed()`/`migrate()` only
   runs when the app is started directly (`node server.js`), not when the serverless
   function is invoked. If you change the schema in `lib/db.js`, run
   `DATABASE_URL=<supabase-url> node lib/db.js` (without `--reset`, that drops everything)
   from a machine with normal network access, or apply the change via the Supabase
   dashboard/SQL editor.
2. **Rate limiting is per-instance, not global.** The simple in-memory rate limiter in
   `server.js` resets whenever Vercel spins up a fresh function instance, so it's a
   soft speed bump, not a hard guarantee, under serverless. Fine for this app's traffic
   level; swap in a Redis-backed limiter (e.g. Upstash) if that ever matters.

## Architecture

```
server.js            Express app: static files, API mounting, error handling, rate limits
api/index.js          Vercel serverless entry point (just re-exports server.js's app)
vercel.json           Routes every request to api/index.js
lib/db.js             Postgres pool, schema migrations, settings, seed data
lib/auth.js           Password hashing (scrypt), cookie sessions, requireUser/requireAdmin
lib/logic.js          Validation, cart pricing, booking slot availability — the business rules
lib/storage.js         Product image uploads -> Supabase Storage
lib/asyncHandler.js    Wraps async route handlers so rejected promises reach the error middleware
routes/store.js       Public + customer API (catalogue, cart, orders, bookings, account)
routes/admin.js        Admin-only API (dashboard, CRUD, order/booking workflow, settings)
public/               Storefront (static HTML/CSS/vanilla JS, no build step)
public/admin/          Admin panel (single-page app, hash-routed, vanilla JS)
test/                  API test suite (node:test) against a real Postgres database
```

All pricing (cart totals, coupons, shipping) and booking slot availability are
computed **server-side only** — the client never sends a price, so it can't be
tampered with from the browser.

## Running tests

Requires a real Postgres database (every table is dropped and recreated on each run —
never point this at production):

```bash
TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/anzala_test npm test
```

## Notes on going further

- Session cookies are marked `secure` automatically when `NODE_ENV=production`.
- Wire up a real payment gateway + SMS/email notifications when you're ready — the
  order/booking hooks (`routes/store.js`) are the natural place to add them.
- The image-upload Storage policy currently lets the `anon` key insert into the
  `product-images` bucket (safe today because only the admin-session-gated
  `/api/admin/uploads` route uses it) — tighten this to a service-role-only policy
  if that upload path is ever exposed more broadly.
