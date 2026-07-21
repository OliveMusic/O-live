/* 파일을 갱신했는데 화면이 그대로라면 대개 이 파일 때문이다.
   예전 방식(캐시 우선)은 캐시에 있으면 네트워크를 아예 보지 않아
   새로 올린 index.html이 영영 반영되지 않았다.

   지금 방식
   - HTML: 항상 네트워크 먼저. 실패했을 때만 캐시(오프라인 대비).
   - 그 외(아이콘 등): 캐시 먼저 쓰되 뒤에서 조용히 갱신.
   앱을 수정하면 아래 버전만 올리면 이전 캐시가 정리된다. */
const VERSION = 'v40';
const CACHE = 'practice-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();            // 새 워커를 즉시 대기 해제
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())   // 열려 있는 탭까지 새 워커가 넘겨받는다
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const isHTML =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // 네트워크 우선 — 갱신이 바로 반영된다
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 그 밖의 파일: 캐시로 즉시 응답하고, 뒤에서 새 버전을 받아둔다
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});

// 페이지에서 강제 갱신을 요청할 수 있게
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
