// /js/license-modal.js (AUDIORY: REAL LICENSES + FREE DOWNLOAD FLOW + NO PLAY->MODAL + CART SAFE)
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

  function isFreeBeat(beat) {
    if (!beat) return false;
    if (beat.freeDownload === true) return true;
    // also treat price 0 as free (just in case)
    return Number(beat.price || 0) === 0;
  }

  // ✅ FAST token getter (from /js/firebase.js)
  async function getBuyerIdTokenFast() {
    try {
      if (window.FB?.getIdToken) return await window.FB.getIdToken();
    } catch {}
    return null;
  }

  // ✅ Resolve create order URL (Firebase function preferred)
  function getPayPalCreateOrderUrl() {
    // ✅ best: you set this in index.html
    if (window.PB_PAYPAL_CREATE_ORDER_URL) {
      return String(window.PB_PAYPAL_CREATE_ORDER_URL).trim();
    }

    // fallback: old style API_BASE (Render / API server)
    if (window.API_BASE) {
      const base = String(window.API_BASE).replace(/\/+$/, "");
      return `${base}/api/create-order`;
    }

    // nothing set
    return "";
  }

  // ✅ PayPal order create (calls Firebase Function createOrder)
  async function createPaypalOrder({ beatId, licenseKey }) {
    const url = getPayPalCreateOrderUrl();
    if (!url) {
      throw new Error(
        "Failed to fetch\n\nFix: set window.PB_PAYPAL_CREATE_ORDER_URL to your Firebase createOrder function URL."
      );
    }

    const token = await getBuyerIdTokenFast();

    const r = await fetch(url, {
      method: "POST",
      mode: "cors",
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

    // extra fallback if your function returns approveUrl
    const approveUrl = approve?.href || data.approveUrl || null;

    if (!approveUrl) throw new Error("No PayPal approve link returned");
    window.location.href = approveUrl;
  }

  /* =========================
     ✅ BUILD LICENSES FROM BEAT
     Uses Firestore payload:
     beat.licenses.basic.enabled/price etc
  ========================= */
  function buildLicensesFromBeat(beat) {
    const b = beat || {};
    const lic = b.licenses || {};
    const stemsReady = !!b.stemsZipUrl;

    const list = [];

    if (lic.basic?.enabled) {
      list.push({
        key: "basic",
        name: "Basic",
        price: Number(lic.basic.price || 0) || 0,
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
      });
    }

    if (lic.premium?.enabled) {
      list.push({
        key: "premium",
        name: "Premium",
        price: Number(lic.premium.price || 0) || 0,
        meta: "WAV + MP3",
        terms: [
          "WAV + MP3 download",
          "Non-exclusive license",
          "Use for 1 song/project",
          "Up to 100,000 streams",
          "Monetization allowed",
          "Credit producer required"
        ]
      });
    }

    if (lic.exclusive?.enabled) {
      list.push({
        key: "exclusive",
        name: "Exclusive",
        price: Number(lic.exclusive.price || 0) || 0,
        meta: stemsReady ? "STEMS + WAV" : "WAV",
        terms: [
          stemsReady ? "STEMS included" : "STEMS not included (producer didn’t upload stems)",
          "Exclusive rights (producer stops selling this beat)",
          "Unlimited streams",
          "Monetization allowed",
          "Wide distribution",
          "Credit producer required"
        ]
      });
    }

    // fallback: if nothing is enabled, show defaults (so UI never breaks)
    if (!list.length) {
      list.push(
        { key: "basic", name: "Basic", price: 29.99, meta: "MP3", badge: "Popular", terms: ["MP3 download", "Non-exclusive license"] },
        { key: "premium", name: "Premium", price: 79.99, meta: "WAV + MP3", terms: ["WAV + MP3 download", "Non-exclusive license"] },
        { key: "exclusive", name: "Exclusive", price: 299.99, meta: "WAV", terms: ["Exclusive rights", "Unlimited use"] }
      );
    }

    // ensure price numbers
    list.forEach((l) => (l.price = Number(l.price || 0) || 0));
    return list;
  }

  function renderTerms(license) {
    if (!termsGrid) return;
    termsGrid.innerHTML = "";

    const terms =
      license?.terms && license.terms.length
        ? license.terms
        : ["Instant download", "License proof included", "Producer credited"];

    terms.slice(0, 10).forEach((t) => {
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

    // ✅ If FREE beat, we don't show paid licenses
    if (isFreeBeat(beat)) {
      subEl.textContent = "This beat is FREE. Enter your details to download.";
      grid.innerHTML = "";
      if (termsGrid) termsGrid.innerHTML = "";
      if (totalEl) totalEl.textContent = money(0);

      // Hide cart/buy for free (optional)
      buyBtn.textContent = "Download";
      cartBtn && (cartBtn.style.display = "none");

      backdrop.classList.add("open");
      modal.classList.add("open");
      document.body.classList.add("no-scroll");
      return;
    } else {
      subEl.textContent = "Select a license to continue.";
      cartBtn && (cartBtn.style.display = "");
      buyBtn.textContent = "Buy now";
    }

    const licenses = buildLicensesFromBeat(beat);
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
    if (cartBtn) cartBtn.style.display = "";
    buyBtn.textContent = "Buy now";
  }

  // ✅ BUY NOW (paid) / DOWNLOAD (free)
  buyBtn.addEventListener("click", async () => {
    if (!currentBeat) return;

    const beatId = resolveBeatId(currentBeat);
    if (!beatId) {
      alert("Missing beat id. Please refresh the page.");
      return;
    }

    // ✅ FREE: open your BeatStars-style free download popup
    if (isFreeBeat(currentBeat)) {
      // close modal then open popup
      closeModal();

      if (typeof window.PB_OPEN_FREE_DOWNLOAD === "function") {
        window.PB_OPEN_FREE_DOWNLOAD({
          beatId,
          beatTitle: safeTitle(currentBeat),
          producerId: String(currentBeat.producerId || ""),
          producerName: String(currentBeat.producerName || ""),
          downloadUrl: String(currentBeat.fullAudio || currentBeat.audio || "")
        });
      } else {
        alert("Free download popup not found. Add the FREE download popup script to this page.");
      }
      return;
    }

    if (!selectedLicense) return;

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

  // ✅ ADD TO CART
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

    window.PB_CART.add({
      beatId,
      title: safeTitle(currentBeat),
      artwork: String(currentBeat.artwork || ""),
      price: Number(selectedLicense.price || 0),
      licenseKey,
      licenseName: String(selectedLicense.name || licenseKey),
      producerId: String(currentBeat.producerId || ""),
      producerName: String(currentBeat.producerName || "")
    });

    alert("Added to cart ✅");
  });

  closeBtn?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ✅ CLICK HANDLER:
  // - NEVER open modal when clicking play button
  // - Open modal when clicking price pill OR card (but not links/buttons)
  document.addEventListener("click", (e) => {
    // play button -> never open modal
    const playBtn = e.target.closest("[data-play-btn]");
    if (playBtn) return;

    // explicit ignore
    const ignore = e.target.closest("[data-ignore-license='1']");
    if (ignore) return;

    const pill = e.target.closest(".price-pill, .price-btn, .open-license");
    const card = e.target.closest(".beat-card, .trend-card");

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

    // fallback
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
        fullAudio: "",
        previewAudio: "",
        genre: "",
        price: 29.99,
        freeDownload: false,
        licenses: {
          basic: { enabled: true, price: 29.99 },
          premium: { enabled: true, price: 79.99 },
          exclusive: { enabled: true, price: 299.99 }
        }
      };
    }

    if (!resolveBeatId(beat)) return;

    // ✅ If FREE beat and the click was on pill, open FREE popup directly (BeatStars feel)
    if (pill && isFreeBeat(beat) && typeof window.PB_OPEN_FREE_DOWNLOAD === "function") {
      window.PB_OPEN_FREE_DOWNLOAD({
        beatId: resolveBeatId(beat),
        beatTitle: safeTitle(beat),
        producerId: String(beat.producerId || ""),
        producerName: String(beat.producerName || ""),
        downloadUrl: String(beat.fullAudio || beat.audio || "")
      });
      return;
    }

    openModal(beat);
  });

  window.PB_OPEN_LICENSE_MODAL = openModal;
  window.PB_CLOSE_LICENSE_MODAL = closeModal;
})();
