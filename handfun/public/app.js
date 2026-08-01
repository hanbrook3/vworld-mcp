/**
 * HandFun 메인 컨트롤러.
 *
 * 흐름:
 *   마이크 → 최근 5초 잘라내기 → 워커에서 지문 계산 → /api/identify
 *   → 곡과 재생 위치 확보 → SyncClock 에 기준점 등록
 *   → 매 프레임 현재 위치로 가사·발음 하이라이트
 */

import { parseLyrics, lineIndexAt, wordIndexAt, lineProgressAt } from '/shared/lrc.js';
import { SyncClock } from '/shared/sync-clock.js';
import { ListenScheduler } from '/shared/listen-scheduler.js';
import { pronounce, PRONUNCIATION_STYLES } from '/shared/pronounce/index.js';
import { MicRecorder, encodeWav, bufferToBase64 } from '/mic.js';

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

const WINDOW_SECONDS = 5; // 한 번 인식할 때 듣는 길이
const TICK_MS = 1000; // 소리 상태를 확인하는 주기
const SETTINGS_KEY = 'handfun.settings.v1';
const MIC_GRANTED_KEY = 'handfun.micGranted';

const DEMO_LYRICS = `[ti:데모 트랙]
[ar:HandFun]
[00:00.50] 밤이 내려앉은 거리 위로
[00:04.50] 익숙한 멜로디가 흘러
[00:08.50] Follow the light tonight
[00:12.50] 우리 둘만 아는 이야기
[00:16.50] Every step feels so right
[00:20.50] 시간이 멈춘 것처럼
[00:24.50] 노래가 끝나기 전에
[00:28.50] Hold me closer, don't let go
[00:32.50] 이 밤이 지나가도
[00:36.50] 다시 여기서 만나
[00:41.00] 데모는 여기까지입니다`;

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const clock = new SyncClock();
const mic = new MicRecorder();
const scheduler = new ListenScheduler({
  baseIntervalMs: settings.intervalSec * 1000,
  // 녹음 창의 대부분이 음악으로 차야 인식을 보낸다
  minLoudMs: WINDOW_SECONDS * 1000 * 0.8,
});

const state = {
  view: 'listen',
  listening: false,
  demo: false,
  trackId: null,
  trackLabel: null,
  lyrics: null,
  lineViews: [],
  activeLine: -1,
  serverConfig: { providers: {} },
  pendingTrack: null, // 곡 추가 화면에서 만든 지문
  wakeLock: null,
  recognizing: false,
};

let tickTimer = null;
let fpWorker = null;

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

function loadSettings() {
  const defaults = {
    style: 'auto',
    size: 'normal',
    offsetMs: 0,
    wakeLock: true,
    external: false,
    intervalSec: 6,
    autoStart: true, // 앱을 열면 알아서 듣기 시작
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* 저장 공간이 없어도 앱은 계속 동작한다 */
  }
}

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 호출한 쪽이 상태 코드에 따라 다르게 처리할 수 있도록 실어 보낸다
    throw Object.assign(new Error(payload.error ?? `요청 실패 (${res.status})`), {
      status: res.status,
      ...payload,
    });
  }
  return payload;
}

let toastTimer = null;
function toast(message, tone = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, tone === 'error' ? 4200 : 2600);
}

function formatTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setStatus(text, statusState = 'idle') {
  $('statusText').textContent = text;
  $('statusChip').dataset.state = statusState;
}

// ---------------------------------------------------------------------------
// 지문 워커
// ---------------------------------------------------------------------------

function getWorker() {
  if (fpWorker) return fpWorker;

  const worker = new Worker('/fp-worker.js', { type: 'module' });
  const pending = new Map();
  let seq = 0;

  worker.onmessage = (event) => {
    const { id, ok, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    ok ? entry.resolve(event.data) : entry.reject(new Error(error));
  };
  worker.onerror = (event) => {
    for (const entry of pending.values()) entry.reject(new Error(event.message ?? '워커 오류'));
    pending.clear();
  };

  fpWorker = {
    run(samples, sampleRate) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, samples, sampleRate }, [samples.buffer]);
      });
    },
  };
  return fpWorker;
}

// ---------------------------------------------------------------------------
// 가사 표시
// ---------------------------------------------------------------------------

/**
 * 한 줄을 단어 단위로 쪼개고 각 단어의 발음을 미리 구해 둔다.
 * 후리가나가 달린 줄은 화면에는 한자를, 발음은 가나를 기준으로 만든다.
 */
