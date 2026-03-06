import { create } from "zustand";

export interface TranscriptLine {
  id: string;
  speaker: string;
  speakerIndex: number;
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface AudioLevels {
  mic: number;
  system: number;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type AudioSource = "browser" | "electron" | null;

interface MeetingState {
  isRecording: boolean;
  currentMeetingId: string | null;
  duration: number;
  transcriptLines: TranscriptLine[];
  audioLevels: AudioLevels;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  audioSource: AudioSource;
  isMicMuted: boolean;
  hasSystemAudio: boolean;
  startRecording: (meetingId: string) => void;
  stopRecording: () => void;
  addTranscriptLine: (line: TranscriptLine) => void;
  updateTranscriptLine: (id: string, updates: Partial<TranscriptLine>) => void;
  updateAudioLevel: (levels: Partial<AudioLevels>) => void;
  incrementDuration: () => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
  setAudioSource: (source: AudioSource) => void;
  setMicMuted: (muted: boolean) => void;
  setHasSystemAudio: (has: boolean) => void;
  reset: () => void;
}

export const useMeetingStore = create<MeetingState>()((set) => ({
  isRecording: false,
  currentMeetingId: null,
  duration: 0,
  transcriptLines: [],
  audioLevels: { mic: 0, system: 0 },
  connectionStatus: "disconnected" as ConnectionStatus,
  connectionError: null,
  audioSource: null as AudioSource,
  isMicMuted: false,
  hasSystemAudio: false,

  startRecording: (meetingId: string) =>
    set({
      isRecording: true,
      currentMeetingId: meetingId,
      duration: 0,
      transcriptLines: [],
      audioLevels: { mic: 0, system: 0 },
      connectionStatus: "connecting" as ConnectionStatus,
      connectionError: null,
    }),

  stopRecording: () =>
    set({
      isRecording: false,
      connectionStatus: "disconnected" as ConnectionStatus,
      connectionError: null,
      audioSource: null,
      isMicMuted: false,
      hasSystemAudio: false,
    }),

  addTranscriptLine: (line: TranscriptLine) =>
    set((state) => ({
      transcriptLines: [...state.transcriptLines, line],
    })),

  updateTranscriptLine: (id: string, updates: Partial<TranscriptLine>) =>
    set((state) => ({
      transcriptLines: state.transcriptLines.map((line) =>
        line.id === id ? { ...line, ...updates } : line
      ),
    })),

  updateAudioLevel: (levels: Partial<AudioLevels>) =>
    set((state) => ({
      audioLevels: { ...state.audioLevels, ...levels },
    })),

  incrementDuration: () =>
    set((state) => ({
      duration: state.duration + 1,
    })),

  setConnectionStatus: (status: ConnectionStatus, error?: string | null) =>
    set({
      connectionStatus: status,
      connectionError: error ?? null,
    }),

  setAudioSource: (source: AudioSource) =>
    set({ audioSource: source }),

  setMicMuted: (muted: boolean) =>
    set({ isMicMuted: muted }),

  setHasSystemAudio: (has: boolean) =>
    set({ hasSystemAudio: has }),

  reset: () =>
    set({
      isRecording: false,
      currentMeetingId: null,
      duration: 0,
      transcriptLines: [],
      audioLevels: { mic: 0, system: 0 },
      connectionStatus: "disconnected" as ConnectionStatus,
      connectionError: null,
      audioSource: null,
      isMicMuted: false,
      hasSystemAudio: false,
    }),
}));
