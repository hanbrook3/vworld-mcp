/**
 * 일본어(가나) → 한글 발음 / 로마자.
 *
 * 외래어 표기법의 일본어 규칙을 따른다.
 *  - か행·た행은 어두에서 'ㄱ/ㄷ', 어중·어말에서 'ㅋ/ㅌ' (かた → 가타)
 *  - 촉음(っ)은 'ㅅ' 받침 (さっか → 삿카)
 *  - 발음(ん)은 'ㄴ' 받침 (ほん → 혼)
 *  - 장음(ー)은 적지 않는다 (ラーメン → 라멘)
 *
 * 한자는 읽는 법이 사전 없이는 결정되지 않으므로 그대로 남긴다.
 */

import { decompose, compose, JONG_INDEX } from './hangul.js';

/** "가나 로마자 어두한글 어중한글" 묶음 */
const TABLE_SOURCE = `
あ a 아 아|い i 이 이|う u 우 우|え e 에 에|お o 오 오
か ka 가 카|き ki 기 키|く ku 구 쿠|け ke 게 케|こ ko 고 코
が ga 가 가|ぎ gi 기 기|ぐ gu 구 구|げ ge 게 게|ご go 고 고
さ sa 사 사|し shi 시 시|す su 스 스|せ se 세 세|そ so 소 소
ざ za 자 자|じ ji 지 지|ず zu 즈 즈|ぜ ze 제 제|ぞ zo 조 조
た ta 다 타|ち chi 지 치|つ tsu 쓰 쓰|て te 데 테|と to 도 토
だ da 다 다|ぢ ji 지 지|づ zu 즈 즈|で de 데 데|ど do 도 도
な na 나 나|に ni 니 니|ぬ nu 누 누|ね ne 네 네|の no 노 노
は ha 하 하|ひ hi 히 히|ふ fu 후 후|へ he 헤 헤|ほ ho 호 호
ば ba 바 바|び bi 비 비|ぶ bu 부 부|べ be 베 베|ぼ bo 보 보
ぱ pa 파 파|ぴ pi 피 피|ぷ pu 푸 푸|ぺ pe 페 페|ぽ po 포 포
ま ma 마 마|み mi 미 미|む mu 무 무|め me 메 메|も mo 모 모
や ya 야 야|ゆ yu 유 유|よ yo 요 요
ら ra 라 라|り ri 리 리|る ru 루 루|れ re 레 레|ろ ro 로 로
わ wa 와 와|ゐ i 이 이|ゑ e 에 에|を o 오 오|ゔ vu 부 부
きゃ kya 갸 캬|きゅ kyu 규 큐|きょ kyo 교 쿄
ぎゃ gya 갸 갸|ぎゅ gyu 규 규|ぎょ gyo 교 교
しゃ sha 샤 샤|しゅ shu 슈 슈|しょ sho 쇼 쇼|しぇ she 셰 셰
じゃ ja 자 자|じゅ ju 주 주|じょ jo 조 조|じぇ je 제 제
ちゃ cha 자 차|ちゅ chu 주 추|ちょ cho 조 초|ちぇ che 제 체
にゃ nya 냐 냐|にゅ nyu 뉴 뉴|にょ nyo 뇨 뇨
ひゃ hya 햐 햐|ひゅ hyu 휴 휴|ひょ hyo 효 효
びゃ bya 뱌 뱌|びゅ byu 뷰 뷰|びょ byo 뵤 뵤
ぴゃ pya 퍄 퍄|ぴゅ pyu 퓨 퓨|ぴょ pyo 표 표
みゃ mya 먀 먀|みゅ myu 뮤 뮤|みょ myo 묘 묘
りゃ rya 랴 랴|りゅ ryu 류 류|りょ ryo 료 료
ふぁ fa 파 파|ふぃ fi 피 피|ふぇ fe 페 페|ふぉ fo 포 포
てぃ ti 티 티|でぃ di 디 디|とぅ tu 투 투|どぅ du 두 두
うぃ wi 위 위|うぇ we 웨 웨|うぉ wo 워 워
ゔぁ va 바 바|ゔぃ vi 비 비|ゔぇ ve 베 베|ゔぉ vo 보 보
`;

/** @type {Map<string, {romaji: string, initial: string, medial: string}>} */
const KANA = (() => {
  const map = new Map();
  for (const entry of TABLE_SOURCE.split(/[|\n]/)) {
    const parts = entry.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 4) continue;
    map.set(parts[0], { romaji: parts[1], initial: parts[2], medial: parts[3] });
  }
  return map;
})();

const SOKUON = new Set(['っ', 'ッ']); // 촉음
const HATSUON = new Set(['ん', 'ン']); // 발음
const CHOON = new Set(['ー', '－', '―']); // 장음

/** 가타카나를 히라가나로 바꾼다 (표는 히라가나 기준) */
function toHiragana(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
  return ch;
}

