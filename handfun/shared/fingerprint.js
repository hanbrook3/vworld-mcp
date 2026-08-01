/**
 * Shazam 방식 랜드마크 오디오 지문.
 *
 * 1) 8kHz 모노로 리샘플 → 2) 스펙트로그램 → 3) 시간-주파수 정점(peak) 추출
 * 4) 정점끼리 짝지어 (f1, f2, Δt) 해시 생성
 *
 * 이 방식의 핵심 장점은 "어떤 곡인가" 뿐 아니라
 * "지금 그 곡의 몇 초 지점인가"까지 알 수 있다는 것이다.
 * 가사 싱크에 필요한 재생 오프셋이 매칭 과정에서 바로 나온다.
 */

import { resample, spectrogram } from './dsp.js';

export const FP_PARAMS = Object.freeze({
  sampleRate: 8000,
  fftSize: 1024,
  hopSize: 256,
  // 정점 추출
  neighborFrames: 3, // 시간축 ±3 프레임 내 최대여야 함
  neighborBins: 3, // 주파수축 ±3 빈 내 최대여야 함
  peaksPerFrame: 6, // 프레임당 최대 정점 수
  thresholdFactor: 2.2, // 프레임 평균 진폭 대비 배수
  minBin: 6, // ~47Hz 미만은 버림 (저역 잡음)
  maxBin: 460, // ~3.6kHz 초과는 버림 (전화 대역 밖)
  // 정점 짝짓기(target zone)
  fanout: 5,
  minDeltaFrames: 2,
  maxDeltaFrames: 63,
  maxDeltaBinsQ: 48,
});

/** 프레임 1개의 지속 시간(ms) */
export const FRAME_MS = (FP_PARAMS.hopSize / FP_PARAMS.sampleRate) * 1000; // 32ms

export function framesToMs(frames) {
  return frames * FRAME_MS;
}

export function msToFrames(ms) {
  return Math.round(ms / FRAME_MS);
}

/**
 * 스펙트로그램에서 시간-주파수 정점을 뽑는다.
 * @returns {{t: Int32Array, f: Int32Array}}
 */
export function findPeaks(spec, params = FP_PARAMS) {
  const { data, numFrames, bins } = spec;
  const { neighborFrames, neighborBins, peaksPerFrame, thresholdFactor } = params;
  const minBin = Math.max(1, params.minBin);
  const maxBin = Math.min(bins - 1, params.maxBin);

  const outT = [];
  const outF = [];

  // 프레임별 평균 진폭 (적응형 임계값의 기준)
  const frameMean = new Float32Array(numFrames);
  for (let t = 0; t < numFrames; t++) {
    let sum = 0;
    const base = t * bins;
    for (let f = minBin; f <= maxBin; f++) sum += data[base + f];
    frameMean[t] = sum / Math.max(1, maxBin - minBin + 1);
  }

  const candIdx = [];
  const candMag = [];

  for (let t = 0; t < numFrames; t++) {
    const base = t * bins;
    const threshold = frameMean[t] * thresholdFactor;
    candIdx.length = 0;
    candMag.length = 0;

    for (let f = minBin; f <= maxBin; f++) {
      const mag = data[base + f];
      if (mag <= threshold || mag === 0) continue;

      // 시간-주파수 이웃 영역에서 최대인지 확인
      let isPeak = true;
      const t0 = Math.max(0, t - neighborFrames);
      const t1 = Math.min(numFrames - 1, t + neighborFrames);
      const f0 = Math.max(minBin, f - neighborBins);
      const f1 = Math.min(maxBin, f + neighborBins);
      for (let tt = t0; tt <= t1 && isPeak; tt++) {
        const b = tt * bins;
        for (let ff = f0; ff <= f1; ff++) {
          if (tt === t && ff === f) continue;
          if (data[b + ff] > mag) {
            isPeak = false;
            break;
          }
        }
      }
      if (!isPeak) continue;

      candIdx.push(f);
      candMag.push(mag);
    }

    // 진폭 상위 N개만 남긴다
    if (candIdx.length > peaksPerFrame) {
      const order = candIdx.map((_, i) => i).sort((a, b) => candMag[b] - candMag[a]);
      order.length = peaksPerFrame;
      order.sort((a, b) => candIdx[a] - candIdx[b]);
      for (const i of order) {
        outT.push(t);
        outF.push(candIdx[i]);
      }
    } else {
      for (let i = 0; i < candIdx.length; i++) {
        outT.push(t);
        outF.push(candIdx[i]);
      }
    }
  }

  return { t: Int32Array.from(outT), f: Int32Array.from(outF) };
}

/**
 * 해시 인코딩: (f1 8bit) | (f2 8bit) | (Δt 6bit)
 * 주파수 빈은 절반으로 양자화해 마이크 잡음에 대한 내성을 높인다.
 */
export function encodeHash(f1q, f2q, dt) {
  return ((f1q & 0xff) << 14) | ((f2q & 0xff) << 6) | (dt & 0x3f);
}

/**
 * 정점들을 짝지어 랜드마크 해시를 만든다.
 * @returns {{hashes: Int32Array, times: Int32Array}}
 */
export function pairPeaks(peaks, params = FP_PARAMS) {
  const { fanout, minDeltaFrames, maxDeltaFrames, maxDeltaBinsQ } = params;
  const n = peaks.t.length;
  const hashes = [];
  const times = [];

  for (let i = 0; i < n; i++) {
    const t1 = peaks.t[i];
    const f1q = peaks.f[i] >> 1;
    let paired = 0;

    for (let j = i + 1; j < n && paired < fanout; j++) {
      const dt = peaks.t[j] - t1;
      if (dt < minDeltaFrames) continue;
      if (dt > maxDeltaFrames) break; // 정점은 시간순이므로 더 볼 필요 없음

      const f2q = peaks.f[j] >> 1;
      if (Math.abs(f2q - f1q) > maxDeltaBinsQ) continue;

      hashes.push(encodeHash(f1q, f2q, dt));
      times.push(t1);
      paired++;
    }
  }

  return { hashes: Int32Array.from(hashes), times: Int32Array.from(times) };
}

/**
 * PCM 샘플에서 지문을 생성한다.
 * @param {Float32Array} samples 모노 PCM
 * @param {number} sampleRate 입력 샘플레이트
 * @returns {{hashes: Int32Array, times: Int32Array, durationMs: number, frameMs: number}}
 */
export function fingerprint(samples, sampleRate, params = FP_PARAMS) {
  const mono = resample(samples, sampleRate, params.sampleRate);
  const spec = spectrogram(mono, { fftSize: params.fftSize, hopSize: params.hopSize });
  const peaks = findPeaks(spec, params);
  const landmarks = pairPeaks(peaks, params);
  return {
    ...landmarks,
    durationMs: (mono.length / params.sampleRate) * 1000,
    frameMs: FRAME_MS,
  };
}
