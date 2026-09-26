// Shared storefront logic: API client, cart (persisted in localStorage), auth state, header/footer chrome.
const api = {
  async req(method, url, body) {
    const res = await fetch(`/api${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong.'), { status: res.status, details: data?.details });
    return data;
  },
  get(url) { return this.req('GET', url); },
  post(url, body) { return this.req('POST', url, body || {}); },
  put(url, body) { return this.req('PUT', url, body || {}); },
  del(url) { return this.req('DELETE', url); },
};

function toast(message, isError) {
  const el = document.getElementById('toast');
  if (!el) return alert(message);
  document.getElementById('toastText') ? (document.getElementById('toastText').textContent = message) : (el.textContent = message);
  el.classList.toggle('toast-error', !!isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// Prices are stored as whole USD dollars (no cents) — matches the catalogue's actual price points.
const money = (n) => `${(SETTINGS && SETTINGS.currency_symbol) || '$'}${Number(n || 0).toLocaleString('en-US')}`;
// Escapes text before it's interpolated into an HTML template — product names, review text and
// anything else that ultimately comes from a customer or admin input field must go through this.
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`); }

// ---------- cart (client-side; server always re-prices via /cart/quote before checkout) ----------
// Each line has a client-generated lineId. Personalized items never merge (each embroidered name is its
// own line, mirroring how a customer would think about two different name frames in the same order).
const Cart = {
  KEY: 'anzala_cart',
  read() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  write(items) { localStorage.setItem(this.KEY, JSON.stringify(items)); document.dispatchEvent(new Event('cart:change')); },
  add(productId, size, qty = 1, customText = null) {
    const items = this.read();
    if (customText) {
      items.push({ lineId: uid(), product_id: productId, size, qty, custom_text: customText });
    } else {
      const line = items.find((i) => i.product_id === productId && i.size === size && !i.custom_text);
      if (line) line.qty = Math.min(10, line.qty + qty);
      else items.push({ lineId: uid(), product_id: productId, size, qty, custom_text: null });
    }
    this.write(items);
  },
  setQty(lineId, qty) {
    const items = this.read().map((i) => (i.lineId === lineId ? { ...i, qty } : i)).filter((i) => i.qty > 0);
    this.write(items);
  },
  remove(lineId) { this.write(this.read().filter((i) => i.lineId !== lineId)); },
  clear() { this.write([]); },
  count() { return this.read().reduce((s, i) => s + i.qty, 0); },
};

// ---------- wishlist (server-backed when logged in, local fallback otherwise) ----------
const Wishlist = {
  KEY: 'anzala_wishlist',
  readLocal() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch { return []; } },
  writeLocal(ids) { localStorage.setItem(this.KEY, JSON.stringify(ids)); },
  async list() {
    if (Auth.user) return (await api.get('/wishlist')).map((p) => p.id);
    return this.readLocal();
  },
  async toggle(productId) {
    if (Auth.user) {
      const mine = await this.list();
      if (mine.includes(productId)) await api.del(`/wishlist/${productId}`); else await api.post(`/wishlist/${productId}`);
    } else {
      const ids = this.readLocal();
      this.writeLocal(ids.includes(productId) ? ids.filter((id) => id !== productId) : [...ids, productId]);
    }
  },
};

// ---------- auth ----------
const Auth = {
  user: null,
  async refresh() { this.user = await api.get('/auth/me').catch(() => null); document.dispatchEvent(new Event('auth:change')); return this.user; },
  async login(email, password) { const u = await api.post('/auth/login', { email, password }); await this.refresh(); return u; },
  async register(payload) { const u = await api.post('/auth/register', payload); await this.refresh(); return u; },
  async logout() { await api.post('/auth/logout'); await this.refresh(); },
};

