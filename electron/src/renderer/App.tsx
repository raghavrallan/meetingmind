import React, { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TranscriptSegment, AudioLevels } from './types';
import { startAudioCapture, stopAudioCapture, enumerateAudioDevices } from './audio-capture-renderer';
import { fetchProjects, createMeetingAPI, stopMeetingAPI, type ProjectAPI } from './api-client';

import { Titlebar } from './components/Titlebar';
import { Sidebar, type ViewTab } from './components/Sidebar';
import { RecordingView, type Project } from './components/RecordingView';
import { MeetingsView } from './components/MeetingsView';
import { TranscriptView } from './components/TranscriptView';
import { SettingsView } from './components/SettingsView';

type AppState = 'idle' | 'recording' | 'processing';

interface AudioDevice {
  deviceId: string;
  label: string;
}

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ViewTab>('recording');
  const [appState, setAppState] = useState<AppState>('idle');
  const [meetingId, setMeetingId] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptSegment[]>([]);
  const [audioLevels, setAudioLevels] = useState<AudioLevels>({ mic: 0, system: 0 });
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);

  const api = window.electronAPI;
  const isRecording = appState === 'recording';
  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  useEffect(() => {
    const init = async () => {
      try {
        const apiProjects = await fetchProjects();
        setProjects(apiProjects.map((p: ProjectAPI) => ({
          id: p.id,
          name: p.name,
          color: p.color,
        })));
      } catch (err) {
        console.warn('Failed to fetch projects:', err);
      }

      try {
        const status = await api.getStatus();
        if (status.isRecording) {
          setAppState('recording');
          setMeetingId(status.meetingId || '');
          setMeetingTitle(status.meetingTitle || '');
          setStartedAt(status.startedAt);
        }
      } catch {}

      try {
        const audioDevices = await enumerateAudioDevices();
        setDevices(audioDevices);
        if (audioDevices.length > 0 && !selectedDevice) {
          setSelectedDevice(audioDevices[0].deviceId);
        }
      } catch {}
    };
    init();
  }, []);

  useEffect(() => {
    const unsubs = [
      api.onTranscript((segment) => {
        setTranscripts((prev) => {
          const next = [...prev, segment];
          return next.length > 200 ? next.slice(-200) : next;
        });
      }),
      api.onAudioLevel((levels) => setAudioLevels(levels)),
      api.onStatusChange((status) => {
        setAppState(status.isRecording ? 'recording' : 'idle');
        setStartedAt(status.startedAt);
        setMeetingId(status.meetingId || '');
        setMeetingTitle(status.meetingTitle || '');
      }),
      api.onTrayAction((action) => {
        if (action === 'start-recording' && appState === 'idle') handleStartRecording();
        else if (action === 'stop-recording' && appState === 'recording') handleStopRecording();
      }),
      api.onAudioCaptureStart(async (config) => {
        try {
          await startAudioCapture(config);
        } catch (err) {
          setError(`Audio capture failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
      api.onAudioCaptureStop(async () => { await stopAudioCapture(); }),
      api.onCaptureError((msg) => setError(`Capture error: ${msg}`)),
      api.onStreamError((msg) => setError(`Stream error: ${msg}`)),
    ];

    return () => unsubs.forEach((fn) => fn());
  }, [appState]);

  const handleStartRecording = useCallback(async () => {
    setError(null);
    setTranscripts([]);

    const title = meetingTitle.trim() || `Meeting ${new Date().toLocaleString()}`;

    try {
      const meeting = await createMeetingAPI(title, selectedProjectId || undefined);
      setMeetingId(meeting.id);

      if (selectedDevice) await api.selectMicrophone(selectedDevice);

      const result = await api.startRecording({
        meetingId: meeting.id,
        meetingTitle: title,
      });
      if (!result.success) setError(result.error || 'Failed to start recording');
    } catch (err) {
      setError(`Failed to create meeting: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [meetingTitle, selectedProjectId, selectedDevice, api]);

  const handleStopRecording = useCallback(async () => {
    setAppState('processing');
    const result = await api.stopRecording();
    if (!result.success) setError(result.error || 'Failed to stop recording');

    // Tell the backend to stop the meeting (triggers AI processing)
    if (meetingId) {
      try {
        await stopMeetingAPI(meetingId);
      } catch (err) {
        console.warn('Failed to stop meeting via API:', err);
      }
    }

    setAppState('idle');
  }, [api, meetingId]);

  const handleDeviceChange = useCallback(async (deviceId: string) => {
    setSelectedDevice(deviceId);
    await api.selectMicrophone(deviceId);
  }, [api]);

  return (
    <div className="flex flex-col w-full h-screen bg-[#0A0A0A] overflow-hidden">
      <Titlebar isRecording={isRecording} projectName={selectedProject?.name} />

      <div className="flex flex-1 min-h-0">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} isRecording={isRecording} />

        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="h-full"
            >
              {activeTab === 'recording' && (
                <RecordingView
                  appState={appState}
                  meetingId={meetingId}
                  meetingTitle={meetingTitle}
                  startedAt={startedAt}
                  audioLevels={audioLevels}
                  devices={devices}
                  selectedDevice={selectedDevice}
                  transcripts={transcripts}
                  error={error}
                  projects={projects}
                  selectedProjectId={selectedProjectId}
                  onProjectChange={setSelectedProjectId}
                  onMeetingTitleChange={setMeetingTitle}
                  onDeviceChange={handleDeviceChange}
                  onStart={handleStartRecording}
                  onStop={handleStopRecording}
                  onDismissError={() => setError(null)}
                />
              )}
              {activeTab === 'meetings' && <MeetingsView projects={projects} />}
              {activeTab === 'transcript' && <TranscriptView segments={transcripts} isRecording={isRecording} />}
              {activeTab === 'settings' && <SettingsView />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
};

export default App;