export function containsKana(text) {
  return /[぀-ヿ]/.test(text ?? '');
}

export function containsJapanese(text) {
  return /[぀-ヿ一-鿿]/.test(text ?? '');
}

/** 앞 음절에 받침을 덧붙인다. */
function attachCoda(syllables, jamo) {
  const last = syllables[syllables.length - 1];
  if (!last) return false;
  const parts = decompose(last);
  if (!parts || parts.jong !== 0) return false;
  syllables[syllables.length - 1] = compose(parts.cho, parts.jung, JONG_INDEX.get(jamo) ?? 0);
  return true;
}

/**
 * 가나 문자열을 훑으며 음절 단위로 처리한다.
 * @param {string} text
 * @param {(unit: {kana: string, entry: object, isInitial: boolean}) => void} onSyllable
 */
function walk(text, handlers) {
  const chars = Array.from(String(text ?? ''));
  let i = 0;
  let isInitial = true;
  let prevRomaji = '';

  while (i < chars.length) {
    const raw = chars[i];
    const ch = toHiragana(raw);

    if (SOKUON.has(raw)) {
      handlers.sokuon();
      i++;
      continue;
    }
    if (HATSUON.has(raw)) {
      handlers.hatsuon();
      isInitial = false;
      prevRomaji = 'n';
      i++;
      continue;
    }
    if (CHOON.has(raw)) {
      handlers.choon(raw);
      i++;
      continue;
    }

    // お단·う단 뒤의 う(와 お 뒤의 お)는 장모음이라 한글로는 적지 않는다
    // (とうきょう → 도쿄, がっこう → 갓코)
    if (!isInitial && prevRomaji && (ch === 'う' || ch === 'お')) {
      const isLong = ch === 'う' ? /[ou]$/.test(prevRomaji) : /o$/.test(prevRomaji);
      if (isLong) {
        handlers.choon(raw);
        i++;
        continue;
      }
    }

    // 요음(작은 ゃゅょ)이나 외래어용 작은 모음이 붙는지 먼저 본다
    const next = chars[i + 1] ? toHiragana(chars[i + 1]) : '';
    const digraph = ch + next;
    if (next && KANA.has(digraph)) {
      const entry = KANA.get(digraph);
      handlers.syllable(entry, isInitial);
      isInitial = false;
      prevRomaji = entry.romaji;
      i += 2;
      continue;
    }

    if (KANA.has(ch)) {
      const entry = KANA.get(ch);
      handlers.syllable(entry, isInitial);
      isInitial = false;
      prevRomaji = entry.romaji;
      i++;
      continue;
    }

    handlers.other(raw);
    prevRomaji = '';
    // 공백·구두점 뒤는 다시 어두로 본다. 한자 뒤는 같은 단어가 이어지는 것으로 본다.
    if (/[\s\p{P}]/u.test(raw)) isInitial = true;
    else if (/[一-鿿]/.test(raw)) isInitial = false;
    i++;
  }
}

/**
 * 일본어를 한글 발음으로 옮긴다.
 * @param {string} text
 */
export function jaToHangul(text) {
  const out = [];
  let pendingSokuon = false;

  walk(text, {
    syllable(entry, isInitial) {
      const syllable = isInitial ? entry.initial : entry.medial;
      if (pendingSokuon) {
        attachCoda(out, 'ㅅ');
        pendingSokuon = false;
      }
      out.push(syllable);
    },
    sokuon() {
      pendingSokuon = true;
    },
    hatsuon() {
      if (!attachCoda(out, 'ㄴ')) out.push('은');
    },
    choon() {
      /* 장음은 표기하지 않는다 */
    },
    other(ch) {
      pendingSokuon = false;
      out.push(ch);
    },
  });

  return out.join('');
}

/**
 * 일본어를 헵번식 로마자로 옮긴다.
 * @param {string} text
 */
export function jaToRomaji(text) {
  const out = [];
  let pendingSokuon = false;

  walk(text, {
    syllable(entry) {
      let romaji = entry.romaji;
      if (pendingSokuon) {
        // 촉음은 뒤 자음을 겹쳐 적는다 (さっか → sakka)
        romaji = romaji[0] + romaji;
        pendingSokuon = false;
      }
      out.push(romaji);
    },
    sokuon() {
      pendingSokuon = true;
    },
    hatsuon() {
      out.push('n');
    },
    choon(raw) {
      if (CHOON.has(raw)) {
        // 'ー' 는 앞 모음을 한 번 더 적는다 (ラーメン → raamen)
        const vowel = out[out.length - 1]?.match(/[aeiou]$/)?.[0];
        if (vowel) out.push(vowel);
      } else {
        // 장음으로 쓰인 う/お 는 로마자에서는 그대로 살린다 (とうきょう → toukyou)
        out.push(toHiragana(raw) === 'う' ? 'u' : 'o');
      }
    },
    other(ch) {
      pendingSokuon = false;
      out.push(ch);
    },
  });

  return out.join('');
}
