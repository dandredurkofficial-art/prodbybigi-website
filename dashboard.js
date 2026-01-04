// 🔐 FIREBASE AUTH GUARD — SAFE & RELIABLE
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth();

// ✅ REAL auth check (replaces localStorage completely)
onAuthStateChanged(auth, user => {
  if (!user) {
    window.location.href = "login.html";
  }
});

// 📄 PAGE SWITCHER
function show(pageId) {
  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active");
  });

  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add("active");
  }
}

// 🚪 LOGOUT — Firebase safe
function logout() {
  signOut(auth).then(() => {
    window.location.href = "login.html";
  });
}

// 📱 MOBILE MENU
function toggleMenu() {
  const sidebar = document.getElementById("sidebar");
  const hamburger = document.getElementById("hamburger");

  sidebar.classList.toggle("show");
  hamburger.textContent = sidebar.classList.contains("show") ? "✕" : "☰";
}
