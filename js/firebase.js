/* Firebase compat – stable everywhere */
const firebaseConfig = {
  apiKey: "AIzaSyAlh6_jXAJ2Wdyfw04Ieb9NqIoa8ZziuxE",
  authDomain: "prodbybigi.firebaseapp.com",
  projectId: "prodbybigi",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

/* Global fetch function */
window.fetchBeats = async function (limit = null) {
  let query = db
    .collection("beats")
    .where("published", "==", true)
    .orderBy("createdAt", "desc");

  const snap = await query.get();
  let beats = [];

  snap.forEach(doc => {
    beats.push({ id: doc.id, ...doc.data() });
  });

  return limit ? beats.slice(0, limit) : beats;
};
