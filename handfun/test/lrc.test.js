import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLrc,
  parseLyrics,
  parsePlainLyrics,
  hasTimestamps,
  lineIndexAt,
  wordIndexAt,
  lineProgressAt,
  toLrc,
} from '../shared/lrc.js';

test('표준 LRC 를 파싱한다', () => {
  const lrc = [
    '[ti:테스트 곡]',
    '[ar:테스트 아티스트]',
    '[00:05.00] 첫 번째 줄',
    '[00:10.50] 두 번째 줄',
    '[00:15.25] 세 번째 줄',
  ].join('\n');

  const parsed = parseLrc(lrc);
  assert.equal(parsed.meta.ti, '테스트 곡');
  assert.equal(parsed.meta.ar, '테스트 아티스트');
  assert.equal(parsed.synced, true);
  assert.equal(parsed.lines.length, 3);

  assert.equal(parsed.lines[0].startMs, 5000);
  assert.equal(parsed.lines[0].endMs, 10500);
  assert.equal(parsed.lines[0].text, '첫 번째 줄');
  assert.equal(parsed.lines[1].startMs, 10500);
  assert.equal(parsed.lines[2].startMs, 15250);
});

test('소수점 자릿수에 따라 밀리초를 올바르게 계산한다', () => {
  const parsed = parseLrc('[00:01.5] a\n[00:02.25] b\n[00:03.125] c\n[00:04] d');
  assert.equal(parsed.lines[0].startMs, 1500);
  assert.equal(parsed.lines[1].startMs, 2250);
  assert.equal(parsed.lines[2].startMs, 3125);
  assert.equal(parsed.lines[3].startMs, 4000);
});

test('한 줄에 붙은 여러 타임스탬프를 각각의 줄로 펼친다', () => {
  const parsed = parseLrc('[00:10.00][01:20.00][02:30.00] 후렴구');
  assert.equal(parsed.lines.length, 3);
  assert.deepEqual(
    parsed.lines.map((l) => l.startMs),
    [10000, 80000, 150000],
  );
  for (const line of parsed.lines) assert.equal(line.text, '후렴구');
});

test('확장 LRC 의 단어 단위 타이밍을 읽는다', () => {
  const parsed = parseLrc('[00:10.00] <00:10.00>Never <00:10.40>gonna <00:10.90>give');
  const line = parsed.lines[0];

  assert.ok(line.words);
  assert.equal(line.words.length, 3);
  assert.equal(line.words[0].text, 'Never');
  assert.equal(line.words[0].startMs, 10000);
  assert.equal(line.words[0].endMs, 10400);
  assert.equal(line.words[1].startMs, 10400);
  assert.equal(line.words[2].startMs, 10900);
  assert.equal(line.text, 'Never gonna give');
});

test('offset 태그는 가사를 앞당긴다', () => {
  const parsed = parseLrc('[offset:+500]\n[00:10.00] 가사');
  assert.equal(parsed.lines[0].startMs, 9500);
});

test('타임스탬프 없는 가사는 평문으로 처리한다', () => {
  assert.equal(hasTimestamps('그냥 가사입니다'), false);
  assert.equal(hasTimestamps('[00:01.00] 가사'), true);

  const parsed = parseLyrics('첫 줄\n\n둘째 줄');
  assert.equal(parsed.synced, false);
  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[1].text, '둘째 줄');
});

test('빈 입력에도 안전하다', () => {
  for (const input of ['', null, undefined, '   \n  ']) {
    const parsed = parseLyrics(input);
    assert.equal(parsed.lines.length, 0);
    assert.equal(lineIndexAt(parsed.lines, 1000), -1);
  }
  assert.equal(parsePlainLyrics('').lines.length, 0);
});

test('재생 위치로 현재 줄을 찾는다', () => {
  const parsed = parseLrc('[00:05.00] A\n[00:10.00] B\n[00:15.00] C');
  const lines = parsed.lines;

  assert.equal(lineIndexAt(lines, 0), -1, '첫 줄 이전은 -1');
  assert.equal(lineIndexAt(lines, 4999), -1);
  assert.equal(lineIndexAt(lines, 5000), 0);
  assert.equal(lineIndexAt(lines, 9999), 0);
  assert.equal(lineIndexAt(lines, 10000), 1);
  assert.equal(lineIndexAt(lines, 14999), 1);
  assert.equal(lineIndexAt(lines, 15000), 2);
  assert.equal(lineIndexAt(lines, 999999), 2, '마지막 줄 이후는 마지막 줄 유지');
});

test('줄 안에서 현재 단어와 진행률을 계산한다', () => {
  const parsed = parseLrc('[00:10.00] <00:10.00>one <00:11.00>two <00:12.00>three\n[00:13.00] next');
  const line = parsed.lines[0];

  assert.equal(wordIndexAt(line, 9999), -1);
  assert.equal(wordIndexAt(line, 10000), 0);
  assert.equal(wordIndexAt(line, 11500), 1);
  assert.equal(wordIndexAt(line, 12500), 2);

  assert.equal(lineProgressAt(line, 10000), 0);
  assert.ok(Math.abs(lineProgressAt(line, 11500) - 0.5) < 1e-9);
  assert.equal(lineProgressAt(line, 13000), 1);
  assert.equal(lineProgressAt(line, 99999), 1, '범위를 벗어나도 0~1 로 고정');
  assert.equal(wordIndexAt({ words: null }, 100), -1);
});

test('LRC 로 다시 직렬화할 수 있다', () => {
  const original = '[ti:곡]\n[00:05.00]첫 줄\n[01:02.34]둘째 줄';
  const round = toLrc(parseLrc(original));

  assert.ok(round.includes('[ti:곡]'));
  assert.ok(round.includes('[00:05.00]첫 줄'));
  assert.ok(round.includes('[01:02.34]둘째 줄'));

  // 다시 파싱해도 타이밍이 유지된다
  const reparsed = parseLrc(round);
  assert.equal(reparsed.lines[0].startMs, 5000);
  assert.equal(reparsed.lines[1].startMs, 62340);
});
