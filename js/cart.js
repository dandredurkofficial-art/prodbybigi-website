// /js/cart.js (simple cart using localStorage)
// Exposes window.PB_CART with add/remove/list/clear/count/total
// PLUS aliases: load(), save(), setQty(), KEY

(function () {
  const KEY = "pb_cart_v1";

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function write(items) {
    localStorage.setItem(KEY, JSON.stringify(items || []));
    window.dispatchEvent(new Event("pb-cart-updated"));
  }

  function toKey(x) {
    return String(x || "basic").trim().toLowerCase();
  }

  function normalize(item) {
    const beatId = String(item.beatId || "").trim();
    const licenseKey = toKey(item.licenseKey || "basic");

    return {
      id: item.id || `${beatId}:${licenseKey}`,
      beatId,
      title: String(item.title || "Item"),
      artwork: String(item.artwork || ""),
      licenseKey,
      licenseName: String(item.licenseName || item.licenseKey || "basic"),
      price: Number(item.price || 0),
      qty: Math.max(1, Number(item.qty || 1))
    };
  }

  const api = {
    KEY,

    // --- primary methods ---
    list() {
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

      // reject empty beatId
      if (!x.beatId) return cart;

      const idx = cart.findIndex((c) => c.beatId === x.beatId && toKey(c.licenseKey) === x.licenseKey);

      if (idx >= 0) {
        // if item.qty was provided, add that qty, else +1
        const addQty = Math.max(1, Number(item.qty || 1));
        cart[idx].qty = (Number(cart[idx].qty) || 1) + addQty;
      } else {
        cart.push(x);
      }

      write(cart);
      return cart;
    },
    remove(beatId, licenseKey) {
      const bid = String(beatId || "").trim();
      const lk = toKey(licenseKey || "basic");
      const cart = read().filter((c) => !(String(c.beatId) === bid && toKey(c.licenseKey) === lk));
      write(cart);
      return cart;
    },
    clear() {
      write([]);
    },

    // --- aliases so other pages don't break ---
    load() {
      return read();
    },
    save(items) {
      write(items);
      return items;
    },
    setQty(beatId, licenseKey, qty) {
      const bid = String(beatId || "").trim();
      const lk = toKey(licenseKey || "basic");
      const cart = read();
      const idx = cart.findIndex((c) => String(c.beatId) === bid && toKey(c.licenseKey) === lk);
      if (idx >= 0) {
        cart[idx].qty = Math.max(1, Number(qty || 1));
        write(cart);
      }
      return cart;
    }
  };

  window.PB_CART = api;
})();
