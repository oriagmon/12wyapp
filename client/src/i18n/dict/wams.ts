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

    'wams.punishments.title': 'Forfeits',
    'wams.punishments.empty': 'No forfeits written down in this meeting yet.',
    'wams.punishments.placeholder': 'New forfeit...',
    'wams.punishments.newLabel': 'New forfeit text',
    'wams.punishments.assignLabel': 'Who the forfeit is on',
    'wams.punishments.onMe': 'On me',
    'wams.punishments.onPartner': 'On my partner',
    'wams.punishments.add': 'Add',
    'wams.punishments.blocked':
      'You can\'t add a forfeit right now — the meeting it would attach to is already completed or locked as history. Reopen it to add forfeits.',
    'wams.punishments.text': 'Forfeit text',
    'wams.punishments.reassign': 'Reassign the forfeit',
    'wams.punishments.deleteLabel': 'Delete forfeit',
    'wams.punishments.delete': 'Delete',
    'wams.punishments.confirmLabel': 'Confirm action on a completed forfeit',
    'wams.punishments.confirmReassign':
      'This forfeit is already marked done. Changing who it is on will clear that. Are you sure?',
    'wams.punishments.confirmDelete': 'This forfeit is already marked done. Delete it anyway?',
    'wams.punishments.confirmYes': 'Confirm',
    'wams.punishments.confirmNo': 'Cancel',

    'wams.invite.sent': 'Invitation sent ✓',
    'wams.invite.failed': 'Invitation failed to send',
    'wams.invite.pending': 'No invitation sent yet',

    'wams.schedule.badDate':
      'Invalid date (Israel time) — that hour may not exist because of the daylight-saving switch',
    'wams.schedule.pastDate': 'The next meeting has to be in the future',
    'wams.schedule.badDuration': 'The meeting length must be a whole number between 1 and 1440 minutes',
    'wams.schedule.needDate': 'Pick a time for the next meeting before sending invitations',
    'wams.schedule.cannotCancel':
      "You can't cancel an existing time for the next meeting — you can change it, but not remove it (there's no support for cancelling calendar invitations already sent).",

    'wams.schedule.title': 'The next WAM — shall we set a time?',
    'wams.schedule.readOnly': 'View only',
    'wams.schedule.optional': 'Optional',
    'wams.schedule.setFor': 'The next WAM is set for:',
    'wams.schedule.when': '{when} (Israel time), for {minutes} minutes',
    'wams.schedule.statusHint': 'Sending status is not an RSVP, and not confirmation the event landed in a calendar.',
    'wams.schedule.none': 'No time set for the next meeting yet.',
    'wams.schedule.lockedHint': 'The time and invitation status are shown as they were saved. They cannot be changed from this view.',
    'wams.schedule.draftHint':
      "You can set a shared time now and send invitations to both calendars — without completing the meeting. Completing it is a separate action that freezes the scores.",
    'wams.schedule.doneHint':
      "You can set or update the next meeting without reopening the completed one. The saved scores and content stay as they are.",
    'wams.schedule.fieldLabel': 'Time for the next WAM ({changeability}, Israel time)',
    'wams.schedule.changeable': 'can be changed, not cancelled',
    'wams.schedule.optionalField': 'optional',
    'wams.schedule.duration': 'Length (minutes)',
    'wams.schedule.retryHint':
      "Some invitations didn't go out. Retrying with the same time and length only sends to whoever hasn't received one yet. Changing the time or length sends an update to both of you.",

    'wams.schedule.alreadySent': 'Invitations sent — you can still update the time',
    'wams.schedule.retry': 'Try sending the invitations again',
    'wams.schedule.update': 'Update the time and send to calendars',
    'wams.schedule.send': '📅 Send calendar invitations',

    'wams.complete.cta': '✓ Mark the meeting as done',
    'wams.complete.confirmWithDate':
      'Completing the meeting freezes both of your current execution scores. The time you picked will not be saved and no invitations will go out — to send them, press "Send calendar invitations" first. Continue?',
    'wams.complete.confirm':
      'Completing the meeting freezes both of your current execution scores. Continue?',
    'wams.complete.yes': 'Yes, complete the meeting',
    'wams.complete.no': 'Cancel',
    'wams.complete.reopen': '↺ Reopen for editing',

    'wams.detail.back': '→ Back to the meeting list',
    'wams.detail.lockedBadge': '🔒 Locked history',
    'wams.detail.print': '🖨️ Export / print',
    'wams.detail.subtitle': 'Weekly accountability meeting — week {week} ({a} ↔ {b})',

    'wams.notes.wins': 'Wins',
    'wams.notes.winsPlaceholder': 'What went well this week?',
    'wams.notes.misses': 'Misses',
    'wams.notes.missesPlaceholder': "What didn't happen as planned?",
    'wams.notes.blockers': 'Blockers for next week',
    'wams.notes.blockersPlaceholder': 'What could derail next week?',
    'wams.notes.lessons': 'Lessons',
    'wams.notes.lessonsPlaceholder': 'What did we learn?',
    'wams.notes.adjust': 'Should we adjust goals or tactics for next week?',
    'wams.notes.adjustPlaceholder': 'Notes or questions about changing direction...',
    'wams.notes.free': 'Anything else',
    'wams.notes.freePlaceholder': 'Anything else worth writing down...',

    'wams.adjust.title': 'Tuning for week {week} only',
    'wams.adjust.body':
      'Agreed that something about the coming week looks different? You can dial a tactic up or down, or add a one-off task — all for week {week} only. The rest of the cycle stays as planned.',

    'wams.ownGoals.title': 'Update my goals and tactics',
    'wams.ownGoals.body':
      'You can only edit your own goals and tactics here — never your partner\'s.',
    'wams.ownGoals.noCycle': 'You have no active cycle yet — go to the "This week" tab to create one.',

    'wams.list.complete': 'Completed',
    'wams.list.draft': 'Draft',
    'wams.list.historical': '🔒 History',
    'wams.list.noPartnerTitle': 'No confirmed partner yet',
    'wams.list.noPartnerBody':
      'Weekly accountability meetings only open up once you are connected to a partner. Add one from the settings tab below the dashboard.',
    'wams.list.title': 'Our meeting · WAM',
    'wams.list.blurb':
      'You meet once a week, go over how it went, and agree what you are each committing to next. The focus and tactics for next week get set in your own planning above.',
    'wams.list.weekLabel': 'Week',
    'wams.list.weekSelect': 'Week for the meeting',
    'wams.list.weekOption': 'Week {week}',
    'wams.list.open': 'Open the meeting',
    'wams.list.latestTitle': 'Last meeting — week {week}',
    'wams.list.completedAt': 'completed ',
    'wams.list.updatedAt': 'updated ',
    'wams.list.scores': 'Scores that week: {value}',
    'wams.list.scoresNone': 'not saved',
    'wams.list.ratings': 'Self-rating: {value}',
    'wams.list.ratingsNone': 'not rated yet',
    'wams.list.noCommitments': 'No commitments were set',
    'wams.list.commitments': 'Commitments: {done} of {total}',
    'wams.list.duePunishments': 'Forfeits due: {done} of {total}',
    'wams.list.viewSummary': 'View the summary',
    'wams.list.resume': 'Pick up where you left off',
    'wams.list.searchPlaceholder': 'Search notes, lessons, commitments and forfeits...',
    'wams.list.searchLabel': 'Search the accountability meetings',
    'wams.list.search': 'Search',
    'wams.list.noResults': 'No results.',
    'wams.list.resultRow': 'Week {week} — {status}',
    'wams.list.resultHistorical': ' (history)',
    'wams.list.allTitle': 'All meetings ({count})',
    'wams.list.allEmpty': 'No meetings yet. You can open one above.',
    'wams.list.rowWeek': 'Week {week}',
    'wams.list.rowNoScores': 'No scores',
    'wams.list.rowOpen': 'Open',

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

    'wams.punishments.title': 'עונשים',
    'wams.punishments.empty': 'עדיין לא נכתבו עונשים בפגישה זו.',
    'wams.punishments.placeholder': 'עונש חדש...',
    'wams.punishments.newLabel': 'טקסט עונש חדש',
    'wams.punishments.assignLabel': 'על מי מוטל העונש',
    'wams.punishments.onMe': 'עליי',
    'wams.punishments.onPartner': 'על השותף/ה',
    'wams.punishments.add': 'הוספה',
    'wams.punishments.blocked':
      'לא ניתן להוסיף עונש חדש כרגע — הפגישה הבאה שאליה הוא ישויך כבר הושלמה או נעולה כהיסטוריה. ניתן לפתוח אותה מחדש כדי לאפשר הוספת עונשים.',
    'wams.punishments.text': 'טקסט העונש',
    'wams.punishments.reassign': 'שיוך מחדש של העונש',
    'wams.punishments.deleteLabel': 'מחיקת עונש',
    'wams.punishments.delete': 'מחיקה',
    'wams.punishments.confirmLabel': 'אישור פעולה על עונש שהושלם',
    'wams.punishments.confirmReassign':
      'העונש הזה כבר סומן כבוצע. שינוי מי שהעונש מוטל עליו יאפס את סימון הביצוע. לאשר?',
    'wams.punishments.confirmDelete': 'העונש הזה כבר סומן כבוצע. למחוק אותו בכל זאת?',
    'wams.punishments.confirmYes': 'אישור',
    'wams.punishments.confirmNo': 'ביטול',

    'wams.invite.sent': 'נשלחה הזמנה ✓',
    'wams.invite.failed': 'שליחת ההזמנה נכשלה',
    'wams.invite.pending': 'טרם נשלחה הזמנה',

    'wams.schedule.badDate':
      'מועד לא תקין (שעון ישראל) — ייתכן שמדובר בשעה שאינה קיימת עקב מעבר לשעון קיץ/חורף',
    'wams.schedule.pastDate': 'מועד הפגישה הבאה חייב להיות בעתיד',
    'wams.schedule.badDuration': 'משך הפגישה חייב להיות מספר שלם בין 1 ל־1440 דקות',
    'wams.schedule.needDate': 'יש לבחור מועד לפגישה הבאה כדי לשלוח הזמנות',
    'wams.schedule.cannotCancel':
      'לא ניתן לבטל תיאום קיים לפגישה הבאה — ניתן לשנות את המועד, אך לא למחוק אותו (אין תמיכה בביטול הזמנות יומן שכבר נשלחו).',

    'wams.schedule.title': 'ה-WAM הבא — קובעים יחד?',
    'wams.schedule.readOnly': 'לצפייה בלבד',
    'wams.schedule.optional': 'תיאום אופציונלי',
    'wams.schedule.setFor': 'ה-WAM הבא נקבע ל:',
    'wams.schedule.when': '{when} (שעון ישראל), למשך {minutes} דקות',
    'wams.schedule.statusHint': 'מצב השליחה אינו אישור השתתפות או אישור שהאירוע נוסף ליומן.',
    'wams.schedule.none': 'עדיין לא נקבע מועד לפגישה הבאה.',
    'wams.schedule.lockedHint': 'התיאום ומצב ההזמנות מוצגים כפי שנשמרו. לא ניתן לשנות אותם בתצוגה זו.',
    'wams.schedule.draftHint':
      'אפשר לקבוע עכשיו מועד משותף ולשלוח הזמנות ליומנים של שניכם — בלי להשלים את הפגישה. השלמת הפגישה היא פעולה נפרדת שמקפיאה את הציונים.',
    'wams.schedule.doneHint':
      'אפשר לתאם או לעדכן את הפגישה הבאה בלי לפתוח מחדש את הפגישה שהושלמה. הציונים והתוכן השמורים לא ישתנו.',
    'wams.schedule.fieldLabel': 'תיאום ה-WAM הבא ({changeability}, שעון ישראל)',
    'wams.schedule.changeable': 'ניתן לשנות, לא לבטל',
    'wams.schedule.optionalField': 'אופציונלי',
    'wams.schedule.duration': 'משך (בדקות)',
    'wams.schedule.retryHint':
      'חלק מההזמנות לא נשלחו. באישור ניסיון נוסף עם אותו מועד ומשך, נשלח רק למי שהשליחה אליו טרם הצליחה. שינוי המועד או המשך ישלח עדכון לשניכם.',

    'wams.schedule.alreadySent': 'ההזמנות נשלחו — אפשר לעדכן את המועד',
    'wams.schedule.retry': 'ניסיון נוסף לשליחת ההזמנות',
    'wams.schedule.update': 'עדכון המועד ושליחה ליומנים',
    'wams.schedule.send': '📅 שלח הזמנה ליומנים',

    'wams.complete.cta': '✓ סימון הפגישה כהושלמה',
    'wams.complete.confirmWithDate':
      'השלמת הפגישה תקפיא את ציוני הביצוע הנוכחיים של שני הצדדים. המועד שבחרת לא יישמר ולא יישלחו הזמנות — לשליחתן יש ללחוץ קודם על "שלח הזמנה ליומנים". להמשיך?',
    'wams.complete.confirm':
      'השלמת הפגישה תקפיא את ציוני הביצוע הנוכחיים של שני הצדדים. להמשיך?',
    'wams.complete.yes': 'אישור השלמת הפגישה',
    'wams.complete.no': 'ביטול',
    'wams.complete.reopen': '↺ פתיחה מחדש לעריכה',

    'wams.detail.back': '→ חזרה לרשימת הפגישות',
    'wams.detail.lockedBadge': '🔒 היסטוריה נעולה',
    'wams.detail.print': '🖨️ ייצוא / הדפסה',
    'wams.detail.subtitle': 'פגישת אחריותיות שבועית — שבוע {week} ({a} ↔ {b})',

    'wams.notes.wins': 'ניצחונות / הישגים',
    'wams.notes.winsPlaceholder': 'מה עבד טוב השבוע?',
    'wams.notes.misses': 'החמצות',
    'wams.notes.missesPlaceholder': 'מה לא בוצע כמתוכנן?',
    'wams.notes.blockers': 'חסמים / מגבלות לשבוע הבא',
    'wams.notes.blockersPlaceholder': 'מה עלול להכשיל את השבוע הבא?',
    'wams.notes.lessons': 'לקחים',
    'wams.notes.lessonsPlaceholder': 'מה למדנו?',
    'wams.notes.adjust': 'האם כדאי להתאים מטרות/טקטיקות לשבוע הבא?',
    'wams.notes.adjustPlaceholder': 'הערות/שאלות לגבי שינוי כיוון...',
    'wams.notes.free': 'הערות חופשיות',
    'wams.notes.freePlaceholder': 'כל דבר נוסף...',

    'wams.adjust.title': 'כוונון לשבוע {week} בלבד',
    'wams.adjust.body':
      'סיכמתם שמשהו בשבוע הקרוב נראה אחרת? אפשר להעלות או להוריד את העומס של טקטיקה, או להוסיף משימה חד־פעמית — הכול לשבוע {week} בלבד. התוכנית לשאר המחזור לא משתנה.',

    'wams.ownGoals.title': 'עדכון המטרות והטקטיקות שלי',
    'wams.ownGoals.body':
      'ניתן לערוך כאן ישירות רק את המטרות והטקטיקות שלך — לעולם לא את אלו של השותף/ה.',
    'wams.ownGoals.noCycle': 'אין לך עדיין מחזור פעיל — עברו ללשונית "לוח השבוע" כדי ליצור אחד.',

    'wams.list.complete': 'הושלמה',
    'wams.list.draft': 'טיוטה',
    'wams.list.historical': '🔒 היסטוריה',
    'wams.list.noPartnerTitle': 'אין עדיין שותף/ה מאושר/ת',
    'wams.list.noPartnerBody':
      'פגישות אחריותיות שבועיות זמינות רק לאחר חיבור לשותף/ה. הוסיפו שותף/ה בלשונית ההגדרות מתחת ללוח.',
    'wams.list.title': 'פגישה משותפת · WAM',
    'wams.list.blurb':
      'נפגשים פעם בשבוע, עוברים על הביצועים, ומסכמים מחויבויות להמשך. המיקוד והטקטיקות לשבוע הבא נקבעים בתכנון האישי שלמעלה.',
    'wams.list.weekLabel': 'שבוע',
    'wams.list.weekSelect': 'שבוע לפגישה',
    'wams.list.weekOption': 'שבוע {week}',
    'wams.list.open': 'פתיחת הפגישה',
    'wams.list.latestTitle': 'הפגישה האחרונה — שבוע {week}',
    'wams.list.completedAt': 'הושלמה ',
    'wams.list.updatedAt': 'עודכנה ',
    'wams.list.scores': 'ציוני השבוע: {value}',
    'wams.list.scoresNone': 'לא נשמרו',
    'wams.list.ratings': 'דירוג עצמי: {value}',
    'wams.list.ratingsNone': 'טרם דורג',
    'wams.list.noCommitments': 'לא נקבעו מחויבויות',
    'wams.list.commitments': 'מחויבויות: {done} מתוך {total}',
    'wams.list.duePunishments': 'עונשים לביצוע: {done} מתוך {total}',
    'wams.list.viewSummary': 'צפייה בסיכום',
    'wams.list.resume': 'המשך מאיפה שעצרנו',
    'wams.list.searchPlaceholder': 'חיפוש בהערות, לקחים, מחויבויות ועונשים...',
    'wams.list.searchLabel': 'חיפוש בפגישות האחריותיות',
    'wams.list.search': 'חיפוש',
    'wams.list.noResults': 'לא נמצאו תוצאות.',
    'wams.list.resultRow': 'שבוע {week} — {status}',
    'wams.list.resultHistorical': ' (היסטוריה)',
    'wams.list.allTitle': 'כל הפגישות ({count})',
    'wams.list.allEmpty': 'עדיין לא התקיימה אף פגישה. אפשר לפתוח אחת למעלה.',
    'wams.list.rowWeek': 'שבוע {week}',
    'wams.list.rowNoScores': 'ללא ציונים',
    'wams.list.rowOpen': 'פתיחה',

    'wams.punishments.dueTitle': 'עונשים לביצוע השבוע',
    'wams.punishments.markLabel': 'סימון "{label}" כבוצע',
    'wams.punishments.by': 'מאת {name}',
    'wams.punishments.on': 'על {name}',
    'wams.punishments.fromWeek': 'מפגישת שבוע {week}',
    'wams.punishments.done': '✔️ בוצע',
  },
};
