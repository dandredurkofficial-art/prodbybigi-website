self.addEventListener("install", (e) => {
  console.log("Service Worker installed");
});

self.addEventListener("fetch", (e) => {
  // basic pass-through (safe for now)
});
