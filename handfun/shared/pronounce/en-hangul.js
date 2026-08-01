/**
 * 영어 → 한글 발음 표기.
 *
 * 3단계로 처리한다.
 *   1) 불규칙 단어는 사전에서 바로 발음기호를 찾는다 (가사에 자주 나오는 단어 위주)
 *   2) 사전에 없으면 철자 규칙(G2P)으로 발음기호를 추정한다
 *   3) 발음기호를 한글 음절로 조립한다 (외래어 표기법의 주요 원칙을 따른다)
 *
 * 영어 철자는 발음이 불규칙해서 100% 정확할 수 없다.
 * 노래를 따라 부를 수 있는 수준의 근사치를 목표로 한다.
 */

import { compose, CHO_INDEX, JUNG_INDEX, JONG_INDEX } from './hangul.js';

// ---------------------------------------------------------------------------
// 1) 불규칙 단어 사전
// ---------------------------------------------------------------------------

/** "단어 발음기호" 형식. 가사에서 빈도가 높고 규칙으로는 틀리는 단어들. */
const EXCEPTION_SOURCE = `
a AH | the DH AH | of AH V | to T UW | and AE N D | is IH Z | was W AH Z | are AA R
were W ER | been B IH N | being B IY IH NG | i AY | you Y UW | your Y AO R | yours Y AO R Z
my M AY | me M IY | we W IY | he HH IY | she SH IY | they DH EY | them DH EH M | their DH EH R
this DH IH S | that DH AE T | these DH IY Z | those DH OW Z | there DH EH R | here HH IY R
what W AH T | who HH UW | whose HH UW Z | why W AY | where W EH R | when W EH N | how HH AW
one W AH N | once W AH N S | two T UW | four F AO R | eight EY T
do D UW | does D AH Z | did D IH D | done D AH N | doing D UW IH NG
go G OW | goes G OW Z | gone G AO N | going G OW IH NG | went W EH N T
have HH AE V | has HH AE Z | had HH AE D | having HH AE V IH NG
say S EY | says S EH Z | said S EH D | saying S EY IH NG
give G IH V | given G IH V AH N | live L IH V | lives L AY V Z | love L AH V | loved L AH V D
come K AH M | comes K AH M Z | coming K AH M IH NG | some S AH M | something S AH M TH IH NG
none N AH N | nothing N AH TH IH NG | anything EH N IY TH IH NG | everything EH V R IY TH IH NG
any EH N IY | many M EH N IY | very V EH R IY | every EH V R IY | ever EH V ER | never N EH V ER
again AH G EH N | against AH G EH N S T | always AO L W EY Z | also AO L S OW
because B IH K AO Z | before B IH F AO R | could K UH D | would W UH D | should SH UH D
through TH R UW | though DH OW | thought TH AO T | enough IH N AH F | laugh L AE F
eye AY | eyes AY Z | heart HH AA R T | hearts HH AA R T S | tear T IH R | tears T IH R Z
night N AY T | light L AY T | right R AY T | bright B R AY T | might M AY T | fight F AY T
sight S AY T | high HH AY | sky S K AY | sign S AY N | mind M AY N D | find F AY N D
kind K AY N D | behind B IH HH AY N D | blind B L AY N D | wind W IH N D | child CH AY L D
know N OW | known N OW N | knew N UW | new N UW | now N AW | down D AW N | town T AW N
our AW ER | hour AW ER | out AW T | about AH B AW T | without W IH TH AW T
word W ER D | world W ER L D | work W ER K | worth W ER TH | girl G ER L | first F ER S T
friend F R EH N D | friends F R EH N D Z | sure SH UH R | use Y UW Z | used Y UW Z D
break B R EY K | great G R EY T | steak S T EY K | air EH R | care K EH R | share SH EH R
more M AO R | door D AO R | floor F L AO R | poor P UH R | star S T AA R | car K AA R
far F AA R | hard HH AA R D | part P AA R T | dark D AA R K | park P AA R K | start S T AA R T
warm W AO R M | want W AA N T | watch W AA CH | walk W AO K | talk T AO K | call K AO L
all AO L | ball B AO L | fall F AO L | small S M AO L | water W AO T ER | daughter D AO T ER
dance D AE N S | chance CH AE N S | change CH EY N JH | face F EY S | place P L EY S
voice V OY S | choice CH OY S | noise N OY Z | boy B OY | joy JH OY | enjoy EH N JH OY
life L AY F | wife W AY F | time T AY M | like L AY K | make M EY K | take T EY K
name N EY M | same S EY M | game G EY M | came K EY M | home HH OW M | alone AH L OW N
phone F OW N | stone S T OW N | hope HH OW P | close K L OW Z | rose R OW Z | whole HH OW L
hold HH OW L D | cold K OW L D | old OW L D | told T OW L D | gold G OW L D | soul S OW L
show SH OW | snow S N OW | slow S L OW | grow G R OW | blow B L OW | throw TH R OW
low L OW | follow F AA L OW | tomorrow T UH M AO R OW | window W IH N D OW | yellow Y EH L OW
beautiful B Y UW T IH F UH L | beauty B Y UW T IY | people P IY P AH L | little L IH T AH L
other AH DH ER | another AH N AH DH ER | over OW V ER | only OW N L IY | most M OW S T
both B OW TH | move M UW V | prove P R UW V | lose L UW Z | choose CH UW Z | true T R UW
blue B L UW | you're Y AO R | i'm AY M | i'll AY L | it's IH T S | don't D OW N T
can't K AE N T | won't W OW N T | didn't D IH D AH N T | isn't IH Z AH N T | ain't EY N T
gonna G AO N AH | wanna W AA N AH | gotta G AA T AH | yeah Y EH | oh OW | ooh UW
baby B EY B IY | lady L EY D IY | body B AA D IY | happy HH AE P IY | pretty P R IH T IY
money M AH N IY | honey HH AH N IY | city S IH T IY | busy B IH Z IY | easy IY Z IY
together T UH G EH DH ER | forever F AO R EH V ER | remember R IH M EH M B ER
tonight T UH N AY T | today T UH D EY | maybe M EY B IY | okay OW K EY
girlfriend G ER L F R EH N D | someone S AH M W AH N | everyone EH V R IY W AH N
music M Y UW Z IH K | dream D R IY M | dreams D R IY M Z | scream S K R IY M
believe B IH L IY V | receive R IH S IY V | leave L IY V | leaves L IY V Z
please P L IY Z | peace P IY S | piece P IY S | field F IY L D | friend | fire F AY ER
desire D IH Z AY ER | higher HH AY ER | flower F L AW ER | power P AW ER | hour
answer AE N S ER | listen L IH S AH N | often AO F AH N | castle K AE S AH L
island AY L AH N D | half HH AE F | calm K AA M | palm P AA M | walking W AO K IH NG
front F R AH N T | month M AH N TH | young Y AH NG | touch T AH CH | tough T AH F
rough R AH F | cough K AO F | build B IH L D | built B IH L T | guitar G IH T AA R
guy G AY | guess G EH S | guard G AA R D | tongue T AH NG | league L IY G
heard HH ER D | hear HH IY R | near N IY R | year Y IH R | clear K L IY R | dear D IH R
early ER L IY | earth ER TH | learn L ER N | search S ER CH | turn T ER N | burn B ER N
sun S AH N | son S AH N | won W AH N | done | run R AH N | fun F AH N | gun G AH N
put P UH T | push P UH SH | full F UH L | pull P UH L | book B UH K | look L UH K
good G UH D | food F UW D | blood B L AH D | flood F L AH D | door | floor
laughter L AE F T ER | daughter | naughty N AO T IY | bought B AO T | brought B R AO T
caught K AO T | taught T AO T | fought F AO T | ought AO T | thought
women W IH M IH N | woman W UH M AH N | men M EH N | man M AE N | children CH IH L D R AH N
does | goes | shoes SH UW Z | toes T OW Z | dies D AY Z | tries T R AY Z
`;