// ---------- shared SVG motifs (paisley / jaali / vine + chikankari tile patterns) ----------
// Injected once per page — reused by the hero, dividers, cards and footer via <use href="#motif-...">.
const MOTIF_DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <symbol id="motif-paisley" viewBox="0 0 100 100" class="paisley">
      <path d="M50 12c20 0 30 16 30 32 0 20-16 30-8 42 4 6-2 10-8 8-18-6-40-10-40-38 0-24 12-44 26-44z"/>
      <path d="M50 26c10 0 16 10 16 20s-8 16-4 24"/>
      <circle cx="46" cy="34" r="3"/>
    </symbol>
    <symbol id="motif-jaali" viewBox="0 0 100 100" class="jaali">
      <circle cx="50" cy="50" r="8"/>
      <path d="M50 10v20M50 70v20M10 50h20M70 50h20M22 22l14 14M64 64l14 14M78 22L64 36M36 64L22 78"/>
      <circle cx="50" cy="50" r="30"/>
    </symbol>
    <symbol id="motif-vine" viewBox="0 0 200 30" class="vine">
      <path d="M4 15c20-10 40 10 60 0s40-10 60 0 40 10 60 0"/>
      <path d="M20 15l6-8M40 8l6 9M64 15l6-8M84 8l6 9M108 15l6-8M128 8l6 9M152 15l6-8M172 8l6 9"/>
    </symbol>
    <pattern id="chikanTileGold" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
      <g fill="none" stroke="#C9A66B" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 6c6 0 9 5 9 10 0 6-5 9-2 13 1 2-1 3-3 2-6-2-12-3-12-11 0-7 4-14 8-14z"/>
        <circle cx="9" cy="9" r="1.2"/><circle cx="37" cy="35" r="1.2"/><circle cx="8" cy="38" r="1.2"/>
      </g>
    </pattern>
    <pattern id="chikanTileIndigo" width="46" height="46" patternUnits="userSpaceOnUse" patternTransform="rotate(12)">
      <g fill="none" stroke="#1E3350" stroke-opacity=".09" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 6c6 0 9 5 9 10 0 6-5 9-2 13 1 2-1 3-3 2-6-2-12-3-12-11 0-7 4-14 8-14z"/>
        <circle cx="9" cy="9" r="1.2"/><circle cx="37" cy="35" r="1.2"/><circle cx="8" cy="38" r="1.2"/>
      </g>
    </pattern>
  </defs>
