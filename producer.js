// Get producer username from URL
const params = new URLSearchParams(window.location.search);
const username = params.get("username") || "prodbigi";

// Fake data (replace with Firebase later)
const producer = {
  name: username,
  bio: "Independent music producer",
  beats: [
    { title: "Midnight Trap", genre: "Trap", price: 19 },
    { title: "Afro Wave", genre: "Afrobeats", price: 29 }
  ]
};

// Populate profile
document.getElementById("producerName").textContent = producer.name;
document.getElementById("bio").textContent = producer.bio;
document.getElementById("beatsCount").textContent = producer.beats.length;
document.getElementById("salesCount").textContent = 124;
document.getElementById("followersCount").textContent = 312;

// Load beats
const grid = document.getElementById("beatsGrid");

producer.beats.forEach(beat => {
  const card = document.createElement("div");
  card.className = "beat-card";

  card.innerHTML = `
    <img src="https://picsum.photos/400?random=${Math.random()}">
    <h4>${beat.title}</h4>
    <p>${beat.genre}</p>
    <span>$${beat.price}</span>
    <button>Buy License</button>
  `;

  grid.appendChild(card);
});
