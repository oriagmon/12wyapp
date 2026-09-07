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

    'common.error.unknown': 'Unknown error',
    'common.error.login': "Couldn't sign you in",
    'common.error.register': "Couldn't create your account",

    'common.nav.skipToContent': 'Skip to main content',
    'common.nav.tabs': 'Move between dashboard areas',
    'common.nav.primary': 'Main navigation',
    'common.nav.primaryMobile': 'Main navigation (mobile)',
    'common.nav.more': 'More',
    'common.nav.moreTitle': 'Where to next?',
    'common.nav.closeMenu': 'Close navigation menu',
    'common.nav.moreGroup': 'More tools',
    'common.nav.home': 'Home',
    'common.nav.week': 'This week',
    'common.nav.goals': 'Goals',
    'common.nav.wams': 'Our meeting',

    'common.theme.toLight': 'Switch to light mode',
    'common.theme.toDark': 'Switch to dark mode',
    'common.theme.light': 'Light',
    'common.theme.dark': 'Dark',
    'common.logout': 'Sign out',

    'common.board.picker': 'Choose a dashboard',
    'common.board.mine': 'My dashboard',
    'common.board.partner': "{name}'s dashboard · read only",

    'common.color.emerald': 'Emerald',
    'common.color.blue': 'Blue',
    'common.color.purple': 'Purple',
    'common.color.gold': 'Gold',

    'common.route.invalid':
      "That address isn't valid, or points somewhere this app can't go. Head back to your own dashboard and pick again.",
    'common.route.unverifiable':
      "Can't check right now whether you have access to the dashboard in that address. Try reloading your partnership, or switch to your own dashboard.",
    'common.route.unavailable':
      "The dashboard in that address isn't part of your current partnership. You haven't been moved anywhere — pick your own dashboard to continue.",
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

    'common.error.unknown': 'שגיאה לא ידועה',
    'common.error.login': 'שגיאה בהתחברות',
    'common.error.register': 'שגיאה בהרשמה',

    'common.nav.skipToContent': 'דילוג לתוכן הראשי',
    'common.nav.tabs': 'ניווט בין אזורי הלוח',
    'common.nav.primary': 'ניווט ראשי',
    'common.nav.primaryMobile': 'ניווט ראשי בנייד',
    'common.nav.more': 'עוד',
    'common.nav.moreTitle': 'לאן ממשיכים?',
    'common.nav.closeMenu': 'סגירת תפריט ניווט',
    'common.nav.moreGroup': 'כלים נוספים',
    'common.nav.home': 'בית',
    'common.nav.week': 'השבוע',
    'common.nav.goals': 'מטרות',
    'common.nav.wams': 'פגישה משותפת',

    'common.theme.toLight': 'עבור למצב בהיר',
    'common.theme.toDark': 'עבור למצב כהה',
    'common.theme.light': 'בהיר',
    'common.theme.dark': 'כהה',
    'common.logout': 'התנתקות',

    'common.board.picker': 'בחירת לוח לצפייה',
    'common.board.mine': 'הלוח שלי',
    'common.board.partner': 'הלוח של {name} · צפייה בלבד',

    'common.color.emerald': 'אזמרגד',
    'common.color.blue': 'כחול',
    'common.color.purple': 'סגול',
    'common.color.gold': 'זהב',

    'common.route.invalid':
      'הכתובת אינה תקינה או מכילה אפשרות ניווט שאינה נתמכת. אפשר לחזור ללוח האישי ולבחור יעד מחדש.',
    'common.route.unverifiable':
      'לא ניתן לאמת כרגע גישה ללוח שבכתובת. נסו לטעון שוב את השותפות, או עברו במפורש ללוח האישי.',
    'common.route.unavailable':
      'הלוח שבכתובת אינו זמין במסגרת השותפות הנוכחית. לא הועברתם ללוח אחר; אפשר לבחור במפורש בלוח האישי.',
  },
};
