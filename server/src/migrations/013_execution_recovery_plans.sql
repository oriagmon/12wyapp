-- Execution recovery plans: from Wednesday onward (Israel time) in an owner's active-cycle
-- current week, the app flags the week as "at risk" if either the completion rate of
-- actions due so far is below 65%, or even completing every remaining scheduled action this
-- week could not reach the 85% target score (see server/src/lib/executionRisk.ts for the
-- pure calculation). This table records the owner's chosen response, one row per (cycle,
-- week) — the week being the *at-risk* week itself, not the target of any adjustment.
--
-- Two strategies:
--   - 'reduce_next_week': a concrete, explicit reduction of *next* week's scheduled workload
--     (applied via tactic_week_overrides for next week only — see routes/executionRecovery.ts
--     — never the current or any past/later week). Since applying the reduction *is* the
--     complete action, a plan created this way is recorded already 'resolved', with
--     adjustment_json holding a before/after snapshot of what changed, for a permanent,
--     readable history entry (never mutated afterwards).
--   - 'maneuver': a concrete free-text plan for rescuing the *current* week, shown as a
--     pinned Home card until the owner manually resolves it (never auto-resolved just
--     because live metrics later improve).
--
-- Owner scope is derived transitively via cycle_id -> cycles.user_id, exactly like
-- weekly_planning_rituals (migration 009) — no separate user_id column needed. An archived
-- cycle is immutable: the application only ever creates/updates a plan against a user's
-- current *active* cycle (see loadContext() in routes/executionRecovery.ts), so a cycle
-- being archived naturally makes every plan tied to it permanently read-only history.
CREATE TABLE IF NOT EXISTS execution_recovery_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  week INTEGER NOT NULL CHECK (week BETWEEN 1 AND 12),
  strategy TEXT NOT NULL CHECK (strategy IN ('reduce_next_week', 'maneuver')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  -- Only populated for 'reduce_next_week': a JSON snapshot of the before/after weekday
  -- selections per tactic, for a permanent, human-readable record of exactly what was
  -- reduced (see routes/executionRecovery.ts). NULL for 'maneuver'.
  adjustment_json TEXT CHECK (adjustment_json IS NULL OR json_valid(adjustment_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at TEXT,
  UNIQUE (cycle_id, week)
);
CREATE INDEX IF NOT EXISTS idx_execution_recovery_plans_cycle ON execution_recovery_plans(cycle_id);