/** @type {Map<string, string[]>} */
const EXCEPTIONS = (() => {
  const map = new Map();
  // 항목 구분자는 '|' 와 줄바꿈 둘 다이다
  for (const entry of EXCEPTION_SOURCE.split(/[|\n]/)) {
    const parts = entry.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue; // 발음기호 없이 단어만 적힌 중복 항목은 건너뛴다
    map.set(parts[0].toLowerCase(), parts.slice(1));
  }
  return map;
})();

// ---------------------------------------------------------------------------
// 2) 철자 → 발음기호 규칙
// ---------------------------------------------------------------------------

const VOWEL_LETTERS = 'aeiou';

const LONG_VOWEL = { a: ['EY'], e: ['IY'], i: ['AY'], o: ['OW'], u: ['Y', 'UW'] };
const SHORT_VOWEL = { a: ['AE'], e: ['EH'], i: ['IH'], o: ['AA'], u: ['AH'] };

/**
 * 위치 i 에서 시작하는 철자열을 발음기호로 바꾼다.
 * 각 규칙은 [정규식, 발음기호 또는 함수] 형태이며 위에서부터 먼저 맞는 것을 쓴다.
 */
const RULES = [
  // 어미 특수 패턴
  [/^tion\b/, ['SH', 'AH', 'N']],
  [/^sion\b/, ['ZH', 'AH', 'N']],
  [/^cious\b/, ['SH', 'AH', 'S']],
  [/^tious\b/, ['SH', 'AH', 'S']],
  [/^ture\b/, ['CH', 'ER']],
  [/^ought\b/, ['AO', 'T']],
  [/^aught\b/, ['AO', 'T']],
  [/^ight\b/, ['AY', 'T']],
  [/^igh\b/, ['AY']],
  [/^ing\b/, ['IH', 'NG']],
  [/^ely\b/, ['L', 'IY']],
  [/^ile\b/, ['AH', 'L']],

  // 자음 이중자·삼중자
  [/^tch/, ['CH']],
  [/^dge/, ['JH']],
  [/^sch/, ['S', 'K']],
  [/^ch/, ['CH']],
  [/^sh/, ['SH']],
  [/^ph/, ['F']],
  [/^th/, ['TH']],
  [/^wh/, ['W']],
  [/^ck/, ['K']],
  [/^qu/, ['K', 'W']],
  [/^x/, ['K', 'S']],
  [/^ng(?![aeiou])/, ['NG']],
  [/^gh(?![aeiou])/, []], // night, through 등에서 묵음
  [/^gh/, ['G']],

  // 어두 묵음
  [/^kn/, ['N'], { atStart: true }],
  [/^wr/, ['R'], { atStart: true }],
  [/^ps/, ['S'], { atStart: true }],
  [/^mb\b/, ['M']],
  [/^mn\b/, ['M']],

  // 문맥에 따라 갈리는 자음
  [/^c(?=[eiy])/, ['S']],
  [/^c/, ['K']],
  [/^g(?=[eiy])/, ['JH']],
  [/^g/, ['G']],
  [/^j/, ['JH']],
  [/^z/, ['Z']],
  [/^v/, ['V']],
  [/^f/, ['F']],

  // 모음 조합 (r 이 붙는 형태를 먼저 본다)
  [/^air/, ['EH', 'R']],
  [/^are\b/, ['EH', 'R']],
  [/^ear(?=[aeiou])/, ['IH', 'R']],
  [/^ear/, ['IH', 'R']],
  [/^eer/, ['IH', 'R']],
  [/^ier/, ['IH', 'R']],
  [/^oor/, ['AO', 'R']],
  [/^our/, ['AW', 'ER']],
  [/^ar/, ['AA', 'R']],
  [/^or/, ['AO', 'R']],
  [/^er\b/, ['ER']],
  [/^er/, ['ER']],
  [/^ir/, ['ER']],
  [/^ur/, ['ER']],

  [/^ee/, ['IY']],
  [/^ea/, ['IY']],
  [/^ai/, ['EY']],
  [/^ay/, ['EY']],
  [/^ei/, ['EY']],
  [/^ey/, ['EY']],
  [/^oa/, ['OW']],
  [/^oe/, ['OW']],
  [/^oo/, ['UW']],
  [/^ou/, ['AW']],
  [/^ow\b/, ['OW']],
  [/^ow/, ['OW']],
  [/^oi/, ['OY']],
  [/^oy/, ['OY']],
  [/^au/, ['AO']],
  // 'aw' 뒤에 모음이 오면 a + w 로 갈린다 (away, awake ↔ saw, dawn)
  [/^aw(?=[aeiou])/, ['AH', 'W']],
  [/^aw/, ['AO']],
  [/^ew/, ['UW']],
  [/^eu/, ['Y', 'UW']],
  [/^ie\b/, ['IY']],
  [/^ie/, ['IY']],
  [/^ue\b/, ['UW']],
  [/^ui/, ['UW']],
];

