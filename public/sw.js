/* BookmarkHub service worker. The server replaces the version marker on every release,
   so a new deploy always gets a new cache and old caches are removed. */
const VERSION = "__BMH_VERSION__";
const CACHE = `bmh-${VERSION}`;
const SCOPE = self.registration.scope; // install path (root or subfolder), never hard-coded
const SHELL = ["", "manifest.webmanifest", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "logo.png", "theme-init.js"].map((p) => new URL(p, SCOPE).toString());

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("bmh-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  const rel = url.href.slice(SCOPE.length);
  if (rel.startsWith("api/") || rel.startsWith("healthz") || rel === "sw.js") return; // live data is never cached
  if (req.mode === "navigate") {
    // network first, offline fallback to the cached app shell
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(SHELL[0], copy)); return r; }).catch(() => caches.match(SHELL[0])));
    return;
  }
  // static files: cache first (hashed asset names change with every build)
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && (rel.startsWith("assets/") || SHELL.includes(url.href))) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
