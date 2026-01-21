// /js/license-modal.js (CONSISTENT LICENSES + NO PLAY->MODAL + CART SAFE + FAST PAYPAL REDIRECT)
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

  function resolveBeatId(beat) {
    const b = beat || currentBeat || {};
    return String(b.id || b.beatId || b.docId || b._id || "").trim();
  }

  function safeTitle(beat) {
    return String(beat?.title || beat?.beatTitle || "Beat").trim();
  }

  // ✅ FAST token getter (from /js/firebase.js)
  async function getBuyerIdTokenFast() {
    try {
      if (window.FB?.getIdToken) return await window.FB.getIdToken();
    } catch {}
    return null;
  }

  // ✅ FAST PayPal order creation (no extra imports)
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

  // ✅ SINGLE SOURCE OF LICENSES (consistent everywhere)
  // You asked EXACTLY: Basic $29.99, Premium $79.99, Exclusive $299.99
  function buildFixedLicenses() {
    return [
      {
        key: "basic",
        name: "Basic",
        price: 29.99,
        meta: "MP3",
        badge: "Popular",
        terms: [
          "MP3 download",
          "Non-exclusive license",
          "Use for 1 song/project",
          "Up to 10,000 streams",
          "Credit producer required",
          "No Content ID"
        ]
      },
      {
        key: "premium",
        name: "Premium",
        price: 79.99,
        meta: "WAV + MP3",
        terms: [
          "WAV + MP3 download",
          "Non-exclusive license",
          "Use for 1 song/project",
          "Up to 100,000 streams",
          "Monetization allowed",
          "Credit producer required"
        ]
      },
      {
        key: "exclusive",
        name: "Exclusive",
        price: 299.99,
        meta: "STEMS + WAV",
        terms: [
          "STEMS + WAV included",
          "Exclusive rights (producer stops selling this beat)",
          "Unlimited streams",
          "Monetization allowed",
          "Wide distribution",
          "Credit producer required"
        ]
      }
    ];
  }

  // If your Firestore beat has licenses, we can still use them,
  // BUT you requested fixed prices everywhere, so we ALWAYS show fixed.
  function getLicensesForBeat(_beat) {
    return buildFixedLicenses();
  }

  function renderTerms(license) {
    if (!termsGrid) return;
    termsGrid.innerHTML = "";

    const terms = (license?.terms && license.terms.length)
      ? license.terms
      : ["Instant download", "License proof included", "Producer credited"];

    terms.slice(0, 8).forEach((t) => {
      const el = document.createElement("div");
      el.className = "pb-term";
      el.innerHTML = `<b>•</b> ${t}`;
      termsGrid.appendChild(el);
    });
  }

  function openModal(beat) {
    currentBeat = beat;
    resetBuyBtn();

    titleEl.textContent = safeTitle(beat);
    subEl.textContent = "Select a license to continue.";

    const licenses = getLicensesForBeat(beat);
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

  // ✅ BUY NOW
  buyBtn.addEventListener("click", async () => {
    if (!currentBeat || !selectedLicense) return;

    const beatId = resolveBeatId(currentBeat);
    if (!beatId) {
      alert("Missing beat id. Please refresh the page.");
      return;
    }

    buyBtn.disabled = true;
    buyBtn.textContent = "Redirecting…";

    try {
      await createPaypalOrder({
        beatId,
        licenseKey: selectedLicense.key
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      resetBuyBtn();
    }
  });

  // ✅ ADD TO CART (fixes marketplace invalid cart item)
  cartBtn?.addEventListener("click", () => {
    if (!currentBeat || !selectedLicense) return;

    const beatId = resolveBeatId(currentBeat);
    const licenseKey = String(selectedLicense.key || "").trim();

    if (!beatId || !licenseKey) {
      alert("Invalid cart item (missing beatId/license key)");
      return;
    }

    if (!window.PB_CART || typeof window.PB_CART.add !== "function") {
      alert("Cart not loaded. Make sure /js/cart.js is included before /js/license-modal.js");
      return;
    }

    // SAFE payload: always include all expected fields
    window.PB_CART.add({
      beatId,
      title: safeTitle(currentBeat),
      artwork: String(currentBeat.artwork || ""),
      price: Number(selectedLicense.price || 0),
      licenseKey,
      licenseName: String(selectedLicense.name || licenseKey)
    });

    alert("Added to cart ✅");
  });

  closeBtn?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ✅ CLICK HANDLER:
  // - ONLY open license modal when clicking price-pill OR .open-license OR card (but NOT play buttons)
  // - If the click came from a play button, do nothing here (player.js handles it)
  document.addEventListener("click", (e) => {
    // If click is on play button or inside it -> NEVER open modal
    const playBtn = e.target.closest("[data-play-btn]");
    if (playBtn) return;

    // extra safety: if an element explicitly says ignore license
    const ignore = e.target.closest("[data-ignore-license='1']");
    if (ignore) return;

    const pill = e.target.closest(".price-pill, .price-btn, .open-license");
    const card = e.target.closest(".beat-card, .trend-card");

    // Only open when:
    // 1) price pill clicked OR open-license clicked
    // 2) OR clicked on card but NOT on links/buttons inside meta
    if (!pill && !card) return;

    // if clicked on a link or a button inside the card (except price-pill), don't open
    const clickable = e.target.closest("a, button");
    if (clickable && !pill) return;

    const wrap = pill ? pill.closest(".beat-card, .trend-card") : card;
    if (!wrap) return;

    const beatId = String(wrap.getAttribute("data-beat-id") || "").trim();

    // Find beat from cached list
    const list = window.__LATEST_BEATS__ || [];
    let beat = null;

    if (beatId && Array.isArray(list)) {
      beat = list.find((b) => String(b.id) === String(beatId)) || null;
    }

    // fallback (still requires beatId)
    if (!beat) {
      const title =
        (wrap.querySelector("h3")?.textContent ||
         wrap.querySelector(".t")?.textContent ||
         "Beat").trim();

      beat = {
        id: beatId,
        title,
        artwork: "",
        audio: "",
        genre: "",
        price: 29.99
      };
    }

    if (!resolveBeatId(beat)) return;
    openModal(beat);
  });

  window.PB_OPEN_LICENSE_MODAL = openModal;
  window.PB_CLOSE_LICENSE_MODAL = closeModal;
})();
