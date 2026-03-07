"use client";

import { useEffect, useState, useCallback } from "react";
import {
  User,
  Calendar,
  Languages,
  Bell,
  Key,
  Check,
  ExternalLink,
  Loader2,
  Eye,
  EyeOff,
  Shield,
  Trash2,
  AlertCircle,
  Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type UserSettingResponse } from "@/lib/api";
import { useAuth } from "@/lib/hooks/use-auth";

interface ApiKeyField {
  key: string;
  label: string;
  description: string;
  placeholder: string;
  required?: boolean;
}

const OAUTH_FIELDS: ApiKeyField[] = [
  {
    key: "google_client_id",
    label: "Google Client ID",
    description: "For Google Calendar integration and Google OAuth login",
    placeholder: "xxxx.apps.googleusercontent.com",
  },
  {
    key: "google_client_secret",
    label: "Google Client Secret",
    description: "The client secret from your Google Cloud Console project",
    placeholder: "GOCSPX-...",
  },
  {
    key: "microsoft_client_id",
    label: "Microsoft Client ID",
    description: "For Microsoft Calendar and Outlook integration",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  },
  {
    key: "microsoft_client_secret",
    label: "Microsoft Client Secret",
    description: "The client secret from your Azure AD app registration",
    placeholder: "Enter your Microsoft client secret",
  },
  {
    key: "microsoft_tenant_id",
    label: "Microsoft Tenant ID",
    description: "Use 'common' for multi-tenant or your specific Azure AD tenant ID",
    placeholder: "common",
  },
];

