// /js/cart-ui.js
(function () {
  const $ = (id) => document.getElementById(id);

  const btn = $("pbCartBtn");
  const countEl = $("pbCartCount");
  const drawer = $("pbCartDrawer");
  const backdrop = $("pbCartBackdrop");
  const closeBtn = $("pbCartClose");
  const clearBtn = $("pbCartClear");
  const checkoutBtn = $("pbCartCheckout");
  const itemsEl = $("pbCartItems");
  const totalEl = $("pbCartTotal");
  const subEl = $("pbCartSub");

  if (!btn || !drawer || !backdrop || !itemsEl) return;

  const money = (n) => {
    const v = Number(n || 0);
    return "$" + (isFinite(v) ? v.toFixed(2) : "0.00");
  };

  function open() {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
  }

  function close() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
  }

  function initials(title) {
    const t = String(title || "B").trim().toUpperCase();
    return t.slice(0, 2);
  }

  function render() {
    const cart = window.PB_CART?.list ? window.PB_CART.list() : [];
    const count = window.PB_CART?.count ? window.PB_CART.count() : 0;
    const total = window.PB_CART?.total ? window.PB_CART.total() : 0;

    if (countEl) countEl.textContent = String(count);
    if (subEl) subEl.textContent = `${count} item${count === 1 ? "" : "s"}`;
    if (totalEl) totalEl.textContent = money(total);

    checkoutBtn.disabled = !cart.length;

    if (!cart.length) {
      itemsEl.innerHTML = `<div class="pb-cart-empty">Your cart is empty.</div>`;
      return;
    }

    itemsEl.innerHTML = cart
      .map((x) => {
        const art = x.artwork
          ? `<img src="${x.artwork}" alt="${x.title}" loading="lazy" />`
          : `<div>${initials(x.title)}</div>`;

        return `
          <div class="pb-cart-item" data-beat-id="${x.beatId}" data-license-key="${x.licenseKey}">
            <div class="pb-cart-img">${art}</div>

            <div class="pb-cart-meta">
              <div class="pb-cart-name">${x.title}</div>
              <div class="pb-cart-line">
                <span class="pb-pill">License: <b>${x.licenseName || x.licenseKey}</b></span>
                <span class="pb-pill">Qty: <b>${x.qty || 1}</b></span>
              </div>
            </div>

            <div class="pb-cart-right">
              <div class="pb-cart-price">${money((Number(x.price)||0) * (Number(x.qty)||1))}</div>
              <button class="pb-cart-remove" type="button">Remove</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  // Events
  btn.addEventListener("click", () => {
    render();
    open();
  });

  closeBtn?.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  clearBtn?.addEventListener("click", () => {
    window.PB_CART?.clear?.();
    render();
  });

  itemsEl.addEventListener("click", (e) => {
    const rm = e.target.closest(".pb-cart-remove");
    if (!rm) return;

    const row = rm.closest(".pb-cart-item");
    if (!row) return;

    const beatId = row.getAttribute("data-beat-id");
    const licenseKey = row.getAttribute("data-license-key");
    window.PB_CART?.remove?.(beatId, licenseKey);
    render();
  });

  checkoutBtn?.addEventListener("click", () => {
    // For now: send user to marketplace and show modal per item later
    // (Next step: multi-item checkout endpoint)
    alert("Checkout coming next. For now, use Buy Now on a beat ✅");
    close();
  });

  // Keep cart badge updated everywhere
  window.addEventListener("pb-cart-updated", render);

  // Initial badge
  render();
})();
