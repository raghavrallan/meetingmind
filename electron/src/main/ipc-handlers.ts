import { ipcMain, BrowserWindow } from 'electron';
import { AudioCaptureManager } from './audio-capture';
import { DeepgramStreamManager, TranscriptSegment } from './deepgram-stream';
import { updateTrayMenu, showNotification } from './tray';

/** Recording state shared across handlers */
interface RecordingState {
  isRecording: boolean;
  meetingId: string | null;
  meetingTitle: string | null;
  startedAt: number | null;
  apiUrl: string;
}

const state: RecordingState = {
  isRecording: false,
  meetingId: null,
  meetingTitle: null,
  startedAt: null,
  apiUrl: process.env.API_URL || 'http://localhost:8000',
};

const audioCaptureManager = new AudioCaptureManager();
const deepgramStream = new DeepgramStreamManager();

/**
 * Register all IPC handlers that bridge the renderer and main process.
 * Channel names are kept in sync with the preload script and renderer.
 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // Let the audio capture manager listen for PCM data from renderer
  audioCaptureManager.registerIpcListeners();

  // ─── Start Recording ───────────────────────────────────────────────
  ipcMain.handle(
    'start-recording',
    async (_event, args: { meetingId: string; meetingTitle?: string; apiUrl?: string }) => {
      if (state.isRecording) {
        return { success: false, error: 'Already recording' };
      }

      try {
        state.meetingId = args.meetingId;
        state.meetingTitle = args.meetingTitle || null;
        state.apiUrl = args.apiUrl || state.apiUrl;
        state.startedAt = Date.now();
        state.isRecording = true;

        // Connect the WebSocket to the backend
        deepgramStream.connect(args.meetingId, state.apiUrl);

        // Start audio capture (tells renderer to begin capturing)
        audioCaptureManager.startCapture(mainWindow.webContents);

        // Update tray
        updateTrayMenu(true);
        showNotification('Recording Started', `Meeting: ${state.meetingTitle || args.meetingId}`);

        // Notify renderer of state change
        mainWindow.webContents.send('recording-status', {
          isRecording: true,
          meetingId: state.meetingId,
          meetingTitle: state.meetingTitle,
          startedAt: state.startedAt,
        });

        return { success: true };
      } catch (err) {
        state.isRecording = false;
        state.startedAt = null;
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
      }
    }
  );

  // ─── Stop Recording ────────────────────────────────────────────────
  ipcMain.handle('stop-recording', async () => {
    if (!state.isRecording) {
      return { success: false, error: 'Not recording' };
    }

    try {
      // Stop audio capture
      audioCaptureManager.stopCapture(mainWindow.webContents);

      // Disconnect the stream
      deepgramStream.disconnect();

      const duration = state.startedAt ? Date.now() - state.startedAt : 0;

      state.isRecording = false;
      state.startedAt = null;

      // Update tray
      updateTrayMenu(false);
      showNotification('Recording Stopped', `Duration: ${formatDuration(duration)}`);

      // Notify renderer
      mainWindow.webContents.send('recording-status', {
        isRecording: false,
        meetingId: state.meetingId,
        meetingTitle: state.meetingTitle,
        startedAt: null,
      });

      return { success: true, duration };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  // ─── Get Audio Devices ─────────────────────────────────────────────
  ipcMain.handle('get-audio-devices', async () => {
    // The renderer will enumerate devices via navigator.mediaDevices
    // We return a signal that tells the renderer to query and return results
    // This is handled in the renderer; the main process simply forwards
    return { success: true };
  });

  // ─── Get Recording Status ──────────────────────────────────────────
  ipcMain.handle('get-recording-status', async () => {
    return {
      isRecording: state.isRecording,
      meetingId: state.meetingId,
      meetingTitle: state.meetingTitle,
      startedAt: state.startedAt,
      connectionState: deepgramStream.getState(),
    };
  });

  // ─── Select Meeting ────────────────────────────────────────────────
  ipcMain.handle(
    'select-meeting',
    async (_event, args: { meetingId: string; meetingTitle?: string }) => {
      state.meetingId = args.meetingId;
      state.meetingTitle = args.meetingTitle || null;
      return { success: true };
    }
  );

  // ─── Select Microphone ────────────────────────────────────────────
  ipcMain.handle('select-microphone', async (_event, deviceId: string) => {
    audioCaptureManager.selectMicrophone(deviceId);
    return { success: true };
  });

  // ─── Forward audio data from capture to Deepgram stream ───────────
  audioCaptureManager.on('data', (chunk: Buffer) => {
    deepgramStream.sendAudio(chunk);
  });

  // ─── Forward audio levels to renderer for waveform visualisation ──
  audioCaptureManager.on('level', (levels: { mic: number; system: number }) => {
    mainWindow.webContents.send('audio-level', levels);
  });

  // ─── Forward transcripts from Deepgram to renderer ────────────────
  deepgramStream.onTranscript((segment: TranscriptSegment) => {
    mainWindow.webContents.send('transcript-update', segment);
  });

  // ─── Forward Deepgram connection state to renderer ────────────────
  deepgramStream.on('state-change', (stateChange: { from: string; to: string }) => {
    mainWindow.webContents.send('connection-state', stateChange);
  });

  // ─── API Proxy — route renderer fetch through main process ────────
  ipcMain.handle(
    'api-fetch',
    async (
      _event,
      args: { url: string; method?: string; headers?: Record<string, string>; body?: string }
    ) => {
      try {
        const res = await fetch(args.url, {
          method: args.method || 'GET',
          headers: args.headers,
          body: args.body,
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, body: text };
      } catch (err) {
        return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // ─── Handle errors ────────────────────────────────────────────────
  audioCaptureManager.on('error', (error: Error) => {
    console.error('[IPC] Audio capture error:', error.message);
    mainWindow.webContents.send('capture-error', error.message);
  });

  deepgramStream.on('error', (error: Error) => {
    console.error('[IPC] Deepgram stream error:', error.message);
    mainWindow.webContents.send('stream-error', error.message);
  });
}

/** Format milliseconds into MM:SS */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
