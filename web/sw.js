// Service worker: toont pushmeldingen en houdt de app-schil offline beschikbaar.
const VERSIE = "tvgids-v11";
const SCHIL = ["./", "index.html", "app.js", "style.css", "config.js", "themas.json", "icoon-192.png", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSIE).then(c => c.addAll(SCHIL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSIE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Netwerk eerst (de gids verandert elke dag), cache als terugval.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then(c => c.put(e.request, kopie)); }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Zapper", {
    body: d.body || "",
    icon: "icoon-192.png",
    badge: "icoon-192.png",
    tag: d.tag || "tvgids",
    data: { url: d.url || "./#vanavond" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const doel = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope)) { w.navigate(doel); return w.focus(); }
    return self.clients.openWindow(doel);
  }));
});
