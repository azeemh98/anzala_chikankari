# Admin Panel & Order Management Guide

The admin panel lives at **`/admin`** (e.g. `https://anzala-chikankari.vercel.app/admin`).
It's a separate single-page app from the storefront — hash-routed (`#products`, `#orders`,
etc.), talking to the same backend under `/api/admin/*`, which is entirely gated by
`requireAdmin` (session cookie + `role = 'admin'` — see `lib/auth.js`).

Default seeded login (**change this immediately** — see "Managing admin users" below):
```
email:    admin@anzalachikankari.in
password: ChangeMe@123
```

## Layout

Left sidebar has one link per section. Every section fetches fresh from `/api/admin/*`
on load — nothing is cached client-side, so two admins working at once will always see
current data (though writes from one won't live-push to the other's open tab; refresh
the section to see their changes).

## 1. Dashboard (`#dashboard`)

The first thing you see on login. Pulled from a single `GET /api/admin/dashboard` call
(`routes/admin.js`), which runs several aggregate queries in parallel:

| Tile | Meaning | Query window |
|---|---|---|
| Revenue (30d) | Sum of `total` on non-cancelled orders | Last 30 days |
| Orders Today | Count of orders created today (store timezone) | Today |
| Pending Orders | Orders in `placed` or `confirmed` status | All time |
| Low Stock Items | Active products with `stock <= 3` | Current |
| Upcoming Bookings | Bookings today or later, not cancelled | Current |
| Customers | Count of `role = 'customer'` users | All time |

