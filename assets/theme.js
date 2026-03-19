/**
 * Hausu Mountain — theme.js
 * Global interactive behaviour: cart drawer, search dropdown,
 * genre-button font scaling, mobile filter toggle, variant selector.
 *
 * Cart API docs:  https://shopify.dev/docs/api/ajax/reference/cart
 * Search API docs: https://shopify.dev/docs/api/ajax/reference/predictive-search
 */

/* ─── Money formatting ────────────────────────────────────────
 * Cart API returns prices in cents (integer).
 * Predictive Search API returns prices as decimal dollars (string/float).
 * Use the correct helper per context.
 */
function formatMoneyFromCents(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function formatMoneyFromDecimal(dollars) {
  return '$' + parseFloat(dollars).toFixed(2);
}

/* ─── Cart drawer ─────────────────────────────────────────────
 * Uses native <dialog> for focus-trapping and Esc-to-close.
 * Cart state managed via /cart.js and /cart/change.js.
 */
const cartDrawer = document.getElementById('cart-drawer');
const cartBtns   = document.querySelectorAll('.header__cart-btn');
const cartClose    = document.querySelector('.cart-drawer__close');
const cartContinue = document.querySelector('.cart-drawer__continue');

function openCartDrawer() {
  if (!cartDrawer) return;
  cartDrawer.showModal();
  cartDrawer.setAttribute('scroll-lock', '');
  cartBtns.forEach(btn => btn.setAttribute('aria-expanded', 'true'));
  refreshCartDrawer();
}

function closeCartDrawer() {
  if (!cartDrawer) return;
  cartDrawer.close();
  cartDrawer.removeAttribute('scroll-lock');
  cartBtns.forEach(btn => btn.setAttribute('aria-expanded', 'false'));
  // Return focus to the button that opened the drawer
  cartBtns[0]?.focus();
}

cartBtns.forEach(btn => btn.addEventListener('click', openCartDrawer));
cartClose?.addEventListener('click', closeCartDrawer);
cartContinue?.addEventListener('click', closeCartDrawer);

// Close when clicking the backdrop (outside the dialog box)
cartDrawer?.addEventListener('click', (e) => {
  if (e.target === cartDrawer) closeCartDrawer();
});

async function refreshCartDrawer() {
  try {
    const res  = await fetch('/cart.js');
    if (!res.ok) throw new Error(`Cart fetch failed: ${res.status}`);
    const cart = await res.json();
    renderCartDrawer(cart);
  } catch (err) {
    console.error('Cart fetch failed', err);
  }
}

function renderCartDrawer(cart) {
  const body = document.getElementById('cart-drawer-body');
  if (!body) return;

  updateCartCount(cart.item_count);

  if (cart.item_count === 0) {
    body.innerHTML = '<p class="cart-drawer__empty">Your cart is empty.</p>';
    const subtotal = document.querySelector('.cart-drawer__footer-subtotal');
    if (subtotal) subtotal.textContent = '';
    return;
  }

  body.innerHTML = cart.items.map(item => `
    <div class="cart-drawer__item" data-key="${item.key}">
      <a href="${item.url}" class="cart-drawer__item-image-link" tabindex="-1" aria-hidden="true">
        <img src="${item.image}" alt="" width="80" height="80" class="cart-drawer__item-image">
      </a>
      <div class="cart-drawer__item-info">
        <a href="${item.url}" class="cart-drawer__item-title">${item.product_title}</a>
        ${item.variant_title && item.variant_title !== 'Default Title'
          ? `<span class="cart-drawer__item-variant">${item.variant_title}</span>`
          : ''}
        <div class="cart-drawer__item-actions">
          <div class="cart-drawer__qty" role="group" aria-label="Quantity for ${item.product_title}">
            <button
              class="cart-drawer__qty-btn"
              data-key="${item.key}"
              data-current="${item.quantity}"
              data-delta="-1"
              aria-label="Decrease quantity"
            >−</button>
            <span class="cart-drawer__qty-val" aria-live="polite">${item.quantity}</span>
            <button
              class="cart-drawer__qty-btn"
              data-key="${item.key}"
              data-current="${item.quantity}"
              data-delta="1"
              aria-label="Increase quantity"
            >+</button>
          </div>
          <span class="cart-drawer__item-price">${formatMoneyFromCents(item.final_line_price)}</span>
          <button
            class="cart-drawer__remove"
            data-key="${item.key}"
            aria-label="Remove ${item.product_title} from cart"
          >Remove</button>
        </div>
      </div>
    </div>
  `).join('');

  const subtotal = document.querySelector('.cart-drawer__footer-subtotal');
  if (subtotal) subtotal.textContent = formatMoneyFromCents(cart.total_price);

  // Re-attach event handlers to newly rendered elements
  body.querySelectorAll('.cart-drawer__qty-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key     = btn.dataset.key;
      const current = parseInt(btn.dataset.current, 10);
      const delta   = parseInt(btn.dataset.delta, 10);
      const newQty  = Math.max(0, current + delta);
      await updateCartItem(key, newQty);
    });
  });

  body.querySelectorAll('.cart-drawer__remove').forEach(btn => {
    btn.addEventListener('click', () => updateCartItem(btn.dataset.key, 0));
  });
}