const SIMPLE_CONSONANT = {
  b: ['B'], d: ['D'], h: ['HH'], k: ['K'], l: ['L'], m: ['M'], n: ['N'],
  p: ['P'], r: ['R'], s: ['S'], t: ['T'], w: ['W'],
};

function isVowelLetter(ch) {
  return ch !== undefined && VOWEL_LETTERS.includes(ch);
}

/**
 * 철자에서 발음기호를 추정한다.
 * @param {string} word 소문자 알파벳만
 * @returns {string[]}
 */
export function guessPhones(word) {
  const phones = [];
  let i = 0;

  while (i < word.length) {
    const rest = word.slice(i);
    const ch = word[i];

    // 어말 묵음 e: 앞 모음을 장모음으로 만든다 (make, time, hope)
    if (ch === 'e' && i === word.length - 1 && i > 0 && phones.length > 0) {
      const prev = word[i - 1];
      if (!isVowelLetter(prev) && prev !== 'e') {
        // 'le' 로 끝나면 약모음이 하나 살아난다 (little, people)
        if (prev === 'l') {
          phones.splice(phones.length - 1, 0, 'AH');
        }
        i++;
        continue;
      }
    }

    let matched = null;
    for (const [re, out, opts] of RULES) {
      if (opts?.atStart && i !== 0) continue;
      const m = rest.match(re);
      if (m) {
        matched = { length: m[0].length, phones: out };
        break;
      }
    }
    if (matched) {
      phones.push(...matched.phones);
      i += matched.length;
      continue;
    }

    // y: 어두면 반모음, 어말이면 모음
    if (ch === 'y') {
      if (i === 0 || isVowelLetter(word[i - 1])) {
        phones.push('Y');
      } else if (i === word.length - 1) {
        // 이 y 말고 다른 모음이 없으면 [aɪ] (fly, sky, why), 있으면 [i] (happy, baby)
        const hasOtherVowel = /[aeiou]/.test(word.slice(0, i));
        phones.push(hasOtherVowel ? 'IY' : 'AY');
      } else {
        phones.push('IH');
      }
      i++;
      continue;
    }

    if (isVowelLetter(ch)) {
      // 자음 1개 + 어말 e → 장모음 (make, time, hope)
      const isMagicE =
        word[i + 1] && !isVowelLetter(word[i + 1]) && word[i + 2] === 'e' && i + 3 === word.length;
      // 자음 1개 + 어말 y → 열린 음절이라 장모음 (baby, crazy, lady)
      const isOpenBeforeY =
        word[i + 1] && !isVowelLetter(word[i + 1]) && word[i + 2] === 'y' && i + 3 === word.length;
      // 어말 모음도 길게 읽는다 (go, she, hi)
      const isOpenFinal = i === word.length - 1 && i > 0;
      const table = isMagicE || isOpenBeforeY || isOpenFinal ? LONG_VOWEL : SHORT_VOWEL;
      phones.push(...(table[ch] ?? SHORT_VOWEL[ch]));
      i++;
      continue;
    }

    const simple = SIMPLE_CONSONANT[ch];
    if (simple) {
      // 같은 자음이 겹치면 한 번만 (better, running)
      const prevPhone = phones[phones.length - 1];
      if (prevPhone !== simple[0]) phones.push(...simple);
      i++;
      continue;
    }

    i++; // 알 수 없는 문자는 건너뛴다
  }

  return phones;
}

