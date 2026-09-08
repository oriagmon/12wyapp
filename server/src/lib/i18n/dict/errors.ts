import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "errors" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `errors.`.
 * - Use {name} placeholders for interpolation.
 *
 * The `errors.validation.*` keys are used as Zod messages. Zod schemas are built once at
 * module load, long before we know who is asking, so the schema carries the *key* and the
 * route translates it when it writes the response.
 */
export const errors: AreaDict = {
  en: {
    'errors.validation.generic': 'That input is not valid.',
    'errors.validation.email': 'That email address is not valid.',
    'errors.validation.passwordTooShort': 'Your password needs at least 8 characters.',
    'errors.validation.passwordTooLong': 'That password is too long.',
    'errors.validation.passwordRequired': 'Please enter your password.',
    'errors.validation.resetLinkInvalid': 'That reset link is not valid.',
    'errors.validation.cycleNameEmpty': 'Give the cycle a name.',
    'errors.validation.goalTitleEmpty': 'Give the goal a name.',
    'errors.validation.tacticTitleEmpty': 'Give the tactic a name.',
    'errors.validation.weekdaysRequired': 'Pick at least one day of the week.',
    'errors.validation.endWeekBeforeStart':
      'The last week has to be the same as, or after, the first week.',
    'errors.validation.invalidDate': 'That date and time is not valid.',
    'errors.validation.weightRange': 'That weight looks wrong — enter a value in kilograms between 20 and 400.',
    'errors.validation.commitmentLabelEmpty': 'Write what you are committing to.',
    'errors.validation.punishmentLabelEmpty': 'Write what the forfeit is.',
    'errors.validation.punishmentUpdateEmpty': 'Change the text or who it belongs to.',
    // profile validation
    'errors.validation.displayNameEmpty': 'Display name cannot be empty.',
    'errors.validation.displayNameTooLong': 'That display name is too long.',
    'errors.validation.bioTooLong': 'That bio is too long.',
    'errors.validation.currentPasswordRequired': 'Please enter your current password.',
    'errors.validation.newPasswordSameAsCurrent': 'The new password is the same as the current one. Choose a different one.',

    // reminder validation
    'errors.validation.reminderTitleEmpty': 'Give the reminder a title.',
    'errors.validation.reminderTitleTooLong': 'That title is too long.',
    'errors.validation.reminderBodyTooLong': 'That body text is too long.',
    'errors.validation.scheduledForRequired': 'Choose a time for the reminder.',
    'errors.validation.duplicateRecipient': 'Each recipient can only be selected once.',
    'errors.validation.exactlyOneRecipient': 'Choose a single recipient or a recipient list, but not both.',

    // execution recovery validation
    'errors.validation.maneuverNoteEmpty': 'Describe the recovery maneuver concretely.',
    'errors.validation.reduceAtLeastOneTactic': 'Include at least one tactic.',
    'errors.validation.reduceTooManyTactics': 'Too many tactics in a single request.',
    'errors.validation.reduceDuplicateTactic': 'Each tactic can appear only once in a single request.',

    // evidence validation
    'errors.validation.noteTooLong': 'That note is too long.',
    'errors.validation.linkTooLong': 'That link is too long.',
    'errors.validation.linkMustBeUrl': 'The link must be a valid http:// or https:// URL.',
  },
  he: {
    'errors.validation.generic': 'קלט לא תקין',
    'errors.validation.email': 'כתובת אימייל לא תקינה',
    'errors.validation.passwordTooShort': 'הסיסמה חייבת להכיל לפחות 8 תווים',
    'errors.validation.passwordTooLong': 'הסיסמה ארוכה מדי',
    'errors.validation.passwordRequired': 'נדרשת סיסמה',
    'errors.validation.resetLinkInvalid': 'קישור האיפוס אינו תקין',
    'errors.validation.cycleNameEmpty': 'שם המחזור לא יכול להיות ריק',
    'errors.validation.goalTitleEmpty': 'שם המטרה לא יכול להיות ריק',
    'errors.validation.tacticTitleEmpty': 'שם הטקטיקה לא יכול להיות ריק',
    'errors.validation.weekdaysRequired': 'יש לבחור לפחות יום אחד בשבוע',
    'errors.validation.endWeekBeforeStart': 'שבוע הסיום חייב להיות אחרי שבוע ההתחלה או שווה לו',
    'errors.validation.invalidDate': 'מועד לא תקין',
    'errors.validation.weightRange': 'המשקל לא תקין — יש להזין ערך בקילוגרמים בין 20 ל‑400',
    'errors.validation.commitmentLabelEmpty': 'טקסט ההתחייבות לא יכול להיות ריק',
    'errors.validation.punishmentLabelEmpty': 'טקסט העונש לא יכול להיות ריק',
    'errors.validation.punishmentUpdateEmpty': 'יש לספק לפחות שדה אחד לעדכון (טקסט או שיוך)',
    // profile validation
    'errors.validation.displayNameEmpty': 'שם התצוגה לא יכול להיות ריק',
    'errors.validation.displayNameTooLong': 'שם התצוגה ארוך מדי',
    'errors.validation.bioTooLong': 'הביוגרפיה ארוכה מדי',
    'errors.validation.currentPasswordRequired': 'יש להזין את הסיסמה הנוכחית',
    'errors.validation.newPasswordSameAsCurrent': 'הסיסמה החדשה זהה לסיסמה הנוכחית. יש לבחור סיסמה אחרת',

    // reminder validation
    'errors.validation.reminderTitleEmpty': 'כותרת התזכורת לא יכולה להיות ריקה',
    'errors.validation.reminderTitleTooLong': 'הכותרת ארוכה מדי',
    'errors.validation.reminderBodyTooLong': 'התוכן ארוך מדי',
    'errors.validation.scheduledForRequired': 'יש לבחור מועד לתזכורת',
    'errors.validation.duplicateRecipient': 'לא ניתן לבחור את אותו נמען/ת יותר מפעם אחת',
    'errors.validation.exactlyOneRecipient': 'יש לבחור נמען/ת או רשימת נמענים, אך לא את שניהם',

    // execution recovery validation
    'errors.validation.maneuverNoteEmpty': 'יש להזין תיאור קונקרטי של מהלך החילוץ',
    'errors.validation.reduceAtLeastOneTactic': 'יש לכלול לפחות טקטיקה אחת',
    'errors.validation.reduceTooManyTactics': 'יותר מדי טקטיקות בבקשה אחת',
    'errors.validation.reduceDuplicateTactic': 'כל טקטיקה יכולה להופיע פעם אחת בלבד בבקשה אחת',

    // evidence validation
    'errors.validation.noteTooLong': 'ההערה ארוכה מדי',
    'errors.validation.linkTooLong': 'הקישור ארוך מדי',
    'errors.validation.linkMustBeUrl': 'הקישור חייב להיות כתובת http:// או https:// תקינה',
  },
};
