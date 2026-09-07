import type { AreaDict } from '../locales';

/**
 * The weekly accountability meeting ("WAM"): the meeting list, the score review the two
 * partners run together, next week's commitments, and the forfeits attached to them.
 */
export const wams: AreaDict = {
  en: {
    'wams.loadingList': 'Loading meetings...',
    'wams.loadingOne': 'Loading meeting...',
    'wams.retry': 'Try again',
    'wams.backToList': 'Back to the meeting list',

    'wams.scope.shared': 'Shared',

    'wams.commitments.title': 'Commitments for next week',
    'wams.commitments.empty': 'No commitments yet. Add the first one.',
    'wams.commitments.placeholder': 'New commitment...',
    'wams.commitments.newLabel': 'New commitment text',
    'wams.commitments.scopeLabel': 'Who this commitment is for',
    'wams.commitments.add': 'Add',
    'wams.commitments.text': 'Commitment text',
    'wams.commitments.deleteLabel': 'Delete commitment',
    'wams.commitments.delete': 'Delete',
    'wams.locked': 'This meeting is locked as history from a finished cycle and can no longer be edited.',
    'wams.completed': 'This meeting is done — you can still tick things off, but adding or editing text needs it reopened.',

    'wams.review.title': 'Score review — week {week}',
    'wams.review.me': '(you)',
    'wams.review.frozen': 'Frozen (completed)',
    'wams.review.live': 'Live — as of today',
    'wams.review.cycle': 'Cycle: {name}{ended} · current week: {week}',
    'wams.review.cycleEnded': ' (ended)',
    'wams.review.noCycle': 'No active cycle',
    'wams.review.myRating': 'My self-rating (1-10)',
    'wams.review.theirRating': 'Self-rating',
    'wams.review.sideA': 'Side A',
    'wams.review.sideB': 'Side B',
    'wams.review.lockedNote':
      '🔒 This meeting belongs to a finished cycle — everything here is kept permanently as read-only history.',
    'wams.review.driftNote':
      "⚠️ Heads up: the two of you are on different weeks of your own cycles. Nothing syncs automatically — each of you moves at your own pace.",

    'wams.punishments.dueTitle': 'Forfeits due this week',
    'wams.punishments.markLabel': 'Mark "{label}" as done',
    'wams.punishments.by': 'From {name}',
    'wams.punishments.on': 'For {name}',
    'wams.punishments.fromWeek': 'From the week {week} meeting',
    'wams.punishments.done': '✔️ Done',
  },
  he: {
    'wams.loadingList': 'טוען פגישות אחריותיות...',
    'wams.loadingOne': 'טוען פגישה...',
    'wams.retry': 'ניסיון נוסף',
    'wams.backToList': 'חזרה לרשימת הפגישות',

    'wams.scope.shared': 'משותף',

    'wams.commitments.title': 'התחייבויות לשבוע הבא',
    'wams.commitments.empty': 'עדיין אין התחייבויות. הוסיפו את הראשונה.',
    'wams.commitments.placeholder': 'התחייבות חדשה...',
    'wams.commitments.newLabel': 'טקסט התחייבות חדשה',
    'wams.commitments.scopeLabel': 'שיוך ההתחייבות',
    'wams.commitments.add': 'הוספה',
    'wams.commitments.text': 'טקסט ההתחייבות',
    'wams.commitments.deleteLabel': 'מחיקת התחייבות',
    'wams.commitments.delete': 'מחיקה',
    'wams.locked': 'פגישה זו נעולה כהיסטוריה של מחזור שהסתיים ולא ניתנת עוד לעריכה.',
    'wams.completed': 'הפגישה הושלמה — ניתן עדיין לסמן ביצוע, אך הוספה/עריכת טקסט דורשת פתיחה מחדש.',

    'wams.review.title': 'סקירת ציונים — שבוע {week}',
    'wams.review.me': '(את/ה)',
    'wams.review.frozen': 'קפוא (הושלם)',
    'wams.review.live': 'חי — נכון להיום',
    'wams.review.cycle': 'מחזור: {name}{ended} · שבוע נוכחי: {week}',
    'wams.review.cycleEnded': ' (הסתיים)',
    'wams.review.noCycle': 'אין מחזור פעיל',
    'wams.review.myRating': 'הדירוג העצמי שלי (1-10)',
    'wams.review.theirRating': 'דירוג עצמי',
    'wams.review.sideA': 'צד א׳',
    'wams.review.sideB': 'צד ב׳',
    'wams.review.lockedNote':
      '🔒 פגישה זו שייכת למחזור שהסתיים — כל הנתונים כאן נשמרים לצמיתות כהיסטוריה לקריאה בלבד.',
    'wams.review.driftNote':
      '⚠️ שימו לב: השבוע הנוכחי במחזורים של שני הצדדים שונה. אין סנכרון אוטומטי — כל אחד/ת ממשיך/ה בקצב שלו/ה.',

    'wams.punishments.dueTitle': 'עונשים לביצוע השבוע',
    'wams.punishments.markLabel': 'סימון "{label}" כבוצע',
    'wams.punishments.by': 'מאת {name}',
    'wams.punishments.on': 'על {name}',
    'wams.punishments.fromWeek': 'מפגישת שבוע {week}',
    'wams.punishments.done': '✔️ בוצע',
  },
};