/** 단어의 발음기호를 얻는다 (사전 우선). */
export function enToPhones(word) {
  const key = word.toLowerCase();
  const known = EXCEPTIONS.get(key);
  if (known) return known.slice();

  // 복수형/과거형은 어간을 찾아본다
  if (key.endsWith('s') && EXCEPTIONS.has(key.slice(0, -1))) {
    const stem = EXCEPTIONS.get(key.slice(0, -1)).slice();
    const last = stem[stem.length - 1];
    stem.push(['S', 'Z', 'SH', 'ZH', 'CH', 'JH'].includes(last) ? 'IH' : '');
    stem.push(['P', 'T', 'K', 'F', 'TH'].includes(last) ? 'S' : 'Z');
    return stem.filter(Boolean);
  }

  return guessPhones(key.replace(/[^a-z']/g, ''));
}

// ---------------------------------------------------------------------------
// 3) 발음기호 → 한글
// ---------------------------------------------------------------------------

const CONSONANTS = new Set([
  'P', 'B', 'T', 'D', 'K', 'G', 'CH', 'JH', 'F', 'V', 'TH', 'DH',
  'S', 'Z', 'SH', 'ZH', 'M', 'N', 'NG', 'L', 'R', 'HH',
]);
const GLIDES = new Set(['W', 'Y']);
const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);
/** 짧은 모음 뒤에서만 무성 파열음을 받침으로 적는다 */
const SHORT_VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'EH', 'IH', 'UH']);

