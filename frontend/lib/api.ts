const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = "GET", body, headers = {}, token } = options;

  const config: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      errorData?.detail || `Request failed with status ${response.status}`,
      errorData
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// --- Types ---

export interface Meeting {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
  created_by_id: string;
  audio_storage_key: string | null;
  duration_seconds: number | null;
  language: string;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  participants: Participant[];
  created_at: string;
  updated_at: string;
}

export interface Participant {
  id: string;
  display_name: string;
  speaker_index: number;
  channel_index: number;
  talk_time_seconds: number;
  word_count: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  is_archived: boolean;
  owner_id: string;
  brief: string | null;
  meeting_count: number;
  member_count: number;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  assignee_name?: string;
  project_id: string | null;
  source_meeting_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptUtterance {
  id: string;
  speaker: string;
  speaker_index: number;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number;
}

export interface MeetingNotes {
  summary: string;
  decisions: string[];
  action_items: ActionItem[];
  full_notes: string;
}

export interface ActionItem {
  id: string;
  text: string;
  assignee: string | null;
  due_date: string | null;
  completed: boolean;
}

export interface TeamMember {
  user_id?: string;
  id?: string;
  name: string;
  email: string;
  avatar_url?: string;
  role?: string;
  open_tasks_count?: number;
  total_meetings?: number;
  topics?: string[];
  last_active?: string;
}

export interface ProjectMember {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface DashboardStats {
  total_meetings: number;
  active_projects: number;
  open_tasks: number;
  hours_recorded: number;
}

// --- API Client ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = {
  // Auth
  auth: {
    me: (token: string) => request<{ user: TeamMember }>("/api/v1/auth/me", { token }),
    deviceLogin: () =>
      request<{ access_token: string; user: { id: string; email: string; name: string } }>("/api/v1/auth/device-login", { method: "POST", body: { device_name: "Desktop Agent" } }),
  },

