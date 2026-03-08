// /js/player.js
(function () {

  const audio = new Audio();
  audio.preload = "metadata";

  let currentBtn = null;
  let currentUrl = null;

  function setBtnState(btn, state) {
    // states: idle | loading | playing | paused
    if (!btn) return;

    btn.dataset.state = state;

    const icon = btn.querySelector(".playIcon");
    const text = btn.querySelector(".playText");

    if (state === "loading") {
      if (icon) icon.textContent = "…";
      if (text) text.textContent = "Loading";
      btn.classList.add("is-loading");
      return;
    }

    btn.classList.remove("is-loading");

    if (state === "playing") {
      if (icon) icon.textContent = "❚❚";
      if (text) text.textContent = "Pause";
    } else {
      if (icon) icon.textContent = "▶";
      if (text) text.textContent = "Play";
    }
  }

  async function playToggle(btn, url) {

    try {

      if (!url) return;

      const beatId = btn.getAttribute("data-beat-id");

      // toggle same track
      if (currentUrl === url) {

        if (!audio.paused) {
          audio.pause();
          setBtnState(currentBtn, "paused");
          return;
        } else {
          setBtnState(btn, "loading");
          await audio.play();
          setBtnState(btn, "playing");
          return;
        }

      }

      // switch track
      if (currentBtn) setBtnState(currentBtn, "paused");

      currentBtn = btn;
      currentUrl = url;

      setBtnState(btn, "loading");
      audio.src = url;

      await audio.play();
      setBtnState(btn, "playing");

      /* =====================================
         ✅ REAL PLAY COUNTER
      ===================================== */

      try {

        if (beatId && window.FB && window.FB.db) {

          await updateDoc(
            doc(window.FB.db, "beats", beatId),
            {
              plays: increment(1)
            }
          );

        }

      } catch (e) {
        console.log("[player] play count failed", e);
      }

    } catch (e) {

      console.error("[player] play error:", e);

      if (btn) setBtnState(btn, "paused");

      alert("Audio could not play. Try again.");

    }

  }

  // when audio ends reset button
  audio.addEventListener("ended", () => {

    if (currentBtn) setBtnState(currentBtn, "paused");

  });

  // attach click handler
  document.addEventListener("click", (e) => {

    const btn = e.target.closest("[data-play-btn]");
    if (!btn) return;

    const url = btn.getAttribute("data-audio-url");

    playToggle(btn, url);

  });

  // expose
  window.Player = { playToggle };

})();
