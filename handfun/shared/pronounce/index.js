/**
 * 발음 표기 통합 진입점.
 *
 * 가사 한 줄에 여러 언어가 섞이는 경우가 많아서(K-POP 가사가 특히 그렇다)
 * 문자 종류별로 구간을 나눈 뒤 각각에 맞는 변환기를 적용한다.
 */

import { koToRoman, koToPhoneticHangul } from './ko-roman.js';
import { enToHangul } from './en-hangul.js';
import { jaToHangul, jaToRomaji } from './ja-hangul.js';

export { koToRoman, koToPhoneticHangul, enToHangul, jaToHangul, jaToRomaji };

/** 사용자가 고를 수 있는 발음 표기 방식 */
export const PRONUNCIATION_STYLES = [
  { id: 'auto', label: '자동', hint: '한국어 가사는 로마자, 외국어 가사는 한글' },
  { id: 'hangul', label: '한글 발음', hint: '외국 노래를 한글로 따라 부르기' },
  { id: 'roman', label: '로마자', hint: '한국 노래를 알파벳으로 따라 부르기' },
  { id: 'off', label: '표시 안 함', hint: '가사만 보기' },
];

const SCRIPT_PATTERNS = [
  ['ko', /[가-힣ㄱ-ㆎ]/],
  ['kana', /[぀-ヿ]/],
  ['han', /[一-鿿]/],
  ['latin', /[A-Za-z]/],
];

/** 문자 하나의 문자 종류를 판별한다. */
function scriptOf(ch) {
  for (const [name, re] of SCRIPT_PATTERNS) {
    if (re.test(ch)) return name;
  }
  return 'other';
}

/** 같은 문자 종류끼리 묶는다. */
function segment(text) {
  const runs = [];
  for (const ch of String(text ?? '')) {
    const script = scriptOf(ch);
    const last = runs[runs.length - 1];
    if (last && last.script === script) last.text += ch;
    else runs.push({ script, text: ch });
  }
  return mergeJapanese(runs);
}

/**
 * 가나에 붙어 있는 한자는 같은 일본어 덩어리로 합친다.
 * 그래야 어두/어중 판정이 맞는다 (君と歩く → 기미토아루쿠 의 '토').
 * 가나 없이 한자만 있는 구간은 그대로 둔다 (한국어 한자·중국어일 수 있다).
 */
function mergeJapanese(runs) {
  const out = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const prev = out[out.length - 1];
    const attachesToKana =
      run.script === 'han' && (prev?.script === 'kana' || runs[i + 1]?.script === 'kana');

    if (run.script === 'kana' || attachesToKana) {
      if (prev?.script === 'kana') prev.text += run.text;
      else out.push({ script: 'kana', text: run.text });
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/**
 * 텍스트의 대표 언어를 추정한다.
 * @returns {'ko'|'ja'|'en'|'unknown'}
 */
export function detectLanguage(text) {
  const counts = { ko: 0, kana: 0, han: 0, latin: 0 };
  for (const ch of String(text ?? '')) {
    const script = scriptOf(ch);
    if (script in counts) counts[script]++;
  }
  // 가나가 하나라도 있으면 일본어로 본다 (한자만으로는 중국어와 구분되지 않는다)
  if (counts.kana > 0) return 'ja';
  if (counts.ko > 0) return 'ko';
  if (counts.latin > 0) return 'en';
  return 'unknown';
}

/** 'auto' 를 실제 표기 방식으로 바꾼다. */
export function resolveStyle(style, text) {
  if (style !== 'auto') return style;
  // 한국어 가사에 한글 발음을 달아봐야 도움이 안 되므로 로마자를 쓴다
  return detectLanguage(text) === 'ko' ? 'roman' : 'hangul';
}

/**
 * 한 줄의 발음 표기를 만든다.
 * @param {string} text
 * @param {'auto'|'hangul'|'roman'|'off'} [style]
 * @returns {string|null} 표기할 것이 없으면 null
 */
export function pronounce(text, style = 'auto') {
  const source = String(text ?? '');
  if (!source.trim() || style === 'off') return null;

  const target = resolveStyle(style, source);
  let out = '';

  for (const run of segment(source)) {
    out += convertRun(run, target);
  }

  const result = out.trim();
  // 원문과 같으면 굳이 한 줄 더 띄울 이유가 없다
  return result && result !== source.trim() ? result : null;
}

function convertRun(run, target) {
  const { script, text } = run;
  if (target === 'hangul') {
    if (script === 'latin') return enToHangul(text);
    if (script === 'kana') return jaToHangul(text);
    if (script === 'ko') return koToPhoneticHangul(text);
    return text; // 한자는 사전 없이 읽을 수 없어 그대로 둔다
  }
  if (target === 'roman') {
    if (script === 'ko') return koToRoman(text);
    if (script === 'kana') return jaToRomaji(text);
    return text;
  }
  return text;
}