function buildLineView(line) {
  let words;
  let readings;

  if (line.words?.length) {
    words = line.words.map((w) => w.text.trim()).filter(Boolean);
    readings = line.words.map((w) => (w.reading ?? w.text).trim()).filter(Boolean);
  } else {
    words = line.text.split(/\s+/).filter(Boolean);
    // 후리가나를 벗겨도 공백 위치는 그대로라 단어 수가 맞는다
    readings = (line.reading ?? line.text).split(/\s+/).filter(Boolean);
  }
  if (readings.length !== words.length) readings = words;

  const hasPron = Boolean(pronounce(line.reading ?? line.text, settings.style));

  return {
    words: words.map((text, i) => ({
      text,
      pron: hasPron ? pronounce(readings[i], settings.style) ?? readings[i] : '',
    })),
    hasPron,
    totalChars: words.reduce((sum, w) => sum + w.length, 0) || 1,
  };
}

function renderLyrics(parsed) {
  const list = $('lyrics');
  list.innerHTML = '';
  state.lineViews = [];
  state.activeLine = -1;

  if (!parsed || parsed.lines.length === 0) {
    list.hidden = true;
    $('emptyState').hidden = false;
    return;
  }

  const fragment = document.createDocumentFragment();
  parsed.lines.forEach((line, index) => {
    const view = buildLineView(line);
    state.lineViews.push(view);

    const li = document.createElement('li');
    li.className = 'lyric-line';
    li.dataset.index = String(index);

    const textEl = document.createElement('span');
    textEl.className = 'lyric-text';
    view.words.forEach((word, wordIndex) => {
      if (wordIndex > 0) textEl.append(' ');
      const span = document.createElement('span');
      span.className = 'lyric-word';
      span.textContent = word.text;
      textEl.append(span);
    });
    li.append(textEl);

    if (view.hasPron) {
      const pronEl = document.createElement('span');
      pronEl.className = 'lyric-pron';
      pronEl.textContent = view.words.map((w) => w.pron).join(' ');
      li.append(pronEl);
    }

    // 가사를 눌러 그 줄로 싱크를 맞출 수 있다 (인식이 어긋났을 때 유용)
    li.addEventListener('click', () => seekToLine(index));
    fragment.append(li);
  });

  list.append(fragment);
  list.hidden = false;
  $('emptyState').hidden = true;
  $('noLyricsState').hidden = true;
  $('stageFooter').hidden = false;
}

/** 사용자가 특정 줄을 눌렀을 때 그 줄이 지금 나오는 것으로 맞춘다. */
function seekToLine(index) {
  const line = state.lyrics?.lines[index];
  if (!line || !state.lyrics.synced) return;
  clock.reset();
  clock.userOffsetMs = settings.offsetMs;
  clock.anchor(line.startMs, performance.now(), 1);
  setStatus('수동으로 맞춤', 'locked');
  toast(`${formatTime(line.startMs)} 지점으로 맞췄습니다`);
}

function updateHighlight(positionMs) {
  const parsed = state.lyrics;
  if (!parsed?.lines.length) return;

  const list = $('lyrics');
  const index = parsed.synced ? lineIndexAt(parsed.lines, positionMs) : -1;

  if (index !== state.activeLine) {
    const items = list.children;
    for (let i = 0; i < items.length; i++) {
      const distance = Math.abs(i - index);
      items[i].classList.toggle('is-active', i === index);
      items[i].classList.toggle('is-near', distance === 1);
    }
    state.activeLine = index;

    const activeEl = items[index];
    if (activeEl) {
      list.scrollTo({
        top: activeEl.offsetTop - list.clientHeight / 2 + activeEl.offsetHeight / 2,
        behavior: 'smooth',
      });
    }
  }

  if (index >= 0) updateWords(list.children[index], parsed.lines[index], state.lineViews[index], positionMs);

  $('syncPosition').textContent = formatTime(positionMs);
}

