import { useEffect, useRef, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { useLocalAsyncStatus } from '../hooks/useLocalAsyncStatus';
import { Avatar } from '../components/Avatar';
import { StatusBadge } from '../components/StatusBadge';
import { ExecutionHeatmap } from '../components/ExecutionHeatmap';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import styles from './ProfilePage.module.css';

const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 500;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MiB
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Minimal Hebrew (RTL) profile page: avatar + success-streak chip, display name/bio, and a
 *  current/new/confirm password change form. Owner-only by construction — the whole
 *  /api/profile API is self-scoped from the session, so this page never takes a userId. */
export function ProfilePage() {
  const profileState = useProfile();
  const { profile, loadStatus, loadError } = profileState;

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.displayName, profile?.bio]);

  const saveStatus = useAsyncStatus();
  const avatarStatus = useAsyncStatus();
  // Local-only status (never published to TopBar's global indicator): a wrong-password error
  // here is sensitive and must not linger indefinitely in global chrome — see
  // useLocalAsyncStatus for why useAsyncStatus's global bus is wrong for this specific form.
  const passwordStatus = useLocalAsyncStatus();

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFormError, setPasswordFormError] = useState<string | null>(null);

  if (loadStatus === 'loading') {
    return <div className="card" style={{ padding: 24 }}>טוען פרופיל...</div>;
  }
  if (loadStatus === 'error' || !profile) {
    return (
      <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>
        {loadError ?? 'שגיאה בטעינת הפרופיל'}
      </div>
    );
  }

  function handleFileChosen(file: File | null) {
    setAvatarError(null);
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setAvatarError('ניתן להעלות תמונת PNG, JPEG או WebP בלבד');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('התמונה גדולה מדי — הגודל המרבי הוא 2MB');
      return;
    }
    avatarStatus.run(() => profileState.uploadAvatar(file));
  }

  function submitPasswordChange() {
    setPasswordFormError(null);
    if (newPassword !== confirmPassword) {
      setPasswordFormError('אימות הסיסמה החדשה אינו תואם');
      return;
    }
    passwordStatus.run(async () => {
      await profileState.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    });
  }

  return (
    <div className={styles.page}>
      <section className={`card ${styles.section}`}>
        <h2 className={styles.title}>הפרופיל שלי</h2>
        <div className={styles.avatarRow}>
          <Avatar
            userId={profile.id}
            displayName={profile.displayName}
            email={profile.email}
            hasAvatar={profile.hasAvatar}
            avatarVersion={profile.avatarVersion}
            successStreak={profile.successStreak}
            size="lg"
          />
          <div className={styles.avatarControls}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className={styles.hiddenFileInput}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                handleFileChosen(file);
                e.target.value = '';
              }}
              aria-label="בחירת תמונת פרופיל"
            />
            <div className={styles.avatarButtons}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>
                בחירת תמונה
              </button>
              {profile.hasAvatar && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => avatarStatus.run(() => profileState.removeAvatar())}
                >
                  הסרת תמונה
                </button>
              )}
              <StatusBadge status={avatarStatus.status} error={avatarStatus.error} />
            </div>
            {avatarError && <p className={styles.fieldError} role="alert">{avatarError}</p>}
            <p className={styles.streakExplainer}>
              התג המספרי ליד תמונת הפרופיל מציג את רצף ההצלחות האישי שלך — מספר השבועות הרצופים
              שבהם עמדת ביעד של 85% ומעלה.
            </p>
          </div>
        </div>
      </section>

      <ExecutionHeatmap userId={profile.id} />

      <section className={`card ${styles.section}`}>
        <h3 className={styles.subtitle}>פרטים אישיים</h3>
        <label className={styles.field}>
          <span className={styles.label}>שם תצוגה</span>
          <input
            type="text"
            value={displayName}
            maxLength={MAX_DISPLAY_NAME}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="השם שיוצג עבורך באפליקציה"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>ביוגרפיה</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={bio}
            maxLength={MAX_BIO}
            placeholder="כמה מילים על עצמך"
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setBio(e.target.value);
            }}
          />
        </label>
        <div className={styles.actionsRow}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={displayName.trim().length === 0}
            onClick={() => saveStatus.run(() => profileState.updateProfile({ displayName, bio }))}
          >
            שמירת פרטים
          </button>
          <StatusBadge status={saveStatus.status} error={saveStatus.error} />
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h3 className={styles.subtitle}>שינוי סיסמה</h3>
        <label className={styles.field}>
          <span className={styles.label}>סיסמה נוכחית</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>סיסמה חדשה</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>אימות סיסמה חדשה</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {passwordFormError && <p className={styles.fieldError} role="alert">{passwordFormError}</p>}
        <div className={styles.actionsRow}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={currentPassword.length === 0 || newPassword.length === 0 || confirmPassword.length === 0}
            onClick={submitPasswordChange}
          >
            עדכון סיסמה
          </button>
          <StatusBadge status={passwordStatus.status} error={passwordStatus.error} />
        </div>
        <p className={styles.note}>עדכון הסיסמה ינתק את כל שאר החיבורים הפעילים שלך, מלבד החיבור הנוכחי.</p>
      </section>
    </div>
  );
}
