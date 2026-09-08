import type { AreaDict } from '../core.js';

/**
 * Server-side translations for the "api" area.
 *
 * Contract:
 * - Every key in `en` must also exist in `he` (enforced by the parity test).
 * - Keys are dot-namespaced and start with `api.`.
 * - Use {name} placeholders for interpolation.
 */
export const api: AreaDict = {
  en: {
    // auth
    'api.auth.notAuthenticated': 'You are not signed in.',
    'api.auth.sessionExpired': 'Your session has expired. Please sign in again.',
    'api.auth.userNotFound': 'Account not found.',
    'api.auth.registrationClosed': 'Registration is not open at the moment.',
    'api.auth.emailAlreadyRegistered': 'That email address is already registered.',
    'api.auth.invalidCredentials': 'Email or password is incorrect.',
    'api.auth.passwordResetEmailSent': 'If that email address is registered, a reset link is on its way.',
    'api.auth.invalidResetToken': 'That reset link is expired or has already been used.',
    'api.auth.passwordSameAsCurrent': 'That password is the same as your current one. Please choose a new one.',

    // origin
    'api.origin.forbidden': 'Request origin not allowed.',

    // server
    'api.server.internalError': 'Something went wrong on our end. Please try again.',

    // payload
    'api.payload.avatarTooLarge': 'That image is too large — the maximum is 2 MB.',
    'api.payload.fileTooLarge': 'That file is too large — the maximum is 8 MB.',
    'api.payload.tooLarge': 'That request is too large.',

    // profile
    'api.profile.staleSession': 'Your session is outdated. Please sign in again.',
    'api.profile.incorrectCurrentPassword': 'That current password is not correct.',
    'api.profile.noAvatar': 'No profile picture.',
    'api.profile.unsupportedFileType': 'Only PNG, JPEG, and WebP images are supported.',
    'api.profile.invalidImageContent': 'That file does not appear to be a valid image.',

    // tactics
    'api.tactics.goalNotFound': 'Goal not found.',
    'api.tactics.cycleEnded': 'This cycle has ended — tactics cannot be edited.',
    'api.tactics.notFound': 'Tactic not found.',
    'api.tactics.noFutureWeek': 'There is no upcoming week to plan for.',

    // wams
    'api.wams.isHistorical': 'This meeting belongs to an ended cycle and is locked for editing.',
    'api.wams.noPartner': 'You need an accepted accountability partner to hold a WAM.',
    'api.wams.notFound': 'Meeting not found.',
    'api.wams.byWeekNotFound': 'No meeting has been created for that week yet.',
    'api.wams.byWeekNoPartner': 'No accepted partner found.',
    'api.wams.invalidWeek': 'Invalid week.',
    'api.wams.mustBeOpenToEdit': 'Reopen the meeting before editing its content.',
    'api.wams.alreadyComplete': 'This meeting is already complete. Reopen it to make changes.',
    'api.wams.nextWamRequired': 'Please schedule the next meeting. Removing an existing time is not supported.',
    'api.wams.nextWamMustBeFuture': 'The next meeting time must be in the future.',
    'api.wams.cannotClearScheduledWam': 'Cannot complete the meeting without scheduling a next time once a time has been set. You can change the time, but not remove it — cancelling already-sent calendar invites is not supported.',
    'api.wams.completeFailed': 'Something went wrong completing the meeting. Please try again.',
    'api.wams.statusChanged': 'The meeting status changed. Refresh before trying again.',
    'api.wams.partialInvites': 'The schedule was saved, but some invites failed to send. You can retry; the meeting state and saved scores are unchanged.',
    'api.wams.invitesFailed': 'Calendar invites failed to send for at least one participant. The meeting stayed as a draft — you can try again.',
    'api.wams.ratingNotFound': 'Rating not found.',
    'api.wams.commitmentNotFound': 'Commitment not found.',
    'api.wams.mustBeOpenForCommitments': 'Reopen the meeting before adding commitments.',
    'api.wams.mustBeOpenToEditCommitment': 'Reopen the meeting before editing commitment text.',
    'api.wams.mustBeOpenToDeleteCommitment': 'Reopen the meeting before deleting a commitment.',
    'api.wams.punishmentNotFound': 'Forfeit not found.',
    'api.wams.mustBeOpenForPunishments': 'Reopen the meeting before adding forfeits.',
    'api.wams.invalidPunishmentAssignee': 'Forfeits can only be assigned to yourself or your current partner in this meeting.',
    'api.wams.nextWamFrozen': 'The next meeting is already complete or locked, so this forfeit could never be checked off.',
    'api.wams.punishmentAuthorOnly': 'Only the person who wrote this forfeit can edit it.',
    'api.wams.mustBeOpenToEditPunishment': 'Reopen the meeting before editing a forfeit.',
    'api.wams.dueWamFrozen': 'The meeting this forfeit was assigned to is already complete or locked — it can no longer be edited.',
    'api.wams.invalidPunishmentAssigneeEdit': 'Forfeits can only be assigned to yourself or your current partner in this meeting.',
    'api.wams.mustBeOpenToDeletePunishment': 'Reopen the meeting before deleting a forfeit.',
    'api.wams.duePunishmentNotFound': 'The meeting this forfeit was assigned to is already complete or locked — it can no longer be deleted.',
    'api.wams.assigneeOnlyCanToggle': 'Only the person the forfeit was assigned to can mark it as done.',
    'api.wams.mustBeOpenToToggle': 'Reopen the meeting before updating forfeit completion.',
    'api.wams.alreadyDraft': 'The meeting is already a draft.',
    'api.wams.updating': 'The meeting is being updated. Please wait and refresh.',

    // broosts
    'api.broosts.noPartner': 'You need a connected partner to send a BROOST.',
    'api.broosts.replyTargetNotFound': 'The BROOST you tried to reply to was not found.',
    'api.broosts.replyPartnerChanged': 'Cannot reply — the original sender is no longer your current partner.',
    'api.broosts.sendFailed': 'Something went wrong sending the BROOST. Please try again.',
    'api.broosts.loadFailed': 'The BROOST was sent but something went wrong loading it. Please refresh.',
    'api.broosts.invalidId': 'Invalid BROOST ID.',
    'api.broosts.notFound': 'BROOST not found.',
    'api.broosts.onlyRecipientCanRead': 'Only the recipient can mark a BROOST as read.',
    'api.broosts.needPresetOrCustom': 'Choose a preset message or write your own — not both.',
    'api.broosts.needOneMessage': 'Choose a preset message or write your own.',
    'api.broosts.presetNotFound': 'That preset message does not exist.',
    'api.broosts.customTooLong': 'That message is too long.',
    'api.broosts.dailyLimitReached': 'You have reached the daily BROOST limit for this partner. Try again later.',
    'api.broosts.cooldownRequired': 'Please wait a moment before sending another BROOST.',
    'api.broosts.recipientNotFound': 'Recipient not found.',

    // reminders
    'api.reminders.invalidId': 'Invalid reminder ID.',
    'api.reminders.notFound': 'Reminder not found.',
    'api.reminders.recipientNotAllowed': 'You can only send reminders to yourself or your current partner.',
    'api.reminders.tooManyActive': 'You have reached the maximum number of active reminders.',
    'api.reminders.invalidIsraelTime': 'Invalid time (Israel timezone) — this may be a time that does not exist due to a daylight-saving transition.',
    'api.reminders.mustBeFuture': 'The reminder time must be in the future.',
    'api.reminders.updateConflict': 'Could not update the reminder — it was already processed (e.g. sent or cancelled) in the meantime. Refresh and try again.',
    'api.reminders.cancelConflict': 'Could not cancel the reminder — it was already processed (e.g. sent) in the meantime. Refresh and try again.',

    // weeklyPlanning
    'api.weeklyPlanning.invalidCycleId': 'Invalid cycle ID.',
    'api.weeklyPlanning.invalidTargetWeek': 'Invalid target week — must be between 2 and 12.',
    'api.weeklyPlanning.cycleNotFound': 'Cycle not found.',
    'api.weeklyPlanning.forbidden': 'You do not have permission to view this weekly planning ritual.',
    'api.weeklyPlanning.onlyOwnerCanEdit': 'Only the board owner can edit the weekly planning ritual.',
    'api.weeklyPlanning.cycleEnded': 'This cycle has ended — the weekly planning ritual cannot be edited.',
    'api.weeklyPlanning.atFinalWeek': 'The cycle is at week 12, the final week — please close and review the cycle before planning another week.',
    'api.weeklyPlanning.mustBeNextWeek': 'You can only plan the week immediately after the current cycle week.',
    'api.weeklyPlanning.mustBeOpenToEdit': 'Reopen the ritual before editing its content.',
    'api.weeklyPlanning.noDraftToComplete': 'Save a draft of the ritual before completing it.',
    'api.weeklyPlanning.alreadyComplete': 'The ritual is already complete. Reopen it to make changes and complete again.',
    'api.weeklyPlanning.tacticsReviewRequired': 'Confirm that you have reviewed and adjusted the tactics for next week.',
    'api.weeklyPlanning.weeklyFocusRequired': 'Set the main focus for next week.',
    'api.weeklyPlanning.commitmentRequired': 'Enter your commitment for next week.',
    'api.weeklyPlanning.ritualNotFound': 'Ritual not found.',
    'api.weeklyPlanning.alreadyDraft': 'The ritual is already a draft.',

    // executionRecovery
    'api.executionRecovery.invalidUserId': 'Invalid user ID.',
    'api.executionRecovery.forbidden': 'You do not have permission to view this recovery plan.',
    'api.executionRecovery.onlyOwnerCanEdit': 'Only the board owner can edit the recovery plan.',
    'api.executionRecovery.noActiveCycle': 'No active cycle found.',
    'api.executionRecovery.atFinalWeek': 'The cycle is at week 12, the final week — there is no next week to reduce. You can create a recovery plan for the current week only.',
    'api.executionRecovery.alreadyHasPlan': 'A recovery plan already exists for this week — cannot create another or overwrite silently.',
    'api.executionRecovery.existingReducePlanCannotConvert': 'A reduce-next-week plan already exists for this week — it cannot be converted or overwritten by a recovery maneuver.',
    'api.executionRecovery.mustBeOpenToEdit': 'Reopen the plan before editing it.',
    'api.executionRecovery.mustIncludeAllNextWeekTactics': 'The selection must include all tactics planned for next week — no more, no less.',
    'api.executionRecovery.mustReduce': 'The total planned actions for next week must decrease for the reduction to be meaningful.',
    'api.executionRecovery.mustKeepOneTactic': 'At least one planned action must remain for next week.',
    'api.executionRecovery.planNotFound': 'No recovery plan found for the current week.',
    'api.executionRecovery.alreadyResolved': 'The plan is already resolved.',
    'api.executionRecovery.cannotReopenReduce': 'Cannot reopen a reduce-next-week plan — the reduction has already taken effect and is not reversible.',
    'api.executionRecovery.alreadyActive': 'The plan is already active.',

    // tacticEvidence
    'api.tacticEvidence.invalidParams': 'Invalid parameters.',
    'api.tacticEvidence.linkInvalid': 'That link is not a valid URL.',
    'api.tacticEvidence.linkProtocol': 'Links must start with http:// or https://.',
    'api.tacticEvidence.tacticNotFound': 'Tactic not found.',
    'api.tacticEvidence.accessForbidden': 'You do not have permission to view evidence for this tactic.',
    'api.tacticEvidence.sessionExpired': 'Your session has expired. Please sign in again.',
    'api.tacticEvidence.onlyOwnerCanEdit': 'Only the owner can edit evidence.',
    'api.tacticEvidence.noWeeklyCompletionForEvidence': 'Weekly evidence can only be added after at least one completion in the week.',
    'api.tacticEvidence.noCompletionForEvidence': 'Evidence can only be added to a completed execution.',
    'api.tacticEvidence.evidenceCannotBeEmpty': 'Keep a note, link, or file — the record cannot be completely empty.',
    'api.tacticEvidence.fileTooLarge': 'That file is too large — the maximum is 8 MB.',
    'api.tacticEvidence.unsupportedFileType': 'Unsupported file type — please upload PNG, JPEG, WebP, PDF, DOCX, or TXT.',
    'api.tacticEvidence.fileSaveFailed': 'Something went wrong saving the file. Please try again.',
    'api.tacticEvidence.fileContentMismatch': 'The file content does not match any supported format.',
    'api.tacticEvidence.declaredTypeMismatch': 'The declared file type does not match the actual content.',
    'api.tacticEvidence.fileLoadedButStaleAfterSave': 'The file was saved but something went wrong loading it. Please refresh.',
    'api.tacticEvidence.fileNotFound': 'File not found.',
    'api.tacticEvidence.fileDeleteFailed': 'Something went wrong deleting the file. Please try again.',
    'api.tacticEvidence.fileDeletedButStaleState': 'The file was deleted but something went wrong loading the updated state.',
    'api.tacticEvidence.evidenceDeleteFailed': 'Something went wrong deleting the evidence. Please try again.',
    'api.tacticEvidence.evidenceFileNotFound': 'Evidence not found.',
    'api.tacticEvidence.evidenceFileLoadFailed': 'Something went wrong loading the evidence file.',
    'api.tacticEvidence.fileChangedOrRemoved': 'The file was changed or removed. Please refresh.',
    'api.tacticEvidence.fileDownloadFailed': 'Something went wrong downloading the file.',
    'api.tacticEvidence.invalidCycleId': 'Invalid cycle ID.',
    'api.tacticEvidence.cycleNotFound': 'Cycle not found.',
    'api.tacticEvidence.cycleForbidden': 'You do not have permission to view this cycle.',

    // weekEvidence
    'api.weekEvidence.sessionExpired': 'Your session has expired. Please sign in again.',
    'api.weekEvidence.invalidParams': 'Invalid parameters.',
    'api.weekEvidence.needNoteOrLink': 'Add a note, link, or file.',
    'api.weekEvidence.itemNotFound': 'Item not found for this week.',
    'api.weekEvidence.keepNoteOrLink': 'Keep a note, link, or file.',
    'api.weekEvidence.fileTooLarge': 'That file is too large — the maximum is 8 MB.',
    'api.weekEvidence.unsupportedFileType': 'Only PNG, JPEG, WebP, PDF, DOCX, and TXT are supported.',
    'api.weekEvidence.fileContentMismatch': 'The file content does not match the declared format.',
    'api.weekEvidence.fileNotFound': 'File not found.',
    'api.weekEvidence.fileChangedOrRemoved': 'The file was changed or removed. Please refresh.',
    'api.weekEvidence.cycleNotFound': 'Cycle not found.',
    'api.weekEvidence.onlyOwnerCanEdit': 'Only the board owner can edit this week album.',
    'api.weekEvidence.forbidden': 'You do not have permission to view this week album.',

    // archiveSearch
    'api.archiveSearch.invalidQuery': 'Enter a search query between 1 and 120 characters, and a limit between 1 and 20.',
    // completions
    'api.completions.cycleEnded': 'This cycle has ended — execution records cannot be updated.',
    'api.completions.dayNotScheduled': 'Cannot mark a completion for a day that is not scheduled.',

    // dashboard
    'api.dashboard.invalidUserId': 'Invalid user ID.',
    'api.dashboard.forbidden': 'You do not have permission to view this board.',
    'api.dashboard.userNotFound': 'User not found.',

    // cycles
    'api.cycles.invalidUserId': 'Invalid user ID.',
    'api.cycles.forbidden': 'You do not have permission to view this cycle history.',
    'api.cycles.invalidId': 'Invalid ID.',
    'api.cycles.cycleForbidden': 'You do not have permission to view this cycle.',
    'api.cycles.cycleNotFound': 'Cycle not found.',

    // partnerships
    'api.partnerships.cannotSelectSelf': 'You cannot select yourself as a partner.',
    'api.partnerships.userNotFound': 'User not found.',
    'api.partnerships.senderHasPartner': 'You already have an active partner. Remove the existing partnership before choosing a new one.',
    'api.partnerships.targetHasPartner': 'That user already has a different partner.',
    'api.partnerships.notFound': 'Not found.',
    'api.partnerships.forbidden': 'Permission denied.',

    // goals
    'api.goals.noCycle': 'Create a cycle before adding goals.',
    'api.goals.tooMany': 'You can add up to {MAX_GOALS} goals per cycle.',
    'api.goals.notFound': 'Goal not found.',
    'api.goals.cycleEnded': 'This cycle has ended — goals cannot be edited.',
    'api.goals.confirmRequired': 'Confirm the deletion (confirm: true).',

    // executionHeatmap
    'api.executionHeatmap.invalidParams': 'Invalid user or cycle ID.',
    'api.executionHeatmap.forbidden': 'You do not have permission to view this execution heatmap.',
    'api.executionHeatmap.cycleNotFound': 'Cycle not found.',

    // cycle
    'api.cycle.alreadyActive': 'You already have an active cycle.',
    'api.cycle.noActiveCycle': 'No active cycle found.',
    'api.cycle.confirmRequired': 'Confirm the cycle end (confirm: true).',
  },
  he: {
    // auth
    'api.auth.notAuthenticated': 'לא מחובר/ת',
    'api.auth.sessionExpired': 'ההתחברות פגה, יש להתחבר מחדש',
    'api.auth.userNotFound': 'המשתמש לא נמצא',
    'api.auth.registrationClosed': 'ההרשמה אינה פתוחה כרגע',
    'api.auth.emailAlreadyRegistered': 'כתובת האימייל כבר רשומה',
    'api.auth.invalidCredentials': 'כתובת האימייל או הסיסמה שגויות',
    'api.auth.passwordResetEmailSent': 'אם כתובת האימייל רשומה, קישור לאיפוס הסיסמה בדרך',
    'api.auth.invalidResetToken': 'קישור האיפוס פג תוקפו או כבר שומש',
    'api.auth.passwordSameAsCurrent': 'הסיסמה החדשה זהה לסיסמה הנוכחית. יש לבחור סיסמה אחרת',

    // origin
    'api.origin.forbidden': 'מקור הבקשה אינו מורשה',

    // server
    'api.server.internalError': 'שגיאת שרת פנימית',

    // payload
    'api.payload.avatarTooLarge': 'התמונה גדולה מדי — הגודל המרבי הוא 2MB',
    'api.payload.fileTooLarge': 'הקובץ גדול מדי — הגודל המרבי הוא 8MB',
    'api.payload.tooLarge': 'הבקשה גדולה מדי',

    // profile
    'api.profile.staleSession': 'הסשן ישן, יש להתחבר מחדש',
    'api.profile.incorrectCurrentPassword': 'הסיסמה הנוכחית שגויה',
    'api.profile.noAvatar': 'לא הוגדרה תמונת פרופיל',
    'api.profile.unsupportedFileType': 'ניתן להעלות רק תמונות PNG, JPEG ו-WebP',
    'api.profile.invalidImageContent': 'הקובץ אינו תמונה תקינה',

    // tactics
    'api.tactics.goalNotFound': 'המטרה לא נמצאה',
    'api.tactics.cycleEnded': 'המחזור הסתיים — לא ניתן לערוך טקטיקות',
    'api.tactics.notFound': 'הטקטיקה לא נמצאה',
    'api.tactics.noFutureWeek': 'אין שבוע עתידי לתכנן',

    // wams
    'api.wams.isHistorical': 'פגישה זו שייכת למחזור שכבר הסתיים ולכן היא נעולה כהיסטוריה בלתי ניתנת לעריכה',
    'api.wams.noPartner': 'נדרש שותף/ה מאושר/ת כדי לקיים פגישת אחריותיות',
    'api.wams.notFound': 'הפגישה לא נמצאה',
    'api.wams.byWeekNotFound': 'עדיין לא נוצרה פגישה לשבוע זה',
    'api.wams.byWeekNoPartner': 'אין שותף/ה מאושר/ת',
    'api.wams.invalidWeek': 'שבוע לא תקין',
    'api.wams.mustBeOpenToEdit': 'יש לפתוח מחדש את הפגישה לפני עריכת התוכן',
    'api.wams.alreadyComplete': 'הפגישה כבר הושלמה. יש לפתוח מחדש כדי לעדכן ולהשלים שוב',
    'api.wams.nextWamRequired': 'יש לבחור מועד לפגישה הבאה. אין תמיכה בביטול תיאום קיים',
    'api.wams.nextWamMustBeFuture': 'מועד הפגישה הבאה חייב להיות בעתיד',
    'api.wams.cannotClearScheduledWam': 'לא ניתן להשלים את הפגישה ללא תיאום לאחר שכבר נקבע מועד לפגישה הבאה. ניתן לשנות את המועד, אך לא לבטלו — אין תמיכה בביטול הזמנות יומן שכבר נשלחו',
    'api.wams.completeFailed': 'שגיאה בהשלמת הפגישה. נא לנסות שוב',
    'api.wams.statusChanged': 'מצב הפגישה השתנה. יש לרענן לפני ניסיון נוסף',
    'api.wams.partialInvites': 'התיאום נשמר, אך חלק מההזמנות לא נשלחו. ניתן לנסות שוב; מצב הפגישה והציונים השמורים לא השתנו',
    'api.wams.invitesFailed': 'שליחת הזמנות היומן נכשלה עבור לפחות אחד/ת מהמשתתפים. הפגישה נשארה כטיוטה — ניתן לנסות שוב',
    'api.wams.ratingNotFound': 'הדירוג לא נמצא',
    'api.wams.commitmentNotFound': 'ההתחייבות לא נמצאה',
    'api.wams.mustBeOpenForCommitments': 'יש לפתוח מחדש את הפגישה כדי להוסיף התחייבויות',
    'api.wams.mustBeOpenToEditCommitment': 'יש לפתוח מחדש את הפגישה כדי לערוך את תוכן ההתחייבות',
    'api.wams.mustBeOpenToDeleteCommitment': 'יש לפתוח מחדש את הפגישה כדי למחוק התחייבות',
    'api.wams.punishmentNotFound': 'העונש לא נמצא',
    'api.wams.mustBeOpenForPunishments': 'יש לפתוח מחדש את הפגישה כדי להוסיף עונשים',
    'api.wams.invalidPunishmentAssignee': 'ניתן להטיל עונש רק על עצמך או על השותף/ה בפגישה זו',
    'api.wams.nextWamFrozen': 'הפגישה הבאה כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן להוסיף עונש שלעולם לא יסומן',
    'api.wams.punishmentAuthorOnly': 'רק מי שכתב/ה את העונש יכול/ה לערוך אותו',
    'api.wams.mustBeOpenToEditPunishment': 'יש לפתוח מחדש את הפגישה כדי לערוך עונש',
    'api.wams.dueWamFrozen': 'הפגישה שאליה שויך העונש כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן עוד לערוך את העונש',
    'api.wams.invalidPunishmentAssigneeEdit': 'ניתן להטיל עונש רק על עצמך או על השותף/ה בפגישה זו',
    'api.wams.mustBeOpenToDeletePunishment': 'יש לפתוח מחדש את הפגישה כדי למחוק עונש',
    'api.wams.duePunishmentNotFound': 'הפגישה שאליה שויך העונש כבר הושלמה או נעולה כהיסטוריה, ולכן לא ניתן עוד למחוק את העונש',
    'api.wams.assigneeOnlyCanToggle': 'רק מי שהעונש הוטל עליו/ה יכול/ה לסמן אותו כבוצע',
    'api.wams.mustBeOpenToToggle': 'יש לפתוח מחדש את הפגישה כדי לעדכן עונשים לביצוע',
    'api.wams.alreadyDraft': 'הפגישה כבר במצב טיוטה',
    'api.wams.updating': 'עדכון הפגישה כבר מתבצע. נא להמתין ולרענן',

    // broosts
    'api.broosts.noPartner': 'יש להתחבר לשותף/ה כדי לשלוח BROOST',
    'api.broosts.replyTargetNotFound': 'ה-BROOST שאליו רצית להשיב לא נמצא',
    'api.broosts.replyPartnerChanged': 'לא ניתן להשיב — השולח/ת כבר אינו/ה השותף/ה הנוכחי/ת',
    'api.broosts.sendFailed': 'שגיאה בשליחת ה-BROOST. יש לנסות שוב',
    'api.broosts.loadFailed': 'ה-BROOST נשלח אך אירעה שגיאה בטעינתו. יש לרענן',
    'api.broosts.invalidId': 'מזהה לא תקין',
    'api.broosts.notFound': 'ה-BROOST לא נמצא',
    'api.broosts.onlyRecipientCanRead': 'רק הנמען/ת יכול/ה לסמן BROOST כנקרא',
    'api.broosts.needPresetOrCustom': 'יש לבחור הודעה מוכנה או להקליד הודעה אישית',
    'api.broosts.needOneMessage': 'יש לבחור הודעה מוכנה או להקליד הודעה אישית — לא את שני האפשרויות יחד',
    'api.broosts.presetNotFound': 'ההודעה המוכנה שנבחרה אינה קיימת',
    'api.broosts.customTooLong': 'ההודעה האישית ארוכה מדי',
    'api.broosts.dailyLimitReached': 'הגעת למגבלת ה-BROOST היומית לשותף/ה הזה/ה. נסה/י שוב מאוחר יותר',
    'api.broosts.cooldownRequired': 'יש להמתין בין BROOST אחד למשנהו',
    'api.broosts.recipientNotFound': 'הנמען לא נמצא',

    // reminders
    'api.reminders.invalidId': 'מזהה תזכורת לא תקין',
    'api.reminders.notFound': 'התזכורת לא נמצאה',
    'api.reminders.recipientNotAllowed': 'ניתן לשלוח תזכורת רק לעצמך או לשותף/ה המחובר/ת כרגע',
    'api.reminders.tooManyActive': 'הגעת למגבלה המרבית של תזכורות פעילות',
    'api.reminders.invalidIsraelTime': 'מועד לא תקין (שעון ישראל) — ייתכן שמדובר בשעה שאינה קיימת עקב מעבר לשעון קיץ/חורף',
    'api.reminders.mustBeFuture': 'מועד התזכורת חייב להיות בעתיד',
    'api.reminders.updateConflict': 'לא ניתן היה לעדכן את התזכורת — היא כבר עברה עיבוד בינתיים. יש לרענן ולנסות שוב',
    'api.reminders.cancelConflict': 'לא ניתן היה לבטל את התזכורת — היא כבר עברה עיבוד בינתיים. יש לרענן ולנסות שוב',

    // weeklyPlanning
    'api.weeklyPlanning.invalidCycleId': 'מזהה מחזור לא תקין',
    'api.weeklyPlanning.invalidTargetWeek': 'שבוע יעד לא תקין — יש לבחור שבוע בין 2 ל-12',
    'api.weeklyPlanning.cycleNotFound': 'המחזור לא נמצא',
    'api.weeklyPlanning.forbidden': 'אין הרשאה לצפות בטקס התכנון השבועי',
    'api.weeklyPlanning.onlyOwnerCanEdit': 'רק בעל/ת הלוח יכול/ה לערוך את טקס התכנון השבועי',
    'api.weeklyPlanning.cycleEnded': 'המחזור הסתיים — לא ניתן לערוך את טקס התכנון השבועי בהיסטוריה',
    'api.weeklyPlanning.atFinalWeek': 'המחזור הגיע לשבוע 12, השבוע האחרון — יש לסיים ולסקור את המחזור לפני תכנון שבוע נוסף',
    'api.weeklyPlanning.mustBeNextWeek': 'ניתן לתכנן רק את השבוע הבא ביחס לשבוע הנוכחי במחזור',
    'api.weeklyPlanning.mustBeOpenToEdit': 'יש לפתוח מחדש את הטקס לפני עריכת התוכן',
    'api.weeklyPlanning.noDraftToComplete': 'יש לשמור טיוטה של הטקס לפני השלמתו',
    'api.weeklyPlanning.alreadyComplete': 'הטקס כבר הושלם. יש לפתוח מחדש כדי לעדכן ולהשלים שוב',
    'api.weeklyPlanning.tacticsReviewRequired': 'יש לאשר שבדקתם והתאמתם את הטקטיקות לשבוע הבא',
    'api.weeklyPlanning.weeklyFocusRequired': 'יש להגדיר את המיקוד המרכזי לשבוע הבא',
    'api.weeklyPlanning.commitmentRequired': 'יש להזין את ההתחייבות לשבוע הבא',
    'api.weeklyPlanning.ritualNotFound': 'הטקס לא נמצא',
    'api.weeklyPlanning.alreadyDraft': 'הטקס כבר במצב טיוטה',

    // executionRecovery
    'api.executionRecovery.invalidUserId': 'מזהה משתמש לא תקין',
    'api.executionRecovery.forbidden': 'אין הרשאה לצפות בתוכנית החילוץ',
    'api.executionRecovery.onlyOwnerCanEdit': 'רק בעל/ת הלוח יכול/ה לערוך את תוכנית החילוץ',
    'api.executionRecovery.noActiveCycle': 'אין מחזור פעיל',
    'api.executionRecovery.atFinalWeek': 'המחזור בשבוע 12, השבוע האחרון — אין שבוע הבא לצמצם. ניתן ליצור מהלך חילוץ לשבוע הנוכחי בלבד',
    'api.executionRecovery.alreadyHasPlan': 'לשבוע זה כבר קיימת תוכנית חילוץ — לא ניתן ליצור תוכנית נוספת',
    'api.executionRecovery.existingReducePlanCannotConvert': 'לשבוע זה כבר קיימת תוכנית צמצום השבוע הבא — לא ניתן להמיר אותה',
    'api.executionRecovery.mustBeOpenToEdit': 'יש לפתוח מחדש את התוכנית לפני עריכתה',
    'api.executionRecovery.mustIncludeAllNextWeekTactics': 'יש לכלול בבחירה את כל הטקטיקות המתוכננות לשבוע הבא, ורק אותן',
    'api.executionRecovery.mustReduce': 'סך הפעולות המתוכננות לשבוע הבא חייב לרדת לעומת המצב הנוכחי',
    'api.executionRecovery.mustKeepOneTactic': 'חייבת להישאר לפחות פעולה מתוכננת אחת לשבוע הבא',
    'api.executionRecovery.planNotFound': 'לא נמצאה תוכנית חילוץ לשבוע הנוכחי',
    'api.executionRecovery.alreadyResolved': 'התוכנית כבר סומנה כפתורה',
    'api.executionRecovery.cannotReopenReduce': 'לא ניתן לפתוח מחדש תוכנית צמצום השבוע הבא — הצמצום כבר בוצע בפועל ואינו הפיך',
    'api.executionRecovery.alreadyActive': 'התוכנית כבר פעילה',

    // tacticEvidence
    'api.tacticEvidence.invalidParams': 'פרמטרים לא תקינים',
    'api.tacticEvidence.linkInvalid': 'הקישור אינו כתובת URL תקינה',
    'api.tacticEvidence.linkProtocol': 'הקישור חייב להתחיל ב-http:// או https://',
    'api.tacticEvidence.tacticNotFound': 'הטקטיקה לא נמצאה',
    'api.tacticEvidence.accessForbidden': 'אין הרשאה לצפות בעדות עבור הטקטיקה הזו',
    'api.tacticEvidence.sessionExpired': 'ההתחברות פגה, יש להתחבר מחדש',
    'api.tacticEvidence.onlyOwnerCanEdit': 'רק הבעלים יכול/ה לערוך עדות',
    'api.tacticEvidence.noWeeklyCompletionForEvidence': 'ניתן להוסיף עדות שבועית לאחר השלמת ביצוע אחד לפחות בשבוע',
    'api.tacticEvidence.noCompletionForEvidence': 'ניתן להוסיף עדות רק לביצוע שהושלם',
    'api.tacticEvidence.evidenceCannotBeEmpty': 'יש להשאיר הערה, קישור או קובץ — הרשומה לא יכולה להיות ריקה לחלוטין',
    'api.tacticEvidence.fileTooLarge': 'הקובץ גדול מדי — הגודל המרבי הוא 8MB',
    'api.tacticEvidence.unsupportedFileType': 'סוג קובץ לא נתמך — יש להעלות PNG, JPEG, WebP, PDF, DOCX או TXT',
    'api.tacticEvidence.fileSaveFailed': 'שגיאה בשמירת הקובץ. יש לנסות שוב',
    'api.tacticEvidence.fileContentMismatch': 'תוכן הקובץ אינו תואם אף אחד מהפורמטים הנתמכים',
    'api.tacticEvidence.declaredTypeMismatch': 'סוג הקובץ שהוצהר אינו תואם לתוכן בפועל של הקובץ',
    'api.tacticEvidence.fileLoadedButStaleAfterSave': 'הקובץ נשמר אך אירעה שגיאה בטעינתו. יש לרענן',
    'api.tacticEvidence.fileNotFound': 'לא נמצא קובץ',
    'api.tacticEvidence.fileDeleteFailed': 'שגיאה במחיקת הקובץ. יש לנסות שוב',
    'api.tacticEvidence.fileDeletedButStaleState': 'הקובץ נמחק אך אירעה שגיאה בטעינת המצב העדכני',
    'api.tacticEvidence.evidenceDeleteFailed': 'שגיאה במחיקת העדות. יש לנסות שוב',
    'api.tacticEvidence.evidenceFileNotFound': 'לא נמצאה עדות עם מזהה זה',
    'api.tacticEvidence.evidenceFileLoadFailed': 'שגיאה בטעינת קובץ העדות',
    'api.tacticEvidence.fileChangedOrRemoved': 'הקובץ השתנה או הוסר. יש לרענן ולנסות שוב',
    'api.tacticEvidence.fileDownloadFailed': 'שגיאה בהורדת הקובץ',
    'api.tacticEvidence.invalidCycleId': 'מזהה מחזור לא תקין',
    'api.tacticEvidence.cycleNotFound': 'המחזור לא נמצא',
    'api.tacticEvidence.cycleForbidden': 'אין הרשאה לצפות במחזור זה',

    // weekEvidence
    'api.weekEvidence.sessionExpired': 'ההתחברות פגה, יש להתחבר מחדש',
    'api.weekEvidence.invalidParams': 'פרמטרים לא תקינים',
    'api.weekEvidence.needNoteOrLink': 'יש להוסיף הערה, קישור או קובץ',
    'api.weekEvidence.itemNotFound': 'הפריט לא נמצא בשבוע הזה',
    'api.weekEvidence.keepNoteOrLink': 'יש להשאיר הערה, קישור או קובץ',
    'api.weekEvidence.fileTooLarge': 'הקובץ גדול מדי — הגודל המרבי הוא 8MB',
    'api.weekEvidence.unsupportedFileType': 'יש להעלות PNG, JPEG, WebP, PDF, DOCX או TXT בלבד',
    'api.weekEvidence.fileContentMismatch': 'תוכן הקובץ אינו תואם לפורמט הנתמך שהוצהר',
    'api.weekEvidence.fileNotFound': 'לא נמצא קובץ',
    'api.weekEvidence.fileChangedOrRemoved': 'הקובץ השתנה או הוסר. יש לרענן',
    'api.weekEvidence.cycleNotFound': 'המחזור לא נמצא',
    'api.weekEvidence.onlyOwnerCanEdit': 'רק הבעלים יכול/ה לערוך את אלבום השבוע',
    'api.weekEvidence.forbidden': 'אין הרשאה לצפות באלבום',

    // archiveSearch
    'api.archiveSearch.invalidQuery': 'יש להזין חיפוש באורך 1–120 תווים ומגבלה של 1–20 תוצאות לקבוצה',
    // completions
    'api.completions.cycleEnded': 'המחזור הסתיים — לא ניתן לעדכן ביצועים בהיסטוריה',
    'api.completions.dayNotScheduled': 'לא ניתן לסמן ביצוע ליום שאינו מתוזמן',

    // dashboard
    'api.dashboard.invalidUserId': 'מזהה משתמש לא תקין',
    'api.dashboard.forbidden': 'אין הרשאה לצפות בלוח הזה',
    'api.dashboard.userNotFound': 'המשתמש לא נמצא',

    // cycles
    'api.cycles.invalidUserId': 'מזהה משתמש לא תקין',
    'api.cycles.forbidden': 'אין הרשאה לצפות בהיסטוריית המחזורים',
    'api.cycles.invalidId': 'מזהה לא תקין',
    'api.cycles.cycleForbidden': 'אין הרשאה לצפות במחזור זה',
    'api.cycles.cycleNotFound': 'המחזור לא נמצא',

    // partnerships
    'api.partnerships.cannotSelectSelf': 'לא ניתן לבחור את עצמך כשותף/ה',
    'api.partnerships.userNotFound': 'המשתמש/ת לא נמצא/ה',
    'api.partnerships.senderHasPartner': 'כבר יש לך שותף/ה פעיל/ה. יש להסיר את השיתוף הקיים לפני בחירת שותף/ה חדש/ה',
    'api.partnerships.targetHasPartner': 'למשתמש/ת שנבחר/ה כבר יש שותף/ה אחר/ת',
    'api.partnerships.notFound': 'לא נמצא',
    'api.partnerships.forbidden': 'אין הרשאה',

    // goals
    'api.goals.noCycle': 'יש ליצור מחזור לפני הוספת מטרות',
    'api.goals.tooMany': 'ניתן להוסיף עד {MAX_GOALS} מטרות למחזור',
    'api.goals.notFound': 'המטרה לא נמצאה',
    'api.goals.cycleEnded': 'המחזור הסתיים — לא ניתן לערוך מטרות בהיסטוריה',
    'api.goals.confirmRequired': 'יש לאשר את המחיקה (confirm: true)',

    // executionHeatmap
    'api.executionHeatmap.invalidParams': 'מזהה משתמש או מחזור לא תקין',
    'api.executionHeatmap.forbidden': 'אין הרשאה לצפות במפת הביצוע הזו',
    'api.executionHeatmap.cycleNotFound': 'המחזור לא נמצא',

    // cycle
    'api.cycle.alreadyActive': 'כבר קיים מחזור פעיל',
    'api.cycle.noActiveCycle': 'אין מחזור פעיל',
    'api.cycle.confirmRequired': 'יש לאשר את סיום המחזור (confirm: true)',
  },
};