/** 현재 줄 안에서 어디까지 불렀는지 단어 단위로 표시한다. */
function updateWords(lineEl, line, view, positionMs) {
  if (!lineEl || !view) return;

  let activeWord;
  if (line.words?.length) {
    activeWord = wordIndexAt(line, positionMs);
  } else {
    // 단어 시각이 없으면 글자 수 비율로 추정한다
    const progress = lineProgressAt(line, positionMs);
    let acc = 0;
    activeWord = -1;
    for (let i = 0; i < view.words.length; i++) {
      acc += view.words[i].text.length;
      if (acc / view.totalChars > progress) {
        activeWord = i;
        break;
      }
    }
    if (activeWord === -1) activeWord = view.words.length - 1;
  }

  const spans = lineEl.querySelectorAll('.lyric-word');
  for (let i = 0; i < spans.length; i++) {
    spans[i].classList.toggle('is-sung', i < activeWord);
    spans[i].classList.toggle('is-current', i === activeWord);
  }
}

/** 발음 표기 방식이나 가사가 바뀌면 다시 그린다. */
function refreshLyricsView() {
  if (state.lyrics) renderLyrics(state.lyrics);
}

// ---------------------------------------------------------------------------
// 곡 / 가사 로딩
// ---------------------------------------------------------------------------

function showNowPlaying(title, artist, meta) {
  $('npTitle').textContent = title;
  $('npArtist').textContent = artist ?? '';
  $('npMeta').textContent = meta ?? '';
  $('nowPlaying').hidden = false;
  state.trackLabel = title;
}

async function loadLocalTrack(track) {
  const { lyrics } = await api('GET', `/api/tracks/${track.id}`);
  state.trackId = track.id;
  state.lyrics = lyrics ? parseLyrics(lyrics) : null;

  showNowPlaying(
    track.title,
    track.artist,
    state.lyrics?.synced ? '내 라이브러리 · 싱크 가사' : '내 라이브러리 · 가사 없음',
  );

  if (state.lyrics) {
    renderLyrics(state.lyrics);
  } else {
    showNoLyrics(track);
  }
}

async function loadExternalTrack(info) {
  const key = `ext:${info.artist}/${info.title}`;
  if (state.trackId === key) return;

  state.trackId = key;
  showNowPlaying(info.title, info.artist, `${info.source} 인식 · 가사 찾는 중…`);

  try {
    const { result } = await api(
      'GET',
      `/api/lyrics/get?title=${encodeURIComponent(info.title)}&artist=${encodeURIComponent(info.artist)}`,
    );
    if (result && (result.syncedLyrics || result.plainLyrics)) {
      state.lyrics = parseLyrics(result.syncedLyrics || result.plainLyrics);
      renderLyrics(state.lyrics);
      showNowPlaying(
        info.title,
        info.artist,
        `${info.source} 인식 · ${result.hasSynced ? '싱크 가사' : '가사(싱크 없음)'}`,
      );
    } else {
      state.lyrics = null;
      showNowPlaying(info.title, info.artist, `${info.source} 인식 · 가사를 찾지 못했습니다`);
      showNoLyrics(null);
    }
  } catch (err) {
    showNowPlaying(info.title, info.artist, `가사 조회 실패: ${err.message}`);
  }
}

function showNoLyrics(track) {
  $('lyrics').hidden = true;
  $('emptyState').hidden = true;
  $('noLyricsState').hidden = false;

  // 내 라이브러리의 곡일 때만 바로 가사를 등록할 수 있다
  const button = $('addLyricsBtn');
  button.hidden = !track;
  button.onclick = track ? () => openLyricsEditor(track) : null;
}

// ---------------------------------------------------------------------------
// 인식 루프
// ---------------------------------------------------------------------------

async function recognizeOnce() {
  if (!state.listening || state.recognizing) return;

  const window = mic.takeWindow(WINDOW_SECONDS);
  if (!window) return; // 아직 충분히 듣지 못했다

  state.recognizing = true;
  try {
    // 이 구간이 시작된 시각. 매칭이 돌려주는 재생 위치는 이 시점의 위치다.
    const windowStartMs = window.capturedAt - WINDOW_SECONDS * 1000;

    const body = {};
    if (settings.external && hasExternalProvider()) {
      const wav = encodeWav(window.samples, window.sampleRate);
      body.audio = bufferToBase64(wav);
    }

    const fp = await getWorker().run(window.samples, window.sampleRate);
    body.landmarks = fp.landmarks;

    const result = await api('POST', '/api/identify', body);

    scheduler.report(result.matched);

    if (!result.matched) {
      const clockState = clock.miss();
      if (clockState === 'lost') {
        // 곡이 끝났거나 바뀐 것으로 본다. 다음에 잡히면 가사를 새로 읽는다.
        state.trackId = null;
        setStatus('노래를 찾는 중…', 'listening');
      } else {
        setStatus(state.lyrics ? '듣는 중' : '노래를 찾는 중…', 'listening');
      }
      return;
    }

    if (result.source === 'local' && result.track) {
      if (state.trackId !== result.track.id) await loadLocalTrack(result.track);
      clock.userOffsetMs = settings.offsetMs;
      clock.anchor(result.offsetMs, windowStartMs, result.confidence);
      setStatus(`맞춰짐 · ${Math.round(result.confidence * 100)}%`, 'locked');
    } else if (result.external) {
      await loadExternalTrack(result.external);
      if (result.hasOffset !== false) {
        clock.userOffsetMs = settings.offsetMs;
        clock.anchor(result.offsetMs, windowStartMs, result.confidence);
        setStatus('맞춰짐 (외부 인식)', 'locked');
      } else {
        setStatus('곡은 찾았지만 위치를 몰라요', 'listening');
      }
    }
  } catch (err) {
    scheduler.report(false);
    setStatus('인식 실패', 'error');
    console.warn('[recognize]', err);
  } finally {
    state.recognizing = false;
  }
}

