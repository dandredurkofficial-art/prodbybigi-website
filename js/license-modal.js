// /js/license-modal.js
// Fixes: play/pause triggering modal, consistent licenses, safe cart add.

(function () {
  const $ = (id) => document.getElementById(id);

  const modal = $("pbLicenseModal");
  const backdrop = $("pbModalBackdrop");
  const closeBtn = $("pbModalClose");
  const titleEl = $("pbModalTitle");
  const subEl = $("pbModalSub");
  const grid = $("pbLicensesGrid");
  const totalEl = $("pbTotalPrice");
  const termsGrid = $("pbTermsGrid");
  const buyBtn = $("pbBuyNow");
  const cartBtn = $("pbAddToCart");

  if (!modal || !backdrop || !buyBtn || !grid) return;

  let currentBeat = null;
  let selectedLicense = null;

  const money = (n) => {
    const v = Number(n || 0);
    return "$" + (isFinite(v) ? v.toFixed(2) : "0.00");
  };

  function resetBuyBtn() {
    buyBtn.disabled = false;
    buyBtn.textContent = "Buy now";
  }

  function resolveBeatId() {
    if (!currentBeat) return "";
    return String(currentBeat.id || currentBeat.beatId || currentBeat.docId || "");
  }

  async function getBuyerIdTokenFast() {
    try {
      if (window.FB?.getIdToken) return await window.FB.getIdToken();
    } catch {}
    return null;
  }

  async function createPaypalOrder({ beatId, licenseKey }) {
    if (!window.API_BASE) throw new Error("Missing API_BASE");

    const token = await getBuyerIdTokenFast();

    const r = await fetch(`${window.API_BASE}/api/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ beatId, licenseKey })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Create order failed");

    if (data.orderId) localStorage.setItem("pb_last_order_id", data.orderId);

    const approve =
      (data.approveLinks || []).find((l) => l.rel === "approve") ||
      (data.approveLinks || []).find((l) => l.rel === "payer-action");

    if (!approve?.href) throw new Error("No PayPal approve link returned");
    window.location.href = approve.href;
  }

  // ✅ Force same licenses everywhere
  function fixedLicenses() {
    return [
      {
        key: "basic",
        name: "Basic",
        price: 29.99,
        meta: "MP3",
        badge: "Popular",
        terms: ["MP3 download", "Non-exclusive", "1 song/project", "Streaming allowed"]
      },
      {
        key: "premium",
        name: "Premium",
        price: 79.99,
        meta: "MP3",
        terms: ["MP3 download", "Non-exclusive", "More usage", "Monetization allowed"]
      },
      {
        key: "exclusive",
        name: "Exclusive",
        price: 299.99,
        meta: "MP3",
        terms: ["MP3 download", "Exclusive rights", "Beat removed from store", "Full monetization"]
      }
    ];
  }

  function renderTerms(license) {
    if (!termsGrid) return;
    termsGrid.innerHTML = "";

    const terms = (license?.terms && license.terms.length)
      ? license.terms
      : ["Instant download", "License proof included", "Producer credited"];

    terms.slice(0, 6).forEach((t) => {
      const el = document.createElement("div");
      el.className = "pb-term";
      el.innerHTML = `<b>•</b> ${t}`;
      termsGrid.appendChild(el);
    });
  }

  function openModal(beat) {
    currentBeat = beat;
    resetBuyBtn();

    titleEl.textContent = beat?.title || "Beat";
    subEl.textContent = "Select a license to continue.";

    const licenses = fixedLicenses();
    selectedLicense = licenses[0];

    grid.innerHTML = "";
    if (termsGrid) termsGrid.innerHTML = "";

    licenses.forEach((l, idx) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "pb-license" + (idx === 0 ? " selected" : "");
      card.setAttribute("data-lic", l.key);

      card.innerHTML = `
        ${l.badge ? `<div class="pb-badge">${l.badge}</div>` : ""}
        <div class="name">${l.name}</div>
        <div class="price">${money(l.price)}</div>
        <div class="meta">${l.meta || ""}</div>
      `;

      card.addEventListener("click", () => {
        [...grid.querySelectorAll(".pb-license")].forEach((x) => x.classList.remove("selected"));
        card.classList.add("selected");
        selectedLicense = l;
        if (totalEl) totalEl.textContent = money(l.price);
        renderTerms(l);
        resetBuyBtn();
      });

      grid.appendChild(card);
    });

    if (totalEl) totalEl.textContent = money(selectedLicense.price);
    renderTerms(selectedLicense);

    backdrop.classList.add("open");
    modal.classList.add("open");
    document.body.classList.add("no-scroll");
  }

  function closeModal() {
    backdrop.classList.remove("open");
    modal.classList.remove("open");
    document.body.classList.remove("no-scroll");
    currentBeat = null;
    selectedLicense = null;
    resetBuyBtn();
  }

  buyBtn.addEventListener("click", async () => {
    if (!currentBeat || !selectedLicense) return;

    const beatId = resolveBeatId();
    if (!beatId) {
      alert("Missing beat id. Please refresh.");
      return;
    }

    buyBtn.disabled = true;
    buyBtn.textContent = "Redirecting…";

    try {
      await createPaypalOrder({ beatId, licenseKey: selectedLicense.key });
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      resetBuyBtn();
    }
  });

  cartBtn?.addEventListener("click", () => {
    if (!currentBeat || !selectedLicense) return;

    const beatId = resolveBeatId();
    if (!beatId || !selectedLicense.key) {
      alert("Invalid cart item (missing beatId/license key)");
      return;
    }

    if (!window.PB_CART) {
      alert("Cart not loaded. Ensure /js/cart.js is included.");
      return;
    }

    window.PB_CART.add({
      beatId,
      title: currentBeat.title || "Beat",
      artwork: currentBeat.artwork || "",
      price: Number(selectedLicense.price || 0),
      licenseKey: selectedLicense.key,
      licenseName: selectedLicense.name || selectedLicense.key
    });

    alert("Added to cart ✅");
  });

  closeBtn?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ✅ Only open modal when clicking price-pill / buy area — NOT the whole card.
  // ✅ Also ignore clicks on play buttons/controls.
  document.addEventListener("click", (e) => {
    // ignore play controls
    if (e.target.closest("[data-play-btn], .play-btn, .play-fab")) return;

    const pill = e.target.closest(".price-pill, .price-btn, [data-open-license]");
    if (!pill) return;

    const wrap = pill.closest(".beat-card, .trend-card");
    if (!wrap) return;

    const beatId = wrap.getAttribute("data-beat-id") || "";
    const list = window.__LATEST_BEATS__ || [];
    let beat = null;

    if (beatId && Array.isArray(list)) {
      beat = list.find((b) => String(b.id) === String(beatId)) || null;
    }

    if (!beat) {
      const title =
        (wrap.querySelector("h3")?.textContent ||
          wrap.querySelector(".t")?.textContent ||
          "Beat").trim();

      beat = { id: beatId, title, artwork: "", price: 29.99 };
    }

    openModal(beat);
  });

  window.PB_OPEN_LICENSE_MODAL = openModal;
  window.PB_CLOSE_LICENSE_MODAL = closeModal;
})();
