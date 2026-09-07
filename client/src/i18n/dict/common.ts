import type { AreaDict } from '../locales';

/**
 * Shared strings used across more than one feature area: weekday names, save status,
 * generic actions and generic errors.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `common.`.
 * - Use `{name}` placeholders for interpolation.
 * - For counts, define `key_one` and `key_other` and call `t(key, { count })`.
 */
export const common: AreaDict = {
  en: {
    'common.weekday.short.0': 'Su',
    'common.weekday.short.1': 'Mo',
    'common.weekday.short.2': 'Tu',
    'common.weekday.short.3': 'We',
    'common.weekday.short.4': 'Th',
    'common.weekday.short.5': 'Fr',
    'common.weekday.short.6': 'Sa',
    'common.weekday.full.0': 'Sunday',
    'common.weekday.full.1': 'Monday',
    'common.weekday.full.2': 'Tuesday',
    'common.weekday.full.3': 'Wednesday',
    'common.weekday.full.4': 'Thursday',
    'common.weekday.full.5': 'Friday',
    'common.weekday.full.6': 'Saturday',

    'common.status.saving': 'Saving...',
    'common.status.saved': 'Saved ✓',
    'common.status.error': 'Could not save',

    'common.action.save': 'Save',
    'common.action.cancel': 'Cancel',
    'common.action.edit': 'Edit',
    'common.action.delete': 'Delete',
    'common.action.add': 'Add',
    'common.action.close': 'Close',
    'common.action.back': 'Back',
    'common.action.retry': 'Try again',

    'common.loading': 'Loading...',
    'common.error.generic': 'Something went wrong',
    'common.error.server': 'Server error ({status})',
    'common.empty': 'Nothing here yet',

    'common.day_one': '{count} day',
    'common.day_other': '{count} days',
    'common.week_one': '{count} week',
    'common.week_other': '{count} weeks',

    'common.language': 'Language',
    'common.language.switch': 'Change language',

    'common.time.justNow': 'just now',
    'common.time.minutesAgo_one': 'a minute ago',
    'common.time.minutesAgo_other': '{count} minutes ago',
    'common.time.today': 'today at {time}',
    'common.time.yesterday': 'yesterday at {time}',
    'common.time.daysAgo_one': 'a day ago',
    'common.time.daysAgo_other': '{count} days ago',
    'common.time.anyMoment': 'any moment now',
    'common.time.inMinutes_one': 'in a minute',
    'common.time.inMinutes_other': 'in {count} minutes',
    'common.time.tomorrow': 'tomorrow at {time}',
    'common.time.inDays_one': 'in a day, at {time}',
    'common.time.inDays_other': 'in {count} days, at {time}',
    'common.time.title': '{absolute} (Israel time)',
  },
  he: {
    'common.weekday.short.0': 'א׳',
    'common.weekday.short.1': 'ב׳',
    'common.weekday.short.2': 'ג׳',
    'common.weekday.short.3': 'ד׳',
    'common.weekday.short.4': 'ה׳',
    'common.weekday.short.5': 'ו׳',
    'common.weekday.short.6': 'ש׳',
    'common.weekday.full.0': 'ראשון',
    'common.weekday.full.1': 'שני',
    'common.weekday.full.2': 'שלישי',
    'common.weekday.full.3': 'רביעי',
    'common.weekday.full.4': 'חמישי',
    'common.weekday.full.5': 'שישי',
    'common.weekday.full.6': 'שבת',

    'common.status.saving': 'שומר...',
    'common.status.saved': 'נשמר ✓',
    'common.status.error': 'שגיאה בשמירה',

    'common.action.save': 'שמירה',
    'common.action.cancel': 'ביטול',
    'common.action.edit': 'עריכה',
    'common.action.delete': 'מחיקה',
    'common.action.add': 'הוספה',
    'common.action.close': 'סגירה',
    'common.action.back': 'חזרה',
    'common.action.retry': 'נסו שוב',

    'common.loading': 'טוען...',
    'common.error.generic': 'משהו השתבש',
    'common.error.server': 'שגיאת שרת ({status})',
    'common.empty': 'אין כאן כלום עדיין',

    'common.day_one': 'יום {count}',
    'common.day_other': '{count} ימים',
    'common.week_one': 'שבוע {count}',
    'common.week_other': '{count} שבועות',

    'common.language': 'שפה',
    'common.language.switch': 'החלפת שפה',

    'common.time.justNow': 'הרגע',
    'common.time.minutesAgo_one': 'לפני דקה',
    'common.time.minutesAgo_other': 'לפני {count} דקות',
    'common.time.today': 'היום, {time}',
    'common.time.yesterday': 'אתמול, {time}',
    'common.time.daysAgo_one': 'לפני יום',
    'common.time.daysAgo_other': 'לפני {count} ימים',
    'common.time.anyMoment': 'עוד רגע',
    'common.time.inMinutes_one': 'בעוד דקה',
    'common.time.inMinutes_other': 'בעוד {count} דקות',
    'common.time.tomorrow': 'מחר, {time}',
    'common.time.inDays_one': 'בעוד יום, {time}',
    'common.time.inDays_other': 'בעוד {count} ימים, {time}',
    'common.time.title': '{absolute} (שעון ישראל)',
  },
};
