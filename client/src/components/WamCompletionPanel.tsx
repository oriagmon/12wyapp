import { useEffect, useId, useRef, useState } from 'react';
import type { WamDetail } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { israelWallTimeToUtcIso, nearestFridayWallTime, utcIsoToIsraelWallTime } from '../lib/israelTime';
import styles from './WamCompletionPanel.module.css';

const DEFAULT_DURATION_MINUTES = 30;

function invitationStatusLabel(status: 'sent' | 'failed' | null): string {
  if (status === 'sent') return 'נשלחה הזמנה ✓';
  if (status === 'failed') return 'שליחת ההזמנה נכשלה';
  return 'טרם נשלחה הזמנה';
}

export function WamCompletionPanel({
  wam,
  onComplete,
  onSchedule,
  onReopen,
  readOnly = false,
}: {
  wam: WamDetail;
  onComplete: (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) => Promise<unknown>;
  onSchedule: (schedule: { nextWamAt: string; nextWamDurationMinutes?: number }) => Promise<unknown>;
  onReopen: () => Promise<unknown>;
  readOnly?: boolean;
}) {
  const isDraft = wam.status === 'draft';
  const locked = readOnly || wam.isHistorical;
  const id = useId();
  const completeStatus = useAsyncStatus();
  const reopenStatus = useAsyncStatus();
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  // An unscheduled meeting opens on the suggested default slot so the common case is one
  // click; it is only a prefilled suggestion and nothing is sent until the user confirms.
  const [nextWamLocal, setNextWamLocal] = useState(
    () => (wam.nextWam.at ? utcIsoToIsraelWallTime(wam.nextWam.at) : nearestFridayWallTime())
  );
  const [durationMinutes, setDurationMinutes] = useState(String(wam.nextWam.durationMinutes ?? DEFAULT_DURATION_MINUTES));
  const [dateError, setDateError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const reopeningRef = useRef(false);
  const busy = completeStatus.status === 'saving' || reopenStatus.status === 'saving';
  const persistedLocal = wam.nextWam.at ? utcIsoToIsraelWallTime(wam.nextWam.at) : '';

  useEffect(() => {
    setNextWamLocal(persistedLocal || nearestFridayWallTime());
    setDurationMinutes(String(wam.nextWam.durationMinutes ?? DEFAULT_DURATION_MINUTES));
    setDateError(null);
  }, [wam.id, persistedLocal, wam.nextWam.durationMinutes]);

  useEffect(() => { setConfirmingComplete(false); }, [wam.id, wam.status, locked]);

  const runComplete = async (schedule?: { nextWamAt: string; nextWamDurationMinutes?: number }) => {
    if (locked || submittingRef.current || reopeningRef.current) return;
    submittingRef.current = true;
    try {
      const result = await completeStatus.run(() => schedule ? onComplete(schedule) : onComplete());
      if (result !== undefined) setConfirmingComplete(false);
    } finally {
      submittingRef.current = false;
    }
  };

  const runSchedule = async (schedule: { nextWamAt: string; nextWamDurationMinutes?: number }) => {
    if (locked || submittingRef.current || reopeningRef.current) return;
    submittingRef.current = true;
    try {
      await completeStatus.run(() => onSchedule(schedule));
    } finally {
      submittingRef.current = false;
    }
  };

  const runReopen = async () => {
    if (locked || reopeningRef.current || submittingRef.current) return;
    reopeningRef.current = true;
    try {
      await reopenStatus.run(onReopen);
    } finally {
      reopeningRef.current = false;
    }
  };

  // A schedule already persisted on the server can never be cleared from here — there is no
  // calendar-invitation cancellation feature, so completing "without scheduling" after an
  // invite was already sent would silently leave a stale invite in both partners' calendars.
  const hadExistingSchedule = Boolean(wam.nextWam.at);
  const hasChosenDate = nextWamLocal.trim().length > 0;
  const previousAttemptFailed = wam.calendarInvitations.a.status === 'failed' || wam.calendarInvitations.b.status === 'failed';
  const scheduleUnchanged = hadExistingSchedule && nextWamLocal === persistedLocal
    && Number(durationMinutes) === wam.nextWam.durationMinutes;
  const alreadySent = scheduleUnchanged && wam.calendarInvitations.a.status === 'sent'
    && wam.calendarInvitations.b.status === 'sent';

  /** Validates the chosen slot and returns it, or records the reason and returns null. */
  const readSchedule = (): { nextWamAt: string; nextWamDurationMinutes: number } | null => {
    // Preserve the original instant on an unchanged wall time, including the repeated
    // autumn DST hour; round-tripping it could otherwise shift an existing invitation.
    const nextWamAt = nextWamLocal === persistedLocal && wam.nextWam.at
      ? wam.nextWam.at : israelWallTimeToUtcIso(nextWamLocal);
    if (!nextWamAt) {
      setDateError('מועד לא תקין (שעון ישראל) — ייתכן שמדובר בשעה שאינה קיימת עקב מעבר לשעון קיץ/חורף');
      return null;
    }
    if (new Date(nextWamAt).getTime() <= Date.now()) {
      setDateError('מועד הפגישה הבאה חייב להיות בעתיד');
      return null;
    }
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 24 * 60) {
      setDateError('משך הפגישה חייב להיות מספר שלם בין 1 ל־1440 דקות');
      return null;
    }
    return { nextWamAt, nextWamDurationMinutes: duration };
  };

  /** Invitation-only: schedules the next meeting and emails the invitations. Never completes
   *  this meeting, so no scores are frozen and no completion backup or celebration occurs. */
  const submitSchedule = () => {
    if (locked || submittingRef.current || reopeningRef.current) return;
    setDateError(null);
    if (!hasChosenDate) {
      setDateError('יש לבחור מועד לפגישה הבאה כדי לשלוח הזמנות');
      return;
    }
    const schedule = readSchedule();
    if (schedule) void runSchedule(schedule);
  };

  const submitComplete = () => {
    if (locked || submittingRef.current || reopeningRef.current) return;
    setDateError(null);

    if (!hasChosenDate) {
      if (hadExistingSchedule) {
        setDateError(
          'לא ניתן לבטל תיאום קיים לפגישה הבאה — ניתן לשנות את המועד, אך לא למחוק אותו (אין תמיכה בביטול הזמנות יומן שכבר נשלחו).'
        );
        return;
      }
      void runComplete();
      return;
    }

    // A draft is completed on its own: the meeting slot is sent separately, so an unsent or
    // merely suggested date never rides along with — or blocks — freezing the scores.
    if (isDraft && !hadExistingSchedule) {
      void runComplete();
      return;
    }

    const schedule = readSchedule();
    if (schedule) void runComplete(schedule);
  };

  return (
    <section className={`card ${styles.wrap}`} aria-labelledby={`${id}-title`} aria-busy={busy}>
      <header className={styles.heading}>
        <h3 id={`${id}-title`}><span aria-hidden="true">📅 </span>ה-WAM הבא — קובעים יחד?</h3>
        <span className={styles.optional}>{locked ? 'לצפייה בלבד' : 'תיאום אופציונלי'}</span>
      </header>
      {wam.nextWam.at ? (
        <div className={styles.scheduleSummary}>
          <p className={styles.scheduleSummaryTitle}>ה-WAM הבא נקבע ל:</p>
          <p>
            {new Intl.DateTimeFormat('he-IL', {
              timeZone: 'Asia/Jerusalem',
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(wam.nextWam.at))}{' '}
            (שעון ישראל), למשך {wam.nextWam.durationMinutes} דקות
          </p>
          <ul className={styles.invitationStatusList}>
            <li>
              <bdi>{wam.partnership.initiatorEmail}</bdi>: {invitationStatusLabel(wam.calendarInvitations.a.status)}
            </li>
            <li>
              <bdi>{wam.partnership.inviteeEmail}</bdi>: {invitationStatusLabel(wam.calendarInvitations.b.status)}
            </li>
          </ul>
          <p className={styles.hint}>מצב השליחה אינו אישור השתתפות או אישור שהאירוע נוסף ליומן.</p>
        </div>
      ) : (
        <p className={styles.hint}>עדיין לא נקבע מועד לפגישה הבאה.</p>
      )}

      {locked ? (
        <p className={styles.hint}>התיאום ומצב ההזמנות מוצגים כפי שנשמרו. לא ניתן לשנות אותם בתצוגה זו.</p>
      ) : (
        <>
          <p className={styles.hint} id={`${id}-consent`}>
            {isDraft
              ? 'אפשר לקבוע עכשיו מועד משותף ולשלוח הזמנות ליומנים של שניכם — בלי להשלים את הפגישה. השלמת הפגישה היא פעולה נפרדת שמקפיאה את הציונים.'
              : 'אפשר לתאם או לעדכן את הפגישה הבאה בלי לפתוח מחדש את הפגישה שהושלמה. הציונים והתוכן השמורים לא ישתנו.'}
          </p>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel}>
              תיאום ה-WAM הבא ({hadExistingSchedule ? 'ניתן לשנות, לא לבטל' : 'אופציונלי'}, שעון ישראל)
              <input
                type="datetime-local"
                disabled={busy}
                value={nextWamLocal}
                aria-describedby={`${id}-consent${dateError ? ` ${id}-error` : ''}`}
                aria-invalid={Boolean(dateError)}
                onChange={(e) => { setNextWamLocal(e.target.value); setDateError(null); }}
              />
            </label>
            <label className={styles.durationLabel}>
              משך (בדקות)
              <input
                type="number"
                disabled={busy || !hasChosenDate}
                min={1}
                max={24 * 60}
                step={1}
                value={durationMinutes}
                aria-describedby={dateError ? `${id}-error` : undefined}
                onChange={(e) => { setDurationMinutes(e.target.value); setDateError(null); }}
              />
            </label>
          </div>
          {dateError && <p id={`${id}-error`} className={styles.dateError} role="alert">{dateError}</p>}
          {previousAttemptFailed && (
            <p className={styles.retryHint}>
              חלק מההזמנות לא נשלחו. באישור ניסיון נוסף עם אותו מועד ומשך, נשלח רק למי שהשליחה אליו טרם הצליחה.
              שינוי המועד או המשך ישלח עדכון לשניכם.
            </p>
          )}

          {isDraft ? (
            <>
              <div className={styles.confirmActions}>
                <button type="button" className="btn btn-primary" disabled={busy || alreadySent} onClick={submitSchedule}>
                  {alreadySent ? 'ההזמנות נשלחו — אפשר לעדכן את המועד'
                    : scheduleUnchanged ? 'ניסיון נוסף לשליחת ההזמנות'
                      : hadExistingSchedule ? 'עדכון המועד ושליחה ליומנים' : '📅 שלח הזמנה ליומנים'}
                </button>
              </div>
              {!confirmingComplete ? (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmingComplete(true)}>
                  ✓ סימון הפגישה כהושלמה
                </button>
              ) : (
                <div className={styles.confirmBox}>
                  <p>
                    {hasChosenDate && !hadExistingSchedule
                      ? 'השלמת הפגישה תקפיא את ציוני הביצוע הנוכחיים של שני הצדדים. המועד שבחרת לא יישמר ולא יישלחו הזמנות — לשליחתן יש ללחוץ קודם על "שלח הזמנה ליומנים". להמשיך?'
                      : 'השלמת הפגישה תקפיא את ציוני הביצוע הנוכחיים של שני הצדדים. להמשיך?'}
                  </p>
                  <div className={styles.confirmActions}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submitComplete}>
                      אישור השלמת הפגישה
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmingComplete(false)}>
                      ביטול
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.confirmActions}>
              <button type="button" className="btn btn-primary" disabled={busy || alreadySent} onClick={submitSchedule}>
                {alreadySent ? 'ההזמנות נשלחו — אפשר לעדכן את המועד'
                  : scheduleUnchanged ? 'ניסיון נוסף לשליחת ההזמנות'
                    : hadExistingSchedule ? 'עדכון המועד ושליחה ליומנים' : '📅 שלח הזמנה ליומנים'}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={runReopen}>
                ↺ פתיחה מחדש לעריכה
              </button>
            </div>
          )}
          <StatusBadge status={completeStatus.status} error={completeStatus.error} />
          <StatusBadge status={reopenStatus.status} error={reopenStatus.error} />
        </>
      )}
    </section>
  );
}
