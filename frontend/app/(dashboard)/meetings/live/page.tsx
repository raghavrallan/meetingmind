"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Mic,
  MicOff,
  Square,
  Clock,
  Wifi,
  WifiOff,
  Monitor,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const LANGUAGES = [
  { value: "multi", label: "Auto-detect (Multilingual)", desc: "Hindi, English, Punjabi & more" },
  { value: "hi", label: "Hindi", desc: "हिन्दी" },
  { value: "en-IN", label: "English (India)", desc: "Indian accent optimized" },
  { value: "en", label: "English (US/UK)", desc: "General English" },
  { value: "pa", label: "Punjabi", desc: "ਪੰਜਾਬੀ" },
  { value: "es", label: "Spanish", desc: "Español" },
  { value: "fr", label: "French", desc: "Français" },
  { value: "de", label: "German", desc: "Deutsch" },
  { value: "ja", label: "Japanese", desc: "日本語" },
  { value: "zh", label: "Chinese", desc: "中文" },
  { value: "ko", label: "Korean", desc: "한국어" },
  { value: "pt", label: "Portuguese", desc: "Português" },
  { value: "ar", label: "Arabic", desc: "العربية" },
] as const;
import { cn, formatDuration, speakerColor } from "@/lib/utils";
import { useMeetingStore } from "@/lib/stores/meeting";
import { useAuth } from "@/lib/hooks/use-auth";
import { useWebSocket, setRecorderUserName } from "@/lib/hooks/use-websocket";
import { useAudioCapture } from "@/lib/hooks/use-audio-capture";
import { api } from "@/lib/api";

function Waveform({ micLevel, systemLevel }: { micLevel: number; systemLevel: number }) {
  const bars = 40;
  // Generate bar heights based on actual audio levels with some randomness
  const avgLevel = Math.max(micLevel, systemLevel);
  return (
    <div className="flex h-16 items-end justify-center gap-[2px]">
      {Array.from({ length: bars }).map((_, i) => {
        // Create a wave pattern centered around the middle
        const distance = Math.abs(i - bars / 2) / (bars / 2);
        const base = avgLevel > 0.01 ? (1 - distance * 0.6) * avgLevel * 100 : 5;
        const height = Math.max(5, Math.min(100, base + (Math.random() * 15 - 7.5)));
        return (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full transition-all duration-75",
              avgLevel > 0.01 ? "bg-primary/60" : "bg-muted-foreground/20"
            )}
            style={{ height: `${height}%` }}
          />
        );
      })}
    </div>
  );
}

