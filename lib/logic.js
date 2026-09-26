// Business rules shared by the store and admin APIs: validation, cart pricing and booking slots.
const crypto = require('node:crypto');
const { getSettings } = require('./db');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- validation ----------

function str(value, field, { min = 1, max = 200, optional = false } = {}) {
  const v = value == null ? '' : String(value).trim();
  if (!v && optional) return null;
  if (v.length < min) throw new HttpError(400, `${field} is required.`);
  if (v.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`);
  return v;
}

function email(value) {
  const v = str(value, 'Email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'Please enter a valid email address.');
  return v;
}

// International-friendly: accepts "+1 512-555-0100", "918601413334", "07911 123456", etc.
// Just checks it's a plausible phone number (7-15 digits, optional leading +) rather than one country's format.
function phone(value) {
  const raw = str(value, 'Phone', { max: 30 });
  const digits = raw.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) throw new HttpError(400, 'Please enter a valid phone number, with country code if shipping internationally.');
  return digits;
}

// International-friendly postal/ZIP code (US ZIP, UK postcode, Indian PIN, etc.) — just needs to be a
// plausible code, not one specific country's format, since the store ships worldwide.
function postalCode(value) {
  const v = str(value, 'Postal code', { max: 12 }).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 -]{2,11}$/.test(v)) throw new HttpError(400, 'Please enter a valid postal/ZIP code.');
  return v;
}

function country(value) {
  return str(value, 'Country', { max: 60 });
}

function int(value, field, { min = 0, max = 1e9, optional = false } = {}) {
  if ((value === '' || value == null) && optional) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}.`);
  return n;
}

function password(value) {
  const v = String(value || '');
  if (v.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (v.length > 200) throw new HttpError(400, 'Password is too long.');
  return v;
}

// ---------- identifiers & time ----------

function reference(prefix) {
  const { date } = nowLocal();
  return `${prefix}${date.slice(2).replace(/-/g, '')}${crypto.randomInt(1000, 9999)}${crypto.randomInt(10, 99)}`;
}

const TZ = process.env.STORE_TIMEZONE || 'Asia/Kolkata';

// Current date/time in the store's timezone (Lucknow by default).
function nowLocal() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- products ----------

function parseProduct(row) {
  if (!row) return row;
  return {
    ...row,
    images: typeof row.images === 'string' ? JSON.parse(row.images) : (row.images || []),
    sizes: row.sizes ? row.sizes.split(',').map((s) => s.trim()).filter(Boolean) : [],
    featured: !!row.featured,
    active: !!row.active,
    personalizable: !!row.personalizable,
  };
}

const MAX_CUSTOM_TEXT = 40;

// ---------- cart pricing (always computed on the server) ----------

async function findCoupon(db, code, subtotal, currencySymbol = '$') {
  if (!code) return { coupon: null, error: null };
  const c = await db.get('SELECT * FROM coupons WHERE code = ?', [String(code).trim()]);
  const today = nowLocal().date;
  if (!c || !c.active) return { coupon: null, error: 'This coupon code is not valid.' };
  if (c.expires_at && String(c.expires_at).slice(0, 10) < today) return { coupon: null, error: 'This coupon has expired.' };
  if (c.max_uses != null && c.used >= c.max_uses) return { coupon: null, error: 'This coupon has reached its usage limit.' };
  if (subtotal < c.min_order) return { coupon: null, error: `Add items worth ${currencySymbol}${c.min_order - subtotal} more to use ${c.code}.` };
  return { coupon: c, error: null };
}

async function quote(db, rawItems, couponCode) {
  if (!Array.isArray(rawItems)) throw new HttpError(400, 'Cart items are missing.');
  if (rawItems.length > 50) throw new HttpError(400, 'Too many items in cart.');
  const settings = await getSettings(db);

  const lines = [];
  const errors = [];
  const qtyByProduct = {};
  for (const raw of rawItems) {
    const product = parseProduct(await db.get('SELECT * FROM products WHERE id = ?', [Number(raw.product_id)]));
    const qty = Number(raw.qty);
    if (!product || !product.active) { errors.push('An item in your bag is no longer available and was skipped.'); continue; }
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) { errors.push(`Invalid quantity for ${product.name}.`); continue; }
    const size = raw.size ? String(raw.size) : null;
    if (product.sizes.length && !product.sizes.includes(size)) { errors.push(`Please choose a size for ${product.name}.`); continue; }

    let customText = null;
    if (product.personalizable) {
      customText = raw.custom_text ? String(raw.custom_text).trim().slice(0, MAX_CUSTOM_TEXT) : '';
      if (!customText) { errors.push(`Please enter what to embroider for ${product.name}.`); continue; }
    }

    qtyByProduct[product.id] = (qtyByProduct[product.id] || 0) + qty;
    lines.push({
      product_id: product.id, slug: product.slug, name: product.name, image: product.images[0] || null,
      size, custom_text: customText, qty, price: product.price, line_total: product.price * qty, stock: product.stock,
    });
  }
  for (const line of lines) {
    if (qtyByProduct[line.product_id] > line.stock) {
      line.out_of_stock = true;
      errors.push(line.stock > 0
        ? `Only ${line.stock} left of ${line.name}.`
        : `${line.name} is out of stock.`);
    }
  }

  const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
  const { coupon, error: couponError } = await findCoupon(db, couponCode, subtotal, settings.currency_symbol || '$');
  let discount = 0;
  if (coupon) discount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : Math.min(coupon.value, subtotal);
  const afterDiscount = subtotal - discount;
  const freeMin = Number(settings.free_shipping_min);
  const shipping = lines.length === 0 || afterDiscount >= freeMin ? 0 : Number(settings.shipping_fee);

  return {
    lines, errors, subtotal, discount, shipping, total: afterDiscount + shipping,
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    coupon_error: couponError, free_shipping_min: freeMin,
  };
}