/**
 * 1초마다 돌면서 "지금 인식을 시도할지" 정한다.
 * 조용하면 서버를 부르지 않고, 노래가 시작되면 주기를 기다리지 않고 바로 인식한다.
 */
function tick() {
  if (!state.listening) return;

  updateLevelMeter();

  // 제스처가 없으면 브라우저가 오디오를 멈춰 둔다
  if (mic.needsGesture) {
    setStatus('화면을 한 번 눌러주세요', 'error');
    return;
  }

  // 창을 채울 만큼 듣기 전에는 판단하지 않는다
  if (!mic.hasSeconds(WINDOW_SECONDS)) {
    setStatus('듣는 중', 'listening');
    return;
  }

  const decision = scheduler.decide({ rms: mic.recentRms(1), nowMs: performance.now() });

  if (decision.silent) {
    setStatus('조용함 · 소리를 기다립니다', 'listening');
    return;
  }
  if (decision.recognize) recognizeOnce();
  else if (decision.reason === 'warming') setStatus('노래를 듣는 중…', 'listening');
  else if (clock.state !== 'locked') setStatus('듣는 중', 'listening');
}

function updateLevelMeter() {
  // RMS 를 0~1 로 눌러 편다. 조용한 소리도 눈에 보이도록 제곱근을 쓴다.
  const ratio = state.listening ? Math.min(1, Math.sqrt(mic.level / 0.15)) : 0;
  $('levelMeter').style.setProperty('--level', ratio.toFixed(3));
}

function hasExternalProvider() {
  const p = state.serverConfig.providers ?? {};
  return Boolean(p.acrcloud || p.audd);
}

/**
 * @param {{silent?: boolean}} [options] silent 면 실패해도 토스트를 띄우지 않는다
 *                                        (자동 시작이 조용히 실패해야 하는 경우)
 */
async function startListening({ silent = false } = {}) {
  if (state.listening) return false;
  stopDemo();

  if (!window.isSecureContext) {
    if (!silent) toast('마이크는 HTTPS 또는 localhost 에서만 쓸 수 있습니다', 'error');
    return false;
  }

  try {
    setStatus('마이크 준비 중…', 'listening');
    await mic.start();
    rememberMicPermission(true);
  } catch (err) {
    rememberMicPermission(false);
    setStatus('마이크 사용 불가', 'error');
    if (!silent) {
      toast(
        err?.name === 'NotAllowedError'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.'
          : `마이크를 열지 못했습니다: ${err.message}`,
        'error',
      );
    }
    return false;
  }

  state.listening = true;
  scheduler.reset();
  scheduler.setBaseInterval(settings.intervalSec * 1000);
  $('micBtn').classList.add('is-listening');
  $('levelMeter').hidden = false;
  setStatus('듣는 중', 'listening');
  await requestWakeLock();

  // 자동 시작은 브라우저가 오디오를 멈춰 둘 수 있다. 첫 터치에 다시 돌린다.
  if (mic.needsGesture) armGestureResume();

  clearInterval(tickTimer);
  tickTimer = setInterval(tick, TICK_MS);
  return true;
}

async function stopListening() {
  if (!state.listening) return;
  state.listening = false;
  clearInterval(tickTimer);
  tickTimer = null;
  await mic.stop();
  releaseWakeLock();
  $('micBtn').classList.remove('is-listening');
  $('levelMeter').hidden = true;
  setStatus('대기 중', 'idle');
}

