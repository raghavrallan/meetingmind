import React, { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquareText,
  Copy,
  Download,
  Check,
} from 'lucide-react';
import type { TranscriptSegment } from '../types';

interface TranscriptViewProps {
  segments: TranscriptSegment[];
  isRecording: boolean;
}

const BRIGHTNESS = [0.60, 0.45, 0.55, 0.40, 0.50, 0.42, 0.58, 0.48];
const speakerMap: Record<string, number> = {};
let idx = 0;
function getBrightness(speaker: string): number {
  if (!(speaker in speakerMap)) {
    speakerMap[speaker] = BRIGHTNESS[idx % BRIGHTNESS.length];
    idx++;
  }
  return speakerMap[speaker];
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ segments, isRecording }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [segments]);

  const handleCopy = () => {
    const text = segments.filter(s => s.isFinal).map(s => `${s.speaker}: ${s.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleExport = () => {
    const lines = segments
      .filter(s => s.isFinal)
      .map(s => `[${new Date(s.timestamp).toLocaleTimeString()}] ${s.speaker}: ${s.text}`);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasContent = segments.length > 0;
  const finalCount = segments.filter(s => s.isFinal).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white/90 leading-tight">Transcript</h1>
            <p className="text-[11px] text-white/30 mt-0.5">
              {isRecording ? 'Live transcription...' : `${finalCount} utterance${finalCount !== 1 ? 's' : ''}`}
            </p>
          </div>

          {hasContent && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-[10px] text-white/30 hover:text-white/50 transition-all active:scale-[0.97]"
              >
                {copied ? <Check className="w-2.5 h-2.5 text-white/60" /> : <Copy className="w-2.5 h-2.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-[10px] text-white/30 hover:text-white/50 transition-all active:scale-[0.97]"
              >
                <Download className="w-2.5 h-2.5" />
                Export
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {hasContent ? (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto mx-4 mb-4 rounded-lg border border-white/[0.06] bg-white/[0.015] p-3 space-y-2"
        >
          {segments.map((seg, i) => {
            const brightness = getBrightness(seg.speaker);
            return (
              <div
                key={`${seg.timestamp}-${i}`}
                className={`flex gap-2 ${seg.isFinal ? 'opacity-100' : 'opacity-30'}`}
              >
                <div className="shrink-0 pt-px">
                  <span
                    className="inline-block px-1 py-px rounded text-[8px] font-bold uppercase tracking-wider bg-white/[0.04] border border-white/[0.06]"
                    style={{ color: `rgba(255, 255, 255, ${brightness})` }}
                  >
                    {seg.speaker}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] leading-relaxed text-white/60">{seg.text}</p>
                  <span className="text-[8px] text-white/10 block">
                    {new Date(seg.timestamp).toLocaleTimeString()}
                    {!seg.isFinal && ' — interim'}
                  </span>
                </div>
              </div>
            );
          })}

          {isRecording && (
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="w-1 h-1 rounded-full bg-white/40 animate-pulse" />
              <span className="text-[9px] text-white/15">Listening...</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-center mx-auto mb-3">
              <MessageSquareText className="w-5 h-5 text-white/[0.06]" />
            </div>
            <h3 className="text-[12px] font-medium text-white/20 mb-0.5">No transcript</h3>
            <p className="text-[10px] text-white/[0.10] max-w-[200px] mx-auto">
              Start recording to see live transcription
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
