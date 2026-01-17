// /js/menu.js
export function wireMenu() {
  const burger = document.getElementById("hamburger");
  const menu = document.getElementById("mobileMenu");
  if (!burger || !menu) return;

  burger.addEventListener("click", () => {
    burger.classList.toggle("active");
    menu.classList.toggle("open");
  });

  // close when clicking a link
  menu.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      burger.classList.remove("active");
      menu.classList.remove("open");
    });
  });
}
