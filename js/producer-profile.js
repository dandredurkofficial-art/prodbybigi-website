// GET ?username=bigi
const params = new URLSearchParams(window.location.search);
const username = params.get("username");

// PAGE ELEMENTS
const producerNameEl = document.getElementById("producerName");
const beatsContainer = document.getElementById("producerBeats");

// FILTER BEATS
const producerBeats = beats.filter(
  beat => beat.producer === username
);

// SET PRODUCER NAME
if (producerBeats.length > 0) {
  producerNameEl.textContent = producerBeats[0].producerName;
} else {
  producerNameEl.textContent = "Producer";
}

// RENDER BEATS
producerBeats.forEach(beat => {
  const card = document.createElement("div");
  card.className = "beat-card";
  card.innerHTML = `
    <div>
      <h3>${beat.title}</h3>
      <p>${beat.genre}</p>
    </div>
    <button>$${beat.price}</button>
  `;
  beatsContainer.appendChild(card);
});
