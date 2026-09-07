import type { AreaDict } from '../locales';

/**
 * Translations for the "dashboard" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `dashboard.`.
 * - Use `{name}` placeholders for interpolation.
 * - For counts, define `key_one` and `key_other` and call `t(key, { count })`.
 */
export const dashboard: AreaDict = {
  en: {
    'dashboard.hero.label': 'The main goal',
    'dashboard.hero.weeks': '12 weeks',
    'dashboard.hero.tactics_one': '{count} tactic',
    'dashboard.hero.tactics_other': '{count} tactics',
    'dashboard.hero.thisWeek': 'This week: {score}',
    'dashboard.hero.standard': 'Success standard: {target}%',
    'dashboard.streak.label': 'Your success-day streak',
    'dashboard.streak.sideLabel': 'More streak numbers',
    'dashboard.streak.unit_one': 'success day in a row',
    'dashboard.streak.unit_other': 'success days in a row',
    'dashboard.streak.personalBest': 'personal best',
    'dashboard.streak.best': 'Longest streak',
    'dashboard.streak.days_one': 'day',
    'dashboard.streak.days_other': 'days',
    'dashboard.streak.targetDays': 'Days that hit the target',
    'dashboard.streak.inCycle': 'this cycle',
    'dashboard.streak.ended': 'The cycle is over — your streak is kept in the history.',
    'dashboard.streak.broken': 'Streak broken. One day above {target}% starts a new one.',
    'dashboard.streak.none': 'One day above {target}% and the streak begins.',
    'dashboard.streak.record': "This is the longest you've ever gone. Don't break it.",
    'dashboard.streak.toBeat_one': 'One more day and you beat your record.',
    'dashboard.streak.toBeat_other': '{count} more days and you beat your record.',
    'dashboard.streak.alive': 'The streak is alive. Every day you hit the target extends it.',

    'dashboard.score.week': 'Week {week}',
    'dashboard.score.nothingScheduled': 'Nothing scheduled this week',
    'dashboard.score.aboveTarget': '🏆 You beat the 85% target!',
    'dashboard.score.remainingPrefix': 'You need',
    'dashboard.score.remainingSuffix': 'more to hit 85%',
    'dashboard.score.progressLabel': 'Weekly progress: {score}%',
    'dashboard.score.noTactics': "No tactics for this week yet — one is enough to start.",
    'dashboard.score.strong': 'What a week. You kept the promises you made to yourself. ✨',
    'dashboard.score.almost': "Almost there — a few more and you're above target. Keep going!",
    'dashboard.score.building': 'Momentum is building. Every tick gets you closer.',
    'dashboard.score.start': 'Just tracking it is a good start. Pick one small thing to do next.',

    'dashboard.duo.current': 'Duo streak',
    'dashboard.duo.best': 'Best ever',
    'dashboard.duo.wins': 'Weeks you both won',
    'dashboard.duo.never':
      'No winning Duo week yet — once you both reach 85% or more in a finished weekly meeting, your shared streak starts here.',
    'dashboard.duo.stopped': 'The shared streak stopped — one winning Duo week restarts it.',

    'dashboard.cycle.currentWeek': 'Current week: {week} of 12',
    'dashboard.cycle.cancel': 'Cancel',

    'dashboard.progress.label': 'Progress',
    'dashboard.progress.eyebrow': 'The cycle',
    'dashboard.progress.week': 'Week {week}',
    'dashboard.progress.ofTwelve': ' of 12',
    'dashboard.progress.barLabel': '{percent}% of the cycle behind you',
    'dashboard.progress.summary': '{percent}% of the way · {remaining}',
    'dashboard.progress.lastWeek': 'last week',
    'dashboard.progress.weeksLeft_one': '{count} week to go',
    'dashboard.progress.weeksLeft_other': '{count} weeks to go',

    'dashboard.progress.scoreEyebrow': 'This week',
    'dashboard.progress.ofTarget': ' of the {target}% target',
    'dashboard.progress.noTactics': 'Nothing scheduled this week',
    'dashboard.progress.scoreLabel': 'This week against the {target}% target',
    'dashboard.progress.aboveTarget': '🏆 Above target',
    'dashboard.progress.toTarget': '{percent}% to go',

    'dashboard.progress.meetingThisWeek':
      'The {month} monthly review is this week. Stop, look back, and point yourselves again.',
    'dashboard.progress.meetingNextWeek':
      'The {month} monthly review is next week — worth putting it in the calendar now.',
    'dashboard.progress.meetingLater': 'The next monthly review is in week {week}.',
    'dashboard.progress.lastWeekOfCycle':
      'This is the last week of the cycle — time to wrap up, celebrate, and plan the next one.',
    'dashboard.progress.monthSummary': '{month} review',
    'dashboard.progress.meetingWeek': 'Week {week}',
    'dashboard.progress.meetingSchedule': ' · schedule it now',
    'dashboard.progress.meetingCurrent': ' · this week',
    'dashboard.progress.meetingDone': ' · done',

    'dashboard.cycle.nameLabel': 'Cycle name',
    'dashboard.cycle.prevWeek': 'Previous week',
    'dashboard.cycle.nextWeek': 'Next week',
    'dashboard.cycle.endAndStart': 'End this cycle and start a new one',
    'dashboard.cycle.confirmLabel': 'Confirm ending the cycle',
    'dashboard.cycle.confirmBody':
      'This cycle — every goal, tactic and tick in it — is kept forever as read-only history you can open any time from the "Past cycles" tab. Nothing is deleted. Name the new cycle:',
    'dashboard.cycle.newNamePlaceholder': 'For example: Spring 2026',
    'dashboard.cycle.newNameLabel': 'Name of the new cycle',
    'dashboard.cycle.confirmEnd': 'Yes, end the cycle',
  },
  he: {
    'dashboard.hero.label': 'המטרה המרכזית',
    'dashboard.hero.weeks': '12 שבועות',
    'dashboard.hero.tactics_one': '{count} טקטיקה למטרה',
    'dashboard.hero.tactics_other': '{count} טקטיקות למטרה',
    'dashboard.hero.thisWeek': 'ביצוע השבוע: {score}',
    'dashboard.hero.standard': 'סטנדרט הצלחה: {target}%',
    'dashboard.streak.label': 'רצף ימי ההצלחה',
    'dashboard.streak.sideLabel': 'נתוני רצף נוספים',
    'dashboard.streak.unit_one': 'יום הצלחה ברצף',
    'dashboard.streak.unit_other': 'ימי הצלחה ברצף',
    'dashboard.streak.personalBest': 'שיא אישי',
    'dashboard.streak.best': 'הרצף הטוב ביותר',
    'dashboard.streak.days_one': 'יום',
    'dashboard.streak.days_other': 'ימים',
    'dashboard.streak.targetDays': 'ימים שהגיעו ליעד',
    'dashboard.streak.inCycle': 'במחזור',
    'dashboard.streak.ended': 'המחזור הסתיים — הרצף נשמר בהיסטוריה.',
    'dashboard.streak.broken': 'הרצף נקטע. יום אחד מעל {target}% מתחיל רצף חדש.',
    'dashboard.streak.none': 'יום אחד מעל {target}% ומתחילים רצף.',
    'dashboard.streak.record': 'זה הרצף הכי ארוך שלך עד היום. אל תשברו אותו.',
    'dashboard.streak.toBeat_one': 'עוד יום אחד ותשברו את השיא שלכם.',
    'dashboard.streak.toBeat_other': 'עוד {count} ימים ותשברו את השיא שלכם.',
    'dashboard.streak.alive': 'הרצף פעיל. כל יום שמגיע ליעד מאריך אותו.',

    'dashboard.score.week': 'שבוע {week}',
    'dashboard.score.nothingScheduled': 'אין תוכניות מתוזמנות השבוע',
    'dashboard.score.aboveTarget': '🏆 עברת את יעד ה־85!',
    'dashboard.score.remainingPrefix': 'נותרו',
    'dashboard.score.remainingSuffix': 'ליעד 85%',
    'dashboard.score.progressLabel': 'התקדמות שבועית: {score}%',
    'dashboard.score.noTactics': 'עוד לא הוגדרו טקטיקות לשבוע — אפשר להתחיל מאחת.',
    'dashboard.score.strong': 'איזה שבוע חזק! שמרתם על ההבטחות שלכם לעצמכם. ✨',
    'dashboard.score.almost': 'כמעט שם — עוד כמה ביצועים ואתם מעל היעד. קדימה!',
    'dashboard.score.building': 'התנופה נבנית. כל סימון מקרב אתכם ליעד.',
    'dashboard.score.start': 'עצם המעקב הוא התחלה מצוינת. בחרו פעולה אחת קטנה להמשך.',

    'dashboard.duo.current': 'רצף Duo נוכחי',
    'dashboard.duo.best': 'השיא',
    'dashboard.duo.wins': 'שבועות מנצחים ביחד',
    'dashboard.duo.never':
      'עדיין אין שבוע Duo מנצח — כששניכם תגיעו ל־85% ומעלה בפגישה שבועית שהושלמה, הרצף המשותף שלכם יתחיל כאן.',
    'dashboard.duo.stopped': 'הרצף המשותף נעצר — שבוע Duo מנצח אחד יחדש אותו.',

    'dashboard.cycle.currentWeek': 'שבוע נוכחי: {week} מתוך 12',
    'dashboard.cycle.cancel': 'ביטול',

    'dashboard.progress.label': 'התקדמות',
    'dashboard.progress.eyebrow': 'המחזור',
    'dashboard.progress.week': 'שבוע {week}',
    'dashboard.progress.ofTwelve': ' מתוך 12',
    'dashboard.progress.barLabel': '{percent}% מהמחזור מאחורינו',
    'dashboard.progress.summary': '{percent}% מהדרך · {remaining}',
    'dashboard.progress.lastWeek': 'השבוע האחרון',
    'dashboard.progress.weeksLeft_one': 'נותר {count} שבוע',
    'dashboard.progress.weeksLeft_other': 'נותרו {count} שבועות',

    'dashboard.progress.scoreEyebrow': 'ביצוע השבוע',
    'dashboard.progress.ofTarget': ' מתוך יעד {target}%',
    'dashboard.progress.noTactics': 'אין טקטיקות מתוזמנות השבוע',
    'dashboard.progress.scoreLabel': 'ביצוע השבוע מול יעד {target}%',
    'dashboard.progress.aboveTarget': '🏆 מעל היעד',
    'dashboard.progress.toTarget': 'נותרו {percent}% ליעד',

    'dashboard.progress.meetingThisWeek':
      'השבוע פגישת הסיכום החודשית {month}. עוצרים, מסתכלים אחורה ומכוונים מחדש.',
    'dashboard.progress.meetingNextWeek':
      'בשבוע הבא פגישת הסיכום החודשית {month} — שווה לקבוע אותה ביומן כבר עכשיו.',
    'dashboard.progress.meetingLater': 'פגישת הסיכום החודשית הבאה בשבוע {week}.',
    'dashboard.progress.lastWeekOfCycle':
      'זה השבוע האחרון במחזור — זמן לסכם, לחגוג ולתכנן את הבא.',
    'dashboard.progress.monthSummary': 'סיכום חודש {month}',
    'dashboard.progress.meetingWeek': 'שבוע {week}',
    'dashboard.progress.meetingSchedule': ' · לקבוע עכשיו',
    'dashboard.progress.meetingCurrent': ' · השבוע',
    'dashboard.progress.meetingDone': ' · הושלם',

    'dashboard.cycle.nameLabel': 'שם המחזור',
    'dashboard.cycle.prevWeek': 'שבוע קודם',
    'dashboard.cycle.nextWeek': 'שבוע הבא',
    'dashboard.cycle.endAndStart': 'סיום מחזור והתחלת מחזור חדש',
    'dashboard.cycle.confirmLabel': 'אישור סיום מחזור',
    'dashboard.cycle.confirmBody':
      'המחזור הנוכחי (כולל כל המטרות, הטקטיקות והביצועים) יישמר לצמיתות כהיסטוריה לקריאה בלבד, וניתן יהיה לצפות בו בכל עת בלשונית "מחזורים קודמים". שום דבר לא נמחק. שם למחזור החדש:',
    'dashboard.cycle.newNamePlaceholder': 'לדוגמה: מחזור אביב 2026',
    'dashboard.cycle.newNameLabel': 'שם המחזור החדש',
    'dashboard.cycle.confirmEnd': 'אישור וסיום המחזור',
  },
};