function armGestureResume() {
  const resume = async () => {
    if (!state.listening) return;
    await mic.resume();
    if (mic.needsGesture) armGestureResume(); // 아직이면 다음 터치를 기다린다
    else setStatus('듣는 중', 'listening');
  };
  document.addEventListener('pointerdown', resume, { once: true });
}

function rememberMicPermission(granted) {
  try {
    if (granted) localStorage.setItem(MIC_GRANTED_KEY, '1');
    else localStorage.removeItem(MIC_GRANTED_KEY);
  } catch {
    /* 저장 공간이 없어도 상관없다 */
  }
}

/**
 * 앱을 열자마자 듣기를 시작한다.
 * 단, 권한을 아직 받지 않았다면 자동으로 권한 팝업을 띄우지 않는다.
 * (사용자가 이유를 모르는 채 팝업을 보게 되고, 브라우저가 막기도 한다)
 */
async function maybeAutoStart() {
  if (!settings.autoStart || !window.isSecureContext) return;

  let granted = false;
  try {
    granted = localStorage.getItem(MIC_GRANTED_KEY) === '1';
  } catch {
    /* 무시 */
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    granted = status.state === 'granted';
    status.onchange = () => {
      if (status.state === 'denied') stopListening();
    };
  } catch {
    // Safari 등 microphone 권한 조회를 지원하지 않는 브라우저는
    // 예전에 성공한 적이 있는지로 판단한다
  }

  if (granted) await startListening({ silent: true });
}

async function requestWakeLock() {
  if (!settings.wakeLock || !navigator.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* 지원하지 않거나 거부되면 그냥 넘어간다 */
  }
}

function releaseWakeLock() {
  state.wakeLock?.release?.().catch(() => {});
  state.wakeLock = null;
}

// ---------------------------------------------------------------------------
// 데모
// ---------------------------------------------------------------------------

function startDemo() {
  stopListening();
  state.demo = true;
  state.trackId = 'demo';
  state.lyrics = parseLyrics(DEMO_LYRICS);
  renderLyrics(state.lyrics);
  showNowPlaying('데모 트랙', 'HandFun', '실제 음악 없이 화면만 미리보기');

  clock.reset();
  clock.userOffsetMs = settings.offsetMs;
  clock.anchor(0, performance.now(), 1);
  setStatus('데모 재생 중', 'locked');
}

function stopDemo() {
  if (!state.demo) return;
  state.demo = false;
  clock.reset();
}

// ---------------------------------------------------------------------------
// 렌더 루프
// ---------------------------------------------------------------------------

function frame() {
  requestAnimationFrame(frame);
  if (state.view !== 'listen' || !state.lyrics) return;
  if (clock.state === 'idle') return;
  updateHighlight(clock.positionAt(performance.now()));
}

// ---------------------------------------------------------------------------
// 라이브러리
// ---------------------------------------------------------------------------

async function refreshLibrary() {
  let tracks = [];
  try {
    ({ tracks } = await api('GET', '/api/tracks'));
  } catch (err) {
    toast(`목록을 불러오지 못했습니다: ${err.message}`, 'error');
    return;
  }

  const list = $('trackList');
  list.innerHTML = '';
  $('libraryEmpty').hidden = tracks.length > 0;

  for (const track of tracks) {
    const li = document.createElement('li');
    li.className = 'track-item';

    const main = document.createElement('div');
    main.className = 'track-main';

    const title = document.createElement('div');
    title.className = 'track-title';
    title.textContent = track.title;

    const sub = document.createElement('div');
    sub.className = 'track-sub';
    sub.append(document.createTextNode(track.artist || '아티스트 없음'));

    const badge = document.createElement('span');
    if (track.hasSyncedLyrics) {
      badge.className = 'badge';
      badge.textContent = '싱크 가사';
    } else if (track.hasLyrics) {
      badge.className = 'badge warn';
      badge.textContent = '싱크 없는 가사';
    } else {
      badge.className = 'badge warn';
      badge.textContent = '가사 없음';
    }
    sub.append(badge);

    main.append(title, sub);

    const play = document.createElement('button');
    play.className = 'btn btn-sm';
    play.textContent = '수동 시작';
    play.title = '노래를 처음부터 트는 경우 이 버튼으로 맞춥니다';
    play.addEventListener('click', () => startManual(track));

    const edit = document.createElement('button');
    edit.className = 'btn btn-sm btn-ghost';
    edit.textContent = '가사';
    edit.addEventListener('click', () => openLyricsEditor(track));

    const remove = document.createElement('button');
    remove.className = 'btn btn-sm btn-danger';
    remove.textContent = '삭제';
    remove.addEventListener('click', async () => {
      if (!confirm(`'${track.title}' 을(를) 삭제할까요?`)) return;
      await api('DELETE', `/api/tracks/${track.id}`);
      toast('삭제했습니다');
      refreshLibrary();
    });

    li.append(main, play, edit, remove);
    list.append(li);
  }
}

