import { useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../lib/api';
import { useAuthPolicy } from '../hooks/useAuthPolicy';
import styles from './AuthCard.module.css';

type Mode = 'login' | 'register' | 'forgot' | 'reset';

interface AuthCardProps {
  /** Initial mode to render in. Only affects the very first render — later prop changes do
   *  not force a mode switch (the component owns `mode` itself from then on). Defaults to
   *  'login'. Pass 'reset' together with `resetToken` when a reset link was detected. */
  initialMode?: Mode;
  /** The plaintext reset token captured (and already stripped from the URL) by the parent —
   *  see lib/resetToken.ts. Required when `initialMode` is 'reset'. AuthCard never reads the
   *  URL itself; the parent (App.tsx) owns that concern so this component stays a plain,
   *  URL-agnostic form. */
  resetToken?: string | null;
  /** Called once the reset flow concludes — either a successful reset, or the user manually
   *  navigating back to the login screen — so the parent can clear its own captured-token
   *  state and resume its normal (loading/logged-in/logged-out) routing. */
  onResetHandled?: () => void;
}

export function AuthCard({ initialMode = 'login', resetToken = null, onResetHandled }: AuthCardProps) {
  const { login, register, logout, error, clearError } = useAuth();
  const policy = useAuthPolicy();
  const [requestedMode, setMode] = useState<Mode>(initialMode);
  const mode = requestedMode === 'register' && !policy.registrationOpen ? 'login' : requestedMode;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);

  const [forgotStatus, setForgotStatus] = useState<'idle' | 'submitting' | 'sent'>('idle');
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetStatus, setResetStatus] = useState<'idle' | 'submitting'>('idle');
  const [resetError, setResetError] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    if (mode === 'reset' && next !== 'reset') {
      onResetHandled?.();
    }
    setMode(next);
    clearError();
    setLoginNotice(null);
    setForgotStatus('idle');
    setForgotError(null);
    setResetError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register' && policy.registrationOpen) {
        await register(email, password);
      }
    } catch {
      // error already surfaced via context state
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setForgotError(null);
    setForgotStatus('submitting');
    try {
      // The server always returns the same generic message regardless of whether the
      // account exists — this UI just displays whatever it says, never inferring anything
      // beyond that from the (always-200) response.
      const res = await api.post<{ message: string }>('/auth/forgot-password', { email });
      setForgotMessage(res.message);
      setForgotStatus('sent');
    } catch (e) {
      // A genuine network/server error (never an "account not found" — the endpoint never
      // reports that) — still safe to surface as-is.
      setForgotError(e instanceof ApiError ? e.message : 'שגיאה בשליחת הבקשה');
      setForgotStatus('idle');
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setResetError(null);
    if (newPassword !== confirmPassword) {
      setResetError('אימות הסיסמה החדשה אינו תואם');
      return;
    }
    setResetStatus('submitting');
    try {
      await api.post('/auth/reset-password', { token: resetToken, newPassword });
      setNewPassword('');
      setConfirmPassword('');
      // A successful reset revokes every session for this account server-side — including
      // the caller's own, if they happened to still be logged in when they followed their
      // own reset link. Clearing the client-side auth state here (logout() clears the cookie
      // too, even though the underlying session row is already gone) guarantees the login
      // screen reliably appears next, with no stale AuthContext user left behind.
      await logout();
      setMode('login');
      setLoginNotice('הסיסמה אופסה בהצלחה — ניתן להתחבר כעת עם הסיסמה החדשה.');
      onResetHandled?.();
    } catch (e) {
      setResetError(e instanceof ApiError ? e.message : 'שגיאה באיפוס הסיסמה');
    } finally {
      setResetStatus('idle');
    }
  };

  return (
    <div className={styles.authScreen}>
      <div className={`card ${styles.authCard}`}>
        <h1 className={styles.authTitle}><bdi dir="ltr">12wyapp</bdi></h1>
        <p className={styles.authSubtitle}>ניהול מחזורי ביצוע, מטרות וטקטיקות שבועיות</p>

        {(mode === 'login' || mode === 'register') && (
          <div className={styles.tabRow} role="tablist" aria-label="בחירת מצב התחברות">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={styles.tabButton}
              onClick={() => switchMode('login')}
            >
              התחברות
            </button>
            {policy.registrationOpen && (
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'register'}
                className={styles.tabButton}
                onClick={() => switchMode('register')}
              >
                הרשמה
              </button>
            )}
          </div>
        )}

        {(mode === 'login' || mode === 'register') && (
          <>
            {policy.status === 'loading' && <p role="status">בודק את מדיניות ההרשמה...</p>}
            {policy.status === 'error' && (
              <div className={styles.errorBox} role="alert">
                לא ניתן לבדוק אם ההרשמה פתוחה. אפשר לנסות שוב או לפנות למפעיל/ת המערכת.
                <button type="button" className={styles.linkButton} onClick={policy.retry}>ניסיון נוסף</button>
              </div>
            )}
            {policy.status === 'ready' && !policy.registrationOpen && (
              <p role="status">ההרשמה הציבורית סגורה. לקבלת גישה יש לפנות למפעיל/ת המערכת.</p>
            )}
            {mode === 'login' && loginNotice && (
              <div className={styles.successBox} role="status">
                {loginNotice}
              </div>
            )}
            {error && (
              <div className={styles.errorBox} role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <label htmlFor="email">אימייל</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="password">סיסמה</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button type="submit" className={`btn btn-primary ${styles.submitBtn}`} disabled={submitting}>
                {submitting ? 'רגע...' : mode === 'login' ? 'התחברות' : 'הרשמה'}
              </button>
            </form>
            {mode === 'login' && (
              <button type="button" className={styles.linkButton} onClick={() => switchMode('forgot')}>
                שכחת סיסמה?
              </button>
            )}
          </>
        )}

        {mode === 'forgot' && (
          <>
            <h2 className={styles.authSubtitle} style={{ margin: '0 0 16px', color: 'var(--text)' }}>
              איפוס סיסמה
            </h2>
            {forgotError && (
              <div className={styles.errorBox} role="alert">
                {forgotError}
              </div>
            )}
            {forgotStatus === 'sent' ? (
              <div className={styles.successBox} role="status">
                {forgotMessage}
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} noValidate>
                <div className={styles.field}>
                  <label htmlFor="forgot-email">אימייל</label>
                  <input
                    id="forgot-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className={`btn btn-primary ${styles.submitBtn}`}
                  disabled={forgotStatus === 'submitting'}
                >
                  {forgotStatus === 'submitting' ? 'שולח...' : 'שליחת קישור לאיפוס'}
                </button>
              </form>
            )}
            <button type="button" className={styles.linkButton} onClick={() => switchMode('login')}>
              חזרה להתחברות
            </button>
          </>
        )}

        {mode === 'reset' && (
          <>
            <h2 className={styles.authSubtitle} style={{ margin: '0 0 16px', color: 'var(--text)' }}>
              קביעת סיסמה חדשה
            </h2>
            {resetError && (
              <div className={styles.errorBox} role="alert">
                {resetError}
              </div>
            )}
            <form onSubmit={handleResetSubmit} noValidate>
              <div className={styles.field}>
                <label htmlFor="new-password">סיסמה חדשה</label>
                <input
                  id="new-password"
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="confirm-password">אימות סיסמה חדשה</label>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className={`btn btn-primary ${styles.submitBtn}`}
                disabled={resetStatus === 'submitting'}
              >
                {resetStatus === 'submitting' ? 'רגע...' : 'איפוס הסיסמה'}
              </button>
            </form>
            <button type="button" className={styles.linkButton} onClick={() => switchMode('login')}>
              חזרה להתחברות
            </button>
          </>
        )}
      </div>
    </div>
  );
}
