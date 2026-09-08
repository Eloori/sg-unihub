// sg/unihub — offline app-shell caching (stale-while-revalidate)
//
// Strategy: every same-origin GET request is answered from the cache
// instantly if we have it (so the page loads fast, or at all, on a bad or
// missing connection), while a fresh copy is fetched in the background and
// used to update the cache for next time. If that background fetch turns
// up content that differs from what was cached, every open tab is told via
// postMessage so the page can offer a "reload for the latest version" nudge
// instead of silently serving stale content forever.
//
// Deliberately no version suffix on the cache name (no "sgunihub-shell-v3"
// to remember to bump on every deploy): the cache is self-healing because
// every fetch already overwrites its entry with whatever the network just
// returned. The one-time "install" step below only seeds the shell so the
// very first offline visit still has something to show.

const CACHE_NAME = 'sgunihub-shell';

const APP_SHELL = [
  './',
  './index.html',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon-180.png',
];

// Set once a background revalidation finds the server has newer content
// than what's cached. Pages can't just rely on the postMessage broadcast
// fired at that moment — a page that's mid-navigation right then (the
// common case: this very often gets set by the revalidation of the page's
// own just-served request) may not have its message listener attached yet,
// and a postMessage sent before a listener exists is simply lost. So this
// flag also acts as a small memory: any page can ask "is there an update
// I might have missed?" via the 'sgunihub-check-update' message below.
let pendingUpdate = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs. Cross-origin requests (Google Fonts,
  // GoatCounter analytics, the various external tool links) are left
  // untouched — they're non-essential to the shell, fonts already fall
  // back to a system stack in the page's CSS, and intercepting someone
  // else's origin is more likely to cause surprises than help.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      // Read the cached body for comparison right away, before `cached` is
      // handed back below as the actual HTTP response — once a Response's
      // body starts being consumed by the browser (which can happen as
      // soon as it's returned from respondWith, well before the network
      // fetch below finishes), clone()ing it later throws ("body is
      // already used"), silently breaking the diff check.
      const cachedTextPromise = cached ? cached.clone().text() : null;

      // cache:'reload' bypasses the browser's own HTTP cache so this always
      // reaches the real network — with the default caching mode, this
      // revalidation fetch could otherwise be silently satisfied from the
      // browser's HTTP cache (e.g. via a 304) and compare stale content
      // against stale content, never noticing a real change on the server.
      const revalidateReq = new Request(req.url, {
        headers: req.headers,
        credentials: req.credentials,
        redirect: 'follow',
        cache: 'reload',
      });

      const networkFetch = fetch(revalidateReq).then(async (fresh) => {
        // Only cache genuinely fresh, valid responses.
        if (fresh && fresh.ok) {
          // Two independent clones: one body gets read for the text
          // comparison, the other gets stored via cache.put — each
          // Response body can only be consumed once, and `fresh` itself is
          // left untouched in case it's the one returned below (when there
          // was nothing cached yet to compare against).
          if (cachedTextPromise) {
            const [cachedText, freshText] = await Promise.all([
              cachedTextPromise,
              fresh.clone().text(),
            ]);
            if (cachedText !== freshText) {
              notifyClientsOfUpdate();
            }
          }
          cache.put(req, fresh.clone());
        }
        return fresh;
      }).catch(() => undefined);

      // Serve the cached copy immediately if we have one; otherwise wait
      // on the network (this covers the very first visit, before install
      // has finished seeding the cache).
      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }
      const fresh = await networkFetch;
      return fresh || Response.error();
    })
  );
});

async function notifyClientsOfUpdate() {
  pendingUpdate = true;
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'sgunihub-update-available' });
  });
}

// Lets a freshly-loaded page ask "did I miss an update notice?" — closing
// the race described above. A page pings this shortly after load, once its
// own message listener is safely attached, and gets an immediate answer
// instead of hoping a broadcast timed itself perfectly.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sgunihub-check-update' && event.ports[0]) {
    event.ports[0].postMessage({ pending: pendingUpdate });
  }
});
