"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseAudioCaptureOptions {
  onAudioChunk: (chunk: ArrayBuffer) => void;
  onLevels?: (levels: { mic: number; system: number }) => void;
}

interface UseAudioCaptureReturn {
  startCapture: () => Promise<void>;
  stopCapture: () => void;
  isCapturing: boolean;
  hasSystemAudio: boolean;
  muteMic: (muted: boolean) => void;
}

export function useAudioCapture(
  options: UseAudioCaptureOptions
): UseAudioCaptureReturn {
  const { onAudioChunk, onLevels } = options;

  const [isCapturing, setIsCapturing] = useState(false);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const systemStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const systemSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Keep stable references to callbacks
  const onAudioChunkRef = useRef(onAudioChunk);
  const onLevelsRef = useRef(onLevels);
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
    onLevelsRef.current = onLevels;
  }, [onAudioChunk, onLevels]);

  const stopCapture = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    if (systemSourceRef.current) {
      systemSourceRef.current.disconnect();
      systemSourceRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (systemStreamRef.current) {
      systemStreamRef.current.getTracks().forEach((t) => t.stop());
      systemStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsCapturing(false);
    setHasSystemAudio(false);
  }, []);

  const startCapture = useCallback(async () => {
    try {
      // 1. Get microphone stream
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;

      // 2. Try to get system audio via getDisplayMedia
      let systemStream: MediaStream | null = null;
      let gotSystemAudio = false;
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        // Stop video track immediately — we only need audio
        displayStream.getVideoTracks().forEach((t) => t.stop());

        if (displayStream.getAudioTracks().length > 0) {
          systemStream = displayStream;
          gotSystemAudio = true;
        } else {
          // User shared screen but without audio
          displayStream.getTracks().forEach((t) => t.stop());
        }
      } catch {
        // User declined screen share — fall back to mic-only
      }

      systemStreamRef.current = systemStream;
      setHasSystemAudio(gotSystemAudio);

      // 3. Create AudioContext at 16kHz
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // 4. Register AudioWorklet processor
      await audioContext.audioWorklet.addModule("/audio-processor.js");

      // 5. Create worklet node with 2 inputs
      const workletNode = new AudioWorkletNode(
        audioContext,
        "dual-channel-processor",
        {
          numberOfInputs: 2,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: "explicit",
        }
      );
      workletNodeRef.current = workletNode;

      // 6. Listen for PCM chunks from the worklet
      workletNode.port.onmessage = (event: MessageEvent) => {
        const { type, buffer, levels } = event.data;
        if (type === "pcm") {
          onAudioChunkRef.current(buffer);
          if (onLevelsRef.current) {
            onLevelsRef.current(levels);
          }
        }
      };

      // 7. Connect sources → worklet inputs
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;
      micSource.connect(workletNode, 0, 0);

      if (systemStream) {
        const systemSource =
          audioContext.createMediaStreamSource(systemStream);
        systemSourceRef.current = systemSource;
        systemSource.connect(workletNode, 0, 1);
      }

      setIsCapturing(true);
    } catch (err) {
      // Clean up on failure
      stopCapture();
      throw err;
    }
  }, [stopCapture]);

  const muteMic = useCallback((muted: boolean) => {
    const stream = micStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, [stopCapture]);

  return { startCapture, stopCapture, isCapturing, hasSystemAudio, muteMic };
}
