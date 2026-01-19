import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);

function moneyFromCents(c) {
  const v = Number(c || 0) / 100;
  return "$" + (isFinite(v) ? v.toFixed(2) : "0.00");
}

function fmtDate(ts) {
  try {
    if (!ts) return "—";
    // Firestore Timestamp (admin writes) might arrive as { _seconds } from API
    const ms =
      typeof ts === "number" ? ts :
      ts.seconds ? ts.seconds * 1000 :
      ts._seconds ? ts._seconds * 1000 :
      Date.now();
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

async function apiFetch(path, { method = "GET", token, body } = {}) {
  if (!window.API_BASE) throw new Error("Missing API_BASE");
  const r = await fetch(`${window.API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

// GLOBAL logout for the button
window.logout = async () => {
  await signOut(auth);
  location.href = "login.html";
};

function renderOrders(orders) {
  const list = $("ordersList");
  const hint = $("ordersHint");
  list.innerHTML = "";

  if (!orders || !orders.length) {
    hint.textContent = "No purchases yet.";
    return;
  }

  hint.textContent = `You have ${orders.length} purchase(s).`;

  orders.forEach((o) => {
    const title = o.beatTitle || "Beat";
    const license = o.licenseKey || "license";
    const status = o.status || "—";

    const row = document.createElement("div");
    row.className = "order";
    row.innerHTML = `
      <div class="order-left">
        <div class="order-title">${escapeHtml(title)}</div>
        <div class="order-meta">
          <span class="pill">License: <b>${escapeHtml(license)}</b></span>
          <span class="pill">Status: <b>${escapeHtml(status)}</b></span>
          <span class="pill">Date: <b>${escapeHtml(fmtDate(o.createdAt || o.capturedAt))}</b></span>
        </div>
      </div>

      <div class="order-right">
        <div class="price">${moneyFromCents(o.amountCents || 0)}</div>
        <button class="btn primary" data-download="${escapeAttr(o.orderId || "")}">
          Download
        </button>
      </div>
    `;

    row.querySelector("[data-download]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const orderId = btn.getAttribute("data-download");
      if (!orderId) return;

      btn.disabled = true;
      btn.textContent = "Preparing…";

      try {
        // Backend returns { url } (signed URL or direct file URL)
        const token = await auth.currentUser.getIdToken(true);
        const data = await apiFetch(`/api/order-download`, {
          method: "POST",
          token,
          body: { orderId }
        });

        if (!data.url) throw new Error("Missing download url");
        window.open(data.url, "_blank");
        btn.textContent = "Downloaded";
      } catch (err) {
        console.error(err);
        alert(err.message || "Download failed");
        btn.disabled = false;
        btn.textContent = "Download";
      }
    });

    list.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}
function escapeAttr(s) {
  return String(s || "").replace(/"/g, "&quot;");
}

async function loadBuyerOrders(user) {
  $("ordersHint").textContent = "Loading your orders…";

  const token = await user.getIdToken(true);

  // GET buyer orders from your API
  const data = await apiFetch(`/api/my-orders`, { token });

  // data.orders is expected
  renderOrders(data.orders || []);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  $("buyerEmail").textContent = user.email || "Unknown";

  try {
    await loadBuyerOrders(user);
  } catch (err) {
    console.error(err);
    $("ordersHint").textContent = "Could not load orders.";
    alert(err.message || "Could not load orders");
  }
});
