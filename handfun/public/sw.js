/**
 * 서비스 워커.
 *
 * 앱 껍데기(HTML/CSS/JS)만 캐시해서 오프라인에서도 화면이 뜨게 한다.
 * 인식·가사 API 응답은 항상 최신이어야 하므로 캐시하지 않는다.
 */

const CACHE = 'handfun-shell-v1';

const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/mic.js',
  '/fp-worker.js',
  '/recorder-worklet.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/shared/lrc.js',
  '/shared/sync-clock.js',
  '/shared/listen-scheduler.js',
  '/shared/fingerprint.js',
  '/shared/fingerprint-index.js',
  '/shared/dsp.js',
  '/shared/fft.js',
  '/shared/codec.js',
  '/shared/pronounce/index.js',
  '/shared/pronounce/hangul.js',
  '/shared/pronounce/ko-roman.js',
  '/shared/pronounce/en-hangul.js',
  '/shared/pronounce/ja-hangul.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // 한 파일이라도 없으면 전체가 실패하므로 개별로 담는다
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 항상 네트워크에서

  // 캐시 우선, 없으면 네트워크에서 받아 캐시에 넣는다
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
