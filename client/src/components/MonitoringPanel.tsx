import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchMonitoringSnapshot, MonitoringRequestError } from '../lib/monitoringApi';
import type { MonitoringSnapshot, MonitoringStatus } from '../lib/monitoringTypes';
import '../styles/monitoring.css';

const statusLabels: Record<MonitoringStatus, string> = { good: 'תקין', warn: 'לתשומת לב', unknown: 'לא ידוע', error: 'שגיאה' };
const channelLabels = { weekly: 'תזכורת WAM שבועית', reminders: 'תזכורות מתוזמנות', broost: 'BROOST', calendar: 'הזמנות ליומן' };
const timerLabels = { weekly: 'WAM שבועי', reminders: 'תזכורות', broost: 'BROOST', backup: 'גיבוי קבצים' };
const timerStates = { active: 'פעיל', inactive: 'לא פעיל', failed: 'נכשל', unknown: 'לא ידוע', not_configured: 'לא הוגדר' };
const probeReasons: Record<MonitoringSnapshot['probe']['reason'], string> = {
  fresh: 'המדידה המקומית עדכנית', stale: 'המדידה המקומית ישנה — אין אישור למצב הנוכחי',
  missing: 'טרם התקבלה מדידה מקומית', not_configured: 'הבדיקה המקומית לא הוגדרה',
  unavailable: 'המדידה המקומית אינה זמינה', malformed: 'המדידה המקומית אינה תקינה',
  oversized: 'המדידה המקומית חרגה מהגודל המותר', future: 'חותמת הזמן של המדידה אינה תקינה',
};

