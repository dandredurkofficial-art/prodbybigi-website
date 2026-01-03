// AUTH GUARD — runs ONCE
(function () {
  const loggedIn = localStorage.getItem("loggedIn");

  if (loggedIn !== "true") {
    window.location.href = "login.html";
  }
})();

// PAGE SWITCHER
function show(pageId) {
  document.querySelectorAll(".page").forEach(p => {
    p.classList.remove("active");
  });

  const page = document.getElementById(pageId);
  if (page) {
    page.classList.add("active");
  }
}

// LOGOUT — ONLY WHEN CLICKED
function logout() {
  localStorage.removeItem("loggedIn");
  window.location.href = "index.html";
}
