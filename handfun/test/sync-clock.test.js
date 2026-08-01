import test from 'node:test';
import assert from 'node:assert/strict';

import { SyncClock } from '../shared/sync-clock.js';

test('첫 anchor 에서 고정되고 그 뒤로는 실시간으로 흐른다', () => {
  const clock = new SyncClock();
  assert.equal(clock.state, 'idle');

  const res = clock.anchor(30000, 1000);
  assert.equal(res.type, 'lock');
  assert.equal(clock.state, 'locked');

  assert.equal(clock.positionAt(1000), 30000);
  assert.equal(clock.positionAt(3000), 32000, '2초 뒤에는 곡도 2초 진행');
});

test('작은 오차는 부드럽게 보정한다 (한 번에 튀지 않음)', () => {
  const clock = new SyncClock();
  clock.anchor(30000, 0);

  // 5초 뒤 실제 위치가 예측보다 200ms 앞서 있었다
  const res = clock.anchor(35200, 5000);
  assert.equal(res.type, 'adjust');
  assert.ok(Math.abs(res.errorMs - 200) < 1e-6);

  const corrected = clock.positionAt(5000);
  assert.ok(corrected > 35000, '보정 방향이 맞아야 한다');
  assert.ok(corrected < 35200, '오차를 한 번에 다 따라가면 화면이 튄다');
});

test('큰 오차는 구간 이동으로 보고 즉시 재고정한다', () => {
  const clock = new SyncClock();
  clock.anchor(30000, 0);

  const res = clock.anchor(90000, 5000); // 사용자가 뒤로 건너뜀
  assert.equal(res.type, 'jump');
  assert.equal(clock.positionAt(5000), 90000, '점프는 즉시 반영');
  assert.equal(clock.rate, 1, '점프 후 속도 추정은 초기화');
});

test('여러 anchor 로 재생 속도를 추정한다', () => {
  const clock = new SyncClock();
  // 실제 재생이 2% 빠른 상황을 만든다
  const rate = 1.02;
  for (let i = 0; i <= 6; i++) {
    const wall = i * 4000;
    clock.anchor(10000 + wall * rate, wall);
  }
  assert.ok(Math.abs(clock.rate - rate) < 0.01, `추정 속도 ${clock.rate}`);
});

test('속도 추정치는 허용 범위를 벗어나지 않는다', () => {
  const clock = new SyncClock();
  // 말이 안 되는 배속 데이터를 넣어도 클램프되어야 한다
  for (let i = 0; i <= 6; i++) {
    const wall = i * 4000;
    clock.anchor(wall * 1.5, wall);
  }
  assert.ok(clock.rate <= 1.06 && clock.rate >= 0.94, `속도 ${clock.rate}`);
});

test('연속 인식 실패가 쌓이면 놓침 상태가 된다', () => {
  const clock = new SyncClock({ maxMisses: 3 });
  clock.anchor(10000, 0);
  assert.equal(clock.state, 'locked');

  clock.miss();
  clock.miss();
  assert.equal(clock.state, 'locked');
  assert.equal(clock.miss(), 'lost');

  // 다시 인식되면 복구된다
  clock.anchor(20000, 12000);
  assert.equal(clock.state, 'locked');
});

test('사용자 미세 오프셋이 위치에 반영된다', () => {
  const clock = new SyncClock();
  clock.anchor(30000, 0);
  assert.equal(clock.positionAt(0), 30000);

  clock.userOffsetMs = 300;
  assert.equal(clock.positionAt(0), 30300);

  clock.userOffsetMs = -500;
  assert.equal(clock.positionAt(0), 29500);
});

test('reset 하면 초기 상태로 돌아간다', () => {
  const clock = new SyncClock();
  clock.anchor(30000, 0);
  clock.reset();

  assert.equal(clock.state, 'idle');
  assert.equal(clock.positionAt(10000), 0);
  assert.equal(clock.sinceAnchor(10000), Infinity);
});

test('누적 드리프트가 실제 시나리오에서 억제된다', () => {
  // 기기 클럭이 1.5% 빠른 상황에서 6초마다 재인식한다고 가정
  const trueRate = 1.015;
  const clock = new SyncClock();
  clock.anchor(0, 0);

  let worstError = 0;
  for (let wall = 6000; wall <= 180000; wall += 6000) {
    const truePos = wall * trueRate;
    worstError = Math.max(worstError, Math.abs(clock.positionAt(wall) - truePos));
    clock.anchor(truePos, wall);
  }
  // 보정이 없다면 3분 뒤 2.7초까지 벌어진다
  assert.ok(worstError < 300, `최대 오차 ${worstError.toFixed(0)}ms`);
});
