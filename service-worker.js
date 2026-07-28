/* 파일을 갱신했는데 화면이 그대로라면 대개 이 파일 때문이다.
   예전 방식(캐시 우선)은 캐시에 있으면 네트워크를 아예 보지 않아
   새로 올린 index.html이 영영 반영되지 않았다.

   지금 방식
   - HTML: 항상 네트워크 먼저. 실패했을 때만 캐시(오프라인 대비).
   - 그 외(아이콘 등): 캐시 먼저 쓰되 뒤에서 조용히 갱신.
   앱을 수정하면 아래 버전만 올리면 이전 캐시가 정리된다. */
const VERSION = 'v100';
const CACHE = 'olive-practice-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './about.html',
  './privacy.html',
  './terms.html',
  './info.css',
  './og.png',
  './manifest.json',
  './cloud-config.js?v=92',
  './cloud-sync.js?v=97',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) =>
            k !== CACHE &&
            (k.startsWith('practice-') || k.startsWith('olive-practice-'))
          )
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())   // 열려 있는 탭까지 새 워커가 넘겨받는다
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Supabase 인증·REST 응답과 Google 프로필 등 사용자별 데이터는 브라우저
  // 네트워크 계층으로 곧바로 보낸다. 서비스 워커 캐시에 절대 저장하지 않는다.
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // OAuth의 ?code= 같은 일회성 값이 캐시 키에 남지 않게 문서 URL만 쓴다.
    const documentUrl = new URL(req.url);
    documentUrl.search = '';
    documentUrl.hash = '';
    const cacheKey = documentUrl.toString();

    // 네트워크 우선 — 갱신이 바로 반영된다
    e.respondWith(
      fetch(req)
        .then(async (res) => {
          if (res.ok) {
            const copy = res.clone();
            const cache = await caches.open(CACHE);
            await cache.put(cacheKey, copy);
          }
          return res;
        })
        .catch(() => caches.match(cacheKey).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 그 밖의 파일: 캐시로 즉시 응답하고, 뒤에서 새 버전을 받아둔다
  const cachedPromise = caches.match(req);
  const networkPromise = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        const copy = res.clone();
        const cache = await caches.open(CACHE);
        await cache.put(req, copy);
      }
      return res;
    });
  e.waitUntil(networkPromise.catch(() => {}));
  e.respondWith(
    cachedPromise.then((cached) => cached || networkPromise)
  );
});

// 페이지에서 강제 갱신을 요청할 수 있게
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
