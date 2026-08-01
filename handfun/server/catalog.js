/**
 * 곡 카탈로그 저장소.
 *
 * 오디오 파일 자체는 서버에 올리지 않는다. 브라우저에서 지문만 뽑아 보내므로
 * 서버에는 랜드마크(해시)와 가사·메타데이터만 남는다.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { DATA_DIR } from './config.js';
import { FingerprintIndex } from '../shared/fingerprint-index.js';
import { unpackLandmarks } from '../shared/codec.js';
import { parseLyrics } from '../shared/lrc.js';

const CATALOG_FILE = path.join(DATA_DIR, 'catalog.json');
const FP_DIR = path.join(DATA_DIR, 'fingerprints');
const LYRICS_DIR = path.join(DATA_DIR, 'lyrics');

export class Catalog {
  constructor() {
    /** @type {Map<string, object>} */
    this.tracks = new Map();
    this.index = new FingerprintIndex();
    this.loaded = false;
  }

  async init() {
    await fsp.mkdir(FP_DIR, { recursive: true });
    await fsp.mkdir(LYRICS_DIR, { recursive: true });

    let saved = { tracks: [] };
    try {
      saved = JSON.parse(await fsp.readFile(CATALOG_FILE, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    for (const track of saved.tracks ?? []) {
      this.tracks.set(track.id, track);
      try {
        const packed = await fsp.readFile(path.join(FP_DIR, `${track.id}.b64`), 'utf8');
        this.index.addTrack(track.id, unpackLandmarks(packed.trim()));
      } catch (err) {
        // 지문 파일이 없으면 검색은 안 되지만 목록에는 남겨둔다
        if (err.code !== 'ENOENT') throw err;
        track.fingerprintMissing = true;
      }
    }

    this.loaded = true;
    return this;
  }

  list() {
    return [...this.tracks.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  get(id) {
    return this.tracks.get(id) ?? null;
  }

  /**
   * 곡을 등록한다.
   * @param {{title?: string, artist?: string, album?: string, durationMs?: number,
   *          landmarks: string, lyrics?: string, lyricsSource?: string}} input
   */
  async addTrack(input) {
    const landmarks = unpackLandmarks(input.landmarks ?? '');
    if (landmarks.hashes.length === 0) {
      throw Object.assign(new Error('지문 데이터가 비어 있습니다'), { statusCode: 400 });
    }

    const id = crypto.randomUUID();
    const track = {
      id,
      title: String(input.title ?? '제목 없음').slice(0, 200),
      artist: String(input.artist ?? '').slice(0, 200),
      album: String(input.album ?? '').slice(0, 200),
      durationMs: Number(input.durationMs) || 0,
      landmarkCount: landmarks.hashes.length,
      createdAt: Date.now(),
      hasLyrics: false,
      hasSyncedLyrics: false,
      lyricsSource: '',
    };

    await fsp.writeFile(path.join(FP_DIR, `${id}.b64`), input.landmarks, 'utf8');
    this.tracks.set(id, track);
    this.index.addTrack(id, landmarks);

    if (input.lyrics) await this.setLyrics(id, input.lyrics, input.lyricsSource);
    await this.persist();
    return this.tracks.get(id);
  }

  async setLyrics(id, lyricsText, source = 'manual') {
    const track = this.tracks.get(id);
    if (!track) throw Object.assign(new Error('없는 곡입니다'), { statusCode: 404 });

    const text = String(lyricsText ?? '');
    if (text.trim()) {
      await fsp.writeFile(path.join(LYRICS_DIR, `${id}.lrc`), text, 'utf8');
      const parsed = parseLyrics(text);
      track.hasLyrics = parsed.lines.length > 0;
      track.hasSyncedLyrics = parsed.synced;
      track.lyricsSource = source;
    } else {
      await fsp.rm(path.join(LYRICS_DIR, `${id}.lrc`), { force: true });
      track.hasLyrics = false;
      track.hasSyncedLyrics = false;
      track.lyricsSource = '';
    }

    await this.persist();
    return track;
  }

  async getLyrics(id) {
    try {
      return await fsp.readFile(path.join(LYRICS_DIR, `${id}.lrc`), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async updateMeta(id, patch) {
    const track = this.tracks.get(id);
    if (!track) throw Object.assign(new Error('없는 곡입니다'), { statusCode: 404 });

    for (const key of ['title', 'artist', 'album']) {
      if (typeof patch[key] === 'string') track[key] = patch[key].slice(0, 200);
    }
    if (patch.durationMs !== undefined) track.durationMs = Number(patch.durationMs) || 0;

    await this.persist();
    return track;
  }

  async removeTrack(id) {
    if (!this.tracks.has(id)) return false;
    this.tracks.delete(id);
    this.index.removeTrack(id);
    await fsp.rm(path.join(FP_DIR, `${id}.b64`), { force: true });
    await fsp.rm(path.join(LYRICS_DIR, `${id}.lrc`), { force: true });
    await this.persist();
    return true;
  }

  async persist() {
    const payload = { version: 1, tracks: this.list() };
    const tmp = `${CATALOG_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fsp.rename(tmp, CATALOG_FILE); // 쓰다 만 파일이 남지 않도록
  }

  stats() {
    return {
      trackCount: this.tracks.size,
      landmarkCount: this.index.landmarkCount,
      indexedTracks: this.index.trackCount,
    };
  }
}
