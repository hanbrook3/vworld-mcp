/**
 * 한국어 발음 변환.
 *
 * 표기 그대로가 아니라 "소리 나는 대로" 바꾼 뒤 로마자로 옮긴다.
 * 적용 규칙: 구개음화 → ㅎ 축약·탈락 → 연음/대표음 → 경음화 → 비음화 → 유음화
 *
 * 결과물은 두 가지다.
 *  - koToRoman(text)          : 국어의 로마자 표기법 기반 로마자
 *  - koToPhoneticHangul(text) : 소리 나는 대로 적은 한글 (예: 한국어 → 한구거)
 */

import {
  decompose,
  compose,
  CHO,
  JUNG,
  JONG,
  CHO_INDEX,
  JUNG_INDEX,
  JONG_INDEX,
  splitCluster,
  representativeCoda,
  containsHangul,
} from './hangul.js';

const ONSET_ROMAN = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp',
  ㅅ: 's', ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
};

const VOWEL_ROMAN = {
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e', ㅕ: 'yeo', ㅖ: 'ye',
  ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe', ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we',
  ㅟ: 'wi', ㅠ: 'yu', ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};

const CODA_ROMAN = {
  '': '', ㄱ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅇ: 'ng',
};

/**
 * 파열음 받침 바로 뒤의 된소리는 홑자로 적는다.
 * (학교 → hak+kyo = hakkyo. 그대로 쓰면 hakkkyo 가 되어 읽기 어렵다.)
 */
const TENSE_AFTER_STOP = { ㄲ: 'k', ㄸ: 't', ㅃ: 'p', ㅆ: 's', ㅉ: 'j' };
const STOP_CODAS = new Set(['ㄱ', 'ㄷ', 'ㅂ']);

/** 된소리 짝 */
const TENSE = { ㄱ: 'ㄲ', ㄷ: 'ㄸ', ㅂ: 'ㅃ', ㅅ: 'ㅆ', ㅈ: 'ㅉ' };
/** 거센소리 짝 */
const ASPIRATE = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅂ: 'ㅍ', ㅈ: 'ㅊ', ㅅ: 'ㅆ' };
/** 구개음화 대상 모음 */
const PALATAL_VOWELS = new Set(['ㅣ', 'ㅑ', 'ㅒ', 'ㅕ', 'ㅖ', 'ㅛ', 'ㅠ']);

/** 텍스트를 음절 단위 토큰으로 나눈다. 한글이 아닌 문자는 그대로 보존한다. */
function tokenize(text) {
  const units = [];
  for (const ch of String(text ?? '')) {
    const parts = decompose(ch);
    if (parts) {
      units.push({
        syl: true,
        cho: CHO[parts.cho],
        jung: JUNG[parts.jung],
        jong: JONG[parts.jong],
      });
    } else {
      units.push({ syl: false, text: ch });
    }
  }
  return units;
}

/** i번째와 i+1번째가 붙어 있는 한글 음절 쌍인지 */
function pairAt(units, i) {
  const a = units[i];
  const b = units[i + 1];
  if (!a?.syl || !b?.syl) return null;
  return [a, b];
}

/**
 * 음운 변동을 적용한다. units 를 제자리에서 수정한다.
 */
