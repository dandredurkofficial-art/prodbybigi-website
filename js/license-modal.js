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

    const lic = beat.licenses || {};

    const hasPaidLicense =
      Number(lic?.basic?.price || 0) > 0 ||
      Number(lic?.premium?.price || 0) > 0 ||
      Number(lic?.exclusive?.price || 0) > 0;

    if (hasPaidLicense) return false;

    return (
      beat.freeDownload === true ||
      beat.isFree === true ||
      Number(beat.price || 0) === 0
    );
  }

    async function getCampaignForBeat(beatId) {
      
    window.__CAMPAIGN_CACHE__ =
      window.__CAMPAIGN_CACHE__ || {};

    if (window.__CAMPAIGN_CACHE__[beatId]) {
      return window.__CAMPAIGN_CACHE__[beatId];
    }
      
    try {
      if (!window.collection || !window.query || !window.where || !window.getDocs || !window.db) {
        return null;
      }

      const q = window.query(
        window.collection(window.db, "marketingCampaigns"),
        window.where("beatId", "==", String(beatId || "").trim()),
        window.where("status", "==", "active")
      );

      const snap = await window.getDocs(q);
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));

      if (!arr.length) {
        window.__CAMPAIGN_CACHE__[beatId] = null;
        return null;
      }
      arr.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      // priority: buy_x_get_y first, then discount
      const buyGet = arr.find(x => String(x.type || "").trim() === "buy_x_get_y");
      if (buyGet) {
        window.__CAMPAIGN_CACHE__[beatId] = buyGet;
        return buyGet;
      }

      const discount = arr.find(x => String(x.type || "").trim() === "discount");
      if (discount) {
        window.__CAMPAIGN_CACHE__[beatId] = discount;
        return discount;
      }

      window.__CAMPAIGN_CACHE__[beatId] = arr[0] || null;
      return arr[0] || null;
    } catch (e) {
      console.warn("Campaign lookup failed:", e);
      return null;
    }
  }

  async function getBeatByIdForCart(beatId) {
    const id = String(beatId || "").trim();
    if (!id) return null;

    try {
      const list = Array.isArray(window.__LATEST_BEATS__) ? window.__LATEST_BEATS__ : [];
      const found = list.find(b => String(b.id || "") === id);
      if (found) return found;
    } catch {}

    try {
      if (!window.doc || !window.getDoc || !window.db) return null;
      const snap = await window.getDoc(window.doc(window.db, "beats", id));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      console.warn("Bonus beat lookup failed:", e);
      return null;
    }
  }

  function discountedPrice(price, pct) {
    const p = Number(price || 0);
    const d = Number(pct || 0);
    if (!d || d <= 0) return p;
    return Math.max(0, Number((p * (1 - d / 100)).toFixed(2)));
  }

  // ✅ FAST token getter (from /js/firebase.js)
  async function getBuyerIdTokenFast() {
    try {
      if (window.FB?.getIdToken) return await window.FB.getIdToken();
    } catch {}
    return null;
  }

  // ✅ Resolve PayPal create-order endpoint (Firebase function preferred)
  function resolveCreateOrderUrl() {
    // 1) If you set it in index.html, use it
    const direct = String(window.PB_PAYPAL_CREATE_ORDER_URL || "").trim();
    if (direct) return direct;

    // 2) Otherwise fallback to API_BASE styles (Render etc)
    const base = String(window.API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) return ""; // handled by caller

    // support both patterns if you ever change backend routes
    return `${base}/api/create-order`;
  }

  // ✅ PayPal order create (fixed to use PB_PAYPAL_CREATE_ORDER_URL)
  async function createPaypalOrder({ beatId, licenseKey }) {
    const url = resolveCreateOrderUrl();
    if (!url) throw new Error("Missing create order URL. Set window.PB_PAYPAL_CREATE_ORDER_URL.");

    const token = await getBuyerIdTokenFast();

    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ beatId, licenseKey }),
      });
    } catch (e) {
      // network/CORS/blocked
      throw new Error("Failed to fetch (network/CORS). Check function URL + CORS.");
    }

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || data.message || "Create order failed");

    if (data.orderId) {
      localStorage.setItem("pb_last_order_id", data.orderId);
      sessionStorage.setItem("pb_last_order_id", data.orderId);
    }

    if (data.cartId) {
      localStorage.setItem("pb_last_cart_id", data.cartId);
      sessionStorage.setItem("pb_last_cart_id", data.cartId);
    }

    const links = data.approveLinks || data.links || [];
    const approve =
      (links || []).find((l) => l.rel === "approve") ||
      (links || []).find((l) => l.rel === "payer-action");

    const approveUrl = data.approveUrl || approve?.href;
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
          "No Content ID",
        ],
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
          "Credit producer required",
        ],
      });
    }

    if (lic.exclusive?.enabled) {
      list.push({
        key: "exclusive",
        name: "Exclusive",
        price: Number(lic.exclusive.price || 0) || 0,
        meta: stemsReady ? "STEMS + WAV" : "WAV",
        terms: [
          stemsReady
            ? "STEMS included"
            : "STEMS not included (producer didn’t upload stems)",
          "Exclusive rights (producer stops selling this beat)",
          "Unlimited streams",
          "Monetization allowed",
          "Wide distribution",
          "Credit producer required",
        ],
      });
    }

    // fallback: if nothing is enabled, show defaults (so UI never breaks)
    if (!list.length) {
      list.push(
        {
          key: "basic",
          name: "Basic",
          price: 29.99,
          meta: "MP3",
          badge: "Popular",
          terms: ["MP3 download", "Non-exclusive license"],
        },
        {
          key: "premium",
          name: "Premium",
          price: 79.99,
          meta: "WAV + MP3",
          terms: ["WAV + MP3 download", "Non-exclusive license"],
        },
        {
          key: "exclusive",
          name: "Exclusive",
          price: 299.99,
          meta: "WAV",
          terms: ["Exclusive rights", "Unlimited use"],
        }
      );
    }

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

  async function openModal(beat) {
    currentBeat = beat;
    resetBuyBtn();

    titleEl.textContent = safeTitle(beat);

    // ✅ If FREE beat, we don't show paid licenses
    if (isFreeBeat(beat)) {
      subEl.textContent = "This beat is FREE. Enter your details to download.";
      grid.innerHTML = "";
      if (termsGrid) termsGrid.innerHTML = "";
      if (totalEl) totalEl.textContent = money(0);

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

    backdrop.classList.add("open");
    modal.classList.add("open");
    document.body.classList.add("no-scroll");

    const licenses = buildLicensesFromBeat(beat);
    const campaign = await getCampaignForBeat(resolveBeatId(beat));

    if (
      campaign &&
      String(campaign.type || "").trim() === "discount"
    ) {
      const pct = Number(campaign.discountPct || 0);

      licenses.forEach((l) => {
        l.originalPrice = l.price;
        l.price = discountedPrice(l.price, pct);
        l.discountPct = pct;
      });
    }
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
        <div class="price">
          ${
            l.originalPrice
              ? `
                <span style="
                  text-decoration:line-through;
                  opacity:.6;
                  font-size:13px;
                  display:block;
                ">
                  ${money(l.originalPrice)}
                </span>
                ${money(l.price)}
              `
              : money(l.price)
          }
        </div>
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
      closeModal();

      if (typeof window.PB_OPEN_FREE_DOWNLOAD === "function") {
        window.PB_OPEN_FREE_DOWNLOAD({
          beatId,
          beatTitle: safeTitle(currentBeat),
          producerId: String(currentBeat.producerId || ""),
          producerName: String(currentBeat.producerName || ""),
          downloadUrl: String(currentBeat.fullAudio || currentBeat.audio || ""),
        });
      } else {
        alert(
          "Free download popup not found. Add the FREE download popup script to this page."
        );
      }
      return;
    }

    if (!selectedLicense) return;

    buyBtn.disabled = true;
    buyBtn.textContent = "Redirecting…";

    try {
      await createPaypalOrder({
        beatId,
        licenseKey: selectedLicense.key,
      });
    } catch (err) {
      console.error(err);
      alert(err.message || "Checkout failed");
      resetBuyBtn();
    }
  });

    // ✅ ADD TO CART
  cartBtn?.addEventListener("click", async () => {
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

    try {
      const campaign = await getCampaignForBeat(beatId);

      let finalPrice = Number(selectedLicense.price || 0);
      let discountPct = 0;
      let campaignType = "";
      let campaignId = "";

      if (campaign && String(campaign.type || "").trim() === "discount") {
        discountPct = Number(campaign.discountPct || 0);
        finalPrice = discountedPrice(finalPrice, discountPct);
        campaignType = "discount";
        campaignId = String(campaign.id || "");
      }

      window.PB_CART.add({
        beatId,
        title: safeTitle(currentBeat),
        artwork: String(currentBeat.artwork || ""),
        price: finalPrice,
        originalPrice: Number(selectedLicense.price || 0),
        discountPct,
        campaignType,
        campaignId,
        licenseKey,
        licenseName: String(selectedLicense.name || licenseKey),
        producerId: String(currentBeat.producerId || ""),
        producerName: String(currentBeat.producerName || ""),
      });

      // ✅ auto-add bonus beats
      if (campaign && String(campaign.type || "").trim() === "buy_x_get_y") {
        const bonusIds = Array.isArray(campaign.bonusBeatIds) ? campaign.bonusBeatIds : [];

        for (const bonusBeatId of bonusIds) {
          if (!bonusBeatId || String(bonusBeatId) === beatId) continue;

          const bonusBeat = await getBeatByIdForCart(bonusBeatId);
          if (!bonusBeat) continue;

          window.PB_CART.add({
            beatId: String(bonusBeat.id || bonusBeatId),
            title: String(bonusBeat.title || "Bonus Beat"),
            artwork: String(bonusBeat.artwork || ""),
            price: 0,
            originalPrice: 0,
            licenseKey,
            licenseName: `Bonus • ${String(selectedLicense.name || licenseKey)}`,
            producerId: String(bonusBeat.producerId || currentBeat.producerId || ""),
            producerName: String(bonusBeat.producerName || currentBeat.producerName || ""),
            campaignType: "buy_x_get_y",
            campaignId: String(campaign.id || ""),
            isBonus: true,
            parentBeatId: beatId,
            parentLicenseKey: licenseKey,
            bonusLabel: "Included bonus beat",
          });
        }
      }

      alert("Added to cart ✅");
    } catch (err) {
      console.error(err);
      alert("Could not apply campaign: " + (err?.message || err));
    }
  });

  closeBtn?.addEventListener("click", closeModal);
  backdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ✅ CLICK HANDLER:
  // - NEVER open modal when clicking play button
  // - Open modal when clicking price pill OR card (but not links/buttons)
  // ✅ FIX: support beat page pills (not inside .beat-card/.trend-card)
  document.addEventListener("click", (e) => {
    const playBtn = e.target.closest("[data-play-btn]");
    if (playBtn) return;

    const ignore = e.target.closest("[data-ignore-license='1']");
    if (ignore) return;

    const pill = e.target.closest(".price-pill, .price-btn, .open-license");
    const card = e.target.closest(".beat-card, .trend-card");

    if (!pill && !card) return;

    const clickable = e.target.closest("a, button");
    if (clickable && !pill) return;

    // ✅ FIX: on beat page, pill itself contains data-beat-id/data-producer-id
    // fallback: any ancestor with data-beat-id
    const wrap =
      (pill && pill.closest(".beat-card, .trend-card")) ||
      card ||
      (pill && pill.closest("[data-beat-id]")) ||
      null;

    const beatId =
      String(pill?.getAttribute("data-beat-id") || "").trim() ||
      String(wrap?.getAttribute("data-beat-id") || "").trim();

    const list = window.__LATEST_BEATS__ || [];
    let beat = null;

    if (beatId && Array.isArray(list)) {
      beat = list.find((b) => String(b.id) === String(beatId)) || null;
    }

    // ✅ Extra safe: if beat page stored current beat, use it
    // (Your beat page can set window.__CURRENT_BEAT__ = beat)
    if (!beat && window.__CURRENT_BEAT__ && resolveBeatId(window.__CURRENT_BEAT__) === beatId) {
      beat = window.__CURRENT_BEAT__;
    }

    // If still not found, build minimal beat object
    if (!beat) {
      const title = (
        wrap?.querySelector("h3")?.textContent ||
        wrap?.querySelector(".t")?.textContent ||
        (pill?.getAttribute("data-title") || "") ||
        "Beat"
      ).trim();

      // ✅ FIX: preserve producerId if pill has it (beat page pills do)
      const producerId =
        String(pill?.getAttribute("data-producer-id") || "").trim() ||
        String(wrap?.getAttribute("data-producer-id") || "").trim();

      beat = {
        id: beatId,
        title,
        producerId,
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
          exclusive: { enabled: true, price: 299.99 },
        },
      };
    }

    if (!resolveBeatId(beat)) return;

    openModal(beat);
  });

  window.PB_OPEN_LICENSE_MODAL = openModal;
  window.PB_CLOSE_LICENSE_MODAL = closeModal;
})();
