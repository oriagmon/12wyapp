import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useTheme } from './ThemeContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Confetti } from '../components/Confetti';
import {
  readCelebrationSession, selectCelebration, subscribeSuccess, writeCelebrationSession,
  type CelebrationChoice,
} from '../lib/celebrations';
import styles from '../components/SurpriseCelebration.module.css';

const hasModal = () => Boolean(document.querySelector('[aria-modal="true"], dialog[open]'));

export function CelebrationProvider({
  accountId, children, random = Math.random, now = Date.now,
}: {
  accountId: number | null;
  children: ReactNode;
  random?: () => number;
  now?: () => number;
}) {
  const reduced = useReducedMotion();
  const [notice, setNotice] = useState<{ accountId: number; occurrenceId: string; choice: CelebrationChoice } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const activeAccount = useRef(accountId);
  activeAccount.current = accountId;

  useEffect(() => {
    setNotice(null);
    const clear = () => {
      clearTimeout(timer.current);
      setNotice(null);
    };
    if (accountId === null) return clear;
    let session = readCelebrationSession(accountId);
    const unsubscribe = subscribeSuccess((event) => {
      if (activeAccount.current !== accountId) return;
      const result = selectCelebration(event, session, {
        accountId, now: now(), random: random(),
        visible: !document.hidden && !hasModal(),
      });
      if (result.state === session) return;
      session = result.state;
      writeCelebrationSession(accountId, session);
      if (!result.choice) return;
      clearTimeout(timer.current);
      setNotice({ accountId, occurrenceId: event.occurrenceId, choice: result.choice });
      timer.current = setTimeout(clear, 4400);
    });
    const onVisibility = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', onVisibility);
    // Opening a WAM/evidence dialog dismisses a current toast; nothing is queued for later.
    const observer = new MutationObserver(() => { if (hasModal()) clear(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'open'] });
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      clearTimeout(timer.current);
    };
  }, [accountId, random, now]);

  const choice = notice?.accountId === accountId ? notice.choice : null;
  return (
    <>
      {children}
      {choice?.fireworks && !reduced && <Confetti key={notice?.occurrenceId} active />}
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="true">
        {choice && (
          <div className={styles.toast} data-reduced-motion={reduced || undefined}>
            {!reduced && (
              <div className={styles.particles} aria-hidden="true" data-testid="celebration-particles">
                {Array.from({ length: 16 }, (_, index) => (
                  <i key={index} style={{
                    '--angle': `${index * 22.5}deg`,
                    '--distance': `${48 + (index % 3) * 18}px`,
                    '--delay': `${(index % 4) * 25}ms`,
                  } as CSSProperties} />
                ))}
              </div>
            )}
            <span className={styles.symbol} aria-hidden="true">{choice.symbol}</span>
            <div><strong>{choice.title}</strong><p>{choice.detail}</p></div>
          </div>
        )}
      </div>
    </>
  );
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  useEffect(() => {
    const sync = () => {
      const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (color) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [theme]);
  return <CelebrationProvider accountId={user?.id ?? null}>{children}</CelebrationProvider>;
}
