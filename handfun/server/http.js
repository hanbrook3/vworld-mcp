/** 외부 의존성 없이 쓰는 아주 작은 HTTP 유틸 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.lrc': 'text/plain; charset=utf-8',
};

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra });
}

/** 요청 본문을 JSON 으로 읽는다. 크기 제한을 넘으면 413 을 던진다. */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('본문이 너무 큽니다'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON 형식이 아닙니다'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 디렉터리 밖으로 벗어나지 않도록 검사하며 정적 파일을 보낸다.
 * @returns {Promise<boolean>} 파일을 보냈으면 true
 */
export async function serveStatic(res, baseDir, relativePath, { cacheSeconds = 0 } = {}) {
  const decoded = decodeURIComponent(relativePath);
  const target = path.resolve(baseDir, `.${path.posix.normalize('/' + decoded)}`);

  // 경로 탈출 방지
  if (target !== baseDir && !target.startsWith(baseDir + path.sep)) return false;

  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  res.writeHead(200, {
    'content-type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-cache',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}

/**
 * 아주 단순한 경로 매칭기. '/api/tracks/:id' 형태를 지원한다.
 * @returns {Record<string, string> | null}
 */
export function matchPath(pattern, pathname) {
  const pp = pattern.split('/');
  const ap = pathname.split('/');
  if (pp.length !== ap.length) return null;

  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) {
      if (!ap[i]) return null;
      params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    } else if (pp[i] !== ap[i]) {
      return null;
    }
  }
  return params;
}

/** 타임아웃이 걸린 fetch */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
