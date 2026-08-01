/**
 * 랜드마크 역색인 + 오프셋 히스토그램 매칭.
 *
 * 질의 지문의 각 해시가 DB 의 어느 곡·어느 시각에 있었는지 찾고,
 * (DB 시각 - 질의 시각) 차이를 곡별 히스토그램에 투표한다.
 * 같은 곡의 같은 구간이라면 이 차이가 일정하게 몰리므로,
 * 히스토그램의 봉우리가 곧 "질의 시작 시점의 곡 내 재생 위치"가 된다.
 */

import { FRAME_MS } from './fingerprint.js';

const TIME_BITS = 16;
const TIME_MASK = (1 << TIME_BITS) - 1;

/** 변별력이 없는(너무 흔한) 해시는 매칭에서 제외한다. */
const MAX_POSTINGS_PER_HASH = 800;

export class FingerprintIndex {
  constructor() {
    /** @type {Map<number, number[]>} hash → [trackIdx<<16 | frame, ...] */
    this.index = new Map();
    /** @type {(string|null)[]} */
    this.trackIds = [];
    /** @type {Map<string, number>} */
    this.trackIndexById = new Map();
    this.landmarkCount = 0;
  }

  get trackCount() {
    return this.trackIndexById.size;
  }

  has(trackId) {
    return this.trackIndexById.has(trackId);
  }

  /**
   * 곡 하나의 랜드마크를 색인에 추가한다. 같은 id 가 있으면 교체한다.
   * @param {string} trackId
   * @param {{hashes: ArrayLike<number>, times: ArrayLike<number>}} landmarks
   */
  addTrack(trackId, { hashes, times }) {
    if (this.trackIndexById.has(trackId)) this.removeTrack(trackId);

    const trackIdx = this.trackIds.length;
    this.trackIds.push(trackId);
    this.trackIndexById.set(trackId, trackIdx);

    for (let i = 0; i < hashes.length; i++) {
      const frame = times[i];
      if (frame < 0 || frame > TIME_MASK) continue; // 34분 초과 구간은 무시
      const posting = (trackIdx << TIME_BITS) | frame;
      const bucket = this.index.get(hashes[i]);
      if (bucket) bucket.push(posting);
      else this.index.set(hashes[i], [posting]);
      this.landmarkCount++;
    }
    return trackIdx;
  }

  /** 곡을 색인에서 제거한다. */
  removeTrack(trackId) {
    const trackIdx = this.trackIndexById.get(trackId);
    if (trackIdx === undefined) return false;

    for (const [hash, bucket] of this.index) {
      let write = 0;
      for (let i = 0; i < bucket.length; i++) {
        if (bucket[i] >>> TIME_BITS === trackIdx) continue;
        bucket[write++] = bucket[i];
      }
      if (write === 0) this.index.delete(hash);
      else if (write !== bucket.length) bucket.length = write;
    }

    this.trackIds[trackIdx] = null; // 인덱스 번호는 재사용하지 않는다
    this.trackIndexById.delete(trackId);
    return true;
  }

  /**
   * 질의 지문을 매칭한다.
   * @param {{hashes: ArrayLike<number>, times: ArrayLike<number>}} query
   * @param {{minVotes?: number, minRatio?: number, minSignificance?: number}} [options]
   * @returns {null | {
   *   trackId: string, offsetFrames: number, offsetMs: number,
   *   votes: number, significance: number, confidence: number, queryHashes: number,
   *   runnerUp: {trackId: string, votes: number} | null
   * }}
   */
  match(query, options = {}) {
    const minVotes = options.minVotes ?? 8;
    const minRatio = options.minRatio ?? 1.5;
    // 봉우리가 히스토그램 배경 잡음보다 몇 배나 높아야 하는가.
    // 실측상 정상 매칭은 8~10배, 무관한 곡은 1.4~3배 수준이다.
    const minSignificance = options.minSignificance ?? 4;
    const { hashes, times } = query;
    if (!hashes || hashes.length === 0 || this.index.size === 0) return null;

    /** @type {Map<number, Map<number, number>>} trackIdx → (Δ프레임 → 표) */
    const perTrack = new Map();

    for (let i = 0; i < hashes.length; i++) {
      const bucket = this.index.get(hashes[i]);
      if (!bucket || bucket.length > MAX_POSTINGS_PER_HASH) continue;
      const tq = times[i];

      for (let j = 0; j < bucket.length; j++) {
        const posting = bucket[j];
        const trackIdx = posting >>> TIME_BITS;
        const delta = (posting & TIME_MASK) - tq;

        let hist = perTrack.get(trackIdx);
        if (!hist) {
          hist = new Map();
          perTrack.set(trackIdx, hist);
        }
        hist.set(delta, (hist.get(delta) ?? 0) + 1);
      }
    }
    if (perTrack.size === 0) return null;

    // 곡마다 가장 표가 몰린 Δ 를 찾는다. 프레임 경계 흔들림을 흡수하기 위해 ±1 을 합산한다.
    const results = [];
    for (const [trackIdx, hist] of perTrack) {
      const trackId = this.trackIds[trackIdx];
      if (!trackId) continue;

      let bestDelta = 0;
      let bestVotes = 0;
      let total = 0;
      for (const [delta, count] of hist) {
        total += count;
        const smoothed = count + (hist.get(delta - 1) ?? 0) + (hist.get(delta + 1) ?? 0);
        if (smoothed > bestVotes) {
          bestVotes = smoothed;
          bestDelta = delta;
        }
      }

      // 표가 Δ 전체에 고르게 흩어졌다면 우연의 일치다.
      // 3칸(±1 평활) 기준 기대 배경값 대비 봉우리 높이를 유의도로 본다.
      const background = (total / hist.size) * 3;
      const significance = background > 0 ? bestVotes / background : 0;

      results.push({ trackId, delta: bestDelta, votes: bestVotes, significance });
    }
    if (results.length === 0) return null;

    results.sort((a, b) => b.votes - a.votes);
    const best = results[0];
    const runnerUp = results[1] ?? null;

    if (best.votes < minVotes) return null;
    if (best.significance < minSignificance) return null;
    if (runnerUp && best.votes < runnerUp.votes * minRatio) return null;

    const rivalVotes = runnerUp ? runnerUp.votes : 0;
    const sigScore = Math.min(1, best.significance / 10);
    const rivalScore = best.votes / (best.votes + rivalVotes + minVotes);
    const confidence = sigScore * 0.6 + rivalScore * 0.4;

    return {
      trackId: best.trackId,
      offsetFrames: best.delta,
      offsetMs: best.delta * FRAME_MS,
      votes: best.votes,
      significance: best.significance,
      confidence,
      queryHashes: hashes.length,
      runnerUp: runnerUp ? { trackId: runnerUp.trackId, votes: runnerUp.votes } : null,
    };
  }
}