async function updateCartItem(key, quantity) {
  try {
    const res = await fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, quantity }),
    });
    if (!res.ok) throw new Error(`Cart change failed: ${res.status}`);
    const cart = await res.json();
    renderCartDrawer(cart);
  } catch (err) {
    console.error('Cart update failed', err);
  }
}

function updateCartCount(count) {
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = count;
    el.hidden = count === 0;
  });
  document.querySelectorAll('.header__cart-btn').forEach(btn => {
    const label = count > 0
      ? `Cart, ${count} item${count !== 1 ? 's' : ''}`
      : 'Cart';
    btn.setAttribute('aria-label', label);
  });
}

/* ─── Add-to-cart interception ────────────────────────────────
 * Intercepts product form submissions, posts to /cart/add.js
 * via AJAX, then opens the cart drawer instead of reloading.
 */
document.querySelectorAll('[data-product-form]').forEach(form => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
    }

    const formData = new FormData(form);

    try {
      const res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: formData.get('id'),
          quantity: parseInt(formData.get('quantity'), 10) || 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        const errorEl = form.querySelector('[data-cart-error]');
        if (errorEl) {
          errorEl.textContent = err.description || 'Could not add item to cart.';
          errorEl.hidden = false;
        }
        return;
      }

      // Hide any previous error
      const errorEl = form.querySelector('[data-cart-error]');
      if (errorEl) errorEl.hidden = true;

      openCartDrawer();
    } catch (err) {
      console.error('Add to cart failed', err);
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
      }
    }
  });
});

/* ─── Search dropdown ─────────────────────────────────────────
 * Predictive Search API returns prices as decimal dollar strings.
 */
const searchDropdown = document.getElementById('search-dropdown');
const searchBtns     = document.querySelectorAll('.header__search-btn');
const searchInput    = document.getElementById('search-input');
const searchResults  = document.getElementById('search-results');

let searchTimeout;

function openSearch() {
  if (!searchDropdown) return;
  searchDropdown.removeAttribute('hidden');
  searchBtns.forEach(btn => btn.setAttribute('aria-expanded', 'true'));
  searchInput?.focus();
}

function closeSearch() {
  if (!searchDropdown) return;
  searchDropdown.setAttribute('hidden', '');
  searchBtns.forEach(btn => btn.setAttribute('aria-expanded', 'false'));
}

searchBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    expanded ? closeSearch() : openSearch();
  });
});

// Close on outside click
document.addEventListener('click', (e) => {
  if (!searchDropdown) return;
  const clickedOutside =
    !searchDropdown.contains(e.target) &&
    ![...searchBtns].some(btn => btn.contains(e.target));
  if (clickedOutside) closeSearch();
});

// Esc closes both drawer and search
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (searchDropdown && !searchDropdown.hasAttribute('hidden')) {
    closeSearch();
    searchBtns[0]?.focus();
  }
  // <dialog> natively handles Esc, but we clean up our state
  if (cartDrawer?.open) closeCartDrawer();
});

searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  if (query.length < 2) {
    if (searchResults) searchResults.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
    return;
  }
  searchTimeout = setTimeout(() => fetchSuggestions(query), 300);
});

async function fetchSuggestions(query) {
  try {
    const params = new URLSearchParams({
      q: query,
      'resources[type]': 'product',
      'resources[limit]': '6',
    });
    const res  = await fetch(`/search/suggest.json?${params}`);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    const data = await res.json();
    renderSuggestions(data.resources?.results?.products ?? []);
  } catch (err) {
    console.error('Search fetch failed', err);
  }
}

function renderSuggestions(products) {
  if (!searchResults) return;
  searchInput.setAttribute('aria-expanded', 'true');

  if (products.length === 0) {
    searchResults.innerHTML =
      '<li class="search-result search-result--empty" role="option">No results found</li>';
    return;
  }

  searchResults.innerHTML = products.map(p => {
    // featured_image.url is the image URL per the API spec
    const imgUrl = p.featured_image?.url ?? p.image ?? '';
    // price is a decimal dollar amount from predictive search
    const price = p.price != null ? formatMoneyFromDecimal(p.price) : '';
    return `
      <li class="search-result" role="option">
        <a href="${p.url}" class="search-result__link">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="" width="48" height="48" class="search-result__image" loading="lazy">`
            : ''}
          <span class="search-result__title">${p.title}</span>
          ${price ? `<span class="search-result__price">${price}</span>` : ''}
        </a>
      </li>
    `;
  }).join('');
}

/* ─── Genre button font scaling ───────────────────────────────
 * Reduces font-size until text fits within the button's width.
 * Words cannot wrap; lines can break (white-space: normal on parent,
 * word-break: keep-all on text). Font starts at 44px, min 12px.
 */
function scaleGenreButtons() {
  document.querySelectorAll('.genre-btn').forEach(btn => {
    const text = btn.querySelector('.genre-btn__text');
    if (!text) return;
    let size = 44;
    text.style.fontSize = size + 'px';
    // scrollWidth > offsetWidth means text is overflowing horizontally
    while (text.scrollWidth > btn.clientWidth && size > 12) {
      size -= 1;
      text.style.fontSize = size + 'px';
    }
  });
}

document.fonts.ready.then(scaleGenreButtons);
window.addEventListener('resize', scaleGenreButtons);

/* ─── Mobile filter toggle ────────────────────────────────────*/
const filterToggleBtns = document.querySelectorAll('.filter-toggle-btn');
const filterSidebar    = document.getElementById('filter-sidebar');

filterToggleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    filterSidebar?.classList.toggle('is-open', !expanded);
  });
});

/* ─── Collection filter auto-submit on checkbox change ────────*/
document.querySelectorAll('#filter-form input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    document.getElementById('filter-form')?.submit();
  });
});

/* ─── Variant selector (product page) ────────────────────────
 * Styled radio-button-style buttons update the hidden variant id
 * input and the displayed price.
 */
const variantBtns  = document.querySelectorAll('.variant-btn');
const variantInput = document.getElementById('variant-input');
const productPrice = document.querySelector('.product-price');

variantBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    variantBtns.forEach(b => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('is-selected');
    btn.setAttribute('aria-pressed', 'true');

    if (variantInput) variantInput.value = btn.dataset.variantId;
    if (productPrice && btn.dataset.price) {
      // variant prices from Liquid are in cents
      productPrice.textContent = formatMoneyFromCents(parseInt(btn.dataset.price, 10));
    }
  });
});

/* ─── Filter group expand/collapse ───────────────────────────*/
document.querySelectorAll('.filter-group__toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const expanded  = toggle.getAttribute('aria-expanded') === 'true';
    const targetId  = toggle.getAttribute('aria-controls');
    const target    = targetId ? document.getElementById(targetId) : null;
    toggle.setAttribute('aria-expanded', String(!expanded));
    if (target) target.hidden = expanded;
  });
});
