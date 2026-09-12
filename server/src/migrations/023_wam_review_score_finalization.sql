-- Distinguishes a *provisional* frozen week score from a *final* one.
--
-- `wam_reviews.score_snapshot` is written once, when the meeting is completed
-- (routes/wams.ts). That was fine only under the unstated assumption that the meeting
-- happens after the week it reviews is over. In practice these meetings are held on Friday
-- or Saturday morning, while two more days of the week are still unticked — so the number
-- frozen forever was a half-finished week.
--
-- That silently broke everything downstream: DUO_STREAK_THRESHOLD is 85, so a Friday
-- meeting could not clear it even when both people went on to finish the week at 100%, the
-- duo streak never counted the week, and the celebration scoreboard never appeared.
--
-- A cycle has no start date and `cycles.current_week` is advanced by hand, so "is week N
-- over?" has exactly one honest answer in this schema: week N is over for a person once
-- *their own* cycle has moved past it (current_week > N). This column records the moment we
-- acted on that, per review row, so the recomputation happens exactly once and the value is
-- genuinely immutable from then on.
--
--   NULL     -> still provisional: frozen mid-week, the reviewed week may still gain ticks.
--   not NULL -> final: the owner's cycle had already moved past this week when we re-froze.
ALTER TABLE wam_reviews ADD COLUMN score_finalized_at TEXT;

-- Finding the reviews still awaiting finalization is a per-request/per-advance lookup, and
-- the overwhelming majority of rows become and stay non-NULL, so index only the open ones.
CREATE INDEX IF NOT EXISTS idx_wam_reviews_pending_finalization
  ON wam_reviews(wam_id) WHERE score_finalized_at IS NULL;
