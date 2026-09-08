import type { AreaDict } from '../locales';

/**
 * Translations for the "monitoring" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `monitoring.`.
 * - Use `{name}` placeholders for interpolation.
 */
export const monitoring: AreaDict = {
  en: {
    'monitoring.status.good': 'good',
    'monitoring.status.warn': 'attention needed',
    'monitoring.status.unknown': 'unknown',
    'monitoring.status.error': 'error',

    'monitoring.channel.weekly': 'Weekly WAM reminder',
    'monitoring.channel.reminders': 'Scheduled reminders',
    'monitoring.channel.broost': 'BROOST',
    'monitoring.channel.calendar': 'Calendar invites',

    'monitoring.timer.weekly': 'Weekly WAM',
    'monitoring.timer.reminders': 'Reminders',
    'monitoring.timer.broost': 'BROOST',
    'monitoring.timer.backup': 'File backup',

    'monitoring.timerState.active': 'Active',
    'monitoring.timerState.inactive': 'Inactive',
    'monitoring.timerState.failed': 'Failed',
    'monitoring.timerState.unknown': 'Unknown',
    'monitoring.timerState.not_configured': 'Not configured',

    'monitoring.probeReason.fresh': 'Local measurement is up to date',
    'monitoring.probeReason.stale': 'Local measurement is stale — no confirmation of current state',
    'monitoring.probeReason.missing': 'No local measurement received yet',
    'monitoring.probeReason.not_configured': 'Local probe not configured',
    'monitoring.probeReason.unavailable': 'Local measurement unavailable',
    'monitoring.probeReason.malformed': 'Local measurement is malformed',
    'monitoring.probeReason.oversized': 'Local measurement exceeded the size limit',
    'monitoring.probeReason.future': 'Local measurement timestamp is invalid',

    'monitoring.age.unknown': 'unknown',
    'monitoring.age.lessThanMinute': 'less than a minute',
    'monitoring.age.oneMinute': 'a minute',
    'monitoring.age.minutes': '{count} minutes',
    'monitoring.age.oneHour': 'an hour',
    'monitoring.age.hours': '{count} hours',
    'monitoring.age.oneDay': 'a day',
    'monitoring.age.days': '{count} days',

    'monitoring.panel.ariaLabel': 'System monitoring',
    'monitoring.panel.eyebrow': 'Snapshot · Private · Read only',
    'monitoring.panel.title': 'System health',
    'monitoring.panel.description': 'Aggregated data only, no personal details. Nothing here changes the system.',
    'monitoring.panel.refresh': 'Refresh',
    'monitoring.panel.refreshing': 'Refreshing…',
    'monitoring.panel.loading': 'Loading snapshot…',
    'monitoring.panel.authError': 'Sign in again to view monitoring.',
    'monitoring.panel.unavailableError': 'System status cannot be read right now. Try refreshing.',
    'monitoring.panel.overallStatus': 'Overall status',
    'monitoring.panel.checkedAt': 'Checked: {time} · Israel time',
    'monitoring.panel.probeAge': ' · Measurement age at refresh: {age}',
    'monitoring.panel.footer': 'Data is current as of the last refresh · Manual refresh only · No service start/stop · "Unknown" is not confirmation of health',

    'monitoring.card.process': 'Application process',
    'monitoring.card.database': 'Local database',
    'monitoring.card.wamBackup': 'Immutable WAM backups',
    'monitoring.card.fileBackup': 'File backup',
    'monitoring.card.certificate': 'Local certificate validity',
    'monitoring.card.probe': 'Local probe freshness',
    'monitoring.card.cloudBackup': 'Private cloud backup — off-server',
    'monitoring.card.timers': 'Scheduled tasks',
    'monitoring.card.email': 'Mail delivery — aggregated summary',

    'monitoring.process.uptime': 'Uptime since the process started',
    'monitoring.process.startedAt': 'Started',

    'monitoring.database.wal': 'WAL log',
    'monitoring.database.caption': 'Local file size; not a full integrity check.',
    'monitoring.database.error': 'Database read failed.',

    'monitoring.wamBackup.latestAt': 'Latest backup',
    'monitoring.wamBackup.caption': 'Stored in the same database; not a substitute for file backup.',
    'monitoring.wamBackup.noneYet': 'No backup history yet. ',

    'monitoring.fileBackup.latestAt': 'Latest success',
    'monitoring.fileBackup.caption': 'Reported by the backup job, not a restore check. Warning after {age}.',
    'monitoring.fileBackup.notConfigured': 'Not configured',

    'monitoring.cert.validFrom': 'Valid from',
    'monitoring.cert.expiresAt': 'Expiry',
    'monitoring.cert.days': '{n} days',
    'monitoring.cert.notConfigured': 'Not configured',
    'monitoring.cert.noInfo': 'No information',
    'monitoring.cert.caption': 'Certificate read locally only. No HTTPS check.',

    'monitoring.probe.sampledAt': 'Sampled',
    'monitoring.probe.caption': 'Measurement considered stale after {age}. Refreshing reads data; it does not run probes.',

    'monitoring.cloudBackup.latestAt': 'Last confirmed upload',
    'monitoring.cloudBackup.archiveSize': 'Confirmed archive size',
    'monitoring.cloudBackup.notConfigured': 'Not configured',
    'monitoring.cloudBackup.caption': 'Local confirmation after upload completes to private storage and object properties are checked. Separate from local backup; not a restore check. Warning after {age}. Refreshing here does not contact the cloud.',

    'monitoring.timers.caption': 'Timer state only; not confirmation that the last service run succeeded.',
    'monitoring.timers.nextRun': 'Next run: {time}',

    'monitoring.email.caption': 'Current delivery records only, not cumulative attempts. No addresses or message content.',
    'monitoring.email.colChannel': 'Channel',
    'monitoring.email.colSent': 'Sent',
    'monitoring.email.colFailed': 'Failed',
    'monitoring.email.colPending': 'Pending',
    'monitoring.email.colSending': 'Sending',
    'monitoring.email.colCancelled': 'Cancelled',
    'monitoring.email.colStatus': 'Status',
    'monitoring.email.noneYet': 'No email sent yet',
    'monitoring.email.partial': 'Partial data',
    'monitoring.email.noMessages': 'No messages sent yet',
    'monitoring.email.footerCaption': 'A channel with no records has not been tried — this is neither a sending failure nor confirmation that sending is active. Scheduled task status is shown separately above.',

    'monitoring.noInfo': 'No information',
  },
  he: {
    'monitoring.status.good': 'תקין',
    'monitoring.status.warn': 'לתשומת לב',
    'monitoring.status.unknown': 'לא ידוע',
    'monitoring.status.error': 'שגיאה',

    'monitoring.channel.weekly': 'תזכורת WAM שבועית',
    'monitoring.channel.reminders': 'תזכורות מתוזמנות',
    'monitoring.channel.broost': 'BROOST',
    'monitoring.channel.calendar': 'הזמנות ליומן',

    'monitoring.timer.weekly': 'WAM שבועי',
    'monitoring.timer.reminders': 'תזכורות',
    'monitoring.timer.broost': 'BROOST',
    'monitoring.timer.backup': 'גיבוי קבצים',

    'monitoring.timerState.active': 'פעיל',
    'monitoring.timerState.inactive': 'לא פעיל',
    'monitoring.timerState.failed': 'נכשל',
    'monitoring.timerState.unknown': 'לא ידוע',
    'monitoring.timerState.not_configured': 'לא הוגדר',

    'monitoring.probeReason.fresh': 'המדידה המקומית עדכנית',
    'monitoring.probeReason.stale': 'המדידה המקומית ישנה — אין אישור למצב הנוכחי',
    'monitoring.probeReason.missing': 'טרם התקבלה מדידה מקומית',
    'monitoring.probeReason.not_configured': 'הבדיקה המקומית לא הוגדרה',
    'monitoring.probeReason.unavailable': 'המדידה המקומית אינה זמינה',
    'monitoring.probeReason.malformed': 'המדידה המקומית אינה תקינה',
    'monitoring.probeReason.oversized': 'המדידה המקומית חרגה מהגודל המותר',
    'monitoring.probeReason.future': 'חותמת הזמן של המדידה אינה תקינה',

    'monitoring.age.unknown': 'לא ידוע',
    'monitoring.age.lessThanMinute': 'פחות מדקה',
    'monitoring.age.oneMinute': 'דקה',
    'monitoring.age.minutes': '{count} דקות',
    'monitoring.age.oneHour': 'שעה',
    'monitoring.age.hours': '{count} שעות',
    'monitoring.age.oneDay': 'יום',
    'monitoring.age.days': '{count} ימים',

    'monitoring.panel.ariaLabel': 'ניטור מערכת',
    'monitoring.panel.eyebrow': 'תמונת מצב · פרטי · קריאה בלבד',
    'monitoring.panel.title': 'בריאות המערכת',
    'monitoring.panel.description': 'מידע מצרפי בלבד, ללא פרטים אישיים. אין כאן פעולות שמשנות את המערכת.',
    'monitoring.panel.refresh': 'רענון מצב',
    'monitoring.panel.refreshing': 'מרענן…',
    'monitoring.panel.loading': 'טוען תמונת מצב…',
    'monitoring.panel.authError': 'נדרשת התחברות מחדש כדי לצפות בניטור.',
    'monitoring.panel.unavailableError': 'לא ניתן לקרוא את מצב המערכת כרגע. אפשר לנסות לרענן.',
    'monitoring.panel.overallStatus': 'מצב כולל',
    'monitoring.panel.checkedAt': 'נבדק: {time} · שעון ישראל',
    'monitoring.panel.probeAge': ' · גיל המדידה בעת הרענון: {age}',
    'monitoring.panel.footer': 'הנתונים נכונים למועד הרענון האחרון · רענון ידני בלבד · אין הפעלה או עצירה של שירותים · ״לא ידוע״ אינו אישור לתקינות',

    'monitoring.card.process': 'תהליך היישום',
    'monitoring.card.database': 'מסד נתונים מקומי',
    'monitoring.card.wamBackup': 'גיבויי WAM בלתי־משתנים',
    'monitoring.card.fileBackup': 'גיבוי קבצים',
    'monitoring.card.certificate': 'תוקף תעודה מקומית',
    'monitoring.card.probe': 'עדכניות הבדיקה המקומית',
    'monitoring.card.cloudBackup': 'גיבוי ענן פרטי — מחוץ לשרת',
    'monitoring.card.timers': 'משימות מתוזמנות',
    'monitoring.card.email': 'מסירת דואר — סיכום מצרפי',

    'monitoring.process.uptime': 'זמן פעילות מאז הפעלת התהליך',
    'monitoring.process.startedAt': 'התחלה',

    'monitoring.database.wal': 'יומן WAL',
    'monitoring.database.caption': 'גודל קבצים מקומי; לא בדיקת תקינות מלאה.',
    'monitoring.database.error': 'קריאת מסד הנתונים נכשלה.',

    'monitoring.wamBackup.latestAt': 'הגיבוי האחרון',
    'monitoring.wamBackup.caption': 'נשמרים באותו מסד; אינם תחליף לגיבוי קבצים.',
    'monitoring.wamBackup.noneYet': 'עדיין אין היסטוריית גיבויים. ',

    'monitoring.fileBackup.latestAt': 'הצלחה אחרונה',
    'monitoring.fileBackup.caption': 'דיווח של משימת הגיבוי, לא בדיקת שחזור. אזהרה אחרי {age}.',
    'monitoring.fileBackup.notConfigured': 'לא הוגדר',

    'monitoring.cert.validFrom': 'בתוקף מ־',
    'monitoring.cert.expiresAt': 'תפוגה',
    'monitoring.cert.days': '{n} ימים',
    'monitoring.cert.notConfigured': 'לא הוגדרה',
    'monitoring.cert.noInfo': 'אין מידע',
    'monitoring.cert.caption': 'תעודה שנקראה מקומית בלבד. אין בדיקת HTTPS.',

    'monitoring.probe.sampledAt': 'נמדד',
    'monitoring.probe.caption': 'מדידה נחשבת ישנה אחרי {age}. הרענון קורא מידע; אינו מפעיל בדיקות.',

    'monitoring.cloudBackup.latestAt': 'העלאה אחרונה שאושרה',
    'monitoring.cloudBackup.archiveSize': 'גודל הארכיון שאושר',
    'monitoring.cloudBackup.notConfigured': 'לא הוגדר',
    'monitoring.cloudBackup.caption': 'אישור מקומי לאחר השלמת העלאה לאחסון פרטי ובדיקת מאפייני האובייקט. נפרד מגיבוי מקומי; אינו בדיקת שחזור. אזהרה אחרי {age}. הרענון כאן אינו פונה לענן.',

    'monitoring.timers.caption': 'מצב הטיימר בלבד; אינו אישור שההרצה האחרונה של השירות הצליחה.',
    'monitoring.timers.nextRun': 'הרצה הבאה: {time}',

    'monitoring.email.caption': 'רשומות מסירה נוכחיות בלבד, לא ניסיונות מצטברים. אין כתובות או תוכן הודעות.',
    'monitoring.email.colChannel': 'ערוץ',
    'monitoring.email.colSent': 'נשלח',
    'monitoring.email.colFailed': 'נכשל',
    'monitoring.email.colPending': 'ממתין',
    'monitoring.email.colSending': 'בשליחה',
    'monitoring.email.colCancelled': 'בוטל',
    'monitoring.email.colStatus': 'מצב',
    'monitoring.email.noneYet': 'טרם נשלח דואר',
    'monitoring.email.partial': 'מידע חלקי',
    'monitoring.email.noMessages': 'טרם נשלחו הודעות',
    'monitoring.email.footerCaption': 'ערוץ ללא רשומות עדיין לא נוסה — זה אינו כשל בשליחה וגם לא אישור שהשליחה פעילה. מצב המשימות המתוזמנות מוצג בנפרד למעלה.',

    'monitoring.noInfo': 'אין מידע',
  },
};