export default function LiveMeetingPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const {
    isRecording,
    duration,
    transcriptLines,
    audioLevels,
    connectionStatus,
    isMicMuted,
    hasSystemAudio,
    startRecording,
    stopRecording,
    updateAudioLevel,
    setMicMuted,
    setHasSystemAudio,
    setAudioSource,
    incrementDuration,
    reset,
  } = useMeetingStore();

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState("multi");
  const [keytermsInput, setKeytermsInput] = useState("");
  const meetingIdRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const currentMeetingId = useMeetingStore((s) => s.currentMeetingId);
  const userName = user?.name || "";
  const keyterms = keytermsInput.split(",").map((t) => t.trim()).filter(Boolean);

  const { sendAudio, sendStop, disconnect, isConnected } = useWebSocket({
    meetingId: currentMeetingId,
    role: "recorder",
    language: selectedLanguage,
    channels: 1,
    keyterms,
    userName,
    enabled: isRecording,
  });

  const { startCapture, stopCapture, isCapturing, hasSystemAudio: captureHasSystem, muteMic } =
    useAudioCapture({
      onAudioChunk: sendAudio,
      onLevels: (levels) => updateAudioLevel(levels),
    });

  // Scroll to bottom of transcript on new lines
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcriptLines]);

  // Duration timer
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      incrementDuration();
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording, incrementDuration]);

  // Sync system audio state from capture hook
  useEffect(() => {
    setHasSystemAudio(captureHasSystem);
  }, [captureHasSystem, setHasSystemAudio]);

  // Start audio capture once WebSocket is connected
  const hasStartedCaptureRef = useRef(false);
  useEffect(() => {
    if (isConnected && isRecording && !hasStartedCaptureRef.current) {
      hasStartedCaptureRef.current = true;
      startCapture().catch((err) => {
        setError(`Audio capture failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    if (!isRecording) {
      hasStartedCaptureRef.current = false;
    }
  }, [isConnected, isRecording, startCapture]);

  const handleStart = useCallback(async () => {
    if (!isAuthenticated || isStarting) return;
    setIsStarting(true);
    setError(null);

    try {
      // 1. Create meeting with selected language
      const now = new Date();
      const title = `Meeting ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
      const meeting = await api.meetings.create({
        title,
        language: selectedLanguage,
      });
      meetingIdRef.current = meeting.id;

      // 2. Start meeting on backend (sets status RECORDING)
      await api.meetings.start(meeting.id);

      // 3. Start recording in Zustand (triggers WebSocket connect)
      // Set user name for speaker labeling before WebSocket connects
      setRecorderUserName(userName);

      // Audio capture starts automatically once WebSocket is connected (see effect above)
      startRecording(meeting.id);
      setAudioSource("browser");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start recording");
      reset();
    } finally {
      setIsStarting(false);
    }
  }, [isAuthenticated, isStarting, selectedLanguage, startRecording, setAudioSource, reset]);

  const handleStop = useCallback(async () => {
    if (isStopping) return;
    setIsStopping(true);

    try {
      // 1. Stop audio capture
      stopCapture();

      // 2. Signal WebSocket to stop
      sendStop();

      // 3. Close WebSocket
      disconnect();

      // 4. Stop meeting on backend (sets PROCESSING, enqueues Celery)
      const meetingId = meetingIdRef.current;
      if (meetingId) {
        await api.meetings.stop(meetingId);
      }

      // 5. Update Zustand
      stopRecording();

      // 6. Navigate to meeting detail
      if (meetingId) {
        router.push(`/meetings/${meetingId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop recording");
    } finally {
      setIsStopping(false);
    }
  }, [isStopping, stopCapture, sendStop, disconnect, stopRecording, router]);

  const handleMuteToggle = useCallback(() => {
    const newMuted = !isMicMuted;
    setMicMuted(newMuted);
    muteMic(newMuted);
  }, [isMicMuted, setMicMuted, muteMic]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/meetings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Live Meeting</h1>
          <p className="text-sm text-muted-foreground">
            Real-time transcription and recording
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isRecording && (
            <>
              {/* Connection status badge */}
              {isConnected ? (
                <Badge variant="outline" className="gap-1 border-green-500/30 text-green-500">
                  <Wifi className="h-3 w-3" />
                  Live
                </Badge>
              ) : connectionStatus === "connecting" ? (
                <Badge variant="outline" className="gap-1 border-yellow-500/30 text-yellow-500">
                  <Wifi className="h-3 w-3 animate-pulse" />
                  Connecting
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-red-500/30 text-red-500">
                  <WifiOff className="h-3 w-3" />
                  Disconnected
                </Badge>
              )}

              {/* System audio indicator */}
              {hasSystemAudio && (
                <Badge variant="outline" className="gap-1 border-blue-500/30 text-blue-500">
                  <Monitor className="h-3 w-3" />
                  System Audio
                </Badge>
              )}

              {/* Pulsing red dot */}
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-sm font-medium text-red-500">
                  Recording
                </span>
              </div>
            </>
          )}
          {/* Duration timer */}
          <div className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm tabular-nums">
              {formatDuration(duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Language selector (before recording starts) */}
      {!isRecording && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Transcription Language</p>
                <p className="text-xs text-muted-foreground">
                  Select the language spoken in this meeting. Auto-detect works for Hindi, Hinglish, English, Punjabi, and more.
                </p>
              </div>
              <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      <div className="flex items-center gap-2">
                        <span>{lang.label}</span>
                        <span className="text-xs text-muted-foreground">{lang.desc}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key names/terms input (before recording) */}
      {!isRecording && (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Key Names & Terms (optional)</p>
              <p className="text-xs text-muted-foreground">
                Add participant names, project terms, or jargon to improve transcription accuracy. Separate with commas.
              </p>
              <Input
                placeholder="e.g. Raghav Rallan, MeetingMind, Sprint Review..."
                value={keytermsInput}
                onChange={(e) => setKeytermsInput(e.target.value)}
              />
              {keyterms.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {keyterms.map((term, i) => (
                    <span key={i} className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {term}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active language indicator during recording */}
      {isRecording && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Globe className="h-3.5 w-3.5" />
          <span>
            {LANGUAGES.find((l) => l.value === selectedLanguage)?.label || "Auto-detect"}
            {selectedLanguage === "multi" && " — Hindi, English, Punjabi & more"}
          </span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Waveform Visualization */}
      {isRecording && (
        <Card>
          <CardContent className="p-4">
            <Waveform micLevel={audioLevels.mic} systemLevel={audioLevels.system} />
          </CardContent>
        </Card>
      )}

      {/* Transcript Display */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="min-h-[400px] max-h-[calc(100vh-500px)] overflow-y-auto space-y-4 pr-2">
            {transcriptLines.length === 0 && !isRecording && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <Mic className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-medium">Ready to record</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Click the Start Recording button to begin capturing your meeting.
                </p>
              </div>
            )}

            {transcriptLines.length === 0 && isRecording && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Mic className="h-8 w-8 text-primary animate-pulse" />
                </div>
                <h3 className="mt-4 text-lg font-medium">Listening...</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Waiting for speech to be detected.
                </p>
              </div>
            )}

            {transcriptLines.map((line) => (
              <div
                key={line.id}
                className={cn(
                  "flex gap-3 rounded-lg p-2",
                  !line.isFinal && "opacity-60"
                )}
              >
                <div className="shrink-0 pt-0.5">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDuration(line.timestamp)}
                  </span>
                </div>
                <div className="flex-1">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      speakerColor(line.speakerIndex)
                    )}
                  >
                    {line.speaker}
                  </span>
                  <p
                    className={cn(
                      "mt-0.5 text-sm leading-relaxed",
                      line.isFinal
                        ? "text-foreground"
                        : "text-muted-foreground italic"
                    )}
                  >
                    {line.text}
                  </p>
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card className="sticky bottom-0">
        <CardContent className="flex items-center justify-center gap-4 p-4">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full"
            onClick={handleMuteToggle}
            disabled={!isRecording}
          >
            {isMicMuted ? (
              <MicOff className="h-5 w-5 text-red-500" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </Button>

          {!isRecording ? (
            <Button
              size="lg"
              className="h-14 gap-2 rounded-full px-8 text-base"
              onClick={handleStart}
              disabled={isStarting}
            >
              <Mic className="h-5 w-5" />
              {isStarting ? "Starting..." : "Start Recording"}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="lg"
              className="h-14 gap-2 rounded-full px-8 text-base"
              onClick={handleStop}
              disabled={isStopping}
            >
              <Square className="h-5 w-5" />
              {isStopping ? "Stopping..." : "Stop Recording"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
