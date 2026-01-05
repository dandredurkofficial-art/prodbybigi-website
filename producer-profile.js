const params = new URLSearchParams(window.location.search);
const username = params.get("username");

// Fake data for now (later → Firebase)
const producers = {
  bigi: {
    name: "Prod. Bigi",
    bio: "Trap & melodic beats. Dark vibes only.",
    beats: [
      { title: "Midnight Drip", price: 39 },
      { title: "Cold Streets", price: 29 }
    ]
  }
};

const producer = producers[username];

if (producer) {
  document.getElementById("producerName").textContent = producer.name;
  document.getElementById("producerBio").textContent = producer.bio;

  const container = document.getElementById("producerBeats");

  producer.beats.forEach(beat => {
    const card = document.createElement("div");
    card.className = "beat-card";
    card.innerHTML = `
      <div>
        <h3>${beat.title}</h3>
        <p>${producer.name}</p>
      </div>
      <button>$${beat.price}</button>
    `;
    container.appendChild(card);
  });
}
