import type { AreaDict } from '../locales';

/**
 * Translations for the "reminders" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `reminders.`.
 * - Use `{name}` placeholders for interpolation.
 */
export const reminders: AreaDict = {
  en: {
    'reminders.quickTime.tomorrow': 'Tomorrow morning',
    'reminders.quickTime.threeDays': 'In three days',
    'reminders.quickTime.beforeWam': 'Before the next WAM',
    'reminders.quickTime.oneWeek': 'In a week',

    'reminders.status.pending': 'Scheduled',
    'reminders.status.sending': 'Sending...',
    'reminders.status.sent': 'Sent ✓',
    'reminders.status.failed': 'Failed',
    'reminders.status.cancelled': 'Cancelled',

    'reminders.loading': 'Loading reminders...',
    'reminders.loadError': 'Cannot load reminders right now.',
    'reminders.retry': 'Try again',

    'reminders.focus.found': 'The search result is highlighted in the list. All reminders are shown, including sent and cancelled ones.',
    'reminders.focus.notFound': 'The requested reminder is not available. It may have been deleted, or you may not have permission to view it.',
    'reminders.focus.back': 'Back to the reminders list',
    'reminders.listLabel': 'Reminders list',
    'reminders.empty': 'No reminders scheduled yet. Use the form above to create your first one.',

    'reminders.form.titleNew': 'New reminder',
    'reminders.form.titleEdit': 'Edit reminder',
    'reminders.form.title': 'Title',
    'reminders.form.titlePlaceholder': 'e.g. Send an update to your partner',
    'reminders.form.body': 'Body (optional)',
    'reminders.form.when': 'Send at (Israel time)',
    'reminders.form.quickTimesLabel': 'Quick times',
    'reminders.form.recipient': 'Recipient',
    'reminders.form.submitNew': 'Schedule reminder',
    'reminders.form.submitEdit': 'Save changes',
    'reminders.form.cancelEdit': 'Cancel editing',

    'reminders.error.emptyTitle': 'The reminder title cannot be empty',
    'reminders.error.emptyDate': 'Please choose a date and time for the reminder',
    'reminders.error.invalidDate': 'Invalid time (Israel time) — this may be a time that does not exist due to a daylight-saving change',
    'reminders.error.pastDate': 'The reminder time must be in the future',

    'reminders.recipient.self': 'To me ({email})',
    'reminders.recipient.partner': 'To {name}',
    'reminders.recipient.both': 'To both of us',
    'reminders.recipient.unavailable': 'Please re-select a recipient',
    'reminders.recipient.changedError': 'The partnership changed. Please re-select a recipient before scheduling the reminder.',
    'reminders.recipient.bothHelp': 'A separate reminder will be created for each of us, with independent send and cancel status.',

    'reminders.prefillNotice': 'The original time ({originalTime}) has already passed — a new future time was suggested; you can change it as needed.',

    'reminders.card.willBeSent': 'Will be sent',
    'reminders.card.scheduledFor': 'Scheduled for',
    'reminders.card.toSelf': 'to me',
    'reminders.card.toPartner': 'to {name}',
    'reminders.card.lastError': 'Last send error: {error}',
    'reminders.card.sentAt': 'Sent',
    'reminders.card.edit': 'Edit',
    'reminders.card.editRetry': 'Edit / Retry',
    'reminders.card.cancel': 'Cancel reminder',
    'reminders.confirmCancel': 'Cancel the reminder "{title}"? It will not be sent.',
  },
  he: {
    'reminders.quickTime.tomorrow': 'מחר בבוקר',
    'reminders.quickTime.threeDays': 'עוד שלושה ימים',
    'reminders.quickTime.beforeWam': 'לפני ה‑WAM הבא',
    'reminders.quickTime.oneWeek': 'בעוד שבוע',

    'reminders.status.pending': 'ממתינה',
    'reminders.status.sending': 'בשליחה...',
    'reminders.status.sent': 'נשלחה ✓',
    'reminders.status.failed': 'נכשלה',
    'reminders.status.cancelled': 'בוטלה',

    'reminders.loading': 'טוען תזכורות...',
    'reminders.loadError': 'לא ניתן לטעון תזכורות כרגע.',
    'reminders.retry': 'ניסיון נוסף',

    'reminders.focus.found': 'תוצאת החיפוש מסומנת ברשימה. מוצגות כל התזכורות, כולל תזכורות שנשלחו או בוטלו.',
    'reminders.focus.notFound': 'התזכורת המבוקשת אינה זמינה. ייתכן שנמחקה או שאין לך הרשאה לצפות בה.',
    'reminders.focus.back': 'חזרה לרשימת התזכורות',
    'reminders.listLabel': 'רשימת התזכורות',
    'reminders.empty': 'עדיין לא נקבעו תזכורות. השתמשו בטופס למעלה כדי ליצור תזכורת ראשונה.',

    'reminders.form.titleNew': 'תזכורת חדשה',
    'reminders.form.titleEdit': 'עריכת תזכורת',
    'reminders.form.title': 'כותרת',
    'reminders.form.titlePlaceholder': 'למשל: לשלוח עדכון לשותף/ה',
    'reminders.form.body': 'תוכן (אופציונלי)',
    'reminders.form.when': 'מתי לשלוח (שעון ישראל)',
    'reminders.form.quickTimesLabel': 'מועדים מהירים',
    'reminders.form.recipient': 'נמען/ת',
    'reminders.form.submitNew': 'קביעת תזכורת',
    'reminders.form.submitEdit': 'שמירת שינויים',
    'reminders.form.cancelEdit': 'ביטול עריכה',

    'reminders.error.emptyTitle': 'כותרת התזכורת לא יכולה להיות ריקה',
    'reminders.error.emptyDate': 'יש לבחור תאריך ושעה לתזכורת',
    'reminders.error.invalidDate': 'מועד לא תקין (שעון ישראל) — ייתכן שמדובר בשעה שאינה קיימת עקב מעבר לשעון קיץ/חורף',
    'reminders.error.pastDate': 'מועד התזכורת חייב להיות בעתיד',

    'reminders.recipient.self': 'אליי ({email})',
    'reminders.recipient.partner': 'אל {name}',
    'reminders.recipient.both': 'לשנינו',
    'reminders.recipient.unavailable': 'יש לבחור נמען/ת מחדש',
    'reminders.recipient.changedError': 'השותפות השתנתה. יש לבחור נמען/ת מחדש לפני קביעת התזכורת.',
    'reminders.recipient.bothHelp': 'לכל אחד מאיתנו תיווצר תזכורת נפרדת, עם מצב שליחה וביטול נפרדים.',

    'reminders.prefillNotice': 'המועד המקורי ({originalTime}) כבר עבר — הוצע מועד חדש בעתיד הקרוב; ניתן לשנות אותו לפי הצורך.',

    'reminders.card.willBeSent': 'תישלח',
    'reminders.card.scheduledFor': 'למועד',
    'reminders.card.toSelf': 'אליי',
    'reminders.card.toPartner': 'אל {name}',
    'reminders.card.lastError': 'שגיאת שליחה אחרונה: {error}',
    'reminders.card.sentAt': 'נשלחה',
    'reminders.card.edit': 'עריכה',
    'reminders.card.editRetry': 'עריכה / ניסיון חוזר',
    'reminders.card.cancel': 'ביטול התזכורת',
    'reminders.confirmCancel': 'לבטל את התזכורת "{title}"? היא לא תישלח.',
  },
};