const ONSET_JAMO = {
  P: 'ㅍ', B: 'ㅂ', T: 'ㅌ', D: 'ㄷ', K: 'ㅋ', G: 'ㄱ', CH: 'ㅊ', JH: 'ㅈ',
  F: 'ㅍ', V: 'ㅂ', TH: 'ㅅ', DH: 'ㄷ', S: 'ㅅ', Z: 'ㅈ', SH: 'ㅅ', ZH: 'ㅈ',
  M: 'ㅁ', N: 'ㄴ', NG: 'ㅇ', L: 'ㄹ', R: 'ㄹ', HH: 'ㅎ',
};

/** 모음 하나가 만들어내는 한글 모음(이중모음은 두 음절이 된다) */
const VOWEL_JAMO = {
  AA: ['ㅏ'], AE: ['ㅐ'], AH: ['ㅓ'], AO: ['ㅗ'], EH: ['ㅔ'], ER: ['ㅓ'],
  IH: ['ㅣ'], IY: ['ㅣ'], UH: ['ㅜ'], UW: ['ㅜ'], OW: ['ㅗ'],
  AY: ['ㅏ', 'ㅣ'], AW: ['ㅏ', 'ㅜ'], EY: ['ㅔ', 'ㅣ'], OY: ['ㅗ', 'ㅣ'],
};

const W_COMBINE = { ㅏ: 'ㅘ', ㅐ: 'ㅙ', ㅓ: 'ㅝ', ㅔ: 'ㅞ', ㅣ: 'ㅟ', ㅗ: 'ㅝ', ㅜ: 'ㅜ' };
const Y_COMBINE = { ㅏ: 'ㅑ', ㅐ: 'ㅒ', ㅓ: 'ㅕ', ㅔ: 'ㅖ', ㅗ: 'ㅛ', ㅜ: 'ㅠ', ㅣ: 'ㅣ' };

/** 받침으로 쓸 수 있는 자음 */
const CODA_JAMO = { P: 'ㅂ', B: 'ㅂ', T: 'ㅅ', K: 'ㄱ', G: 'ㄱ', M: 'ㅁ', N: 'ㄴ', NG: 'ㅇ', L: 'ㄹ' };
/** 받침이 안 될 때 홀로 서는 음절 [초성, 중성, 종성] */
const STANDALONE = {
  P: ['ㅍ', 'ㅡ'], B: ['ㅂ', 'ㅡ'], T: ['ㅌ', 'ㅡ'], D: ['ㄷ', 'ㅡ'], K: ['ㅋ', 'ㅡ'], G: ['ㄱ', 'ㅡ'],
  CH: ['ㅊ', 'ㅣ'], JH: ['ㅈ', 'ㅣ'], F: ['ㅍ', 'ㅡ'], V: ['ㅂ', 'ㅡ'], TH: ['ㅅ', 'ㅡ'], DH: ['ㄷ', 'ㅡ'],
  S: ['ㅅ', 'ㅡ'], Z: ['ㅈ', 'ㅡ'], SH: ['ㅅ', 'ㅣ'], ZH: ['ㅈ', 'ㅣ'], M: ['ㅁ', 'ㅡ'], N: ['ㄴ', 'ㅡ'],
  NG: ['ㅇ', 'ㅡ', 'ㅇ'], L: ['ㄹ', 'ㅡ'], HH: ['ㅎ', 'ㅡ'], W: ['ㅇ', 'ㅜ'], Y: ['ㅇ', 'ㅣ'],
};
/** 항상 받침으로 붙이는 자음 */
const ALWAYS_CODA = new Set(['M', 'N', 'NG', 'L']);

function buildSyllable(onsetJamo, vowelJamo, codaJamo = '') {
  return compose(
    CHO_INDEX.get(onsetJamo || 'ㅇ') ?? CHO_INDEX.get('ㅇ'),
    JUNG_INDEX.get(vowelJamo) ?? JUNG_INDEX.get('ㅏ'),
    JONG_INDEX.get(codaJamo) ?? 0,
  );
}