</svg>`;

// ---------- shared chrome (header/footer) ----------
const CHROME = {
  header: (active) => `
    <header class="site">
      <div class="nav wrap">
        <a class="brand" href="/">
          <svg viewBox="0 0 100 100" class="brand-mark"><use href="#motif-paisley"/></svg>
          <span class="brand-word"><span class="brand-name">ANJALA</span><span class="brand-sub">Chikankari · Est. 2016</span></span>
        </a>
        <nav class="main-nav" id="mainNav">
          <a href="/" class="${active === 'home' ? 'active' : ''}">Home</a>
          <a href="/shop.html" class="${active === 'shop' ? 'active' : ''}">Shop</a>
          <a href="/shop.html?category=personalized-name-art" class="${active === 'personal' ? 'active' : ''}">Personalized Art</a>
          <a href="/booking.html" class="${active === 'booking' ? 'active' : ''}">Book Appointment</a>
          <a href="/about.html" class="${active === 'about' ? 'active' : ''}">Our Craft</a>
          <a href="/contact.html" class="${active === 'contact' ? 'active' : ''}">Contact</a>
        </nav>
        <div class="header-actions">
          <div class="search-box"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" stroke-linecap="round"/></svg><input id="quickSearch" placeholder="Search styles…" /></div>
          <button class="icon-btn" id="accountBtn" title="Account" aria-label="Account"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke-linecap="round"/></svg></button>
          <a class="icon-btn" href="/account.html?tab=orders" title="Track Order" aria-label="Track order"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" stroke-linejoin="round"/><circle cx="7" cy="19" r="1.6"/><circle cx="17.5" cy="19" r="1.6"/></svg></a>
          <button class="icon-btn" id="cartBtn" title="Bag" aria-label="Bag"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 6H6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="21" r="1.4"/><circle cx="18" cy="21" r="1.4"/></svg><span class="cart-count" id="cartCount">0</span></button>
          <button class="menu-toggle" id="menuToggle" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round"/></svg></button>
        </div>
      </div>
    </header>`,
  footer: (settings) => `
    <footer class="site" id="footer">
      <div class="wrap">
        <div class="foot-grid">
          <div>
            <div class="foot-brand"><svg viewBox="0 0 100 100" style="width:34px;height:34px;color:var(--gold)"><use href="#motif-paisley"/></svg><span>ANJALA</span></div>
            <p style="max-width:280px;">${esc(settings?.store_tagline || '')} — hand-embroidered by artisan families in Lucknow, India since 2016, shipped worldwide.</p>
          </div>
          <div><h4>Shop</h4>
            <a href="/shop.html?category=kurtis">Kurtas</a><a href="/shop.html?category=sarees">Sarees</a>
            <a href="/shop.html?category=suits">Anarkali &amp; Co-ord Sets</a><a href="/shop.html?category=personalized-name-art">Personalized Name Art</a>
          </div>
          <div><h4>Help</h4>
            <a href="/account.html?tab=orders">Track Order</a><a href="/booking.html">Book Appointment</a>
            <a href="/contact.html">Contact Us</a><a href="/about.html">Our Craft</a>
          </div>
          <div><h4>Contact</h4>
            <p>${esc(settings?.store_address || '')}</p>
            <p><a href="mailto:${esc(settings?.store_email || '')}">${esc(settings?.store_email || '')}</a></p>
            <p>Mon–Sat, 10am–7pm IST</p>
          </div>
        </div>
        <div class="motif-row"><svg viewBox="0 0 100 100"><use href="#motif-jaali"/></svg><svg viewBox="0 0 100 100"><use href="#motif-paisley"/></svg><svg viewBox="0 0 100 100"><use href="#motif-jaali"/></svg></div>
        <div class="foot-bottom"><span>© ${new Date().getFullYear()} ANJALA Chikankari. Hand-embroidered in Lucknow, India.</span><span>Ships worldwide</span></div>
      </div>
      <div class="footer-border"><svg><rect width="100%" height="100%" fill="url(#chikanTileGold)"/></svg></div>
    </footer>
    <a class="whatsapp-fab" href="https://wa.me/${esc(settings?.whatsapp || '')}" target="_blank" rel="noopener" title="Chat on WhatsApp" aria-label="Chat on WhatsApp">
      <svg viewBox="0 0 32 32" width="30" height="30"><path fill="#fff" d="M16 3C9.4 3 4 8.4 4 15c0 2.4.7 4.6 1.9 6.5L4 29l7.7-1.9C13.5 27.9 14.7 28 16 28c6.6 0 12-5.4 12-12S22.6 3 16 3zm6.2 16.9c-.3.8-1.6 1.5-2.5 1.6-.7.1-1.5.2-4.8-1-3.9-1.6-6.5-5.4-6.7-5.6-.2-.3-1.6-2.1-1.6-4.1 0-1.9 1-2.9 1.4-3.3.4-.4.8-.5 1.1-.5h.7c.2 0 .5-.1.8.6l1.1 2.6c.1.2.1.4 0 .6l-.6 1c-.1.2-.2.4 0 .7.9 1.6 2.4 3 4.1 3.7.3.1.5.1.6-.1l.9-1.1c.2-.3.5-.2.8-.1l2.3 1.1c.3.1.5.2.6.4.1.2.1 1-.2 1.8z"/></svg>
    </a>
    <div class="toast" id="toast"><span id="toastText"></span></div>`,
};

let SETTINGS = null;
async function mountChrome(active) {
  document.body.insertAdjacentHTML('afterbegin', MOTIF_DEFS);
  document.getElementById('headerMount').innerHTML = CHROME.header(active);
  SETTINGS = await api.get('/config').catch(() => ({}));
  document.getElementById('footerMount').innerHTML = CHROME.footer(SETTINGS);
  wireChromeEvents();
  updateCartBadge();
  await Auth.refresh();
  buildCartPanel();
}

function updateCartBadge() {
  const badge = document.getElementById('cartCount');
  if (badge) badge.textContent = Cart.count();
}
document.addEventListener('cart:change', updateCartBadge);

function wireChromeEvents() {
  document.getElementById('menuToggle')?.addEventListener('click', () => document.getElementById('mainNav').classList.toggle('show'));
  document.getElementById('cartBtn')?.addEventListener('click', openCart);
  document.getElementById('accountBtn')?.addEventListener('click', () => {
    if (Auth.user) window.location.href = '/account.html'; else openAuthModal();
  });
  const search = document.getElementById('quickSearch');
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && search.value.trim()) window.location.href = `/shop.html?q=${encodeURIComponent(search.value.trim())}`;
  });
}

// ---------- cart drawer (built once into the page) ----------
function buildCartPanel() {
  if (document.getElementById('cartPanel')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="overlay" id="cartOverlay"></div>
    <aside class="cart-panel" id="cartPanel">
      <div class="cart-head"><h2>Your Bag</h2><button class="modal-close" id="closeCart" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button></div>
      <div class="cart-items" id="cartItems"></div>
      <div class="cart-footer" id="cartFooter"></div>
    </aside>`;
  document.body.appendChild(wrap);
  document.getElementById('closeCart').addEventListener('click', closeCart);
  document.getElementById('cartOverlay').addEventListener('click', closeCart);
  document.addEventListener('cart:change', renderCart);
}

