/**
 * 의존성 없는 radix-2 Cooley-Tukey FFT.
 * 브라우저와 Node 양쪽에서 그대로 동작한다.
 */

const twiddleCache = new Map();

/** 크기 n 에 대한 사전 계산된 회전인자(twiddle factor)와 비트반전 테이블 */
function getTables(n) {
  let tables = twiddleCache.get(n);
  if (tables) return tables;

  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n);
    sin[i] = Math.sin((-2 * Math.PI * i) / n);
  }

  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }

  tables = { cos, sin, rev };
  twiddleCache.set(n, tables);
  return tables;
}

/**
 * 제자리(in-place) 복소 FFT.
 * @param {Float64Array} re 실수부 (길이는 2의 거듭제곱)
 * @param {Float64Array} im 허수부
 */
export function fft(re, im) {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re/im 길이가 다릅니다');
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fft: 길이는 2의 거듭제곱이어야 합니다');

  const { cos, sin, rev } = getTables(n);

  // 비트반전 순열
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const l = i + j;
        const r = l + half;
        const wr = cos[k];
        const wi = sin[k];
        const tr = re[r] * wr - im[r] * wi;
        const ti = re[r] * wi + im[r] * wr;
        re[r] = re[l] - tr;
        im[r] = im[l] - ti;
        re[l] += tr;
        im[l] += ti;
      }
    }
  }
}

/**
 * 실수 신호의 진폭 스펙트럼(0 ~ Nyquist)을 계산한다.
 * @param {Float32Array|Float64Array} frame 창 함수가 적용된 시간영역 프레임
 * @param {Float64Array} re 재사용 버퍼
 * @param {Float64Array} im 재사용 버퍼
 * @param {Float32Array} out 결과 버퍼 (길이 n/2)
 */
export function magnitudeSpectrum(frame, re, im, out) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] = i < frame.length ? frame[i] : 0;
    im[i] = 0;
  }
  fft(re, im);
  const bins = n >> 1;
  for (let i = 0; i < bins; i++) {
    out[i] = Math.hypot(re[i], im[i]);
  }
  return out;
}
