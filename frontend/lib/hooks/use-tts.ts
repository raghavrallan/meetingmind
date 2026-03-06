"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface UseTTSReturn {
  speak: (text: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setVoice: (voice: SpeechSynthesisVoice) => void;
  rate: number;
  setRate: (rate: number) => void;
  progress: number;
  isSupported: boolean;
}

/**
 * Split text into sentence-sized chunks to avoid Chrome's ~15s speech cutoff.
 */
function splitIntoChunks(text: string): string[] {
  // Split on sentence boundaries (period, exclamation, question mark followed by space)
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  // Group short sentences together to avoid too many utterances
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current.length + sentence.length > 200 && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

export function useTTS(): UseTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] =
    useState<SpeechSynthesisVoice | null>(null);
  const [rate, setRate] = useState(1);
  const [progress, setProgress] = useState(0);
  const [isSupported, setIsSupported] = useState(false);

  const chunksRef = useRef<string[]>([]);
  const currentChunkRef = useRef(0);
  const totalChunksRef = useRef(0);

  // Check support and load voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setIsSupported(false);
      return;
    }
    setIsSupported(true);

    const loadVoices = () => {
      const available = speechSynthesis.getVoices();
      setVoices(available);
      // Default to first English voice
      if (!selectedVoice && available.length > 0) {
        const english = available.find((v) => v.lang.startsWith("en"));
        setSelectedVoice(english || available[0]);
      }
    };

    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speakChunk = useCallback(
    (index: number) => {
      if (index >= chunksRef.current.length) {
        setIsSpeaking(false);
        setIsPaused(false);
        setProgress(100);
        return;
      }

      currentChunkRef.current = index;
      setProgress(
        Math.round((index / totalChunksRef.current) * 100)
      );

      const utterance = new SpeechSynthesisUtterance(chunksRef.current[index]);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = rate;

      utterance.onend = () => {
        speakChunk(index + 1);
      };

      utterance.onerror = (event) => {
        if (event.error !== "canceled") {
          // Try next chunk on non-cancel errors
          speakChunk(index + 1);
        }
      };

      speechSynthesis.speak(utterance);
    },
    [selectedVoice, rate]
  );

  const speak = useCallback(
    (text: string) => {
      if (!isSupported) return;
      // Cancel any ongoing speech
      speechSynthesis.cancel();

      const chunks = splitIntoChunks(text);
      chunksRef.current = chunks;
      totalChunksRef.current = chunks.length;
      currentChunkRef.current = 0;
      setProgress(0);
      setIsSpeaking(true);
      setIsPaused(false);

      speakChunk(0);
    },
    [isSupported, speakChunk]
  );

  const stop = useCallback(() => {
    if (!isSupported) return;
    speechSynthesis.cancel();
    chunksRef.current = [];
    setIsSpeaking(false);
    setIsPaused(false);
    setProgress(0);
  }, [isSupported]);

  const pause = useCallback(() => {
    if (!isSupported) return;
    speechSynthesis.pause();
    setIsPaused(true);
  }, [isSupported]);

  const resume = useCallback(() => {
    if (!isSupported) return;
    speechSynthesis.resume();
    setIsPaused(false);
  }, [isSupported]);

  const setVoice = useCallback((voice: SpeechSynthesisVoice) => {
    setSelectedVoice(voice);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    isPaused,
    voices,
    selectedVoice,
    setVoice,
    rate,
    setRate,
    progress,
    isSupported,
  };
}
