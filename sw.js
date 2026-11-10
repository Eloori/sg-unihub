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
  './arriving.html',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon-180.png',
];

const versionIn = (text) => {
  const m = typeof text === 'string' && text.match(/Eloori Interactive · (v[\d.]+)/);
  return m ? m[1] : undefined;
};

// Pages that show the footer version and reload themselves on a new one.
const VERSIONED_PAGES = ['./', './arriving.html'];
const isVersionedPage = (path) =>
  path === '/' || path.endsWith('/index.html') || path.endsWith('/arriving.html') || path.endsWith('/arriving');

async function refreshOtherPages(cache, changedPath) {
  await Promise.all(VERSIONED_PAGES.map(async (rel) => {
    const url = new URL(rel, self.registration.scope);
    const samePage = url.pathname === changedPath || (url.pathname === '/' && changedPath.endsWith('/index.html'));
    if (samePage) return;
    try {
      const res = await fetch(new Request(url.href, { cache: 'reload' }));
      if (res && res.ok) await cache.put(url.href, res);
    } catch (e) { /* offline: that page updates on its next visit */ }
  }));
}

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

  // The pages carrying the footer version marker (dashboard and Arriving &
  // Housing share one site version) are the only ones worth comparing.
  const isMainDoc = isVersionedPage(reqUrl.pathname);

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      // Read the cached copy's text right away: once the cached response is
      // handed to the page below, its body is consumed and can't be cloned.
      const cachedTextP = (isMainDoc && cached) ? cached.clone().text().catch(() => undefined) : Promise.resolve(undefined);

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
          let newVersion, changed = false;
          if (isMainDoc) {
            try {
              const oldVersion = versionIn(await cachedTextP);
              newVersion = versionIn(await fresh.clone().text());
              changed = !!(oldVersion && newVersion && oldVersion !== newVersion);
            } catch (e) { /* comparison is a nice-to-have, never block caching on it */ }
          }
          // Store first, then tell the tabs: a tab that reloads on the
          // message must already get the new copy from the cache.
          await cache.put(req, fresh.clone());
          if (changed) {
            // Bring the other versioned page up to date too, so an open
            // dashboard tab and an open Arriving tab switch together.
            await refreshOtherPages(cache, reqUrl.pathname);
            const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
            clientsList.forEach((c) => c.postMessage({ type: 'sgunihub-new-version', version: newVersion }));
          }
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
