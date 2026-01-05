import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ----------------------------------
   🔐 LOGIN WITH ROLE REDIRECT
---------------------------------- */
window.loginUser = async () => {
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    redirectByRole(cred.user.uid);
  } catch (err) {
    alert(err.message);
  }
};

/* ----------------------------------
   📝 REGISTER (ROLE REQUIRED)
---------------------------------- */
window.registerUser = async () => {
  try {
    const role = document.querySelector('input[name="role"]:checked')?.value;

    if (!role) {
      alert("Please select a role");
      return;
    }

    const cred = await createUserWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    const uid = cred.user.uid;

    // PRODUCER
    if (role === "producer") {
      await setDoc(doc(db, "producers", uid), {
        uid,
        email: cred.user.email,
        name: "New Producer",
        role: "producer",
        plan: "free",
        beatsCount: 0,
        followers: 0,
        createdAt: serverTimestamp()
      });
    }

    // BUYER
    if (role === "buyer") {
      await setDoc(doc(db, "buyers", uid), {
        uid,
        email: cred.user.email,
        name: "New Buyer",
        role: "buyer",
        createdAt: serverTimestamp()
      });
    }

    redirectByRole(uid);
  } catch (err) {
    alert(err.message);
  }
};

/* ----------------------------------
   🚦 ROLE REDIRECT LOGIC
---------------------------------- */
async function redirectByRole(uid) {
  const producerSnap = await getDoc(doc(db, "producers", uid));
  if (producerSnap.exists()) {
    location.href = "dashboard.html";
    return;
  }

  const buyerSnap = await getDoc(doc(db, "buyers", uid));
  if (buyerSnap.exists()) {
    location.href = "buyer-dashboard.html";
    return;
  }

  alert("Profile not found. Contact support.");
  await auth.signOut();
}
