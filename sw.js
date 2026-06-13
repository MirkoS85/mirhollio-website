const CACHE_NAME = "mirsflr-shell-v141";
const APP_SHELL = [
  "/",
  "/ops/",
  "/ftso/",
  "/validator/",
  "/epochs/",
  "/addresses/",
  "/stats/",
  "/performance/",
  "/assets/operator.css?v=pre-reg-value-fix",
  "/assets/operator.css?v=validator-copy",
  "/assets/live-refresh.css?v=pre-reg-pill-size-1",
  "/assets/operator.js?v=pre-reg-pill-size-1",
  "/assets/live-refresh.js?v=pre-reg-pill-size-1",
  "/assets/ops.css?v=ops-10",
  "/assets/ops.js?v=ops-10",
  "/assets/pwa.js?v=pwa-install-1",
  "/app.webmanifest",
  "/ops/app.webmanifest",
  "/logo.png",
  "/apple-touch-icon-full.png",
  "/flare-icon.png",
  "/app-icon-full-192.png",
  "/app-icon-full-512.png",
  "/favicon-32x32.png",
  "/favicon-64x64.png",
  "/background.jpg",
  "/og-image.png"
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
