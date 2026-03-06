import React from 'react';
import { motion } from 'framer-motion';
import {
  Radio,
  ClipboardList,
  MessageSquareText,
  Settings,
  Sparkles,
} from 'lucide-react';

export type ViewTab = 'recording' | 'meetings' | 'transcript' | 'settings';

interface SidebarProps {
  activeTab: ViewTab;
  onTabChange: (tab: ViewTab) => void;
  isRecording: boolean;
}

const tabs: { id: ViewTab; icon: React.ElementType; label: string }[] = [
  { id: 'recording', icon: Radio, label: 'Record' },
  { id: 'meetings', icon: ClipboardList, label: 'Meetings' },
  { id: 'transcript', icon: MessageSquareText, label: 'Transcript' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <div className="w-[52px] bg-[#111111] border-r border-white/[0.06] flex flex-col items-center py-3 shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center mb-5">
        <Sparkles className="w-4 h-4 text-white/60" />
      </div>

      {/* Nav — icon-only, tooltip for labels */}
      <div className="flex flex-col items-center gap-1 w-full px-1.5">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;

          return (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              whileTap={{ scale: 0.92 }}
              className={`
                relative w-9 h-9 rounded-lg flex items-center justify-center
                transition-all duration-150 cursor-pointer
                ${isActive
                  ? 'bg-white/[0.08] text-white'
                  : 'text-white/[0.20] hover:text-white/[0.45] hover:bg-white/[0.04]'
                }
              `}
              title={tab.label}
            >
              {/* Active bar */}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute -left-1.5 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-white"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="w-[18px] h-[18px]" />
            </motion.button>
          );
        })}
      </div>

      <div className="flex-1" />
      <span className="text-[7px] text-white/[0.08] font-mono">v1.0</span>
    </div>
  );
};
