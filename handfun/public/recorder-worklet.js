/**
 * 마이크 원본 PCM 을 일정 크기로 모아 메인 스레드로 보내는 AudioWorklet.
 * (ScriptProcessorNode 와 달리 오디오 스레드를 막지 않는다)
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.chunk[this.offset++] = channel[i];
      if (this.offset === this.chunk.length) {
        const copy = this.chunk.slice();
        this.port.postMessage(copy, [copy.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('handfun-recorder', RecorderProcessor);
