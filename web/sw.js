const KEY = "sctl-v15";
const FILES = [
  "./",
  "./index.html",
  "./lib/boot.css",
  "./app.css",
  "./cfg.js",
  "./ble.js",
  "./sec.js",
  "./pb.js",
  "./app.js",
  "./app.json",
  "./ico.svg",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(KEY).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== KEY).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ev) => {
  if (ev.request.method !== "GET") return;
  const url = new URL(ev.request.url);
  if (url.origin !== self.location.origin) return;
  ev.respondWith(
    caches.match(ev.request).then((hit) => {
      if (hit) return hit;
      return fetch(ev.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(KEY).then((cache) => cache.put(ev.request, copy));
        }
        return res;
      });
    }).catch(() => {
      if (ev.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }),
  );
});
