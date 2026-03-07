"use client";

import { useState, useEffect, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  auth_provider: string;
  credit_balance?: number;
  lifetime_credits?: number;
  is_admin?: boolean;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/me`, {
        credentials: "include",
      });

      if (res.ok) {
        const user = await res.json();
        setState({ user, loading: false, error: null });
        return;
      }

      if (res.status === 401) {
        const refreshRes = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setState({ user: data.user, loading: false, error: null });
          return;
        }
      }

      setState({ user: null, loading: false, error: null });
    } catch {
      setState({ user: null, loading: false, error: "Failed to connect to server" });
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Clear cookies even if request fails
    }
    setState({ user: null, loading: false, error: null });
    window.location.href = "/login";
  }, []);

  return {
    user: state.user,
    loading: state.loading,
    error: state.error,
    isAuthenticated: !!state.user,
    logout,
    refreshUser: fetchUser,
  };
}
