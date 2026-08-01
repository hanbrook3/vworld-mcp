/**
 * 마이크 캡처.
 *
 * 최근 N초를 원형 버퍼에 계속 담아 두고, 인식할 때마다 마지막 몇 초를 잘라 쓴다.
 * 음악을 그대로 받아야 하므로 에코 제거·잡음 억제·자동 이득은 모두 끈다.
 */

export class MicRecorder {
  constructor({ bufferSeconds = 15 } = {}) {
    this.bufferSeconds = bufferSeconds;
    this.stream = null;
    this.context = null;
    this.node = null;
    this.source = null;
    this.ring = null;
    this.writeIndex = 0;
    this.totalWritten = 0;
    /** 최근 입력 레벨 (0~1). 마이크가 실제로 소리를 받고 있는지 확인용 */
    this.level = 0;
  }

  get isRunning() {
    return Boolean(this.context && this.context.state !== 'closed');
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 0;
  }

  /** 잘라낼 수 있을 만큼 소리가 쌓였는지 */
  hasSeconds(seconds) {
    return this.totalWritten >= seconds * this.sampleRate;
  }

  async start() {
    if (this.isRunning) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저에서는 마이크를 쓸 수 없습니다');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    this.context = new (window.AudioContext ?? window.webkitAudioContext)();
    if (this.context.state === 'suspended') await this.context.resume();

    await this.context.audioWorklet.addModule('/recorder-worklet.js');

    this.ring = new Float32Array(Math.ceil(this.bufferSeconds * this.context.sampleRate));
    this.writeIndex = 0;
    this.totalWritten = 0;

    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'handfun-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.node.port.onmessage = (event) => this.#append(event.data);
    this.source.connect(this.node);
  }

  #append(chunk) {
    const ring = this.ring;
    if (!ring) return;

    let peak = 0;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      ring[this.writeIndex] = v;
      this.writeIndex = (this.writeIndex + 1) % ring.length;
      const abs = v < 0 ? -v : v;
      if (abs > peak) peak = abs;
    }
    this.totalWritten += chunk.length;
    // 레벨 표시는 급격히 튀지 않게 완만히 따라가게 한다
    this.level = Math.max(peak, this.level * 0.8);
  }

  /**
   * 가장 최근 구간을 잘라낸다.
   * @param {number} seconds
   * @returns {{samples: Float32Array, sampleRate: number, capturedAt: number} | null}
   */
  takeWindow(seconds) {
    if (!this.ring || !this.hasSeconds(seconds)) return null;

    const capturedAt = performance.now();
    const length = Math.min(this.ring.length, Math.floor(seconds * this.sampleRate));
    const samples = new Float32Array(length);
    let read = (this.writeIndex - length + this.ring.length) % this.ring.length;

    for (let i = 0; i < length; i++) {
      samples[i] = this.ring[read];
      read = (read + 1) % this.ring.length;
    }

    return { samples, sampleRate: this.sampleRate, capturedAt };
  }

  async stop() {
    this.node?.port?.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== 'closed') await this.context.close();

    this.node = null;
    this.source = null;
    this.stream = null;
    this.context = null;
    this.ring = null;
    this.totalWritten = 0;
    this.level = 0;
  }
}

/**
 * Float32 PCM 을 16bit WAV 로 만든다.
 * 외부 인식 서비스(ACRCloud/AudD)로 보낼 때만 쓴다.
 */
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/** ArrayBuffer → base64 */
export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