Below the tiles:
- **Sales chart** — an inline SVG line/area chart of daily revenue over the last 30 days
  (no charting library — it's ~15 lines of hand-drawn SVG in `public/admin/app.js`).
- **Recent Orders** — last 8 orders, click through to Orders for full detail.
- **Top Products (30 days)** — ranked by units sold.
- **Low Stock Alert** — every active product at ≤3 units, so restocking never gets missed.

There's no manual refresh needed for day-to-day use — reload the page for current numbers.

## 2. Order Management (`#orders`) — the core workflow

This is the section you'll live in day-to-day. Two views: the **list** (search/filter)
and the **Manage modal** (per-order detail and status changes).

### The order list

- **Search** matches order number, customer name, email, or phone (`ILIKE`, case-insensitive).
- **Status filter** narrows to one status.
- Each row shows: order number + placed date, customer + phone, item count, total,
  payment status/method, and current status. Click **Manage** to open the detail modal.

### Order statuses and the workflow

Orders move through a **strict linear pipeline**, enforced server-side
(`NEXT_STATUS` map in `routes/admin.js` — the API rejects any other transition with a
400 error, so the UI can't get an order into an invalid state even by mistake):

```
placed → confirmed → packed → shipped → delivered
   ↓          ↓          ↓
cancelled  cancelled  cancelled
```

- **placed** — customer just checked out. Nothing has been done yet.
- **confirmed** — you've reviewed it (stock is fine, payment looks legitimate for UPI orders).
- **packed** — physically packed and ready to hand to the courier.
- **shipped** — handed to the courier. You can attach a **tracking number** here (or at
  any later step) — it's a free-text field, shown to the customer on their order page.
- **delivered** — the terminal success state. **If the payment method was COD, marking
  an order delivered automatically flips `payment_status` to `paid`** — that's the one
  piece of automatic behavior in the workflow, since COD collection happens at the door.
- **cancelled** — reachable from `placed`, `confirmed`, or `packed` (not once shipped —
  by then it's the courier's problem; use payment_status/refund handling manually if a
  shipped order needs to be voided). **Cancelling always restocks the items** — the
  exact quantities that were deducted at checkout are added back to each product's
  stock, inside a database transaction with the status change, so a crash mid-cancel
  can't leave stock inconsistent.

Customers can self-cancel their own order from their account page, but **only** while
it's still `placed` or `confirmed` — once you've packed it, only an admin can cancel
(same restock behavior, same endpoint logic — `cancelOrder()` in `routes/store.js` is
shared by both the customer-facing and admin-facing cancel routes).

### Payment status

Separate from order status: `pending` → `paid` / `refunded`. You can set this manually
at any time from the Manage modal (e.g. mark a UPI order `paid` once you've confirmed
the transfer landed, or `refunded` after a cancellation refund). The only automatic
transition is COD → `paid` on delivery, described above.

### What you can't do (by design)

- You can't skip a status (e.g. `placed` straight to `shipped`) — this catches
  fat-finger mistakes and keeps the order history meaningful for the customer's
  tracking page.
- You can't un-cancel an order — if it was cancelled by mistake, create a fresh order
  instead (the stock is already back, so nothing is lost).
- Order totals, discounts and shipping are **never editable** post-checkout — they were
  computed and locked in at the moment of purchase. If a price needs correcting,
  that's a refund adjustment handled outside the system (bank transfer, updated UPI
  request, etc.), not an edit to the order record.

### Stock and coupons at checkout time (context for why orders look the way they do)

Every order is placed inside a single database transaction (`routes/store.js`,
`POST /api/orders`):
1. Re-quotes the cart server-side (ignores whatever price the browser thinks it is).
2. Checks every line's stock is still sufficient — if two customers race for the last
   item, the second one gets a clean "just sold out" error instead of an oversold order.
3. Deducts stock per line item.
4. Increments the coupon's `used` counter, if one was applied.

If any step fails, the whole order is rolled back — nothing partial ever lands in the
`orders` table.

## 3. Bookings (`#bookings`)

The appointment side (custom stitching, bridal consultations, store visits, video-call
shopping — configured in **Services**, see below).

- Filter by date and/or status.
- **Confirm** (pending → confirmed), **Complete** (after the appointment happened), or
  **Cancel** — one click each, no multi-step workflow like orders (appointments are
  lower-stakes than money already collected).
- **Block a Date** — takes the whole boutique offline for a specific date (with an
  optional reason shown internally), e.g. for a holiday or stocktaking. Blocked dates
  immediately stop showing as bookable on the storefront calendar.

Slot availability itself (what customers see) is computed live from **Settings** →
opening/closing time, slot length, and per-slot capacity, minus whatever's already
booked that day — see `availableSlots()` in `lib/logic.js`. There's also a built-in
30-minute lead time (can't book a slot starting in the next 30 minutes) and a
configurable "book up to N days ahead" cap.

## 4. Products (`#products`)

- **Add/Edit**: name, category, fabric, description, price, an optional
  strike-through "compare-at" price (for showing a discount), stock, sizes
  (comma-separated, e.g. `S,M,L,XL`), up to 6 images, **Featured** (shows on the
  homepage), **Active** (visible in the store at all — turn off instead of deleting
  to temporarily hide something).
- **Images** upload straight to Supabase Storage (public `product-images` bucket) —
  drag in files, remove any before saving, reorder isn't currently supported (first
  image is always the primary/thumbnail).
- **Delete**: if the product has never been ordered, it's hard-deleted. If it has order
  history, it's **archived instead** (set `active = false`, record kept) so old orders
  still display the correct product name/price — you'll see a toast telling you which
  happened.

## 5. Categories, Coupons, Services, Customers, Messages, Settings

- **Categories**: name, slug (auto-generated from name, editable), homepage image,
  sort order. Can't delete a category that still has products in it — reassign them
  first.
- **Coupons**: percent-off or flat-amount, minimum order value, optional max total
  uses, optional expiry date. Disable instead of delete to preserve the record of a
  past promotion. Coupon codes are case-insensitive.
- **Services**: what's bookable (name, description, duration in minutes, price — 0 for
  free consultations). Duration directly affects how many slots fit in the day.
- **Customers**: read-only list — name, email, phone, order count, lifetime value
  (sum of non-cancelled order totals), join date. Search by name/email.
- **Messages**: contact-form submissions, unread ones highlighted. Mark as read once
  handled (e.g. replied by email/WhatsApp outside the system — there's no in-app reply).
- **Settings**: store name/tagline/contact info, WhatsApp number, UPI ID, shipping fee
  and free-shipping threshold, and every booking-engine parameter (hours, slot length,
  capacity, closed weekdays, how far ahead bookings open). Changes apply immediately —
  no redeploy.

## Managing admin users

**Add one**: Settings → Admin Users → "+ Add Admin User" (name, email, password).
Every admin has equal, full access — there's no permission tiering.

**Change your own password**: not currently exposed in the admin UI itself (only
customer accounts have a self-service password change on the storefront's Account
page). To rotate the seeded admin password, either:
- Log into the storefront's `/account.html` with the admin's email/password (it's a
  normal user row, so this works) and use **Profile → Change Password** there, or
- Update it directly via SQL: `UPDATE users SET password_hash = ... WHERE email = '...'`
  using a hash from `hashPassword()` in `lib/auth.js` (scrypt, salted).

**Remove one**: no "delete admin" button currently — do it via SQL
(`DELETE FROM users WHERE email = '...' AND role = 'admin'`) if you ever need to.
