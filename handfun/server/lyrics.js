/**
 * 외부 가사 제공자 어댑터.
 *
 * LRCLIB(lrclib.net)은 API 키가 필요 없고 싱크 가사(LRC)를 그대로 준다.
 * 응답 형식이 바뀌거나 접속이 막혀도 앱 전체가 죽지 않도록 항상 빈 결과로 흡수한다.
 */

import { config } from './config.js';
import { fetchWithTimeout } from './http.js';

const USER_AGENT = 'HandFun/0.1 (https://github.com/hanbrook3/vworld-mcp)';

function normalize(entry) {
  return {
    id: String(entry.id ?? ''),
    title: entry.trackName ?? '',
    artist: entry.artistName ?? '',
    album: entry.albumName ?? '',
    durationMs: entry.duration ? Math.round(Number(entry.duration) * 1000) : 0,
    instrumental: Boolean(entry.instrumental),
    syncedLyrics: entry.syncedLyrics ?? '',
    plainLyrics: entry.plainLyrics ?? '',
    hasSynced: Boolean(entry.syncedLyrics),
    source: 'lrclib',
  };
}

/**
 * 가사를 검색한다.
 * @param {{q?: string, title?: string, artist?: string, album?: string, durationMs?: number}} query
 * @returns {Promise<{results: object[], error: string|null}>}
 */
export async function searchLyrics(query) {
  if (!config.lrclib.enabled) {
    return { results: [], error: '가사 검색이 꺼져 있습니다' };
  }

  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.title) params.set('track_name', query.title);
  if (query.artist) params.set('artist_name', query.artist);
  if (query.album) params.set('album_name', query.album);
  if (params.toString() === '') return { results: [], error: '검색어가 없습니다' };

  const url = `${config.lrclib.baseUrl}/api/search?${params}`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
      config.lrclib.timeoutMs,
    );
    if (!res.ok) return { results: [], error: `가사 서버 응답 ${res.status}` };

    const body = await res.json();
    const list = Array.isArray(body) ? body : [];
    return { results: list.slice(0, 20).map(normalize), error: null };
  } catch (err) {
    return { results: [], error: describeNetworkError(err) };
  }
}

/**
 * 곡 정보를 정확히 아는 경우의 단건 조회.
 */
export async function getLyrics({ title, artist, album, durationMs }) {
  if (!config.lrclib.enabled) return { result: null, error: '가사 검색이 꺼져 있습니다' };
  if (!title || !artist) return { result: null, error: '곡명과 아티스트가 필요합니다' };

  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) params.set('album_name', album);
  if (durationMs) params.set('duration', String(Math.round(durationMs / 1000)));

  try {
    const res = await fetchWithTimeout(
      `${config.lrclib.baseUrl}/api/get?${params}`,
      { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } },
      config.lrclib.timeoutMs,
    );
    if (res.status === 404) return { result: null, error: null };
    if (!res.ok) return { result: null, error: `가사 서버 응답 ${res.status}` };
    return { result: normalize(await res.json()), error: null };
  } catch (err) {
    return { result: null, error: describeNetworkError(err) };
  }
}

function describeNetworkError(err) {
  if (err?.name === 'AbortError') return '가사 서버 응답이 너무 느립니다';
  return `가사 서버에 연결하지 못했습니다 (${err?.message ?? '알 수 없는 오류'})`;
}
