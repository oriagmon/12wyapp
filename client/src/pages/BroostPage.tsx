import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MAX_CUSTOM_MESSAGE_LENGTH, useBroostHistory, useBroostPresets, type Broost } from '../hooks/useBroosts';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { publishSuccess } from '../lib/celebrations';
import type { PartnerInfo } from '../lib/types';
import { personLabel } from '../lib/people';
import styles from './BroostPage.module.css';
import { useTranslation, type Translator } from '../i18n';

// Colour only. These cards used to carry a title as well ("ריספקט 🫡" above the message "יש
// ביצועים ויש את זה. ריספקט 🫡"), which was just the message's own ending printed twice. The
// message *is* the content — it is exactly what gets sent — so it is all the card shows.
const PRESET_TONES: Record<string, string> = {
  great_job: 'accent',
  crushing_it: 'accent',
  keep_going: 'purple',
  proud_of_you: 'gold',
  daily_boost: 'gold',
  you_got_this: 'blue',
  king_queen: 'purple',
  sending_love: 'blue',
};

/** Initials-only rendering for a BROOST participant — deliberately never attempts to fetch an
 *  avatar image for a non-self user (see useBroosts.ts's BroostParticipant doc comment: the
 *  authenticated avatar route is self-only by design, so this is the safe choice, not a
 *  broken-image/privacy leak). */
function initialsFrom(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

const EMAIL_STATUS_KEY: Partial<Record<Broost['emailStatus'], string>> = {
  sent: 'social.broostPage.emailSent',
  failed: 'social.broostPage.emailFailed',
  pending: 'social.broostPage.emailPending',
  sending: 'social.broostPage.emailPending',
  cancelled: 'social.broostPage.emailCancelled',
};

/** Returns the status line for a "sent" item, distinguishing a retryable failure (still
 *  scheduled for an automatic retry) from a truly terminal one — never exposes the raw
 *  provider error or internal retry timestamp, only this derived, safe wording. */
function emailStatusLabel(item: Broost, t: Translator): string | undefined {
  if (item.emailStatus === 'failed' && item.emailWillRetry) {
    return t('social.broostPage.emailRetrying');
  }
  const key = EMAIL_STATUS_KEY[item.emailStatus];
  return key ? t(key) : undefined;
}

function BroostHistoryItem({ item, onMarkRead }: { item: Broost; onMarkRead: (id: number) => Promise<unknown> }) {
  const { t } = useTranslation();
  const readStatus = useAsyncStatus();
  const other = item.direction === 'sent' ? item.recipient : item.sender;
  const isUnreadReceived = item.direction === 'received' && !item.isRead;

  return (
    <li className={`${styles.item} ${isUnreadReceived ? styles.unread : ''}`}>
      <span className={styles.avatar} aria-hidden="true">
        {initialsFrom(other.label)}
      </span>
      <div className={styles.itemBody}>
        <p className={styles.itemMeta}>
          {item.direction === 'sent'
            ? t('social.broostPage.sentTo', { name: other.label })
            : t('social.broostPage.receivedFrom', { name: other.label })}{' '}
          · <TimeAgo iso={item.createdAt} />
        </p>
        <p className={styles.itemMessage}>{item.message}</p>
        {item.direction === 'sent' && <p className={styles.itemStatus}>{emailStatusLabel(item, t)}</p>}
      </div>
      {isUnreadReceived && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={readStatus.status === 'saving'} onClick={() => readStatus.run(() => onMarkRead(item.id))}>
          {t('social.broost.markRead')}
        </button>
      )}
      <StatusBadge status={readStatus.status} error={readStatus.error} />
    </li>
  );
}

/** Compact Hebrew RTL BROOST page: send a preset or custom supportive message to the current
 *  accepted partner, plus a combined sent+received history. Assumes a partner already exists
 *  (the "no partner" empty state is handled by DashboardPage, mirroring the WAM tab's own
 *  pattern) — reachable with no active cycle at all. */
