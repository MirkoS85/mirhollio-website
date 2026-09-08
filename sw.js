const CACHE_NAME = "mirhollio-core-shell-v221";
const APP_SHELL = [
  "/",
  "/ops/",
  "/ftso/",
  "/validator/",
  "/epochs/",
  "/addresses/",
  "/stats/",
  "/performance/",
  "/assets/operator.css?v=core-24",
  "/assets/live-refresh.css?v=core-24",
  "/assets/operator.js?v=core-24",
  "/assets/live-refresh.js?v=core-24",
  "/assets/ops.css?v=core-24",
  "/assets/ops.js?v=core-14",
  "/ops/status.example.json",
  "/data/ftso-delegations.json",
  "/data/network-position.json",
  "/data/watch-status.json",
  "/assets/pwa.js?v=core-24",
  "/assets/core-home.js?v=core-24",
  "/app.webmanifest",
  "/ops/app.webmanifest",
  "/assets/brand-mark.jpg?v=core-24",
  "/logo.png?v=2",
  "/apple-touch-icon-full.png",
  "/flare-icon.png",
  "/app-icon-full-192.png",
  "/app-icon-full-512.png",
  "/favicon-32x32.png?v=2",
  "/favicon-64x64.png?v=2",
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

  if (url.pathname.startsWith("/data/")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          return (await caches.match(request, { ignoreSearch: true })) || caches.match(url.pathname, { ignoreSearch: true });
        })
    );
    return;
  }

  // Assets were pure cache-first, so anything that made it into the cache was
  // served forever until CACHE_NAME changed. A bad or half-updated entry could
  // therefore stick permanently, and the only cure was clearing site data by
  // hand. Serve the cached copy immediately, but always refresh it in the
  // background so the next load self-corrects.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(error => {
          // With nothing cached there is no answer to give, so let the browser
          // surface its own network error rather than an undefined response.
          if (cached) return cached;
          throw error;
        });
      return cached || network;
    })
  );
});
