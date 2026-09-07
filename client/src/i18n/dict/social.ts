import type { AreaDict } from '../locales';

/**
 * Translations for the "social" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `social.`.
 * - Use `{name}` placeholders for interpolation.
 * - For counts, define `key_one` and `key_other` and call `t(key, { count })`.
 */
export const social: AreaDict = {
  en: {
    'social.broost.replyLength': 'Write a message between 1 and {max} characters',
    'social.broost.replySent': 'Your reply was sent to {name}',
    'social.broost.bellUnread_one': 'BROOST — {count} unread notification',
    'social.broost.bellUnread_other': 'BROOST — {count} unread notifications',
    'social.broost.bellEmpty': 'BROOST — no new notifications',
    'social.broost.popoverLabel': 'BROOST notifications',
    'social.broost.loadError': 'Could not load BROOST notifications',
    'social.broost.empty': 'No new BROOSTs',
    'social.broost.markRead': 'Mark as read',
    'social.broost.reply': 'Reply with a message',
    'social.broost.replyTo': 'Reply to {name}',
    'social.broost.replyPlaceholder': 'Write a personal message...',
    'social.broost.sending': 'Sending...',
    'social.broost.send': 'Send reply',
    'social.broost.markAllRead': 'Mark everything as read',
    'social.broost.historyHint': 'Open the BROOST tab to see the full history',
    'social.partner.loading': 'Loading partnerships...',
    'social.partner.title': 'Accountability partner',
    'social.partner.connected': 'Connected with {name}',
    'social.partner.pickHint':
      'Picking a partner shares both boards immediately and both ways — no extra invitation.',
    'social.partner.pickHint2':
      'Only accounts available for sharing under the access policy are listed. Make sure you pick the right person.',
    'social.partner.searchPlaceholder': 'Search by email...',
    'social.partner.searchLabel': 'Search for a person to pick as a partner',
    'social.partner.noneAvailable': 'No accounts are available for sharing right now.',
    'social.partner.noResults': 'No results found.',
    'social.partner.pick': 'Pick as partner',
    'social.partner.remove': 'Stop sharing',
    'social.partner.confirmRemove': 'Confirm removal?',
    'social.partner.confirmYes': 'Yes, remove',
  },
  he: {
    'social.broost.replyLength': 'יש לכתוב הודעה באורך 1–{max} תווים',
    'social.broost.replySent': 'התגובה נשלחה ל{name}',
    'social.broost.bellUnread_one': 'BROOST — {count} התראה שלא נקראה',
    'social.broost.bellUnread_other': 'BROOST — {count} התראות שלא נקראו',
    'social.broost.bellEmpty': 'BROOST — אין התראות חדשות',
    'social.broost.popoverLabel': 'התראות BROOST',
    'social.broost.loadError': 'שגיאה בטעינת התראות BROOST',
    'social.broost.empty': 'אין BROOSTs חדשים',
    'social.broost.markRead': 'סימון כנקרא',
    'social.broost.reply': 'השבה בהודעה',
    'social.broost.replyTo': 'תגובה ל{name}',
    'social.broost.replyPlaceholder': 'כתבו הודעה אישית...',
    'social.broost.sending': 'שולח...',
    'social.broost.send': 'שליחת תגובה',
    'social.broost.markAllRead': 'סימון הכל כנקרא',
    'social.broost.historyHint': 'לצפייה בהיסטוריה המלאה יש לעבור לטאב BROOST',
    'social.partner.loading': 'טוען שותפויות...',
    'social.partner.title': 'שותף/ה לאחריותיות',
    'social.partner.connected': 'מחוברים עם {name}',
    'social.partner.pickHint':
      'בחירת שותף/ה יוצרת שיתוף מיידי ודו-כיווני — ללא הזמנה נוספת.',
    'social.partner.pickHint2':
      'מוצגים רק חשבונות הזמינים לשיתוף לפי מדיניות הגישה. ודאו שבחרתם את השותף/ה הנכון/ה.',
    'social.partner.searchPlaceholder': 'חיפוש לפי אימייל...',
    'social.partner.searchLabel': 'חיפוש משתמש/ת לבחירה כשותף/ה',
    'social.partner.noneAvailable': 'אין כרגע חשבונות זמינים לשיתוף.',
    'social.partner.noResults': 'לא נמצאו תוצאות.',
    'social.partner.pick': 'בחירה כשותף/ה',
    'social.partner.remove': 'הסרת שיתוף',
    'social.partner.confirmRemove': 'לאשר הסרה?',
    'social.partner.confirmYes': 'כן, הסר',
  },
};