// ---------- booking engine ----------

async function bookingDayStatus(db, date, settings) {
  settings = settings || await getSettings(db);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { open: false, reason: 'Invalid date.' };
  }
  const today = nowLocal().date;
  if (date < today) return { open: false, reason: 'That date has passed.' };
  if (date > addDays(today, Number(settings.booking_max_days_ahead))) {
    return { open: false, reason: `Bookings open up to ${settings.booking_max_days_ahead} days ahead.` };
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const closed = String(settings.booking_closed_weekdays || '').split(',').filter((x) => x !== '').map(Number);
  if (closed.includes(weekday)) return { open: false, reason: 'The boutique is closed on this day.' };
  const blocked = await db.get('SELECT reason FROM blocked_dates WHERE date = ?', [date]);
  if (blocked) return { open: false, reason: blocked.reason || 'No appointments available on this date.' };
  return { open: true };
}

async function availableSlots(db, date, serviceId) {
  const settings = await getSettings(db);
  const service = await db.get('SELECT * FROM services WHERE id = ? AND active = true', [Number(serviceId)]);
  if (!service) throw new HttpError(404, 'Service not found.');
  const day = await bookingDayStatus(db, date, settings);
  if (!day.open) return { date, service_id: service.id, open: false, reason: day.reason, slots: [] };

  const open = toMin(settings.booking_open);
  const close = toMin(settings.booking_close);
  const step = Number(settings.booking_slot_minutes) || 60;
  const capacity = Number(settings.booking_slot_capacity) || 1;
  const now = nowLocal();

  const existingRows = await db.all(
    `SELECT b.time, s.duration_min FROM bookings b JOIN services s ON s.id = b.service_id
     WHERE b.date = ? AND b.status != 'cancelled'`, [date],
  );
  const existing = existingRows.map((b) => ({ start: toMin(b.time), end: toMin(b.time) + b.duration_min }));

  const slots = [];
  for (let start = open; start + service.duration_min <= close; start += step) {
    const end = start + service.duration_min;
    const overlapping = existing.filter((b) => b.start < end && b.end > start).length;
    const past = date === now.date && start <= now.minutes + 30; // need at least 30 min notice
    slots.push({ time: toHHMM(start), available: !past && overlapping < capacity, remaining: Math.max(0, capacity - overlapping) });
  }
  return { date, service_id: service.id, open: true, slots };
}

module.exports = {
  HttpError, str, email, phone, postalCode, country, int, password,
  reference, nowLocal, addDays, parseProduct, quote, findCoupon, availableSlots, bookingDayStatus,
};
