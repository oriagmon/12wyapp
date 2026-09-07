import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('errors.validation.email');
export const passwordSchema = z
  .string()
  .min(8, 'errors.validation.passwordTooShort')
  .max(200, 'errors.validation.passwordTooLong');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'errors.validation.passwordRequired'),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, 'errors.validation.resetLinkInvalid').max(512, 'errors.validation.resetLinkInvalid'),
  newPassword: passwordSchema,
});

export const pairWithUserSchema = z.object({
  targetUserId: z.number().int().positive(),
});

export const cycleUpdateSchema = z.object({
  name: z.string().trim().min(1, 'errors.validation.cycleNameEmpty').max(120).optional(),
  currentWeek: z.number().int().min(1).max(12).optional(),
  vision: z.string().max(4000).optional(),
  successDefinition: z.string().max(4000).optional(),
  whyItMatters: z.string().max(4000).optional(),
  blockers: z.string().max(4000).optional(),
  risks: z.string().max(4000).optional(),
  lagMeasures: z.string().max(4000).optional(),
  leadMeasures: z.string().max(4000).optional(),
  notes: z.string().max(4000).optional(),
});

export const cycleCreateSchema = z.object({
  name: z.string().trim().min(1, 'errors.validation.cycleNameEmpty').max(120),
});

export const GOAL_COLORS = ['emerald', 'blue', 'purple', 'gold'] as const;
export type GoalColor = (typeof GOAL_COLORS)[number];

export const goalCreateSchema = z.object({
  title: z.string().trim().min(1, 'errors.validation.goalTitleEmpty').max(120),
  color: z.enum(GOAL_COLORS).optional(),
});

export const goalUpdateSchema = z.object({
  title: z.string().trim().min(1, 'errors.validation.goalTitleEmpty').max(120).optional(),
});

const weekdaySchema = z.number().int().min(0).max(6);

export const tacticCreateSchema = z
  .object({
    goalId: z.number().int().positive(),
    title: z.string().trim().min(1, 'errors.validation.tacticTitleEmpty').max(160),
    weekdays: z.array(weekdaySchema).min(1, 'errors.validation.weekdaysRequired').max(7),
    startWeek: z.number().int().min(1).max(12),
    endWeek: z.number().int().min(1).max(12),
  })
  .refine((v) => v.endWeek >= v.startWeek, {
    message: 'errors.validation.endWeekBeforeStart',
    path: ['endWeek'],
  });

export const tacticUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    weekdays: z.array(weekdaySchema).min(1).max(7).optional(),
    startWeek: z.number().int().min(1).max(12).optional(),
    endWeek: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => (v.startWeek !== undefined && v.endWeek !== undefined ? v.endWeek >= v.startWeek : true), {
    message: 'errors.validation.endWeekBeforeStart',
    path: ['endWeek'],
  });

export const tacticAdaptationSchema = z.object({
  title: z.string().trim().min(1, 'errors.validation.tacticTitleEmpty').max(160),
  weekdays: z.array(weekdaySchema).min(1, 'errors.validation.weekdaysRequired').max(7),
  scope: z.enum(['nextWeek', 'restOfCycle']),
});

export const completionToggleSchema = z.object({
  tacticId: z.number().int().positive(),
  week: z.number().int().min(1).max(12),
  weekday: weekdaySchema,
  done: z.boolean(),
});

export const settingsUpdateSchema = z.object({
  theme: z.enum(['dark', 'light']),
});

export const wamCreateSchema = z.object({
  week: z.number().int().min(1).max(12),
});

const longText = z.string().max(4000).optional();

export const wamContentUpdateSchema = z.object({
  wins: longText,
  misses: longText,
  blockers: longText,
  lessonsLearned: longText,
  notes: longText,
  adjustmentNotes: longText,
});

export const wamRatingSchema = z.object({
  rating: z.number().int().min(1).max(10),
});

export const wamCompleteSchema = z.object({
  nextWamAt: z.string().datetime({ message: 'errors.validation.invalidDate' }).nullable().optional(),
  nextWamDurationMinutes: z.number().int().min(1).max(24 * 60).optional(),
});

export const WAM_COMMITMENT_SCOPES = ['a', 'b', 'shared'] as const;

export const commitmentCreateSchema = z.object({
  label: z.string().trim().min(1, 'errors.validation.commitmentLabelEmpty').max(300),
  scope: z.enum(WAM_COMMITMENT_SCOPES),
});

export const commitmentUpdateSchema = z.object({
  label: z.string().trim().min(1).max(300).optional(),
  scope: z.enum(WAM_COMMITMENT_SCOPES).optional(),
  done: z.boolean().optional(),
});

export const PUNISHMENT_MAX_LABEL_LENGTH = 300;

// Strict — an unknown/extra field (e.g. a spoofed `authorUserId` or `done`) is rejected
// outright rather than silently ignored, consistent with treating the request body as a
// fully-validated contract rather than a loose bag of fields the server picks through.
export const punishmentCreateSchema = z
  .object({
    label: z.string().trim().min(1, 'errors.validation.punishmentLabelEmpty').max(PUNISHMENT_MAX_LABEL_LENGTH),
    assignedUserId: z.number().int().positive(),
  })
  .strict();

export const punishmentUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(PUNISHMENT_MAX_LABEL_LENGTH).optional(),
    assignedUserId: z.number().int().positive().optional(),
  })
  .strict()
  .refine((data) => data.label !== undefined || data.assignedUserId !== undefined, {
    message: 'errors.validation.punishmentUpdateEmpty',
  });

export const punishmentToggleSchema = z
  .object({
    done: z.boolean(),
  })
  .strict();
