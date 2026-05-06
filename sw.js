const CACHE_NAME = "mirsflr-shell-v13";
const APP_SHELL = [
  "/",
  "/stats/",
  "/epochs/",
  "/addresses/",
  "/performance/",
  "/assets/operator.css?v=pre-reg-value-fix",
  "/assets/operator.css?v=validator-copy",
  "/assets/live-refresh.css?v=soft-live-v16",
  "/assets/operator.js?v=pre-reg-value-fix",
  "/assets/operator.js?v=validator-copy",
  "/assets/live-refresh.js?v=soft-live-v16",
  "/assets/pwa.js?v=installable-1",
  "/app.webmanifest",
  "/logo.png",
  "/flare-icon.png",
  "/app-icon-192.png",
  "/app-icon-512.png",
  "/favicon-32x32.png",
  "/favicon-64x64.png",
  "/background.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match(url.pathname, { ignoreSearch: true })) ||
            caches.match("/")
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
        return response;
      });
    })
  );
});
