import { desktopCapturer, ipcMain } from 'electron';
import { EventEmitter } from 'events';

/** Target audio format constants */
const TARGET_SAMPLE_RATE = 16000;
const CHANNELS = 2; // ch0 = mic, ch1 = system
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const CHUNK_DURATION_MS = 100; // How often we emit PCM chunks
const SAMPLES_PER_CHUNK = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000;

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: string;
}

interface AudioCaptureEvents {
  data: (chunk: Buffer) => void;
  level: (levels: { mic: number; system: number }) => void;
  error: (error: Error) => void;
  started: () => void;
  stopped: () => void;
}

/**
 * AudioCaptureManager handles dual audio capture: system audio via
 * desktopCapturer and microphone via getUserMedia. Audio is mixed into
 * interleaved 2-channel 16-bit PCM at 16 kHz and emitted as chunks.
 *
 * NOTE: The actual MediaStream / AudioContext work happens in the renderer
 * process because Electron's main process does not have Web Audio APIs.
 * This class coordinates via IPC: the renderer performs the capture and
 * posts PCM buffers back to main for streaming to the backend.
 */
export class AudioCaptureManager extends EventEmitter {
  private isCapturing = false;
  private selectedMicId: string | null = null;
  private micBuffer: Float32Array[] = [];
  private systemBuffer: Float32Array[] = [];

  constructor() {
    super();
  }

  /** Set the preferred microphone device ID */
  selectMicrophone(deviceId: string): void {
    this.selectedMicId = deviceId;
  }

  /** Get the device ID of the currently selected microphone */
  getSelectedMicrophone(): string | null {
    return this.selectedMicId;
  }

  /**
   * Get available desktop capturer sources (screen / window).
   * The renderer will use one of these to obtain system audio.
   */
  async getDesktopSources(): Promise<{ id: string; name: string }[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  }

  /**
   * Start audio capture. This tells the renderer to begin capturing
   * system audio + mic and streaming PCM chunks back over IPC.
   */
  startCapture(webContents: Electron.WebContents): void {
    if (this.isCapturing) return;
    this.isCapturing = true;

    // Tell the renderer to start capturing audio
    webContents.send('audio-capture-start', {
      micDeviceId: this.selectedMicId,
      sampleRate: TARGET_SAMPLE_RATE,
      channels: CHANNELS,
      chunkDurationMs: CHUNK_DURATION_MS,
    });

    this.emit('started');
  }

  /**
   * Stop audio capture. Tells the renderer to tear down streams.
   */
  stopCapture(webContents: Electron.WebContents): void {
    if (!this.isCapturing) return;
    this.isCapturing = false;

    webContents.send('audio-capture-stop');
    this.emit('stopped');
  }

  /** Whether capture is currently active */
  getIsCapturing(): boolean {
    return this.isCapturing;
  }

  /**
   * Register IPC listeners for audio data coming from the renderer.
   * The renderer runs the AudioWorklet and sends interleaved PCM buffers.
   */
  registerIpcListeners(): void {
    // Receive interleaved 16-bit PCM chunks from renderer
    ipcMain.on('audio-pcm-chunk', (_event, data: ArrayBuffer) => {
      const chunk = Buffer.from(data);
      this.emit('data', chunk);
    });

    // Receive audio levels for visualisation
    ipcMain.on('audio-levels', (_event, levels: { mic: number; system: number }) => {
      this.emit('level', levels);
    });

    // Handle errors from renderer audio pipeline
    ipcMain.on('audio-capture-error', (_event, message: string) => {
      this.emit('error', new Error(message));
    });
  }
}

/**
 * Utility: convert a Float32Array (range -1..1) to a 16-bit PCM Int16Array.
 * This is used by the renderer-side AudioWorklet, but exported here for
 * completeness / tests.
 */
export function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * Utility: interleave two mono Float32Arrays into a stereo Float32Array.
 * ch0 = mic, ch1 = system. Output length = 2 * min(a.length, b.length).
 */
export function interleave(micSamples: Float32Array, systemSamples: Float32Array): Float32Array {
  const length = Math.min(micSamples.length, systemSamples.length);
  const result = new Float32Array(length * 2);
  for (let i = 0; i < length; i++) {
    result[i * 2] = micSamples[i]; // ch0 = mic
    result[i * 2 + 1] = systemSamples[i]; // ch1 = system
  }
  return result;
}

/**
 * Utility: compute RMS level of a Float32Array, returned as 0..1.
 */
export function computeRmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}
