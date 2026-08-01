/** 테스트용 결정적(deterministic) 오디오 생성기 */

/** mulberry32 시드 난수 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 지문 추출이 의미 있게 동작하도록 시간에 따라 화성이 바뀌는 합성 "노래"를 만든다.
 * 멜로디(구간마다 다른 음정) + 화음 + 베이스 + 타악기성 클릭으로 구성한다.
 */
export function makeSyntheticSong(seconds, sampleRate = 44100, seed = 12345) {
  const rng = makeRng(seed);
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);

  // 0.5초마다 바뀌는 음정 시퀀스 (반복되지 않도록 난수로 뽑는다)
  const stepSec = 0.5;
  const numSteps = Math.ceil(seconds / stepSec);
  const notes = [];
  for (let i = 0; i < numSteps; i++) {
    const midi = 52 + Math.floor(rng() * 28); // E3 ~ B5
    notes.push(440 * Math.pow(2, (midi - 69) / 12));
  }

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const step = Math.min(numSteps - 1, Math.floor(t / stepSec));
    const f0 = notes[step];
    const env = Math.exp(-3 * ((t % stepSec) / stepSec)); // 음마다 감쇠

    let s = 0;
    s += 0.5 * env * Math.sin(2 * Math.PI * f0 * t);
    s += 0.3 * env * Math.sin(2 * Math.PI * f0 * 2 * t);
    s += 0.2 * env * Math.sin(2 * Math.PI * f0 * 3 * t);
    s += 0.25 * env * Math.sin(2 * Math.PI * f0 * 1.5 * t); // 5도 화음
    s += 0.35 * Math.sin(2 * Math.PI * (f0 / 4) * t); // 베이스

    // 0.25초마다 타악기성 클릭 (넓은 대역 성분)
    const beatPhase = t % 0.25;
    if (beatPhase < 0.01) s += 0.4 * Math.exp(-400 * beatPhase) * (rng() * 2 - 1);

    out[i] = s * 0.25;
  }
  return out;
}

/** 백색잡음을 섞어 마이크 녹음 환경을 흉내낸다. */
export function addNoise(samples, level, seed = 999) {
  const rng = makeRng(seed);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] + (rng() * 2 - 1) * level;
  }
  return out;
}

/** 구간 잘라내기 (초 단위) */
export function slice(samples, sampleRate, startSec, lengthSec) {
  const start = Math.floor(startSec * sampleRate);
  const end = Math.min(samples.length, start + Math.floor(lengthSec * sampleRate));
  return samples.slice(start, end);
}
