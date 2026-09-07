export type GoalColor = 'emerald' | 'blue' | 'purple' | 'gold';
export type AccessLevel = 'owner' | 'partner';
export type Theme = 'dark' | 'light';

export interface Completion {
  week: number;
  weekday: number;
  done: boolean;
  /** Whether this occurrence has a tactic-evidence record (note/link/file) — see
   *  useTacticEvidence.ts. Populated by the server's cycleBundle.ts so the client can show a
   *  compact indicator without a second round trip. */
  hasEvidence?: boolean;
}

export interface Tactic {
  id: number;
  title: string;
  weekdays: number[];
  startWeek: number;
  endWeek: number;
  overrides?: TacticWeekOverride[];
  completions: Completion[];
  /** Weeks with weekly or legacy daily evidence, independent of completion/schedule rows. */
  evidenceWeeks?: number[];
}

export interface TacticWeekOverride {
  week: number;
  title: string;
  weekdays: number[];
}

export interface Goal {
  id: number;
  title: string;
  color: GoalColor;
  tactics: Tactic[];
}

export interface Cycle {
  id: number;
  name: string;
  currentWeek: number;
  isActive: boolean;
  vision: string;
  successDefinition: string;
  whyItMatters: string;
  blockers: string;
  risks: string;
  lagMeasures: string;
  leadMeasures: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CycleSummary {
  id: number;
  name: string;
  currentWeek: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CycleHistoryListResponse {
  access: AccessLevel;
  cycles: CycleSummary[];
}

export interface CycleHistoryDetailResponse {
  access: AccessLevel;
  cycle: Cycle;
  goals: Goal[];
  weekScores: WeekScore[];
  averageScore: number | null;
}

export interface WeekScore {
  week: number;
  scheduled: number;
  completed: number;
  score: number | null;
}

export interface DashboardBundle {
  access: AccessLevel;
  targetEmail: string;
  cycle: Cycle | null;
  goals: Goal[];
  weekScores: WeekScore[];
  averageScore: number | null;
}

export interface PartnerInfo {
  id: number;
  email: string;
  /** Empty when never set — always render via personLabel() in lib/people.ts. */
  displayName: string;
  partnershipId: number;
}

export interface RegisteredUser {
  id: number;
  email: string;
}

export interface PartnershipsState {
  partner: PartnerInfo | null;
}

// --- Weekly Accountability Meetings (WAMs) ---

export type WamStatus = 'draft' | 'complete';
export type CommitmentScope = 'a' | 'b' | 'shared';

export interface WamPartnershipMeta {
  id: number;
  initiatorId: number;
  inviteeId: number;
  initiatorEmail: string;
  inviteeEmail: string;
}

export interface WamSummary {
  id: number;
  week: number;
  status: WamStatus;
  isHistorical: boolean;
  updatedAt: string;
  completedAt: string | null;
  ratingA: number | null;
  ratingB: number | null;
  scoreSnapshotA: number | null;
  scoreSnapshotB: number | null;
  commitmentsTotal: number;
  commitmentsDone: number;
  punishmentsDueTotal: number;
  punishmentsDueDone: number;
}

export interface WamUserWeekSnapshot {
  hasCycle: boolean;
  cycleId: number | null;
  cycleName: string | null;
  cycleIsActive: boolean;
  currentWeek: number | null;
  score: number | null;
  scheduled: number;
  completed: number;
}

export interface WamReviewSide {
  userId: number;
  email: string;
  rating: number | null;
  scoreSnapshot: number | null;
  live: WamUserWeekSnapshot;
}

export interface WamCommitment {
  id: number;
  scope: CommitmentScope;
  label: string;
  done: boolean;
}

export interface WamPunishment {
  id: number;
  label: string;
  done: boolean;
  completedAt: string | null;
  dueWamId: number | null;
  authorUserId: number;
  authorLabel: string;
  assignedUserId: number;
  assigneeLabel: string;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WamDuePunishment {
  id: number;
  label: string;
  done: boolean;
  completedAt: string | null;
  sourceWamId: number;
  sourceWeek: number;
  authorUserId: number;
  authorLabel: string;
  assignedUserId: number;
  assigneeLabel: string;
  canToggle: boolean;
}

export interface WamNextSchedule {
  at: string | null;
  durationMinutes: number | null;
  sequence: number;
}

export interface WamCalendarInvitationStatus {
  status: 'sent' | 'failed' | null;
  error: string | null;
  sentAt: string | null;
}

export interface WamDetail {
  id: number;
  week: number;
  status: WamStatus;
  isHistorical: boolean;
  wins: string;
  misses: string;
  blockers: string;
  lessonsLearned: string;
  notes: string;
  adjustmentNotes: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  partnership: WamPartnershipMeta;
  mismatch: boolean;
  nextWam: WamNextSchedule;
  calendarInvitations: { a: WamCalendarInvitationStatus; b: WamCalendarInvitationStatus };
  reviews: { a: WamReviewSide; b: WamReviewSide };
  commitments: WamCommitment[];
  punishments: WamPunishment[];
  duePunishments: WamDuePunishment[];
  /** True only when this WAM is an editable draft, non-historical, AND its own next-WAM
   *  candidate (if one already exists) is not itself frozen (complete/historical) — a new
   *  punishment could never be checked off otherwise. Drives whether the Punishments composer
   *  is shown, vs. a concise read-only explanation. */
  canAddPunishment: boolean;
  duoStreak: DuoStreakSummary;
}

export interface WamListResponse {
  partnership: WamPartnershipMeta | null;
  wams: WamSummary[];
  /** Null exactly when there is no accepted partnership at all (mirrors `partnership`). */
  duoStreak: DuoStreakSummary | null;
}

// --- Duo Streak + post-completion celebration ---

/** Profile-safe fields for a WAM participant shown in the Duo Streak card or celebration
 *  overlay — mirrors the shape `Avatar` already expects (`displayName`/`email`/`hasAvatar`/
 *  `avatarVersion`), never bio or avatar bytes. */
export interface DuoStreakParticipant {
  userId: number;
  displayName: string;
  email: string;
  hasAvatar: boolean;
  avatarVersion: number;
}

export interface DuoStreakLatestSuccess {
  wamId: number;
  week: number;
  completedAt: string;
  scoreA: number;
  scoreB: number;
}

export interface DuoStreakSummary {
  currentStreak: number;
  bestStreak: number;
  totalDuoWins: number;
  latestDuoSuccess: DuoStreakLatestSuccess | null;
  participants: [DuoStreakParticipant, DuoStreakParticipant];
}

export interface CelebrationParticipant extends DuoStreakParticipant {
  /** The exact frozen score snapshot from the WAM that was just completed. */
  score: number;
}

/** Strict discriminated union describing how to celebrate a just-completed WAM — attached
 *  only to a successful `POST /:id/complete` response, never to GET/list responses, so the
 *  client can tell "just completed via this mutation" apart from "merely (re)loaded an
 *  already-complete WAM" without any extra bookkeeping. */
export type WamCelebration =
  | { type: 'duo-success'; participants: [CelebrationParticipant, CelebrationParticipant]; currentStreak: number }
  | { type: 'spotlight'; winner: CelebrationParticipant; other: CelebrationParticipant }
  | { type: 'tie'; participants: [CelebrationParticipant, CelebrationParticipant] }
  | { type: 'completion' };

export interface WamCompleteResult {
  wam: WamDetail;
  celebration: WamCelebration;
}