async function startManual(track) {
  await loadLocalTrack(track);
  if (!state.lyrics) return;

  clock.reset();
  clock.userOffsetMs = settings.offsetMs;
  clock.anchor(0, performance.now(), 1);
  showView('listen');
  setStatus('수동 시작 (0:00)', 'locked');
  toast('노래를 지금 처음부터 재생하세요. 어긋나면 가사를 눌러 맞출 수 있습니다.');
}

async function openLyricsEditor(track) {
  const { lyrics } = await api('GET', `/api/tracks/${track.id}`);
  const next = prompt(`'${track.title}' 의 가사 (LRC 형식)`, lyrics ?? '');
  if (next === null) return;
  await api('PATCH', `/api/tracks/${track.id}`, { lyrics: next });
  toast('가사를 저장했습니다');
  refreshLibrary();
  if (state.trackId === track.id) {
    state.trackId = null; // 다음 인식 때 다시 읽도록
  }
}

// ---------------------------------------------------------------------------
// 곡 추가
// ---------------------------------------------------------------------------

async function ingestAudioFile(file) {
  const progress = $('ingestProgress');
  const bar = $('ingestBar');
  const text = $('ingestText');
  progress.hidden = false;

  const setProgress = (ratio, label) => {
    bar.style.width = `${Math.round(ratio * 100)}%`;
    text.textContent = label;
  };

  try {
    setProgress(0.15, '파일 읽는 중…');
    const arrayBuffer = await file.arrayBuffer();

    setProgress(0.4, '오디오 디코딩 중…');
    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(arrayBuffer);
    const channels = [];
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c));

    // 모노로 합친다
    const mono = new Float32Array(audio.length);
    for (const channel of channels) {
      for (let i = 0; i < audio.length; i++) mono[i] += channel[i] / channels.length;
    }
    await ctx.close();

    setProgress(0.65, '지문 만드는 중…');
    const fp = await getWorker().run(mono, audio.sampleRate);

    state.pendingTrack = {
      landmarks: fp.landmarks,
      durationMs: Math.round(audio.duration * 1000),
      fileName: file.name,
    };

    setProgress(1, `완료 · ${fp.count.toLocaleString()}개 지문 (${formatTime(audio.duration * 1000)})`);
    $('fileDrop').classList.add('is-ready');
    $('fileDropLabel').textContent = file.name;
    $('saveTrackBtn').disabled = false;

    // 파일 이름에서 제목/아티스트를 추측한다 ("아티스트 - 제목.mp3")
    const base = file.name.replace(/\.[^.]+$/, '');
    const parts = base.split(/\s+-\s+/);
    if (!$('addTitle').value) $('addTitle').value = (parts[1] ?? parts[0]).trim();
    if (!$('addArtist').value && parts.length > 1) $('addArtist').value = parts[0].trim();
    if (!$('lyricsQuery').value) $('lyricsQuery').value = base;
  } catch (err) {
    progress.hidden = true;
    toast(`이 파일을 읽지 못했습니다: ${err.message}`, 'error');
  }
}

