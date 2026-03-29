/**
 * AudioWorklet processor for mono microphone capture.
 * Accumulates samples, emits every 100ms (1,600 samples at 16kHz).
 * Outputs 16-bit mono PCM (3,200 bytes per chunk).
 */
class MonoPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunkSamples = 1600; // 100ms at 16kHz
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    const samples = input && input[0] ? input[0] : new Float32Array(128);

    for (var i = 0; i < samples.length; i++) {
      this._buffer.push(samples[i] || 0);
    }

    while (this._buffer.length >= this._chunkSamples) {
      var chunk = this._buffer.splice(0, this._chunkSamples);

      var rms = 0;
      var pcm = new Int16Array(this._chunkSamples);
      for (var j = 0; j < this._chunkSamples; j++) {
        var val = Math.max(-1, Math.min(1, chunk[j]));
        pcm[j] = val < 0 ? val * 0x8000 : val * 0x7fff;
        rms += val * val;
      }
      rms = Math.sqrt(rms / this._chunkSamples);

      this.port.postMessage(
        { type: "pcm", buffer: pcm.buffer, level: rms },
        [pcm.buffer]
      );
    }

    return true;
  }
}

registerProcessor("mono-pcm-processor", MonoPcmProcessor);
