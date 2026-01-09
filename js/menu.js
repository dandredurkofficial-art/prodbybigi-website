document.addEventListener("DOMContentLoaded", () => {
  const btn = document.querySelector(".menu-btn");
  const menu = document.querySelector(".mobile-menu");
  if (!btn || !menu) return;

  btn.onclick = () => {
    menu.style.display = menu.style.display === "flex" ? "none" : "flex";
  };
});
