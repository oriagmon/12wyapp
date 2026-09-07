import type { AreaDict } from '../locales';

/**
 * Translations for the "insights" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `insights.`.
 * - Use `{name}` placeholders for interpolation.
 * - For counts, define `key_one` and `key_other` and call `t(key, { count })`.
 */
export const insights: AreaDict = {
  en: {
    'insights.search.cycles': 'Cycles',
    'insights.search.goals': 'Goals',
    'insights.search.tactics': 'Tactics',
    'insights.search.wams': 'Accountability meetings',
    'insights.search.commitments': 'Commitments',
    'insights.search.punishments': 'Forfeits',
    'insights.search.reminders': 'Reminders',
    'insights.search.ownershipMine': 'Mine',
    'insights.search.ownershipPartner': "Partner's",
    'insights.search.ownershipShared': 'Shared',
    'insights.search.title': 'Search every cycle',
    'insights.search.help':
      'Find decisions, goals and reminders — including from cycles that already ended. Your current partner\u2019s data is shared; reminders are only the ones you created.',
    'insights.search.queryLabel': 'What are you looking for?',
    'insights.search.placeholder': 'A word, a decision or an idea…',
    'insights.search.submit': 'Search',
    'insights.search.clear': 'Clear',
    'insights.search.categoryLabel': 'Result type',
    'insights.search.all': 'Everything',
    'insights.search.idle': 'Type a phrase and press Enter to search. The characters % and _ count as ordinary text.',
    'insights.search.loading': 'Searching cycles and the archive…',
    'insights.search.noResults': 'No results found. Try a shorter phrase or a different result type.',
    'insights.search.resultsAll_one': '{count} result for “{query}”',
    'insights.search.resultsAll_other': '{count} results for “{query}”',
    'insights.search.resultsCategory_one': '{count} result in {category} for “{query}”',
    'insights.search.resultsCategory_other': '{count} results in {category} for “{query}”',
    'insights.search.archived': 'Archived',
    'insights.search.active': 'Active',
    'insights.search.week': 'Week {week}',
    'insights.search.openCycle': 'Open the cycle →',
    'insights.search.openWam': 'Open the meeting →',
    'insights.search.openReminder': 'Open the reminder →',
    'insights.search.hasMore': 'Showing {shown} of {total}. Narrow the search to reach the rest.',
  },
  he: {
    'insights.search.cycles': 'מחזורים',
    'insights.search.goals': 'מטרות',
    'insights.search.tactics': 'טקטיקות',
    'insights.search.wams': 'פגישות אחריותיות',
    'insights.search.commitments': 'התחייבויות',
    'insights.search.punishments': 'עונשים',
    'insights.search.reminders': 'תזכורות',
    'insights.search.ownershipMine': 'שלי',
    'insights.search.ownershipPartner': 'של השותף/ה',
    'insights.search.ownershipShared': 'משותף',
    'insights.search.title': 'חיפוש בכל המחזורים',
    'insights.search.help':
      'מצאו החלטות, מטרות ותזכורות — גם ממחזורים שהסתיימו. נתוני השותף/ה הנוכחי/ת משותפים; תזכורות שיצרתם בלבד.',
    'insights.search.queryLabel': 'מה לחפש?',
    'insights.search.placeholder': 'מילה, החלטה או רעיון…',
    'insights.search.submit': 'חיפוש',
    'insights.search.clear': 'ניקוי',
    'insights.search.categoryLabel': 'סוג תוצאה',
    'insights.search.all': 'הכול',
    'insights.search.idle': 'הקלידו ביטוי ולחצו Enter לחיפוש. הסימנים % ו־_ נחשבים לתווים רגילים.',
    'insights.search.loading': 'מחפשים במחזורים ובארכיון…',
    'insights.search.noResults': 'לא נמצאו תוצאות. נסו ביטוי קצר יותר או סוג תוצאה אחר.',
    'insights.search.resultsAll_one': '{count} תוצאות עבור ״{query}״',
    'insights.search.resultsAll_other': '{count} תוצאות עבור ״{query}״',
    'insights.search.resultsCategory_one': '{count} תוצאות בקטגוריית {category} עבור ״{query}״',
    'insights.search.resultsCategory_other': '{count} תוצאות בקטגוריית {category} עבור ״{query}״',
    'insights.search.archived': 'ארכיון',
    'insights.search.active': 'פעיל',
    'insights.search.week': 'שבוע {week}',
    'insights.search.openCycle': 'פתיחת המחזור ←',
    'insights.search.openWam': 'פתיחת הפגישה ←',
    'insights.search.openReminder': 'פתיחת התזכורת ←',
    'insights.search.hasMore': 'מוצגות {shown} מתוך {total}. דייקו את החיפוש כדי להגיע לתוצאות נוספות.',
  },
};
