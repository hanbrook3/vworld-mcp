/**
 * AudD 음악 인식 어댑터 (선택 사항).
 *
 * AUDD_API_TOKEN 환경변수가 있을 때만 동작한다.
 * ACRCloud 와 달리 재생 위치를 늘 주지는 않으므로, 위치를 못 받으면
 * 곡 정보만 쓰고 싱크는 사용자가 직접 맞추도록 한다.
 */

import { config } from '../config.js';
import { fetchWithTimeout } from '../http.js';

export function isEnabled() {
  return Boolean(config.audd.apiToken);
}

/** "3:24" 같은 타임코드를 밀리초로 바꾼다. */
function parseTimecode(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

/**
 * @param {Buffer} audioBuffer
 * @returns {Promise<null | object>}
 */
export async function identify(audioBuffer) {
  if (!isEnabled()) return null;

  const form = new FormData();
  form.set('api_token', config.audd.apiToken);
  form.set('file', new Blob([audioBuffer]), 'sample.wav');

  const res = await fetchWithTimeout(
    config.audd.baseUrl,
    { method: 'POST', body: form },
    config.audd.timeoutMs,
  );
  if (!res.ok) throw new Error(`AudD 응답 ${res.status}`);

  const body = await res.json();
  if (body?.status !== 'success' || !body.result) return null;

  const r = body.result;
  const offsetMs = parseTimecode(r.timecode);

  return {
    title: r.title ?? '',
    artist: r.artist ?? '',
    album: r.album ?? '',
    offsetMs: offsetMs ?? 0,
    hasOffset: offsetMs !== null,
    durationMs: 0,
    confidence: 0.8, // AudD 는 점수를 주지 않는다
    source: 'audd',
  };
}
