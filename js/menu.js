// /js/menu.js
(function () {
  function qs(sel) { return document.querySelector(sel); }

  function closeMenu() {
    const drawer = qs("#mobileMenu");
    const backdrop = qs("#menuBackdrop");
    if (!drawer || !backdrop) return;
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    document.body.classList.remove("no-scroll");
  }

  function openMenu() {
    const drawer = qs("#mobileMenu");
    const backdrop = qs("#menuBackdrop");
    if (!drawer || !backdrop) return;
    drawer.classList.add("open");
    backdrop.classList.add("open");
    document.body.classList.add("no-scroll");
  }

  function toggleMenu() {
    const drawer = qs("#mobileMenu");
    if (!drawer) return;
    if (drawer.classList.contains("open")) closeMenu();
    else openMenu();
  }

  window.Menu = { openMenu, closeMenu, toggleMenu };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#hamburgerBtn");
    const closeBtn = e.target.closest("#menuCloseBtn");
    const backdrop = e.target.closest("#menuBackdrop");
    const link = e.target.closest("#mobileMenu a");

    if (btn) toggleMenu();
    if (closeBtn) closeMenu();
    if (backdrop) closeMenu();
    if (link) closeMenu();
  });
})();