function openCart() { document.getElementById('cartPanel').classList.add('show'); document.getElementById('cartOverlay').classList.add('show'); renderCart(); }
function closeCart() { document.getElementById('cartPanel').classList.remove('show'); document.getElementById('cartOverlay').classList.remove('show'); }

let lastQuote = null;
async function renderCart() {
  const itemsEl = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');
  if (!itemsEl) return;
  const items = Cart.read();
  if (!items.length) {
    itemsEl.innerHTML = `<div class="cart-empty">Your bag is empty.<br>Start with a hand-embroidered piece from the collection.</div>`;
    footerEl.innerHTML = '';
    return;
  }
  itemsEl.innerHTML = '<p style="text-align:center;color:#999;padding:20px 0;">Loading…</p>';
  const withLineIds = items.map(({ lineId, ...rest }) => rest); // server doesn't need the client-only lineId
  let quote;
  try { quote = await api.post('/cart/quote', { items: withLineIds, coupon: sessionStorage.getItem('anzala_coupon') || undefined }); }
  catch { itemsEl.innerHTML = '<p class="msg-error">Could not load your bag. Please try again.</p>'; return; }
  lastQuote = quote;

  // Match each priced line back to its client lineId by position (quote preserves input order for valid lines).
  itemsEl.innerHTML = quote.lines.map((l, i) => {
    const line = items[i] || {};
    return `
    <div class="cart-row">
      <img class="cart-thumb" src="${esc(l.image || '')}" alt="">
      <div class="cart-info">
        <div class="name">${esc(l.name)}</div>
        <div class="cat">${l.size ? `Size: ${esc(l.size)}` : ''}${l.out_of_stock ? ' · <span style="color:#b23b3b">low stock</span>' : ''}</div>
        ${l.custom_text ? `<div class="cart-custom">“${esc(l.custom_text)}”</div>` : ''}
        <div class="qty-row">
          <button class="qty-btn" data-act="dec" data-line="${line.lineId || ''}">−</button>
          <span>${l.qty}</span>
          <button class="qty-btn" data-act="inc" data-line="${line.lineId || ''}">+</button>
        </div>
        <a class="remove-link" data-act="rm" data-line="${line.lineId || ''}">Remove</a>
      </div>
      <div class="cart-price">${money(l.line_total)}</div>
    </div>`;
  }).join('');

  itemsEl.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
    const lineId = btn.dataset.line;
    const line = items.find((i) => i.lineId === lineId);
    if (!line) return;
    if (btn.dataset.act === 'inc') Cart.setQty(lineId, line.qty + 1);
    if (btn.dataset.act === 'dec') Cart.setQty(lineId, line.qty - 1);
    if (btn.dataset.act === 'rm') Cart.remove(lineId);
  }));

  const errors = quote.errors.length ? `<p class="msg-error">${esc(quote.errors.join(' '))}</p>` : '';
  footerEl.innerHTML = `
    ${errors}
    <div class="coupon-row">
      <input id="couponInput" placeholder="Coupon code" value="${esc(quote.coupon ? quote.coupon.code : (sessionStorage.getItem('anzala_coupon') || ''))}">
      <button class="btn btn-outline btn-sm" id="applyCoupon">Apply</button>
    </div>
    ${quote.coupon_error ? `<p class="msg-error">${esc(quote.coupon_error)}</p>` : ''}
    ${quote.coupon ? `<p class="msg-success">"${esc(quote.coupon.code)}" applied.</p>` : ''}
    <div class="sub-row"><span>Subtotal</span><span>${money(quote.subtotal)}</span></div>
    ${quote.discount ? `<div class="sub-row"><span>Discount</span><span>−${money(quote.discount)}</span></div>` : ''}
    <div class="sub-row"><span>Shipping (Worldwide)</span><span>${quote.shipping ? money(quote.shipping) : 'Free'}</span></div>
    <div class="sub-row total"><span>Total</span><span>${money(quote.total)}</span></div>
    <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:16px" onclick="window.location.href='/checkout.html'">Checkout</button>
    <div class="ship-note">${quote.subtotal < quote.free_shipping_min ? `Add ${money(quote.free_shipping_min - quote.subtotal)} more for free worldwide shipping` : "You've unlocked free worldwide shipping"}</div>`;

  document.getElementById('applyCoupon')?.addEventListener('click', () => {
    const code = document.getElementById('couponInput').value.trim();
    if (code) sessionStorage.setItem('anzala_coupon', code); else sessionStorage.removeItem('anzala_coupon');
    renderCart();
  });
}

