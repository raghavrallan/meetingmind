/**
 * API client for the Electron renderer.
 * Routes all HTTP requests through the main process via IPC
 * to bypass renderer CORS / file:// origin restrictions.
 */

const API_BASE = 'http://localhost:80/api/v1';

let jwtToken: string | null = null;

/** IPC-based fetch that goes through the main process */
async function ipcFetch(
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; json: () => any }> {
  const res = await window.electronAPI.apiFetch({
    url,
    method: opts?.method,
    headers: opts?.headers,
    body: opts?.body,
  });
  return {
    ok: res.ok,
    status: res.status,
    json: () => JSON.parse(res.body),
  };
}

// ── Auth ────────────────────────────────────────────────────────

export async function deviceLogin(): Promise<string> {
  const res = await ipcFetch(`${API_BASE}/auth/device-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_name: 'Desktop Agent' }),
  });
  if (!res.ok) throw new Error(`Device login failed: ${res.status}`);
  const data = res.json();
  jwtToken = data.access_token;
  return jwtToken;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwtToken) headers['Authorization'] = `Bearer ${jwtToken}`;
  return headers;
}

async function apiFetch<T>(path: string, opts?: { method?: string; body?: string }): Promise<T> {
  // Auto-login if no token
  if (!jwtToken) await deviceLogin();

  const res = await ipcFetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { ...authHeaders() },
  });

  // Token expired — retry once
  if (res.status === 401) {
    await deviceLogin();
    const retry = await ipcFetch(`${API_BASE}${path}`, {
      ...opts,
      headers: { ...authHeaders() },
    });
    if (!retry.ok) throw new Error(`API ${path}: ${retry.status}`);
    return retry.json();
  }

  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

// ── Types (match backend responses) ─────────────────────────────

export interface ProjectAPI {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_archived: boolean;
  owner_id: string;
  brief: string | null;
  meeting_count: number;
  member_count: number;
  created_at: string;
}

export interface ParticipantAPI {
  id: string;
  display_name: string;
  speaker_index: number | null;
  channel_index: number | null;
  talk_time_seconds: number;
  word_count: number;
}

export interface MeetingAPI {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
  created_by_id: string;
  audio_storage_key: string | null;
  duration_seconds: number | null;
  language: string;
  actual_start: string | null;
  actual_end: string | null;
  participants: ParticipantAPI[];
  created_at: string;
  updated_at: string;
}

// ── API calls ───────────────────────────────────────────────────

export async function fetchProjects(): Promise<ProjectAPI[]> {
  const data = await apiFetch<{ projects: ProjectAPI[]; total: number }>('/projects/');
  return data.projects;
}

export async function fetchMeetings(projectId?: string): Promise<MeetingAPI[]> {
  let path = '/meetings/?per_page=50';
  if (projectId) path += `&project_id=${projectId}`;
  const data = await apiFetch<{ meetings: MeetingAPI[]; total: number }>(path);
  return data.meetings;
}

export async function createMeetingAPI(title: string, projectId?: string): Promise<MeetingAPI> {
  const meeting = await apiFetch<MeetingAPI>('/meetings/', {
    method: 'POST',
    body: JSON.stringify({
      title,
      project_id: projectId || null,
    }),
  });
  // Transition from SCHEDULED to RECORDING
  return apiFetch<MeetingAPI>(`/meetings/${meeting.id}/start`, { method: 'POST' });
}

export async function stopMeetingAPI(meetingId: string): Promise<MeetingAPI> {
  return apiFetch<MeetingAPI>(`/meetings/${meetingId}/stop`, { method: 'POST' });
}

// ── Settings ─────────────────────────────────────────────────────

export interface SettingEntry {
  key: string;
  masked_value: string;
  has_value: boolean;
}

export async function fetchSettings(): Promise<{ settings: SettingEntry[] }> {
  return apiFetch<{ settings: SettingEntry[] }>('/settings/');
}

export async function upsertSettings(settings: { key: string; value: string }[]): Promise<void> {
  await apiFetch<unknown>('/settings/', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
}
