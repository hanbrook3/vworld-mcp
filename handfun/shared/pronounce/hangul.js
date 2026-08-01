/** 한글 음절 분해/조합 유틸 */

export const BASE = 0xac00;
export const LAST = 0xd7a3;

/** 초성 19자 */
export const CHO = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** 중성 21자 */
export const JUNG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ',
];

/** 종성 28자 (0번은 받침 없음) */
export const JONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

export const CHO_INDEX = new Map(CHO.map((c, i) => [c, i]));
export const JUNG_INDEX = new Map(JUNG.map((c, i) => [c, i]));
export const JONG_INDEX = new Map(JONG.map((c, i) => [c, i]));

/** 완성형 한글 음절인가 */
export function isSyllable(ch) {
  const code = ch.codePointAt(0);
  return code >= BASE && code <= LAST;
}

/** 한글이 하나라도 포함되어 있는가 (자모 영역 포함) */
export function containsHangul(text) {
  return /[가-힣ㄱ-ㆎ]/.test(text ?? '');
}

/**
 * 음절을 자모 인덱스로 분해한다.
 * @returns {{cho: number, jung: number, jong: number} | null}
 */
export function decompose(ch) {
  if (!isSyllable(ch)) return null;
  const code = ch.codePointAt(0) - BASE;
  return {
    cho: Math.floor(code / 588),
    jung: Math.floor((code % 588) / 28),
    jong: code % 28,
  };
}

/** 자모 인덱스를 음절 문자로 조합한다. */
export function compose(cho, jung, jong = 0) {
  return String.fromCodePoint(BASE + cho * 588 + jung * 28 + jong);
}

/**
 * 겹받침을 [앞, 뒤] 홑자음으로 나눈다. 겹받침이 아니면 null.
 * 연음될 때 뒤 자음만 다음 음절 초성으로 넘어간다.
 */
const CLUSTER_SPLIT = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
};

export function splitCluster(jongChar) {
  return CLUSTER_SPLIT[jongChar] ?? null;
}

/**
 * 받침의 대표음(음절 끝에서 실제로 나는 소리). 7종성 법칙.
 */
const REPRESENTATIVE = {
  ㄱ: 'ㄱ', ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㄳ: 'ㄱ', ㄺ: 'ㄱ',
  ㄴ: 'ㄴ', ㄵ: 'ㄴ', ㄶ: 'ㄴ',
  ㄷ: 'ㄷ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ',
  ㄹ: 'ㄹ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㅀ: 'ㄹ',
  ㅁ: 'ㅁ', ㄻ: 'ㅁ',
  ㅂ: 'ㅂ', ㅍ: 'ㅂ', ㅄ: 'ㅂ', ㄿ: 'ㅂ',
  ㅇ: 'ㅇ',
};

export function representativeCoda(jongChar) {
  if (!jongChar) return '';
  return REPRESENTATIVE[jongChar] ?? jongChar;
}

/** 초성으로 쓸 수 있는 자음인지 */
export function canBeOnset(jamo) {
  return CHO_INDEX.has(jamo);
}

/** 종성으로 쓸 수 있는 자음인지 */
export function canBeCoda(jamo) {
  return jamo === '' || JONG_INDEX.has(jamo);
}