  // Meetings
  meetings: {
    list: async (token: string, params?: { project_id?: string; search?: string; from_date?: string; to_date?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set("project_id", params.project_id);
      if (params?.search) searchParams.set("search", params.search);
      if (params?.from_date) searchParams.set("from_date", params.from_date);
      if (params?.to_date) searchParams.set("to_date", params.to_date);
      const query = searchParams.toString();
      const data = await request<{ meetings: Meeting[]; total: number }>(`/api/v1/meetings/${query ? `?${query}` : ""}`, { token });
      return data.meetings;
    },
    get: (token: string, id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}`, { token }),
    create: (token: string, data: { title: string; project_id?: string }) =>
      request<Meeting>("/api/v1/meetings/", { method: "POST", body: data, token }),
    delete: (token: string, id: string) =>
      request<void>(`/api/v1/meetings/${id}`, { method: "DELETE", token }),
    transcript: (token: string, id: string) =>
      request<TranscriptUtterance[]>(`/api/v1/meetings/${id}/transcript/`, { token }),
    notes: (token: string, id: string) =>
      request<MeetingNotes>(`/api/v1/meetings/${id}/notes/`, { token }),
    generateNotes: (token: string, id: string) =>
      request<MeetingNotes>(`/api/v1/meetings/${id}/notes/generate/`, { method: "POST", token }),
    audioUrl: (id: string) => `${API_BASE_URL}/api/v1/meetings/${id}/audio/`,
    start: (token: string, id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}/start`, { method: "POST", token }),
    stop: (token: string, id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}/stop`, { method: "POST", token }),
    wsUrl: (meetingId: string, token: string) => {
      const base = API_BASE_URL.replace(/^http/, "ws");
      return `${base}/api/v1/meetings/${meetingId}/ws?token=${encodeURIComponent(token)}`;
    },
  },

  // Projects
  projects: {
    list: async (token: string) => {
      const data = await request<{ projects: Project[]; total: number }>("/api/v1/projects/", { token });
      return data.projects;
    },
    get: (token: string, id: string) =>
      request<Project>(`/api/v1/projects/${id}`, { token }),
    create: (token: string, data: { name: string; description?: string; color?: string }) =>
      request<Project>("/api/v1/projects/", { method: "POST", body: data, token }),
    update: (token: string, id: string, data: Partial<Project>) =>
      request<Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: data, token }),
    delete: (token: string, id: string) =>
      request<void>(`/api/v1/projects/${id}`, { method: "DELETE", token }),
    meetings: (token: string, id: string) =>
      request<Meeting[]>(`/api/v1/projects/${id}/meetings/`, { token }),
    members: (token: string, id: string) =>
      request<ProjectMember[]>(`/api/v1/projects/${id}/members`, { token }),
    brief: (token: string, id: string) =>
      request<{ brief: string }>(`/api/v1/projects/${id}/brief/`, { token }),
    regenerateBrief: (token: string, id: string) =>
      request<{ brief: string }>(`/api/v1/projects/${id}/brief/regenerate/`, { method: "POST", token }),
  },

  // Tasks
  tasks: {
    list: async (token: string, params?: { project_id?: string; assignee_id?: string; status?: string; priority?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set("project_id", params.project_id);
      if (params?.assignee_id) searchParams.set("assignee_id", params.assignee_id);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.priority) searchParams.set("priority", params.priority);
      const query = searchParams.toString();
      const data = await request<{ tasks: Task[]; total: number }>(`/api/v1/tasks/${query ? `?${query}` : ""}`, { token });
      return data.tasks;
    },
    board: (token: string) =>
      request<{ open: Task[]; in_progress: Task[]; completed: Task[]; cancelled: Task[] }>("/api/v1/tasks/board/", { token }),
    get: (token: string, id: string) =>
      request<Task>(`/api/v1/tasks/${id}`, { token }),
    create: (token: string, data: Partial<Task>) =>
      request<Task>("/api/v1/tasks/", { method: "POST", body: data, token }),
    update: (token: string, id: string, data: Partial<Task>) =>
      request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: data, token }),
    delete: (token: string, id: string) =>
      request<void>(`/api/v1/tasks/${id}`, { method: "DELETE", token }),
  },

  // Team
  team: {
    list: (token: string) =>
      request<TeamMember[]>("/api/v1/team/", { token }),
    get: (token: string, id: string) =>
      request<TeamMember>(`/api/v1/team/${id}/profile`, { token }),
    workload: (token: string, id: string) =>
      request<{ open_tasks: number; completed_tasks: number; meetings_attended: number }>(`/api/v1/team/${id}/workload`, { token }),
  },

  // Dashboard
  dashboard: {
    stats: (token: string) =>
      request<DashboardStats>("/api/v1/dashboard/stats/", { token }),
    recentMeetings: (token: string) =>
      request<Meeting[]>("/api/v1/dashboard/recent-meetings/", { token }),
    upcomingMeetings: (token: string) =>
      request<Meeting[]>("/api/v1/dashboard/upcoming-meetings/", { token }),
  },
};

// Settings
export interface UserSettingResponse {
  key: string;
  masked_value: string;
  has_value: boolean;
  category: string;
  label: string;
  updated_at: string | null;
}

export interface SettingsListResponse {
  settings: UserSettingResponse[];
}

// Extend the api object with settings methods
api.settings = {
  list: (token: string) =>
    request<SettingsListResponse>("/api/v1/settings/", { token }),
  upsert: (token: string, settings: { key: string; value: string }[]) =>
    request<{ updated: string[]; count: number }>("/api/v1/settings/", {
      method: "PUT",
      body: { settings },
      token,
    }),
  get: (token: string, key: string) =>
    request<UserSettingResponse>(`/api/v1/settings/${key}`, { token }),
  delete: (token: string, key: string) =>
    request<{ deleted: string }>(`/api/v1/settings/${key}`, {
      method: "DELETE",
      token,
    }),
};

// OAuth
api.oauth = {
  googleUrl: (token: string, redirectUri: string) =>
    request<{ url: string }>(`/api/v1/auth/oauth/google/url?redirect_uri=${encodeURIComponent(redirectUri)}`, { token }),
  microsoftUrl: (token: string, redirectUri: string) =>
    request<{ url: string }>(`/api/v1/auth/oauth/microsoft/url?redirect_uri=${encodeURIComponent(redirectUri)}`, { token }),
  googleCallback: (code: string, redirectUri: string) =>
    request<{ access_token: string }>("/api/v1/auth/login/google", { method: "POST", body: { code, redirect_uri: redirectUri } }),
  microsoftCallback: (code: string, redirectUri: string) =>
    request<{ access_token: string }>("/api/v1/auth/login/microsoft", { method: "POST", body: { code, redirect_uri: redirectUri } }),
};

// Helpers for meeting data access
export function getMeetingDate(meeting: Meeting): string {
  return meeting.actual_start || meeting.scheduled_start || meeting.created_at;
}

export function getMeetingDuration(meeting: Meeting): number {
  return meeting.duration_seconds || 0;
}

export function getParticipantName(p: Participant): string {
  return p.display_name;
}

export { ApiError };
