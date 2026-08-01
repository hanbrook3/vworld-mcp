/**
 * 드리프트 보정 재생 클럭.
 *
 * 지문 매칭은 몇 초에 한 번만 일어나므로, 그 사이는 자체 시계로 위치를 추정해야 한다.
 * 매칭이 새로 들어올 때마다(anchor) 예측값과의 오차를 부드럽게 보정하고,
 * 여러 anchor 를 최소제곱으로 회귀해 재생 속도(rate)까지 추정한다.
 * 오차가 크면 사용자가 구간을 건너뛰었거나 곡이 바뀐 것으로 보고 즉시 재고정한다.
 *
 * 좌표 규약: anchor(positionMs, wallMs) 의 wallMs 는
 * "그 위치를 관측한 녹음 구간의 시작 시각"이다.
 */

const DEFAULTS = {
  /** 이보다 큰 오차는 구간 이동/곡 변경으로 보고 즉시 재고정한다 */
  jumpThresholdMs: 2500,
  /** 오차를 한 번에 몇 %나 따라갈지 (1.0 이면 즉시 점프해 화면이 튄다) */
  correctionGain: 0.45,
  /** 속도 추정에 쓰는 최근 anchor 개수 */
  maxAnchors: 8,
  /** 속도를 추정하려면 이 정도 시간 범위는 확보되어야 한다 */
  minRateSpanMs: 8000,
  /** 재생 속도 허용 범위 (스피커/기기 클럭 편차 흡수용) */
  minRate: 0.94,
  maxRate: 1.06,
  /** 연속 인식 실패가 이 횟수를 넘으면 '놓침' 상태 */
  maxMisses: 4,
};

export class SyncClock {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    /** 사용자가 손으로 맞추는 미세 오프셋(ms). 양수면 가사가 빨라진다. */
    this.userOffsetMs = 0;
    this.reset();
  }

  reset() {
    this.locked = false;
    this.basePosMs = 0;
    this.baseWallMs = 0;
    this.rate = 1;
    this.misses = 0;
    this.lastAnchorWallMs = 0;
    this.lastConfidence = 0;
    /** @type {{wall: number, pos: number}[]} */
    this.anchors = [];
  }

  /** 'idle' | 'locked' | 'lost' */
  get state() {
    if (!this.locked) return 'idle';
    return this.misses >= this.options.maxMisses ? 'lost' : 'locked';
  }

  /**
   * 새 관측 결과를 반영한다.
   * @param {number} positionMs 관측된 곡 내 재생 위치
   * @param {number} wallMs 그 위치를 관측한 시각(성능 타이머 기준)
   * @param {number} [confidence] 0~1
   * @returns {{type: 'lock'|'jump'|'adjust', errorMs: number}}
   */
  anchor(positionMs, wallMs, confidence = 1) {
    this.misses = 0;
    this.lastAnchorWallMs = wallMs;
    this.lastConfidence = confidence;

    if (!this.locked) {
      this.#hardSet(positionMs, wallMs);
      this.locked = true;
      return { type: 'lock', errorMs: 0 };
    }

    const predicted = this.#rawPositionAt(wallMs);
    const errorMs = positionMs - predicted;

    if (Math.abs(errorMs) > this.options.jumpThresholdMs) {
      this.#hardSet(positionMs, wallMs);
      return { type: 'jump', errorMs };
    }

    this.anchors.push({ wall: wallMs, pos: positionMs });
    if (this.anchors.length > this.options.maxAnchors) this.anchors.shift();
    this.#updateRate();

    // 오차의 일부만 따라가 화면이 튀지 않게 한다
    this.basePosMs = predicted + errorMs * this.options.correctionGain;
    this.baseWallMs = wallMs;
    return { type: 'adjust', errorMs };
  }

  /** 이번 인식 시도가 실패했음을 알린다. */
  miss() {
    if (this.locked) this.misses++;
    return this.state;
  }

  /**
   * 지정한 시각의 추정 재생 위치(ms). 사용자 미세 오프셋이 반영된다.
   * @param {number} wallMs
   */
  positionAt(wallMs) {
    return this.#rawPositionAt(wallMs) + this.userOffsetMs;
  }

  /** 마지막 anchor 이후 흐른 시간(ms) */
  sinceAnchor(wallMs) {
    return this.locked ? wallMs - this.lastAnchorWallMs : Infinity;
  }

  #rawPositionAt(wallMs) {
    if (!this.locked) return 0;
    return this.basePosMs + (wallMs - this.baseWallMs) * this.rate;
  }

  #hardSet(positionMs, wallMs) {
    this.basePosMs = positionMs;
    this.baseWallMs = wallMs;
    this.rate = 1;
    this.anchors = [{ wall: wallMs, pos: positionMs }];
  }

  /** 최근 anchor 들을 최소제곱 회귀해 재생 속도를 추정한다. */
  #updateRate() {
    const { minRateSpanMs, minRate, maxRate } = this.options;
    const pts = this.anchors;
    if (pts.length < 3) return;

    const span = pts[pts.length - 1].wall - pts[0].wall;
    if (span < minRateSpanMs) return;

    let sx = 0;
    let sy = 0;
    for (const p of pts) {
      sx += p.wall;
      sy += p.pos;
    }
    const mx = sx / pts.length;
    const my = sy / pts.length;

    let num = 0;
    let den = 0;
    for (const p of pts) {
      const dx = p.wall - mx;
      num += dx * (p.pos - my);
      den += dx * dx;
    }
    if (den === 0) return;

    const slope = num / den;
    if (!Number.isFinite(slope)) return;
    this.rate = Math.min(maxRate, Math.max(minRate, slope));
  }
}
