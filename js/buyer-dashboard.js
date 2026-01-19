import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);

async function apiGet(path) {
  if (!window.API_BASE) throw new Error("Missing API_BASE");
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");

  const token = await user.getIdToken();

  const r = await fetch(`${window.API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderOrders(orders) {
  const list = $("ordersList");
  const status = $("ordersStatus");
  list.innerHTML = "";

  if (!orders || !orders.length) {
    status.textContent = "No purchases yet.";
    return;
  }

  status.textContent = "";

  orders.forEach((o) => {
    const title = o.beatTitle || o.beatName || o.title || o.beatId || "Beat";
    const dateText = o.capturedAt?.seconds
      ? new Date(o.capturedAt.seconds * 1000).toLocaleString()
      : "";

    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div style="min-width:0">
        <div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
        <div class="small">License: ${o.licenseKey || "-"} • ${dateText}</div>
      </div>
      <a class="dl" href="#" data-order-id="${o.id}">Download</a>
    `;
    list.appendChild(row);
  });
}

// Download click (works for all items always)
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a.dl");
  if (!a) return;

  const list = $("ordersList");
  if (!list || !list.contains(a)) return; // only handle inside dashboard list

  e.preventDefault();

  const orderId = a.getAttribute("data-order-id");
  if (!orderId) return;

  const oldText = a.textContent;
  a.textContent = "Loading…";
  a.style.pointerEvents = "none";

  try {
    const data = await apiGet(`/api/order-download?orderId=${encodeURIComponent(orderId)}`);

    // API returns: { ok: true, url: "https://..." }
    const url = data.url;
    if (!url) throw new Error("No download url returned");

    window.open(url, "_blank", "noopener,noreferrer");

    a.textContent = oldText;
    a.style.pointerEvents = "auto";
  } catch (err) {
    console.error(err);
    alert(err.message || "Download failed");
    a.textContent = oldText;
    a.style.pointerEvents = "auto";
  }
});

// Logout (global for button)
window.logoutUser = async () => {
  await signOut(auth);
  window.location.href = "login.html";
};

// Auth guard + load orders
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  $("buyerEmail").textContent = user.email || "(no email)";

  try {
    const data = await apiGet("/api/my-orders");
    const orders = (data.orders || []).filter((o) => o.status === "CAPTURED");
    renderOrders(orders);
  } catch (err) {
    console.error(err);
    $("ordersStatus").textContent = err.message || "Failed to load orders.";
  }
});
