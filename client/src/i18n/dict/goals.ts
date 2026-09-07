import type { AreaDict } from '../locales';

/**
 * Goals and the weekly tactics under them: the goal list, the add/edit forms, and the
 * confirmations that guard destructive edits.
 */
export const goals: AreaDict = {
  en: {
    'goals.add.placeholder': 'Add a goal ({count}/{max})',
    'goals.add.label': 'New goal name',
    'goals.add.submit': 'Add',
    'goals.limit': "You've reached the limit of 3 goals per cycle.",

    'goals.empty.partner.title': 'No goals yet',
    'goals.empty.partner.body': "Your partner hasn't added any goals to this cycle yet.",
    'goals.empty.title': 'No goals in this cycle yet',
    'goals.empty.body':
      'Add up to 3 goals for the 12 weeks, and give each one weekly tactics to track.',
    'goals.empty.cta': '+ Add your first goal',

    'goals.name.label': 'Goal name',
    'goals.delete': 'Delete goal',
    'goals.delete.confirm':
      'Deleting this goal also deletes every tactic and every day you logged under it. Are you sure?',
    'goals.delete.yes': 'Yes, delete it',
    'goals.delete.cancel': 'Cancel',

    'goals.tactic.none': 'No tactics for this goal yet.',
    'goals.tactic.add': '+ Add a tactic',
    'goals.tactic.addSubmit': 'Add',
    'goals.tactic.saveSubmit': 'Save',
    'goals.tactic.edit': 'Edit',
    'goals.tactic.delete': 'Delete',
    'goals.tactic.deleteLabel': 'Delete the tactic {title}',
    'goals.tactic.deleteConfirm': 'Delete it? Everything you logged for it goes too.',
    'goals.tactic.deleteYes': 'Yes, delete',
    'goals.tactic.deleteNo': 'No',
    'goals.tactic.weeks': '{days} · weeks {start}–{end}',
    'goals.tactic.override': 'Week {week}: {title} · {days}',

    'goals.form.name': 'Tactic name',
    'goals.form.nextWeekOnly': 'Apply to next week only',
    'goals.form.nextWeekOnlyHint': 'This change applies to week {week} only, then the usual tactic comes back.',
    'goals.form.everyWeekHint': 'This change applies from week {week} to the end of the cycle.',
    'goals.form.noFutureWeek': 'This tactic has no future week left in the current cycle.',
    'goals.form.fromWeek': 'From week',
    'goals.form.toWeek': 'To week',
    'goals.form.rangeInvalid': 'The end week has to be the same as, or after, the start week',
    'goals.form.cancel': 'Cancel',
  },
  he: {
    'goals.add.placeholder': 'הוספת מטרה ({count}/{max})',
    'goals.add.label': 'שם מטרה חדשה',
    'goals.add.submit': 'הוספה',
    'goals.limit': 'הגעת למספר המרבי של 3 מטרות למחזור.',

    'goals.empty.partner.title': 'עדיין לא הוגדרו מטרות',
    'goals.empty.partner.body': 'השותף/ה טרם הוסיפ/ה מטרות למחזור הנוכחי.',
    'goals.empty.title': 'עדיין אין מטרות במחזור זה',
    'goals.empty.body':
      'הוסיפו עד 3 מטרות מרכזיות למחזור בן 12 השבועות, ולכל מטרה טקטיקות שבועיות למעקב.',
    'goals.empty.cta': '+ הוספת מטרה ראשונה',

    'goals.name.label': 'שם המטרה',
    'goals.delete': 'מחיקת מטרה',
    'goals.delete.confirm':
      'מחיקת המטרה תמחק גם את כל הטקטיקות והביצועים המשויכים אליה. לאשר?',
    'goals.delete.yes': 'אישור מחיקה',
    'goals.delete.cancel': 'ביטול',

    'goals.tactic.none': 'אין עדיין טקטיקות למטרה זו.',
    'goals.tactic.add': '+ הוספת טקטיקה',
    'goals.tactic.addSubmit': 'הוספה',
    'goals.tactic.saveSubmit': 'שמירה',
    'goals.tactic.edit': 'עריכה',
    'goals.tactic.delete': 'מחיקה',
    'goals.tactic.deleteLabel': 'מחיקת הטקטיקה {title}',
    'goals.tactic.deleteConfirm': 'למחוק? גם הביצועים והעדויות שלה יימחקו.',
    'goals.tactic.deleteYes': 'כן, למחוק',
    'goals.tactic.deleteNo': 'לא',
    'goals.tactic.weeks': '{days} · שבועות {start}–{end}',
    'goals.tactic.override': 'שבוע {week}: {title} · {days}',

    'goals.form.name': 'שם הטקטיקה',
    'goals.form.nextWeekOnly': 'להחיל רק בשבוע הבא',
    'goals.form.nextWeekOnlyHint': 'השינוי יחול בשבוע {week} בלבד, ואז הטקטיקה הרגילה תחזור.',
    'goals.form.everyWeekHint': 'השינוי יחול משבוע {week} ועד סוף המחזור.',
    'goals.form.noFutureWeek': 'אין שבוע עתידי לטקטיקה הזו במחזור הנוכחי.',
    'goals.form.fromWeek': 'משבוע',
    'goals.form.toWeek': 'עד שבוע',
    'goals.form.rangeInvalid': 'שבוע הסיום חייב להיות אחרי שבוע ההתחלה או שווה לו',
    'goals.form.cancel': 'ביטול',
  },
};