async function searchLyrics() {
  const query = $('lyricsQuery').value.trim();
  if (!query) return;

  const note = $('lyricsNote');
  const results = $('lyricsResults');
  note.hidden = false;
  note.textContent = '검색 중…';
  results.hidden = true;

  try {
    const data = await api('GET', `/api/lyrics/search?q=${encodeURIComponent(query)}`);
    results.innerHTML = '';

    if (data.error) {
      note.textContent = data.error;
      return;
    }
    if (!data.results.length) {
      note.textContent = '검색 결과가 없습니다. 가사를 직접 붙여넣어 주세요.';
      return;
    }

    note.hidden = true;
    for (const item of data.results) {
      const li = document.createElement('li');
      li.className = 'search-item';

      const main = document.createElement('div');
      main.className = 'track-main';
      main.innerHTML = `<div class="track-title">${escapeHtml(item.title)}</div>`;

      const sub = document.createElement('div');
      sub.className = 'track-sub';
      sub.textContent = `${item.artist}${item.durationMs ? ` · ${formatTime(item.durationMs)}` : ''}`;
      if (item.hasSynced) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '싱크';
        sub.append(badge);
      }
      main.append(sub);
      li.append(main);

      li.addEventListener('click', () => {
        $('addLyrics').value = item.syncedLyrics || item.plainLyrics;
        if (!$('addTitle').value) $('addTitle').value = item.title;
        if (!$('addArtist').value) $('addArtist').value = item.artist;
        toast(item.hasSynced ? '싱크 가사를 가져왔습니다' : '가사를 가져왔습니다 (싱크 없음)');
      });

      results.append(li);
    }
    results.hidden = false;
  } catch (err) {
    note.textContent = `검색에 실패했습니다: ${err.message}`;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function saveTrack({ force = false } = {}) {
  if (!state.pendingTrack) return;

  const button = $('saveTrackBtn');
  button.disabled = true;
  try {
    await api('POST', '/api/tracks', {
      title: $('addTitle').value.trim() || state.pendingTrack.fileName,
      artist: $('addArtist').value.trim(),
      durationMs: state.pendingTrack.durationMs,
      landmarks: state.pendingTrack.landmarks,
      lyrics: $('addLyrics').value,
      lyricsSource: 'user',
      force,
    });

    toast('라이브러리에 저장했습니다');
    resetAddForm();
    showView('library');
    refreshLibrary();
  } catch (err) {
    button.disabled = false;
    if (err.status === 409) {
      const name = err.existingTrack?.title ?? '같은 곡';
      const proceed = confirm(
        `'${name}' 이(가) 이미 등록되어 있습니다.\n\n` +
          '같은 곡을 두 번 등록하면 둘 중 어느 쪽인지 가릴 수 없어\n' +
          '그 곡이 인식되지 않습니다.\n\n그래도 등록할까요?',
      );
      if (proceed) await saveTrack({ force: true });
      return;
    }
    toast(`저장하지 못했습니다: ${err.message}`, 'error');
  }
}

function resetAddForm() {
  state.pendingTrack = null;
  $('audioInput').value = '';
  $('addTitle').value = '';
  $('addArtist').value = '';
  $('addLyrics').value = '';
  $('lyricsQuery').value = '';
  $('lyricsResults').hidden = true;
  $('lyricsNote').hidden = true;
  $('ingestProgress').hidden = true;
  $('fileDrop').classList.remove('is-ready');
  $('fileDropLabel').textContent = '음원 파일 선택 (mp3, m4a, wav …)';
  $('saveTrackBtn').disabled = true;
}

// ---------------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------------

function showView(view) {
  state.view = view;
  for (const el of document.querySelectorAll('.view')) {
    el.classList.toggle('is-active', el.id === `view-${view}`);
  }
  for (const button of document.querySelectorAll('.tabbar button')) {
    button.classList.toggle('is-active', button.dataset.view === view);
  }
  if (view === 'library') refreshLibrary();
}

// ---------------------------------------------------------------------------
// 설정 화면
// ---------------------------------------------------------------------------

function buildSettingsUi() {
  const styleBox = $('styleSegmented');
  styleBox.innerHTML = '';
  for (const style of PRONUNCIATION_STYLES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'radio';
    button.textContent = style.label;
    button.dataset.style = style.id;
    button.addEventListener('click', () => {
      settings.style = style.id;
      saveSettings();
      syncSettingsUi();
      refreshLyricsView();
    });
    styleBox.append(button);
  }

  for (const button of document.querySelectorAll('#sizeSegmented button')) {
    button.addEventListener('click', () => {
      settings.size = button.dataset.size;
      saveSettings();
      syncSettingsUi();
    });
  }

  $('offsetSlider').addEventListener('input', (event) => {
    settings.offsetMs = Number(event.target.value);
    clock.userOffsetMs = settings.offsetMs;
    saveSettings();
    syncSettingsUi();
  });

  $('intervalSlider').addEventListener('input', (event) => {
    settings.intervalSec = Number(event.target.value);
    saveSettings();
    syncSettingsUi();
    scheduler.setBaseInterval(settings.intervalSec * 1000);
  });

  $('autoStartToggle').addEventListener('change', (event) => {
    settings.autoStart = event.target.checked;
    saveSettings();
  });

  $('wakeLockToggle').addEventListener('change', (event) => {
    settings.wakeLock = event.target.checked;
    saveSettings();
    if (settings.wakeLock && state.listening) requestWakeLock();
    else releaseWakeLock();
  });

  $('externalToggle').addEventListener('change', (event) => {
    settings.external = event.target.checked;
    saveSettings();
  });
}

function syncSettingsUi() {
  document.body.dataset.size = settings.size;

  for (const button of document.querySelectorAll('#styleSegmented button')) {
    button.setAttribute('aria-checked', String(button.dataset.style === settings.style));
  }
  for (const button of document.querySelectorAll('#sizeSegmented button')) {
    button.setAttribute('aria-checked', String(button.dataset.size === settings.size));
  }

  const style = PRONUNCIATION_STYLES.find((s) => s.id === settings.style);
  $('styleHint').textContent = style?.hint ?? '';

  $('offsetSlider').value = String(settings.offsetMs);
  $('offsetOutput').textContent = `${settings.offsetMs > 0 ? '+' : ''}${settings.offsetMs} ms`;
  $('syncOffsetLabel').textContent = `싱크 ${settings.offsetMs > 0 ? '+' : ''}${settings.offsetMs}ms`;

  $('intervalSlider').value = String(settings.intervalSec);
  $('intervalOutput').textContent = `${settings.intervalSec}초`;

  $('wakeLockToggle').checked = settings.wakeLock;
  $('externalToggle').checked = settings.external;
  $('autoStartToggle').checked = settings.autoStart;
}

function nudge(deltaMs) {
  settings.offsetMs = Math.max(-2000, Math.min(2000, settings.offsetMs + deltaMs));
  clock.userOffsetMs = settings.offsetMs;
  saveSettings();
  syncSettingsUi();
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------

function bindEvents() {
  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => showView(button.dataset.view));
  }

  $('micBtn').addEventListener('click', () => {
    state.listening ? stopListening() : startListening();
  });
  $('startBtnBig').addEventListener('click', () => startListening());
  $('demoBtn').addEventListener('click', startDemo);

  $('nudgeBack').addEventListener('click', () => nudge(-200));
  $('nudgeFwd').addEventListener('click', () => nudge(200));

  $('addTrackBtn').addEventListener('click', () => {
    resetAddForm();
    showView('add');
  });

  $('audioInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) ingestAudioFile(file);
  });
  $('fileDrop').addEventListener('click', () => $('audioInput').click());

  $('lyricsSearchBtn').addEventListener('click', searchLyrics);
  $('lyricsQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchLyrics();
  });

  $('lrcPick').addEventListener('click', () => $('lrcInput').click());
  $('lrcInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (file) $('addLyrics').value = await file.text();
  });

  $('saveTrackBtn').addEventListener('click', saveTrack);

  // 앱이 백그라운드로 갔다 오면 화면 켜두기와 오디오를 다시 살려야 한다
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (state.listening) {
      requestWakeLock();
      await mic.resume();
    } else {
      maybeAutoStart();
    }
  });
}

