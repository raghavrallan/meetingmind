const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
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

let _refreshing: Promise<boolean> | null = null;

async function _tryRefreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
  _isRetry = false,
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;

  const config: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  // Auto-refresh on 401 (expired access token) -- retry once
  if (response.status === 401 && !_isRetry && !endpoint.includes("/auth/")) {
    // Deduplicate concurrent refresh calls
    if (!_refreshing) {
      _refreshing = _tryRefreshToken();
    }
    const refreshed = await _refreshing;
    _refreshing = null;

    if (refreshed) {
      return request<T>(endpoint, options, true);
    }
    // Refresh failed -- redirect to login
    window.location.href = "/login";
    throw new ApiError(401, "Session expired");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);

    // 403 = suspended -- redirect to login with message
    if (response.status === 403 && errorData?.detail?.includes("suspended")) {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
      window.location.href = `/login?error=${encodeURIComponent(errorData.detail)}`;
      throw new ApiError(403, errorData.detail);
    }

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

// --- API Client (cookie-based, no token passing) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const api: any = {
  // Meetings
  meetings: {
    list: async (params?: { project_id?: string; search?: string; from_date?: string; to_date?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set("project_id", params.project_id);
      if (params?.search) searchParams.set("search", params.search);
      if (params?.from_date) searchParams.set("from_date", params.from_date);
      if (params?.to_date) searchParams.set("to_date", params.to_date);
      const query = searchParams.toString();
      const data = await request<{ meetings: Meeting[]; total: number }>(`/api/v1/meetings/${query ? `?${query}` : ""}`);
      return data.meetings;
    },
    get: (id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}`),
    create: (data: { title: string; project_id?: string; language?: string }) =>
      request<Meeting>("/api/v1/meetings/", { method: "POST", body: data }),
    delete: (id: string) =>
      request<void>(`/api/v1/meetings/${id}`, { method: "DELETE" }),
    transcript: async (id: string) => {
      const data = await request<{ utterances: { id: string; speaker_index: number; speaker_name: string | null; text: string; start_time: number; end_time: number; confidence: number }[] }>(`/api/v1/transcripts/meeting/${id}`);
      return data.utterances.map((u) => ({
        id: u.id,
        speaker: u.speaker_name || `Speaker ${u.speaker_index + 1}`,
        speaker_index: u.speaker_index,
        text: u.text,
        start_time: u.start_time,
        end_time: u.end_time,
        confidence: u.confidence,
      })) as TranscriptUtterance[];
    },
    notes: async (id: string) => {
      const data = await request<{ executive_summary: string; decisions: unknown[] | null; action_items: unknown[] | null; full_notes_markdown: string; key_points: unknown[] | null }>(`/api/v1/notes/meeting/${id}`);
      return {
        summary: data.executive_summary || "",
        decisions: (data.decisions || []).map((d: unknown) => typeof d === "string" ? d : (d as Record<string, string>)?.decision || JSON.stringify(d)),
        action_items: (data.action_items || []).map((a: unknown, i: number) => {
          const item = a as Record<string, unknown>;
          return {
            id: String(i),
            text: (item.item || item.task || item.text || "") as string,
            assignee: (item.assignee || null) as string | null,
            due_date: (item.due_date || item.due || null) as string | null,
            completed: false,
          };
        }),
        full_notes: data.full_notes_markdown || "",
      } as MeetingNotes;
    },
    generateNotes: (id: string) =>
      request<MeetingNotes>(`/api/v1/notes/meeting/${id}/regenerate`, { method: "POST" }),
    audioUrl: (id: string) => `${API_BASE_URL}/api/v1/meetings/${id}/audio`,
    start: (id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}/start`, { method: "POST" }),
    stop: (id: string) =>
      request<Meeting>(`/api/v1/meetings/${id}/stop`, { method: "POST" }),
    wsUrl: (meetingId: string) => {
      const base = API_BASE_URL.replace(/^http/, "ws");
      return `${base}/api/v1/meetings/${meetingId}/ws`;
    },
  },

  // Projects
  projects: {
    list: async () => {
      const data = await request<{ projects: Project[]; total: number }>("/api/v1/projects/");
      return data.projects;
    },
    get: (id: string) =>
      request<Project>(`/api/v1/projects/${id}`),
    create: (data: { name: string; description?: string; color?: string }) =>
      request<Project>("/api/v1/projects/", { method: "POST", body: data }),
    update: (id: string, data: Partial<Project>) =>
      request<Project>(`/api/v1/projects/${id}`, { method: "PATCH", body: data }),
    delete: (id: string) =>
      request<void>(`/api/v1/projects/${id}`, { method: "DELETE" }),
    meetings: (id: string) =>
      request<Meeting[]>(`/api/v1/projects/${id}/meetings/`),
    members: (id: string) =>
      request<ProjectMember[]>(`/api/v1/projects/${id}/members`),
    brief: (id: string) =>
      request<{ brief: string }>(`/api/v1/projects/${id}/brief/`),
    regenerateBrief: (id: string) =>
      request<{ brief: string }>(`/api/v1/projects/${id}/brief/regenerate/`, { method: "POST" }),
  },

  // Tasks
  tasks: {
    list: async (params?: { project_id?: string; assignee_id?: string; status?: string; priority?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.project_id) searchParams.set("project_id", params.project_id);
      if (params?.assignee_id) searchParams.set("assignee_id", params.assignee_id);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.priority) searchParams.set("priority", params.priority);
      const query = searchParams.toString();
      const data = await request<{ tasks: Task[]; total: number }>(`/api/v1/tasks/${query ? `?${query}` : ""}`);
      return data.tasks;
    },
    board: () =>
      request<{ open: Task[]; in_progress: Task[]; completed: Task[]; cancelled: Task[] }>("/api/v1/tasks/board/"),
    get: (id: string) =>
      request<Task>(`/api/v1/tasks/${id}`),
    create: (data: Partial<Task>) =>
      request<Task>("/api/v1/tasks/", { method: "POST", body: data }),
    update: (id: string, data: Partial<Task>) =>
      request<Task>(`/api/v1/tasks/${id}`, { method: "PATCH", body: data }),
    delete: (id: string) =>
      request<void>(`/api/v1/tasks/${id}`, { method: "DELETE" }),
  },

  // Team
  team: {
    list: () =>
      request<TeamMember[]>("/api/v1/team/"),
    get: (id: string) =>
      request<TeamMember>(`/api/v1/team/${id}/profile`),
    workload: (id: string) =>
      request<{ open_tasks: number; completed_tasks: number; meetings_attended: number }>(`/api/v1/team/${id}/workload`),
  },

  // Dashboard
  dashboard: {
    stats: () =>
      request<DashboardStats>("/api/v1/dashboard/stats/"),
    recentMeetings: () =>
      request<Meeting[]>("/api/v1/dashboard/recent-meetings/"),
    upcomingMeetings: () =>
      request<Meeting[]>("/api/v1/dashboard/upcoming-meetings/"),
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

api.settings = {
  list: () =>
    request<SettingsListResponse>("/api/v1/settings/"),
  upsert: (settings: { key: string; value: string }[]) =>
    request<{ updated: string[]; count: number }>("/api/v1/settings/", {
      method: "PUT",
      body: { settings },
    }),
  get: (key: string) =>
    request<UserSettingResponse>(`/api/v1/settings/${key}`),
  delete: (key: string) =>
    request<{ deleted: string }>(`/api/v1/settings/${key}`, {
      method: "DELETE",
    }),
};

// OAuth
api.oauth = {
  googleUrl: (redirectUri: string) =>
    request<{ url: string }>(`/api/v1/auth/oauth/google?redirect_uri=${encodeURIComponent(redirectUri)}`),
  googleCallback: (code: string, redirectUri: string) =>
    request<{ access_token: string }>("/api/v1/auth/oauth/google/callback", {
      method: "POST",
      body: { code, redirect_uri: redirectUri },
    }),
  microsoftUrl: (redirectUri: string) =>
    request<{ url: string }>(`/api/v1/auth/oauth/microsoft?redirect_uri=${encodeURIComponent(redirectUri)}`),
  microsoftCallback: (code: string, redirectUri: string) =>
    request<{ success: boolean }>("/api/v1/auth/oauth/microsoft/callback", {
      method: "POST",
      body: { code, redirect_uri: redirectUri },
    }),
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
