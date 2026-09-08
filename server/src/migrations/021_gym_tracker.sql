-- Gym tracker: workout log + daily body weight.
--
-- The gym tracker used to be a separate static page whose entire dataset lived in the
-- browser's local storage. That meant clearing site data, switching phones, or a browser
-- eviction silently destroyed months of training history, and nothing was ever backed up.
-- Moving it in here puts it in the same SQLite file as everything else, which the nightly
-- Azure Blob backup already covers, and lets it reuse the existing session cookie instead
-- of inventing a second login.
--
-- `gym_state` deliberately stores the workout log as one JSON blob rather than normalising
-- sets into rows. The tracker owns that shape, it is read and written whole on every sync,
-- and nothing on the server ever needs to query inside it. Normalising it would buy us
-- nothing and would couple the server to the client's exercise catalogue, which changes
-- whenever the training programme does.
--
-- Body weight is the opposite case: it IS queried on the server (latest value, recent
-- trend, "did I already weigh in today"), so it gets real columns.

CREATE TABLE IF NOT EXISTS gym_state (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT    NOT NULL DEFAULT '{"sessions":[],"active":null}',
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One weigh-in per calendar day per user. Re-weighing on the same morning corrects the
-- day's figure rather than appending a second reading, so the UPSERT in the route relies
-- on this constraint. `measured_on` is a local 'YYYY-MM-DD' date, not a timestamp: the
-- whole point is "my weight on this morning", and storing an instant would make the day a
-- timezone question.
--
-- `condition` records whether the reading was taken before or after the first trip to the
-- bathroom. That is worth a column rather than a note because it routinely accounts for a
-- few hundred grams, which is the same order as the change you are actually trying to
-- observe: comparing a "before" day against an "after" day produces a swing that looks like
-- a real gain and is not one. NULL means it simply was not recorded.
CREATE TABLE IF NOT EXISTS body_weights (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on TEXT    NOT NULL,
  kg          REAL    NOT NULL,
  condition   TEXT    CHECK (condition IS NULL OR condition IN ('before', 'after')),
  recorded_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, measured_on)
);

CREATE INDEX IF NOT EXISTS idx_body_weights_user_date
  ON body_weights (user_id, measured_on DESC);