async function init() {
  bindEvents();
  buildSettingsUi();
  syncSettingsUi();
  clock.userOffsetMs = settings.offsetMs;

  if (!window.isSecureContext) $('secureHint').hidden = false;

  try {
    state.serverConfig = await api('GET', '/api/config');
    const providers = state.serverConfig.providers ?? {};
    const names = Object.entries(providers)
      .filter(([, on]) => on)
      .map(([name]) => name);

    $('serverInfo').textContent =
      `등록된 곡 ${state.serverConfig.trackCount ?? 0}곡 · ` +
      `지문 ${(state.serverConfig.landmarkCount ?? 0).toLocaleString()}개 · ` +
      `외부 서비스 ${names.length ? names.join(', ') : '없음'}`;

    if (!hasExternalProvider()) {
      $('externalToggle').disabled = true;
      $('externalHint').textContent =
        '서버에 ACRCloud/AudD 키가 없어 사용할 수 없습니다. 내 라이브러리의 곡만 인식합니다.';
    }
  } catch {
    $('serverInfo').textContent = '서버 정보를 불러오지 못했습니다.';
  }

  requestAnimationFrame(frame);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // 권한이 이미 있으면 버튼을 누르지 않아도 바로 듣기 시작한다
  maybeAutoStart();
}

init();
