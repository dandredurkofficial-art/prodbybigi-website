// /js/cart-ui.js (BeatStars-like cart drawer + combined checkout)
// ✅ validates items
// ✅ forces licenseKey lowercase
// ✅ supports multi-item cart checkout via PB_PAYPAL_CREATE_ORDER_URL
// ✅ optional Firebase buyer token header (if you later secure createOrder)
// ✅ redirects to PayPal approveUrl

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

  function toQty(n) {
    const q = Number(n || 1);
    return Number.isFinite(q) ? Math.max(1, Math.floor(q)) : 1;
  }

  // OPTIONAL: If you later protect createOrder with Firebase auth, this will help.
  async function getBuyerIdToken() {
    try {
      const { initializeApp, getApps } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"
      );
      const { getAuth } = await import(
        "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"
      );

      const firebaseConfig = {
        apiKey: "AIzaSyCmsFTjDryYOTddWfScTKsnrs0cWAHnpdc",
        authDomain: "audiory-beat-store.firebaseapp.com",
        projectId: "audiory-beat-store",
        storageBucket: "audiory-beat-store.firebasestorage.app",
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
          ? `<img src="${x.artwork}" alt="${String(x.title || "")}" loading="lazy" />`
          : `<div>${initials(x.title)}</div>`;

        return `
          <div class="pb-cart-item" data-beat-id="${String(x.beatId || "")}" data-license-key="${toKey(
          x.licenseKey
        )}">
            <div class="pb-cart-img">${art}</div>

            <div class="pb-cart-meta">
              <div class="pb-cart-name">${String(x.title || x.beatId || "Item")}</div>
              <div class="pb-cart-line">
                <span class="pb-pill">License: <b>${String(
                  x.licenseName || x.licenseKey || "basic"
                )}</b></span>
                <span class="pb-pill">Qty: <b>${toQty(x.qty)}</b></span>
              </div>
            </div>

            <div class="pb-cart-right">
              <div class="pb-cart-price">${money(
                (Number(x.price) || 0) * toQty(x.qty)
              )}</div>
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

  // ✅ Checkout (multi-item cart)
  checkoutBtn?.addEventListener("click", async () => {
    const originalText = checkoutBtn.textContent;

    try {
      const createUrl = String(window.PB_PAYPAL_CREATE_ORDER_URL || "").trim();
      if (!createUrl) throw new Error("Missing PB_PAYPAL_CREATE_ORDER_URL on this page.");

      const items = window.PB_CART?.list ? window.PB_CART.list() : [];
      if (!items.length) return;

      // ✅ Build payload (server must calculate prices; client only sends ids/keys/qty)
      const payload = {
        items: items
          .map((x) => ({
            beatId: String(x.beatId || "").trim(),
            licenseKey: toKey(x.licenseKey),
            qty: toQty(x.qty || 1),
          }))
          .filter((i) => i.beatId && i.licenseKey),
      };

      if (!payload.items.length) {
        alert("Invalid cart items. Please clear cart and add again.");
        return;
      }

      // extra safety
      if (payload.items.some((i) => !i.beatId || !i.licenseKey)) {
        alert("Invalid cart items. Please clear cart and add again.");
        return;
      }

      checkoutBtn.disabled = true;
      checkoutBtn.textContent = "Redirecting…";

      const token = await getBuyerIdToken();

      let r, data;
      try {
        r = await fetch(createUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        data = await r.json().catch(() => ({}));
      } catch (e) {
        console.error("Fetch failed:", e);
        throw new Error("Failed to fetch (network/CORS). Open console for details.");
      }

      if (!r.ok) {
        console.error("createOrder error:", data);
        throw new Error(data?.error || "Cart checkout failed");
      }

      // Save ids for success page if you want
      if (data.orderId) localStorage.setItem("pb_last_order_id", data.orderId);
      if (data.cartId) localStorage.setItem("pb_last_cart_id", data.cartId);

      // accept either approveUrl OR approveLinks array
      const approveUrl =
        data.approveUrl ||
        (Array.isArray(data.approveLinks)
          ? (data.approveLinks.find((l) => l.rel === "approve") ||
              data.approveLinks.find((l) => l.rel === "payer-action"))?.href
          : null);

      if (!approveUrl) throw new Error("No PayPal approve link returned.");

      window.location.href = approveUrl;
    } catch (err) {
      console.error(err);
      alert(err?.message || "Checkout failed");
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = originalText || "Checkout";
    }
  });

  window.addEventListener("pb-cart-updated", render);
  render();
})();
