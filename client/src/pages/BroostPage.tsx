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

const EMAIL_STATUS_LABEL: Partial<Record<Broost['emailStatus'], string>> = {
  sent: 'האימייל נשלח ✓',
  failed: 'שליחת האימייל נכשלה סופית (ה-BROOST עצמו נשמר בהצלחה)',
  pending: 'האימייל בדרך...',
  sending: 'האימייל בדרך...',
  cancelled: 'שליחת האימייל בוטלה (ה-BROOST עצמו נשמר בהצלחה)',
};

/** Returns the status line for a "sent" item, distinguishing a retryable failure (still
 *  scheduled for an automatic retry) from a truly terminal one — never exposes the raw
 *  provider error or internal retry timestamp, only this derived, safe wording. */
function emailStatusLabel(item: Broost): string | undefined {
  if (item.emailStatus === 'failed' && item.emailWillRetry) {
    return 'שליחת האימייל נכשלה, ינסה שוב אוטומטית (ה-BROOST עצמו נשמר בהצלחה)';
  }
  return EMAIL_STATUS_LABEL[item.emailStatus];
}

function BroostHistoryItem({ item, onMarkRead }: { item: Broost; onMarkRead: (id: number) => Promise<unknown> }) {
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
          {item.direction === 'sent' ? `נשלח ל${other.label}` : `התקבל מ${other.label}`} · <TimeAgo iso={item.createdAt} />
        </p>
        <p className={styles.itemMessage}>{item.message}</p>
        {item.direction === 'sent' && <p className={styles.itemStatus}>{emailStatusLabel(item)}</p>}
      </div>
      {isUnreadReceived && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={readStatus.status === 'saving'} onClick={() => readStatus.run(() => onMarkRead(item.id))}>
          סימון כנקרא
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
    <div className={styles.page} dir="rtl">
      <section className={`card ${styles.composer}`} aria-labelledby={composerId}>
        <header className={styles.composerHeader}>
          <div>
            <span className={styles.eyebrow}>בלי נאומים</span>
            <h2 id={composerId} className={styles.title}>איזה <bdi>BROOST</bdi> שולחים?</h2>
          </div>
          <p className={styles.recipient}>
            <span className={styles.recipientLabel}>אל</span>
            <bdi dir="auto" className={styles.recipientAddress}>{personLabel(partner)}</bdi>
          </p>
        </header>
        <p className={styles.subtitle}>בוחרים משפט, והוא נשלח כלשונו — גם במייל.</p>

        {presetsStatus === 'ready' && (
          <div className={styles.presetGrid} role="group" aria-label="הודעות מוכנות">
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
        {presetsStatus === 'loading' && <p className={styles.text} role="status">טוען את המשפטים…</p>}
        {presetsStatus === 'error' && <p className={styles.errorText} role="alert">המשפטים לא נטענו. אפשר לכתוב משהו משלך.</p>}

        <label className={styles.customToggle}>
          <input
            type="checkbox"
            checked={usingCustom}
            onChange={(e) => {
              setUsingCustom(e.target.checked);
              if (e.target.checked) setSelectedPreset(null);
            }}
          />
          <span>במילים שלי</span>
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
              placeholder="המשפט שרק הצד השני יבין…"
              onChange={(e) => {
                autoResizeTextarea(e.currentTarget);
                setCustomMessage(e.target.value);
              }}
              aria-label="הודעה אישית"
              aria-describedby={`${composerId}-count`}
            />
            <span className={styles.characterCount} id={`${composerId}-count`}>
              {customMessage.length} מתוך {MAX_CUSTOM_MESSAGE_LENGTH} תווים
            </span>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-sm"
            disabled={!canSubmit || sendStatus.status === 'saving'}
            aria-describedby={canSubmit ? undefined : `${composerId}-blocked`} onClick={submit}>
            שליחת BROOST
          </button>
          {!canSubmit && (
            <span id={`${composerId}-blocked`} className={styles.blockedHint}>
              {usingCustom ? 'כתבו משהו קודם' : 'בחרו משפט כדי לשלוח'}
            </span>
          )}
          <StatusBadge status={sendStatus.status} error={sendStatus.error} />
          {justSent && (
            <span className={styles.sentAnimation} role="status">
              נשלח 🫡
            </span>
          )}
        </div>
      </section>

      <section className={`card ${styles.historyCard}`}>
        <div className={styles.historyHeader}>
          <h3 className={styles.historyTitle}>מה נשלח ומה התקבל</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={markAllStatus.status === 'saving'}
            onClick={() => markAllStatus.run(() => history.markAllRead())}
          >
            סימון הכל כנקרא
          </button>
        </div>
        <StatusBadge status={markAllStatus.status} error={markAllStatus.error} />
        {history.loadStatus === 'loading' && <p className={styles.text}>טוען...</p>}
        {history.loadStatus === 'error' && (
          <p className={styles.errorText} role="alert">
            {history.loadError}
          </p>
        )}
        {history.loadStatus === 'ready' && history.items.length === 0 && <p className={styles.text}>עדיין לא נשלח BROOST. הראשון תמיד הכי שווה.</p>}
        {history.items.length > 0 && (
          <ul className={styles.list}>
            {history.items.map((item) => (
              <BroostHistoryItem key={item.id} item={item} onMarkRead={history.markRead} />
            ))}
          </ul>
        )}
        {history.hasMore && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={history.loadMore}>
            טעינת עוד
          </button>
        )}
      </section>
    </div>
  );
}
