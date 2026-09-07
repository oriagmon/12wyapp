import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * Profile-safe shape shared by /auth/register, /auth/login, /auth/me, and the whole
 * /api/profile surface (see server/src/lib/userProfile.ts) — one serializer on the backend,
 * one type here, so TopBar/ProfilePage/DashboardPage never need a second fetch just to learn
 * displayName/avatar/successStreak.
 */
export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  bio: string;
  hasAvatar: boolean;
  avatarVersion: number;
  successStreak: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Re-fetches /auth/me and updates `user` in place — call after any profile/avatar/password
   *  mutation so TopBar and every other consumer reflect the change immediately, with no
   *  full-page reload. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AuthUser>('/auth/me')
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const u = await api.post<AuthUser>('/auth/login', { email, password });
      setUser(u);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'שגיאה בהתחברות');
      throw e;
    }
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const u = await api.post<AuthUser>('/auth/register', { email, password });
      setUser(u);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'שגיאה בהרשמה');
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.get<AuthUser>('/auth/me');
      setUser(u);
    } catch {
      // Best-effort resync only (called opportunistically after mutations, e.g. to pick up a
      // changed success streak) — a transient failure here must never force the user into a
      // logged-out state. The real auth check happens on mount / login / register above.
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, register, logout, clearError, refreshUser }),
    [user, loading, error, login, register, logout, clearError, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
