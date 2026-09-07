import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReminders, type Reminder, type ReminderInput } from '../hooks/useReminders';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from '../components/StatusBadge';
import { TimeAgo } from '../components/TimeAgo';
import { autoResizeTextarea } from '../lib/autoResizeTextarea';
import { formatIsraelWallTime, israelWallTimeToUtcIso, nearestFridayWallTime } from '../lib/israelTime';
import type { PartnerInfo } from '../lib/types';
import { personLabel } from '../lib/people';
import styles from './RemindersPage.module.css';

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 2000;
/** How far into the future to suggest a new time when the original schedule of a
 *  failed/past-due reminder being edited has already passed. */
const MIN_RETRY_LEAD_MINUTES = 5;

/** The app is opened about twice a week, so the date field starts empty on nearly every visit
 *  and shows a browser placeholder we cannot translate. These cover the times a reminder is
 *  actually set for, so the field is usually filled in one tap. */
const QUICK_TIMES: { label: string; at: (now: Date) => string }[] = [
  { label: 'מחר בבוקר', at: (now) => shiftWallTime(now, { days: 1, hour: 9, minute: 0 }) },
  { label: 'עוד שלושה ימים', at: (now) => shiftWallTime(now, { days: 3, hour: 9, minute: 0 }) },
  { label: 'לפני ה‑WAM הבא', at: (now) => nearestFridayWallTime(now, 12, 0) },
  { label: 'בעוד שבוע', at: (now) => shiftWallTime(now, { days: 7, hour: 9, minute: 0 }) },
];

