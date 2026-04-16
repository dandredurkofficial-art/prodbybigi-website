(function () {
  const STORAGE_KEY = "audiory_global_player_state_v1";
  const SKIN_KEY = "audiory_player_skin_v1";
  const FX_KEY = "audiory_player_fx_v1";

  const FX_PRESETS = [
    { key: "bass", title: "Bass boost", icon: "🌀", subtitle: "Low-end focus" },
    { key: "vocal", title: "Vocal boost", icon: "🗣️", subtitle: "Clearer voice" },
    { key: "hifi", title: "Hi-Fi", icon: "🎚️", subtitle: "Balanced shine" },
    { key: "wide", title: "Wide space", icon: "⚫", subtitle: "More stereo feel" },
  ];

  const EXTRA_PRESETS = [
    { key: "normal", title: "Normal" },
    { key: "classical", title: "Classical" },
    { key: "rock", title: "Rock" },
    { key: "pop", title: "Pop" },
    { key: "acoustic", title: "Acoustic" },
    { key: "live", title: "Live" },
  ];

  const SKINS = [
    { key: "original", title: "Original", previewClass: "" },
    { key: "record", title: "Original record", previewClass: "record" },
    { key: "red", title: "Football record", previewClass: "red" },
    { key: "easter", title: "Easter mode", previewClass: "easter", downloadable: true },
    { key: "piano", title: "Piano room", previewClass: "piano", downloadable: true },
  ];

  class AudioryGlobalPlayer {
    constructor() {
      this.audio = new Audio();
      this.audio.preload = "metadata";
      this.queue = [];
      this.currentIndex = -1;
      this.currentTrack = null;
      this.isSeeking = false;
      this.repeatMode = "off"; // off, one, all
      this.shuffle = false;
      this.downloadedSkins = ["original", "record", "red"];
      this.currentSkin = localStorage.getItem(SKIN_KEY) || "original";
      this.currentFx = localStorage.getItem(FX_KEY) || "hifi";

      this.eqEnabled = true;

      this.host = document.getElementById("globalPlayerHost");
      if (!this.host) return;

      this.render();
      this.cacheDom();
      this.bind();
      this.collectTracksFromPage();
      this.restoreState();

      document.body.classList.add("has-global-player");
      window.AudioryGlobalPlayer = this;
    }

    render() {
      this.host.innerHTML = `
        <div class="gp-mini" id="gpMini">
          <div class="gp-mini-row">
            <div class="gp-mini-main" id="gpMiniOpen">
              <div class="gp-mini-cover">
                <img id="gpMiniCover" src="" alt="Now playing">
              </div>
              <div class="gp-mini-meta">
                <div class="gp-mini-title" id="gpMiniTitle">Nothing playing</div>
                <div class="gp-mini-artist" id="gpMiniArtist">Choose a beat</div>
              </div>
            </div>

            <div class="gp-mini-actions">
              <button class="gp-play-btn-round" id="gpMiniPlay" aria-label="Play or pause">▶</button>
              <button class="gp-icon-btn" id="gpMiniQueue" aria-label="Open queue">☰</button>
            </div>
          </div>
        </div>

        <div class="gp-sheet-backdrop" id="gpSheetBackdrop"></div>

        <div class="gp-sheet" id="gpSheet">
          <div class="gp-full" id="gpFull">
            <div class="gp-full-top">
              <button class="gp-chevron-btn" id="gpCloseFull" aria-label="Close">⌄</button>

              <div class="gp-top-right">
                <button class="gp-top-action" id="gpOpenSkins" aria-label="Player skin">✦</button>
                <button class="gp-top-action" id="gpShareBtn" aria-label="Share">↗</button>
              </div>
            </div>

            <div class="gp-full-cover" id="gpFullCoverWrap">
              <img id="gpFullCover" src="" alt="Track artwork">
            </div>

            <div class="gp-full-meta">
              <h2 class="gp-full-title" id="gpFullTitle">Nothing playing</h2>
              <div class="gp-full-artist" id="gpFullArtist">Choose a beat</div>

              <div class="gp-link-row">
                <a href="#" id="gpLyricsLink">View Lyrics ›</a>
              </div>

              <div class="gp-action-row">
                <div class="gp-action-row-left">
                  <button class="gp-icon-btn" id="gpLikeBtn" aria-label="Like">♡</button>
                  <button class="gp-icon-btn" id="gpAddBtn" aria-label="Add">⊞</button>
                  <button class="gp-icon-btn" id="gpDownloadBtn" aria-label="Download">↓</button>
                </div>

                <div class="gp-action-row-right">
                  <button class="gp-icon-btn" id="gpFxBtn" aria-label="Sound effects">〰</button>
                  <button class="gp-icon-btn" id="gpQueueBtn" aria-label="Queue">☰♫</button>
                  <button class="gp-icon-btn" id="gpMoreBtn" aria-label="More">⋮</button>
                </div>
              </div>

              <div class="gp-progress-block">
                <input class="gp-progress" id="gpProgress" type="range" min="0" max="100" value="0">
                <div class="gp-time-row">
                  <span id="gpCurrentTime">00:00</span>
                  <span id="gpDuration">00:00</span>
                </div>
              </div>

              <div class="gp-control-row">
                <button class="gp-side-btn" id="gpShuffleBtn" aria-label="Shuffle">🔀</button>

                <div class="gp-main-controls">
                  <button class="gp-main-btn prev" id="gpPrevBtn" aria-label="Previous">⏮</button>
                  <button class="gp-main-btn play" id="gpPlayBtn" aria-label="Play or pause">▶</button>
                  <button class="gp-main-btn next" id="gpNextBtn" aria-label="Next">⏭</button>
                </div>

                <button class="gp-side-btn" id="gpRepeatBtn" aria-label="Repeat">🔁</button>
              </div>
            </div>
          </div>
        </div>

        <div class="gp-panel-backdrop" id="gpFxBackdrop"></div>
        <div class="gp-panel" id="gpFxPanel">
          <div class="gp-panel-inner">
            <div class="gp-panel-head">
              <button class="gp-chevron-btn" id="gpCloseFx">‹</button>
              <h3 class="gp-panel-title">Sound Effect</h3>
              <button class="gp-switch is-on" id="gpEqToggle" aria-label="Toggle EQ"></button>
            </div>

            <div class="gp-card" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
              <div>
                <div style="font-size:14px;margin-bottom:10px;">Current effect:</div>
                <div style="font-size:36px;font-weight:900;font-style:italic;" id="gpCurrentFxText">Hi-Fi</div>
              </div>
              <button class="gp-simple-pill" id="gpResetFx" style="width:140px;">Reset</button>
            </div>

            <div class="gp-tabs">
              <button class="gp-tab active" id="gpFxTabPresets">Presets</button>
              <button class="gp-tab" id="gpFxTabCustom">Custom(EQ)</button>
            </div>

            <h3 style="font-size:22px;margin:0 0 16px;">Suggested presets 👍</h3>
            <div class="gp-grid" id="gpPresetGrid"></div>

            <h3 style="font-size:22px;margin:28px 0 16px;">More presets</h3>
            <div class="gp-rows" id="gpMorePresets"></div>
          </div>
        </div>

        <div class="gp-panel-backdrop" id="gpSkinBackdrop"></div>
        <div class="gp-panel" id="gpSkinPanel">
          <div class="gp-panel-inner">
            <div class="gp-panel-head">
              <button class="gp-chevron-btn" id="gpCloseSkin">‹</button>
              <h3 class="gp-panel-title">Player Skin</h3>
              <button class="gp-top-action" id="gpDownloadedBtn" aria-label="Downloaded skins">⚙</button>
            </div>

            <h3 style="font-size:22px;margin:0 0 16px;">Default</h3>
            <div class="gp-skin-grid" id="gpSkinGrid"></div>

            <h3 style="font-size:22px;margin:28px 0 16px;">Downloaded skins</h3>
            <div class="gp-skin-grid" id="gpDownloadedGrid"></div>
          </div>
        </div>

        <div class="gp-panel-backdrop" id="gpQueueBackdrop"></div>
        <div class="gp-panel" id="gpQueuePanel">
          <div class="gp-panel-inner">
            <div class="gp-panel-head">
              <button class="gp-chevron-btn" id="gpCloseQueue">‹</button>
              <h3 class="gp-panel-title">Up Next</h3>
              <div></div>
            </div>

            <div class="gp-queue-list" id="gpQueueList"></div>
          </div>
        </div>
      `;
    }

    cacheDom() {
      const $ = (id) => document.getElementById(id);

      this.mini = $("gpMini");
      this.miniOpen = $("gpMiniOpen");
      this.miniCover = $("gpMiniCover");
      this.miniTitle = $("gpMiniTitle");
      this.miniArtist = $("gpMiniArtist");
      this.miniPlay = $("gpMiniPlay");
      this.miniQueue = $("gpMiniQueue");

      this.sheet = $("gpSheet");
      this.sheetBackdrop = $("gpSheetBackdrop");
      this.closeFull = $("gpCloseFull");

      this.fullCover = $("gpFullCover");
      this.fullCoverWrap = $("gpFullCoverWrap");
      this.fullTitle = $("gpFullTitle");
      this.fullArtist = $("gpFullArtist");
      this.lyricsLink = $("gpLyricsLink");

      this.shareBtn = $("gpShareBtn");
      this.openSkinsBtn = $("gpOpenSkins");
      this.fxBtn = $("gpFxBtn");
      this.queueBtn = $("gpQueueBtn");

      this.progress = $("gpProgress");
      this.currentTimeEl = $("gpCurrentTime");
      this.durationEl = $("gpDuration");

      this.shuffleBtn = $("gpShuffleBtn");
      this.prevBtn = $("gpPrevBtn");
      this.playBtn = $("gpPlayBtn");
      this.nextBtn = $("gpNextBtn");
      this.repeatBtn = $("gpRepeatBtn");

      this.fxBackdrop = $("gpFxBackdrop");
      this.fxPanel = $("gpFxPanel");
      this.closeFx = $("gpCloseFx");
      this.eqToggle = $("gpEqToggle");
      this.currentFxText = $("gpCurrentFxText");
      this.resetFx = $("gpResetFx");
      this.presetGrid = $("gpPresetGrid");
      this.morePresets = $("gpMorePresets");

      this.skinBackdrop = $("gpSkinBackdrop");
      this.skinPanel = $("gpSkinPanel");
      this.closeSkin = $("gpCloseSkin");
      this.downloadedBtn = $("gpDownloadedBtn");
      this.skinGrid = $("gpSkinGrid");
      this.downloadedGrid = $("gpDownloadedGrid");

      this.queueBackdrop = $("gpQueueBackdrop");
      this.queuePanel = $("gpQueuePanel");
      this.closeQueue = $("gpCloseQueue");
      this.queueList = $("gpQueueList");

      this.likeBtn = $("gpLikeBtn");
      this.addBtn = $("gpAddBtn");
      this.downloadBtn = $("gpDownloadBtn");
      this.moreBtn = $("gpMoreBtn");
    }

    bind() {
      document.addEventListener("click", (e) => this.handlePagePlayClick(e), true);

      this.miniOpen?.addEventListener("click", () => this.openFull());
      this.miniPlay?.addEventListener("click", () => this.togglePlay());
      this.miniQueue?.addEventListener("click", () => this.openQueue());

      this.sheetBackdrop?.addEventListener("click", () => this.closeFull());
      this.closeFull?.addEventListener("click", () => this.closeFull());

      this.fullCoverWrap?.addEventListener("click", () => this.openFull());
      this.playBtn?.addEventListener("click", () => this.togglePlay());
      this.prevBtn?.addEventListener("click", () => this.playPrev());
      this.nextBtn?.addEventListener("click", () => this.playNext());

      this.shuffleBtn?.addEventListener("click", () => {
        this.shuffle = !this.shuffle;
        this.updateButtons();
        this.saveState();
      });

      this.repeatBtn?.addEventListener("click", () => {
        if (this.repeatMode === "off") this.repeatMode = "all";
        else if (this.repeatMode === "all") this.repeatMode = "one";
        else this.repeatMode = "off";
        this.updateButtons();
        this.saveState();
      });

      this.progress?.addEventListener("input", () => {
        this.isSeeking = true;
      });

      this.progress?.addEventListener("change", () => {
        if (!this.audio.duration) return;
        const percent = Number(this.progress.value || 0);
        this.audio.currentTime = (percent / 100) * this.audio.duration;
        this.isSeeking = false;
      });

      this.audio.addEventListener("timeupdate", () => {
        if (this.isSeeking) return;
        if (!this.audio.duration) return;
        const percent = (this.audio.currentTime / this.audio.duration) * 100;
        this.progress.value = String(percent);
        this.currentTimeEl.textContent = this.formatTime(this.audio.currentTime);
        this.durationEl.textContent = this.formatTime(this.audio.duration);
        this.saveState(false);
      });

      this.audio.addEventListener("loadedmetadata", () => {
        this.durationEl.textContent = this.formatTime(this.audio.duration || 0);
      });

      this.audio.addEventListener("play", () => {
        this.updateButtons();
        this.updatePagePlayButtons();
        this.saveState();
      });

      this.audio.addEventListener("pause", () => {
        this.updateButtons();
        this.updatePagePlayButtons();
        this.saveState();
      });

      this.audio.addEventListener("ended", () => {
        if (this.repeatMode === "one") {
          this.audio.currentTime = 0;
          this.audio.play().catch(() => {});
          return;
        }

        if (this.queue.length > 1) {
          if (this.currentIndex < this.queue.length - 1) {
            this.playNext();
            return;
          }

          if (this.repeatMode === "all") {
            this.currentIndex = 0;
            this.playTrack(this.queue[0], { autoplay: true, updateTime: false });
            return;
          }
        }

        this.updateButtons();
      });

      this.fxBtn?.addEventListener("click", () => this.openFx());
      this.fxBackdrop?.addEventListener("click", () => this.closeFxPanel());
      this.closeFx?.addEventListener("click", () => this.closeFxPanel());
      this.eqToggle?.addEventListener("click", () => this.toggleEq());
      this.resetFx?.addEventListener("click", () => this.resetFxPreset());

      this.openSkinsBtn?.addEventListener("click", () => this.openSkins());
      this.skinBackdrop?.addEventListener("click", () => this.closeSkinPanel());
      this.closeSkin?.addEventListener("click", () => this.closeSkinPanel());
      this.downloadedBtn?.addEventListener("click", () => this.renderDownloadedSkins());

      this.queueBtn?.addEventListener("click", () => this.openQueue());
      this.queueBackdrop?.addEventListener("click", () => this.closeQueuePanel());
      this.closeQueue?.addEventListener("click", () => this.closeQueuePanel());

      this.shareBtn?.addEventListener("click", () => this.shareCurrentTrack());

      this.lyricsLink?.addEventListener("click", (e) => {
        e.preventDefault();
        alert("Lyrics page can be connected later.");
      });

      this.likeBtn?.addEventListener("click", () => alert("Like feature can be connected later."));
      this.addBtn?.addEventListener("click", () => alert("Playlist feature can be connected later."));
      this.downloadBtn?.addEventListener("click", () => alert("Download feature can be connected later."));
      this.moreBtn?.addEventListener("click", () => alert("More options can be connected later."));
    }

    handlePagePlayClick(e) {
      const btn = e.target.closest(".play-fab");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      this.collectTracksFromPage();

      const card = btn.closest("[data-beat-id]");
      if (!card) return;

      const beatId = card.getAttribute("data-beat-id") || "";
      const track = this.queue.find((x) => String(x.id) === String(beatId));
      if (!track) return;

      if (this.currentTrack && String(this.currentTrack.id) === String(track.id)) {
        this.togglePlay();
        return;
      }

      this.currentIndex = this.queue.findIndex((x) => String(x.id) === String(track.id));
      this.playTrack(track, { autoplay: true });

      if (typeof window.logBeatPlay === "function") {
        window.logBeatPlay(track, btn).catch(() => {});
      }
    }

    collectTracksFromPage() {
      const cards = Array.from(document.querySelectorAll("[data-beat-id]"));
      const tracks = [];

      cards.forEach((card) => {
        const id = card.getAttribute("data-beat-id") || "";
        if (!id) return;

        const title =
          card.querySelector(".t")?.textContent?.trim() ||
          card.querySelector(".home-title-clamp")?.textContent?.trim() ||
          "Untitled";

        const producer =
          card.querySelector(".p")?.textContent?.trim() ||
          card.querySelector(".home-producer-clamp")?.textContent?.trim() ||
          "Unknown producer";

        const artwork =
          card.querySelector(".beat-cover img")?.getAttribute("src") || "";

        const beatUrl =
          card.querySelector("[data-open-beat='1']")?.getAttribute("href") || "";

        const audio = this.getAudioForBeat(id);
        if (!audio) return;

        tracks.push({
          id,
          title,
          producerName: producer.replace(/\s+/g, " ").trim(),
          artwork,
          audio,
          beatUrl,
          lyricsUrl: "",
        });
      });

      this.queue = tracks;
      this.renderQueue();
    }

    getAudioForBeat(beatId) {
      const list = window.__LATEST_BEATS__ || [];
      const beat = list.find((b) => String(b?.id || "") === String(beatId));
      return beat?.previewAudio || beat?.audio || "";
    }

    playTrack(track, opts = {}) {
      if (!track?.audio) return;

      this.currentTrack = track;
      this.audio.src = track.audio;

      if (opts.updateTime !== false) {
        this.audio.currentTime = 0;
      }

      this.updateUi();

      if (opts.autoplay !== false) {
        this.audio.play().catch((err) => {
          console.warn("play failed:", err);
        });
      }

      this.mini.classList.add("is-visible");
      this.updatePagePlayButtons();
      this.renderQueue();
      this.saveState();
    }

    togglePlay() {
      if (!this.currentTrack) {
        if (!this.queue.length) {
          this.collectTracksFromPage();
        }
        if (!this.queue.length) return;

        this.currentIndex = Math.max(0, this.currentIndex);
        this.playTrack(this.queue[this.currentIndex] || this.queue[0], { autoplay: true });
        return;
      }

      if (this.audio.paused) {
        this.audio.play().catch(() => {});
      } else {
        this.audio.pause();
      }
    }

    playNext() {
      if (!this.queue.length) return;

      if (this.shuffle && this.queue.length > 1) {
        let next = this.currentIndex;
        while (next === this.currentIndex) {
          next = Math.floor(Math.random() * this.queue.length);
        }
        this.currentIndex = next;
      } else {
        this.currentIndex = (this.currentIndex + 1) % this.queue.length;
      }

      this.playTrack(this.queue[this.currentIndex], { autoplay: true });
    }

    playPrev() {
      if (!this.queue.length) return;

      if (this.audio.currentTime > 3) {
        this.audio.currentTime = 0;
        return;
      }

      this.currentIndex = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
      this.playTrack(this.queue[this.currentIndex], { autoplay: true });
    }

    updateUi() {
      const t = this.currentTrack || {};
      const cover = t.artwork || "";

      this.miniCover.src = cover;
      this.fullCover.src = cover;
      this.miniTitle.textContent = t.title || "Nothing playing";
      this.miniArtist.textContent = t.producerName || "Choose a beat";
      this.fullTitle.textContent = t.title || "Nothing playing";
      this.fullArtist.textContent = t.producerName || "Choose a beat";

      const beatLink = t.beatUrl || "#";
      this.lyricsLink.href = beatLink;

      this.applySkin();
      this.updateButtons();
    }

    updateButtons() {
      const playing = !!this.currentTrack && !this.audio.paused;

      this.playBtn.textContent = playing ? "❚❚" : "▶";
      this.miniPlay.textContent = playing ? "❚❚" : "▶";

      this.shuffleBtn.classList.toggle("is-active", this.shuffle);
      this.repeatBtn.classList.toggle("is-active", this.repeatMode !== "off");

      if (this.repeatMode === "one") {
        this.repeatBtn.textContent = "🔂";
      } else {
        this.repeatBtn.textContent = "🔁";
      }
    }

    updatePagePlayButtons() {
      const buttons = document.querySelectorAll(".play-fab .playIcon");
      buttons.forEach((icon) => {
        const btn = icon.closest(".play-fab");
        const card = btn?.closest("[data-beat-id]");
        const beatId = card?.getAttribute("data-beat-id") || "";
        const isCurrent = this.currentTrack && String(this.currentTrack.id) === String(beatId);
        icon.textContent = isCurrent && !this.audio.paused ? "❚❚" : "▶";
      });
    }

    openFull() {
      if (!this.currentTrack) return;
      this.sheetBackdrop.classList.add("open");
      this.sheet.classList.add("open");
    }

    closeFull() {
      this.sheetBackdrop.classList.remove("open");
      this.sheet.classList.remove("open");
    }

    openFx() {
      this.fxPanel.classList.add("open");
      this.fxBackdrop.classList.add("open");
      this.renderFx();
    }

    closeFxPanel() {
      this.fxPanel.classList.remove("open");
      this.fxBackdrop.classList.remove("open");
    }

    openSkins() {
      this.skinPanel.classList.add("open");
      this.skinBackdrop.classList.add("open");
      this.renderSkins();
      this.renderDownloadedSkins();
    }

    closeSkinPanel() {
      this.skinPanel.classList.remove("open");
      this.skinBackdrop.classList.remove("open");
    }

    openQueue() {
      this.queuePanel.classList.add("open");
      this.queueBackdrop.classList.add("open");
      this.renderQueue();
    }

    closeQueuePanel() {
      this.queuePanel.classList.remove("open");
      this.queueBackdrop.classList.remove("open");
    }

    toggleEq() {
      this.eqEnabled = !this.eqEnabled;
      this.eqToggle.classList.toggle("is-on", this.eqEnabled);
    }

    resetFxPreset() {
      this.currentFx = "normal";
      localStorage.setItem(FX_KEY, this.currentFx);
      this.renderFx();
    }

    renderFx() {
      const current = FX_PRESETS.find((x) => x.key === this.currentFx);
      this.currentFxText.textContent = current?.title || "Normal";
      this.eqToggle.classList.toggle("is-on", this.eqEnabled);

      this.presetGrid.innerHTML = FX_PRESETS.map((item) => `
        <button class="gp-preset ${item.key === this.currentFx ? "active" : ""}" data-fx-key="${item.key}">
          <div class="gp-preset-icon">${item.icon}</div>
          <h4 class="gp-preset-title">${item.title}</h4>
          <div class="gp-preset-sub">${item.subtitle}</div>
        </button>
      `).join("");

      this.morePresets.innerHTML = EXTRA_PRESETS.map((item) => `
        <button class="gp-simple-pill" data-fx-key="${item.key}">${item.title}</button>
      `).join("");

      this.presetGrid.querySelectorAll("[data-fx-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.currentFx = btn.getAttribute("data-fx-key") || "normal";
          localStorage.setItem(FX_KEY, this.currentFx);
          this.renderFx();
        });
      });

      this.morePresets.querySelectorAll("[data-fx-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
          this.currentFx = btn.getAttribute("data-fx-key") || "normal";
          localStorage.setItem(FX_KEY, this.currentFx);
          this.renderFx();
        });
      });
    }

    renderSkins() {
      const currentArt = this.currentTrack?.artwork || "";

      this.skinGrid.innerHTML = SKINS.map((skin) => `
        <button class="gp-skin ${skin.key === this.currentSkin ? "active" : ""}" data-skin-key="${skin.key}">
          <div class="gp-skin-preview ${skin.previewClass}">
            <div class="gp-skin-mini-cover">
              ${currentArt ? `<img src="${currentArt}" alt="">` : ""}
            </div>
            ${skin.downloadable ? `<div class="gp-skin-tag">↓</div>` : ""}
          </div>
          <div class="gp-skin-label">${skin.title}</div>
        </button>
      `).join("");

      this.skinGrid.querySelectorAll("[data-skin-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-skin-key") || "original";
          const def = SKINS.find((s) => s.key === key);

          if (def?.downloadable && !this.downloadedSkins.includes(key)) {
            this.downloadedSkins.push(key);
          }

          this.currentSkin = key;
          localStorage.setItem(SKIN_KEY, key);
          this.applySkin();
          this.renderSkins();
          this.renderDownloadedSkins();
        });
      });
    }

    renderDownloadedSkins() {
      const currentArt = this.currentTrack?.artwork || "";
      const downloaded = SKINS.filter((s) => this.downloadedSkins.includes(s.key));

      this.downloadedGrid.innerHTML = downloaded.map((skin) => `
        <button class="gp-skin ${skin.key === this.currentSkin ? "active" : ""}" data-downloaded-skin="${skin.key}">
          <div class="gp-skin-preview ${skin.previewClass}">
            <div class="gp-skin-mini-cover">
              ${currentArt ? `<img src="${currentArt}" alt="">` : ""}
            </div>
          </div>
          <div class="gp-skin-label">${skin.title}</div>
        </button>
      `).join("");

      this.downloadedGrid.querySelectorAll("[data-downloaded-skin]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const key = btn.getAttribute("data-downloaded-skin") || "original";
          this.currentSkin = key;
          localStorage.setItem(SKIN_KEY, key);
          this.applySkin();
          this.renderDownloadedSkins();
          this.renderSkins();
        });
      });
    }

    applySkin() {
      const skin = this.currentSkin;

      this.sheet.style.background = "linear-gradient(180deg,#8a5a3d 0%, #6f472f 100%)";
      this.mini.style.background = "#8a5a3d";

      if (skin === "record") {
        this.sheet.style.background = "linear-gradient(180deg,#555 0%, #1b1f26 100%)";
        this.mini.style.background = "#454b52";
      } else if (skin === "red") {
        this.sheet.style.background = "linear-gradient(180deg,#d0242a 0%, #750c12 100%)";
        this.mini.style.background = "#9b2326";
      } else if (skin === "easter") {
        this.sheet.style.background = "linear-gradient(180deg,#7fc7ff 0%, #18a66e 100%)";
        this.mini.style.background = "#2f9f76";
      } else if (skin === "piano") {
        this.sheet.style.background = "linear-gradient(180deg,#7a4b2d 0%, #321810 100%)";
        this.mini.style.background = "#6c4329";
      }
    }

    renderQueue() {
      this.queueList.innerHTML = this.queue.map((track, index) => `
        <button class="gp-queue-item ${this.currentTrack && String(this.currentTrack.id) === String(track.id) ? "active" : ""}" data-queue-index="${index}">
          <div class="gp-queue-thumb">
            ${track.artwork ? `<img src="${track.artwork}" alt="">` : ""}
          </div>
          <div class="gp-queue-meta">
            <div class="gp-queue-title">${track.title || "Untitled"}</div>
            <div class="gp-queue-artist">${track.producerName || "Unknown producer"}</div>
          </div>
        </button>
      `).join("");

      this.queueList.querySelectorAll("[data-queue-index]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const index = Number(btn.getAttribute("data-queue-index"));
          if (!Number.isFinite(index) || !this.queue[index]) return;
          this.currentIndex = index;
          this.playTrack(this.queue[index], { autoplay: true });
          this.closeQueuePanel();
        });
      });
    }

    shareCurrentTrack() {
      if (!this.currentTrack?.beatUrl) return;

      if (navigator.share) {
        navigator.share({
          title: this.currentTrack.title || "Audiory beat",
          text: this.currentTrack.producerName || "Audiory",
          url: location.origin + this.currentTrack.beatUrl,
        }).catch(() => {});
        return;
      }

      navigator.clipboard.writeText(location.origin + this.currentTrack.beatUrl).then(() => {
        alert("Beat link copied.");
      }).catch(() => {
        alert("Could not copy link.");
      });
    }

    saveState(includeQueue = true) {
      const payload = {
        currentTrack: this.currentTrack,
        currentIndex: this.currentIndex,
        currentTime: this.audio.currentTime || 0,
        paused: this.audio.paused,
        repeatMode: this.repeatMode,
        shuffle: this.shuffle,
        currentSkin: this.currentSkin,
        currentFx: this.currentFx,
        queue: includeQueue ? this.queue : undefined,
      };

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (e) {
        console.warn("saveState failed", e);
      }
    }

    restoreState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const state = JSON.parse(raw);
        if (Array.isArray(state.queue) && state.queue.length) {
          this.queue = state.queue;
        }

        this.repeatMode = state.repeatMode || "off";
        this.shuffle = !!state.shuffle;
        this.currentSkin = state.currentSkin || this.currentSkin;
        this.currentFx = state.currentFx || this.currentFx;

        if (state.currentTrack?.audio) {
          this.currentTrack = state.currentTrack;
          this.currentIndex = Number.isFinite(state.currentIndex) ? state.currentIndex : 0;
          this.audio.src = state.currentTrack.audio;
          this.audio.currentTime = Number(state.currentTime || 0);
          this.updateUi();
          this.mini.classList.add("is-visible");
          this.updatePagePlayButtons();

          if (!state.paused) {
            this.audio.play().catch(() => {});
          }
        }

        this.renderFx();
        this.renderSkins();
        this.renderDownloadedSkins();
        this.renderQueue();
      } catch (e) {
        console.warn("restoreState failed", e);
      }
    }

    formatTime(sec) {
      if (!Number.isFinite(sec)) return "00:00";
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
  }

  function bootPlayerWhenReady() {
    const host = document.getElementById("globalPlayerHost");
    if (!host) return;

    if (window.__AUDIORY_GLOBAL_PLAYER_BOOTED__) return;
    window.__AUDIORY_GLOBAL_PLAYER_BOOTED__ = true;

    new AudioryGlobalPlayer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootPlayerWhenReady);
  } else {
    bootPlayerWhenReady();
  }
})();
