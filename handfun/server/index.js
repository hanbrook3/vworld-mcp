/**
 * HandFun 서버.
 *
 * 외부 패키지 없이 node:http 만 사용한다. (npm install 없이 바로 실행된다)
 *
 *   GET    /api/health          상태
 *   GET    /api/config          클라이언트 기능 플래그
 *   GET    /api/tracks          내 카탈로그 목록
 *   POST   /api/tracks          곡 등록 (브라우저에서 뽑은 지문 + 가사)
 *   GET    /api/tracks/:id      곡 상세 (가사 포함)
 *   PATCH  /api/tracks/:id      메타/가사 수정
 *   DELETE /api/tracks/:id      곡 삭제
 *   POST   /api/identify        지금 들리는 노래 인식 (+ 재생 위치)
 *   GET    /api/lyrics/search   외부 가사 검색 (LRCLIB)
 *   GET    /api/lyrics/get      외부 가사 단건 조회
 */

import http from 'node:http';

import { config, publicConfig, PUBLIC_DIR, SHARED_DIR, DATA_DIR } from './config.js';
import { sendJson, sendError, readJsonBody, serveStatic, matchPath } from './http.js';
import { Catalog } from './catalog.js';
import { searchLyrics, getLyrics } from './lyrics.js';
import { unpackLandmarks } from '../shared/codec.js';
import * as acrcloud from './providers/acrcloud.js';
import * as audd from './providers/audd.js';

const catalog = new Catalog();

// ---------------------------------------------------------------------------
// 라우트
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, ...catalog.stats() });
  }

  if (method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      providers: publicConfig(),
      match: config.match,
      ...catalog.stats(),
    });
  }

  // --- 카탈로그 ---
  if (method === 'GET' && pathname === '/api/tracks') {
    return sendJson(res, 200, { tracks: catalog.list() });
  }

  if (method === 'POST' && pathname === '/api/tracks') {
    const body = await readJsonBody(req, config.maxBodyBytes);
    const track = await catalog.addTrack(body);
    return sendJson(res, 201, { track });
  }

  const trackParams = matchPath('/api/tracks/:id', pathname);
  if (trackParams) {
    const track = catalog.get(trackParams.id);
    if (!track) return sendError(res, 404, '없는 곡입니다');

    if (method === 'GET') {
      const lyrics = await catalog.getLyrics(track.id);
      return sendJson(res, 200, { track, lyrics });
    }
    if (method === 'PATCH') {
      const body = await readJsonBody(req, config.maxBodyBytes);
      let updated = await catalog.updateMeta(track.id, body);
      if (body.lyrics !== undefined) {
        updated = await catalog.setLyrics(track.id, body.lyrics, body.lyricsSource ?? 'manual');
      }
      return sendJson(res, 200, { track: updated });
    }
    if (method === 'DELETE') {
      await catalog.removeTrack(track.id);
      return sendJson(res, 200, { ok: true });
    }
    return sendError(res, 405, '지원하지 않는 메서드입니다');
  }

  // --- 인식 ---
  if (method === 'POST' && pathname === '/api/identify') {
    const body = await readJsonBody(req, config.maxBodyBytes);
    return sendJson(res, 200, await identify(body));
  }

  // --- 외부 가사 ---
  if (method === 'GET' && pathname === '/api/lyrics/search') {
    const result = await searchLyrics({
      q: url.searchParams.get('q') ?? '',
      title: url.searchParams.get('title') ?? '',
      artist: url.searchParams.get('artist') ?? '',
      album: url.searchParams.get('album') ?? '',
    });
    return sendJson(res, 200, result);
  }

  if (method === 'GET' && pathname === '/api/lyrics/get') {
    const result = await getLyrics({
      title: url.searchParams.get('title') ?? '',
      artist: url.searchParams.get('artist') ?? '',
      album: url.searchParams.get('album') ?? '',
      durationMs: Number(url.searchParams.get('durationMs') ?? 0),
    });
    return sendJson(res, 200, result);
  }

  return sendError(res, 404, '없는 API 입니다');
}

/**
 * 지문으로 먼저 내 카탈로그를 찾고, 없으면 외부 인식 서비스를 시도한다.
 */
async function identify(body) {
  const startedAt = Date.now();

  // 1) 내 카탈로그 (재생 위치까지 정확히 나온다)
  if (body.landmarks) {
    const query = unpackLandmarks(body.landmarks);
    const match = catalog.index.match(query, config.match);
    if (match) {
      const track = catalog.get(match.trackId);
      return {
        matched: true,
        source: 'local',
        elapsedMs: Date.now() - startedAt,
        offsetMs: match.offsetMs,
        confidence: match.confidence,
        votes: match.votes,
        significance: match.significance,
        track: track && {
          id: track.id,
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationMs: track.durationMs,
          hasLyrics: track.hasLyrics,
          hasSyncedLyrics: track.hasSyncedLyrics,
        },
      };
    }
  }

  // 2) 외부 서비스 (오디오 원본이 함께 온 경우에만)
  if (body.audio) {
    const buffer = Buffer.from(body.audio, 'base64');
    for (const provider of [acrcloud, audd]) {
      if (!provider.isEnabled()) continue;
      try {
        const found = await provider.identify(buffer);
        if (found) {
          return {
            matched: true,
            source: found.source,
            elapsedMs: Date.now() - startedAt,
            offsetMs: found.offsetMs,
            hasOffset: found.hasOffset !== false,
            confidence: found.confidence,
            external: found,
          };
        }
      } catch (err) {
        console.warn(`[identify] ${err.message}`);
      }
    }
  }

  return { matched: false, source: null, elapsedMs: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------------

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }

      // 브라우저도 서버와 같은 shared 모듈을 그대로 쓴다
      if (url.pathname.startsWith('/shared/')) {
        const served = await serveStatic(res, SHARED_DIR, url.pathname.slice('/shared'.length));
        if (served) return;
        return sendError(res, 404, '없는 파일입니다');
      }

      const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
      if (await serveStatic(res, PUBLIC_DIR, filePath)) return;

      // SPA 라우팅: 알 수 없는 경로는 앱 화면으로
      if (!filePath.includes('.') && (await serveStatic(res, PUBLIC_DIR, '/index.html'))) return;

      sendError(res, 404, '없는 경로입니다');
    } catch (err) {
      const status = err?.statusCode ?? 500;
      if (status >= 500) console.error('[handfun]', err);
      if (!res.headersSent) {
        // 중복 등록은 이미 있는 곡을 함께 알려줘야 안내할 수 있다
        const extra = err?.existingTrack ? { existingTrack: err.existingTrack } : {};
        sendError(res, status, err?.message ?? '서버 오류', extra);
      } else {
        res.end();
      }
    }
  });
}

export async function start() {
  await catalog.init();
  const server = createServer();

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  const stats = catalog.stats();
  console.log(`HandFun 서버 실행 중  http://localhost:${config.port}`);
  console.log(`  데이터 디렉터리: ${DATA_DIR}`);
  console.log(`  등록된 곡: ${stats.trackCount}곡 / 랜드마크 ${stats.landmarkCount.toLocaleString()}개`);

  const providers = publicConfig();
  const external = Object.entries(providers)
    .filter(([, on]) => on)
    .map(([name]) => name);
  console.log(`  사용 가능한 외부 서비스: ${external.length ? external.join(', ') : '없음 (내 카탈로그만 인식)'}`);

  return server;
}

export { catalog };

// 직접 실행했을 때만 서버를 띄운다 (테스트에서는 import 만 한다)
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error('서버를 시작하지 못했습니다:', err);
    process.exit(1);
  });
}
