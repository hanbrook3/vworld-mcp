import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const SHARED_DIR = path.join(ROOT, 'shared');
export const DATA_DIR = process.env.HANDFUN_DATA_DIR
  ? path.resolve(process.env.HANDFUN_DATA_DIR)
  : path.join(ROOT, 'data');

export const config = {
  port: Number(process.env.PORT ?? 8090),
  host: process.env.HOST ?? '0.0.0.0',

  /** 요청 본문 최대 크기 (지문 데이터가 커질 수 있어 넉넉히 잡는다) */
  maxBodyBytes: Number(process.env.HANDFUN_MAX_BODY ?? 12 * 1024 * 1024),

  /** 매칭 판정 기준 (환경에 따라 조정 가능) */
  match: {
    minVotes: Number(process.env.HANDFUN_MIN_VOTES ?? 8),
    minRatio: Number(process.env.HANDFUN_MIN_RATIO ?? 1.5),
    minSignificance: Number(process.env.HANDFUN_MIN_SIGNIFICANCE ?? 4),
  },

  /** 외부 가사 API (LRCLIB 은 키가 필요 없다) */
  lrclib: {
    enabled: process.env.HANDFUN_LRCLIB !== 'off',
    baseUrl: process.env.HANDFUN_LRCLIB_URL ?? 'https://lrclib.net',
    timeoutMs: 8000,
  },

  /** 외부 음악 인식 API (키가 있을 때만 활성화된다) */
  audd: {
    apiToken: process.env.AUDD_API_TOKEN ?? '',
    baseUrl: 'https://api.audd.io/',
    timeoutMs: 12000,
  },
  acrcloud: {
    host: process.env.ACRCLOUD_HOST ?? '',
    accessKey: process.env.ACRCLOUD_ACCESS_KEY ?? '',
    accessSecret: process.env.ACRCLOUD_ACCESS_SECRET ?? '',
    timeoutMs: 12000,
  },
};

/** 클라이언트에 알려줄 기능 플래그 */
export function publicConfig() {
  return {
    lrclib: config.lrclib.enabled,
    audd: Boolean(config.audd.apiToken),
    acrcloud: Boolean(config.acrcloud.host && config.acrcloud.accessKey && config.acrcloud.accessSecret),
  };
}
