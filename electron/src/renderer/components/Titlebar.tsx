import React from 'react';
import { Minus, X } from 'lucide-react';

interface TitlebarProps {
  isRecording: boolean;
  projectName?: string;
}

export const Titlebar: React.FC<TitlebarProps> = ({ isRecording, projectName }) => {
  const api = window.electronAPI;

  return (
    <div className="titlebar-drag flex items-center justify-between h-8 bg-[#111111] border-b border-white/[0.06] px-3 shrink-0">
      {/* Left: status dot + app name */}
      <div className="flex items-center gap-2 min-w-0">
        <div className={`w-[6px] h-[6px] rounded-full shrink-0 transition-colors ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`} />
        <span className="text-[10px] font-medium tracking-wider text-white/30 uppercase truncate">
          AI Notetaker
        </span>
        {projectName && (
          <>
            <span className="text-white/10 text-[10px]">/</span>
            <span className="text-[10px] text-white/40 truncate">{projectName}</span>
          </>
        )}
      </div>

      {/* Center: recording pill */}
      {isRecording && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 shrink-0 mx-2">
          <span className="w-[5px] h-[5px] rounded-full bg-red-500 animate-pulse" />
          <span className="text-[9px] font-bold text-red-400 tracking-wider">REC</span>
        </div>
      )}

      {/* Right: window controls */}
      <div className="flex items-center shrink-0">
        <button
          onClick={() => api.minimizeWindow()}
          className="w-7 h-6 flex items-center justify-center rounded hover:bg-white/[0.06] text-white/20 hover:text-white/50 transition-colors"
          title="Minimize"
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          onClick={() => api.closeWindow()}
          className="w-7 h-6 flex items-center justify-center rounded hover:bg-red-500/15 text-white/20 hover:text-red-400 transition-colors"
          title="Close to tray"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
