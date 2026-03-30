// /js/dashboard-link.js

(function () {
  async function getDashboardUrl() {
    try {
      const auth = window.FB?.auth;
      const db = window.FB?.db;

      const user = auth?.currentUser;
      if (!user) return "/login/";

      const snap = await window.FB.getDoc(
        window.FB.doc(db, "users", user.uid)
      );

      const role = String(
        snap.exists() ? (snap.data()?.role || "") : ""
      ).toLowerCase();

      if (role === "producer") return "/dashboard/";
      if (role === "buyer") return "/buyer-dashboard/";
      if (role === "admin") return "/admin-dashboard/";

      return "/buyer-dashboard/";
    } catch (e) {
      console.error("getDashboardUrl error:", e);
      return "/buyer-dashboard/";
    }
  }

  async function goToMyDashboard(e) {
    if (e) e.preventDefault();

    const url = await getDashboardUrl();
    window.location.href = url;
  }

  async function fixDashboardLinks() {
    const desktop = document.getElementById("navDashboard");
    const mobile = document.getElementById("mNavDashboard");

    const url = await getDashboardUrl();

    if (desktop) {
      desktop.setAttribute("href", url);
      desktop.onclick = goToMyDashboard;
    }

    if (mobile) {
      mobile.setAttribute("href", url);
      mobile.onclick = goToMyDashboard;
    }
  }

  window.goToMyDashboard = goToMyDashboard;

  document.addEventListener("DOMContentLoaded", () => {
    fixDashboardLinks();
  });

  window.addEventListener("firebase-ready", () => {
    fixDashboardLinks();
  });

  // extra fallback after auth settles
  setTimeout(() => {
    fixDashboardLinks();
  }, 1200);
})();
