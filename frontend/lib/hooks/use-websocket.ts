"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeetingStore, type TranscriptLine } from "@/lib/stores/meeting";
import { api } from "@/lib/api";

interface UseWebSocketOptions {
  meetingId: string | null;
  role: "recorder" | "viewer";
  language?: string;
  channels?: number;
  keyterms?: string[];
  userName?: string;
  enabled?: boolean;
}

interface UseWebSocketReturn {
  isConnected: boolean;
  connectionStatus: string;
  sendAudio: (chunk: ArrayBuffer) => void;
  sendStop: () => void;
  disconnect: () => void;
}

export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  const { meetingId, role, language = "multi", channels = 1, keyterms = [], userName = "", enabled = true } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionStatus = useMeetingStore((s) => s.connectionStatus);

  useEffect(() => {
    if (!enabled || !meetingId) return;

    const store = useMeetingStore.getState();
    store.setConnectionStatus("connecting");

    const url = api.meetings.wsUrl(meetingId);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(JSON.stringify({ role, language, channels, keyterms, userName }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;

      try {
        const message = JSON.parse(event.data);

        if (message.type === "status") {
          const status = message.data?.status;
          if (status === "recording" || status === "waiting") {
            useMeetingStore.getState().setConnectionStatus("connected");
          } else if (status === "recording_stopped") {
            useMeetingStore.getState().setConnectionStatus("disconnected");
          }
          return;
        }

        if (message.type === "transcription") {
          handleTranscription(message.data);
          return;
        }

        if (message.type === "pong") {
          return;
        }
      } catch {
        // Ignore non-JSON messages
      }
    };

    ws.onerror = () => {
      useMeetingStore.getState().setConnectionStatus("error", "WebSocket connection error");
    };

    ws.onclose = () => {
      useMeetingStore.getState().setConnectionStatus("disconnected");
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };

    // Viewer keepalive ping every 30s
    if (role === "viewer") {
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    }

    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [enabled, meetingId, role, channels]);

  const sendAudio = useCallback((chunk: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  }, []);

  const sendStop = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" }));
    }
  }, []);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    }
  }, []);

  const isConnected = connectionStatus === "connected";

  return { isConnected, connectionStatus, sendAudio, sendStop, disconnect };
}

/**
 * Parse a Deepgram transcription response and update the Zustand store.
 *
 * Deepgram multichannel responses have:
 *   channel_index, channel.alternatives[0].transcript,
 *   is_final, start, duration, words[].speaker
 */
// Speaker name cache: speaker index -> display name
const _speakerNames = new Map<number, string>();
let _primaryUserName = "";

export function setRecorderUserName(name: string) {
  _primaryUserName = name;
}

function getSpeakerName(speakerIndex: number): string {
  if (_speakerNames.has(speakerIndex)) return _speakerNames.get(speakerIndex)!;

  let name: string;
  if (speakerIndex === 0 && _primaryUserName) {
    name = _primaryUserName;
  } else {
    name = `Speaker ${speakerIndex + 1}`;
  }

  _speakerNames.set(speakerIndex, name);
  return name;
}

function handleTranscription(data: Record<string, unknown>) {
  const store = useMeetingStore.getState();

  const channel = data.channel as
    | { alternatives?: { transcript?: string; words?: { speaker?: number; word?: string }[] }[] }
    | undefined;
  const isFinal = Boolean(data.is_final);
  const start = (data.start as number) ?? 0;

  if (!channel?.alternatives?.[0]) return;

  const alt = channel.alternatives[0];
  const transcript = alt.transcript?.trim();
  if (!transcript) return;

  // Use diarization speaker from final results; for interim, use last known speaker or 0
  const speakerIndex = alt.words?.[0]?.speaker ?? 0;
  const speaker = getSpeakerName(speakerIndex);

  const lineId = `s${speakerIndex}-${start.toFixed(2)}`;

  const line: TranscriptLine = {
    id: lineId,
    speaker,
    speakerIndex,
    text: transcript,
    timestamp: Math.floor(start),
    isFinal,
  };

  const existing = store.transcriptLines.find((l) => l.id === lineId);
  if (existing) {
    store.updateTranscriptLine(lineId, { text: transcript, isFinal, speaker });
  } else {
    store.addTranscriptLine(line);
  }
}
