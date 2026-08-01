/**
 * 리샘플링 / 창 함수 / 스펙트로그램.
 * 브라우저와 Node 에서 동일하게 동작하도록 순수 JS 로만 작성했다.
 */

import { magnitudeSpectrum } from './fft.js';

/** 한(Hann) 창 */
export function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function sinc(x) {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/**
 * 윈도우드 싱크(windowed-sinc) 저역통과 FIR 계수.
 * @param {number} cutoff 정규화 차단주파수 (cycles/sample, 0~0.5)
 * @param {number} taps 홀수 탭 수
 */
export function designLowpass(cutoff, taps = 63) {
  if (taps % 2 === 0) taps += 1;
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    // 해밍 창을 곱한 이상적 저역통과 응답
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    h[i] = 2 * cutoff * sinc(2 * cutoff * (i - mid)) * hamming;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum; // DC 이득 1로 정규화
  return h;
}

/** FIR 컨볼루션 (군지연 보정 포함, 길이 유지) */
function firFilter(input, h) {
  const n = input.length;
  const taps = h.length;
  const mid = (taps - 1) >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < taps; k++) {
      const idx = i + mid - k;
      if (idx >= 0 && idx < n) acc += input[idx] * h[k];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * 선형보간 리샘플링. 다운샘플링일 때는 에일리어싱 방지 저역통과를 먼저 적용한다.
 * @param {Float32Array} input
 * @param {number} srcRate
 * @param {number} dstRate
 * @returns {Float32Array}
 */
export function resample(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input instanceof Float32Array ? input : Float32Array.from(input);
  if (input.length === 0) return new Float32Array(0);

  let src = input;
  if (dstRate < srcRate) {
    // 목표 나이퀴스트의 90% 지점에서 차단
    const cutoff = (0.45 * dstRate) / srcRate;
    src = firFilter(input, designLowpass(cutoff, 63));
  }

  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, src.length - 1);
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

/** 다채널 오디오를 모노로 합친다. */
export function toMono(channels) {
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  for (let i = 0; i < len; i++) out[i] /= channels.length;
  return out;
}

/**
 * 진폭 스펙트로그램. 성능을 위해 평탄한 Float32Array 로 반환한다.
 * @returns {{data: Float32Array, numFrames: number, bins: number}}
 *          data[frame * bins + bin] 형태로 접근한다.
 */
export function spectrogram(samples, { fftSize = 1024, hopSize = 256 } = {}) {
  const bins = fftSize >> 1;
  if (samples.length < fftSize) {
    return { data: new Float32Array(0), numFrames: 0, bins };
  }
  const numFrames = 1 + Math.floor((samples.length - fftSize) / hopSize);
  const data = new Float32Array(numFrames * bins);

  const win = hannWindow(fftSize);
  const frame = new Float32Array(fftSize);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const mag = new Float32Array(bins);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) frame[i] = samples[start + i] * win[i];
    magnitudeSpectrum(frame, re, im, mag);
    data.set(mag, f * bins);
  }

  return { data, numFrames, bins };
}
