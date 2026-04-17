// /js/player.js
(function () {
  if (window.__AUDIORY_PLAYER_BOOTED__) return;
  window.__AUDIORY_PLAYER_BOOTED__ = true;

  const audio = new Audio();
  audio.preload = "metadata";
  audio.crossOrigin = "anonymous";

  let currentTrack = null;
  let currentIndex = -1;
  let queue = [];
  let shuffle = false;
  let repeatMode = "off"; // off | all | one
  let isSeeking = false;
  let currentSkin = localStorage.getItem("audiory_player_skin") || "brown";
  let currentFx = localStorage.getItem("audiory_player_fx") || "normal";
  let fxEnabled = localStorage.getItem("audiory_player_fx_enabled") !== "0";

  let audioCtx = null;
  let sourceNode = null;
  let masterGain = null;
  let biquad1 = null;
  let biquad2 = null;
  let fxReady = false;

  const playedSession = {};
  const downloadedSkins = ["brown", "graphite", "midnight", "sunset", "ocean"];

  injectStyles();
  renderPlayer();
  cacheDom();
  bindEvents();
  applySkin(currentSkin);
  renderFxCards();
  renderSkinCards();
  collectQueueFromPage();

  function injectStyles() {
    if (document.getElementById("audiory-player-styles")) return;

    const style = document.createElement("style");
    style.id = "audiory-player-styles";
    style.textContent = `
      :root{
        --ap-bg:#8b5a3c;
        --ap-bg-2:#6f452f;
        --ap-text:#ffffff;
        --ap-muted:rgba(255,255,255,.78);
        --ap-line:rgba(255,255,255,.12);
        --ap-chip:rgba(255,255,255,.08);
        --ap-accent:#23d7ff;
        --ap-shadow:0 18px 50px rgba(0,0,0,.35);
      }

      body{
        padding-bottom:110px;
      }

      .ap-hidden{display:none!important}

      .audiory-player-root{
        position:fixed;
        left:0;
        right:0;
        bottom:0;
        z-index:10040;
        pointer-events:none;
      }

      .ap-mini{
        pointer-events:auto;
        width:min(980px, calc(100vw - 16px));
        margin:0 auto 10px;
        background:linear-gradient(180deg,var(--ap-bg) 0%, var(--ap-bg-2) 100%);
        border:1px solid var(--ap-line);
        border-radius:24px;
        box-shadow:var(--ap-shadow);
        display:none;
        overflow:hidden;
      }

      .ap-mini.show{display:block}

      .ap-mini-inner{
        display:flex;
        align-items:center;
        gap:14px;
        padding:12px 14px;
        min-height:86px;
      }

      .ap-mini-main{
        flex:1;
        min-width:0;
        display:flex;
        align-items:center;
        gap:12px;
        cursor:pointer;
      }

      .ap-cover{
        width:58px;
        height:58px;
        border-radius:16px;
        overflow:hidden;
        background:rgba(0,0,0,.16);
        flex-shrink:0;
      }

      .ap-cover img{
        width:100%;
        height:100%;
        object-fit:cover;
        display:block;
      }

      .ap-meta{
        min-width:0;
        flex:1;
      }

      .ap-title{
        font-size:18px;
        font-weight:900;
        line-height:1.15;
        color:var(--ap-text);
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .ap-artist{
        font-size:14px;
        color:var(--ap-muted);
        margin-top:4px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .ap-mini-actions,
      .ap-row-actions{
        display:flex;
        align-items:center;
        gap:10px;
      }

      .ap-btn,
      .ap-main-btn,
      .ap-mini-play{
        appearance:none;
        border:none;
        outline:none;
        background:transparent;
        color:var(--ap-text);
        cursor:pointer;
        padding:0;
      }

      .ap-btn{
        width:42px;
        height:42px;
        border-radius:14px;
        display:grid;
        place-items:center;
      }

      .ap-btn:hover{
        background:rgba(255,255,255,.08);
      }

      .ap-btn svg,
      .ap-main-btn svg,
      .ap-mini-play svg{
        width:23px;
        height:23px;
        display:block;
        fill:none;
        stroke:currentColor;
        stroke-width:2;
        stroke-linecap:round;
        stroke-linejoin:round;
      }

      .ap-mini-play{
        width:54px;
        height:54px;
        border-radius:50%;
        border:2px solid rgba(255,255,255,.55);
        display:grid;
        place-items:center;
      }

      .ap-mini-play svg{
        width:24px;
        height:24px;
      }

      .ap-backdrop{
        position:fixed;
        inset:0;
        background:rgba(0,0,0,.62);
        opacity:0;
        pointer-events:none;
        transition:.2s ease;
        z-index:10041;
      }

      .ap-backdrop.show{
        opacity:1;
        pointer-events:auto;
      }

      .ap-sheet{
        position:fixed;
        inset:auto 0 0 0;
        z-index:10042;
        transform:translateY(102%);
        transition:transform .24s ease;
        background:linear-gradient(180deg,var(--ap-bg) 0%, var(--ap-bg-2) 100%);
        border-radius:28px 28px 0 0;
        max-height:92vh;
        overflow:auto;
        box-shadow:0 -12px 40px rgba(0,0,0,.34);
      }

      .ap-sheet.show{
        transform:translateY(0);
      }

      .ap-full{
        width:min(860px, 100%);
        margin:0 auto;
        padding:18px 18px 30px;
        color:var(--ap-text);
      }

      .ap-top{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-bottom:18px;
      }

      .ap-top-right{
        display:flex;
        align-items:center;
        gap:8px;
      }

      .ap-main-cover{
        width:min(100%, 520px);
        aspect-ratio:1/1;
        margin:0 auto;
        border-radius:24px;
        overflow:hidden;
        background:rgba(255,255,255,.08);
        box-shadow:0 14px 40px rgba(0,0,0,.18);
      }

      .ap-main-cover img{
        width:100%;
        height:100%;
        object-fit:cover;
        display:block;
      }

      .ap-main-meta{
        margin-top:22px;
      }

      .ap-main-title{
        font-size:30px;
        line-height:1.14;
        font-weight:950;
        margin:0;
      }

      .ap-main-artist{
        color:var(--ap-muted);
        font-size:17px;
        margin-top:8px;
      }

      .ap-link{
        display:inline-flex;
        align-items:center;
        gap:8px;
        color:var(--ap-text);
        text-decoration:none;
        font-weight:800;
        margin-top:16px;
        opacity:.92;
      }

      .ap-row-actions{
        justify-content:space-between;
        flex-wrap:wrap;
        margin-top:18px;
      }

      .ap-action-group{
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
      }

      .ap-progress-wrap{
        margin-top:20px;
      }

      .ap-progress{
        width:100%;
        appearance:none;
        height:4px;
        border-radius:999px;
        background:rgba(255,255,255,.24);
        outline:none;
      }

      .ap-progress::-webkit-slider-thumb{
        appearance:none;
        width:16px;
        height:16px;
        border-radius:50%;
        background:#fff;
        border:none;
      }

      .ap-time{
        margin-top:10px;
        display:flex;
        justify-content:space-between;
        font-size:13px;
        color:var(--ap-muted);
      }

      .ap-controls{
        margin-top:20px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }

      .ap-controls-center{
        display:flex;
        align-items:center;
        gap:18px;
      }

      .ap-main-btn{
        display:grid;
        place-items:center;
      }

      .ap-main-btn.small{
        width:54px;
        height:54px;
      }

      .ap-main-btn.big{
        width:86px;
        height:86px;
        border-radius:50%;
        background:#fff;
        color:#563724;
      }

      .ap-main-btn.big svg{
        width:34px;
        height:34px;
      }

      .ap-active{
        color:var(--ap-accent)!important;
      }

      .ap-panel{
        position:fixed;
        left:0;
        right:0;
        bottom:0;
        z-index:10043;
        transform:translateY(102%);
        transition:transform .24s ease;
        background:#090c11;
        color:#fff;
        border-radius:28px 28px 0 0;
        max-height:88vh;
        overflow:auto;
        box-shadow:0 -10px 30px rgba(0,0,0,.34);
      }

      .ap-panel.show{
        transform:translateY(0);
      }

      .ap-panel-inner{
        width:min(860px, 100%);
        margin:0 auto;
        padding:18px 18px 24px;
      }

      .ap-panel-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-bottom:18px;
      }

      .ap-panel-title{
        font-size:20px;
        font-weight:900;
        margin:0;
      }

      .ap-switch{
        width:58px;
        height:34px;
        border:none;
        border-radius:999px;
        position:relative;
        background:rgba(255,255,255,.14);
        cursor:pointer;
      }

      .ap-switch::after{
        content:"";
        position:absolute;
        top:4px;
        left:4px;
        width:26px;
        height:26px;
        border-radius:50%;
        background:#fff;
        transition:left .18s ease;
      }

      .ap-switch.on::after{
        left:28px;
      }

      .ap-card{
        background:#1e232b;
        border:1px solid rgba(255,255,255,.08);
        border-radius:22px;
        padding:18px;
      }

      .ap-tabs{
        display:flex;
        gap:12px;
        margin:18px 0 18px;
      }

      .ap-tab{
        border:none;
        min-height:54px;
        padding:0 22px;
        border-radius:999px;
        background:#232831;
        color:rgba(255,255,255,.7);
        font-size:17px;
        font-weight:900;
        cursor:pointer;
      }

      .ap-tab.active{
        background:#fff;
        color:#111;
      }

      .ap-grid{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:14px;
      }

      .ap-fx-card,
      .ap-skin-card,
      .ap-queue-item{
        border:none;
        background:#232831;
        color:#fff;
        text-align:left;
        border-radius:18px;
        padding:16px;
        cursor:pointer;
      }

      .ap-fx-card.active,
      .ap-skin-card.active,
      .ap-queue-item.active{
        outline:1px solid var(--ap-accent);
        box-shadow:0 0 0 1px var(--ap-accent) inset;
      }

      .ap-fx-icon{
        width:54px;
        height:54px;
        border-radius:16px;
        display:grid;
        place-items:center;
        margin-bottom:16px;
        background:linear-gradient(135deg,#70e4ff,#a8ffb2);
        color:#111;
        font-weight:900;
        font-size:18px;
      }

      .ap-fx-title,
      .ap-skin-title{
        font-size:18px;
        font-weight:900;
      }

      .ap-fx-sub{
        color:rgba(255,255,255,.64);
        font-size:14px;
        margin-top:8px;
      }

      .ap-simple-list{
        display:grid;
        gap:12px;
        margin-top:18px;
      }

      .ap-simple-btn{
        border:none;
        background:#2a2f38;
        color:#fff;
        min-height:56px;
        border-radius:16px;
        font-size:17px;
        font-weight:900;
        cursor:pointer;
      }

      .ap-skin-preview{
        aspect-ratio:9/14;
        border-radius:16px;
        position:relative;
        overflow:hidden;
        margin-bottom:12px;
        background:linear-gradient(180deg,#8b5a3c 0%, #6f452f 100%);
      }

      .ap-skin-preview.graphite{
        background:linear-gradient(180deg,#50555e 0%, #1f232a 100%);
      }

      .ap-skin-preview.midnight{
        background:linear-gradient(180deg,#0c1633 0%, #050914 100%);
      }

      .ap-skin-preview.sunset{
        background:linear-gradient(180deg,#db5d31 0%, #5a210e 100%);
      }

      .ap-skin-preview.ocean{
        background:linear-gradient(180deg,#1685d1 0%, #0b2a4d 100%);
      }

      .ap-skin-art{
        position:absolute;
        left:50%;
        top:14%;
        transform:translateX(-50%);
        width:42%;
        aspect-ratio:1/1;
        border-radius:10px;
        overflow:hidden;
        background:rgba(255,255,255,.12);
      }

      .ap-skin-art img{
        width:100%;
        height:100%;
        object-fit:cover;
      }

      .ap-download-badge{
        position:absolute;
        right:10px;
        top:10px;
        width:40px;
        height:40px;
        border-radius:14px;
        background:rgba(0,0,0,.28);
        display:grid;
        place-items:center;
      }

      .ap-queue-list{
        display:grid;
        gap:12px;
      }

      .ap-queue-item{
        display:flex;
        align-items:center;
        gap:12px;
      }

      .ap-queue-thumb{
        width:54px;
        height:54px;
        border-radius:14px;
        overflow:hidden;
        background:rgba(255,255,255,.08);
        flex-shrink:0;
      }

      .ap-queue-thumb img{
        width:100%;
        height:100%;
        object-fit:cover;
      }

      .ap-queue-meta{
        min-width:0;
      }

      .ap-queue-title{
        font-size:15px;
        font-weight:900;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      .ap-queue-artist{
        font-size:13px;
        color:rgba(255,255,255,.68);
        margin-top:4px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }

      @media (max-width: 860px){
        .ap-main-title{font-size:24px}
      }

      @media (max-width: 700px){
        body{padding-bottom:96px}
        .ap-mini{
          width:calc(100vw - 12px);
          margin-bottom:8px;
          border-radius:20px;
        }
        .ap-mini-inner{
          min-height:76px;
          padding:10px 12px;
        }
        .ap-cover{
          width:52px;
          height:52px;
          border-radius:14px;
        }
        .ap-title{font-size:16px}
        .ap-artist{font-size:13px}
        .ap-mini-play{
          width:50px;
          height:50px;
        }
        .ap-btn{
          width:38px;
          height:38px;
        }
        .ap-full{
          padding:14px 14px 24px;
        }
        .ap-main-title{
          font-size:22px;
        }
        .ap-grid{
          grid-template-columns:1fr 1fr;
        }
        .ap-main-btn.big{
          width:76px;
          height:76px;
        }
        .ap-main-btn.small{
          width:48px;
          height:48px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderPlayer() {
    if (document.getElementById("audioryPlayerRoot")) return;

    const root = document.createElement("div");
    root.id = "audioryPlayerRoot";
    root.className = "audiory-player-root";
    root.innerHTML = `
      <div class="ap-mini" id="apMini">
        <div class="ap-mini-inner">
          <div class="ap-mini-main" id="apMiniMain">
            <div class="ap-cover"><img id="apMiniImg" alt=""></div>
            <div class="ap-meta">
              <div class="ap-title" id="apMiniTitle">Nothing playing</div>
              <div class="ap-artist" id="apMiniArtist">Choose a beat</div>
            </div>
          </div>
          <div class="ap-mini-actions">
            <button class="ap-mini-play" id="apMiniPlay" aria-label="Play"></button>
            <button class="ap-btn" id="apMiniQueue" aria-label="Queue"></button>
          </div>
        </div>
      </div>

      <div class="ap-backdrop" id="apBackdrop"></div>

      <div class="ap-sheet" id="apSheet">
        <div class="ap-full">
          <div class="ap-top">
            <button class="ap-btn" id="apCloseFull" aria-label="Close"></button>
            <div class="ap-top-right">
              <button class="ap-btn" id="apOpenSkins" aria-label="Skins"></button>
              <button class="ap-btn" id="apShare" aria-label="Share"></button>
            </div>
          </div>

          <div class="ap-main-cover">
            <img id="apFullImg" alt="">
          </div>

          <div class="ap-main-meta">
            <h2 class="ap-main-title" id="apFullTitle">Nothing playing</h2>
            <div class="ap-main-artist" id="apFullArtist">Choose a beat</div>
            <a href="#" class="ap-link" id="apLyricsLink">View track page</a>

            <div class="ap-row-actions">
              <div class="ap-action-group">
                <button class="ap-btn" id="apLikeBtn" aria-label="Like"></button>
                <button class="ap-btn" id="apAddBtn" aria-label="Add"></button>
                <button class="ap-btn" id="apDownloadBtn" aria-label="Download"></button>
              </div>
              <div class="ap-action-group">
                <button class="ap-btn" id="apFxBtn" aria-label="Effects"></button>
                <button class="ap-btn" id="apQueueBtn" aria-label="Queue"></button>
                <button class="ap-btn" id="apMoreBtn" aria-label="More"></button>
              </div>
            </div>

            <div class="ap-progress-wrap">
              <input type="range" min="0" max="100" value="0" class="ap-progress" id="apProgress">
              <div class="ap-time">
                <span id="apCurrentTime">00:00</span>
                <span id="apDuration">00:00</span>
              </div>
            </div>

            <div class="ap-controls">
              <button class="ap-btn" id="apShuffleBtn" aria-label="Shuffle"></button>
              <div class="ap-controls-center">
                <button class="ap-main-btn small" id="apPrevBtn" aria-label="Previous"></button>
                <button class="ap-main-btn big" id="apPlayBtn" aria-label="Play"></button>
                <button class="ap-main-btn small" id="apNextBtn" aria-label="Next"></button>
              </div>
              <button class="ap-btn" id="apRepeatBtn" aria-label="Repeat"></button>
            </div>
          </div>
        </div>
      </div>

      <div class="ap-panel" id="apFxPanel">
        <div class="ap-panel-inner">
          <div class="ap-panel-head">
            <button class="ap-btn" id="apCloseFx"></button>
            <h3 class="ap-panel-title">Sound Effect</h3>
            <button class="ap-switch" id="apFxSwitch" aria-label="Toggle sound effect"></button>
          </div>

          <div class="ap-card">
            <div style="font-size:14px;margin-bottom:8px;">Current effect:</div>
            <div style="font-size:34px;font-weight:950;font-style:italic;" id="apCurrentFxLabel">Normal</div>
          </div>

          <div class="ap-tabs">
            <button class="ap-tab active" type="button">Presets</button>
            <button class="ap-tab" type="button">Custom(EQ)</button>
          </div>

          <h3 style="font-size:22px;margin:0 0 14px;">Suggested presets</h3>
          <div class="ap-grid" id="apFxGrid"></div>

          <h3 style="font-size:22px;margin:24px 0 14px;">More presets</h3>
          <div class="ap-simple-list" id="apFxMore"></div>
        </div>
      </div>

      <div class="ap-panel" id="apSkinPanel">
        <div class="ap-panel-inner">
          <div class="ap-panel-head">
            <button class="ap-btn" id="apCloseSkin"></button>
            <h3 class="ap-panel-title">Player Skin</h3>
            <button class="ap-btn" id="apDownloadedOpen" aria-label="Downloaded skins"></button>
          </div>

          <h3 style="font-size:22px;margin:0 0 14px;">Default</h3>
          <div class="ap-grid" id="apSkinGrid"></div>

          <h3 style="font-size:22px;margin:24px 0 14px;">Downloaded skins</h3>
          <div class="ap-grid" id="apDownloadedGrid"></div>
        </div>
      </div>

      <div class="ap-panel" id="apQueuePanel">
        <div class="ap-panel-inner">
          <div class="ap-panel-head">
            <button class="ap-btn" id="apCloseQueue"></button>
            <h3 class="ap-panel-title">Queue</h3>
            <div style="width:42px;"></div>
          </div>
          <div class="ap-queue-list" id="apQueueList"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
  }

  function cacheDom() {
    window.__AP = {
      mini: document.getElementById("apMini"),
      miniMain: document.getElementById("apMiniMain"),
      miniImg: document.getElementById("apMiniImg"),
      miniTitle: document.getElementById("apMiniTitle"),
      miniArtist: document.getElementById("apMiniArtist"),
      miniPlay: document.getElementById("apMiniPlay"),
      miniQueue: document.getElementById("apMiniQueue"),

      backdrop: document.getElementById("apBackdrop"),
      sheet: document.getElementById("apSheet"),
      closeFull: document.getElementById("apCloseFull"),
      openSkins: document.getElementById("apOpenSkins"),
      share: document.getElementById("apShare"),

      fullImg: document.getElementById("apFullImg"),
      fullTitle: document.getElementById("apFullTitle"),
      fullArtist: document.getElementById("apFullArtist"),
      lyrics: document.getElementById("apLyricsLink"),

      likeBtn: document.getElementById("apLikeBtn"),
      addBtn: document.getElementById("apAddBtn"),
      downloadBtn: document.getElementById("apDownloadBtn"),
      fxBtn: document.getElementById("apFxBtn"),
      queueBtn: document.getElementById("apQueueBtn"),
      moreBtn: document.getElementById("apMoreBtn"),

      progress: document.getElementById("apProgress"),
      currentTime: document.getElementById("apCurrentTime"),
      duration: document.getElementById("apDuration"),

      shuffleBtn: document.getElementById("apShuffleBtn"),
      prevBtn: document.getElementById("apPrevBtn"),
      playBtn: document.getElementById("apPlayBtn"),
      nextBtn: document.getElementById("apNextBtn"),
      repeatBtn: document.getElementById("apRepeatBtn"),

      fxPanel: document.getElementById("apFxPanel"),
      closeFx: document.getElementById("apCloseFx"),
      fxSwitch: document.getElementById("apFxSwitch"),
      currentFxLabel: document.getElementById("apCurrentFxLabel"),
      fxGrid: document.getElementById("apFxGrid"),
      fxMore: document.getElementById("apFxMore"),

      skinPanel: document.getElementById("apSkinPanel"),
      closeSkin: document.getElementById("apCloseSkin"),
      downloadedOpen: document.getElementById("apDownloadedOpen"),
      skinGrid: document.getElementById("apSkinGrid"),
      downloadedGrid: document.getElementById("apDownloadedGrid"),

      queuePanel: document.getElementById("apQueuePanel"),
      closeQueue: document.getElementById("apCloseQueue"),
      queueList: document.getElementById("apQueueList"),
    };

    setButtonIcons();
  }

  function setButtonIcons() {
    const AP = window.__AP;
    AP.miniPlay.innerHTML = iconPlay();
    AP.miniQueue.innerHTML = iconQueue();

    AP.closeFull.innerHTML = iconChevronDown();
    AP.openSkins.innerHTML = iconSparkles();
    AP.share.innerHTML = iconShare();

    AP.likeBtn.innerHTML = iconHeart();
    AP.addBtn.innerHTML = iconPlusSquare();
    AP.downloadBtn.innerHTML = iconDownload();
    AP.fxBtn.innerHTML = iconWave();
    AP.queueBtn.innerHTML = iconQueue();
    AP.moreBtn.innerHTML = iconMore();

    AP.shuffleBtn.innerHTML = iconShuffle();
    AP.prevBtn.innerHTML = iconPrev();
    AP.playBtn.innerHTML = iconPlay();
    AP.nextBtn.innerHTML = iconNext();
    AP.repeatBtn.innerHTML = iconRepeat();

    AP.closeFx.innerHTML = iconBack();
    AP.closeSkin.innerHTML = iconBack();
    AP.downloadedOpen.innerHTML = iconSettings();
    AP.closeQueue.innerHTML = iconBack();
  }

  function bindEvents() {
    document.addEventListener("click", handleGlobalClick, true);

    const AP = window.__AP;

    AP.miniMain.addEventListener("click", openFullPlayer);
    AP.miniPlay.addEventListener("click", togglePlay);
    AP.miniQueue.addEventListener("click", openQueuePanel);

    AP.backdrop.addEventListener("click", closeAllPanels);
    AP.closeFull.addEventListener("click", closeFullPlayer);

    AP.openSkins.addEventListener("click", openSkinPanel);
    AP.share.addEventListener("click", shareCurrentTrack);

    AP.fxBtn.addEventListener("click", openFxPanel);
    AP.queueBtn.addEventListener("click", openQueuePanel);

    AP.closeFx.addEventListener("click", closeFxPanel);
    AP.closeSkin.addEventListener("click", closeSkinPanel);
    AP.closeQueue.addEventListener("click", closeQueuePanel);

    AP.fxSwitch.addEventListener("click", () => {
      fxEnabled = !fxEnabled;
      localStorage.setItem("audiory_player_fx_enabled", fxEnabled ? "1" : "0");
      AP.fxSwitch.classList.toggle("on", fxEnabled);
      applyFxPreset(currentFx);
    });

    AP.shuffleBtn.addEventListener("click", () => {
      shuffle = !shuffle;
      updateUi();
    });

    AP.repeatBtn.addEventListener("click", () => {
      if (repeatMode === "off") repeatMode = "all";
      else if (repeatMode === "all") repeatMode = "one";
      else repeatMode = "off";
      updateUi();
    });

    AP.prevBtn.addEventListener("click", playPrev);
    AP.playBtn.addEventListener("click", togglePlay);
    AP.nextBtn.addEventListener("click", playNext);

    AP.progress.addEventListener("input", () => {
      isSeeking = true;
    });

    AP.progress.addEventListener("change", () => {
      if (!audio.duration) return;
      const p = Number(AP.progress.value || 0);
      audio.currentTime = (p / 100) * audio.duration;
      isSeeking = false;
    });

    AP.downloadedOpen.addEventListener("click", () => {
      AP.downloadedGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    AP.likeBtn.addEventListener("click", () => alert("Like can be connected next."));
    AP.addBtn.addEventListener("click", () => alert("Playlist add can be connected next."));
    AP.downloadBtn.addEventListener("click", () => alert("Download can be connected next."));
    AP.moreBtn.addEventListener("click", () => alert("More options can be connected next."));

    audio.addEventListener("timeupdate", () => {
      if (!audio.duration || isSeeking) return;
      const percent = (audio.currentTime / audio.duration) * 100;
      AP.progress.value = String(percent);
      AP.currentTime.textContent = formatTime(audio.currentTime);
      AP.duration.textContent = formatTime(audio.duration);
    });

    audio.addEventListener("loadedmetadata", () => {
      AP.duration.textContent = formatTime(audio.duration || 0);
    });

    audio.addEventListener("play", () => {
      updateUi();
      updateCardButtons();
    });

    audio.addEventListener("pause", () => {
      updateUi();
      updateCardButtons();
    });

    audio.addEventListener("ended", () => {
      if (repeatMode === "one") {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        return;
      }
      if (repeatMode === "all" || currentIndex < queue.length - 1) {
        playNext();
      } else {
        updateUi();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) collectQueueFromPage();
    });
  }

  function handleGlobalClick(e) {
    const btn = e.target.closest(".play-fab, [data-play-btn]");
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    collectQueueFromPage();

    const card = btn.closest("[data-beat-id]");
    const beatId = card?.getAttribute("data-beat-id") || btn.getAttribute("data-beat-id") || "";
    if (!beatId) return;

    const idx = queue.findIndex((t) => String(t.id) === String(beatId));
    if (idx < 0) return;

    if (currentTrack && String(currentTrack.id) === String(beatId)) {
      togglePlay();
      return;
    }

    currentIndex = idx;
    loadTrack(queue[idx], true);
  }

  function collectQueueFromPage() {
    const cards = Array.from(document.querySelectorAll("[data-beat-id]"));
    const nextQueue = [];

    cards.forEach((card) => {
      const id = card.getAttribute("data-beat-id") || "";
      if (!id) return;

      const beat = findBeatById(id);
      const audioUrl =
        beat?.previewAudio ||
        beat?.audio ||
        card.querySelector(".play-fab")?.getAttribute("data-audio-url") ||
        card.querySelector("[data-play-btn]")?.getAttribute("data-audio-url") ||
        "";

      if (!audioUrl) return;

      const title =
        beat?.title ||
        card.querySelector(".t")?.textContent?.trim() ||
        card.querySelector(".home-title-clamp")?.textContent?.trim() ||
        "Untitled Beat";

      const producerName =
        beat?.producerName ||
        card.querySelector(".p")?.childNodes?.[0]?.textContent?.trim() ||
        card.querySelector(".home-producer-clamp")?.childNodes?.[0]?.textContent?.trim() ||
        "Unknown Producer";

      const artwork =
        beat?.artwork ||
        card.querySelector(".beat-cover img")?.getAttribute("src") ||
        "";

      const beatUrl =
        card.querySelector("[data-open-beat='1']")?.getAttribute("href") ||
        `/beat/?id=${encodeURIComponent(id)}`;

      nextQueue.push({
        id,
        title,
        producerId: beat?.producerId || "",
        producerName,
        artwork,
        audioUrl,
        beatUrl
      });
    });

    queue = nextQueue;
    renderQueue();
  }

  function findBeatById(id) {
    return (window.__LATEST_BEATS__ || []).find((b) => String(b?.id || "") === String(id)) || null;
  }

  async function loadTrack(track, autoplay = true) {
    if (!track?.audioUrl) return;

    currentTrack = track;
    audio.src = track.audioUrl;
    audio.currentTime = 0;

    try {
      await ensureFxGraph();
    } catch (e) {
      console.warn("[player] fx init skipped", e);
    }

    applyFxPreset(currentFx);
    updateUi();

    if (autoplay) {
      try {
        await audio.play();
        await countPlay(track);
      } catch (e) {
        console.error("[player] play error:", e);
      }
    }

    window.__AP.mini.classList.add("show");
    updateCardButtons();
    renderQueue();
  }

  async function togglePlay() {
    if (!currentTrack) {
      collectQueueFromPage();
      if (!queue.length) return;
      currentIndex = 0;
      await loadTrack(queue[0], true);
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        await countPlay(currentTrack);
      } catch (e) {
        console.error("[player] resume failed", e);
      }
    } else {
      audio.pause();
    }
  }

  function playNext() {
    if (!queue.length) return;

    if (shuffle && queue.length > 1) {
      let next = currentIndex;
      while (next === currentIndex) {
        next = Math.floor(Math.random() * queue.length);
      }
      currentIndex = next;
    } else {
      currentIndex = currentIndex + 1;
      if (currentIndex >= queue.length) currentIndex = 0;
    }

    loadTrack(queue[currentIndex], true);
  }

  function playPrev() {
    if (!queue.length) return;

    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    currentIndex = currentIndex - 1;
    if (currentIndex < 0) currentIndex = queue.length - 1;
    loadTrack(queue[currentIndex], true);
  }

  async function countPlay(track) {
    if (!track?.id) return;
    if (playedSession[track.id]) return;
    playedSession[track.id] = true;

    try {
      const FB = window.FB;
      if (FB?.db && typeof FB.doc === "function" && typeof FB.updateDoc === "function" && typeof FB.increment === "function") {
        await FB.updateDoc(
          FB.doc(FB.db, "beats", track.id),
          { plays: FB.increment(1), lastPlayedAt: Date.now() }
        );
      }
    } catch (e) {
      console.log("[player] play count failed", e);
    }

    try {
      if (typeof window.logAnalyticsEvent === "function") {
        await window.logAnalyticsEvent({
          producerId: track.producerId || "",
          type: "play",
          beatId: track.id
        });
      }
    } catch (e) {
      console.log("[player] analytics play failed", e);
    }
  }

  function updateUi() {
    const AP = window.__AP;
    const playing = currentTrack && !audio.paused;

    AP.miniPlay.innerHTML = playing ? iconPause() : iconPlay();
    AP.playBtn.innerHTML = playing ? iconPause() : iconPlay();

    AP.shuffleBtn.classList.toggle("ap-active", shuffle);
    AP.repeatBtn.classList.toggle("ap-active", repeatMode !== "off");

    AP.repeatBtn.innerHTML =
      repeatMode === "one" ? iconRepeatOne() : iconRepeat();

    AP.currentTime.textContent = formatTime(audio.currentTime || 0);
    AP.duration.textContent = formatTime(audio.duration || 0);
    AP.fxSwitch.classList.toggle("on", fxEnabled);
    AP.currentFxLabel.textContent = prettyFxLabel(currentFx);

    if (!currentTrack) return;

    AP.miniImg.src = currentTrack.artwork || "";
    AP.fullImg.src = currentTrack.artwork || "";
    AP.miniTitle.textContent = currentTrack.title || "Untitled Beat";
    AP.miniArtist.textContent = currentTrack.producerName || "Unknown Producer";
    AP.fullTitle.textContent = currentTrack.title || "Untitled Beat";
    AP.fullArtist.textContent = currentTrack.producerName || "Unknown Producer";
    AP.lyrics.href = currentTrack.beatUrl || "#";
  }

  function updateCardButtons() {
    document.querySelectorAll(".play-fab .playIcon, [data-play-btn] .playIcon").forEach((icon) => {
      const btn = icon.closest(".play-fab, [data-play-btn]");
      const card = btn?.closest("[data-beat-id]");
      const beatId = card?.getAttribute("data-beat-id") || btn?.getAttribute("data-beat-id") || "";
      const isCurrent = currentTrack && String(currentTrack.id) === String(beatId) && !audio.paused;
      icon.textContent = isCurrent ? "❚❚" : "▶";
    });
  }

  function openFullPlayer() {
    if (!currentTrack) return;
    const AP = window.__AP;
    AP.backdrop.classList.add("show");
    AP.sheet.classList.add("show");
    AP.fxPanel.classList.remove("show");
    AP.skinPanel.classList.remove("show");
    AP.queuePanel.classList.remove("show");
  }

  function closeFullPlayer() {
    const AP = window.__AP;
    AP.sheet.classList.remove("show");
    AP.backdrop.classList.remove("show");
  }

  function openFxPanel() {
    const AP = window.__AP;
    AP.backdrop.classList.add("show");
    AP.fxPanel.classList.add("show");
    AP.sheet.classList.remove("show");
    AP.skinPanel.classList.remove("show");
    AP.queuePanel.classList.remove("show");
  }

  function closeFxPanel() {
    window.__AP.fxPanel.classList.remove("show");
    window.__AP.backdrop.classList.remove("show");
  }

  function openSkinPanel() {
    const AP = window.__AP;
    AP.backdrop.classList.add("show");
    AP.skinPanel.classList.add("show");
    AP.sheet.classList.remove("show");
    AP.fxPanel.classList.remove("show");
    AP.queuePanel.classList.remove("show");
  }

  function closeSkinPanel() {
    window.__AP.skinPanel.classList.remove("show");
    window.__AP.backdrop.classList.remove("show");
  }

  function openQueuePanel() {
    const AP = window.__AP;
    AP.backdrop.classList.add("show");
    AP.queuePanel.classList.add("show");
    AP.sheet.classList.remove("show");
    AP.fxPanel.classList.remove("show");
    AP.skinPanel.classList.remove("show");
    renderQueue();
  }

  function closeQueuePanel() {
    window.__AP.queuePanel.classList.remove("show");
    window.__AP.backdrop.classList.remove("show");
  }

  function closeAllPanels() {
    const AP = window.__AP;
    AP.backdrop.classList.remove("show");
    AP.sheet.classList.remove("show");
    AP.fxPanel.classList.remove("show");
    AP.skinPanel.classList.remove("show");
    AP.queuePanel.classList.remove("show");
  }

  function renderQueue() {
    const AP = window.__AP;
    AP.queueList.innerHTML = queue.map((track, index) => `
      <button class="ap-queue-item ${currentTrack && String(track.id) === String(currentTrack.id) ? "active" : ""}" data-ap-queue-index="${index}">
        <div class="ap-queue-thumb">
          ${track.artwork ? `<img src="${track.artwork}" alt="">` : ""}
        </div>
        <div class="ap-queue-meta">
          <div class="ap-queue-title">${escapeHtml(track.title || "Untitled Beat")}</div>
          <div class="ap-queue-artist">${escapeHtml(track.producerName || "Unknown Producer")}</div>
        </div>
      </button>
    `).join("");

    AP.queueList.querySelectorAll("[data-ap-queue-index]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.getAttribute("data-ap-queue-index"));
        if (!Number.isFinite(index) || !queue[index]) return;
        currentIndex = index;
        loadTrack(queue[index], true);
        closeQueuePanel();
      });
    });
  }

  function renderFxCards() {
    const fxCards = [
      { key: "bass", title: "Bass boost", subtitle: "More low-end", tag: "B" },
      { key: "vocal", title: "Vocal boost", subtitle: "Clearer vocal range", tag: "V" },
      { key: "hifi", title: "Hi-Fi", subtitle: "Balanced shine", tag: "H" },
      { key: "wide", title: "Wide space", subtitle: "More stereo feel", tag: "W" }
    ];

    const more = ["normal", "classical", "rock", "pop", "acoustic", "live"];
    const AP = window.__AP;

    AP.fxGrid.innerHTML = fxCards.map((x) => `
      <button class="ap-fx-card ${currentFx === x.key ? "active" : ""}" data-ap-fx="${x.key}">
        <div class="ap-fx-icon">${x.tag}</div>
        <div class="ap-fx-title">${x.title}</div>
        <div class="ap-fx-sub">${x.subtitle}</div>
      </button>
    `).join("");

    AP.fxMore.innerHTML = more.map((x) => `
      <button class="ap-simple-btn" data-ap-fx="${x}">${prettyFxLabel(x)}</button>
    `).join("");

    document.querySelectorAll("[data-ap-fx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentFx = btn.getAttribute("data-ap-fx") || "normal";
        localStorage.setItem("audiory_player_fx", currentFx);
        renderFxCards();
        updateUi();
        applyFxPreset(currentFx);
      });
    });
  }

  function renderSkinCards() {
    const skins = [
      { key: "brown", title: "Original", cls: "" },
      { key: "graphite", title: "Graphite", cls: "graphite" },
      { key: "midnight", title: "Midnight", cls: "midnight" },
      { key: "sunset", title: "Sunset", cls: "sunset" },
      { key: "ocean", title: "Ocean", cls: "ocean" },
    ];

    const AP = window.__AP;
    const art = currentTrack?.artwork || "";

    AP.skinGrid.innerHTML = skins.map((skin) => `
      <button class="ap-skin-card ${currentSkin === skin.key ? "active" : ""}" data-ap-skin="${skin.key}">
        <div class="ap-skin-preview ${skin.cls}">
          <div class="ap-skin-art">${art ? `<img src="${art}" alt="">` : ""}</div>
        </div>
        <div class="ap-skin-title">${skin.title}</div>
      </button>
    `).join("");

    AP.downloadedGrid.innerHTML = skins
      .filter((x) => downloadedSkins.includes(x.key))
      .map((skin) => `
        <button class="ap-skin-card ${currentSkin === skin.key ? "active" : ""}" data-ap-skin="${skin.key}">
          <div class="ap-skin-preview ${skin.cls}">
            <div class="ap-skin-art">${art ? `<img src="${art}" alt="">` : ""}</div>
            <div class="ap-download-badge">${iconDownloadSmall()}</div>
          </div>
          <div class="ap-skin-title">${skin.title}</div>
        </button>
      `).join("");

    document.querySelectorAll("[data-ap-skin]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentSkin = btn.getAttribute("data-ap-skin") || "brown";
        localStorage.setItem("audiory_player_skin", currentSkin);
        applySkin(currentSkin);
        renderSkinCards();
      });
    });
  }

  function applySkin(key) {
    const root = document.documentElement;

    if (key === "graphite") {
      root.style.setProperty("--ap-bg", "#565b64");
      root.style.setProperty("--ap-bg-2", "#252932");
      root.style.setProperty("--ap-accent", "#45e0ff");
    } else if (key === "midnight") {
      root.style.setProperty("--ap-bg", "#0e1838");
      root.style.setProperty("--ap-bg-2", "#07101d");
      root.style.setProperty("--ap-accent", "#56d0ff");
    } else if (key === "sunset") {
      root.style.setProperty("--ap-bg", "#d16035");
      root.style.setProperty("--ap-bg-2", "#5d2411");
      root.style.setProperty("--ap-accent", "#ffd15a");
    } else if (key === "ocean") {
      root.style.setProperty("--ap-bg", "#1686d6");
      root.style.setProperty("--ap-bg-2", "#0f3156");
      root.style.setProperty("--ap-accent", "#82fff2");
    } else {
      root.style.setProperty("--ap-bg", "#8b5a3c");
      root.style.setProperty("--ap-bg-2", "#6f452f");
      root.style.setProperty("--ap-accent", "#23d7ff");
    }
  }

  async function ensureFxGraph() {
    if (fxReady) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    audioCtx = new Ctx();
    sourceNode = audioCtx.createMediaElementSource(audio);
    biquad1 = audioCtx.createBiquadFilter();
    biquad2 = audioCtx.createBiquadFilter();
    masterGain = audioCtx.createGain();

    sourceNode.connect(biquad1);
    biquad1.connect(biquad2);
    biquad2.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    masterGain.gain.value = 1;
    fxReady = true;
  }

  function applyFxPreset(name) {
    if (!fxReady || !biquad1 || !biquad2 || !masterGain) return;
    if (!fxEnabled) {
      biquad1.type = "peaking";
      biquad1.frequency.value = 1000;
      biquad1.gain.value = 0;
      biquad1.Q.value = 1;

      biquad2.type = "peaking";
      biquad2.frequency.value = 3000;
      biquad2.gain.value = 0;
      biquad2.Q.value = 1;

      masterGain.gain.value = 1;
      return;
    }

    switch (name) {
      case "bass":
        biquad1.type = "lowshelf";
        biquad1.frequency.value = 180;
        biquad1.gain.value = 8;
        biquad2.type = "peaking";
        biquad2.frequency.value = 2800;
        biquad2.gain.value = -1;
        biquad2.Q.value = 1;
        masterGain.gain.value = 1;
        break;
      case "vocal":
        biquad1.type = "peaking";
        biquad1.frequency.value = 1800;
        biquad1.gain.value = 5;
        biquad1.Q.value = 1.2;
        biquad2.type = "highshelf";
        biquad2.frequency.value = 5000;
        biquad2.gain.value = 2;
        masterGain.gain.value = 1;
        break;
      case "hifi":
        biquad1.type = "lowshelf";
        biquad1.frequency.value = 200;
        biquad1.gain.value = 3;
        biquad2.type = "highshelf";
        biquad2.frequency.value = 4200;
        biquad2.gain.value = 3;
        masterGain.gain.value = 1;
        break;
      case "wide":
        biquad1.type = "peaking";
        biquad1.frequency.value = 700;
        biquad1.gain.value = 1.5;
        biquad1.Q.value = 0.8;
        biquad2.type = "peaking";
        biquad2.frequency.value = 4500;
        biquad2.gain.value = 2.5;
        biquad2.Q.value = 0.8;
        masterGain.gain.value = 1;
        break;
      case "rock":
        biquad1.type = "lowshelf";
        biquad1.frequency.value = 160;
        biquad1.gain.value = 4;
        biquad2.type = "highshelf";
        biquad2.frequency.value = 4200;
        biquad2.gain.value = 4;
        masterGain.gain.value = 1;
        break;
      case "classical":
        biquad1.type = "peaking";
        biquad1.frequency.value = 900;
        biquad1.gain.value = 1;
        biquad2.type = "highshelf";
        biquad2.frequency.value = 6000;
        biquad2.gain.value = 2;
        masterGain.gain.value = 1;
        break;
      default:
        biquad1.type = "peaking";
        biquad1.frequency.value = 1000;
        biquad1.gain.value = 0;
        biquad1.Q.value = 1;
        biquad2.type = "peaking";
        biquad2.frequency.value = 3000;
        biquad2.gain.value = 0;
        biquad2.Q.value = 1;
        masterGain.gain.value = 1;
        break;
    }
  }

  function shareCurrentTrack() {
    if (!currentTrack?.beatUrl) return;
    const url = new URL(currentTrack.beatUrl, location.origin).toString();

    if (navigator.share) {
      navigator.share({
        title: currentTrack.title || "Audiory",
        text: currentTrack.producerName || "Audiory",
        url
      }).catch(() => {});
      return;
    }

    navigator.clipboard.writeText(url).then(() => {
      alert("Track link copied.");
    }).catch(() => {
      alert("Could not copy track link.");
    });
  }

  function prettyFxLabel(key) {
    const map = {
      normal: "Normal",
      bass: "Bass boost",
      vocal: "Vocal boost",
      hifi: "Hi-Fi",
      wide: "Wide space",
      classical: "Classical",
      rock: "Rock",
      pop: "Pop",
      acoustic: "Acoustic",
      live: "Live"
    };
    return map[key] || "Normal";
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function iconPlay() {
    return `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" stroke="none"/></svg>`;
  }

  function iconPause() {
    return `<svg viewBox="0 0 24 24"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>`;
  }

  function iconPrev() {
    return `<svg viewBox="0 0 24 24"><path d="M6 6v12"/><path d="M18 6 9.5 12 18 18z"/></svg>`;
  }

  function iconNext() {
    return `<svg viewBox="0 0 24 24"><path d="M18 6v12"/><path d="M6 6 14.5 12 6 18z"/></svg>`;
  }

  function iconShuffle() {
    return `<svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20l7-7"/><path d="M21 3l-7 7"/><path d="M16 21h5v-5"/><path d="M4 4l7 7"/></svg>`;
  }

  function iconRepeat() {
    return `<svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
  }

  function iconRepeatOne() {
    return `<svg viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M12 8v8"/><path d="M10.5 10.5 12 9l1.5 1.5"/></svg>`;
  }

  function iconHeart() {
    return `<svg viewBox="0 0 24 24"><path d="M20.8 8.6c0 5.1-8.8 10.8-8.8 10.8S3.2 13.7 3.2 8.6a4.8 4.8 0 0 1 8.3-3.3A4.8 4.8 0 0 1 20.8 8.6Z"/></svg>`;
  }

  function iconPlusSquare() {
    return `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
  }

  function iconDownload() {
    return `<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>`;
  }

  function iconDownloadSmall() {
    return `<svg viewBox="0 0 24 24" style="width:18px;height:18px;display:block;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>`;
  }

  function iconWave() {
    return `<svg viewBox="0 0 24 24"><path d="M3 12h2l2-5 4 10 3-7 2 2h5"/></svg>`;
  }

  function iconQueue() {
    return `<svg viewBox="0 0 24 24"><path d="M4 6h10"/><path d="M4 12h10"/><path d="M4 18h10"/><path d="M18 17l3-2-3-2"/><path d="M18 7l3-2-3-2"/></svg>`;
  }

  function iconMore() {
    return `<svg viewBox="0 0 24 24"><path d="M12 5h.01"/><path d="M12 12h.01"/><path d="M12 19h.01"/></svg>`;
  }

  function iconShare() {
    return `<svg viewBox="0 0 24 24"><path d="M14 10 21 3"/><path d="M21 3h-6"/><path d="M21 3v6"/><path d="M10 14 3 21"/><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/></svg>`;
  }

  function iconSparkles() {
    return `<svg viewBox="0 0 24 24"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"/><path d="m19 15 .8 2 .2.2 2 .8-2 .8-.2.2-.8 2-.8-2-.2-.2-2-.8 2-.8.2-.2.8-2Z"/></svg>`;
  }

  function iconSettings() {
    return `<svg viewBox="0 0 24 24"><path d="M12 3v2"/><path d="M12 19v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M3 12h2"/><path d="M19 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>`;
  }

  function iconChevronDown() {
    return `<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`;
  }

  function iconBack() {
    return `<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>`;
  }

})();
