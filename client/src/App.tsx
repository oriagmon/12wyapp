import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { MotionProvider } from './context/MotionProvider';
import { AuthCard } from './components/AuthCard';
import { readReturnTarget } from './lib/returnTarget';
import { TopBar } from './components/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { readAndClearResetTokenFromUrl } from './lib/resetToken';
import { LocaleProvider, useTranslation, type Locale } from './i18n';
import { persistLocalePreference } from './lib/localePreference';

function AppContent() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Runs once, on mount, regardless of auth state — this is deliberately *not* gated behind
  // `!user` below: a currently-logged-in user who opens their own reset link must still see
  // the reset UI and a cleaned-up address bar, not the Dashboard with the token silently
  // ignored.
  useEffect(() => {
    const token = readAndClearResetTokenFromUrl();
    if (token) setResetToken(token);
  }, []);

  if (resetToken) {
    return (
      <AuthCard initialMode="reset" resetToken={resetToken} onResetHandled={() => setResetToken(null)} />
    );
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {t('common.loading')}
      </div>
    );
  }

  if (!user) {
    return <AuthCard />;
  }

  // Arriving here already signed in — from the gym tracker's "sign in" link, say, when the
  // session cookie was valid all along — should still hand people back rather than stranding
  // them on the dashboard they did not ask for.
  const returnTo = readReturnTarget();
  if (returnTo) {
    window.location.replace(returnTo);
    return null;
  }

  return (
    <>
      <TopBar />
      <DashboardPage key={user.id} />
    </>
  );
}

export function App() {
  return (
    <LocaleProvider onLocaleChange={persistLocalePreference}>
      <AuthProvider>
        <ThemeProvider>
          <MotionProvider>
            <AppContent />
          </MotionProvider>
        </ThemeProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
