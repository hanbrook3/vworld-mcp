import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLrc,
  parseLyrics,
  parsePlainLyrics,
  hasTimestamps,
  stripFurigana,
  attachTranslation,
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

test('후리가나를 화면용과 발음용으로 분리한다', () => {
  const cases = [
    ['君(きみ)の声(こえ)', '君の声', 'きみのこえ'],
    ['夜空（よぞら）に光（ひか）る', '夜空に光る', 'よぞらにひかる'], // 전각 괄호
    ['涙《なみだ》', '涙', 'なみだ'], // 루비 표기
    ['強(つよ)く強(つよ)く', '強く強く', 'つよくつよく'], // 같은 한자 반복
  ];
  for (const [input, display, reading] of cases) {
    assert.deepEqual(stripFurigana(input), { display, reading }, input);
  }
});

test('후리가나가 없으면 reading 은 null 이다', () => {
  assert.deepEqual(stripFurigana('こんにちは'), { display: 'こんにちは', reading: null });
  assert.deepEqual(stripFurigana('hello (world)'), { display: 'hello (world)', reading: null });
  assert.deepEqual(stripFurigana(''), { display: '', reading: null });
});

test('후리가나가 있어도 공백 위치가 유지되어 단어 수가 맞는다', () => {
  const { display, reading } = stripFurigana('君(きみ)の声(こえ)が Catch the moment');
  assert.equal(display.split(/\s+/).length, reading.split(/\s+/).length);
  assert.equal(display, '君の声が Catch the moment');
  assert.equal(reading, 'きみのこえが Catch the moment');
});

test('LRC 안의 후리가나를 읽는다', () => {
  const parsed = parseLrc('[00:05.00] 君(きみ)の声(こえ)が聞(き)こえる\n[00:10.00] ただのかな');

  assert.equal(parsed.lines[0].text, '君の声が聞こえる', '화면에는 한자를 그대로 보여준다');
  assert.equal(parsed.lines[0].reading, 'きみのこえがきこえる');
  assert.equal(parsed.lines[1].reading, null, '후리가나가 없는 줄은 reading 이 없다');
});

test('단어 단위 태그 안의 후리가나도 읽는다', () => {
  const parsed = parseLrc('[00:10.00] <00:10.00>君(きみ)の <00:10.50>声(こえ)が');
  const words = parsed.lines[0].words;

  assert.equal(words[0].text, '君の');
  assert.equal(words[0].reading, 'きみの');
  assert.equal(words[1].text, '声が');
  assert.equal(words[1].reading, 'こえが');
});

test('번역을 줄 순서대로 붙인다', () => {
  const parsed = parseLrc('[00:05.00] I love you\n[00:10.00] Good night\n[00:15.00] See you');
  const summary = attachTranslation(parsed, '사랑해\n잘 자\n또 봐');

  assert.deepEqual(summary, { mode: 'index', matched: 3, total: 3 });
  assert.equal(parsed.lines[0].translation, '사랑해');
  assert.equal(parsed.lines[1].translation, '잘 자');
  assert.equal(parsed.lines[2].translation, '또 봐');
});

test('번역에 시간 태그가 있으면 시각으로 짝짓는다', () => {
  const parsed = parseLrc('[00:05.00] A\n[00:10.00] B\n[00:15.00] C');
  // 순서가 뒤섞여 있어도 시각으로 찾아간다
  const summary = attachTranslation(parsed, '[00:15.00] 다\n[00:05.00] 가\n[00:10.00] 나');

  assert.equal(summary.mode, 'time');
  assert.equal(summary.matched, 3);
  assert.equal(parsed.lines[0].translation, '가');
  assert.equal(parsed.lines[1].translation, '나');
  assert.equal(parsed.lines[2].translation, '다');
});

test('시간이 조금 어긋나도 가장 가까운 번역을 붙인다', () => {
  const parsed = parseLrc('[00:05.00] A\n[00:10.00] B');
  const summary = attachTranslation(parsed, '[00:05.30] 가\n[00:09.80] 나');

  assert.equal(summary.matched, 2);
  assert.equal(parsed.lines[0].translation, '가');
  assert.equal(parsed.lines[1].translation, '나');
});

test('시간이 많이 다르면 붙이지 않는다', () => {
  const parsed = parseLrc('[00:05.00] A\n[00:10.00] B');
  const summary = attachTranslation(parsed, '[01:30.00] 엉뚱한 줄');

  assert.equal(summary.matched, 0);
  assert.equal(parsed.lines[0].translation, null);
  assert.equal(parsed.lines[1].translation, null);
});

test('번역 줄이 모자라면 있는 만큼만 붙는다', () => {
  const parsed = parseLrc('[00:05.00] A\n[00:10.00] B\n[00:15.00] C');
  const summary = attachTranslation(parsed, '가\n나');

  assert.deepEqual(summary, { mode: 'index', matched: 2, total: 3 });
  assert.equal(parsed.lines[2].translation, null, '남는 줄은 비워 둔다');
});

test('번역을 지우면 기존 번역도 사라진다', () => {
  const parsed = parseLrc('[00:05.00] A');
  attachTranslation(parsed, '가');
  assert.equal(parsed.lines[0].translation, '가');

  const summary = attachTranslation(parsed, '');
  assert.deepEqual(summary, { mode: 'none', matched: 0, total: 1 });
  assert.equal(parsed.lines[0].translation, null);
});

test('가사가 없으면 번역도 붙지 않는다', () => {
  const parsed = parseLyrics('');
  assert.deepEqual(attachTranslation(parsed, '가\n나'), { mode: 'none', matched: 0, total: 0 });
});

test('싱크 없는 평문 가사에도 번역을 붙일 수 있다', () => {
  const parsed = parseLyrics('first line\nsecond line');
  const summary = attachTranslation(parsed, '첫 줄\n둘째 줄');

  assert.equal(summary.mode, 'index');
  assert.equal(parsed.lines[1].translation, '둘째 줄');
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