function applyPhonology(units) {
  const n = units.length;

  // 1) 구개음화: 받침 ㄷ/ㅌ + 이/야/여… → ㅈ/ㅊ
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;
    if (b.cho !== 'ㅇ' || !PALATAL_VOWELS.has(b.jung)) continue;

    if (a.jong === 'ㄷ') {
      a.jong = '';
      b.cho = 'ㅈ';
    } else if (a.jong === 'ㅌ') {
      a.jong = '';
      b.cho = 'ㅊ';
    } else if (a.jong === 'ㄾ') {
      a.jong = 'ㄹ';
      b.cho = 'ㅊ';
    }
  }

  // 2) ㅎ 축약(격음화)과 ㅎ 탈락
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;

    // 2-a) 앞 음절 받침에 ㅎ 이 있는 경우
    if (a.jong === 'ㅎ' || a.jong === 'ㄶ' || a.jong === 'ㅀ') {
      const residue = a.jong === 'ㄶ' ? 'ㄴ' : a.jong === 'ㅀ' ? 'ㄹ' : '';
      if (ASPIRATE[b.cho]) {
        b.cho = ASPIRATE[b.cho];
        a.jong = residue;
      } else if (b.cho === 'ㅇ') {
        a.jong = residue; // 좋아 → 조아, 많아 → 마나
      } else if (b.cho === 'ㄴ') {
        a.jong = residue || 'ㄴ'; // 놓는 → 논는
      } else {
        a.jong = residue || 'ㄷ';
      }
      continue;
    }

    // 2-b) 뒤 음절 초성이 ㅎ 인 경우 (입학 → 이팍, 읽히다 → 일키다)
    if (b.cho === 'ㅎ' && a.jong) {
      const cluster = splitCluster(a.jong);
      const tail = cluster ? cluster[1] : a.jong;
      const rep = representativeCoda(tail);
      if (ASPIRATE[rep] && rep !== 'ㅅ') {
        b.cho = ASPIRATE[rep];
        a.jong = cluster ? cluster[0] : '';
      }
    }
  }

  // 3) 연음, 그리고 연음되지 않는 받침의 대표음화
  for (let i = 0; i < n; i++) {
    const a = units[i];
    if (!a?.syl || !a.jong) continue;
    const b = units[i + 1]?.syl ? units[i + 1] : null;

    if (b && b.cho === 'ㅇ' && a.jong !== 'ㅇ') {
      const cluster = splitCluster(a.jong);
      if (cluster) {
        a.jong = cluster[0];
        b.cho = cluster[1];
      } else {
        b.cho = a.jong;
        a.jong = '';
      }
    } else {
      a.jong = representativeCoda(a.jong);
    }
  }

  // 4) 경음화: ㄱ/ㄷ/ㅂ 받침 뒤의 예사소리가 된소리로
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;
    if ((a.jong === 'ㄱ' || a.jong === 'ㄷ' || a.jong === 'ㅂ') && TENSE[b.cho]) {
      b.cho = TENSE[b.cho];
    }
  }

  // 5-1) 비음 뒤 ㄹ → ㄴ (종로 → 종노, 독립 → 독닙)
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;
    if (b.cho === 'ㄹ' && ['ㄱ', 'ㅂ', 'ㅁ', 'ㅇ'].includes(a.jong)) {
      b.cho = 'ㄴ';
    }
  }

  // 5-2) 비음화: ㄱ/ㄷ/ㅂ + ㄴ/ㅁ → ㅇ/ㄴ/ㅁ (독닙 → 동닙, 국물 → 궁물)
  const NASALIZE = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;
    if ((b.cho === 'ㄴ' || b.cho === 'ㅁ') && NASALIZE[a.jong]) {
      a.jong = NASALIZE[a.jong];
    }
  }

  // 6) 유음화: ㄴ+ㄹ, ㄹ+ㄴ → ㄹㄹ (신라 → 실라, 설날 → 설랄)
  for (let i = 0; i < n - 1; i++) {
    const pair = pairAt(units, i);
    if (!pair) continue;
    const [a, b] = pair;
    if (a.jong === 'ㄴ' && b.cho === 'ㄹ') a.jong = 'ㄹ';
    else if (a.jong === 'ㄹ' && b.cho === 'ㄴ') b.cho = 'ㄹ';
  }

  return units;
}

/**
 * 한국어를 로마자 발음으로 옮긴다.
 * @param {string} text
 * @returns {string}
 */
export function koToRoman(text) {
  if (!containsHangul(text)) return String(text ?? '');
  const units = applyPhonology(tokenize(text));

  let out = '';
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.syl) {
      out += u.text;
      continue;
    }
    const prev = units[i - 1];
    let onset;
    if (u.cho === 'ㄹ' && prev?.syl && prev.jong === 'ㄹ') {
      onset = 'l'; // ㄹ 받침 뒤의 ㄹ 초성 → 'll' (실라 → silla)
    } else if (prev?.syl && STOP_CODAS.has(prev.jong) && TENSE_AFTER_STOP[u.cho]) {
      onset = TENSE_AFTER_STOP[u.cho];
    } else {
      onset = ONSET_ROMAN[u.cho] ?? '';
    }
    out += onset + (VOWEL_ROMAN[u.jung] ?? '') + (CODA_ROMAN[u.jong] ?? '');
  }
  return out;
}

/**
 * 한국어를 소리 나는 대로 적은 한글로 옮긴다. (한국어 → 한구거)
 * @param {string} text
 * @returns {string}
 */
export function koToPhoneticHangul(text) {
  if (!containsHangul(text)) return String(text ?? '');
  const units = applyPhonology(tokenize(text));

  let out = '';
  for (const u of units) {
    if (!u.syl) {
      out += u.text;
      continue;
    }
    const cho = CHO_INDEX.get(u.cho) ?? CHO_INDEX.get('ㅇ');
    const jung = JUNG_INDEX.get(u.jung) ?? 0;
    const jong = JONG_INDEX.get(u.jong) ?? 0;
    out += compose(cho, jung, jong);
  }
  return out;
}
