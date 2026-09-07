import type { AreaDict } from '../locales';

/**
 * Translations for the "auth" area.
 *
 * Contract:
 * - Every key present in `en` must also be present in `he` (enforced by the
 *   dictionary parity test in src/i18n/__tests__/dictionaries.test.ts).
 * - Keys are dot-namespaced and start with `auth.`.
 * - Use `{name}` placeholders for interpolation.
 * - For counts, define `key_one` and `key_other` and call `t(key, { count })`.
 */
export const auth: AreaDict = {
  en: {
    'auth.subtitle': 'Cycles, goals and weekly tactics — in one place.',
    'auth.tabs.label': 'Sign in or create an account',
    'auth.login': 'Sign in',
    'auth.register': 'Create account',
    'auth.submitting': 'One moment...',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.forgotLink': 'Forgot your password?',

    'auth.policy.checking': 'Checking whether signups are open...',
    'auth.policy.failed':
      "Couldn't check whether signups are open. Try again, or ask whoever runs this server.",
    'auth.policy.retry': 'Try again',
    'auth.policy.closed': 'Signups are closed. Ask whoever runs this server for access.',

    'auth.forgot.title': 'Reset your password',
    'auth.forgot.submit': 'Send me a reset link',
    'auth.forgot.sending': 'Sending...',
    'auth.forgot.failed': "Couldn't send that request.",
    'auth.backToLogin': 'Back to sign in',

    'auth.reset.title': 'Choose a new password',
    'auth.reset.newPassword': 'New password',
    'auth.reset.confirmPassword': 'Confirm new password',
    'auth.reset.submit': 'Reset password',
    'auth.reset.mismatch': "Those two passwords don't match.",
    'auth.reset.failed': "Couldn't reset your password.",
    'auth.reset.done': 'Your password is reset — you can sign in with it now.',
  },
  he: {
    'auth.subtitle': 'ניהול מחזורי ביצוע, מטרות וטקטיקות שבועיות',
    'auth.tabs.label': 'בחירת מצב התחברות',
    'auth.login': 'התחברות',
    'auth.register': 'הרשמה',
    'auth.submitting': 'רגע...',
    'auth.email': 'אימייל',
    'auth.password': 'סיסמה',
    'auth.forgotLink': 'שכחת סיסמה?',

    'auth.policy.checking': 'בודק את מדיניות ההרשמה...',
    'auth.policy.failed': 'לא ניתן לבדוק אם ההרשמה פתוחה. אפשר לנסות שוב או לפנות למפעיל/ת המערכת.',
    'auth.policy.retry': 'ניסיון נוסף',
    'auth.policy.closed': 'ההרשמה הציבורית סגורה. לקבלת גישה יש לפנות למפעיל/ת המערכת.',

    'auth.forgot.title': 'איפוס סיסמה',
    'auth.forgot.submit': 'שליחת קישור לאיפוס',
    'auth.forgot.sending': 'שולח...',
    'auth.forgot.failed': 'שגיאה בשליחת הבקשה',
    'auth.backToLogin': 'חזרה להתחברות',

    'auth.reset.title': 'קביעת סיסמה חדשה',
    'auth.reset.newPassword': 'סיסמה חדשה',
    'auth.reset.confirmPassword': 'אימות סיסמה חדשה',
    'auth.reset.submit': 'איפוס הסיסמה',
    'auth.reset.mismatch': 'אימות הסיסמה החדשה אינו תואם',
    'auth.reset.failed': 'שגיאה באיפוס הסיסמה',
    'auth.reset.done': 'הסיסמה אופסה בהצלחה — ניתן להתחבר כעת עם הסיסמה החדשה.',
  },
};
