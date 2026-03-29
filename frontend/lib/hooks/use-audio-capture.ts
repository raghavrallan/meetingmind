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
  muteMic: (muted: boolean) => void;
}

export function useAudioCapture(
  options: UseAudioCaptureOptions
): UseAudioCaptureReturn {
  const { onAudioChunk, onLevels } = options;

  const [isCapturing, setIsCapturing] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

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
    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (micSourceRef.current) {
      micSourceRef.current.disconnect();
      micSourceRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  const startCapture = useCallback(async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;

      // Use AudioWorklet if available, ScriptProcessor as fallback
      try {
        await audioContext.audioWorklet.addModule("/audio-processor-mono.js");
        const workletNode = new AudioWorkletNode(audioContext, "mono-pcm-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: "explicit",
        });
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event: MessageEvent) => {
          const { type, buffer, level } = event.data;
          if (type === "pcm") {
            onAudioChunkRef.current(buffer);
            if (onLevelsRef.current) onLevelsRef.current({ mic: level, system: 0 });
          }
        };

        micSource.connect(workletNode);
      } catch {
        // Fallback to ScriptProcessorNode
        const bufferSize = 4096;
        const scriptNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
        scriptNodeRef.current = scriptNode;

        scriptNode.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          let rms = 0;
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            rms += s * s;
          }
          rms = Math.sqrt(rms / input.length);
          onAudioChunkRef.current(pcm.buffer);
          if (onLevelsRef.current) onLevelsRef.current({ mic: rms, system: 0 });
        };

        micSource.connect(scriptNode);
        scriptNode.connect(audioContext.destination);
      }

      setIsCapturing(true);
    } catch (err) {
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

  useEffect(() => {
    return () => { stopCapture(); };
  }, [stopCapture]);

  return { startCapture, stopCapture, isCapturing, muteMic };
}
