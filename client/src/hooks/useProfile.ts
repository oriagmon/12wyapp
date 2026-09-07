import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { translateActive } from '../i18n';

export interface ProfileData {
  id: number;
  email: string;
  displayName: string;
  bio: string;
  hasAvatar: boolean;
  avatarVersion: number;
  successStreak: number;
}

export type ProfileLoadStatus = 'loading' | 'ready' | 'error';

/**
 * Loads and mutates the current user's own profile (display name, bio, avatar, password).
 * Every mutation also calls AuthContext's refreshUser() so TopBar (and anything else reading
 * the shared AuthUser) updates immediately, without a page reload.
 */
export function useProfile() {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loadStatus, setLoadStatus] = useState<ProfileLoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadStatus('loading');
    try {
      const data = await api.get<ProfileData>('/profile');
      setProfile(data);
      setLoadStatus('ready');
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : translateActive('common.load.profile'));
      setLoadStatus('error');
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const applyAndSync = useCallback(
    async (data: ProfileData) => {
      setProfile(data);
      await refreshUser();
      return data;
    },
    [refreshUser]
  );

  const updateProfile = useCallback(
    async (patch: { displayName?: string; bio?: string }) => {
      const data = await api.patch<ProfileData>('/profile', patch);
      return applyAndSync(data);
    },
    [applyAndSync]
  );

  const uploadAvatar = useCallback(
    async (file: File) => {
      const data = await api.putBinary<ProfileData>('/profile/avatar', file, file.type);
      return applyAndSync(data);
    },
    [applyAndSync]
  );

  const removeAvatar = useCallback(async () => {
    const data = await api.delete<ProfileData>('/profile/avatar');
    return applyAndSync(data);
  }, [applyAndSync]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.patch('/profile/password', { currentPassword, newPassword });
  }, []);

  return { profile, loadStatus, loadError, reload, updateProfile, uploadAvatar, removeAvatar, changePassword };
}
