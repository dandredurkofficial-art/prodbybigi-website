// /js/menu.js
document.addEventListener("DOMContentLoaded", () => {
  const hamburger =
    document.getElementById("hamburger") ||
    document.querySelector(".hamburger") ||
    document.querySelector("[data-hamburger]");

  const mobileMenu =
    document.getElementById("mobileMenu") ||
    document.querySelector(".mobile-menu") ||
    document.querySelector("[data-mobile-menu]");

  if (!hamburger || !mobileMenu) return;

  hamburger.style.cursor = "pointer";

  hamburger.addEventListener("click", () => {
    hamburger.classList.toggle("active");
    mobileMenu.classList.toggle("open");
  });

  // close menu on link click
  mobileMenu.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    hamburger.classList.remove("active");
    mobileMenu.classList.remove("open");
  });
});
