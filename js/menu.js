const menuBtn =
  document.getElementById("menuBtn") ||
  document.getElementById("hamburger");

const mobileMenu =
  document.getElementById("mobileMenu") ||
  document.querySelector(".menu");

if (menuBtn && mobileMenu) {
  menuBtn.addEventListener("click", () => {
    mobileMenu.classList.toggle("hidden");
    mobileMenu.classList.toggle("open");
  });
}
