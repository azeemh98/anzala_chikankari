// Transactional email via Resend's HTTP API (no SDK dependency — a couple of small fetch calls).
// Fully optional: if RESEND_API_KEY isn't set, every send() call logs and no-ops instead of throwing,
// so order/booking placement never fails just because email isn't configured yet.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'ANJALA Chikankari <onboarding@resend.dev>';

async function send({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email] RESEND_API_KEY not set — skipping "${subject}" to ${to}`);
    return { skipped: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });
    if (!res.ok) {
      console.error(`[email] Resend API error ${res.status} sending "${subject}" to ${to}:`, await res.text().catch(() => ''));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    // Never let an email provider outage break checkout/booking — log and move on.
    console.error(`[email] Failed to send "${subject}" to ${to}:`, err.message);
    return { ok: false };
  }
}

const money = (n, symbol = '$') => `${symbol}${Number(n || 0).toLocaleString('en-US')}`;

const wrap = (title, bodyHtml) => `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2B2620;">
    <h1 style="font-size:22px;color:#1E3350;margin-bottom:4px;">ANJALA</h1>
    <p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#C9A66B;margin-top:0;">Hand-Embroidered Chikankari</p>
    <h2 style="font-size:18px;color:#12233A;">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px;color:#888;margin-top:30px;border-top:1px solid #eee;padding-top:14px;">
      ANJALA Chikankari · Lucknow, Uttar Pradesh, India
    </p>
  </div>`;

// ---------- order emails ----------

function orderLinesHtml(items, currencySymbol) {
  return items.map((it) => `
    <tr>
      <td style="padding:6px 0;">${it.name}${it.size && it.size !== 'One Size' ? ` (${it.size})` : ''}${it.custom_text ? ` — "${it.custom_text}"` : ''} × ${it.qty}</td>
      <td style="padding:6px 0;text-align:right;">${money(it.price * it.qty, currencySymbol)}</td>
    </tr>`).join('');
}

async function sendOrderConfirmation(order, currencySymbol = '$') {
  const html = wrap(`Order Confirmed — ${order.order_no}`, `
    <p>Hi ${order.name}, thank you for your order! Here's what's being prepared in Lucknow:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">${orderLinesHtml(order.items, currencySymbol)}</table>
    <p style="font-size:16px;font-weight:bold;">Total: ${money(order.total, currencySymbol)}</p>
    <p>We'll email you again once your order ships${order.payment_method === 'upi' ? ', along with bank/UPI transfer details' : ''}.</p>
    <p>Order number: <strong>${order.order_no}</strong></p>`);
  return send({ to: order.email, subject: `Your ANJALA order ${order.order_no} is confirmed`, html });
}

async function sendOrderStatusUpdate(order) {
  const messages = {
    confirmed: 'Your order has been confirmed and is being prepared.',
    packed: 'Your order has been packed and is ready to ship.',
    shipped: `Your order has shipped!${order.tracking_no ? ` Tracking number: ${order.tracking_no}` : ''}`,
    delivered: 'Your order has been delivered. We hope you love it!',
    cancelled: 'Your order has been cancelled.',
  };
  const message = messages[order.status];
  if (!message) return { skipped: true };
  const html = wrap(`Order Update — ${order.order_no}`, `<p>Hi ${order.name},</p><p>${message}</p>`);
  return send({ to: order.email, subject: `ANJALA order ${order.order_no}: ${order.status}`, html });
}

async function sendNewOrderAlert(order, storeEmail, currencySymbol = '$') {
  if (!storeEmail) return { skipped: true };
  const html = wrap('New Order Received', `
    <p>${order.name} (${order.email}, ${order.phone}) just placed order <strong>${order.order_no}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">${orderLinesHtml(order.items, currencySymbol)}</table>
    <p style="font-size:16px;font-weight:bold;">Total: ${money(order.total, currencySymbol)}</p>
    <p>Payment: ${order.payment_method.toUpperCase()} · Ship to: ${order.address}, ${order.city}, ${order.state} ${order.pincode}, ${order.country}</p>`);
  return send({ to: storeEmail, subject: `New order ${order.order_no} — ${money(order.total, currencySymbol)}`, html });
}

// ---------- booking emails ----------

// booking.date comes back from Postgres as a JS Date (the `date` column type) rather than a plain
// "YYYY-MM-DD" string — format it explicitly so emails never show a full Date#toString() timestamp.
function bookingDateStr(booking) {
  return booking.date instanceof Date ? booking.date.toISOString().slice(0, 10) : String(booking.date);
}

async function sendBookingConfirmation(booking) {
  const date = bookingDateStr(booking);
  const html = wrap('Appointment Confirmed', `
    <p>Hi ${booking.name}, your appointment is booked:</p>
    <p><strong>${booking.service_name}</strong><br>${date} at ${booking.time}</p>
    <p>Booking number: <strong>${booking.booking_no}</strong></p>
    <p>We'll see you then! Reply to this email if you need to reschedule.</p>`);
  return send({ to: booking.email, subject: `Your ANJALA appointment is confirmed — ${booking.booking_no}`, html });
}

async function sendNewBookingAlert(booking, storeEmail) {
  if (!storeEmail) return { skipped: true };
  const date = bookingDateStr(booking);
  const html = wrap('New Appointment Booked', `
    <p>${booking.name} (${booking.email}, ${booking.phone}) booked <strong>${booking.service_name}</strong>
    for ${date} at ${booking.time}.</p>
    ${booking.notes ? `<p>Notes: ${booking.notes}</p>` : ''}`);
  return send({ to: storeEmail, subject: `New appointment: ${booking.service_name} on ${date}`, html });
}

module.exports = { send, sendOrderConfirmation, sendOrderStatusUpdate, sendNewOrderAlert, sendBookingConfirmation, sendNewBookingAlert };