export function monitoringAge(seconds: number | null): string {
  if (seconds === null) return 'לא ידוע';
  if (seconds < 60) return 'פחות מדקה';
  if (seconds < 120) return 'דקה';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} דקות`;
  if (seconds < 7200) return 'שעה';
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} שעות`;
  if (seconds < 172_800) return 'יום';
  return `${Math.floor(seconds / 86_400)} ימים`;
}
function dateLabel(value: string | null): string {
  return value ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(value)) : 'אין מידע';
}
function bytesLabel(bytes: number | null): string {
  if (bytes === null) return 'לא ידוע';
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function hasNoDeliveries(channel: MonitoringSnapshot['email']['channels'][number]): boolean {
  return channel.status === 'unknown' && channel.counts !== null && Object.values(channel.counts).every((count) => count === 0);
}
function Badge({ status, label }: { status: MonitoringStatus; label?: string }) {
  return <span className={`monitoring-badge monitoring-badge--${status}`}><span aria-hidden="true">●</span> {label ?? statusLabels[status]}</span>;
}
function Card({ title, status, statusLabel, children, wide = false }: { title: string; status: MonitoringStatus; statusLabel?: string; children: ReactNode; wide?: boolean }) {
  return <section className={`monitoring-card${wide ? ' monitoring-card--wide' : ''}`} aria-label={title}>
    <div className="monitoring-card-heading"><h3>{title}</h3><Badge status={status} label={statusLabel} /></div>{children}
  </section>;
}

export function MonitoringPanel({ loadSnapshot = fetchMonitoringSnapshot }: {
  loadSnapshot?: (signal: AbortSignal) => Promise<MonitoringSnapshot>;
}) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'authentication' | 'unavailable' | null>(null);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError(null);
    try {
      const next = await loadSnapshot(request.signal);
      if (!request.signal.aborted) setSnapshot(next);
    } catch (failure) {
      if (!request.signal.aborted) {
        setSnapshot(null);
        setError(failure instanceof MonitoringRequestError ? failure.kind : 'unavailable');
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [loadSnapshot]);
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);
  return <section className="monitoring-panel" dir="rtl" aria-label="ניטור מערכת">
    <header className="monitoring-header">
      <div><p className="monitoring-eyebrow">תמונת מצב · פרטי · קריאה בלבד</p><h2>בריאות המערכת</h2>
        <p className="monitoring-description">מידע מצרפי בלבד, ללא פרטים אישיים. אין כאן פעולות שמשנות את המערכת.</p></div>
      <button className="monitoring-refresh" type="button" onClick={() => void refresh()} disabled={loading}>
        <span aria-hidden="true">↻</span> {loading ? 'מרענן…' : 'רענון מצב'}
      </button>
    </header>
    <div aria-live="polite" className="monitoring-announcement">
      {loading && <p role="status">טוען תמונת מצב…</p>}
      {error && <p role="alert" className="monitoring-error">{error === 'authentication'
        ? 'נדרשת התחברות מחדש כדי לצפות בניטור.' : 'לא ניתן לקרוא את מצב המערכת כרגע. אפשר לנסות לרענן.'}</p>}
    </div>
    {snapshot && <>
      <div className="monitoring-summary">
        <Badge status={snapshot.status} /><span>מצב כולל</span>
        <span className="monitoring-checked">נבדק: <time dateTime={snapshot.checkedAt}>{dateLabel(snapshot.checkedAt)}</time> · שעון ישראל</span>
      </div>
      <p className={`monitoring-freshness monitoring-freshness--${snapshot.probe.status}`}>
        {probeReasons[snapshot.probe.reason]}{snapshot.probe.ageSeconds !== null && ` · גיל המדידה בעת הרענון: ${monitoringAge(snapshot.probe.ageSeconds)}`}
      </p>
      <div className="monitoring-grid" aria-busy={loading}>
        <Card title="תהליך היישום" status={snapshot.process.status}>
          <p className="monitoring-metric">{monitoringAge(snapshot.process.uptimeSeconds)}</p>
          <p className="monitoring-caption">זמן פעילות מאז הפעלת התהליך</p>
          <dl><dt>התחלה</dt><dd>{dateLabel(snapshot.process.startedAt)}</dd></dl>
        </Card>
        <Card title="מסד נתונים מקומי" status={snapshot.database.status}>
          <p className="monitoring-metric" dir="ltr">{bytesLabel(snapshot.database.bytes)}</p>
          <dl><dt>יומן WAL</dt><dd dir="ltr">{bytesLabel(snapshot.database.walBytes)}</dd></dl>
          <p className="monitoring-caption">{snapshot.database.status === 'error' ? 'קריאת מסד הנתונים נכשלה.' : 'גודל קבצים מקומי; לא בדיקת תקינות מלאה.'}</p>
        </Card>
        <Card title="גיבויי WAM בלתי־משתנים" status={snapshot.wamBackup.status}>
          <p className="monitoring-metric">{snapshot.wamBackup.count === null ? '—' : snapshot.wamBackup.count.toLocaleString('he-IL')}</p>
          <dl><dt>הגיבוי האחרון</dt><dd>{dateLabel(snapshot.wamBackup.latestAt)}</dd></dl>
          <p className="monitoring-caption">{snapshot.wamBackup.count === 0 ? 'עדיין אין היסטוריית גיבויים. ' : ''}נשמרים באותו מסד; אינם תחליף לגיבוי קבצים.</p>
        </Card>
        <Card title="גיבוי קבצים" status={snapshot.fileBackup.status}>
          <p className="monitoring-metric">{snapshot.fileBackup.state === 'not_configured' ? 'לא הוגדר' : monitoringAge(snapshot.fileBackup.ageSeconds)}</p>
          <dl><dt>הצלחה אחרונה</dt><dd>{dateLabel(snapshot.fileBackup.latestAt)}</dd></dl>
          <p className="monitoring-caption">דיווח של משימת הגיבוי, לא בדיקת שחזור. אזהרה אחרי {monitoringAge(snapshot.fileBackup.staleAfterSeconds)}.</p>
        </Card>
        <Card title="תוקף תעודה מקומית" status={snapshot.certificate.status}>
          <p className="monitoring-metric">{snapshot.certificate.state === 'not_configured' ? 'לא הוגדרה' : snapshot.certificate.daysRemaining === null ? 'אין מידע' : `${snapshot.certificate.daysRemaining} ימים`}</p>
          <dl><dt>בתוקף מ־</dt><dd>{dateLabel(snapshot.certificate.validFrom)}</dd><dt>תפוגה</dt><dd>{dateLabel(snapshot.certificate.expiresAt)}</dd></dl>
          <p className="monitoring-caption">תעודה שנקראה מקומית בלבד. אין בדיקת HTTPS.</p>
        </Card>
        <Card title="עדכניות הבדיקה המקומית" status={snapshot.probe.status}>
          <p className="monitoring-metric">{monitoringAge(snapshot.probe.ageSeconds)}</p>
          <dl><dt>נמדד</dt><dd>{dateLabel(snapshot.probe.sampledAt)}</dd></dl>
          <p className="monitoring-caption">מדידה נחשבת ישנה אחרי {monitoringAge(snapshot.probe.staleAfterSeconds)}. הרענון קורא מידע; אינו מפעיל בדיקות.</p>
        </Card>
        <Card title="גיבוי ענן פרטי — מחוץ לשרת" status={snapshot.cloudBackup.status} wide>
          <p className="monitoring-metric">{snapshot.cloudBackup.state === 'not_configured' ? 'לא הוגדר' : monitoringAge(snapshot.cloudBackup.ageSeconds)}</p>
          <dl><dt>העלאה אחרונה שאושרה</dt><dd>{dateLabel(snapshot.cloudBackup.latestAt)}</dd>
            <dt>גודל הארכיון שאושר</dt><dd dir="ltr">{bytesLabel(snapshot.cloudBackup.archiveBytes)}</dd></dl>
          <p className="monitoring-caption">אישור מקומי לאחר השלמת העלאה לאחסון פרטי ובדיקת מאפייני האובייקט. נפרד מגיבוי מקומי; אינו בדיקת שחזור.
            {' '}אזהרה אחרי {monitoringAge(snapshot.cloudBackup.staleAfterSeconds)}. הרענון כאן אינו פונה לענן.</p>
        </Card>
        <Card title="משימות מתוזמנות" status={snapshot.timers.some((timer) => timer.status === 'error') ? 'error'
          : snapshot.timers.some((timer) => timer.status === 'warn') ? 'warn' : snapshot.timers.some((timer) => timer.status === 'unknown') ? 'unknown' : 'good'} wide>
          <div className="monitoring-timers">{snapshot.timers.map((timer) => <div key={timer.id} className="monitoring-timer">
            <div><strong>{timerLabels[timer.id]}</strong><Badge status={timer.status} /></div>
            <p>{timerStates[timer.state]}</p><p className="monitoring-caption">הרצה הבאה: {dateLabel(timer.nextRunAt)}</p>
          </div>)}</div>
          <p className="monitoring-caption">מצב הטיימר בלבד; אינו אישור שההרצה האחרונה של השירות הצליחה.</p>
        </Card>
        <Card title="מסירת דואר — סיכום מצרפי" status={snapshot.email.status}
          statusLabel={snapshot.email.status === 'unknown' && snapshot.email.channels.some(hasNoDeliveries)
            ? snapshot.email.channels.every(hasNoDeliveries) ? 'טרם נשלח דואר' : 'מידע חלקי' : undefined} wide>
          <div className="monitoring-table-scroll"><table className="monitoring-table">
            <caption>רשומות מסירה נוכחיות בלבד, לא ניסיונות מצטברים. אין כתובות או תוכן הודעות.</caption>
            <thead><tr><th scope="col">ערוץ</th><th scope="col">נשלח</th><th scope="col">נכשל</th><th scope="col">ממתין</th><th scope="col">בשליחה</th><th scope="col">בוטל</th><th scope="col">מצב</th></tr></thead>
            <tbody>{snapshot.email.channels.map((channel) => <tr key={channel.id}>
              <th scope="row">{channelLabels[channel.id]}</th>
              {(['sent', 'failed', 'pending', 'sending', 'cancelled'] as const).map((key) => <td key={key}>{channel.counts?.[key].toLocaleString('he-IL') ?? '—'}</td>)}
              <td><Badge status={channel.status} label={hasNoDeliveries(channel) ? 'טרם נשלחו הודעות' : undefined} /></td>
            </tr>)}</tbody>
          </table></div>
          <p className="monitoring-caption">ערוץ ללא רשומות עדיין לא נוסה — זה אינו כשל בשליחה וגם לא אישור שהשליחה פעילה.
            {' '}מצב המשימות המתוזמנות מוצג בנפרד למעלה.</p>
        </Card>
      </div>
    </>}
    <footer className="monitoring-footer">הנתונים נכונים למועד הרענון האחרון · רענון ידני בלבד · אין הפעלה או עצירה של שירותים · ״לא ידוע״ אינו אישור לתקינות</footer>
  </section>;
}
