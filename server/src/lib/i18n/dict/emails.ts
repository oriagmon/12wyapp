import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "emails" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `emails.`.
 * - Use {name} placeholders for interpolation.
 */
export const emails: AreaDict = {
  en: {
    // Shared CTA
    'emails.cta.openApp': 'Open 12WY',

    // Email branding template
    'emails.branding.copyLinkText': "If the button doesn\'t open, copy the link:",

    // Password reset email
    'emails.passwordReset.subject': 'Reset your 12WY password',
    'emails.passwordReset.eyebrow': 'Password reset',
    'emails.passwordReset.title': 'Reset your password',
    'emails.passwordReset.body1': 'We received a request to reset the password for your 12WY account. Click the button below to set a new password.',
    'emails.passwordReset.body2': "If you didn\'t request a password reset, you can ignore this message — your current password will remain unchanged.",
    'emails.passwordReset.calloutTitle': 'One-time personal link',
    'emails.passwordReset.calloutText': 'This link is valid for {minutes} minutes and can only be used once.',
    'emails.passwordReset.cta': 'Reset password',
    'emails.passwordReset.footer': 'This is an automated message from 12WY.\nDo not share this link with anyone.',

    // BROOST email
    'emails.broost.subject': 'You got a BROOST 💪',
    'emails.broost.eyebrow': 'BROOST · Support incoming',
    'emails.broost.title': '{name} sent you some support!',
    'emails.broost.preheader': 'A word of encouragement from your accountability partner is waiting for you in 12WY.',
    'emails.broost.intro': '{name} sent you a BROOST:',
    'emails.broost.footer': 'This is an automated message from 12WY.',

    // "First to 50%" email. The ten `line` variants are the whole point of this email — one is
    // picked at random per week and used as BOTH the subject and the headline, so the same
    // sentence never lands in the inbox two weeks running. Keep them short enough to survive
    // an inbox subject-line truncation, and keep the tone on the encouraging side of teasing:
    // the person reading this is the one who is behind.
    'emails.weekMilestone.line.0': '{name} is making some progress — already at {score}% this week!',
    'emails.weekMilestone.line.1': '{name} got out of the gate first: {score}% of the week already done.',
    'emails.weekMilestone.line.2': '{name} just passed the halfway mark, at {score}%.',
    'emails.weekMilestone.line.3': '{name} is already halfway through this week\u2019s plan ({score}%).',
    'emails.weekMilestone.line.4': '{name} beat you to the halfway point this week — {score}% and counting.',
    'emails.weekMilestone.line.5': 'First on the board: {name} hit {score}% of this week\u2019s plan.',
    'emails.weekMilestone.line.6': '{name} is on a roll — {score}% of the week is already behind them.',
    'emails.weekMilestone.line.7': '{name} crossed the halfway line first, at {score}%.',
    'emails.weekMilestone.line.8': '{name} did not waste any time this week — already at {score}%.',
    'emails.weekMilestone.line.9': 'Halfway there: {name} reached {score}% of the week before you did.',
    'emails.weekMilestone.eyebrow': 'First to half the week',
    'emails.weekMilestone.preheader': '{name} is the first of you two to get halfway through this week\u2019s plan.',
    'emails.weekMilestone.intro': '{name} is the first of you two to get past half of this week\u2019s plan — week {week} of 12, now at {score}%.',
    'emails.weekMilestone.body': 'No scoreboard, no losing. Just a nudge: your own week is still wide open, and the target is {target}%.',
    'emails.weekMilestone.calloutTitle': 'Your turn',
    'emails.weekMilestone.calloutText': 'Tick off what you have already done — it takes about a minute.',
    'emails.weekMilestone.footer': 'Sent once a week at most, the first time one of you passes half the week.',

    // WAM calendar invite email
    'emails.calendar.israelTime': 'Israel time',
    'emails.calendar.subjectPrefix': 'Invite',
    'emails.calendar.eyebrow': 'Calendar invite',
    'emails.calendar.preheader': 'Next meeting scheduled: {when}',
    'emails.calendar.body1': 'Your next WAM has been scheduled — a shared time to review your progress and plan your next steps.',
    'emails.calendar.body2': 'A calendar invite (ICS) is attached. Open the attachment to add it to your calendar.',
    'emails.calendar.calloutTitle': 'Meeting details',
    'emails.calendar.duration': '{minutes} min',
    'emails.calendar.cta': 'Open 12WY',
    'emails.calendar.footer': 'This is an automated calendar invite from 12WY.\nMeeting time is shown in Israel time.',
    'emails.calendar.wamTitle': 'Next WAM',
    'emails.calendar.icsDescription': 'Your next Weekly Accountability Meeting (WAM). Open the app:',

    // WAM weekly reminder email
    'emails.wamReminder.subject': 'Reminder: Have you scheduled your WAM this week?',
    'emails.wamReminder.subjectMonthly': 'Reminder: WAM this week? Monthly review next week (Week {week})',
    'emails.wamReminder.eyebrow': 'Your weekly meeting',
    'emails.wamReminder.title': 'Have you scheduled your WAM this week?',
    'emails.wamReminder.body1': 'Your WAM (Weekly Accountability Meeting) is where you stop, check your progress, celebrate wins, and plan your next moves.',
    'emails.wamReminder.body2': "If you haven\'t set a time yet — now is the moment to coordinate with your partner.",
    'emails.wamReminder.monthlyCalloutTitle': 'Monthly review coming up',
    'emails.wamReminder.monthlyCalloutText': 'Week {week} (next week) closes out month {month} of your cycle. Make sure to schedule an extended WAM in addition to the regular weekly meeting.',
    'emails.wamReminder.footer': '12 weeks. One meeting every week. Consistent progress.\nThis is an automated weekly reminder from 12WY.',

    // Scheduled reminder email
    'emails.reminder.subjectPrefix': 'Reminder',
    'emails.reminder.eyebrow': 'Scheduled reminder',
    'emails.reminder.selfIntro': 'This is a personal reminder you set for yourself.',
    'emails.reminder.partnerIntro': 'This is a reminder {name} set for you.',
    'emails.reminder.calloutTitle': 'Reminder time',
    'emails.reminder.israelTime': 'Israel time',
    'emails.reminder.footer': 'This is an automated reminder from 12WY.',
  },
  he: {
    // Shared CTA
    'emails.cta.openApp': 'פתיחת 12WY',

    // Email branding template
    'emails.branding.copyLinkText': 'אם הכפתור אינו נפתח, אפשר להעתיק את הקישור:',

    // Password reset email
    'emails.passwordReset.subject': 'איפוס סיסמה לחשבון 12WY שלך',
    'emails.passwordReset.eyebrow': 'איפוס סיסמה',
    'emails.passwordReset.title': 'איפוס הסיסמה שלך',
    'emails.passwordReset.body1': 'קיבלנו בקשה לאיפוס הסיסמה לחשבון שלך ב-12WY. לחיצה על הכפתור למטה תוביל לעמוד קביעת סיסמה חדשה.',
    'emails.passwordReset.body2': 'אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהודעה זו — הסיסמה הנוכחית שלך תישאר ללא שינוי.',
    'emails.passwordReset.calloutTitle': 'קישור אישי לשימוש חד־פעמי',
    'emails.passwordReset.calloutText': 'הקישור בתוקף למשך {minutes} דקות ואפשר להשתמש בו פעם אחת בלבד.',
    'emails.passwordReset.cta': 'איפוס הסיסמה',
    'emails.passwordReset.footer': 'זוהי הודעה אוטומטית שנשלחה על ידי 12WY.\nאין להעביר את הקישור לאדם אחר.',

    // BROOST email
    'emails.broost.subject': 'קיבלת BROOST 💪',
    'emails.broost.eyebrow': 'BROOST · תמיכה בדרך',
    'emails.broost.title': '{name} שלח/ה לך תמיכה!',
    'emails.broost.preheader': 'מילה טובה מהשותף או השותפה שלך מחכה לך ב-12WY.',
    'emails.broost.intro': '{name} שלח/ה לך BROOST:',
    'emails.broost.footer': 'זוהי הודעה אוטומטית שנשלחה על ידי 12WY.',

    // ראו את ההערה בגרסה האנגלית: עשר הווריאציות הן כל העניין כאן, ונבחרת אחת אקראית בכל שבוע.
    // הניסוח מכוון לשני המינים (הגיע/ה) כי אין לנו מידע על המגדר של אף אחד מהשותפים.
    'emails.weekMilestone.line.0': '{name} מתקדם/ת יפה — כבר על {score}% מהשבוע!',
    'emails.weekMilestone.line.1': '{name} יצא/ה ראשון/ה לדרך: {score}% מהשבוע כבר סגורים.',
    'emails.weekMilestone.line.2': '{name} בדיוק עבר/ה את חצי הדרך, על {score}%.',
    'emails.weekMilestone.line.3': '{name} כבר בחצי מהתוכנית של השבוע ({score}%).',
    'emails.weekMilestone.line.4': '{name} הגיע/ה לחצי הדרך לפניך השבוע — {score}%, וממשיך/ה.',
    'emails.weekMilestone.line.5': 'ראשון/ה על הלוח: {name} על {score}% מהתוכנית של השבוע.',
    'emails.weekMilestone.line.6': '{name} בתנופה — {score}% מהשבוע כבר מאחור.',
    'emails.weekMilestone.line.7': '{name} חצה/תה ראשון/ה את חצי הדרך, על {score}%.',
    'emails.weekMilestone.line.8': '{name} לא בזבז/ה זמן השבוע — כבר על {score}%.',
    'emails.weekMilestone.line.9': 'חצי מהדרך: {name} הגיע/ה ל-{score}% מהשבוע לפניך.',
    'emails.weekMilestone.eyebrow': 'ראשון/ה לחצי השבוע',
    'emails.weekMilestone.preheader': '{name} הראשון/ה מביניכם שעבר/ה את חצי התוכנית של השבוע.',
    'emails.weekMilestone.intro': '{name} הראשון/ה מביניכם שעבר/ה את חצי התוכנית של השבוע — שבוע {week} מתוך 12, כרגע על {score}%.',
    'emails.weekMilestone.body': 'אין פה טבלה ואין פה הפסד. רק תזכורת קטנה: השבוע שלך עדיין פתוח לגמרי, והיעד הוא {target}%.',
    'emails.weekMilestone.calloutTitle': 'תורך',
    'emails.weekMilestone.calloutText': 'סמן/י את מה שכבר עשית — זה לוקח בערך דקה.',
    'emails.weekMilestone.footer': 'נשלח לכל היותר פעם בשבוע, בפעם הראשונה שאחד מכם עובר את חצי השבוע.',

    // WAM calendar invite email
    'emails.calendar.israelTime': 'שעון ישראל',
    'emails.calendar.subjectPrefix': 'הזמנה',
    'emails.calendar.eyebrow': 'הזמנה ליומן',
    'emails.calendar.preheader': 'הפגישה הבאה נקבעה: {when}',
    'emails.calendar.body1': 'נקבע מועד לפגישת ה-WAM הבאה שלכם — זמן משותף לסקירת הביצוע ולהתקדמות לשבוע הבא.',
    'emails.calendar.body2': 'מצורפת הזמנת יומן (ICS). אפשר לפתוח את הקובץ המצורף ולהוסיף את הפגישה ליומן.',
    'emails.calendar.calloutTitle': 'פרטי הפגישה',
    'emails.calendar.duration': '{minutes} דקות',
    'emails.calendar.cta': 'פתיחת 12WY',
    'emails.calendar.footer': 'זוהי הזמנת יומן אוטומטית שנשלחה על ידי 12WY.\nמועד הפגישה מוצג לפי שעון ישראל.',
    'emails.calendar.wamTitle': 'פגישת ה-WAM הבאה',
    'emails.calendar.icsDescription': 'תיאום הפגישה השבועית הבאה של פגישות ה-WAM שלכם. למעבר לאפליקציה:',

    // WAM weekly reminder email
    'emails.wamReminder.subject': 'תזכורת: קבעתם שעה לפגישת ה-WAM השבוע?',
    'emails.wamReminder.subjectMonthly': 'תזכורת: קבעתם שעה ל-WAM השבוע? הסקירה החודשית בשבוע הבא (שבוע {week})',
    'emails.wamReminder.eyebrow': 'הפגישה השבועית שלכם',
    'emails.wamReminder.title': 'קבעתם זמן ל-WAM השבוע?',
    'emails.wamReminder.body1': 'פגישת ה-WAM (סקירת ההתקדמות השבועית) היא המקום לעצור, לבדוק ביצוע, לחגוג התקדמות ולתכנן את המהלך הבא.',
    'emails.wamReminder.body2': 'אם עדיין לא קבעתם מועד — זה הזמן לתאם עם השותף או השותפה.',
    'emails.wamReminder.monthlyCalloutTitle': 'הסקירה החודשית מתקרבת',
    'emails.wamReminder.monthlyCalloutText': 'שבוע {week} (השבוע הבא) מסכם את חודש {month} במחזור. ודאו שכבר עכשיו קבעתם זמן ל-WAM המורחב, בנוסף לפגישה השבועית הרגילה.',
    'emails.wamReminder.footer': '12 שבועות. פגישה אחת בכל שבוע. התקדמות עקבית.\nזוהי תזכורת אוטומטית שבועית שנשלחה על ידי 12WY.',

    // Scheduled reminder email
    'emails.reminder.subjectPrefix': 'תזכורת',
    'emails.reminder.eyebrow': 'תזכורת מתוזמנת',
    'emails.reminder.selfIntro': 'זוהי תזכורת אישית שקבעת לעצמך.',
    'emails.reminder.partnerIntro': 'זוהי תזכורת ש{name} קבע/ה עבורך.',
    'emails.reminder.calloutTitle': 'מועד התזכורת',
    'emails.reminder.israelTime': 'שעון ישראל',
    'emails.reminder.footer': 'זוהי תזכורת אוטומטית שנשלחה על ידי 12WY.',
  },
};
