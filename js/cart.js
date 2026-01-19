(function () {
  const KEY = "pb_cart_v1";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch { return []; }
  }
  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    window.dispatchEvent(new Event("pb-cart-updated"));
  }

  function add(item) {
    const items = load();
    const exists = items.find(x => x.beatId === item.beatId && x.licenseKey === item.licenseKey);
    if (!exists) items.push(item);
    save(items);
  }

  function remove(beatId, licenseKey) {
    const items = load().filter(x => !(x.beatId === beatId && x.licenseKey === licenseKey));
    save(items);
  }

  function clear() { save([]); }

  function count() { return load().length; }

  window.PB_CART = { load, save, add, remove, clear, count };
})();
