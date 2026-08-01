/**
 * 언제 인식을 시도할지 정하는 스케줄러.
 *
 * 고정 주기로 무조건 인식하면 조용한 방에서도 계속 서버를 부르게 되고,
 * 반대로 노래가 막 시작됐는데 다음 주기까지 기다리면 가사가 늦게 뜬다.
 * 그래서 입력 소리 크기(RMS)를 보고 이렇게 판단한다.
 *
 *  - 조용하면            → 인식하지 않는다 (배터리·데이터 절약)
 *  - 조용하다 소리가 나면 → 녹음 창이 음악으로 찰 때까지만 기다렸다 바로 인식한다
 *  - 계속 못 찾으면      → 주기를 늘려 간다 (라디오 광고, 대화 소리 등)
 *  - 찾으면              → 주기를 원래대로 되돌린다
 *
 * 소리가 나는 '순간' 인식하면 안 된다. 녹음 창은 과거 5초를 보기 때문에
 * 그 시점의 창은 대부분 무음이라 실패가 뻔하고, 실패로 세면 주기까지 늘어난다.
 */

const DEFAULTS = {
  /** 기본 재인식 주기 */
  baseIntervalMs: 6000,
  /** 계속 실패할 때 늘어날 수 있는 최대 주기 */
  maxIntervalMs: 20000,
  /** 이 RMS 미만이면 소리가 없는 것으로 본다 (약 -48dBFS) */
  silenceRms: 0.004,
  /** 이만큼 계속 조용해야 '조용함'으로 넘어간다 (곡 사이 정적에 반응하지 않도록) */
  silenceHoldMs: 1500,
  /** 무음에서 깨어난 뒤, 이만큼 소리가 이어져야 첫 인식을 시도한다 */
  minLoudMs: 4000,
  /** 실패 1회당 주기가 늘어나는 비율 */
  missBackoff: 0.6,
  /** 주기가 늘어날 수 있는 최대 배수 */
  maxBackoff: 2,
};

export class ListenScheduler {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.intervalMs = this.options.baseIntervalMs;
    this.misses = 0;
    // 시작 시점에 이미 노래가 흐르고 있을 수 있다. 그 경우 곧바로 인식해야 하므로
    // '무음에서 막 깨어남'(pendingOnset) 상태로 두지 않는다.
    this.silent = false;
    this.pendingOnset = false;
    this.loudSinceMs = -Infinity;
    this.lastLoudAtMs = -Infinity;
    this.lastAttemptMs = -Infinity;
  }

  /** 사용자가 설정에서 주기를 바꿨을 때 */
  setBaseInterval(ms) {
    this.options.baseIntervalMs = ms;
    this.#applyBackoff();
  }

  /**
   * 지금 인식을 시도할지 판단한다.
   * @param {{rms: number, nowMs: number}} input
   * @returns {{recognize: boolean, reason: 'silent'|'warming'|'onset'|'due'|'waiting',
   *            silent: boolean, intervalMs: number}}
   */
  decide({ rms, nowMs }) {
    const loud = rms >= this.options.silenceRms;
    if (loud) this.lastLoudAtMs = nowMs;

    const silent = !loud && nowMs - this.lastLoudAtMs >= this.options.silenceHoldMs;
    const wasSilent = this.silent;
    this.silent = silent;

    if (silent) {
      // 다시 소리가 나면 창이 찰 때까지 기다렸다 인식한다
      this.pendingOnset = true;
      this.loudSinceMs = Infinity;
      return { recognize: false, reason: 'silent', silent, intervalMs: this.intervalMs };
    }

    if (wasSilent && this.pendingOnset) this.loudSinceMs = nowMs;

    if (this.pendingOnset) {
      if (nowMs - this.loudSinceMs < this.options.minLoudMs) {
        // 아직 창의 상당 부분이 무음이다. 지금 보내면 버리는 요청이 된다.
        return { recognize: false, reason: 'warming', silent, intervalMs: this.intervalMs };
      }
      this.pendingOnset = false;
      this.lastAttemptMs = nowMs;
      return { recognize: true, reason: 'onset', silent, intervalMs: this.intervalMs };
    }

    if (nowMs - this.lastAttemptMs >= this.intervalMs) {
      this.lastAttemptMs = nowMs;
      return { recognize: true, reason: 'due', silent, intervalMs: this.intervalMs };
    }

    return { recognize: false, reason: 'waiting', silent, intervalMs: this.intervalMs };
  }

  /** 인식 결과를 반영해 다음 주기를 조정한다. */
  report(matched) {
    this.misses = matched ? 0 : this.misses + 1;
    this.#applyBackoff();
    return this.intervalMs;
  }

  #applyBackoff() {
    const { baseIntervalMs, maxIntervalMs, missBackoff, maxBackoff } = this.options;
    const factor = 1 + Math.min(maxBackoff, this.misses * missBackoff);
    this.intervalMs = Math.min(maxIntervalMs, Math.round(baseIntervalMs * factor));
  }
}

/** 최근 구간의 RMS(실효값). 소리가 있는지 판단하는 데 쓴다. */
export function computeRms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
