// AUDIORY SERVICE WORKER (FAST CACHE)

const CACHE_NAME = "audiory-cache-v1";

const STATIC_ASSETS = [

  "/",
  "/index.html",

  "/css/global.css",
  "/css/cart.css",

  "/js/firebase.js",
  "/js/player.js",
  "/js/cart.js",
  "/js/cart-ui.js",
  "/js/license-modal.js",
  "/js/menu.js",
  "/js/performance.js"

];


/* =========================
INSTALL
========================= */

self.addEventListener("install", event => {

  event.waitUntil(

    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))

  );

  self.skipWaiting();

});


/* =========================
ACTIVATE
========================= */

self.addEventListener("activate", event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys.map(key => {

          if(key !== CACHE_NAME){
            return caches.delete(key);
          }

        })

      );

    })

  );

  self.clients.claim();

});


/* =========================
FETCH (CACHE FIRST)
========================= */

self.addEventListener("fetch", event => {

  const req = event.request;

  // ignore firebase api calls
  if(req.url.includes("firestore.googleapis.com")) return;
  if(req.url.includes("googleapis.com")) return;

  event.respondWith(

    caches.match(req)
      .then(res => {

        return res || fetch(req)
          .then(fetchRes => {

            const clone = fetchRes.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(req, clone));

            return fetchRes;

          });

      })

  );

});
