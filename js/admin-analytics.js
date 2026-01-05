import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function loadAnalytics() {
  const ordersSnap = await getDocs(collection(db, "orders"));

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalBeats = 0;

  const producerStats = {};

  ordersSnap.forEach(doc => {
    const o = doc.data();

    totalOrders++;
    totalBeats++;
    totalRevenue += o.price;

    if (!producerStats[o.producerId]) {
      producerStats[o.producerId] = {
        sales: 0,
        revenue: 0
      };
    }

    producerStats[o.producerId].sales++;
    producerStats[o.producerId].revenue += o.price;
  });

  document.getElementById("totalRevenue").innerText = `$${totalRevenue.toFixed(2)}`;
  document.getElementById("totalOrders").innerText = totalOrders;
  document.getElementById("totalBeats").innerText = totalBeats;

  renderProducers(producerStats);
}

function renderProducers(stats) {
  const table = document.getElementById("producersTable");
  table.innerHTML = "";

  Object.entries(stats).forEach(([producerId, data]) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${producerId}</td>
      <td>${data.sales}</td>
      <td>$${data.revenue.toFixed(2)}</td>
    `;
    table.appendChild(row);
  });
}

loadAnalytics();
