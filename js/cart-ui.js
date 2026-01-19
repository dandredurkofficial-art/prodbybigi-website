// /js/cart-ui.js (BeatStars-like cart drawer + combined checkout)
// ✅ validates items
// ✅ forces licenseKey lowercase
// ✅ sends Firebase buyer token if logged in

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

  function toKey(x) {
    return String(x || "basic").trim().toLowerCase();
  }

  async function getBuyerIdToken() {
    try {
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

      const firebaseConfig = {
        apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
        authDomain: "prodbybigi.firebaseapp.com",
        projectId: "prodbybigi"
      };

      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const user = auth.currentUser;
      if (!user) return null;

      return await user.getIdToken();
    } catch {
      return null;
    }
  }

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

    if (checkoutBtn) checkoutBtn.disabled = !cart.length;

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
          <div class="pb-cart-item" data-beat-id="${x.beatId}" data-license-key="${toKey(x.licenseKey)}">
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

  checkoutBtn?.addEventListener("click", async () => {
    try {
      if (!window.API_BASE) throw new Error("Missing API_BASE");

      const items = window.PB_CART?.list ? window.PB_CART.list() : [];
      if (!items.length) return;

      // ✅ validate items BEFORE calling API (prevents "Invalid cart items")
      const payload = {
        items: items.map((x) => ({
          beatId: String(x.beatId || "").trim(),
          licenseKey: toKey(x.licenseKey),
          qty: Math.max(1, Number(x.qty || 1))
        }))
      };

      if (payload.items.some((i) => !i.beatId || !i.licenseKey)) {
        alert("Invalid cart items. Please clear cart and add again.");
        return;
      }

      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Redirecting…";

      const token = await getBuyerIdToken();

      const r = await fetch(`${window.API_BASE}/api/cart-checkout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Cart checkout failed");

      if (data.orderId) localStorage.setItem("pb_last_order_id", data.orderId);

      const approve =
        (data.approveLinks || []).find((l) => l.rel === "approve") ||
        (data.approveLinks || []).find((l) => l.rel === "payer-action");

      if (!approve?.href) throw new Error("No PayPal approve link returned");

      window.location.href = approve.href;
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = "Checkout";
    }
  });

  window.addEventListener("pb-cart-updated", render);
  render();
})();
