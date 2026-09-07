import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_CUSTOM_MESSAGE_LENGTH, useBroostUnread, type Broost } from '../hooks/useBroosts';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import styles from './BroostNotificationBell.module.css';
import { useTranslation } from '../i18n';

/**
 * TopBar unread BROOST badge + a small notification popover. Refreshes on mount, on window
 * focus, via modest polling, and whenever any other BROOST hook instance publishes a change
 * (see useBroosts.ts / lib/broostBus.ts) — no websockets/SSE, no real-time infrastructure.
 * Intentionally decoupled from DashboardPage's own tab-switching state (they are rendered as
 * siblings in App.tsx) — replies stay inline; the full history lives in the BROOST tab.
 */
export function BroostNotificationBell() {
  const { t } = useTranslation();
  const { count, recent, loadStatus, loadError, markRead, markAllRead, reply } = useBroostUnread();
  const [open, setOpen] = useState(false);
  const actionStatus = useAsyncStatus();
  const replyStatus = useAsyncStatus();
  const [replyTarget, setReplyTarget] = useState<Broost | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyAttempted, setReplyAttempted] = useState(false);
  const [replySuccess, setReplySuccess] = useState<string | null>(null);
  const replyingRef = useRef(false);
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      if (!buttonRef.current || !popoverRef.current) return;
      const anchor = buttonRef.current.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(320, viewportWidth - 24);
      const below = Math.max(0, viewportHeight - anchor.bottom - 20);
      const above = Math.max(0, anchor.top - 20);
      const upwards = below < 180 && above > below;
      const maxHeight = Math.min(360, upwards ? above : below);
      const height = Math.min(popoverRef.current.scrollHeight, maxHeight);
      const next = {
        width,
        maxHeight,
        left: Math.max(12, Math.min(anchor.right - width, viewportWidth - width - 12)),
        top: upwards ? Math.max(12, anchor.top - height - 8) : anchor.bottom + 8,
      };
      setPosition((current) => current && current.left === next.left && current.top === next.top &&
        current.width === next.width && current.maxHeight === next.maxHeight ? current : next);
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [open, recent.length, loadStatus, replyTarget?.id]);

  useEffect(() => {
    if (open && replyTarget) replyInputRef.current?.focus();
  }, [open, replyTarget?.id]);

  // Closes the popover on Escape or an outside click — kept minimal (no focus trap) but
  // enough to avoid a popover that only a mouse-click on the bell itself can dismiss.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (e: MouseEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target) && !popoverRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const handleMarkRead = (id: number) => actionStatus.run(() => markRead(id));
  const handleMarkAllRead = () => actionStatus.run(() => markAllRead());
  const busy = actionStatus.status === 'saving' || replyStatus.status === 'saving';
  // Keep an active draft visible even if another device marks its notification read.
  const visibleItems = replyTarget && !recent.some((item) => item.id === replyTarget.id)
    ? [...recent, replyTarget]
    : recent;

  const handleReply = async () => {
    if (replyingRef.current || !replyTarget) return;
    const message = replyDraft.trim();
    if (!message || message.length > MAX_CUSTOM_MESSAGE_LENGTH) {
      setReplyError(t('social.broost.replyLength', { max: MAX_CUSTOM_MESSAGE_LENGTH }));
      return;
    }
    const target = replyTarget;
    setReplyError(null);
    setReplyAttempted(true);
    replyingRef.current = true;
    try {
      await replyStatus.run(async () => {
        await reply(target.id, message);
        setReplyDraft('');
        setReplyTarget(null);
        setReplySuccess(t('social.broost.replySent', { name: target.sender.label }));
      });
    } finally {
      replyingRef.current = false;
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`btn btn-ghost btn-sm ${styles.bellButton}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-label={count > 0 ? t('social.broost.bellUnread', { count }) : t('social.broost.bellEmpty')}
      >
        💪{count > 0 && <span className={styles.badge}>{count}</span>}
      </button>
      {open && createPortal(
        <div ref={popoverRef} id={popoverId} className={styles.popover} role="dialog" aria-label={t('social.broost.popoverLabel')}
          style={{ ...position, visibility: position ? undefined : 'hidden' }}>
          {loadStatus === 'loading' && <p className={styles.emptyText}>{t('common.loading')}</p>}
          {loadStatus === 'error' && (
            <p className={styles.errorText} role="alert">
              {loadError ?? t('social.broost.loadError')}
            </p>
          )}
          {loadStatus === 'ready' && visibleItems.length === 0 && <p className={styles.emptyText}>{t('social.broost.empty')}</p>}
          {visibleItems.length > 0 && (
            <ul className={styles.list}>
              {visibleItems.map((item) => (
                <li key={item.id} className={styles.item}>
                  <p className={styles.senderLabel}>{item.sender.label}</p>
                  <p className={styles.message}>{item.message}</p>
                  <div className={styles.itemActions}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || replyTarget?.id === item.id} onClick={() => handleMarkRead(item.id)}>
                      {t('social.broost.markRead')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy || (replyTarget !== null && replyTarget.id !== item.id)}
                      aria-expanded={replyTarget?.id === item.id}
                      aria-controls={replyTarget?.id === item.id ? `${popoverId}-reply` : undefined}
                      onClick={() => {
                        setReplyTarget(item);
                        setReplyError(null);
                        setReplyAttempted(false);
                        setReplySuccess(null);
                        replyInputRef.current?.focus();
                      }}
                    >
                      {t('social.broost.reply')}
                    </button>
                  </div>
                  {replyTarget?.id === item.id && (
                    <form
                      id={`${popoverId}-reply`}
                      className={styles.replyForm}
                      aria-busy={replyStatus.status === 'saving'}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleReply();
                      }}
                    >
                      <label htmlFor={`${popoverId}-reply-text`}>{t('social.broost.replyTo', { name: item.sender.label })}</label>
                      <textarea
                        id={`${popoverId}-reply-text`}
                        ref={replyInputRef}
                        className={styles.replyInput}
                        rows={3}
                        maxLength={MAX_CUSTOM_MESSAGE_LENGTH}
                        disabled={busy}
                        value={replyDraft}
                        onChange={(event) => {
                          setReplyDraft(event.target.value);
                          setReplyError(null);
                          setReplyAttempted(false);
                        }}
                        placeholder={t('social.broost.replyPlaceholder')}
                      />
                      {replyError && <p className={styles.errorText} role="alert">{replyError}</p>}
                      <div className={styles.itemActions}>
                        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !replyDraft.trim()}>
                          {replyStatus.status === 'saving' ? t('social.broost.sending') : t('social.broost.send')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setReplyTarget(null);
                            setReplyDraft('');
                            setReplyError(null);
                            setReplyAttempted(false);
                            buttonRef.current?.focus();
                          }}
                        >
                          {t('common.action.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {count > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy || replyTarget !== null} onClick={handleMarkAllRead}>
              {t('social.broost.markAllRead')}
            </button>
          )}
          <StatusBadge status={actionStatus.status} error={actionStatus.error} />
          {replyAttempted && replyStatus.status === 'error' && <p className={styles.errorText} role="alert">{replyStatus.error}</p>}
          {replySuccess && <p className={styles.hint} role="status">{replySuccess}</p>}
          <p className={styles.hint}>{t('social.broost.historyHint')}</p>
        </div>,
        document.body,
      )}
    </div>
  );
}
