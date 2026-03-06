"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

const STORAGE_KEY = "ai-notetaker-dev-token";

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({
    token: null,
    user: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function authenticate() {
      // Check localStorage first
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed.token && parsed.user) {
            // Verify token is still valid
            try {
              await api.auth.me(parsed.token);
              if (!cancelled) {
                setState({ token: parsed.token, user: parsed.user, loading: false, error: null });
                return;
              }
            } catch {
              // Token expired, fall through to re-login
              localStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      // Device login
      try {
        const data = await api.auth.deviceLogin();
        const authData = { token: data.access_token, user: data.user };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(authData));
        if (!cancelled) {
          setState({ token: data.access_token, user: data.user, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ token: null, user: null, loading: false, error: "Failed to authenticate" });
        }
      }
    }

    authenticate();
    return () => { cancelled = true; };
  }, []);

  return state;
}
