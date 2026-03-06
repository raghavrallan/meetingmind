import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  Circle,
  Square,
  ChevronDown,
  Loader2,
  AlertCircle,
  Monitor,
  Volume2,
  FolderOpen,
} from 'lucide-react';
import type { TranscriptSegment, AudioLevels } from '../types';
import { Waveform } from './Waveform';

type AppState = 'idle' | 'recording' | 'processing';

interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
}

interface RecordingViewProps {
  appState: AppState;
  meetingId: string;
  meetingTitle: string;
  startedAt: number | null;
  audioLevels: AudioLevels;
  devices: AudioDevice[];
  selectedDevice: string;
  transcripts: TranscriptSegment[];
  error: string | null;
  projects: Project[];
  selectedProjectId: string;
  onProjectChange: (id: string) => void;
  onMeetingTitleChange: (title: string) => void;
  onDeviceChange: (deviceId: string) => void;
  onStart: () => void;
  onStop: () => void;
  onDismissError: () => void;
}

function formatDuration(startedAt: number | null): string {
  if (!startedAt) return '00:00:00';
  const elapsed = Date.now() - startedAt;
  const totalSec = Math.floor(elapsed / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const min = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const SPEAKER_BRIGHTNESS = [0.60, 0.45, 0.55, 0.40, 0.50, 0.42, 0.58, 0.48];
const speakerBrightnessMap = new Map<string, number>();
let nextBrightnessIdx = 0;
function getSpeakerBrightness(speaker: string): number {
  if (!speakerBrightnessMap.has(speaker)) {
    speakerBrightnessMap.set(speaker, SPEAKER_BRIGHTNESS[nextBrightnessIdx % SPEAKER_BRIGHTNESS.length]);
    nextBrightnessIdx++;
  }
  return speakerBrightnessMap.get(speaker)!;
}

export const RecordingView: React.FC<RecordingViewProps> = ({
  appState,
  meetingId,
  meetingTitle,
  startedAt,
  audioLevels,
  devices,
  selectedDevice,
  transcripts,
  error,
  projects,
  selectedProjectId,
  onProjectChange,
  onMeetingTitleChange,
  onDeviceChange,
  onStart,
  onStop,
  onDismissError,
}) => {
  const [duration, setDuration] = useState('00:00:00');
  const isRecording = appState === 'recording';
  const isProcessing = appState === 'processing';
  const isIdle = appState === 'idle';

  useEffect(() => {
    if (!isRecording || !startedAt) {
      setDuration('00:00:00');
      return;
    }
    const update = () => setDuration(formatDuration(startedAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isRecording, startedAt]);

  const recentTranscripts = transcripts.slice(-5);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">

        {/* ── Header row ── */}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white/90 leading-tight truncate">
              {isRecording ? 'Recording in Progress' : isProcessing ? 'Processing...' : 'New Recording'}
            </h1>
            <p className="text-[11px] text-white/30 mt-0.5 truncate">
              {isRecording
                ? 'Capturing mic + system audio'
                : 'Configure and start a new session'}
            </p>
          </div>
          <div className={`
            shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wider uppercase
            flex items-center gap-1 border
            ${isRecording
              ? 'bg-red-500/12 text-red-400 border-red-500/20'
              : isProcessing
                ? 'bg-white/[0.04] text-white/40 border-white/[0.08]'
                : 'bg-white/[0.03] text-white/25 border-white/[0.06]'
            }
          `}>
            {isRecording && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            {isProcessing && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {isRecording ? 'Live' : isProcessing ? 'Wait' : 'Ready'}
          </div>
        </div>

        {/* ── Config form (idle only) ── */}
        <AnimatePresence mode="wait">
          {isIdle && (
            <motion.div
              key="config"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="shrink-0 space-y-2"
            >
              {/* Project selector */}
              <div>
                <label className="text-[10px] text-white/25 font-medium mb-1 block">Project</label>
                <div className="relative">
                  <FolderOpen className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
                  <select
                    value={selectedProjectId}
                    onChange={(e) => onProjectChange(e.target.value)}
                    className="input-base w-full pl-8 pr-7 py-1.5 appearance-none cursor-pointer"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20 pointer-events-none" />
                </div>
              </div>

              {/* Meeting Title */}
              <div>
                <label className="text-[10px] text-white/25 font-medium mb-1 block">Meeting Title</label>
                <input
                  type="text"
                  placeholder="e.g. Sprint planning, 1:1 with Sarah..."
                  value={meetingTitle}
                  onChange={(e) => onMeetingTitleChange(e.target.value)}
                  className="input-base w-full px-2.5 py-1.5"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Waveform card ── */}
        <div className={`
          rounded-lg border shrink-0 transition-all duration-500
          ${isRecording
            ? 'border-white/[0.06] glow-recording'
            : 'border-white/[0.06]'
          }
          bg-white/[0.02]
        `}>
          {/* Timer (recording only) */}
          {isRecording && (
            <div className="flex items-center justify-center pt-2.5 pb-0.5">
              <span className="text-[24px] font-mono font-bold tracking-[0.10em] text-white/90 tabular-nums">
                {duration}
              </span>
            </div>
          )}

          {/* Canvas */}
          <div className="px-3 py-1.5">
            <Waveform micLevel={audioLevels.mic} systemLevel={audioLevels.system} isActive={isRecording} />
          </div>

          {/* Level meters — compact row */}
          <div className="flex items-center gap-4 px-3 pb-2">
            <div className="flex items-center gap-1.5">
              <Mic className="w-3 h-3 text-white/40" />
              <span className="text-[10px] text-white/30 w-5">Mic</span>
              <div className="w-16 h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div className="h-full bg-white/60 rounded-full" animate={{ width: `${Math.min(100, audioLevels.mic * 300)}%` }} transition={{ duration: 0.08 }} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Monitor className="w-3 h-3 text-white/25" />
              <span className="text-[10px] text-white/30 w-5">Sys</span>
              <div className="w-16 h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
                <motion.div className="h-full bg-white/35 rounded-full" animate={{ width: `${Math.min(100, audioLevels.system * 300)}%` }} transition={{ duration: 0.08 }} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Mic select + Start/Stop ── */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex-1 min-w-0">
            <Mic className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20 pointer-events-none" />
            <select
              value={selectedDevice}
              onChange={(e) => onDeviceChange(e.target.value)}
              disabled={isRecording || isProcessing}
              className="input-base w-full pl-8 pr-7 py-2 appearance-none cursor-pointer truncate"
            >
              {devices.length === 0 && <option value="">No microphone found</option>}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/20 pointer-events-none" />
          </div>

          <button
            onClick={isRecording ? onStop : onStart}
            disabled={isProcessing}
            className={`
              shrink-0 h-9 rounded-lg font-semibold text-[12px] flex items-center gap-1.5 px-5 whitespace-nowrap
              transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer
              active:scale-[0.97]
              ${isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/15 glow-recording'
                : 'bg-white text-[#0A0A0A] hover:bg-white/90 shadow-lg shadow-white/8 glow-white'
              }
            `}
          >
            {isRecording ? (
              <><Square className="w-3 h-3" /><span>Stop</span></>
            ) : isProcessing ? (
              <><Loader2 className="w-3 h-3 animate-spin" /><span>Wait</span></>
            ) : (
              <><Circle className="w-3 h-3 fill-current" /><span>Record</span></>
            )}
          </button>
        </div>

        {/* ── Live transcript preview ── */}
        {recentTranscripts.length > 0 && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden shrink-0">
            <div className="px-3 py-1.5 border-b border-white/[0.04] flex items-center gap-1.5">
              <Volume2 className="w-2.5 h-2.5 text-white/20" />
              <span className="text-[9px] font-medium text-white/25 uppercase tracking-wider">Live Transcript</span>
              <span className="text-[9px] text-white/15 ml-auto tabular-nums">{transcripts.length}</span>
            </div>
            <div className="p-2.5 space-y-1 max-h-[120px] overflow-y-auto">
              {recentTranscripts.map((seg, i) => {
                const brightness = getSpeakerBrightness(seg.speaker);
                return (
                  <div key={`${seg.timestamp}-${i}`} className={`text-[11px] leading-relaxed ${seg.isFinal ? 'opacity-100' : 'opacity-35'}`}>
                    <span
                      className="font-semibold text-[9px] uppercase tracking-wide mr-1"
                      style={{ color: `rgba(255, 255, 255, ${brightness})` }}
                    >
                      {seg.speaker}
                    </span>
                    <span className="text-white/55">{seg.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Empty state (fills remaining space) ── */}
        <div className="flex-1 flex items-center justify-center min-h-[40px]">
          {isIdle && recentTranscripts.length === 0 && (
            <div className="text-center py-4">
              <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-2">
                <Mic className="w-4 h-4 text-white/[0.08]" />
              </div>
              <p className="text-[11px] text-white/20">Ready to record</p>
              <p className="text-[9px] text-white/[0.10] mt-0.5">Mic + system audio captured simultaneously</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Error toast ── */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-3 left-3 right-3 bg-[#0A0A0A]/85 border border-red-500/15 rounded-lg px-3 py-2 flex items-center gap-2 backdrop-blur-md z-10"
          >
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-[11px] text-red-300/80 flex-1 min-w-0 truncate">{error}</span>
            <button onClick={onDismissError} className="text-red-400/40 hover:text-red-400 transition-colors text-[10px] font-medium shrink-0 active:scale-[0.97]">Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
