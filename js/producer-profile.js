// /js/producer-profile.js
(function () {
  const params = new URLSearchParams(window.location.search);
  const username = (params.get("username") || "").trim();
  const producerId = (params.get("producerId") || "").trim();

  // OLD PAGE ELEMENTS (if your old page uses these ids)
  const producerNameEl = document.getElementById("producerName");
  const beatsContainer = document.getElementById("producerBeats");

  // NEW PAGE ELEMENTS (your current producer-profile.html uses these ids)
  const prodName = document.getElementById("prodName");
  const prodSub = document.getElementById("prodSub");
  const prodAvatar = document.getElementById("prodAvatar");

  function setAvatar(name, photoUrl) {
    if (!prodAvatar) return;

    const withBust = (u) => {
      if (!u) return "";
      const sep = u.includes("?") ? "&" : "?";
      return u + sep + "v=" + Date.now();
    };

    if (photoUrl && String(photoUrl).trim()) {
      prodAvatar.innerHTML = `<img src="${withBust(String(photoUrl).trim())}" alt="${String(name || "Producer")}" loading="lazy" />`;
      return;
    }

    const initials = String(name || "PB").trim().slice(0, 2).toUpperCase();
    prodAvatar.innerHTML = `<div style="font-weight:950;font-size:22px;color:rgba(255,255,255,.9)">${initials}</div>`;
  }

  function getPhotoFromBeats(list) {
    if (!Array.isArray(list)) return "";
    const b = list.find(x => x && (x.producerPhotoURL || x.producerAvatar || x.producerPhoto || x.photoURL));
    return b ? (b.producerPhotoURL || b.producerAvatar || b.producerPhoto || b.photoURL || "") : "";
  }

  async function run() {
    // Prefer new system if available
    if (producerId && window.FB && typeof window.FB.fetchBeats === "function") {
      const beats = await window.FB.fetchBeats({ max: 200 });
      const mine = beats.filter(b => String(b.producerId || "") === String(producerId));

      const displayName =
        mine[0]?.producerName?.trim() ||
        (mine[0]?.producerId ? ("Prod. " + String(mine[0].producerId).slice(0, 8)) : "Producer");

      if (prodName) prodName.textContent = displayName;
      if (prodSub) prodSub.textContent = `Producer ID: ${producerId}`;

      // Try producer profile doc first (if you add this in firebase.js)
      let producerPhoto = "";
      try {
        if (typeof window.FB.getProducerProfile === "function") {
          const prof = await window.FB.getProducerProfile(producerId);
          producerPhoto = prof?.photoURL || prof?.avatarURL || prof?.profilePhoto || "";
        } else if (typeof window.FB.fetchProducerProfile === "function") {
          const prof = await window.FB.fetchProducerProfile(producerId);
          producerPhoto = prof?.photoURL || prof?.avatarURL || prof?.profilePhoto || "";
        }
      } catch (e) {}

      if (!producerPhoto) producerPhoto = getPhotoFromBeats(mine);
      setAvatar(displayName, producerPhoto);

      return; // page rendering for beats is handled in your HTML script on the new page
    }

    // OLD system (beats global + username)
    if (typeof beats === "undefined" || !username) {
      if (producerNameEl) producerNameEl.textContent = "Producer";
      return;
    }

    const producerBeats = beats.filter(beat => beat.producer === username);

    if (producerBeats.length > 0) {
      if (producerNameEl) producerNameEl.textContent = producerBeats[0].producerName || "Producer";
    } else {
      if (producerNameEl) producerNameEl.textContent = "Producer";
    }

    if (!beatsContainer) return;

    producerBeats.forEach(beat => {
      const card = document.createElement("div");
      card.className = "beat-card";
      card.innerHTML = `
        <div>
          <h3>${beat.title}</h3>
          <p>${beat.genre}</p>
        </div>
        <button>$${beat.price}</button>
      `;
      beatsContainer.appendChild(card);
    });
  }

  // Wait for firebase-ready if needed
  if (window.FB) {
    run().catch(console.error);
  } else {
    window.addEventListener("firebase-ready", () => run().catch(console.error));
  }
})();
