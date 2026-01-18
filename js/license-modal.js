// /js/license-modal.js
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

  if (!modal || !backdrop) return;

  let currentBeat = null;
  let selectedLicense = null;

  const money = (n) => {
    const v = Number(n || 0);
    return "$" + (isFinite(v) ? v.toFixed(2) : "0.00");
  };

    async function createPaypalOrder({ beatId, licenseKey }) {
    if (!window.API_BASE) throw new Error("Missing API_BASE");

    const r = await fetch(`${window.API_BASE}/api/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beatId, licenseKey })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Create order failed");

    // Save orderId for capture step later
    localStorage.setItem("pb_last_order_id", data.orderId);

    // Find PayPal approve link
    const approve = (data.approveLinks || []).find((l) => l.rel === "approve");
    if (!approve?.href) throw new Error("No PayPal approve link returned");

    // Redirect buyer to PayPal
    window.location.href = approve.href;
  }

  // Default licenses if beat doesn't have licenses object
  function buildDefaultLicenses(beat) {
    const base = Number(beat?.price || 29.99) || 29.99;
    return [
      { key: "basic", name: "Basic", price: base, meta: "MP3", badge: "Popular",
        terms: ["MP3 download", "Non-exclusive license", "Use in 1 project"] },
      { key: "premium", name: "Premium", price: Math.max(base * 2, 59.99), meta: "WAV + MP3",
        terms: ["WAV + MP3", "More usage", "Better quality"] },
      { key: "unlimited", name: "Unlimited", price: Math.max(base * 3, 99.99), meta: "WAV + MP3",
        terms: ["Unlimited streams", "Monetization", "Wide distribution"] },
      { key: "exclusive", name: "Exclusive", price: Math.max(base * 6, 199.99), meta: "STEMS + WAV",
        terms: ["Exclusive rights", "Stems included", "Remove from store"] }
    ];
  }

  // Supports beat.licenses.* if you add later
  function buildLicensesFromBeat(beat) {
    const lic = beat?.licenses;
    if (!lic || typeof lic !== "object") return buildDefaultLicenses(beat);

    const out = [];
    const keys = Object.keys(lic);
    keys.forEach((k) => {
      const item = lic[k] || {};
      const price = Number(item.price ?? item.amount ?? 0) || 0;
      out.push({
        key: k,
        name: item.name || k.toUpperCase(),
        price: price || Number(beat?.price || 0) || 29.99,
        meta: item.format || item.files || "MP3",
        badge: item.badge || "",
        terms: Array.isArray(item.terms) ? item.terms : []
      });
    });

    // Ensure at least 2 options
    if (out.length < 2) return buildDefaultLicenses(beat);

    return out;
  }

  function openModal(beat) {
    currentBeat = beat;
    const beatTitle = beat?.title || "Beat";
    titleEl.textContent = beatTitle;
    subEl.textContent = "Select a license to continue.";

    const licenses = buildLicensesFromBeat(beat);
    selectedLicense = licenses[0]; // default selected

    grid.innerHTML = "";
    termsGrid.innerHTML = "";

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
        [...grid.querySelectorAll(".pb-license")].forEach(x => x.classList.remove("selected"));
        card.classList.add("selected");
        selectedLicense = l;
        totalEl.textContent = money(l.price);
        renderTerms(l);
      });

      grid.appendChild(card);
    });

    totalEl.textContent = money(selectedLicense.price);
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
  }

  function renderTerms(license) {
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

  // Buttons (for now we just show alerts / redirect placeholder)
    buyBtn.addEventListener("click", async () => {
    if (!currentBeat || !selectedLicense) return;

    // IMPORTANT: beatId must exist (Firestore doc id)
    if (!currentBeat.id) {
      alert("Missing beat id. Please refresh the page.");
      return;
    }

    buyBtn.disabled = true;
    buyBtn.textContent = "Redirecting…";

    try {
      await createPaypalOrder({
        beatId: currentBeat.id,
        licenseKey: selectedLicense.key
      });
      // no closeModal here because we're leaving the page
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      buyBtn.disabled = false;
      buyBtn.textContent = "Buy now";
    }
  });

  cartBtn.addEventListener("click", () => {
    if (!currentBeat || !selectedLicense) return;
    alert(`Added to cart:\n${currentBeat.title}\n${selectedLicense.name}`);
  });

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // 🔥 Hook into your existing cards:
  // - clicks on .price-pill
  // - uses window.__LATEST_BEATS__ from firebase.js OR finds beat title nearby
  document.addEventListener("click", (e) => {
    const price = e.target.closest(".price-pill, .price-btn");
    if (!price) return;

    // Find nearest beat card
    const card = price.closest(".beat-card, .trend-card");
    if (!card) return;

    // Best: get beat title from the DOM
    const h3 = card.querySelector("h3");
    const t  = card.querySelector(".t");
    const domTitle = (h3?.textContent || t?.textContent || "").trim();

    // Try to match with latest beats if available
    let beat = null;
    const list = window.__LATEST_BEATS__ || [];
    if (domTitle && Array.isArray(list)) {
      beat = list.find(b => String(b.title || "").trim() === domTitle) || null;
    }

    // Fallback minimal beat object
    if (!beat) {
      beat = {
        id: "",
        title: domTitle || "Beat",
        price: Number(price.textContent.replace(/[^0-9.]/g, "")) || 29.99
      };
    }

    openModal(beat);
  });

  // Expose if you ever want to open manually
  window.PB_OPEN_LICENSE_MODAL = openModal;
})();
