/* ═══════════════════════════════════════════════════════════
   SERVICE WORKER — پرونده‌یار
   نسخه: v14
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'parvandeh-v14';
const CACHE_STATIC  = CACHE_VERSION + '-static';
const CACHE_CDN     = CACHE_VERSION + '-cdn';
const CACHE_RUNTIME = CACHE_VERSION + '-runtime';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json'
];

const OPTIONAL_PRECACHE = [
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

const NETWORK_ONLY_HOSTS = [
  'supabase.co',
  'supabase.in',
  'ksqbvxucepclryqsbmmz.supabase.co',
  'api.supabase.com'
];

const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com'
];

const NETWORK_TIMEOUT = 5000;

/* ═══════════════════════════════════════════════════════════
   INSTALL
   ═══════════════════════════════════════════════════════════ */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing:', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Precache skip:', url, err.message);
          })
        )
      );
      await Promise.all(
        OPTIONAL_PRECACHE.map((url) => cache.add(url).catch(() => {}))
      );
      console.log('[SW] Installed — waiting');
    })()
  );
});

/* ═══════════════════════════════════════════════════════════
   ACTIVATE
   ═══════════════════════════════════════════════════════════ */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating:', CACHE_VERSION);

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const valid = [CACHE_STATIC, CACHE_CDN, CACHE_RUNTIME];
      await Promise.all(
        keys
          .filter((k) => !valid.includes(k))
          .map((k) => {
            console.log('[SW] Delete old cache:', k);
            return caches.delete(k);
          })
      );

      await self.clients.claim();

      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
      clients.forEach((client) => {
        try {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: CACHE_VERSION,
            time: Date.now()
          });
        } catch (e) {}
      });
    })()
  );
});

/* ═══════════════════════════════════════════════════════════
   FETCH
   ═══════════════════════════════════════════════════════════ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // Supabase → Network-only
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
    return;
  }

  // ناوبری (HTML) → Network-first با no-store
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(navigationHandler(req));
    return;
  }

  // CDN / Fonts → Stale-while-revalidate
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(staleWhileRevalidate(req, CACHE_CDN));
    return;
  }

  // فایل‌های استاتیک → Cache-first + revalidate
  if (
    url.origin === self.location.origin &&
    /\.(?:png|jpg|jpeg|svg|ico|webp|gif|css|js|woff2?|ttf|eot)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirstRevalidate(req, CACHE_STATIC));
    return;
  }

  // بقیه → Stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req, CACHE_RUNTIME));
});

/* ═══════════════════════════════════════════════════════════
   استراتژی ناوبری — HTML همیشه تازه
   ═══════════════════════════════════════════════════════════ */
async function navigationHandler(request) {
  const cache = await caches.open(CACHE_STATIC);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);

    let response;
    try {
      // ✅ cache: 'no-store' — HTTP cache مرورگر رو دور می‌زنه
      response = await fetch(request, {
        signal: controller.signal,
        cache: 'no-store'
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (response && response.status === 200 && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
      if (request.url.includes('/') && !request.url.includes('.')) {
        cache.put('./index.html', response.clone()).catch(() => {});
      }
    }
    return response;

  } catch (err) {
    console.log('[SW] Offline → serve from cache:', request.url);

    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;

    return offlinePage();
  }
}

/* ═══════════════════════════════════════════════════════════
   استراتژی‌های کمکی
   ═══════════════════════════════════════════════════════════ */
async function cacheFirstRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('', { status: 404 });
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        try {
          cache.put(request, response.clone()).catch(() => {});
        } catch (e) {}
      }
      return response;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || new Response('', { status: 503 });
}

function offlinePage() {
  const html =
    '<!DOCTYPE html><html lang="fa" dir="rtl"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>آفلاین</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Vazirmatn,Tahoma,sans-serif;display:flex;align-items:center;' +
    'justify-content:center;min-height:100vh;background:linear-gradient(160deg,#0a0f1e,#1a1f3a);' +
    'color:#fff;text-align:center;padding:24px}' +
    '.box{max-width:380px}' +
    '.ico{font-size:72px;line-height:1;margin-bottom:20px}' +
    'h1{font-size:22px;font-weight:800;margin-bottom:10px}' +
    'p{color:#94a3b8;line-height:1.9;font-size:13.5px;margin-bottom:24px}' +
    'button{background:linear-gradient(135deg,#fbbf24,#d97706);color:#0f172a;' +
    'border:none;padding:12px 28px;border-radius:12px;font-weight:800;' +
    'font-family:inherit;font-size:14px;cursor:pointer}' +
    '</style></head><body><div class="box">' +
    '<div class="ico">📡</div>' +
    '<h1>آفلاین هستید</h1>' +
    '<p>اتصال اینترنت خود را بررسی کنید.</p>' +
    '<button onclick="location.reload()">🔄 تلاش دوباره</button>' +
    '</div></body></html>';

  return new Response(html, {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/* ═══════════════════════════════════════════════════════════
   MESSAGES
   ═══════════════════════════════════════════════════════════ */
self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;
  const port = event.ports && event.ports[0];
  const reply = (data) => { if (port) port.postMessage(data); };

  switch (event.data.type) {
    case 'SKIP_WAITING':
      console.log('[SW] SKIP_WAITING — activating now');
      self.skipWaiting();
      reply({ ok: true });
      break;

    case 'CLEAR_CACHE':
      event.waitUntil(
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => reply({ success: true, version: CACHE_VERSION }))
      );
      break;

    case 'PING':
      reply({ pong: true, version: CACHE_VERSION, time: Date.now() });
      break;

    case 'GET_VERSION':
      reply({ version: CACHE_VERSION });
      break;

    case 'FORCE_UPDATE':
      event.waitUntil(
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => reply({ success: true }))
      );
      break;

    case 'GET_CACHE_STATS':
      event.waitUntil(
        caches.keys().then(async (keys) => {
          const stats = {};
          for (const key of keys) {
            try {
              const cache = await caches.open(key);
              const reqs = await cache.keys();
              stats[key] = reqs.length;
            } catch (e) {
              stats[key] = 0;
            }
          }
          reply({ version: CACHE_VERSION, stats });
        })
      );
      break;

    case 'SYNC_NOW':
      reply({ ack: true, version: CACHE_VERSION });
      break;
  }
});

/* ═══════════════════════════════════════════════════════════
   خطاها
   ═══════════════════════════════════════════════════════════ */
self.addEventListener('error', (e) => {
  console.error('[SW] Error:', e.message);
});

self.addEventListener('unhandledrejection', (e) => {
  console.error('[SW] Rejection:', e.reason);
});

console.log('[SW] Loaded:', CACHE_VERSION);