// ---------- auth modal ----------
function openAuthModal() {
  let modal = document.getElementById('authModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'authModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:440px;padding:40px;">
        <button class="modal-close" id="authClose"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
        <div class="payment-methods" style="margin-bottom:24px;">
          <button type="button" class="pm-option active" data-tab="login">Log In</button>
          <button type="button" class="pm-option" data-tab="register">Create Account</button>
        </div>
        <form id="loginForm">
          <div class="field full"><label>Email</label><input type="email" name="email" required></div>
          <div class="field full"><label>Password</label><input type="password" name="password" required></div>
          <p class="field-error" id="loginError"></p>
          <button class="btn btn-primary" style="width:100%;justify-content:center;" type="submit">Log In</button>
        </form>
        <form id="registerForm" style="display:none">
          <div class="field full"><label>Full Name</label><input name="name" required></div>
          <div class="field full"><label>Email</label><input type="email" name="email" required></div>
          <div class="field full"><label>Phone</label><input name="phone" placeholder="With country code if outside India"></div>
          <div class="field full"><label>Password</label><input type="password" name="password" minlength="8" required></div>
          <p class="field-error" id="registerError"></p>
          <button class="btn btn-primary" style="width:100%;justify-content:center;" type="submit">Create Account</button>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeAuthModal(); });
    document.getElementById('authClose').addEventListener('click', closeAuthModal);
    modal.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
      modal.querySelectorAll('[data-tab]').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('loginForm').style.display = tab.dataset.tab === 'login' ? 'block' : 'none';
      document.getElementById('registerForm').style.display = tab.dataset.tab === 'register' ? 'block' : 'none';
    }));
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await Auth.login(f.get('email'), f.get('password')); closeAuthModal(); toast('Welcome back!'); }
      catch (err) { document.getElementById('loginError').textContent = err.message; }
    });
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await Auth.register({ name: f.get('name'), email: f.get('email'), phone: f.get('phone'), password: f.get('password') });
        closeAuthModal(); toast('Account created!');
      } catch (err) { document.getElementById('registerError').textContent = err.message; }
    });
  }
  modal.classList.add('show');
}
function closeAuthModal() { document.getElementById('authModal')?.classList.remove('show'); }