function shiftWallTime(now: Date, { days, hour, minute }: { days: number; hour: number; minute: number }): string {
  const wall = formatIsraelWallTime(now);
  const [datePart] = wall.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  // Built from the Israel calendar date, so a late-night visit still means "tomorrow" locally.
  const shifted = new Date(Date.UTC(y, m - 1, d + days, hour, minute));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(hour)}:${pad(minute)}`;
}

export interface RemindersPageProps {
  ownUserId: number;
  ownEmail: string;
  partner: PartnerInfo | null;
  focusedReminderId?: number;
  onDismissFocusedReminder?: () => void;
}

function formatIsraelDisplay(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const STATUS_LABELS: Record<Reminder['status'], string> = {
  pending: 'ממתינה',
  sending: 'בשליחה...',
  sent: 'נשלחה ✓',
  failed: 'נכשלה',
  cancelled: 'בוטלה',
};

type ReminderForm = { title: string; body: string; wallTime: string } & (
  | { recipientUserId: number }
  | { recipientUserId: 'both'; partnerUserId: number; partnershipId: number }
);

function emptyForm(defaultRecipientId: number): ReminderForm {
  // Never start empty: an unfilled datetime-local renders the browser's own untranslatable
  // "dd/mm/yyyy, --:--" placeholder, which is the only English left on this Hebrew screen.
  // The default is the most common choice and every quick chip below overrides it in one tap.
  return { title: '', body: '', wallTime: QUICK_TIMES[0].at(new Date()), recipientUserId: defaultRecipientId };
}

/** Compact Hebrew RTL page for scheduling one-time email reminders to yourself, your
 *  current accepted partner, or both — reachable with no active cycle. */
export function RemindersPage(props: RemindersPageProps) {
  // Account changes must discard the previous creator's list and any pending local focus.
  return <RemindersContent key={props.ownUserId} {...props} />;
}

function RemindersContent({ ownUserId, ownEmail, partner, focusedReminderId, onDismissFocusedReminder }: RemindersPageProps) {
  const { reminders, loadStatus, loadError, reload, createReminder, createReminders, updateReminder, cancelReminder } = useReminders();
  const [dismissedFocusKey, setDismissedFocusKey] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const focusKey = focusedReminderId === undefined ? null : `${ownUserId}:${focusedReminderId}`;
  const focusId = onDismissFocusedReminder || focusKey !== dismissedFocusKey ? focusedReminderId : undefined;
  const focusedReminder = reminders?.find((reminder) => reminder.id === focusId);
  const focusRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const lastFocusedKey = useRef<string | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm(ownUserId));
  const [formError, setFormError] = useState<string | null>(null);
  // Set only when startEdit had to substitute a new suggested time because the reminder's
  // original schedule had already passed (typically a failed/past-due one) — never silently
  // prefill an expired time without telling the user why it changed.
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null);
  const saveStatus = useAsyncStatus();
  const cancelStatus = useAsyncStatus();
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  // Keep the chosen partnership, not just "both": changing partners must require reselecting.
  const recipientUnavailable = form.recipientUserId === 'both'
    ? editingId !== null || partner?.id !== form.partnerUserId || partner?.partnershipId !== form.partnershipId
    : form.recipientUserId !== ownUserId && form.recipientUserId !== partner?.id;

  useEffect(() => {
    if (cancelStatus.status !== 'saving') setCancellingId(null);
  }, [cancelStatus.status]);

  useEffect(() => {
    setDismissedFocusKey(null);
  }, [focusKey]);

  useLayoutEffect(() => {
    if (!focusedReminder || loadStatus !== 'ready') {
      lastFocusedKey.current = null;
      return;
    }
    if (lastFocusedKey.current === focusKey) return;
    lastFocusedKey.current = focusKey;
    focusRef.current?.focus({ preventScroll: true });
    focusRef.current?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  }, [focusKey, focusedReminder?.id, loadStatus]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await reload(); } finally { setRetrying(false); }
  };

  const dismissFocus = () => {
    if (onDismissFocusedReminder) onDismissFocusedReminder();
    else setDismissedFocusKey(focusKey);
    listRef.current?.focus({ preventScroll: true });
  };

  function startEdit(reminder: Reminder) {
    setEditingId(reminder.id);
    const scheduleHasPassed = new Date(reminder.scheduledFor).getTime() <= Date.now();
    if (scheduleHasPassed) {
      const suggested = formatIsraelWallTime(new Date(Date.now() + MIN_RETRY_LEAD_MINUTES * 60_000));
      setForm({ title: reminder.title, body: reminder.body, wallTime: suggested, recipientUserId: reminder.recipient.id });
      setPrefillNotice(
        `המועד המקורי (${formatIsraelDisplay(reminder.scheduledFor)}) כבר עבר — הוצע מועד חדש בעתיד הקרוב; ניתן לשנות אותו לפי הצורך.`
      );
    } else {
      setForm({
        title: reminder.title,
        body: reminder.body,
        wallTime: reminder.scheduledForIsraelWallTime,
        recipientUserId: reminder.recipient.id,
      });
      setPrefillNotice(null);
    }
    setFormError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm(ownUserId));
    setFormError(null);
    setPrefillNotice(null);
  }

  function submit() {
    if (saveStatus.status === 'saving' || recipientUnavailable) return;
    setFormError(null);
    const title = form.title.trim();
    if (title.length === 0) {
      setFormError('כותרת התזכורת לא יכולה להיות ריקה');
      return;
    }
    if (form.wallTime.trim().length === 0) {
      setFormError('יש לבחור תאריך ושעה לתזכורת');
      return;
    }
    // Client-side pre-check for instant feedback only — the server independently validates
    // and performs the authoritative Israel wall-clock -> UTC conversion.
    const preview = israelWallTimeToUtcIso(form.wallTime);
    if (!preview) {
      setFormError('מועד לא תקין (שעון ישראל) — ייתכן שמדובר בשעה שאינה קיימת עקב מעבר לשעון קיץ/חורף');
      return;
    }
    if (new Date(preview).getTime() <= Date.now()) {
      setFormError('מועד התזכורת חייב להיות בעתיד');
      return;
    }

    const input = {
      title,
      body: form.body.trim(),
      scheduledFor: form.wallTime,
    };

    saveStatus
      .run(async () => {
        if (form.recipientUserId === 'both') {
          return createReminders({ ...input, recipientUserIds: [ownUserId, form.partnerUserId] });
        }
        const singleInput: ReminderInput = { ...input, recipientUserId: form.recipientUserId };
        return editingId ? updateReminder(editingId, singleInput) : createReminder(singleInput);
      })
      .then((res) => {
        if (res !== undefined) resetForm();
      });
  }

  if (loadStatus === 'loading') {
    return <div className="card" style={{ padding: 24 }} role="status">טוען תזכורות...</div>;
  }
  if (loadStatus === 'error') {
    return (
      <div className="card" style={{ padding: 24, color: 'var(--danger)' }}>
        <p role="alert">{loadError || 'לא ניתן לטעון תזכורות כרגע.'}</p>
        <button type="button" className="btn btn-ghost" onClick={() => void retry()} disabled={retrying}>ניסיון נוסף</button>
      </div>
    );
  }

  const editable = (r: Reminder) => r.status === 'pending' || r.status === 'failed';
  // Guides the datetime-local picker's own UI without ever needing the browser's local
  // timezone: since the input's value is always an Israel wall-clock string (never a true
  // browser-local one), the min bound must be expressed the same way for the comparison to
  // mean what it looks like it means, regardless of what timezone the browser itself is in.
  const minWallTime = formatIsraelWallTime(new Date());

  return (
    <div className={styles.page}>
      {focusId !== undefined && (
        <div className={`card ${styles.searchContext}`}>
          {focusedReminder ? (
            <p role="status">תוצאת החיפוש מסומנת ברשימה. מוצגות כל התזכורות, כולל תזכורות שנשלחו או בוטלו.</p>
          ) : (
            <>
              <p role="alert">התזכורת המבוקשת אינה זמינה. ייתכן שנמחקה או שאין לך הרשאה לצפות בה.</p>
              <button type="button" className="btn btn-ghost" onClick={() => void retry()} disabled={retrying}>ניסיון נוסף</button>
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={dismissFocus}>חזרה לרשימת התזכורות</button>
        </div>
      )}
      <section className={`card ${styles.formSection}`}>
        <h2 className={styles.title}>{editingId ? 'עריכת תזכורת' : 'תזכורת חדשה'}</h2>
        <label className={styles.field}>
          <span className={styles.label}>כותרת</span>
          <input
            type="text"
            value={form.title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="למשל: לשלוח עדכון לשותף/ה"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>תוכן (אופציונלי)</span>
          <textarea
            ref={(el) => {
              if (el) autoResizeTextarea(el);
            }}
            rows={1}
            className={styles.textarea}
            value={form.body}
            maxLength={MAX_BODY_LENGTH}
            onChange={(e) => {
              autoResizeTextarea(e.currentTarget);
              setForm((f) => ({ ...f, body: e.target.value }));
            }}
          />
        </label>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reminder-when">מתי לשלוח (שעון ישראל)</label>
            <input
              id="reminder-when"
              type="datetime-local"
              value={form.wallTime}
              min={minWallTime}
              onChange={(e) => setForm((f) => ({ ...f, wallTime: e.target.value }))}
            />
            <div className={styles.quickTimes} role="group" aria-label="מועדים מהירים">
              {QUICK_TIMES.map((quick) => (
                <button
                  key={quick.label}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setForm((f) => ({ ...f, wallTime: quick.at(new Date()) }))}
                >
                  {quick.label}
                </button>
              ))}
            </div>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>נמען/ת</span>
            <select
              value={recipientUnavailable ? 'unavailable' : form.recipientUserId}
              aria-invalid={recipientUnavailable || undefined}
              aria-describedby={recipientUnavailable ? 'reminder-recipient-error' : form.recipientUserId === 'both' ? 'reminder-recipient-help' : undefined}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'both' && partner) {
                  setForm((f) => ({ ...f, recipientUserId: 'both', partnerUserId: partner.id, partnershipId: partner.partnershipId }));
                } else if (value !== 'unavailable' && value !== 'both') {
                  setForm((f) => ({ ...f, recipientUserId: Number(value) }));
                }
              }}
            >
              {recipientUnavailable && <option value="unavailable" disabled>יש לבחור נמען/ת מחדש</option>}
              <option value={ownUserId}>אליי ({ownEmail})</option>
              {partner && <option value={partner.id}>אל {personLabel(partner)}</option>}
              {!editingId && partner && <option value="both">לשנינו</option>}
            </select>
          </label>
        </div>
        {recipientUnavailable ? (
          <p id="reminder-recipient-error" className={styles.fieldError} role="alert">
            השותפות השתנתה. יש לבחור נמען/ת מחדש לפני קביעת התזכורת.
          </p>
        ) : form.recipientUserId === 'both' && (
          <p id="reminder-recipient-help" className={styles.prefillNotice}>
            לכל אחד מאיתנו תיווצר תזכורת נפרדת, עם מצב שליחה וביטול נפרדים.
          </p>
        )}
        {prefillNotice && <p className={styles.prefillNotice}>{prefillNotice}</p>}
        {formError && (
          <p className={styles.fieldError} role="alert">
            {formError}
          </p>
        )}
        <div className={styles.actionsRow}>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saveStatus.status === 'saving'}>
            {editingId ? 'שמירת שינויים' : 'קביעת תזכורת'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              ביטול עריכה
            </button>
          )}
          <StatusBadge status={saveStatus.status} error={saveStatus.error} />
        </div>
      </section>

      <section className={styles.list} ref={listRef} tabIndex={-1} aria-label="רשימת התזכורות">
        {reminders && reminders.length === 0 && (
          <p className={styles.emptyText}>עדיין לא נקבעו תזכורות. השתמשו בטופס למעלה כדי ליצור תזכורת ראשונה.</p>
        )}
        {reminders?.map((reminder) => (
          <article
            key={reminder.id}
            id={`reminder-${reminder.id}`}
            ref={reminder.id === focusId ? focusRef : undefined}
            tabIndex={-1}
            aria-labelledby={`reminder-title-${reminder.id}`}
            className={`card ${styles.reminderCard} ${reminder.id === focusId ? styles.focusedReminder : ''}`}
          >
            <div className={styles.reminderHeader}>
              <h3 id={`reminder-title-${reminder.id}`} className={styles.reminderTitle}>{reminder.title}</h3>
              <span className={`${styles.statusChip} ${styles[`status_${reminder.status}`]}`}>
                {STATUS_LABELS[reminder.status]}
              </span>
            </div>
            {reminder.body && <p className={styles.reminderBody}>{reminder.body}</p>}
            <p className={styles.reminderMeta}>
              {reminder.status === 'pending' || reminder.status === 'sending' ? 'תישלח ' : 'למועד '}
              <TimeAgo iso={reminder.scheduledFor} upcoming={reminder.status === 'pending' || reminder.status === 'sending'} />
              {' · '}
              {reminder.recipient.isSelf
                ? 'אליי'
                : `אל ${partner && partner.email === reminder.recipient.email ? personLabel(partner) : reminder.recipient.email}`}
            </p>
            {reminder.status === 'failed' && reminder.lastError && (
              <p className={styles.errorText} role="alert">
                שגיאת שליחה אחרונה: {reminder.lastError}
              </p>
            )}
            {reminder.status === 'sent' && reminder.sentAt && (
              <p className={styles.reminderMeta}>נשלחה <TimeAgo iso={reminder.sentAt} /></p>
            )}
            {editable(reminder) && (
              <div className={styles.actionsRow}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(reminder)}>
                  {reminder.status === 'failed' ? 'עריכה / ניסיון חוזר' : 'עריכה'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (!window.confirm(`לבטל את התזכורת "${reminder.title}"? היא לא תישלח.`)) return;
                    setCancellingId(reminder.id);
                    cancelStatus.run(() => cancelReminder(reminder.id));
                  }}
                >
                  ביטול התזכורת
                </button>
                {cancellingId === reminder.id && (
                  <StatusBadge status={cancelStatus.status} error={cancelStatus.error} />
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
