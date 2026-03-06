import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Server,
  Mic,
  Shield,
  Check,
  ExternalLink,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { fetchSettings, upsertSettings } from '../api-client';

export const SettingsView: React.FC = () => {
  const [apiUrl, setApiUrl] = useState('http://localhost');
  const [sampleRate, setSampleRate] = useState('16000');
  const [language, setLanguage] = useState('en');
  const [autoStart, setAutoStart] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then(({ settings }) => {
        for (const s of settings) {
          if (s.key === 'electron_api_url' && s.has_value) setApiUrl(s.masked_value);
          if (s.key === 'electron_sample_rate' && s.has_value) setSampleRate(s.masked_value);
          if (s.key === 'electron_language' && s.has_value) setLanguage(s.masked_value);
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertSettings([
        { key: 'electron_api_url', value: apiUrl },
        { key: 'electron_sample_rate', value: sampleRate },
        { key: 'electron_language', value: language },
      ]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold text-white/90 leading-tight">Settings</h1>
            <p className="text-[11px] text-white/30 mt-0.5">Configure preferences</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`
              shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-200 cursor-pointer
              active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed
              ${saved
                ? 'bg-white/[0.05] text-white/50 border border-white/[0.08]'
                : 'bg-white text-[#0A0A0A] hover:bg-white/90 shadow-md shadow-white/[0.06]'
              }
            `}
          >
            {saving ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving...</> : saved ? <><Check className="w-3 h-3" /> Saved</> : 'Save'}
          </button>
        </div>
      </div>

      {/* Scrollable settings */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-0 space-y-2.5">
        {/* Connection */}
        <Card title="Connection" icon={Server}>
          <div className="space-y-2.5">
            <Field label="API URL">
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="input-base w-full px-2.5 py-1.5 font-mono text-[12px]"
              />
            </Field>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25">Status</span>
              <span className="flex items-center gap-1 text-[10px] text-white/50">
                <span className="w-1 h-1 rounded-full bg-white" />
                Connected
              </span>
            </div>
          </div>
        </Card>

        {/* Audio */}
        <Card title="Audio" icon={Mic}>
          <div className="space-y-2.5">
            <Field label="Sample rate">
              <Select value={sampleRate} onChange={setSampleRate}>
                <option value="16000">16 kHz (speech)</option>
                <option value="44100">44.1 kHz</option>
                <option value="48000">48 kHz</option>
              </Select>
            </Field>
            <Field label="Language">
              <Select value={language} onChange={setLanguage}>
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
                <option value="hi">Hindi</option>
                <option value="multi">Auto-detect</option>
              </Select>
            </Field>
          </div>
        </Card>

        {/* Behavior */}
        <Card title="Behavior" icon={Settings}>
          <div className="space-y-3">
            <Toggle
              label="Auto-start on login"
              desc="Launch when computer starts"
              on={autoStart}
              onChange={setAutoStart}
            />
            <Toggle
              label="Minimize to tray"
              desc="Keep running in system tray"
              on={minimizeToTray}
              onChange={setMinimizeToTray}
            />
          </div>
        </Card>

        {/* Info */}
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] p-3">
          <div className="flex items-center gap-2.5">
            <Shield className="w-3.5 h-3.5 text-white/10 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-white/25">API keys managed in the web dashboard</p>
              <p className="text-[9px] text-white/12 mt-px">Keys are encrypted server-side</p>
            </div>
            <ExternalLink className="w-3 h-3 text-white/[0.08] shrink-0" />
          </div>
        </div>
      </div>
    </div>
  );
};

/* Sub-components */

function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-3">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Icon className="w-3.5 h-3.5 text-white/20" />
        <h3 className="text-[12px] font-medium text-white/50">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-white/20 font-medium mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-base w-full px-2.5 pr-7 py-1.5 text-[12px] appearance-none cursor-pointer"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/15 pointer-events-none" />
    </div>
  );
}

function Toggle({ label, desc, on, onChange }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] text-white/50">{label}</p>
        <p className="text-[9px] text-white/15 mt-px">{desc}</p>
      </div>
      <button
        onClick={() => onChange(!on)}
        className={`
          relative shrink-0 w-[34px] h-[18px] rounded-full transition-colors duration-200 cursor-pointer
          ${on ? 'bg-white' : 'bg-white/[0.08]'}
        `}
      >
        <motion.div
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full shadow-sm ${on ? 'bg-[#0A0A0A]' : 'bg-white'}`}
          animate={{ left: on ? 17 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        />
      </button>
    </div>
  );
}
