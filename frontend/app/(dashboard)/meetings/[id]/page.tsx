"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Copy,
  Download,
  Check,
  ChevronDown,
  Clock,
  Users,
  Loader2,
  Volume2,
  Square,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { speakerColor, formatDuration } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { useWebSocket } from "@/lib/hooks/use-websocket";
import { useTTS } from "@/lib/hooks/use-tts";
import { useMeetingStore } from "@/lib/stores/meeting";
import {
  api,
  getMeetingDate,
  getMeetingDuration,
  getParticipantName,
  type Meeting,
  type TranscriptUtterance,
  type MeetingNotes,
} from "@/lib/api";

export default function MeetingDetailPage() {
  const params = useParams();
  const meetingId = params.id as string;
  const { loading: authLoading } = useAuth();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcript, setTranscript] = useState<TranscriptUtterance[]>([]);
  const [notes, setNotes] = useState<MeetingNotes | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeNotesTab, setActiveNotesTab] = useState("summary");

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [actionItems, setActionItems] = useState<MeetingNotes["action_items"]>(
    []
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Live viewer mode
  const isLive = meeting?.status === "recording";
  const liveTranscriptLines = useMeetingStore((s) => s.transcriptLines);
  const { isConnected } = useWebSocket({
    meetingId: isLive ? meetingId : null,
    role: "viewer",
    enabled: isLive === true,
  });
  const liveTranscriptEndRef = useRef<HTMLDivElement>(null);

  // TTS
  const tts = useTTS();

  useEffect(() => {
    if (authLoading || !meetingId) return;

    async function fetchData() {
      try {
        const m = await api.meetings.get(meetingId);
        setMeeting(m);

        // Try transcript (may 404)
        try {
          const t = await api.meetings.transcript(meetingId);
          setTranscript(t);
        } catch {
          // No transcript available
        }

        // Try notes (may 404)
        try {
          const n = await api.meetings.notes(meetingId);
          setNotes(n);
          setActionItems(n.action_items || []);
        } catch {
          // No notes available
        }
      } catch (err) {
        console.error("Failed to fetch meeting:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, meetingId]);

  // Set up audio element for playback
  useEffect(() => {
    if (!meeting || !meeting.audio_storage_key || isLive) return;

    const audio = new Audio(api.meetings.audioUrl(meetingId));
    audio.preload = "metadata";
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => {
      setAudioDuration(audio.duration || getMeetingDuration(meeting));
    });
    audio.addEventListener("timeupdate", () => {
      setCurrentTime(audio.currentTime);
    });
    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });
    audio.addEventListener("error", () => {
      // Audio not available; fall back to meeting duration for the UI
      setAudioDuration(getMeetingDuration(meeting));
    });

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, [meeting, meetingId, isLive]);

  // Sync playback speed
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Scroll live transcript to bottom
  useEffect(() => {
    liveTranscriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveTranscriptLines]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/meetings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <p className="text-muted-foreground">Meeting not found.</p>
      </div>
    );
  }

  const handleCopyNotes = () => {
    if (notes?.full_notes) {
      navigator.clipboard.writeText(notes.full_notes);
      setCopiedNotes(true);
      setTimeout(() => setCopiedNotes(false), 2000);
    }
  };

  const toggleActionItem = (id: string) => {
    setActionItems((items) =>
      items.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const getActiveNotesText = (): string => {
    if (!notes) return "";
    switch (activeNotesTab) {
      case "summary":
        return notes.summary;
      case "decisions":
        return notes.decisions.join(". ");
      case "actions":
        return actionItems.map((item) => item.text).join(". ");
      case "full":
        return notes.full_notes;
      default:
        return notes.summary;
    }
  };

  const handleReadAloud = () => {
    const text = getActiveNotesText();
    if (text) {
      tts.speak(text);
    }
  };

  const meetingDuration = getMeetingDuration(meeting);
  const meetingDate = getMeetingDate(meeting);
  const participants = meeting.participants || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/meetings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{meeting.title}</h1>
            {isLive ? (
              <Badge className="gap-1 bg-red-500/10 text-red-500 border-red-500/20">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                Live
              </Badge>
            ) : (
              <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                {meeting.status}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {format(new Date(meetingDate), "MMM d, yyyy 'at' h:mm a")} -{" "}
              {formatDuration(meetingDuration)}
            </span>
            {participants.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                {participants.map((p) => getParticipantName(p)).join(", ")}
              </span>
            )}
            {isLive && isConnected && (
              <span className="flex items-center gap-1 text-green-500">
                <Wifi className="h-4 w-4" />
                Connected
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Transcript Panel (60%) */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-lg">Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            {isLive ? (
              /* Live transcript from Zustand store */
              <div className="max-h-[calc(100vh-400px)] space-y-4 overflow-y-auto pr-2">
                {liveTranscriptLines.length > 0 ? (
                  liveTranscriptLines.map((line) => (
                    <div
                      key={line.id}
                      className={cn(
                        "flex gap-3 rounded-lg p-2",
                        !line.isFinal && "opacity-60"
                      )}
                    >
                      <div className="shrink-0 pt-0.5">
                        <span className="text-xs text-muted-foreground">
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
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="mt-4 text-sm text-muted-foreground">
                      Waiting for live transcription...
                    </p>
                  </div>
                )}
                <div ref={liveTranscriptEndRef} />
              </div>
            ) : transcript.length > 0 ? (
              /* Saved transcript */
              <div className="max-h-[calc(100vh-400px)] space-y-4 overflow-y-auto pr-2">
                {transcript.map((utterance) => (
                  <div
                    key={utterance.id}
                    className="group flex gap-3 rounded-lg p-2 transition-colors hover:bg-accent/50"
                  >
                    <div className="shrink-0 pt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(utterance.start_time)}
                      </span>
                    </div>
                    <div className="flex-1">
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          speakerColor(utterance.speaker_index)
                        )}
                      >
                        {utterance.speaker}
                      </span>
                      <p className="mt-0.5 text-sm leading-relaxed">
                        {utterance.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No transcript available for this meeting.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Notes Panel (40%) */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-lg">Notes</CardTitle>
            {notes && (
              <div className="flex items-center gap-2">
                {/* TTS Read Aloud button */}
                {tts.isSupported && (
                  tts.isSpeaking ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => tts.stop()}
                    >
                      <Square className="mr-1 h-4 w-4" /> Stop
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleReadAloud}
                    >
                      <Volume2 className="mr-1 h-4 w-4" /> Read Aloud
                    </Button>
                  )
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyNotes}
                >
                  {copiedNotes ? (
                    <>
                      <Check className="mr-1 h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1 h-4 w-4" /> Copy
                    </>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Download className="mr-1 h-4 w-4" />
                      Export
                      <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => {
                      if (!notes) return;
                      const md = notes.full_notes;
                      const blob = new Blob([md], { type: "text/markdown" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${meeting.title.replace(/[^a-zA-Z0-9]/g, "_")}_notes.md`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}>Export as Markdown</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (!notes) return;
                      const printWindow = window.open("", "_blank");
                      if (!printWindow) return;
                      printWindow.document.write(`
                        <html><head><title>${meeting.title} - Notes</title>
                        <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}h1{font-size:1.5em}h2{font-size:1.2em;margin-top:1.5em}ul{padding-left:1.5em}</style>
                        </head><body>${notes.full_notes.replace(/^# (.+)$/gm, '<h1>$1</h1>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^- (.+)$/gm, '<li>$1</li>').replace(/\n/g, '<br>')}</body></html>
                      `);
                      printWindow.document.close();
                      printWindow.print();
                    }}>Export as PDF</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (!notes) return;
                      const content = `<html><body>${notes.full_notes.replace(/\n/g, "<br>")}</body></html>`;
                      const blob = new Blob([content], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${meeting.title.replace(/[^a-zA-Z0-9]/g, "_")}_notes.docx`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}>Export as DOCX</DropdownMenuItem>
                    <DropdownMenuItem onClick={handleCopyNotes}>Copy to Clipboard</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {/* TTS controls bar when speaking */}
            {tts.isSpeaking && (
              <div className="mb-4 flex items-center gap-3 rounded-lg bg-muted p-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => (tts.isPaused ? tts.resume() : tts.pause())}
                >
                  {tts.isPaused ? (
                    <Play className="h-4 w-4" />
                  ) : (
                    <Pause className="h-4 w-4" />
                  )}
                </Button>
                <div className="flex-1">
                  <div className="relative h-1.5 w-full rounded-full bg-muted-foreground/20">
                    <div
                      className="absolute h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${tts.progress}%` }}
                    />
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs">
                      {tts.rate}x
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                      <DropdownMenuItem
                        key={speed}
                        onClick={() => tts.setRate(speed)}
                      >
                        {speed}x
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => tts.stop()}
                >
                  <Square className="h-3 w-3" />
                </Button>
              </div>
            )}

            {notes ? (
              <Tabs
                defaultValue="summary"
                value={activeNotesTab}
                onValueChange={setActiveNotesTab}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="summary" className="flex-1">
                    Summary
                  </TabsTrigger>
                  <TabsTrigger value="decisions" className="flex-1">
                    Decisions
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="flex-1">
                    Actions
                  </TabsTrigger>
                  <TabsTrigger value="full" className="flex-1">
                    Full
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="summary"
                  className="max-h-[calc(100vh-500px)] overflow-y-auto"
                >
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {notes.summary}
                  </p>
                </TabsContent>

                <TabsContent
                  value="decisions"
                  className="max-h-[calc(100vh-500px)] overflow-y-auto"
                >
                  <ul className="space-y-2">
                    {notes.decisions.map((decision, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{decision}</span>
                      </li>
                    ))}
                  </ul>
                </TabsContent>

                <TabsContent
                  value="actions"
                  className="max-h-[calc(100vh-500px)] overflow-y-auto"
                >
                  <ul className="space-y-3">
                    {actionItems.map((item) => (
                      <li key={item.id} className="flex items-start gap-3">
                        <button
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                            item.completed
                              ? "border-green-500 bg-green-500 text-white"
                              : "border-[hsl(var(--border))]"
                          )}
                          onClick={() => toggleActionItem(item.id)}
                        >
                          {item.completed && <Check className="h-3 w-3" />}
                        </button>
                        <div className="flex-1">
                          <p
                            className={cn(
                              "text-sm",
                              item.completed &&
                                "text-muted-foreground line-through"
                            )}
                          >
                            {item.text}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                            {item.assignee && <span>{item.assignee}</span>}
                            {item.due_date && (
                              <>
                                <span>-</span>
                                <span>
                                  Due{" "}
                                  {format(new Date(item.due_date), "MMM d")}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </TabsContent>

                <TabsContent
                  value="full"
                  className="max-h-[calc(100vh-500px)] overflow-y-auto"
                >
                  <div className="prose prose-sm prose-invert max-w-none">
                    {notes.full_notes.split("\n").map((line, i) => {
                      if (line.startsWith("# ")) {
                        return (
                          <h1 key={i} className="text-lg font-bold mt-0 mb-2">
                            {line.replace("# ", "")}
                          </h1>
                        );
                      }
                      if (line.startsWith("## ")) {
                        return (
                          <h2
                            key={i}
                            className="text-base font-semibold mt-4 mb-1"
                          >
                            {line.replace("## ", "")}
                          </h2>
                        );
                      }
                      if (line.startsWith("- ")) {
                        return (
                          <p key={i} className="text-sm ml-4 my-0.5">
                            {line}
                          </p>
                        );
                      }
                      if (line.match(/^\d+\. /)) {
                        return (
                          <p key={i} className="text-sm ml-4 my-0.5">
                            {line}
                          </p>
                        );
                      }
                      if (line.trim() === "") {
                        return <div key={i} className="h-2" />;
                      }
                      return (
                        <p key={i} className="text-sm my-0.5">
                          {line}
                        </p>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {isLive
                  ? "Notes will be generated after the meeting ends."
                  : "No notes available for this meeting."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audio Player Bar — hide during live meetings */}
      {!isLive && (
        <Card className="sticky bottom-0">
          <CardContent className="flex items-center gap-4 p-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
                  }
                }}
              >
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button
                variant="default"
                size="icon"
                className="h-10 w-10 rounded-full"
                onClick={() => {
                  if (!audioRef.current) return;
                  if (isPlaying) {
                    audioRef.current.pause();
                    setIsPlaying(false);
                  } else {
                    audioRef.current.play().catch(() => {});
                    setIsPlaying(true);
                  }
                }}
                disabled={!meeting?.audio_storage_key}
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5 ml-0.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  if (audioRef.current) {
                    audioRef.current.currentTime = Math.min(
                      audioDuration || meetingDuration,
                      audioRef.current.currentTime + 10
                    );
                  }
                }}
              >
                <SkipForward className="h-4 w-4" />
              </Button>
            </div>

            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(Math.floor(currentTime))}
            </span>

            <div className="flex-1">
              <div className="relative h-2 w-full rounded-full bg-muted">
                <div
                  className="absolute h-full rounded-full bg-primary"
                  style={{
                    width: `${(audioDuration || meetingDuration) > 0 ? (currentTime / (audioDuration || meetingDuration)) * 100 : 0}%`,
                  }}
                />
                <input
                  type="range"
                  min={0}
                  max={audioDuration || meetingDuration}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setCurrentTime(t);
                    if (audioRef.current) audioRef.current.currentTime = t;
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </div>
            </div>

            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(Math.floor(audioDuration || meetingDuration))}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs">
                  {playbackSpeed}x
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                  <DropdownMenuItem
                    key={speed}
                    onClick={() => setPlaybackSpeed(speed)}
                  >
                    {speed}x
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
