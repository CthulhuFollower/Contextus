const CACHE_NAME = "contextus-app-shell-v9-first-critical";
const RELEASE = {
  version: "2026.06.09-first-critical",
  priority: "critical"
};
const APP_ENTRY = "./";
const INDEX_ENTRY = "./index.html";
const APP_SHELL = [
  APP_ENTRY,
  INDEX_ENTRY,
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./motor-estrella-offline.js",
  "./anomaly/black-hole-object.js",
  "./anomaly/schwarzschild-lut-v1.bin",
  "./vendor/three/three.module.js",
  "./vendor/three/three.core.js"
];

function toAbsoluteUrl(url) {
  return new URL(url, self.location.href).href;
}

async function getCachedAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const fallbackUrls = [APP_ENTRY, INDEX_ENTRY].map(toAbsoluteUrl);

  for (const url of fallbackUrls) {
    const cached = await cache.match(url);
    if (cached) return cached;
  }

  return new Response(
    "<!doctype html><title>Contextus offline</title><p>Contextus no terminó de guardarse para uso sin conexión. Abre la aplicación una vez con internet y espera unos segundos antes de desconectarte.</p>",
    {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}

async function cacheNavigation(request, response) {
  if (!response || response.status !== 200 || response.type === "opaque") return;

  const cache = await caches.open(CACHE_NAME);
  await Promise.all([
    cache.put(request, response.clone()),
    cache.put(toAbsoluteUrl(APP_ENTRY), response.clone()),
    cache.put(toAbsoluteUrl(INDEX_ENTRY), response.clone())
  ]);
}

async function handleNavigation(request, event) {
  try {
    const response = await fetch(request);
    event.waitUntil(cacheNavigation(request, response.clone()));
    return response;
  } catch (error) {
    return getCachedAppShell();
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== "opaque") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map(toAbsoluteUrl)))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request, event));
    return;
  }

  event.respondWith(handleAsset(request));
});

self.addEventListener("message", (event) => {
  const message = event.data || {};

  if (message.type === "GET_RELEASE") {
    event.ports?.[0]?.postMessage({ release: RELEASE });
    return;
  }

  if (message.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
