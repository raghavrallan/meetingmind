/**
 * Renderer-side audio capture logic.
 *
 * Because the Web Audio API (AudioContext, MediaStream, AudioWorklet) is
 * only available in the renderer process, all actual audio capture and
 * mixing happens here. The mixed, interleaved 16-bit PCM is then sent
 * to the main process over IPC.
 */

import type { AudioCaptureConfig } from './types';

/** AudioWorklet processor code as an inline string (will be turned into a Blob URL) */
const WORKLET_PROCESSOR_CODE = `
class DualChannelProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 0;
    this._sampleRate = 16000;
    this._chunkSamples = 1600; // 100ms at 16kHz
    this._micBuffer = [];
    this._sysBuffer = [];
  }

  static get parameterDescriptors() {
    return [];
  }

  process(inputs, outputs, parameters) {
    // inputs[0] = mic, inputs[1] = system audio
    const micInput = inputs[0];
    const sysInput = inputs[1];

    const micSamples = micInput && micInput[0] ? micInput[0] : new Float32Array(128);
    const sysSamples = sysInput && sysInput[0] ? sysInput[0] : new Float32Array(128);

    // Accumulate samples
    for (let i = 0; i < micSamples.length; i++) {
      this._micBuffer.push(micSamples[i] || 0);
      this._sysBuffer.push(sysSamples[i] || 0);
    }

    // When we have enough for a chunk, interleave and send
    while (this._micBuffer.length >= this._chunkSamples) {
      const micChunk = this._micBuffer.splice(0, this._chunkSamples);
      const sysChunk = this._sysBuffer.splice(0, this._chunkSamples);

      // Compute RMS levels
      let micRms = 0, sysRms = 0;
      for (let i = 0; i < this._chunkSamples; i++) {
        micRms += micChunk[i] * micChunk[i];
        sysRms += sysChunk[i] * sysChunk[i];
      }
      micRms = Math.sqrt(micRms / this._chunkSamples);
      sysRms = Math.sqrt(sysRms / this._chunkSamples);

      // Interleave into 16-bit PCM (ch0=mic, ch1=system)
      const interleaved = new Int16Array(this._chunkSamples * 2);
      for (let i = 0; i < this._chunkSamples; i++) {
        const micVal = Math.max(-1, Math.min(1, micChunk[i]));
        const sysVal = Math.max(-1, Math.min(1, sysChunk[i]));
        interleaved[i * 2] = micVal < 0 ? micVal * 0x8000 : micVal * 0x7FFF;
        interleaved[i * 2 + 1] = sysVal < 0 ? sysVal * 0x8000 : sysVal * 0x7FFF;
      }

      this.port.postMessage({
        type: 'pcm',
        buffer: interleaved.buffer,
        levels: { mic: micRms, system: sysRms },
      }, [interleaved.buffer]);
    }

    return true;
  }
}

registerProcessor('dual-channel-processor', DualChannelProcessor);
`;

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let systemStream: MediaStream | null = null;
let workletNode: AudioWorkletNode | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let systemSource: MediaStreamAudioSourceNode | null = null;
let merger: ChannelMergerNode | null = null;

/**
 * Start capturing dual audio streams and mixing them via an AudioWorklet.
 */
export async function startAudioCapture(config: AudioCaptureConfig): Promise<void> {
  const { micDeviceId, sampleRate } = config;

  try {
    // 1. Create AudioContext at the target sample rate
    audioContext = new AudioContext({ sampleRate });

    // 2. Get microphone stream
    const micConstraints: MediaStreamConstraints = {
      audio: {
        ...(micDeviceId ? { deviceId: { exact: micDeviceId } } : {}),
        sampleRate: { ideal: sampleRate },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    };
    micStream = await navigator.mediaDevices.getUserMedia(micConstraints);

    // 3. Get system audio via desktopCapturer
    // Request the first screen source to capture system audio
    const sources = await window.electronAPI.getDesktopSources();
    const screenSource = sources.find((s) => s.name === 'Entire Screen' || s.name === 'Screen 1') || sources[0];

    if (!screenSource) {
      throw new Error('No screen source found for system audio capture');
    }

    systemStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
        },
      } as any,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
          maxWidth: 1,
          maxHeight: 1,
          maxFrameRate: 1,
        },
      } as any,
    });

    // Remove the video track since we only need audio
    systemStream.getVideoTracks().forEach((track) => track.stop());

    // 4. Create source nodes
    micSource = audioContext.createMediaStreamSource(micStream);
    systemSource = audioContext.createMediaStreamSource(systemStream);

    // 5. Register the AudioWorklet processor
    const blob = new Blob([WORKLET_PROCESSOR_CODE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    // 6. Create the worklet node with 2 inputs (mic + system)
    workletNode = new AudioWorkletNode(audioContext, 'dual-channel-processor', {
      numberOfInputs: 2,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: 'explicit',
    });

    // 7. Listen for PCM chunks from the worklet
    workletNode.port.onmessage = (event) => {
      const { type, buffer, levels } = event.data;
      if (type === 'pcm') {
        window.electronAPI.sendAudioChunk(buffer);
        window.electronAPI.sendAudioLevels(levels);
      }
    };

    // 8. Connect: mic → worklet input 0, system → worklet input 1
    micSource.connect(workletNode, 0, 0);
    systemSource.connect(workletNode, 0, 1);

  } catch (err) {
    await stopAudioCapture();
    const message = err instanceof Error ? err.message : String(err);
    window.electronAPI.sendCaptureError(message);
    throw err;
  }
}

/**
 * Stop all audio capture and release resources.
 */
export async function stopAudioCapture(): Promise<void> {
  // Disconnect worklet
  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }

  // Disconnect sources
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (systemSource) {
    systemSource.disconnect();
    systemSource = null;
  }

  // Stop media tracks
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (systemStream) {
    systemStream.getTracks().forEach((track) => track.stop());
    systemStream = null;
  }

  // Close audio context
  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  if (merger) {
    merger.disconnect();
    merger = null;
  }
}

/**
 * Enumerate available audio input devices.
 */
export async function enumerateAudioDevices(): Promise<
  { deviceId: string; label: string }[]
> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Microphone ${d.deviceId.slice(0, 8)}`,
    }));
}
