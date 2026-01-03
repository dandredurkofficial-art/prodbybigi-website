<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* 🔐 AUTH GUARD */
onAuthStateChanged(auth, user => {
  const page = location.pathname;

  if (user && (page.includes("login") || page.includes("register"))) {
    location.replace("dashboard.html");
  }

  if (!user && page.includes("dashboard")) {
    location.replace("login.html");
  }
});

/* LOGIN */
window.loginUser = () => {
  signInWithEmailAndPassword(
    auth,
    email.value,
    password.value
  ).catch(err => alert(err.message));
};

/* REGISTER */
window.registerUser = () => {
  createUserWithEmailAndPassword(
    auth,
    email.value,
    password.value
  ).catch(err => alert(err.message));
};

/* LOGOUT */
window.logoutUser = () => signOut(auth);
</script>