export default function SettingsPage() {
  const { user, loading: authLoading } = useAuth();

  // Profile
  const [name, setName] = useState("User");
  const [email, setEmail] = useState("user@example.com");
  const [timezone, setTimezone] = useState("America/New_York");
  const [language, setLanguage] = useState("en");

  // Calendar connection status
  const [googleConnected, setGoogleConnected] = useState(false);
  const [microsoftConnected, setMicrosoftConnected] = useState(false);

  // Settings state
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [storedKeys, setStoredKeys] = useState<Record<string, UserSettingResponse>>({});
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // UI state
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  // Set profile from auth user
  useEffect(() => {
    if (user) {
      setName(user.name || "User");
      setEmail(user.email || "user@example.com");
    }
  }, [user]);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.settings.list();
      const stored: Record<string, UserSettingResponse> = {};
      const values: Record<string, string> = {};

      for (const s of data.settings) {
        stored[s.key] = s;
        values[s.key] = s.has_value ? s.masked_value : "";
      }

      setStoredKeys(stored);
      setKeyValues(values);
    } catch {
      // If API is not available yet, use empty state
      console.warn("Settings API not available yet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Handle OAuth callback (code in URL query params)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    const redirectUri = `${window.location.origin}/settings`;

    (async () => {
      try {
        // Try Google first, then Microsoft
        try {
          await api.oauth.googleCallback(code, redirectUri);
          setGoogleConnected(true);
        } catch {
          await api.oauth.microsoftCallback(code, redirectUri);
          setMicrosoftConnected(true);
        }
      } catch {
        setError("OAuth callback failed. Please try connecting again.");
      } finally {
        // Clean up URL
        window.history.replaceState({}, "", "/settings");
      }
    })();
  }, []);

  const handleKeyChange = (key: string, value: string) => {
    setKeyValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeleteKey = async (key: string) => {
    try {
      setDeletingKey(key);
      await api.settings.delete(key);
      setKeyValues((prev) => ({ ...prev, [key]: "" }));
      setStoredKeys((prev) => {
        const next = { ...prev };
        if (next[key]) next[key] = { ...next[key], has_value: false, masked_value: "" };
        return next;
      });
    } catch {
      setError(`Failed to delete ${key}`);
    } finally {
      setDeletingKey(null);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      // Collect all changed settings (non-empty, non-masked values)
      const settings: { key: string; value: string }[] = [];
      for (const [key, value] of Object.entries(keyValues)) {
        if (value && !isMasked(value)) {
          settings.push({ key, value });
        }
      }

      if (settings.length > 0) {
        await api.settings.upsert(settings);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);

      // Reload to get updated masked values
      await loadSettings();
    } catch {
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const isMasked = (value: string) => {
    return value.length > 0 && [...value].every((c) => c === "\u2022");
  };

  const getKeyStatus = (key: string): "configured" | "empty" | "modified" => {
    const stored = storedKeys[key];
    const current = keyValues[key] || "";

    if (current && !isMasked(current) && current !== (stored?.masked_value || "")) {
      return "modified";
    }
    if (stored?.has_value) return "configured";
    return "empty";
  };

  const renderKeyField = (field: ApiKeyField) => {
    const status = getKeyStatus(field.key);
    const isVisible = visibleKeys.has(field.key);
    const currentValue = keyValues[field.key] || "";

    return (
      <div key={field.key} className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">{field.label}</label>
            {field.required && (
              <Badge variant="outline" className="text-xs">Required</Badge>
            )}
            {status === "configured" && (
              <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs">
                <Check className="mr-1 h-3 w-3" />
                Configured
              </Badge>
            )}
            {status === "modified" && (
              <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs">
                Modified
              </Badge>
            )}
            {status === "empty" && field.required && (
              <Badge className="bg-red-500/10 text-red-500 border-red-500/20 text-xs">
                <AlertCircle className="mr-1 h-3 w-3" />
                Not Set
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleVisibility(field.key)}
              title={isVisible ? "Hide value" : "Show value"}
            >
              {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            {storedKeys[field.key]?.has_value && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-600"
                onClick={() => handleDeleteKey(field.key)}
                disabled={deletingKey === field.key}
                title="Delete this key"
              >
                {deletingKey === field.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
        <div className="relative">
          <Input
            type={isVisible ? "text" : "password"}
            placeholder={field.placeholder}
            value={currentValue}
            onChange={(e) => handleKeyChange(field.key, e.target.value)}
            onFocus={() => {
              // Clear masked value on focus so user can type new value
              if (isMasked(currentValue)) {
                handleKeyChange(field.key, "");
              }
            }}
            className="pr-10 font-mono text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground">{field.description}</p>
      </div>
    );
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account, integrations, and preferences
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-red-500 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Profile Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>
            Your personal information and preferences
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarFallback className="text-lg">
                {name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Button variant="outline" size="sm">Change Avatar</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Timezone</label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="America/New_York">Eastern Time (US & Canada)</SelectItem>
                <SelectItem value="America/Chicago">Central Time (US & Canada)</SelectItem>
                <SelectItem value="America/Denver">Mountain Time (US & Canada)</SelectItem>
                <SelectItem value="America/Los_Angeles">Pacific Time (US & Canada)</SelectItem>
                <SelectItem value="Europe/London">London</SelectItem>
                <SelectItem value="Europe/Paris">Paris</SelectItem>
                <SelectItem value="Europe/Berlin">Berlin</SelectItem>
                <SelectItem value="Asia/Tokyo">Tokyo</SelectItem>
                <SelectItem value="Asia/Kolkata">Mumbai</SelectItem>
                <SelectItem value="Australia/Sydney">Sydney</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Credits */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            <CardTitle>Credits</CardTitle>
          </div>
          <CardDescription>
            Your AI processing credit balance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-[hsl(var(--border))] p-4 text-center">
              <p className="text-sm text-muted-foreground">Current Balance</p>
              <p className="text-3xl font-bold mt-1">
                {user?.credit_balance?.toLocaleString() ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-[hsl(var(--border))] p-4 text-center">
              <p className="text-sm text-muted-foreground">Lifetime Credits Used</p>
              <p className="text-3xl font-bold mt-1">
                {((user?.lifetime_credits ?? 0) - (user?.credit_balance ?? 0)).toLocaleString()}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Credits are managed by your administrator
          </p>
        </CardContent>
      </Card>

      {/* OAuth Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            <CardTitle>OAuth & Calendar Configuration</CardTitle>
          </div>
          <CardDescription>
            Configure OAuth credentials for Google and Microsoft integrations.
            These are also encrypted in the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {OAUTH_FIELDS.map(renderKeyField)}

          <div className="mt-6 space-y-3">
            <p className="text-sm font-medium">Connection Status</p>
            <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] p-4">
              <div className="flex items-center gap-3">
                <svg className="h-8 w-8" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <div>
                  <p className="font-medium">Google Calendar</p>
                  <p className="text-xs text-muted-foreground">Sync your Google Calendar events</p>
                </div>
              </div>
              {googleConnected ? (
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                    <Check className="mr-1 h-3 w-3" /> Connected
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => setGoogleConnected(false)}>Disconnect</Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const redirectUri = `${window.location.origin}/settings`;
                      const { url } = await api.oauth.googleUrl(redirectUri);
                      window.location.href = url;
                    } catch {
                      setError("Failed to start Google OAuth. Ensure Google client credentials are configured.");
                    }
                  }}
                  disabled={!storedKeys["google_client_id"]?.has_value}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {storedKeys["google_client_id"]?.has_value ? "Connect" : "Set keys first"}
                </Button>
              )}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] p-4">
              <div className="flex items-center gap-3">
                <svg className="h-8 w-8" viewBox="0 0 24 24">
                  <path d="M11.4 24H0V12.6h11.4V24z" fill="#F1511B" />
                  <path d="M24 24H12.6V12.6H24V24z" fill="#80CC28" />
                  <path d="M11.4 11.4H0V0h11.4v11.4z" fill="#00ADEF" />
                  <path d="M24 11.4H12.6V0H24v11.4z" fill="#FBBC09" />
                </svg>
                <div>
                  <p className="font-medium">Microsoft Outlook</p>
                  <p className="text-xs text-muted-foreground">Sync your Outlook calendar events</p>
                </div>
              </div>
              {microsoftConnected ? (
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                    <Check className="mr-1 h-3 w-3" /> Connected
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => setMicrosoftConnected(false)}>Disconnect</Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const redirectUri = `${window.location.origin}/settings`;
                      const { url } = await api.oauth.microsoftUrl(redirectUri);
                      window.location.href = url;
                    } catch {
                      setError("Failed to start Microsoft OAuth. Ensure Microsoft client credentials are configured.");
                    }
                  }}
                  disabled={!storedKeys["microsoft_client_id"]?.has_value}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {storedKeys["microsoft_client_id"]?.has_value ? "Connect" : "Set keys first"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Languages className="h-5 w-5" />
            <CardTitle>Language</CardTitle>
          </div>
          <CardDescription>
            Set your preferred language for transcription and summaries
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="es">Spanish</SelectItem>
              <SelectItem value="fr">French</SelectItem>
              <SelectItem value="de">German</SelectItem>
              <SelectItem value="pt">Portuguese</SelectItem>
              <SelectItem value="ja">Japanese</SelectItem>
              <SelectItem value="ko">Korean</SelectItem>
              <SelectItem value="zh">Chinese (Mandarin)</SelectItem>
              <SelectItem value="hi">Hindi</SelectItem>
              <SelectItem value="ar">Arabic</SelectItem>
              <SelectItem value="multi">Auto-detect (multilingual)</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <CardTitle>Notifications</CardTitle>
          </div>
          <CardDescription>
            Configure how you receive notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Meeting Transcription Complete", desc: "Get notified when a meeting transcription is ready", defaultChecked: true },
            { label: "New Action Items", desc: "Get notified when action items are assigned to you", defaultChecked: true },
            { label: "Task Due Reminders", desc: "Receive reminders for upcoming task deadlines", defaultChecked: true },
            { label: "Weekly Summary", desc: "Receive a weekly digest of your meetings and tasks", defaultChecked: false },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.desc}</p>
              </div>
              <input type="checkbox" defaultChecked={item.defaultChecked} className="h-4 w-4 rounded border-gray-300" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center justify-between pb-8">
        <p className="text-xs text-muted-foreground">
          <Shield className="inline h-3 w-3 mr-1" />
          All sensitive data is encrypted at rest with AES-256
        </p>
        <Button onClick={handleSave} disabled={saving} className="min-w-[140px]">
          {saving ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
          ) : saved ? (
            <><Check className="mr-2 h-4 w-4" /> Saved</>
          ) : (
            "Save All Changes"
          )}
        </Button>
      </div>
    </div>
  );
}
