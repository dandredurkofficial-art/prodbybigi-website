import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ======================
   FIREBASE CONFIG
====================== */
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ======================
   LOGIN
====================== */
window.loginUser = async () => {
  try {
    const cred = await signInWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    const snap = await getDoc(doc(db, "users", cred.user.uid));

    if (!snap.exists()) {
      alert("Account data missing. Contact support.");
      await signOut(auth);
      return;
    }

    const role = snap.data().role;

    if (role === "producer") {
      window.location.href = "dashboard.html";
    } else {
      window.location.href = "buyer-dashboard.html";
    }

  } catch (err) {
    alert(err.message);
  }
};

/* ======================
   REGISTER
====================== */
window.registerUser = async () => {
  try {
    const roleInput = document.querySelector('input[name="role"]:checked');
    if (!roleInput) {
      alert("Please select a role");
      return;
    }

    const role = roleInput.value;

    const cred = await createUserWithEmailAndPassword(
      auth,
      email.value,
      password.value
    );

    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      email: cred.user.email,
      role: role,
      plan: role === "producer" ? "free" : "buyer",
      createdAt: serverTimestamp()
    });

    if (role === "producer") {
      window.location.href = "dashboard.html";
    } else {
      window.location.href = "buyer-dashboard.html";
    }

  } catch (err) {
    alert(err.message);
  }
};

/* ======================
   LOGOUT (USED EVERYWHERE)
====================== */
window.logoutUser = async () => {
  await signOut(auth);
  window.location.href = "login.html";
};
