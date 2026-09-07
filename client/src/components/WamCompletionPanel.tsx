import { useEffect, useId, useRef, useState } from 'react';
import type { WamDetail } from '../lib/types';
import { useAsyncStatus } from '../hooks/useAsyncStatus';
import { StatusBadge } from './StatusBadge';
import { israelWallTimeToUtcIso, nearestFridayWallTime, utcIsoToIsraelWallTime } from '../lib/israelTime';
import { useDateFormat } from '../lib/relativeTime';
import styles from './WamCompletionPanel.module.css';
import { useTranslation, type Translator } from '../i18n';

const DEFAULT_DURATION_MINUTES = 30;

function invitationStatusLabel(status: 'sent' | 'failed' | null, t: Translator): string {
  if (status === 'sent') return t('wams.invite.sent');
  if (status === 'failed') return t('wams.invite.failed');
  return t('wams.invite.pending');
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
  const { t } = useTranslation();
  const { formatAbsolute } = useDateFormat();
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
      setDateError(t('wams.schedule.badDate'));
      return null;
    }
    if (new Date(nextWamAt).getTime() <= Date.now()) {
      setDateError(t('wams.schedule.pastDate'));
      return null;
    }
    const duration = Number(durationMinutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 24 * 60) {
      setDateError(t('wams.schedule.badDuration'));
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
      setDateError(t('wams.schedule.needDate'));
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
          t('wams.schedule.cannotCancel')
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
        <h3 id={`${id}-title`}><span aria-hidden="true">📅 </span>{t('wams.schedule.title')}</h3>
        <span className={styles.optional}>{locked ? t('wams.schedule.readOnly') : t('wams.schedule.optional')}</span>
      </header>
      {wam.nextWam.at ? (
        <div className={styles.scheduleSummary}>
          <p className={styles.scheduleSummaryTitle}>{t('wams.schedule.setFor')}</p>
          <p>
            {t('wams.schedule.when', {
              when: formatAbsolute(wam.nextWam.at),
              minutes: wam.nextWam.durationMinutes ?? DEFAULT_DURATION_MINUTES,
            })}
          </p>
          <ul className={styles.invitationStatusList}>
            <li>
              <bdi>{wam.partnership.initiatorEmail}</bdi>: {invitationStatusLabel(wam.calendarInvitations.a.status, t)}
            </li>
            <li>
              <bdi>{wam.partnership.inviteeEmail}</bdi>: {invitationStatusLabel(wam.calendarInvitations.b.status, t)}
            </li>
          </ul>
          <p className={styles.hint}>{t('wams.schedule.statusHint')}</p>
        </div>
      ) : (
        <p className={styles.hint}>{t('wams.schedule.none')}</p>
      )}

      {locked ? (
        <p className={styles.hint}>{t('wams.schedule.lockedHint')}</p>
      ) : (
        <>
          <p className={styles.hint} id={`${id}-consent`}>
            {isDraft
              ? t('wams.schedule.draftHint')
              : t('wams.schedule.doneHint')}
          </p>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel}>
              {t('wams.schedule.fieldLabel', {
                changeability: hadExistingSchedule
                  ? t('wams.schedule.changeable')
                  : t('wams.schedule.optionalField'),
              })}
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
              {t('wams.schedule.duration')}
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
              {t('wams.schedule.retryHint')}
            </p>
          )}

          {isDraft ? (
            <>
              <div className={styles.confirmActions}>
                <button type="button" className="btn btn-primary" disabled={busy || alreadySent} onClick={submitSchedule}>
                  {alreadySent ? t('wams.schedule.alreadySent')
                    : scheduleUnchanged ? t('wams.schedule.retry')
                      : hadExistingSchedule ? t('wams.schedule.update') : t('wams.schedule.send')}
                </button>
              </div>
              {!confirmingComplete ? (
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirmingComplete(true)}>
                  {t('wams.complete.cta')}
                </button>
              ) : (
                <div className={styles.confirmBox}>
                  <p>
                    {hasChosenDate && !hadExistingSchedule
                      ? t('wams.complete.confirmWithDate')
                      : t('wams.complete.confirm')}
                  </p>
                  <div className={styles.confirmActions}>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={submitComplete}>
                      {t('wams.complete.yes')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmingComplete(false)}>
                      {t('wams.complete.no')}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.confirmActions}>
              <button type="button" className="btn btn-primary" disabled={busy || alreadySent} onClick={submitSchedule}>
                {alreadySent ? t('wams.schedule.alreadySent')
                  : scheduleUnchanged ? t('wams.schedule.retry')
                    : hadExistingSchedule ? t('wams.schedule.update') : t('wams.schedule.send')}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={runReopen}>
                {t('wams.complete.reopen')}
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
