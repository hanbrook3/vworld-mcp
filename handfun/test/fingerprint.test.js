import test from 'node:test';
import assert from 'node:assert/strict';

import { fingerprint, FRAME_MS, encodeHash } from '../shared/fingerprint.js';
import { FingerprintIndex } from '../shared/fingerprint-index.js';
import { packLandmarks, unpackLandmarks } from '../shared/codec.js';
import { resample } from '../shared/dsp.js';
import { makeSyntheticSong, addNoise, slice } from './helpers.js';

const SR = 44100;

test('해시 인코딩은 f1/f2/Δt 를 겹치지 않게 담는다', () => {
  assert.equal(encodeHash(0, 0, 0), 0);
  assert.notEqual(encodeHash(1, 0, 0), encodeHash(0, 1, 0));
  assert.notEqual(encodeHash(0, 1, 0), encodeHash(0, 0, 1));
  assert.equal(encodeHash(255, 255, 63), (255 << 14) | (255 << 6) | 63);
});

test('리샘플링은 길이를 비율에 맞게 바꾸고 신호를 유지한다', () => {
  const sr = 44100;
  const n = sr; // 1초
  const input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / sr);

  const out = resample(input, sr, 8000);
  assert.ok(Math.abs(out.length - 8000) <= 1, `길이 ${out.length}`);

  // 저역통과를 통과하는 440Hz 성분이므로 진폭이 크게 유지되어야 한다
  let peak = 0;
  for (let i = 100; i < out.length - 100; i++) peak = Math.max(peak, Math.abs(out[i]));
  assert.ok(peak > 0.7, `피크 진폭 ${peak}`);
});

test('지문은 충분한 수의 랜드마크를 만든다', () => {
  const song = makeSyntheticSong(10, SR, 1);
  const fp = fingerprint(song, SR);
  assert.ok(fp.hashes.length > 500, `랜드마크 ${fp.hashes.length}개`);
  assert.equal(fp.hashes.length, fp.times.length);
  assert.ok(Math.abs(fp.durationMs - 10000) < 50);
  assert.ok(Math.abs(fp.frameMs - FRAME_MS) < 1e-9);
});

test('랜드마크 pack/unpack 은 왕복해도 동일하다', () => {
  const song = makeSyntheticSong(5, SR, 7);
  const fp = fingerprint(song, SR);
  const packed = packLandmarks(fp);
  const back = unpackLandmarks(packed);

  assert.equal(back.hashes.length, fp.hashes.length);
  for (let i = 0; i < fp.hashes.length; i++) {
    assert.equal(back.hashes[i], fp.hashes[i]);
    assert.equal(back.times[i], fp.times[i]);
  }
  // base64 는 같은 내용의 JSON 보다 작아야 한다
  const asJson = JSON.stringify({
    hashes: Array.from(fp.hashes),
    times: Array.from(fp.times),
  });
  assert.ok(packed.length < asJson.length, `base64 ${packed.length} vs JSON ${asJson.length}`);
});

test('깨끗한 구간은 곡과 재생 위치를 정확히 찾아낸다', () => {
  const song = makeSyntheticSong(90, SR, 42);
  const index = new FingerprintIndex();
  index.addTrack('song-a', fingerprint(song, SR));

  for (const startSec of [0, 12.5, 41.2, 77]) {
    const query = slice(song, SR, startSec, 5);
    const result = index.match(fingerprint(query, SR));

    assert.ok(result, `${startSec}s 구간이 매칭되지 않음`);
    assert.equal(result.trackId, 'song-a');
    const errMs = Math.abs(result.offsetMs - startSec * 1000);
    assert.ok(errMs <= 2 * FRAME_MS, `${startSec}s 구간 오프셋 오차 ${errMs.toFixed(1)}ms`);
  }
});

test('잡음이 섞인 구간도 올바른 곡·위치를 찾아낸다', () => {
  const song = makeSyntheticSong(90, SR, 42);
  const index = new FingerprintIndex();
  index.addTrack('song-a', fingerprint(song, SR));

  const startSec = 33.4;
  const noisy = addNoise(slice(song, SR, startSec, 6), 0.05);
  const result = index.match(fingerprint(noisy, SR));

  assert.ok(result, '잡음 구간이 매칭되지 않음');
  assert.equal(result.trackId, 'song-a');
  const errMs = Math.abs(result.offsetMs - startSec * 1000);
  assert.ok(errMs <= 3 * FRAME_MS, `오프셋 오차 ${errMs.toFixed(1)}ms`);
  assert.ok(result.confidence > 0.5, `신뢰도 ${result.confidence}`);
});

test('여러 곡 중에서 올바른 곡을 고른다', () => {
  const index = new FingerprintIndex();
  const songs = {};
  for (let i = 0; i < 5; i++) {
    const id = `song-${i}`;
    songs[id] = makeSyntheticSong(60, SR, 100 + i);
    index.addTrack(id, fingerprint(songs[id], SR));
  }
  assert.equal(index.trackCount, 5);

  const target = 'song-3';
  const startSec = 21.7;
  const query = addNoise(slice(songs[target], SR, startSec, 5), 0.03);
  const result = index.match(fingerprint(query, SR));

  assert.ok(result, '매칭 실패');
  assert.equal(result.trackId, target);
  assert.ok(Math.abs(result.offsetMs - startSec * 1000) <= 3 * FRAME_MS);
});

test('카탈로그에 없는 곡은 매칭하지 않는다', () => {
  const index = new FingerprintIndex();
  index.addTrack('known', fingerprint(makeSyntheticSong(60, SR, 5), SR));

  // 무관한 곡 여러 개로 오탐(false positive)이 없는지 확인한다
  for (const seed of [777, 888, 999, 4242]) {
    const unknown = makeSyntheticSong(20, SR, seed);
    const result = index.match(fingerprint(slice(unknown, SR, 4, 5), SR));
    assert.equal(result, null, `seed ${seed} 에서 오탐 발생: ${JSON.stringify(result)}`);
  }
});

test('무음/조용한 입력은 매칭하지 않는다', () => {
  const index = new FingerprintIndex();
  index.addTrack('known', fingerprint(makeSyntheticSong(60, SR, 5), SR));

  const silence = new Float32Array(SR * 5);
  assert.equal(index.match(fingerprint(silence, SR)), null);
});

test('곡을 제거하면 더 이상 매칭되지 않는다', () => {
  const song = makeSyntheticSong(40, SR, 314);
  const index = new FingerprintIndex();
  index.addTrack('temp', fingerprint(song, SR));

  const query = fingerprint(slice(song, SR, 10, 5), SR);
  assert.ok(index.match(query));

  assert.equal(index.removeTrack('temp'), true);
  assert.equal(index.trackCount, 0);
  assert.equal(index.match(query), null);
  assert.equal(index.removeTrack('temp'), false);
});
