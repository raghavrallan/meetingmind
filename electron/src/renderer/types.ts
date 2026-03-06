/** Type declarations for the electronAPI exposed via the preload script. */

export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence: number;
}

export interface AudioLevels {
  mic: number;
  system: number;
}

export interface RecordingStatus {
  isRecording: boolean;
  meetingId: string | null;
  meetingTitle: string | null;
  startedAt: number | null;
}

export interface AudioCaptureConfig {
  micDeviceId: string | null;
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
}

export interface ElectronAPI {
  startRecording: (args: {
    meetingId: string;
    meetingTitle?: string;
    apiUrl?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  stopRecording: () => Promise<{ success: boolean; error?: string; duration?: number }>;
  getDevices: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<{
    isRecording: boolean;
    meetingId: string | null;
    meetingTitle: string | null;
    startedAt: number | null;
    connectionState: string;
  }>;
  selectMeeting: (args: { meetingId: string; meetingTitle?: string }) => Promise<{ success: boolean }>;
  selectMicrophone: (deviceId: string) => Promise<{ success: boolean }>;
  getDesktopSources: () => Promise<{ id: string; name: string }[]>;
  apiFetch: (args: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ ok: boolean; status: number; body: string }>;

  onTranscript: (callback: (segment: TranscriptSegment) => void) => () => void;
  onAudioLevel: (callback: (levels: AudioLevels) => void) => () => void;
  onStatusChange: (callback: (status: RecordingStatus) => void) => () => void;
  onConnectionState: (callback: (state: { from: string; to: string }) => void) => () => void;
  onTrayAction: (callback: (action: string) => void) => () => void;
  onAudioCaptureStart: (callback: (config: AudioCaptureConfig) => void) => () => void;
  onAudioCaptureStop: (callback: () => void) => () => void;
  onCaptureError: (callback: (message: string) => void) => () => void;
  onStreamError: (callback: (message: string) => void) => () => void;

  sendAudioChunk: (data: ArrayBuffer) => void;
  sendAudioLevels: (levels: AudioLevels) => void;
  sendCaptureError: (message: string) => void;

  minimizeWindow: () => void;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
