import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "archiveSearch" area.
 *
 * These label which stored field a search hit came from, so a result can say *why* it
 * matched. They are their own area rather than part of "wams" because archive search spans
 * cycles, goals, tactics, WAMs, commitments, forfeits and reminders alike.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `archiveSearch.`.
 * - Use {name} placeholders for interpolation.
 */
export const archiveSearch: AreaDict = {
  en: {
    'archiveSearch.wamTitle': 'Accountability meeting · Week {week}',
    'archiveSearch.field.cycleName': 'Cycle name',
    'archiveSearch.field.vision': 'Vision',
    'archiveSearch.field.successDefinition': 'Success definition',
    'archiveSearch.field.whyItMatters': 'Why it matters',
    'archiveSearch.field.blockers': 'Blockers',
    'archiveSearch.field.risks': 'Risks',
    'archiveSearch.field.lagMeasures': 'Lag measures',
    'archiveSearch.field.leadMeasures': 'Lead measures',
    'archiveSearch.field.notes': 'Notes',
    'archiveSearch.field.goalTitle': 'Goal',
    'archiveSearch.field.tacticTitle': 'Tactic',
    'archiveSearch.field.wins': 'Wins',
    'archiveSearch.field.misses': 'Misses',
    'archiveSearch.field.lessonsLearned': 'Lessons learned',
    'archiveSearch.field.adjustmentNotes': 'Adjustments',
    'archiveSearch.field.commitment': 'Commitment',
    'archiveSearch.field.punishment': 'Forfeit',
    'archiveSearch.field.reminderTitle': 'Reminder title',
    'archiveSearch.field.reminderBody': 'Reminder body',
  },
  he: {
    'archiveSearch.wamTitle': 'פגישת אחריותיות · שבוע {week}',
    'archiveSearch.field.cycleName': 'שם המחזור',
    'archiveSearch.field.vision': 'חזון',
    'archiveSearch.field.successDefinition': 'הגדרת הצלחה',
    'archiveSearch.field.whyItMatters': 'למה זה חשוב',
    'archiveSearch.field.blockers': 'חסמים',
    'archiveSearch.field.risks': 'סיכונים',
    'archiveSearch.field.lagMeasures': 'מדדי תוצאה',
    'archiveSearch.field.leadMeasures': 'מדדי ביצוע',
    'archiveSearch.field.notes': 'הערות',
    'archiveSearch.field.goalTitle': 'מטרה',
    'archiveSearch.field.tacticTitle': 'טקטיקה',
    'archiveSearch.field.wins': 'הצלחות',
    'archiveSearch.field.misses': 'פספוסים',
    'archiveSearch.field.lessonsLearned': 'לקחים',
    'archiveSearch.field.adjustmentNotes': 'התאמות',
    'archiveSearch.field.commitment': 'התחייבות',
    'archiveSearch.field.punishment': 'עונש',
    'archiveSearch.field.reminderTitle': 'כותרת התזכורת',
    'archiveSearch.field.reminderBody': 'תוכן התזכורת',
  },
};
