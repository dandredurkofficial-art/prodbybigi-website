// /js/cart.js (simple cart using localStorage)
// Exposes window.PB_CART with add/remove/list/clear/count

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

  function normalize(item) {
    return {
      id: item.id || `${item.beatId}:${item.licenseKey}`,
      beatId: String(item.beatId || ""),
      title: String(item.title || "Beat"),
      artwork: String(item.artwork || ""),
      licenseKey: String(item.licenseKey || "basic"),
      licenseName: String(item.licenseName || item.licenseKey || "basic"),
      price: Number(item.price || 0),
      qty: 1
    };
  }

  const api = {
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

      const idx = cart.findIndex((c) => c.beatId === x.beatId && c.licenseKey === x.licenseKey);
      if (idx >= 0) {
        cart[idx].qty = (Number(cart[idx].qty) || 1) + 1;
      } else {
        cart.push(x);
      }
      write(cart);
      return cart;
    },
    remove(beatId, licenseKey) {
      const cart = read().filter((c) => !(c.beatId === String(beatId) && c.licenseKey === String(licenseKey)));
      write(cart);
      return cart;
    },
    clear() {
      write([]);
    }
  };

  window.PB_CART = api;
})();
