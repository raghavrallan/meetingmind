import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  Calendar,
  Clock,
  Users,
  ArrowUpRight,
  FolderOpen,
  ChevronDown,
  FileText,
  Loader2,
} from 'lucide-react';
import type { Project } from './RecordingView';
import { fetchMeetings, type MeetingAPI } from '../api-client';

interface MeetingItem {
  id: string;
  title: string;
  date: string;
  duration: string;
  participants: number;
  hasNotes: boolean;
  projectId: string;
}

interface MeetingsViewProps {
  projects: Project[];
}

function formatDurationFromSeconds(seconds: number | null): string {
  if (!seconds) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDate(isoString: string | null): string {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return `Today, ${timeStr}`;
  if (diffDays === 1) return `Yesterday, ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function apiToMeetingItem(m: MeetingAPI): MeetingItem {
  return {
    id: m.id,
    title: m.title,
    date: formatDate(m.actual_start || m.created_at),
    duration: formatDurationFromSeconds(m.duration_seconds),
    participants: m.participants.length,
    hasNotes: false,
    projectId: m.project_id || '',
  };
}

export const MeetingsView: React.FC<MeetingsViewProps> = ({ projects }) => {
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const apiMeetings = await fetchMeetings();
        if (!cancelled) setMeetings(apiMeetings.map(apiToMeetingItem));
      } catch (err) {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Failed to fetch meetings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = meetings.filter((m) => {
    if (filterProject && m.projectId !== filterProject) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 pb-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white/90 leading-tight">Meetings</h1>
            <p className="text-[11px] text-white/30 mt-0.5">Browse recorded sessions</p>
          </div>
          <div className="px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.06] text-center shrink-0">
            <span className="text-[12px] font-semibold text-white/50 tabular-nums">{filtered.length}</span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/15 pointer-events-none" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base w-full pl-8 pr-3 py-1.5"
            />
          </div>
          <div className="relative shrink-0">
            <FolderOpen className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/15 pointer-events-none" />
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="input-base pl-7 pr-6 py-1.5 text-[12px] appearance-none cursor-pointer"
            >
              <option value="">All</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/15 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Meeting list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3 space-y-1.5">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 text-white/15 animate-spin" />
            <span className="text-[12px] text-white/15 ml-2">Loading...</span>
          </div>
        )}

        {fetchError && !loading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-[12px] text-red-400/50">{fetchError}</p>
              <p className="text-[10px] text-white/15 mt-1">Check the backend connection</p>
            </div>
          </div>
        )}

        {!loading && !fetchError && filtered.map((meeting, index) => {
          const project = projects.find((p) => p.id === meeting.projectId);
          return (
            <motion.div
              key={meeting.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -1 }}
              transition={{ delay: index * 0.03, duration: 0.15 }}
              className="group rounded-lg border border-white/[0.06] bg-white/[0.015] hover:bg-white/[0.04] hover:border-white/[0.10] p-3 cursor-pointer transition-all duration-150"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-[12px] font-medium text-white/75 truncate">{meeting.title}</h3>
                    {meeting.hasNotes && (
                      <span className="shrink-0 flex items-center gap-0.5 px-1 py-px rounded text-[8px] font-semibold uppercase tracking-wider bg-white/[0.04] text-white/40 border border-white/[0.06]">
                        <FileText className="w-2 h-2" />
                        Notes
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 text-[10px] text-white/20">
                    {project && <span>{project.name}</span>}
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-2.5 h-2.5" />
                      {meeting.date}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {meeting.duration}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" />
                      {meeting.participants}
                    </span>
                  </div>
                </div>
                <ArrowUpRight className="w-3 h-3 text-white/[0.05] group-hover:text-white/20 transition-colors shrink-0" />
              </div>
            </motion.div>
          );
        })}

        {!loading && !fetchError && filtered.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Search className="w-5 h-5 text-white/[0.06] mx-auto mb-2" />
              <p className="text-[12px] text-white/15">
                {meetings.length === 0 ? 'No meetings yet' : 'No matches'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
