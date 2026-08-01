/**
 * 지문 계산 워커.
 * FFT 는 몇 십 ms 씩 걸리므로 메인 스레드에서 돌리면 가사가 끊긴다.
 */

import { fingerprint } from '/shared/fingerprint.js';
import { packLandmarks } from '/shared/codec.js';

self.onmessage = (event) => {
  const { id, samples, sampleRate } = event.data;
  try {
    const started = performance.now();
    const fp = fingerprint(samples, sampleRate);
    self.postMessage({
      id,
      ok: true,
      landmarks: packLandmarks(fp),
      count: fp.hashes.length,
      durationMs: fp.durationMs,
      elapsedMs: performance.now() - started,
    });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message ?? '지문 계산 실패' });
  }
};
