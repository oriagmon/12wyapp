import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useGlobalSaveStatus } from '../hooks/useGlobalSaveStatus';
import { StatusBadge } from './StatusBadge';
import { Avatar } from './Avatar';
import { BroostNotificationBell } from './BroostNotificationBell';
import styles from './TopBar.module.css';

export function TopBar() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const saveStatus = useGlobalSaveStatus();

  return (
    <header className={styles.wrap}>
      <a className="skip-link" href="#main-content">דילוג לתוכן הראשי</a>
      <div className={styles.side}>
        {user && (
          <span className={styles.identity}>
            <Avatar
              userId={user.id}
              displayName={user.displayName}
              email={user.email}
              hasAvatar={user.hasAvatar}
              avatarVersion={user.avatarVersion}
              successStreak={user.successStreak}
              size="sm"
            />
            <span className={styles.email}>{user.displayName || user.email}</span>
          </span>
        )}
        {user && <BroostNotificationBell />}
        <StatusBadge status={saveStatus.status} error={saveStatus.error} />
      </div>
      <div className={styles.brand}><bdi dir="ltr">12wyapp</bdi></div>
      <div className={`${styles.side} ${styles.right}`}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => toggleTheme()}
          aria-label={theme === 'dark' ? 'עבור למצב בהיר' : 'עבור למצב כהה'}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span className={styles.themeLabel}>{theme === 'dark' ? 'בהיר' : 'כהה'}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
          התנתקות
        </button>
      </div>
    </header>
  );
}
