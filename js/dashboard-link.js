// /js/dashboard-link.js

(function () {
  async function goToMyDashboard() {
    try {
      const auth = window.FB?.auth;
      const db = window.FB?.db;

      const user = auth?.currentUser;
      if (!user) {
        window.location.href = "/login/";
        return;
      }

      const snap = await window.FB.getDoc(
        window.FB.doc(db, "users", user.uid)
      );

      const role = String(
        snap.exists() ? (snap.data()?.role || "") : ""
      ).toLowerCase();

      if (role === "producer") {
        window.location.href = "/dashboard/";
        return;
      }

      if (role === "buyer") {
        window.location.href = "/buyer-dashboard/";
        return;
      }

      if (role === "admin") {
        window.location.href = "/admin-dashboard/";
        return;
      }

      window.location.href = "/buyer-dashboard/";
    } catch (e) {
      console.error("Dashboard redirect error:", e);
      window.location.href = "/buyer-dashboard/";
    }
  }

  function bindDashboardLinks() {
    const desktop = document.getElementById("navDashboard");
    const mobile = document.getElementById("mNavDashboard");

    if (desktop && !desktop.dataset.dashboardBound) {
      desktop.dataset.dashboardBound = "1";
      desktop.addEventListener("click", async (e) => {
        e.preventDefault();
        await goToMyDashboard();
      });
    }

    if (mobile && !mobile.dataset.dashboardBound) {
      mobile.dataset.dashboardBound = "1";
      mobile.addEventListener("click", async (e) => {
        e.preventDefault();
        await goToMyDashboard();
      });
    }
  }

  window.goToMyDashboard = goToMyDashboard;

  window.addEventListener("firebase-ready", bindDashboardLinks);
  document.addEventListener("DOMContentLoaded", bindDashboardLinks);
})();
