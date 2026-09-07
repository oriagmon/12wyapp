import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { WamCelebration } from '../lib/types';
import { Avatar } from './Avatar';
import styles from './WamCelebrationOverlay.module.css';
import { useTranslation, type Translator } from '../i18n';

/** Bounded, purely decorative particle count — never grows with anything user-controlled, and
 *  deliberately small so the DOM/animation cost stays cheap even on low-end mobile devices. */
const PARTICLE_COUNT = 10;

function titleFor(celebration: WamCelebration, t: Translator): string {
  switch (celebration.type) {
    case 'duo-success':
      return t('wams.celebration.bothHit');
    case 'spotlight':
      return celebration.winner.score >= 85
        ? t('wams.celebration.greatWeek')
        : t('wams.celebration.forwardTogether');
    case 'tie':
      return t('wams.celebration.tie');
    case 'completion':
      return t('wams.celebration.done');
  }
}

/**
 * Focus-safe celebration modal shown once, right after a successful WAM completion (see
 * `useWamDetail().complete()` / `WamsTab`) — never on a mere reload of an already-complete WAM.
 * Four variants driven entirely by the server-computed `celebration` descriptor; this
 * component holds no scoring/streak logic of its own, only presentation.
 *
 * Accessibility: `role="dialog"` + `aria-modal` + a descriptive `aria-label`; the message body
 * is `role="status"`/`aria-live="polite"` so screen readers announce it once on mount. Escape,
 * the visible close button, and a backdrop click all dismiss it; backdrop dismissal is
 * deliberately disarmed for a brief moment after mount so the very click that triggered
 * completion (which can otherwise land on the freshly-mounted backdrop in the same event loop
 * turn) can never instantly close it. Focus moves to the close button on open and is restored
 * to whatever was focused beforehand on close/unmount.
 */
export function WamCelebrationOverlay({ celebration, onClose }: { celebration: WamCelebration; onClose: () => void }) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [canDismissViaBackdrop, setCanDismissViaBackdrop] = useState(false);

  useEffect(() => {
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const armBackdrop = window.setTimeout(() => setCanDismissViaBackdrop(true), 400);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
      // Close is the only interactive control in this informational dialog.
      if (e.key === 'Tab') {
        e.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    const containFocus = (e: FocusEvent) => {
      if (e.target instanceof Node && !dialogRef.current?.contains(e.target)) closeButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', containFocus);
    return () => {
      window.clearTimeout(armBackdrop);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      const returnTarget = previouslyFocused.current?.isConnected
        ? previouslyFocused.current
        : document.querySelector<HTMLElement>('[data-wam-return-focus]');
      returnTarget?.focus();
    };
  }, []);

  const handleBackdropClick = () => {
    if (canDismissViaBackdrop) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${styles[celebration.type]}`}
        role="dialog"
        aria-modal="true"
        aria-label={titleFor(celebration, t)}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeButtonRef} type="button" className={styles.closeButton} onClick={onClose} aria-label={t('wams.celebration.close')}>
          ✕
        </button>
        <Particles variant={celebration.type} />
        <div className={styles.content} role="status" aria-live="polite">
          <h3 className={styles.title}>{titleFor(celebration, t)}</h3>
          <CelebrationBody celebration={celebration} />
        </div>
      </div>
    </div>
  );
}

function Particles({ variant }: { variant: WamCelebration['type'] }) {
  if (variant === 'completion') return null;
  return (
    <div className={styles.particles} aria-hidden="true">
      {Array.from({ length: PARTICLE_COUNT }, (_, i) => (
        <span key={i} className={styles.particle} style={{ '--i': i } as CSSProperties} />
      ))}
    </div>
  );
}

function CelebrationBody({ celebration }: { celebration: WamCelebration }) {
  const { t } = useTranslation();
  if (celebration.type === 'duo-success') {
    const [a, b] = celebration.participants;
    return (
      <>
        <div className={styles.pairRow}>
          <div className={styles.participant}>
            <Avatar userId={a.userId} displayName={a.displayName} email={a.email} hasAvatar={a.hasAvatar} avatarVersion={a.avatarVersion} size="lg" />
            <span className={styles.name}>{a.displayName.trim() || a.email}</span>
            <span className={styles.score}>{a.score}%</span>
          </div>
          <span className={styles.pairHeart} aria-hidden="true">
            💛
          </span>
          <div className={styles.participant}>
            <Avatar userId={b.userId} displayName={b.displayName} email={b.email} hasAvatar={b.hasAvatar} avatarVersion={b.avatarVersion} size="lg" />
            <span className={styles.name}>{b.displayName.trim() || b.email}</span>
            <span className={styles.score}>{b.score}%</span>
          </div>
        </div>
        <p className={styles.message}>{t('wams.celebration.bothMessage')}</p>
        <p className={styles.streak}>
          {t('wams.celebration.duoStreak')}
          <span className={styles.streakNumber}>{celebration.currentStreak}</span>
        </p>
      </>
    );
  }

  if (celebration.type === 'spotlight') {
    const { winner, other } = celebration;
    return (
      <>
        <div className={styles.spotlightRow}>
          <Avatar
            userId={winner.userId}
            displayName={winner.displayName}
            email={winner.email}
            hasAvatar={winner.hasAvatar}
            avatarVersion={winner.avatarVersion}
            size="lg"
          />
          <span className={styles.score}>{winner.score}%</span>
        </div>
        <p className={styles.message}>
          {t('wams.celebration.winner', {
            name: winner.displayName.trim() || winner.email,
            winner: winner.score,
            other: other.score,
          })}
          {' '}
          {winner.score >= 85
            ? t('wams.celebration.winnerAbove')
            : t('wams.celebration.winnerBelow')}
        </p>
      </>
    );
  }

  if (celebration.type === 'tie') {
    const [a, b] = celebration.participants;
    return (
      <>
        <div className={styles.pairRow}>
          <div className={styles.participant}>
            <Avatar userId={a.userId} displayName={a.displayName} email={a.email} hasAvatar={a.hasAvatar} avatarVersion={a.avatarVersion} size="lg" />
            <span className={styles.name}>{a.displayName.trim() || a.email}</span>
            <span className={styles.score}>{a.score}%</span>
          </div>
          <span className={styles.pairHeart} aria-hidden="true">
            🤝
          </span>
          <div className={styles.participant}>
            <Avatar userId={b.userId} displayName={b.displayName} email={b.email} hasAvatar={b.hasAvatar} avatarVersion={b.avatarVersion} size="lg" />
            <span className={styles.name}>{b.displayName.trim() || b.email}</span>
            <span className={styles.score}>{b.score}%</span>
          </div>
        </div>
        <p className={styles.message}>{t('wams.celebration.tieMessage')}</p>
      </>
    );
  }

  return <p className={styles.message}>{t('wams.celebration.doneMessage')}</p>;
}
