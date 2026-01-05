import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔐 ADMIN GUARD
onAuthStateChanged(auth, async user => {
  if (!user) return location.href = "login.html";

  const ref = doc(db, "producers", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists() || snap.data().role !== "admin") {
    alert("Access denied");
    location.href = "dashboard.html";
    return;
  }

  loadProducers();
});

// 📋 LOAD ALL PRODUCERS
async function loadProducers() {
  const list = document.getElementById("producers");
  list.innerHTML = "";

  const snap = await getDocs(collection(db, "producers"));
  snap.forEach(docSnap => {
    const p = docSnap.data();

    list.innerHTML += `
      <div style="border:1px solid #ccc;padding:10px;margin:10px">
        <strong>${p.email}</strong><br>
        Role: ${p.role}<br>
        Plan: ${p.plan}<br>
        <button onclick="makeAdmin('${p.uid}')">Make Admin</button>
      </div>
    `;
  });
}

// 🔑 PROMOTE TO ADMIN
window.makeAdmin = async uid => {
  await updateDoc(doc(db, "producers", uid), {
    role: "admin"
  });
  alert("Admin granted");
  loadProducers();
};

// 🚪 LOGOUT
window.logout = () => {
  signOut(auth).then(() => location.href = "login.html");
};
