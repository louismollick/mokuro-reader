/// <reference types="@sveltejs/kit" />
import { build, files, version } from '$service-worker';

// Create a unique cache name for this deployment
const CACHE = `cache-${version}`;

const ASSETS = [
  ...build, // the app itself
  ...files // everything in `static`
];

self.addEventListener('install', (event) => {
  // Create a new cache and add all files to it
  async function addFilesToCache() {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  }

  event.waitUntil(addFilesToCache());

  // Don't call skipWaiting() here - we want to show an "Update Available" banner
  // and let the user choose when to update. skipWaiting will be triggered via
  // a message from the client when the user clicks "Update".
});

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  // Remove previous cached data from disk
  async function deleteOldCaches() {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
  }

  event.waitUntil(deleteOldCaches());

  // Take control of all clients immediately (don't wait for reload)
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // ignore POST requests etc
  if (event.request.method !== 'GET') return;

  async function respond() {
    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;

    // Never intercept Vite dev server module URLs.
    // A stale SW controlling localhost can otherwise cache/serve invalid module responses.
    const isViteDevModuleRequest =
      url.pathname.startsWith('/node_modules/.vite/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname.startsWith('/@vite/') ||
      url.pathname.startsWith('/@fs/') ||
      url.pathname.startsWith('/@id/') ||
      url.pathname.startsWith('/src/');
    if (isViteDevModuleRequest) {
      return fetch(event.request);
    }

    // Don't apply offline fallback/caching strategy to cross-origin requests.
    // This avoids rewriting external fetch errors (e.g. GitHub dictionary downloads)
    // into synthetic 503 Offline responses.
    if (!isSameOrigin) {
      try {
        return await fetch(event.request);
      } catch {
        return new Response('Network error', { status: 502, statusText: 'Bad Gateway' });
      }
    }

    // API endpoints should be network-only to avoid caching large binary responses.
    if (url.pathname.startsWith('/api/')) {
      try {
        return await fetch(event.request);
      } catch {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      }
    }

    const cache = await caches.open(CACHE);

    // `build`/`files` can always be served from the cache
    if (ASSETS.includes(url.pathname)) {
      const cachedResponse = await cache.match(url.pathname);
      if (cachedResponse) {
        return cachedResponse;
      }
      // If not in cache, fall through to network
    }

    // for everything else, try the network first, but
    // fall back to the cache if we're offline
    try {
      const response = await fetch(event.request);

      // Only cache if:
      // 1. Response is successful (status 200)
      // 2. It's not a Google Drive API request
      // 3. It's not a large file (>10MB)
      // 4. It's not a Vite module request
      if (response.status === 200) {
        if (isViteDevModuleRequest) {
          return response;
        }
        // Check response size before caching
        const contentLength = response.headers.get('content-length');
        const sizeInMB = contentLength ? parseInt(contentLength) / (1024 * 1024) : 0;

        // Only cache if smaller than 10MB
        if (sizeInMB < 10) {
          cache.put(event.request, response.clone());
        }
      }

      return response;
    } catch {
      const cachedResponse = await cache.match(event.request);
      // Return cached response or a basic offline response
      return (
        cachedResponse ||
        new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
      );
    }
  }

  event.respondWith(respond());
});
