/**
 * AudioWorklet processor for dual-channel (mic + system) audio capture.
 *
 * Accepts 2 inputs: mic (input 0) + system audio (input 1).
 * Accumulates samples, emits every 100ms (1,600 samples at 16kHz).
 * Interleaves into stereo 16-bit PCM (6,400 bytes per chunk).
 * Computes RMS levels for both channels.
 */
class DualChannelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunkSamples = 1600; // 100ms at 16kHz
    this._micBuffer = [];
    this._sysBuffer = [];
  }

  static get parameterDescriptors() {
    return [];
  }

  process(inputs) {
    // inputs[0] = mic, inputs[1] = system audio
    const micInput = inputs[0];
    const sysInput = inputs[1];

    const micSamples =
      micInput && micInput[0] ? micInput[0] : new Float32Array(128);
    const sysSamples =
      sysInput && sysInput[0] ? sysInput[0] : new Float32Array(128);

    // Accumulate samples
    for (var i = 0; i < micSamples.length; i++) {
      this._micBuffer.push(micSamples[i] || 0);
      this._sysBuffer.push(sysSamples[i] || 0);
    }

    // When we have enough for a chunk, interleave and send
    while (this._micBuffer.length >= this._chunkSamples) {
      var micChunk = this._micBuffer.splice(0, this._chunkSamples);
      var sysChunk = this._sysBuffer.splice(0, this._chunkSamples);

      // Compute RMS levels
      var micRms = 0;
      var sysRms = 0;
      for (var j = 0; j < this._chunkSamples; j++) {
        micRms += micChunk[j] * micChunk[j];
        sysRms += sysChunk[j] * sysChunk[j];
      }
      micRms = Math.sqrt(micRms / this._chunkSamples);
      sysRms = Math.sqrt(sysRms / this._chunkSamples);

      // Interleave into 16-bit PCM (ch0=mic, ch1=system)
      var interleaved = new Int16Array(this._chunkSamples * 2);
      for (var k = 0; k < this._chunkSamples; k++) {
        var micVal = Math.max(-1, Math.min(1, micChunk[k]));
        var sysVal = Math.max(-1, Math.min(1, sysChunk[k]));
        interleaved[k * 2] = micVal < 0 ? micVal * 0x8000 : micVal * 0x7fff;
        interleaved[k * 2 + 1] =
          sysVal < 0 ? sysVal * 0x8000 : sysVal * 0x7fff;
      }

      this.port.postMessage(
        {
          type: "pcm",
          buffer: interleaved.buffer,
          levels: { mic: micRms, system: sysRms },
        },
        [interleaved.buffer]
      );
    }

    return true;
  }
}

registerProcessor("dual-channel-processor", DualChannelProcessor);
