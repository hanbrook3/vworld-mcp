import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// 서버 모듈이 config 를 읽기 전에 데이터 디렉터리를 임시 폴더로 돌려놓는다
const TMP_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'handfun-test-'));
process.env.HANDFUN_DATA_DIR = TMP_DIR;
process.env.PORT = '0';

const { createServer, catalog } = await import('../server/index.js');
const { fingerprint } = await import('../shared/fingerprint.js');
const { packLandmarks } = await import('../shared/codec.js');
const { makeSyntheticSong, addNoise, slice } = await import('./helpers.js');

const SR = 44100;
let server;
let base;

test.before(async () => {
  await catalog.init();
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fsp.rm(TMP_DIR, { recursive: true, force: true });
});

const api = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const SAMPLE_LRC = ['[ti:테스트]', '[00:05.00] 첫 줄', '[00:10.00] 둘째 줄'].join('\n');

test('상태와 설정을 조회할 수 있다', async () => {
  const health = await api('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const conf = await api('GET', '/api/config');
  assert.equal(conf.status, 200);
  assert.ok(conf.body.providers, '기능 플래그가 있어야 한다');
  assert.equal(typeof conf.body.match.minVotes, 'number');
});

test('곡을 등록하고 목록에서 볼 수 있다', async () => {
  const song = makeSyntheticSong(60, SR, 2024);
  const fp = fingerprint(song, SR);

  const created = await api('POST', '/api/tracks', {
    title: '테스트 곡',
    artist: '테스트 아티스트',
    durationMs: 60000,
    landmarks: packLandmarks(fp),
    lyrics: SAMPLE_LRC,
  });

  assert.equal(created.status, 201);
  assert.ok(created.body.track.id);
  assert.equal(created.body.track.title, '테스트 곡');
  assert.equal(created.body.track.hasSyncedLyrics, true);
  assert.ok(created.body.track.landmarkCount > 100);

  const list = await api('GET', '/api/tracks');
  assert.equal(list.body.tracks.length, 1);

  const detail = await api('GET', `/api/tracks/${created.body.track.id}`);
  assert.equal(detail.body.lyrics, SAMPLE_LRC);
});

test('등록한 곡을 마이크 녹음처럼 인식하고 재생 위치를 돌려준다', async () => {
  const list = await api('GET', '/api/tracks');
  const track = list.body.tracks[0];

  const song = makeSyntheticSong(60, SR, 2024);
  const startSec = 27.5;
  const clip = addNoise(slice(song, SR, startSec, 5), 0.04);

  const result = await api('POST', '/api/identify', {
    landmarks: packLandmarks(fingerprint(clip, SR)),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.matched, true);
  assert.equal(result.body.source, 'local');
  assert.equal(result.body.track.id, track.id);
  assert.ok(
    Math.abs(result.body.offsetMs - startSec * 1000) < 150,
    `재생 위치 오차 ${Math.abs(result.body.offsetMs - startSec * 1000).toFixed(0)}ms`,
  );
  assert.ok(result.body.confidence > 0.5);
});

test('같은 곡을 두 번 등록하면 막는다', async () => {
  const song = makeSyntheticSong(60, SR, 2024); // 위에서 이미 등록한 곡
  const duplicate = await api('POST', '/api/tracks', {
    title: '실수로 또 등록',
    landmarks: packLandmarks(fingerprint(song, SR)),
  });

  assert.equal(duplicate.status, 409);
  assert.match(duplicate.body.error, /이미 등록/);
  assert.equal(duplicate.body.existingTrack.title, '테스트 곡', '어느 곡과 겹치는지 알려준다');

  const list = await api('GET', '/api/tracks');
  assert.equal(list.body.tracks.length, 1, '중복은 저장되지 않았다');

  // 사용자가 굳이 원하면 force 로 통과시킬 수 있다
  const forced = await api('POST', '/api/tracks', {
    title: '강제 등록',
    landmarks: packLandmarks(fingerprint(song, SR)),
    force: true,
  });
  assert.equal(forced.status, 201);
  await api('DELETE', `/api/tracks/${forced.body.track.id}`);
});

test('다른 곡은 중복으로 막지 않는다', async () => {
  const other = makeSyntheticSong(60, SR, 30303);
  const created = await api('POST', '/api/tracks', {
    title: '다른 곡',
    landmarks: packLandmarks(fingerprint(other, SR)),
  });
  assert.equal(created.status, 201);
  await api('DELETE', `/api/tracks/${created.body.track.id}`);
});

test('모르는 곡은 매칭하지 않는다', async () => {
  const other = makeSyntheticSong(20, SR, 999999);
  const result = await api('POST', '/api/identify', {
    landmarks: packLandmarks(fingerprint(slice(other, SR, 3, 5), SR)),
  });

  assert.equal(result.body.matched, false);
  assert.equal(result.body.source, null);
});

test('지문 없이 요청해도 500 이 나지 않는다', async () => {
  const result = await api('POST', '/api/identify', {});
  assert.equal(result.status, 200);
  assert.equal(result.body.matched, false);
});

test('번역 가사를 함께 저장하고 불러온다', async () => {
  const song = makeSyntheticSong(30, SR, 8888);
  const created = await api('POST', '/api/tracks', {
    title: '번역 있는 곡',
    landmarks: packLandmarks(fingerprint(song, SR)),
    lyrics: '[00:05.00] I love you\n[00:10.00] Good night',
    translation: '사랑해\n잘 자',
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.track.hasTranslation, true);

  const detail = await api('GET', `/api/tracks/${created.body.track.id}`);
  assert.equal(detail.body.translation, '사랑해\n잘 자');

  // 번역만 따로 바꿀 수 있다
  const patched = await api('PATCH', `/api/tracks/${created.body.track.id}`, {
    translation: '널 사랑해\n좋은 밤',
  });
  assert.equal(patched.body.track.hasTranslation, true);
  const after = await api('GET', `/api/tracks/${created.body.track.id}`);
  assert.equal(after.body.translation, '널 사랑해\n좋은 밤');
  assert.equal(after.body.lyrics, '[00:05.00] I love you\n[00:10.00] Good night', '원본은 그대로');

  // 빈 값으로 지울 수 있다
  const cleared = await api('PATCH', `/api/tracks/${created.body.track.id}`, { translation: '' });
  assert.equal(cleared.body.track.hasTranslation, false);
  assert.equal((await api('GET', `/api/tracks/${created.body.track.id}`)).body.translation, null);

  await api('DELETE', `/api/tracks/${created.body.track.id}`);
});

test('메타데이터와 가사를 수정할 수 있다', async () => {
  const list = await api('GET', '/api/tracks');
  const id = list.body.tracks[0].id;

  const patched = await api('PATCH', `/api/tracks/${id}`, {
    title: '바뀐 제목',
    lyrics: '[00:01.00] 새 가사',
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.track.title, '바뀐 제목');

  const detail = await api('GET', `/api/tracks/${id}`);
  assert.equal(detail.body.lyrics, '[00:01.00] 새 가사');
});

test('없는 곡을 요청하면 404 다', async () => {
  const missing = await api('GET', '/api/tracks/does-not-exist');
  assert.equal(missing.status, 404);

  const badApi = await api('GET', '/api/nope');
  assert.equal(badApi.status, 404);
});

test('곡을 삭제하면 인식되지 않는다', async () => {
  const list = await api('GET', '/api/tracks');
  const id = list.body.tracks[0].id;

  const removed = await api('DELETE', `/api/tracks/${id}`);
  assert.equal(removed.status, 200);

  const after = await api('GET', '/api/tracks');
  assert.equal(after.body.tracks.length, 0);

  const song = makeSyntheticSong(60, SR, 2024);
  const result = await api('POST', '/api/identify', {
    landmarks: packLandmarks(fingerprint(slice(song, SR, 10, 5), SR)),
  });
  assert.equal(result.body.matched, false);
});

test('정적 파일과 shared 모듈을 서빙한다', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const shared = await fetch(`${base}/shared/lrc.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);

  // 경로 탈출 시도는 막혀야 한다
  const escape = await fetch(`${base}/shared/..%2F..%2Fpackage.json`);
  assert.equal(escape.status, 404);
});

test('카탈로그는 재시작 후에도 유지된다', async () => {
  const song = makeSyntheticSong(30, SR, 555);
  await api('POST', '/api/tracks', {
    title: '유지되는 곡',
    landmarks: packLandmarks(fingerprint(song, SR)),
    lyrics: SAMPLE_LRC,
  });

  // 새 Catalog 인스턴스로 디스크에서 다시 읽는다
  const { Catalog } = await import('../server/catalog.js');
  const reloaded = await new Catalog().init();

  assert.equal(reloaded.tracks.size, 1);
  assert.equal(reloaded.list()[0].title, '유지되는 곡');
  assert.equal(await reloaded.getLyrics(reloaded.list()[0].id), SAMPLE_LRC);

  // 다시 읽은 색인으로도 매칭이 되어야 한다
  const match = reloaded.index.match(fingerprint(slice(song, SR, 8, 5), SR));
  assert.ok(match, '재시작 후에도 인식되어야 한다');
  assert.ok(Math.abs(match.offsetMs - 8000) < 150);
});
