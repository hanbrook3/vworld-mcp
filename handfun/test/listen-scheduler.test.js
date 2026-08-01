import test from 'node:test';
import assert from 'node:assert/strict';

import { ListenScheduler, computeRms } from '../shared/listen-scheduler.js';

const LOUD = 0.05;
const QUIET = 0.0001;

test('RMS 를 계산한다', () => {
  assert.equal(computeRms([]), 0);
  assert.equal(computeRms(null), 0);
  assert.equal(computeRms([1, 1, 1]), 1);
  assert.equal(computeRms([0, 0]), 0);

  // 진폭 1인 사인파의 RMS 는 1/√2
  const sine = new Float32Array(1000);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * i) / 100);
  assert.ok(Math.abs(computeRms(sine) - Math.SQRT1_2) < 0.01);
});

test('조용하면 인식하지 않는다', () => {
  const s = new ListenScheduler();
  const first = s.decide({ rms: QUIET, nowMs: 0 });
  assert.equal(first.silent, true);
  assert.equal(first.recognize, false);
  assert.equal(first.reason, 'silent');

  const later = s.decide({ rms: QUIET, nowMs: 30000 });
  assert.equal(later.recognize, false);
  assert.equal(later.reason, 'silent');
});

test('시작할 때 이미 노래가 흐르고 있으면 바로 인식한다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000 });
  // 앱이 창을 채운 뒤 첫 판단을 하므로 버퍼에는 이미 음악이 들어 있다
  const first = s.decide({ rms: LOUD, nowMs: 0 });
  assert.equal(first.recognize, true);
  assert.equal(first.reason, 'due');
});

test('무음에서 깨어나면 창이 음악으로 찰 때까지 기다렸다 인식한다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000, minLoudMs: 4000 });
  s.decide({ rms: QUIET, nowMs: 0 });
  s.decide({ rms: QUIET, nowMs: 2000 });

  // 소리가 막 시작된 시점의 창은 대부분 무음이라 보내봐야 버려진다
  assert.equal(s.decide({ rms: LOUD, nowMs: 3000 }).reason, 'warming');
  assert.equal(s.decide({ rms: LOUD, nowMs: 5000 }).reason, 'warming');
  assert.equal(s.decide({ rms: LOUD, nowMs: 6900 }).recognize, false);

  // 4초어치 음악이 쌓이면 주기를 기다리지 않고 바로 인식한다
  const onset = s.decide({ rms: LOUD, nowMs: 7000 });
  assert.equal(onset.recognize, true);
  assert.equal(onset.reason, 'onset');
});

test('소리가 계속되면 설정한 주기마다 인식한다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000 });
  assert.equal(s.decide({ rms: LOUD, nowMs: 1000 }).reason, 'due');

  // 주기 전에는 기다린다
  assert.equal(s.decide({ rms: LOUD, nowMs: 3000 }).recognize, false);
  assert.equal(s.decide({ rms: LOUD, nowMs: 6900 }).reason, 'waiting');

  // 주기가 지나면 다시 인식한다
  const due = s.decide({ rms: LOUD, nowMs: 7000 });
  assert.equal(due.recognize, true);
  assert.equal(due.reason, 'due');
});

test('짧은 정적은 조용함으로 보지 않는다', () => {
  const s = new ListenScheduler({ silenceHoldMs: 1500 });
  s.decide({ rms: LOUD, nowMs: 0 });

  // 곡 사이의 1초짜리 정적
  assert.equal(s.decide({ rms: QUIET, nowMs: 1000 }).silent, false);
  // 1.5초를 넘기면 그때 조용함으로 넘어간다
  assert.equal(s.decide({ rms: QUIET, nowMs: 1600 }).silent, true);
});

test('계속 못 찾으면 주기를 늘리고, 찾으면 되돌린다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000, maxIntervalMs: 20000 });
  assert.equal(s.intervalMs, 6000);

  s.report(false);
  const afterOne = s.intervalMs;
  assert.ok(afterOne > 6000, `1회 실패 후 ${afterOne}ms`);

  s.report(false);
  assert.ok(s.intervalMs > afterOne, '실패가 쌓이면 더 늘어난다');

  for (let i = 0; i < 20; i++) s.report(false);
  assert.ok(s.intervalMs <= 20000, `상한을 넘지 않는다 (${s.intervalMs}ms)`);

  s.report(true);
  assert.equal(s.intervalMs, 6000, '찾으면 기본 주기로 되돌아간다');
});

test('설정에서 주기를 바꾸면 즉시 반영된다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000 });
  s.setBaseInterval(10000);
  assert.equal(s.intervalMs, 10000);

  // 백오프 중에도 새 기본값을 기준으로 다시 계산된다
  s.report(false);
  const backedOff = s.intervalMs;
  s.setBaseInterval(4000);
  assert.ok(s.intervalMs < backedOff);
  s.report(true);
  assert.equal(s.intervalMs, 4000);
});

test('reset 하면 처음 상태로 돌아간다', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000 });
  s.decide({ rms: QUIET, nowMs: 0 });
  s.report(false);
  s.report(false);

  s.reset();
  assert.equal(s.intervalMs, 6000);
  assert.equal(s.silent, false);
  // 리셋 직후 소리가 들리면 바로 인식한다 (창은 이미 차 있다고 본다)
  assert.equal(s.decide({ rms: LOUD, nowMs: 100 }).reason, 'due');
});

test('실제 시나리오: 정적 → 노래 → 정적', () => {
  const s = new ListenScheduler({ baseIntervalMs: 6000, silenceHoldMs: 1500, minLoudMs: 4000 });
  const attempts = [];

  // 0~10초 조용함
  for (let t = 0; t <= 10000; t += 1000) {
    if (s.decide({ rms: QUIET, nowMs: t }).recognize) attempts.push(t);
  }
  assert.equal(attempts.length, 0, '조용한 동안에는 한 번도 인식하지 않는다');

  // 11~40초 노래가 흐른다
  for (let t = 11000; t <= 40000; t += 1000) {
    if (s.decide({ rms: LOUD, nowMs: t }).recognize) {
      attempts.push(t);
      s.report(true);
    }
  }
  assert.equal(attempts[0], 15000, '노래 시작 4초 뒤, 창이 음악으로 찬 시점에 첫 인식');
  assert.ok(attempts.length >= 4, `30초 동안 ${attempts.length}회 인식`);
  assert.ok(attempts.length <= 6, '주기보다 자주 부르지 않는다');

  // 노래가 끝나고 다시 조용해지면 멈춘다
  const before = attempts.length;
  for (let t = 41000; t <= 60000; t += 1000) {
    if (s.decide({ rms: QUIET, nowMs: t }).recognize) attempts.push(t);
  }
  assert.ok(attempts.length - before <= 1, '노래가 끝나면 곧 인식을 멈춘다');
});

test('무음으로 버려질 요청이 실패로 집계되지 않는다', () => {
  // warming 구간에서 인식을 아예 하지 않으므로 백오프가 걸릴 일이 없다
  const s = new ListenScheduler({ baseIntervalMs: 6000, minLoudMs: 4000 });
  s.decide({ rms: QUIET, nowMs: 0 });

  let attempts = 0;
  for (let t = 1000; t < 5000; t += 1000) {
    if (s.decide({ rms: LOUD, nowMs: t }).recognize) attempts++;
  }
  assert.equal(attempts, 0, '창이 차기 전에는 한 번도 보내지 않는다');
  assert.equal(s.intervalMs, 6000, '주기가 늘어나지 않았다');
});
