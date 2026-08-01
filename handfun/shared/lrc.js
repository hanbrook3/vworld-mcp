/**
 * LRC 가사 파서.
 *
 * 지원 형식
 *  - 표준 줄 단위:      [00:12.34] 가사
 *  - 한 줄 다중 타임스탬프: [00:12.34][01:05.00] 후렴
 *  - 확장(단어 단위):    [00:12.34] <00:12.34>가 <00:12.80>사
 *  - 메타 태그:          [ti:], [ar:], [al:], [by:], [offset:], [length:]
 *  - 타임스탬프 없는 평문 가사 (싱크 불가로 표시)
 */

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const META_TAG = /^\[([a-zA-Z#]+):(.*)\]$/;

/**
 * 후리가나 표기: 한자 바로 뒤 괄호 안의 가나.
 *   君(きみ)の声(こえ)  ·  君（きみ）の声（こえ）  ·  君《きみ》の声《こえ》
 * 일본어 가사는 한자가 대부분인데 읽는 법은 사전 없이 정할 수 없다.
 * 후리가나가 붙어 있으면 그걸 읽기로 쓴다.
 */
const FURIGANA = /([一-鿿々〆ヵヶ]+)[(（《]([ぁ-ゖァ-ヺー]+)[)）》]/g;

/** 마지막 가사 줄에 부여할 기본 길이 */
const DEFAULT_TAIL_MS = 5000;

function fractionToMs(digits) {
  if (!digits) return 0;
  // 2자리는 1/100초, 3자리는 1/1000초, 1자리는 1/10초
  return Number(digits) * Math.pow(10, 3 - digits.length);
}

function tagToMs(min, sec, frac) {
  return Number(min) * 60000 + Number(sec) * 1000 + fractionToMs(frac);
}

/** 문자열이 싱크 타임스탬프를 하나라도 포함하는지 */
export function hasTimestamps(text) {
  TIME_TAG.lastIndex = 0;
  return TIME_TAG.test(text ?? '');
}

/**
 * 후리가나를 벗겨 화면에 띄울 글자와 발음에 쓸 글자를 각각 만든다.
 * 공백 위치는 그대로 두므로 단어 수가 어긋나지 않는다.
 * @param {string} text
 * @returns {{display: string, reading: string|null}} 후리가나가 없으면 reading 은 null
 */
export function stripFurigana(text) {
  const source = String(text ?? '');
  FURIGANA.lastIndex = 0;
  if (!FURIGANA.test(source)) return { display: source, reading: null };

  return {
    display: source.replace(FURIGANA, (_, base) => base),
    reading: source.replace(FURIGANA, (_, __, kana) => kana),
  };
}

/**
 * @typedef {{startMs: number, endMs: number, text: string}} LyricWord
 * @typedef {{startMs: number, endMs: number, text: string, words: LyricWord[] | null}} LyricLine
 * @typedef {{
 *   meta: Record<string, string>,
 *   lines: LyricLine[],
 *   synced: boolean,
 *   offsetMs: number,
 * }} ParsedLyrics
 */

/**
 * LRC 텍스트를 파싱한다.
 * @param {string} text
 * @returns {ParsedLyrics}
 */
export function parseLrc(text) {
  const meta = {};
  /** @type {{startMs: number, text: string, words: LyricWord[] | null}[]} */
  const entries = [];

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 메타 태그 ([ti:...] 처럼 콜론 앞이 알파벳인 경우)
    const metaMatch = line.match(META_TAG);
    if (metaMatch) {
      meta[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      continue;
    }

    // 줄 앞쪽의 타임스탬프를 모두 모은다
    TIME_TAG.lastIndex = 0;
    const stamps = [];
    let cursor = 0;
    let m;
    while ((m = TIME_TAG.exec(line)) !== null) {
      if (m.index !== cursor) break; // 가사 본문에 끼어든 태그는 무시
      stamps.push(tagToMs(m[1], m[2], m[3]));
      cursor = TIME_TAG.lastIndex;
    }
    if (stamps.length === 0) continue;

    const body = line.slice(cursor);
    const words = parseWordTags(body);
    const raw = body.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
    const { display, reading } = stripFurigana(raw);

    for (const startMs of stamps) {
      entries.push({
        startMs,
        text: display,
        reading,
        // 다중 타임스탬프(후렴 반복)에서는 각 등장마다 단어 시각을 평행이동한다
        words: words ? shiftWords(words, startMs - (words[0]?.startMs ?? startMs)) : null,
      });
    }
  }

  const offsetMs = meta.offset ? Number(meta.offset) || 0 : 0;
  entries.sort((a, b) => a.startMs - b.startMs);

  // [offset:+n] 규약: 양수는 가사를 그만큼 앞당긴다
  const lines = entries.map((e) => ({
    startMs: e.startMs - offsetMs,
    endMs: 0,
    text: e.text,
    reading: e.reading,
    words: e.words
      ? e.words.map((w) => ({ ...w, startMs: w.startMs - offsetMs, endMs: w.endMs - offsetMs }))
      : null,
  }));

  const totalMs = meta.length ? parseLength(meta.length) : null;
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    lines[i].endMs = next ? next.startMs : Math.max(lines[i].startMs + DEFAULT_TAIL_MS, totalMs ?? 0);
    if (lines[i].words) closeWordEnds(lines[i]);
  }

  return { meta, lines, synced: lines.length > 0, offsetMs };
}

function parseLength(value) {
  const m = String(value).match(/(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?/);
  return m ? tagToMs(m[1], m[2], m[3]) : null;
}

function parseWordTags(body) {
  const matches = [...body.matchAll(WORD_TAG)];
  if (matches.length === 0) return null;

  const words = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const textStart = m.index + m[0].length;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const chunk = body.slice(textStart, textEnd);
    if (!chunk.trim()) continue;
    const { display, reading } = stripFurigana(chunk.replace(/\s+$/, ''));
    words.push({
      startMs: tagToMs(m[1], m[2], m[3]),
      endMs: 0,
      text: display,
      reading,
    });
  }
  return words.length ? words : null;
}

function shiftWords(words, deltaMs) {
  if (!deltaMs) return words.map((w) => ({ ...w }));
  return words.map((w) => ({ ...w, startMs: w.startMs + deltaMs, endMs: w.endMs + deltaMs }));
}

function closeWordEnds(line) {
  const words = line.words;
  for (let i = 0; i < words.length; i++) {
    words[i].endMs = i + 1 < words.length ? words[i + 1].startMs : line.endMs;
  }
}

/**
 * 타임스탬프 없는 평문 가사를 파싱한다. 싱크는 불가하지만 화면에는 띄울 수 있다.
 * @returns {ParsedLyrics}
 */
export function parsePlainLyrics(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const { display, reading } = stripFurigana(l);
      return { startMs: 0, endMs: 0, text: display, reading, words: null };
    });
  return { meta: {}, lines, synced: false, offsetMs: 0 };
}

