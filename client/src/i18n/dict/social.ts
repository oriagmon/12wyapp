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
