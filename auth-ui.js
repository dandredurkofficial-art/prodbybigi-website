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

/* LOGIN */
window.loginUser = async () => {
  const cred = await signInWithEmailAndPassword(auth, email.value, password.value);
  const snap = await getDoc(doc(db, "users", cred.user.uid));

  const role = snap.data().role;
  location.href = role === "producer"
    ? "producer-dashboard.html"
    : "buyer-dashboard.html";
};

/* REGISTER */
window.registerUser = async () => {
  const cred = await createUserWithEmailAndPassword(auth, email.value, password.value);

  await setDoc(doc(db, "users", cred.user.uid), {
    uid: cred.user.uid,
    email: cred.user.email,
    role: role.value,   // 👈 producer or buyer
    createdAt: serverTimestamp()
  });

  location.href = role.value === "producer"
    ? "producer-dashboard.html"
    : "dashboard.html";
};