/** 내용에 따라 LRC 또는 평문으로 자동 파싱한다. */
export function parseLyrics(text) {
  return hasTimestamps(text) ? parseLrc(text) : parsePlainLyrics(text);
}

/**
 * 재생 위치에 해당하는 가사 줄 번호를 이분탐색으로 찾는다.
 * 첫 줄 시작 전이면 -1 을 반환한다.
 * @param {LyricLine[]} lines
 * @param {number} positionMs
 */
export function lineIndexAt(lines, positionMs) {
  if (!lines.length || positionMs < lines[0].startMs) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].startMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** 줄 안에서 현재 발음 중인 단어 번호. 단어 정보가 없으면 -1. */
export function wordIndexAt(line, positionMs) {
  if (!line?.words?.length) return -1;
  let found = -1;
  for (let i = 0; i < line.words.length; i++) {
    if (line.words[i].startMs <= positionMs) found = i;
    else break;
  }
  return found;
}

/** 현재 줄의 진행률 0~1 (노래방 하이라이트용) */
export function lineProgressAt(line, positionMs) {
  if (!line) return 0;
  const span = line.endMs - line.startMs;
  if (span <= 0) return positionMs >= line.startMs ? 1 : 0;
  return Math.min(1, Math.max(0, (positionMs - line.startMs) / span));
}

/** 파싱 결과를 다시 LRC 문자열로 직렬화한다. */
export function toLrc(parsed) {
  const out = [];
  for (const [key, value] of Object.entries(parsed.meta ?? {})) {
    if (key === 'offset') continue; // 오프셋은 이미 반영되어 있다
    out.push(`[${key}:${value}]`);
  }
  for (const line of parsed.lines) {
    out.push(`${formatTag(line.startMs)}${line.text}`);
  }
  return out.join('\n');
}

function formatTag(ms) {
  const safe = Math.max(0, Math.round(ms));
  const min = Math.floor(safe / 60000);
  const sec = Math.floor((safe % 60000) / 1000);
  const cs = Math.floor((safe % 1000) / 10);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `[${pad(min)}:${pad(sec)}.${pad(cs)}]`;
}
