// sg/unihub — offline app-shell caching (stale-while-revalidate)
//
// Strategy: every same-origin GET request is answered from the cache
// instantly if we have it (so the page loads fast, or at all, on a bad or
// missing connection), while a fresh copy is fetched in the background and
// used to update the cache for next time.
//
// Deliberately no version suffix on the cache name (no "sgunihub-shell-v3"
// to remember to bump on every deploy): the cache is self-healing because
// every fetch already overwrites its entry with whatever the network just
// returned. The one-time "install" step below only seeds the shell so the
// very first offline visit still has something to show.
//
// (An earlier version of this also diffed the cached and fresh copies as
// whole responses and pushed a "new version available" toast to the page
// whenever they differed. That kept false-firing on the real deployment —
// whitespace, ETags, anything — so it, and the toast, were removed rather
// than shipped broken.)
//
// What's below instead: for the main document only, compare one exact,
// already-trusted string — the footer's version marker — between the
// entry that was in the cache before this fetch and the fresh copy that
// just came back. A background refetch after a long-stale cache (a
// visitor who hasn't been back in weeks) can take a while to actually
// land, so rather than make the page guess how long to wait, this posts a
// message to every open tab the moment a real version change is
// confirmed; index.html listens and reloads itself exactly once per
// version (see its own Service Worker section for that guard).

const CACHE_NAME = 'sgunihub-shell';

const APP_SHELL = [
  './',
  './index.html',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon-180.png',
];

const versionIn = (text) => {
  const m = typeof text === 'string' && text.match(/Eloori Interactive · (v[\d.]+)/);
  return m ? m[1] : undefined;
};

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
  let reqUrl;
  try { reqUrl = new URL(req.url); } catch (e) { return; }
  if (req.method !== 'GET' || reqUrl.origin !== self.location.origin) {
    return;
  }

  // The main document is the only file carrying the footer version marker
  // — only it is worth reading back out and comparing.
  const isMainDoc = reqUrl.pathname === '/' || reqUrl.pathname.endsWith('/index.html');

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);

      // cache:'reload' bypasses the browser's own HTTP cache so this always
      // reaches the real network, keeping the cached copy genuinely fresh
      // rather than possibly re-storing an already-stale response.
      const revalidateReq = new Request(req.url, {
        headers: req.headers,
        credentials: req.credentials,
        redirect: 'follow',
        cache: 'reload',
      });

      const networkFetch = fetch(revalidateReq).then(async (fresh) => {
        if (fresh && fresh.ok) {
          if (isMainDoc) {
            try {
              const oldVersion = cached ? versionIn(await cached.clone().text()) : undefined;
              const newVersion = versionIn(await fresh.clone().text());
              if (oldVersion && newVersion && oldVersion !== newVersion) {
                const clientsList = await self.clients.matchAll({ type: 'window' });
                clientsList.forEach((c) => c.postMessage({ type: 'sgunihub-new-version', version: newVersion }));
              }
            } catch (e) { /* comparison is a nice-to-have, never block caching on it */ }
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
