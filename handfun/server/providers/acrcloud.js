/**
 * ACRCloud 음악 인식 어댑터 (선택 사항).
 *
 * 내 카탈로그에 없는 곡까지 인식하고 싶을 때 쓴다.
 * 무엇보다 play_offset_ms 를 돌려주기 때문에 가사 싱크에 바로 쓸 수 있다.
 * 환경변수 ACRCLOUD_HOST / ACRCLOUD_ACCESS_KEY / ACRCLOUD_ACCESS_SECRET 가 있어야 동작한다.
 */

import crypto from 'node:crypto';

import { config } from '../config.js';
import { fetchWithTimeout } from '../http.js';

export function isEnabled() {
  const { host, accessKey, accessSecret } = config.acrcloud;
  return Boolean(host && accessKey && accessSecret);
}

/**
 * @param {Buffer} audioBuffer 녹음된 오디오 (wav 등)
 * @returns {Promise<null | {title: string, artist: string, album: string,
 *   offsetMs: number, durationMs: number, confidence: number, source: string}>}
 */
export async function identify(audioBuffer) {
  if (!isEnabled()) return null;

  const { host, accessKey, accessSecret, timeoutMs } = config.acrcloud;
  const endpoint = `https://${host}/v1/identify`;
  const timestamp = Math.floor(Date.now() / 1000);

  const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');
  const signature = crypto.createHmac('sha1', accessSecret).update(stringToSign).digest('base64');

  const form = new FormData();
  form.set('access_key', accessKey);
  form.set('data_type', 'audio');
  form.set('signature_version', '1');
  form.set('signature', signature);
  form.set('timestamp', String(timestamp));
  form.set('sample_bytes', String(audioBuffer.length));
  form.set('sample', new Blob([audioBuffer]), 'sample.wav');

  const res = await fetchWithTimeout(endpoint, { method: 'POST', body: form }, timeoutMs);
  if (!res.ok) throw new Error(`ACRCloud 응답 ${res.status}`);

  const body = await res.json();
  if (body?.status?.code !== 0) return null; // 1001 = 인식 실패

  const music = body?.metadata?.music?.[0];
  if (!music) return null;

  return {
    title: music.title ?? '',
    artist: (music.artists ?? []).map((a) => a.name).join(', '),
    album: music.album?.name ?? '',
    offsetMs: Number(music.play_offset_ms ?? 0),
    durationMs: Number(music.duration_ms ?? 0),
    confidence: Number(music.score ?? 0) / 100,
    source: 'acrcloud',
  };
}
