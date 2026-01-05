import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// LOGOUT
window.logout = async () => {
  await signOut(auth);
  location.href = "login.html";
};

// AUTH + ROLE CHECK
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const buyerRef = doc(db, "buyers", user.uid);
  const buyerSnap = await getDoc(buyerRef);

  // 🚫 Not a buyer → block access
  if (!buyerSnap.exists()) {
    alert("Access denied.");
    location.href = "login.html";
    return;
  }

  const buyer = buyerSnap.data();

  // Profile
  document.getElementById("buyerEmail").textContent = buyer.email;
  document.getElementById("buyerName").textContent = buyer.name || "Buyer";

  // Load purchases (safe even if empty)
  loadPurchases(user.uid);
});

// LOAD PURCHASED BEATS
async function loadPurchases(uid) {
  const wrap = document.getElementById("purchases");
  wrap.innerHTML = "";

  const q = query(
    collection(db, "purchases"),
    where("buyerId", "==", uid)
  );

  const snap = await getDocs(q);

  if (snap.empty) {
    wrap.innerHTML = "<p>No purchases yet.</p>";
    return;
  }

  snap.forEach(d => {
    const p = d.data();
    wrap.innerHTML += `
      <div class="beat">
        <div>${p.title}</div>
        <button onclick="alert('Download coming soon')">Download</button>
      </div>
    `;
  });
}
