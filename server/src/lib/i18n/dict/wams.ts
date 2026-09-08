import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "wams" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `wams.`.
 * - Use {name} placeholders for interpolation.
 */
export const wams: AreaDict = {
  en: {
    // BROOST preset messages (displayed in the UI)
    'wams.broostPreset.great_job': 'You showed up and delivered. Respect. 🫡',
    'wams.broostPreset.crushing_it': 'All green. Someone came to work. 🟩',
    'wams.broostPreset.keep_going': 'This week\'s comeback starts now. 🎬',
    'wams.broostPreset.proud_of_you': '85%? Receipts. 🧾',
    'wams.broostPreset.daily_boost': 'Coffee, playlist, check. That\'s the order. ☕',
    'wams.broostPreset.you_got_this': 'One more check. For the story. 🎯',
    'wams.broostPreset.king_queen': 'That execution deserves a replay. 🔁',
    'wams.broostPreset.sending_love': 'Even on a no-check day — I\'ve got your back. 🤝',
  },
  he: {
    // BROOST preset messages
    'wams.broostPreset.great_job': 'יש ביצועים ויש את זה. ריספקט 🫡',
    'wams.broostPreset.crushing_it': 'הטבלה ירוקה. מישהו פה הגיע לעבוד 🟩',
    'wams.broostPreset.keep_going': 'הקאמבק של השבוע מתחיל עכשיו 🎬',
    'wams.broostPreset.proud_of_you': '85%? יש קבלות 🧾',
    'wams.broostPreset.daily_boost': 'קפה, פלייליסט, וי. זה הסדר ☕',
    'wams.broostPreset.you_got_this': 'עוד וי אחד. בשביל העלילה 🎯',
    'wams.broostPreset.king_queen': 'הביצוע הזה שווה שידור חוזר 🔁',
    'wams.broostPreset.sending_love': 'גם ביום בלי וי — יש פה גב 🤝',
  },
};