function starRow(rating) {
  const full = Math.round(rating || 0);
  return `<span class="stars">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`;
}

function qs(name) { return new URLSearchParams(window.location.search).get(name); }

// ---------- product card (shared by home / shop / related-products) ----------
// Note: data attributes carry the product info instead of inline onclick handlers, since embedding JSON
// (double quotes) inside a double-quoted HTML attribute breaks parsing.
function productCard(p) {
  const needsOptions = p.sizes.length > 0 || p.personalizable;
  return `
  <div class="card" data-open="${p.slug}">
    <div class="card-media">
      <img src="${esc(p.images[0] || '')}" alt="${esc(p.name)}" loading="lazy">
      ${p.compare_price ? `<span class="card-tag">-${Math.round(100 - (p.price / p.compare_price) * 100)}%</span>` : ''}
      ${p.personalizable ? `<span class="card-tag-alt">Add a Name</span>` : ''}
      ${!p.personalizable && p.stock <= 3 && p.stock > 0 ? `<span class="card-tag">Only ${p.stock} left</span>` : ''}
      ${p.stock === 0 ? `<span class="card-tag">Sold out</span>` : ''}
      <button class="card-add" ${p.stock === 0 ? 'disabled' : ''} data-quickadd="${p.id}" data-slug="${esc(p.slug)}" data-needs-options="${needsOptions ? '1' : ''}" aria-label="Add to bag" onclick="event.stopPropagation()">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
      </button>
      <button class="wish-btn" data-wish="${p.id}" onclick="event.stopPropagation()">♡</button>
    </div>
    <div class="card-body">
      <div class="card-cat">${esc(p.fabric || '')}</div>
      <div class="card-name">${esc(p.name)}</div>
      ${p.rating ? `<div class="rating-row">${starRow(p.rating)} ${p.rating} (${p.review_count || 0})</div>` : '<div class="card-fabric">Hand-embroidered · Lucknow</div>'}
      <div class="card-price">${money(p.price)}${p.compare_price ? ` <span class="price-compare">${money(p.compare_price)}</span>` : ''}</div>
    </div>
  </div>`;
}

function quickAdd(id, slug, needsOptions) {
  if (needsOptions) { window.location.href = `/product.html?slug=${slug}#options`; return; }
  Cart.add(id, null, 1);
  toast('Added to your bag');
}

async function wireProductCards() {
  document.querySelectorAll('[data-open]').forEach((card) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => { window.location.href = `/product.html?slug=${card.dataset.open}`; });
  });
  document.querySelectorAll('[data-quickadd]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      quickAdd(Number(btn.dataset.quickadd), btn.dataset.slug, btn.dataset.needsOptions === '1');
    });
  });
  const wished = await Wishlist.list().catch(() => []);
  document.querySelectorAll('[data-wish]').forEach((btn) => {
    const id = Number(btn.dataset.wish);
    if (wished.includes(id)) { btn.classList.add('active'); btn.textContent = '♥'; }
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await Wishlist.toggle(id);
      btn.classList.toggle('active');
      btn.textContent = btn.classList.contains('active') ? '♥' : '♡';
      toast(btn.classList.contains('active') ? 'Added to wishlist' : 'Removed from wishlist');
    });
  });
}
