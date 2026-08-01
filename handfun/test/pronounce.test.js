import test from 'node:test';
import assert from 'node:assert/strict';

import { koToRoman, koToPhoneticHangul } from '../shared/pronounce/ko-roman.js';
import { enToHangul, enToPhones, phonesToHangul } from '../shared/pronounce/en-hangul.js';
import { jaToHangul, jaToRomaji } from '../shared/pronounce/ja-hangul.js';
import { pronounce, detectLanguage, resolveStyle } from '../shared/pronounce/index.js';
import { decompose, compose } from '../shared/pronounce/hangul.js';

test('한글 음절을 분해하고 다시 조합한다', () => {
  const parts = decompose('밝');
  assert.deepEqual(parts, { cho: 7, jung: 0, jong: 9 }); // ㅂ ㅏ ㄺ
  assert.equal(compose(parts.cho, parts.jung, parts.jong), '밝');
  assert.equal(decompose('A'), null);
  assert.equal(compose(0, 0, 0), '가');
});

test('한국어 음운 변동을 반영해 소리대로 적는다', () => {
  const cases = [
    ['한국어', '한구거'], // 연음
    ['좋아요', '조아요'], // ㅎ 탈락
    ['학교', '학꾜'], // 경음화
    ['국물', '궁물'], // 비음화
    ['신라', '실라'], // 유음화
    ['설날', '설랄'], // 유음화
    ['같이', '가치'], // 구개음화
    ['굳이', '구지'], // 구개음화
    ['입학', '이팍'], // 격음화
    ['놓다', '노타'], // 격음화
    ['읽어', '일거'], // 겹받침 연음
    ['없다', '업따'],
    ['종로', '종노'],
    ['독립', '동닙'],
    ['밝히다', '발키다'],
    ['괜찮아', '괜차나'],
    ['꽃이', '꼬치'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(koToPhoneticHangul(input), expected, `${input} 의 발음`);
  }
});

test('한국어를 로마자로 적는다', () => {
  const cases = [
    ['한국어', 'hangugeo'],
    ['사랑해', 'saranghae'],
    ['신라', 'silla'],
    ['학교', 'hakkyo'],
    ['종로', 'jongno'],
    ['같이', 'gachi'],
    ['좋아요', 'joayo'],
    ['노래방', 'noraebang'],
    ['꽃이', 'kkochi'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(koToRoman(input), expected, `${input} 의 로마자`);
  }
});

test('한국어 변환은 공백과 문장부호를 보존한다', () => {
  assert.equal(koToRoman('사랑해, 정말!'), 'saranghae, jeongmal!');
  assert.equal(koToPhoneticHangul('밥 먹어'), '밥 머거');
  assert.equal(koToRoman('hello'), 'hello', '한글이 없으면 그대로 둔다');
});

test('영어를 한글 발음으로 적는다', () => {
  const cases = [
    ['love', '러브'],
    ['heart', '하트'],
    ['night', '나이트'],
    ['time', '타임'],
    ['world', '월드'],
    ['dance', '댄스'],
    ['baby', '베이비'],
    ['hello', '헬로'],
    ['blue', '블루'],
    ['little', '리틀'],
    ['people', '피플'],
    ['music', '뮤직'],
    ['always', '올웨이즈'],
    ['fly', '플라이'],
    ['tonight', '투나이트'],
    ['make', '메이크'],
    ['you', '유'],
    ['my', '마이'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(enToHangul(input), expected, `${input} 의 발음`);
  }
});

test('영어 문장의 공백과 문장부호를 보존한다', () => {
  assert.equal(enToHangul('give you up, now!'), '기브 유 업, 나우!');
  assert.equal(enToHangul('123'), '123');
});

test('발음기호에서 한글로 조립한다', () => {
  assert.equal(phonesToHangul(['K', 'AE', 'T']), '캣', '짧은 모음 뒤 무성파열음은 받침');
  assert.equal(phonesToHangul(['M', 'EY', 'K']), '메이크', '장모음 뒤에는 으를 붙인다');
  assert.equal(phonesToHangul(['K', 'AA', 'R']), '카', '모음 뒤 R 은 적지 않는다');
  assert.equal(phonesToHangul([]), '');
  assert.deepEqual(enToPhones('the'), ['DH', 'AH'], '사전을 먼저 본다');
});

test('일본어 가나를 한글과 로마자로 적는다', () => {
  const cases = [
    ['わたし', '와타시', 'watashi'],
    ['ありがとう', '아리가토', 'arigatou'],
    ['とうきょう', '도쿄', 'toukyou'],
    ['がっこう', '갓코', 'gakkou'],
    ['ラーメン', '라멘', 'raamen'],
    ['しんじゅく', '신주쿠', 'shinjuku'],
    ['ちょっと', '좃토', 'chotto'],
    ['ファイト', '파이토', 'faito'],
  ];
  for (const [input, hangul, romaji] of cases) {
    assert.equal(jaToHangul(input), hangul, `${input} 의 한글 발음`);
    assert.equal(jaToRomaji(input), romaji, `${input} 의 로마자`);
  }
});

test('일본어 か·た행은 어두에서 예사소리, 어중에서 거센소리', () => {
  assert.equal(jaToHangul('かたかな'), '가타카나');
  assert.equal(jaToHangul('たけし'), '다케시');
});

test('한자에 붙은 가나는 한 덩어리로 읽는다', () => {
  // 한자는 그대로 두되, 뒤따르는 가나는 어중으로 판정되어야 한다
  const result = pronounce('君と歩く道', 'hangul');
  assert.ok(result.includes('토'), `어중 と 는 '토' 여야 한다: ${result}`);
  assert.ok(result.includes('쿠'), `어중 く 는 '쿠' 여야 한다: ${result}`);
});

test('언어를 판별한다', () => {
  assert.equal(detectLanguage('안녕하세요'), 'ko');
  assert.equal(detectLanguage('hello world'), 'en');
  assert.equal(detectLanguage('こんにちは'), 'ja');
  assert.equal(detectLanguage('가사 with English'), 'ko', '한글이 있으면 한국어');
  assert.equal(detectLanguage('12345'), 'unknown');
});

test('auto 는 가사 언어에 맞춰 표기 방식을 고른다', () => {
  assert.equal(resolveStyle('auto', '사랑해'), 'roman');
  assert.equal(resolveStyle('auto', 'I love you'), 'hangul');
  assert.equal(resolveStyle('hangul', '사랑해'), 'hangul', '지정하면 그대로 쓴다');
});

test('한 줄에 섞인 언어를 각각 변환한다', () => {
  assert.equal(pronounce('Dance the night away', 'hangul'), '댄스 더 나이트 어웨이');
  assert.equal(pronounce('사랑해 Baby 너와 나', 'roman'), 'saranghae Baby neowa na');

  const mixed = pronounce('밤새 dreaming', 'hangul');
  assert.ok(mixed.includes('드리밍'), `영어 부분이 한글이 되어야 한다: ${mixed}`);
});

test('표기할 것이 없으면 null 을 돌려준다', () => {
  assert.equal(pronounce('사랑해', 'off'), null);
  assert.equal(pronounce('', 'auto'), null);
  assert.equal(pronounce('   ', 'auto'), null);
  assert.equal(pronounce('1234 !!', 'hangul'), null, '변환 결과가 원문과 같으면 표시하지 않는다');
});
