// /js/license-modal.js  (FULL UPDATED + WORKING)
//
// ✅ Uses window.API_BASE
// ✅ Reads beatId from DOM: data-beat-id (so Buy Now works)
// ✅ Redirects to PayPal approve link after /api/create-order
// ✅ Includes openModal + closeModal (resets button on close)
// ✅ Prevents "stuck redirecting" by resetting UI on modal open/close
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

  async function createPaypalOrder({ beatId, licenseKey }) {
  if (!window.API_BASE) throw new Error("Missing API_BASE");

  // ✅ Require login before checkout
  let token = "";
  try {
    const u = window.FB_AUTH_USER || null;
    if (u && typeof u.getIdToken === "function") {
      token = await u.getIdToken(true);
    }
  } catch {}

  // If you didn’t expose auth, we fallback to importing Firebase Auth quickly
  if (!token) {
    // If not logged in → send to login
    alert("Please sign in to buy this beat.");
    window.location.href = "/login.html";
    throw new Error("Not signed in");
  }

  const r = await fetch(`${window.API_BASE}/api/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ beatId, licenseKey })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Create order failed");

  // Save for capture step later
  if (data.orderId) localStorage.setItem("pb_last_order_id", data.orderId);

  const approve = (data.approveLinks || []).find((l) => l.rel === "approve");
  if (!approve?.href) throw new Error("No PayPal approve link returned");

  window.location.href = approve.href;
}

  // Default licenses if beat doesn't have licenses object
  function buildDefaultLicenses(beat) {
    const base = Number(beat?.price || 29.99) || 29.99;
    return [
      {
        key: "basic",
        name: "Basic",
        price: base,
        meta: "MP3",
        badge: "Popular",
        terms: ["MP3 download", "Non-exclusive license", "Use in 1 project"]
      },
      {
        key: "premium",
        name: "Premium",
        price: Math.max(base * 2, 59.99),
        meta: "WAV + MP3",
        terms: ["WAV + MP3", "More usage", "Better quality"]
      },
      {
        key: "unlimited",
        name: "Unlimited",
        price: Math.max(base * 3, 99.99),
        meta: "WAV + MP3",
        terms: ["Unlimited streams", "Monetization", "Wide distribution"]
      },
      {
        key: "exclusive",
        name: "Exclusive",
        price: Math.max(base * 6, 199.99),
        meta: "STEMS + WAV",
        terms: ["Exclusive rights", "Stems included", "Remove from store"]
      }
    ];
  }

  // Supports beat.licenses.* (Option B)
  function buildLicensesFromBeat(beat) {
    const lic = beat?.licenses;
    if (!lic || typeof lic !== "object") return buildDefaultLicenses(beat);

    const out = [];
    Object.keys(lic).forEach((k) => {
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

    if (out.length < 2) return buildDefaultLicenses(beat);
    return out;
  }

  function renderTerms(license) {
    if (!termsGrid) return;

    termsGrid.innerHTML = "";
    const terms =
      license?.terms && license.terms.length
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
    selectedLicense = null;

    // Always reset button UI when opening (fix stuck "Redirecting…")
    resetBuyBtn();

    const beatTitle = beat?.title || "Beat";
    titleEl.textContent = beatTitle;
    subEl.textContent = "Select a license to continue.";

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
        [...grid.querySelectorAll(".pb-license")].forEach((x) =>
          x.classList.remove("selected")
        );
        card.classList.add("selected");
        selectedLicense = l;
        if (totalEl) totalEl.textContent = money(l.price);
        renderTerms(l);
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

  // BUY NOW -> Create PayPal order -> redirect
  buyBtn.addEventListener("click", async () => {
    if (!currentBeat || !selectedLicense) return;

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
      // Redirect happens, so no closeModal()
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      resetBuyBtn();
    }
  });

  // Cart placeholder
  cartBtn?.addEventListener("click", () => {
    if (!currentBeat || !selectedLicense) return;
    alert(`Added to cart:\n${currentBeat.title}\n${selectedLicense.name}`);
  });

  closeBtn?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // CLICK HOOK:
  // - When user clicks a price pill, open modal using beatId from DOM (data-beat-id)
  document.addEventListener("click", (e) => {
    const price = e.target.closest(".price-pill, .price-btn");
    if (!price) return;

    const card = price.closest(".beat-card, .trend-card");
    if (!card) return;

    // ✅ Firestore id from DOM
    const beatId = card.getAttribute("data-beat-id") || "";

    // Title from DOM
    const h3 = card.querySelector("h3");
    const t = card.querySelector(".t");
    const domTitle = (h3?.textContent || t?.textContent || "").trim();

    // Try exact match by id first
    let beat = null;
    const list = window.__LATEST_BEATS__ || [];
    if (beatId && Array.isArray(list)) {
      beat = list.find((b) => b.id === beatId) || null;
    } else if (domTitle && Array.isArray(list)) {
      beat = list.find((b) => String(b.title || "").trim() === domTitle) || null;
    }

    // Fallback (still includes beatId if present)
    if (!beat) {
      beat = {
        id: beatId,
        title: domTitle || "Beat",
        price: Number(String(price.textContent).replace(/[^0-9.]/g, "")) || 29.99
      };
    }

    openModal(beat);
  });

  // Expose manual open
  window.PB_OPEN_LICENSE_MODAL = openModal;
  window.PB_CLOSE_LICENSE_MODAL = closeModal;
})();