/**
 * 발음기호 배열을 한글로 조립한다.
 * @param {string[]} phones
 * @returns {string}
 */
export function phonesToHangul(phones) {
  /** @type {{onset: string, vowel: string, coda: string}[]} */
  const syllables = [];
  let lastVowelShort = false;
  let i = 0;

  /** phones[at] 이 다음 음절의 초성으로 쓰이는가 */
  const startsNextSyllable = (at) => {
    if (!CONSONANTS.has(phones[at])) return false;
    const n1 = phones[at + 1];
    // ㄹ 뒤에 반모음이 오면 받침으로만 적는다 (always 올웨이즈)
    if (phones[at] === 'L' && GLIDES.has(n1)) return false;
    if (VOWELS.has(n1)) return true;
    return GLIDES.has(n1) && VOWELS.has(phones[at + 2]);
  };

  while (i < phones.length) {
    const p = phones[i];

    // --- 초성 + (반모음) + 모음 ---
    let onset = '';
    if (CONSONANTS.has(p) && startsNextSyllable(i)) {
      onset = p;
      i++;

      // 앞 음절이 받침 없이 끝났다면 ㄹ 초성은 'ㄹㄹ' 로 적는다
      // (hello 헬로, blue 블루, play 플레이)
      if (onset === 'L') {
        const last = syllables[syllables.length - 1];
        if (last && !last.coda) last.coda = 'ㄹ';
      }
    }

    let glide = null;
    if (GLIDES.has(phones[i]) && VOWELS.has(phones[i + 1])) {
      glide = phones[i];
      i++;
    }

    if (VOWELS.has(phones[i])) {
      const vowel = phones[i];
      i++;
      const jamos = (VOWEL_JAMO[vowel] ?? ['ㅏ']).slice();

      // 어말 ㄹ 앞의 약모음은 'ㅡ' 로 적는다 (little 리틀, people 피플)
      if (vowel === 'AH' && phones[i] === 'L' && i + 1 === phones.length) {
        jamos[0] = 'ㅡ';
      }
      // sh 는 뒤 모음을 이중모음으로 만든다 (shy 샤이, she 시)
      if (onset === 'SH' || onset === 'ZH') jamos[0] = Y_COMBINE[jamos[0]] ?? jamos[0];
      if (glide === 'W') jamos[0] = W_COMBINE[jamos[0]] ?? jamos[0];
      if (glide === 'Y') jamos[0] = Y_COMBINE[jamos[0]] ?? jamos[0];

      syllables.push({ onset: ONSET_JAMO[onset] ?? '', vowel: jamos[0], coda: '' });
      for (let k = 1; k < jamos.length; k++) {
        syllables.push({ onset: '', vowel: jamos[k], coda: '' });
      }
      lastVowelShort = SHORT_VOWELS.has(vowel);
      continue;
    }

    // --- 모음이 따라오지 않는 자음: 받침이거나 홀로 선 음절 ---
    if (CONSONANTS.has(p) || GLIDES.has(p)) {
      // 모음 뒤의 R 은 적지 않고 앞 모음을 길게 만든다 (car 카, part 파트)
      if (p === 'R') {
        lastVowelShort = false;
        i++;
        continue;
      }

      const last = syllables[syllables.length - 1];
      const canAttach = last && !last.coda && CODA_JAMO[p];
      if (canAttach && (ALWAYS_CODA.has(p) || lastVowelShort)) {
        last.coda = CODA_JAMO[p];
      } else {
        const standalone = STANDALONE[p];
        if (standalone) {
          syllables.push({ onset: standalone[0], vowel: standalone[1], coda: standalone[2] ?? '' });
          // '으' 음절 뒤에는 무성 파열음을 받침으로 붙이지 않는다 (asks 애스크스)
          lastVowelShort = false;
        }
      }
      i++;
      continue;
    }

    i++; // 알 수 없는 발음기호
  }

  return syllables.map((s) => buildSyllable(s.onset, s.vowel, s.coda)).join('');
}

/**
 * 영어 문장을 한글 발음으로 옮긴다. 공백과 문장부호는 그대로 둔다.
 * @param {string} text
 * @returns {string}
 */
export function enToHangul(text) {
  return String(text ?? '').replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    const phones = enToPhones(word);
    const hangul = phonesToHangul(phones);
    return hangul || word;
  });
}
