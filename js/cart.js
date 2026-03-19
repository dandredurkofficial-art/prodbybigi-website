// /js/cart.js (localStorage cart)
// Exposes window.PB_CART with add/remove/list/load/clear/count/total/setQty

(function () {
  const KEY = "pb_cart_v1";

  function toKey(x) {
    return String(x || "basic").trim().toLowerCase();
  }

  function normalize(item) {
    const beatId = String(item.beatId || item.id || "").trim();
    const licenseKey = toKey(item.licenseKey || item.license || "basic");

    return {
      id: item.id || `${beatId}:${licenseKey}`,
      beatId,
      title: String(item.title || "Item"),
      artwork: String(item.artwork || ""),
      licenseKey,
      licenseName: String(item.licenseName || item.licenseKey || "basic"),
      price: Number(item.price || 0),
      qty: Math.max(1, Number(item.qty || 1)),
      downloadUrl: item.downloadUrl ? String(item.downloadUrl) : "",

      // ✅ campaign fields
      campaignType: String(item.campaignType || ""),
      campaignId: String(item.campaignId || ""),
      discountPct: Number(item.discountPct || 0),
      originalPrice: Number(item.originalPrice || 0),

      // ✅ buy-x-get-y fields
      isBonus: item.isBonus === true,
      parentBeatId: String(item.parentBeatId || ""),
      parentLicenseKey: toKey(item.parentLicenseKey || item.licenseKey || "basic"),
      bonusLabel: String(item.bonusLabel || ""),
    };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(arr) ? arr : [];

      const cleaned = list.map(normalize).filter(x => x.beatId && x.licenseKey);
      if (cleaned.length !== list.length) {
        localStorage.setItem(KEY, JSON.stringify(cleaned));
      }
      return cleaned;
    } catch {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items || []));
    window.dispatchEvent(new Event("pb-cart-updated"));
  }

  const api = {
    list() {
      return read();
    },

    load() {
      return read();
    },

    count() {
      return read().reduce((a, b) => a + (Number(b.qty) || 1), 0);
    },

    total() {
      return read().reduce((a, b) => a + (Number(b.price) || 0) * (Number(b.qty) || 1), 0);
    },

    add(item) {
      const cart = read();
      const x = normalize(item);

      if (!x.beatId || !x.licenseKey) return cart;

      const idx = cart.findIndex(
        (c) =>
          String(c.beatId) === x.beatId &&
          toKey(c.licenseKey) === x.licenseKey &&
          !!c.isBonus === !!x.isBonus &&
          String(c.parentBeatId || "") === String(x.parentBeatId || "")
      );

      if (idx >= 0) {
        if (!x.isBonus) {
          cart[idx].qty = (Number(cart[idx].qty) || 1) + (Number(x.qty) || 1);
        }
      } else {
        cart.push(x);
      }

      write(cart);
      return cart;
    },

    setQty(beatId, licenseKey, qty) {
      const bid = String(beatId || "").trim();
      const lk = toKey(licenseKey || "basic");
      const q = Math.max(1, Number(qty || 1));

      const cart = read();
      const idx = cart.findIndex(
        (c) => String(c.beatId) === bid && toKey(c.licenseKey) === lk && !c.isBonus
      );

      if (idx >= 0) {
        cart[idx].qty = q;
        write(cart);
      }
      return cart;
    },

    remove(beatId, licenseKey) {
      const bid = String(beatId || "").trim();
      const lk = toKey(licenseKey || "basic");

      const cart = read().filter((c) => {
        const sameMain =
          String(c.beatId) === bid &&
          toKey(c.licenseKey) === lk;

        const sameBonusFamily =
          c.isBonus === true &&
          String(c.parentBeatId || "") === bid &&
          toKey(c.parentLicenseKey || "basic") === lk;

        return !(sameMain || sameBonusFamily);
      });

      write(cart);
      return cart;
    },

    clear() {
      write([]);
    }
  };

  window.PB_CART = api;
})();
