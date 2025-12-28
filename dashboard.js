const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

auth.onAuthStateChanged(user => {
  if (!user) window.location.href = "login.html";
  loadBeats(user.uid);
});

function logout() {
  auth.signOut().then(() => {
    window.location.href = "login.html";
  });
}

function uploadBeat() {
  const title = document.getElementById("title").value;
  const price = document.getElementById("price").value;
  const file = document.getElementById("audio").files[0];
  const user = auth.currentUser;

  if (!file || !title) {
    alert("Missing fields");
    return;
  }

  const ref = storage.ref(`beats/${user.uid}/${file.name}`);
  ref.put(file).then(snapshot => {
    snapshot.ref.getDownloadURL().then(url => {
      db.collection("beats").add({
        uid: user.uid,
        title,
        price,
        url,
        created: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert("Beat uploaded!");
      loadBeats(user.uid);
    });
  });
}

function loadBeats(uid) {
  const container = document.getElementById("beats");
  container.innerHTML = "";

  db.collection("beats")
    .where("uid", "==", uid)
    .get()
    .then(snapshot => {
      snapshot.forEach(doc => {
        const beat = doc.data();
        container.innerHTML += `
          <div class="beat">
            <strong>${beat.title}</strong><br/>
            Price: ${beat.price == 0 ? "Free" : "$" + beat.price}
          </div>
        `;
      });
    });
}
