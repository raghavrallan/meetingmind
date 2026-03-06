"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeetingStore, type TranscriptLine } from "@/lib/stores/meeting";
import { api } from "@/lib/api";

interface UseWebSocketOptions {
  meetingId: string | null;
  token: string | null;
  role: "recorder" | "viewer";
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
  const { meetingId, token, role, enabled = true } = options;
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionStatus = useMeetingStore((s) => s.connectionStatus);

  useEffect(() => {
    if (!enabled || !meetingId || !token) return;

    const store = useMeetingStore.getState();
    store.setConnectionStatus("connecting");

    const url = api.meetings.wsUrl(meetingId, token);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      // Send role assignment as first message
      ws.send(JSON.stringify({ role }));
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
  }, [enabled, meetingId, token, role]);

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
function handleTranscription(data: Record<string, unknown>) {
  const store = useMeetingStore.getState();

  // Deepgram streaming responses have a `channel` field
  const channel = data.channel as
    | { alternatives?: { transcript?: string; words?: { speaker?: number; word?: string }[] }[] }
    | undefined;
  const channelIndex = (data.channel_index as number[] | undefined)?.[0] ?? 0;
  const isFinal = Boolean(data.is_final);
  const start = (data.start as number) ?? 0;

  if (!channel?.alternatives?.[0]) return;

  const alt = channel.alternatives[0];
  const transcript = alt.transcript?.trim();
  if (!transcript) return;

  // Determine speaker from first word's speaker field, or fall back to channel
  const speakerIndex = alt.words?.[0]?.speaker ?? channelIndex;
  const speakerLabel = channelIndex === 0 ? "Mic" : "System";
  const speaker = `Speaker ${speakerIndex + 1} (${speakerLabel})`;

  // Stable line ID from channel + start time for interim→final upserts
  const lineId = `ch${channelIndex}-${start.toFixed(2)}`;

  const line: TranscriptLine = {
    id: lineId,
    speaker,
    speakerIndex,
    text: transcript,
    timestamp: Math.floor(start),
    isFinal,
  };

  // Check if this line already exists (interim update)
  const existing = store.transcriptLines.find((l) => l.id === lineId);
  if (existing) {
    store.updateTranscriptLine(lineId, { text: transcript, isFinal });
  } else {
    store.addTranscriptLine(line);
  }
}
