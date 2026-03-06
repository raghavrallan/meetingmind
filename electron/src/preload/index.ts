import { contextBridge, ipcRenderer } from 'electron';

/**
 * Type definitions for the API exposed to the renderer process.
 * These must stay in sync with the IPC handlers in main/ipc-handlers.ts.
 */
export interface ElectronAPI {
  /** Start recording for the given meeting */
  startRecording: (args: {
    meetingId: string;
    meetingTitle?: string;
    apiUrl?: string;
  }) => Promise<{ success: boolean; error?: string }>;

  /** Stop the current recording */
  stopRecording: () => Promise<{ success: boolean; error?: string; duration?: number }>;

  /** Trigger device enumeration (actual enumeration happens in renderer) */
  getDevices: () => Promise<{ success: boolean }>;

  /** Get current recording status */
  getStatus: () => Promise<{
    isRecording: boolean;
    meetingId: string | null;
    meetingTitle: string | null;
    startedAt: number | null;
    connectionState: string;
  }>;

  /** Set the active meeting */
  selectMeeting: (args: {
    meetingId: string;
    meetingTitle?: string;
  }) => Promise<{ success: boolean }>;

  /** Set the microphone device */
  selectMicrophone: (deviceId: string) => Promise<{ success: boolean }>;

  /** Get desktop capturer sources for system audio */
  getDesktopSources: () => Promise<{ id: string; name: string }[]>;

  /** Proxy an HTTP fetch through the main process (bypasses renderer CORS) */
  apiFetch: (args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: boolean; status: number; body: string }>;

  // ── Events from main → renderer ──────────────────────────────────

  /** Subscribe to live transcript updates */
  onTranscript: (
    callback: (segment: {
      speaker: string;
      text: string;
      timestamp: number;
      isFinal: boolean;
      confidence: number;
    }) => void
  ) => () => void;

  /** Subscribe to audio level updates for waveform visualisation */
  onAudioLevel: (callback: (levels: { mic: number; system: number }) => void) => () => void;

  /** Subscribe to recording status changes */
  onStatusChange: (
    callback: (status: {
      isRecording: boolean;
      meetingId: string | null;
      meetingTitle: string | null;
      startedAt: number | null;
    }) => void
  ) => () => void;

  /** Subscribe to connection state changes */
  onConnectionState: (
    callback: (state: { from: string; to: string }) => void
  ) => () => void;

  /** Subscribe to tray actions (start/stop from tray menu) */
  onTrayAction: (callback: (action: string) => void) => () => void;

  /** Subscribe to audio capture commands from main */
  onAudioCaptureStart: (
    callback: (config: {
      micDeviceId: string | null;
      sampleRate: number;
      channels: number;
      chunkDurationMs: number;
    }) => void
  ) => () => void;

  onAudioCaptureStop: (callback: () => void) => () => void;

  /** Subscribe to capture/stream errors */
  onCaptureError: (callback: (message: string) => void) => () => void;
  onStreamError: (callback: (message: string) => void) => () => void;

  // ── Events from renderer → main ──────────────────────────────────

  /** Send PCM audio chunk to main process */
  sendAudioChunk: (data: ArrayBuffer) => void;

  /** Send audio levels to main process */
  sendAudioLevels: (levels: { mic: number; system: number }) => void;

  /** Report a capture error to main */
  sendCaptureError: (message: string) => void;

  // ── Window controls ──────────────────────────────────────────────

  /** Minimize the window */
  minimizeWindow: () => void;

  /** Close (hide) the window */
  closeWindow: () => void;
}

/**
 * Helper to create a subscribable event listener that returns an unsubscribe function.
 */
function createEventSubscription<T>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  };
}

// Expose a safe, typed API to the renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Invoke handlers (renderer → main, with response) ─────────────
  startRecording: (args) => ipcRenderer.invoke('start-recording', args),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getDevices: () => ipcRenderer.invoke('get-audio-devices'),
  getStatus: () => ipcRenderer.invoke('get-recording-status'),
  selectMeeting: (args) => ipcRenderer.invoke('select-meeting', args),
  selectMicrophone: (deviceId) => ipcRenderer.invoke('select-microphone', deviceId),
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  apiFetch: (args) => ipcRenderer.invoke('api-fetch', args),

  // ── Event subscriptions (main → renderer) ────────────────────────
  onTranscript: createEventSubscription('transcript-update'),
  onAudioLevel: createEventSubscription('audio-level'),
  onStatusChange: createEventSubscription('recording-status'),
  onConnectionState: createEventSubscription('connection-state'),
  onTrayAction: createEventSubscription('tray-action'),
  onAudioCaptureStart: createEventSubscription('audio-capture-start'),
  onAudioCaptureStop: createEventSubscription('audio-capture-stop'),
  onCaptureError: createEventSubscription('capture-error'),
  onStreamError: createEventSubscription('stream-error'),

  // ── Fire-and-forget messages (renderer → main) ───────────────────
  sendAudioChunk: (data: ArrayBuffer) => ipcRenderer.send('audio-pcm-chunk', data),
  sendAudioLevels: (levels) => ipcRenderer.send('audio-levels', levels),
  sendCaptureError: (message: string) => ipcRenderer.send('audio-capture-error', message),

  // ── Window controls ──────────────────────────────────────────────
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
} satisfies ElectronAPI);