export function BroostPage({ partner }: { partner: PartnerInfo }) {
  const { t, dir } = useTranslation();
  const composerId = useId();
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const { presets, loadStatus: presetsStatus } = useBroostPresets();
  const history = useBroostHistory();
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [customMessage, setCustomMessage] = useState('');
  const [usingCustom, setUsingCustom] = useState(false);
  const sendStatus = useAsyncStatus();
  const markAllStatus = useAsyncStatus();
  const [justSent, setJustSent] = useState(false);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const identity = `${accountId}:${partner.id}`;
  const previousIdentity = useRef(identity);
  const generation = useRef(0);
  if (previousIdentity.current !== identity) generation.current += 1;
  previousIdentity.current = identity;

  useEffect(() => () => {
    generation.current += 1;
    clearTimeout(timer.current);
  }, []);

  const canSubmit = usingCustom ? customMessage.trim().length > 0 : selectedPreset !== null;

  const submit = () => {
    // A defensive guard on top of the disabled button below: even if a double-click reaches
    // this handler twice before React has re-rendered the disabled state, a request already
    // in flight is never sent again.
    if (!canSubmit || sending.current) return;
    sending.current = true;
    const requestGeneration = generation.current;
    sendStatus.run(async () => {
      try {
        const broost = await history.send(usingCustom ? { customMessage: customMessage.trim() } : { presetKey: selectedPreset! });
        if (generation.current !== requestGeneration) return;
        setSelectedPreset(null);
        setCustomMessage('');
        setUsingCustom(false);
        setJustSent(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setJustSent(false), 2200);
        if (accountId !== null && broost.direction === 'sent' && broost.sender.id === accountId) {
          publishSuccess({
            accountId, kind: 'broost', occurrenceId: `broost:${broost.id}`,
            owner: true, success: true, completed: true,
          });
        }
      } finally {
        sending.current = false;
      }
    });
  };

  return (
    <div className={styles.page} dir={dir}>
      <section className={`card ${styles.composer}`} aria-labelledby={composerId}>
        <header className={styles.composerHeader}>
          <div>
            <span className={styles.eyebrow}>{t('social.broostPage.eyebrow')}</span>
            <h2 id={composerId} className={styles.title}>
              {t('social.broostPage.titlePrefix')}<bdi>BROOST</bdi>{t('social.broostPage.titleSuffix')}
            </h2>
          </div>
          <p className={styles.recipient}>
            <span className={styles.recipientLabel}>{t('social.broostPage.to')}</span>
            <bdi dir="auto" className={styles.recipientAddress}>{personLabel(partner)}</bdi>
          </p>
        </header>
        <p className={styles.subtitle}>{t('social.broostPage.subtitle')}</p>

        {presetsStatus === 'ready' && (
          <div className={styles.presetGrid} role="group" aria-label={t('social.broostPage.presetsLabel')}>
            {presets.map((preset) => {
              const selected = !usingCustom && selectedPreset === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`${styles.presetCard} ${selected ? styles.presetCardActive : ''}`}
                  data-tone={PRESET_TONES[preset.key] ?? 'accent'}
                  onClick={() => {
                    setUsingCustom(false);
                    setSelectedPreset(preset.key);
                  }}
                  aria-pressed={selected}
                >
                  <span className={styles.selectionMark} aria-hidden="true">{selected ? '✓' : ''}</span>
                  <span className={styles.presetMessage} dir="auto">{preset.message}</span>
                </button>
              );
            })}
          </div>
        )}
        {presetsStatus === 'loading' && <p className={styles.text} role="status">{t('social.broostPage.presetsLoading')}</p>}
        {presetsStatus === 'error' && <p className={styles.errorText} role="alert">{t('social.broostPage.presetsError')}</p>}

        <label className={styles.customToggle}>
          <input
            type="checkbox"
            checked={usingCustom}
            onChange={(e) => {
              setUsingCustom(e.target.checked);
              if (e.target.checked) setSelectedPreset(null);
            }}
          />
          <span>{t('social.broostPage.ownWords')}</span>
        </label>
        {usingCustom && (
          <div className={styles.customEditor}>
            <textarea
              ref={(el) => {
                if (el) autoResizeTextarea(el);
              }}
              className={styles.textarea}
              rows={2}
              maxLength={MAX_CUSTOM_MESSAGE_LENGTH}
              value={customMessage}
              placeholder={t('social.broostPage.customPlaceholder')}
              onChange={(e) => {
                autoResizeTextarea(e.currentTarget);
                setCustomMessage(e.target.value);
              }}
              aria-label={t('social.broostPage.customLabel')}
              aria-describedby={`${composerId}-count`}
            />
            <span className={styles.characterCount} id={`${composerId}-count`}>
              {t('social.broostPage.charCount', { used: customMessage.length, max: MAX_CUSTOM_MESSAGE_LENGTH })}
            </span>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-sm"
            disabled={!canSubmit || sendStatus.status === 'saving'}
            aria-describedby={canSubmit ? undefined : `${composerId}-blocked`} onClick={submit}>
            {t('social.broostPage.send')}
          </button>
          {!canSubmit && (
            <span id={`${composerId}-blocked`} className={styles.blockedHint}>
              {usingCustom ? t('social.broostPage.blockedCustom') : t('social.broostPage.blockedPreset')}
            </span>
          )}
          <StatusBadge status={sendStatus.status} error={sendStatus.error} />
          {justSent && (
            <span className={styles.sentAnimation} role="status">
              {t('social.broostPage.justSent')}
            </span>
          )}
        </div>
      </section>

      <section className={`card ${styles.historyCard}`}>
        <div className={styles.historyHeader}>
          <h3 className={styles.historyTitle}>{t('social.broostPage.historyTitle')}</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={markAllStatus.status === 'saving'}
            onClick={() => markAllStatus.run(() => history.markAllRead())}
          >
            {t('social.broost.markAllRead')}
          </button>
        </div>
        <StatusBadge status={markAllStatus.status} error={markAllStatus.error} />
        {history.loadStatus === 'loading' && <p className={styles.text}>{t('common.loading')}</p>}
        {history.loadStatus === 'error' && (
          <p className={styles.errorText} role="alert">
            {history.loadError}
          </p>
        )}
        {history.loadStatus === 'ready' && history.items.length === 0 && <p className={styles.text}>{t('social.broostPage.historyEmpty')}</p>}
        {history.items.length > 0 && (
          <ul className={styles.list}>
            {history.items.map((item) => (
              <BroostHistoryItem key={item.id} item={item} onMarkRead={history.markRead} />
            ))}
          </ul>
        )}
        {history.hasMore && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={history.loadMore}>
            {t('social.broostPage.loadMore')}
          </button>
        )}
      </section>
    </div>
  );
}
