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
    'errors.validation.commitmentLabelEmpty': 'Write what you are committing to.',
    'errors.validation.punishmentLabelEmpty': 'Write what the forfeit is.',
    'errors.validation.punishmentUpdateEmpty': 'Change the text or who it belongs to.',
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
    'errors.validation.commitmentLabelEmpty': 'טקסט ההתחייבות לא יכול להיות ריק',
    'errors.validation.punishmentLabelEmpty': 'טקסט העונש לא יכול להיות ריק',
    'errors.validation.punishmentUpdateEmpty': 'יש לספק לפחות שדה אחד לעדכון (טקסט או שיוך)',
  },
};
