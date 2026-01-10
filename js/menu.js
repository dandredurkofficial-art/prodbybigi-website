document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("menuBtn");
const menu = document.getElementById("mobileMenu");
  if (!btn || !menu) return;

  btn.onclick = () => {
    menu.style.display = menu.style.display === "flex" ? "none" : "flex";
  };
});
