import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { MotionProvider } from './context/MotionProvider';
import { AuthCard } from './components/AuthCard';
import { TopBar } from './components/TopBar';
import { DashboardPage } from './pages/DashboardPage';
import { readAndClearResetTokenFromUrl } from './lib/resetToken';

function AppContent() {
  const { user, loading } = useAuth();
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
        טוען...
      </div>
    );
  }

  if (!user) {
    return <AuthCard />;
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
    <AuthProvider>
      <ThemeProvider>
        <MotionProvider>
          <AppContent />
        </MotionProvider>
      </ThemeProvider>
    </AuthProvider>
  );
}
