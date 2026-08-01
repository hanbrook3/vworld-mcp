/**
 * 랜드마크(해시, 프레임시각) 목록을 base64 로 압축/복원한다.
 * 브라우저 ↔ 서버 전송량을 줄이기 위한 용도이며,
 * 랜드마크 1개당 6바이트(해시 4B + 시각 2B, 리틀엔디언)를 사용한다.
 */

const BYTES_PER_LANDMARK = 6;
const MAX_FRAME = 0xffff; // 65535 프레임 ≈ 34분 (32ms/프레임 기준)

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * @param {{hashes: Int32Array|number[], times: Int32Array|number[]}} landmarks
 * @returns {string} base64
 */
export function packLandmarks({ hashes, times }) {
  if (hashes.length !== times.length) throw new Error('packLandmarks: 길이 불일치');
  const buf = new ArrayBuffer(hashes.length * BYTES_PER_LANDMARK);
  const view = new DataView(buf);
  for (let i = 0; i < hashes.length; i++) {
    const t = times[i];
    if (t < 0 || t > MAX_FRAME) throw new Error(`packLandmarks: 프레임 시각 범위 초과 (${t})`);
    view.setUint32(i * BYTES_PER_LANDMARK, hashes[i] >>> 0, true);
    view.setUint16(i * BYTES_PER_LANDMARK + 4, t, true);
  }
  return bytesToBase64(new Uint8Array(buf));
}

/**
 * @param {string} b64
 * @returns {{hashes: Int32Array, times: Int32Array}}
 */
export function unpackLandmarks(b64) {
  if (!b64) return { hashes: new Int32Array(0), times: new Int32Array(0) };
  const bytes = base64ToBytes(b64);
  if (bytes.length % BYTES_PER_LANDMARK !== 0) {
    throw new Error('unpackLandmarks: 손상된 데이터 길이');
  }
  const count = bytes.length / BYTES_PER_LANDMARK;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hashes = new Int32Array(count);
  const times = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    hashes[i] = view.getUint32(i * BYTES_PER_LANDMARK, true);
    times[i] = view.getUint16(i * BYTES_PER_LANDMARK + 4, true);
  }
  return { hashes, times };
}
