# 12wyapp — Operations & Reference

> The full technical runbook. For what this app is and why, start with the
> [README](../README.md).

Web app for running 12-week execution cycles: up to 3 goals, weekly
tactics, daily completion tracking, scoring against an 85-point target, a
12-week trend chart, an optional read-only accountability partner, shared
Weekly Accountability Meetings (WAMs) between paired partners, Tuesday email
reminders, and full multi-cycle history. The interface is currently Hebrew (RTL).

Stack: React + Vite (TypeScript) frontend, Express + better-sqlite3 (TypeScript)
backend, npm workspaces monorepo, SQL migrations, cookie-based sessions.

## V1 scope

- **Hebrew only** — no i18n/localization.
- **Responsive web with standalone installation metadata** — mobile bottom
  navigation and safe-area layouts; no offline data cache or native app.
- **No admin panel or browser push**; BROOST notifications refresh in-app
  through polling and focus/change events. Both an authenticated,
  in-session **password change** (current + new password, from the profile
  page — see "Profile, avatar, and success streak" below) **and** a
  self-service **"forgot password" email reset flow** (see "Password reset
  (forgot password)" below) are supported.
- **Data export**: authenticated JSON export of everything the user owns
  (`GET /api/export` / the "⬇️ ייצוא הנתונים שלי" button), including safe
  profile metadata (display name, bio, avatar presence/version, success
  streak) — never the avatar image bytes, password hash, or session tokens.
  No CSV, no import, no account deletion.

## Security

Production is served over HTTPS at
`https://your-app.example.com/`. Session cookies are
`HttpOnly`, `SameSite=Lax`, and `Secure` in production. Nginx forwards the
original protocol to Express, which trusts the single local reverse proxy.

### Operator-approved membership

Production is private: configure `APP_ALLOWED_USER_IDS` with the existing
account IDs explicitly approved by the operator. Public signup is disabled,
and unapproved accounts cannot log in or use private APIs even with an
existing session cookie. Pairing candidates and targets are restricted to
approved accounts. There is no public account-approval endpoint.

Production startup requires a nonempty, valid ID list and an HTTPS
`APP_PUBLIC_URL`; policy validation precedes migrations and evidence setup.
Do not guess IDs, approve every existing account, or deploy a blank policy:
confirm the intended members before restarting. Restart after changing
either setting. Removing access does not delete the user's stored data.

Only the exact configured production origin is trusted for browser API
requests; sibling hosts, wildcards, and `Origin: null` are rejected.
Passwords use bcrypt with cost 12 and fresh random salts. Login, password
change, and reset revalidate their authorization and credential state
inside the final transaction, so stale in-flight operations cannot revive
credentials revoked by a later password change/reset.

## Project layout

```
server/   Express API, SQLite migrations, auth, business logic, tests
client/   React + Vite frontend (RTL, dark/light theme)
scripts/  Operational scripts (backup)
deploy/   Sample systemd unit + Nginx reverse-proxy config
```

## Local development

Requires Node.js >= 18.18.

```bash
npm install                 # installs both workspaces
cp .env.example server/.env # edit HOST/PORT/DATA_DIR as needed
npm run migrate             # creates server/data/app.sqlite and applies schema
npm run dev:server          # http://127.0.0.1:4000 (API only)
npm run dev:client          # http://localhost:5173 (Vite dev server, proxies /api)
```

Open http://localhost:5173 during development. The Vite dev server proxies
`/api/*` requests to the backend on port 4000 (see `client/vite.config.ts`).

Before starting an open local development instance, set
`NODE_ENV=development` in `server/.env` and **remove** the
`APP_ALLOWED_USER_IDS` line entirely. An explicitly blank or malformed
allowlist is an error in every mode; a configured valid list closes signup
even in development. Use a local `APP_PUBLIC_URL` for local email links.
Never point development or tests at the production data directories.

## Production build & run

```bash
npm install
npm run build      # builds client (client/dist) then server (server/dist)
npm run migrate    # apply any pending SQL migrations
npm run start       # serves the built frontend + /api from one Node process
```

The server binds to `HOST`/`PORT` from `server/.env` (defaults to
`127.0.0.1:4000`) and serves the built frontend from `client/dist` alongside
the `/api/*` routes and `/api/health`.

### Restarting after a deploy

```bash
git pull
npm install
npm run build
npm run migrate     # safe to run repeatedly; only new migrations are applied
sudo systemctl restart 12-week-dashboard   # if using the systemd sample below
```

### systemd + Nginx (optional)

Sample files are in `deploy/`:

- `deploy/12-week-dashboard.service.sample` — copy to
  `/etc/systemd/system/12-week-dashboard.service`, adjust the user and paths,
  then `systemctl daemon-reload && systemctl enable --now 12-week-dashboard`.
- `deploy/nginx.conf.sample` — a minimal reverse-proxy starting point. The
  live deployment additionally terminates TLS with a Let's Encrypt
  certificate and redirects HTTP to HTTPS.

### Weekly WAM email reminder (optional)

A standalone CLI (`server/dist/sendWamReminders.js`, built from
`server/src/sendWamReminders.ts`) sends a Hebrew reminder email — "did you
schedule your WAM time this week?" with a link back to the app — to **both**
members of every active direct partnership. Users without a partnership are
skipped. It uses [Azure Communication Services
Email](https://learn.microsoft.com/azure/communication-services/concepts/email/email-overview)
(`@azure/communication-email`), a low-cost, pay-per-email service with no
server to run.

**Monthly review prompt**: weeks 4, 8, and 12 of a cycle are treated as
monthly review WAMs. When a recipient's own active cycle is one week away
from one of those (current week 3, 7, or 11), the same Tuesday email adds a
prominent Hebrew callout naming the upcoming review's week/month number (e.g.
"שבוע 4" / "חודש 1") — there is never a second, separate email for this; it's
appended into the same weekly reminder. A recipient with no active cycle, or
whose partner is on a different week, only gets the normal weekly reminder.

Configure it via three env vars in `server/.env` (see `.env.example`) — only
required to run this CLI, not the main web server:

```bash
ACS_EMAIL_CONNECTION_STRING=  # ACS resource "Keys" blade connection string
EMAIL_SENDER_ADDRESS=         # verified sender from the ACS Email domain
APP_PUBLIC_URL=https://your-app.example.com/
```

Run it manually with `npm run send-wam-reminders --workspace server` (dev) or
`node dist/sendWamReminders.js` (built). Deploy it as a **systemd timer**
firing every **Tuesday at 10:00 Asia/Jerusalem** using the samples in
`deploy/`:

- `deploy/12-week-dashboard-wam-reminders.service.sample` — a `oneshot`
  service that runs the CLI once.
- `deploy/12-week-dashboard-wam-reminders.timer.sample` — copy both `.sample`
  files (dropping the `.sample` suffix) to `/etc/systemd/system/`, then
  `systemctl daemon-reload && systemctl enable --now
  12-week-dashboard-wam-reminders.timer`.

**Idempotency & failure handling**: each (ISO week, recipient) pair is
recorded in the `wam_email_reminders` table as `sent` or
`failed`. A recipient already marked `sent` for the current ISO week is never
re-sent. A `failed` row is retried on the next invocation. Delivery is
at-least-once: a crash or timeout after provider acceptance but before the
local sent record can result in duplicate mail on retry. Every recipient is
attempted independently — one failure never stops the run — but if **any**
send fails, the process exits with a non-zero status after attempting every
other recipient, so the timer/monitoring surfaces the failure instead of
silently swallowing it.

### Shared email branding and delivery deadlines

Weekly reminders, WAM calendar invitations, scheduled reminders, password
resets, and BROOST emails use the same responsive Hebrew RTL template:
inline CID header image, escaped content and HTTP(S) action URLs, fallback
link, and matching plain text. Calendar invitations retain their ICS
attachment. No external image or font request is needed to render the email.

Each provider send has one 60-second deadline covering both queuing and
confirmation, with cancellation passed to both SDK phases. Timeout raises
`EMAIL_SEND_TIMEOUT`; it never counts as a confirmed send. Its delivery
outcome is unknown, so the existing retry policies may duplicate a message
the provider already accepted. A WAM that sends to two recipients in
sequence can spend up to 120 seconds on email before releasing its completion
lock; retrying skips recipients already recorded as sent.

`EMAIL_SENDER_ADDRESS` must name a sender provisioned on the connected ACS
email domain. The intended production sender is `12wyapp` with display name
`12WY`; changing `.env` alone does not provision a sender or change its
provider-side display name.

## Scheduled one-time email reminders

Any user can schedule a one-time email reminder — to themself, their
current accepted partner, or both — for a specific future Israel wall-clock date and
time, from the "תזכורות" (Reminders) tab (always available, with no active
cycle required).

- **Both recipients**: the creation form's "לשנינו" option schedules two
  separate reminders in one atomic operation, with the same content and time.
  Each recipient has an independent delivery status, edit, and cancellation.
  If the partnership changes while composing, the user must explicitly
  reselect a recipient; the form never silently switches to self.
  `POST /api/reminders` accepts either the existing `recipientUserId` (returning
  one reminder) or `recipientUserIds` containing one or two unique allowed IDs
  (returning `{ reminders: [...] }`), never both fields. Batch selection is
  creation-only; existing reminders remain individually editable.
- **Ownership & authorization**: a reminder belongs to its creator
  (`GET /api/reminders` only ever lists reminders *you* created — never one
  merely addressed to you by someone else, and never another creator's). The
  recipient must be either the creator themself or their current accepted
  partner, re-validated fresh on every create/edit — a partnership that has
  since been removed is never honored, even if it was valid when the
  reminder was first created.
- **Israel wall-clock scheduling, validated server-side**: the client sends
  the raw `YYYY-MM-DDTHH:mm` value from a `datetime-local` input (Israel
  local time) — never a pre-converted UTC timestamp. The server is the sole
  authority that converts and validates it (`server/src/lib/israelTime.ts`,
  a deliberate server-side mirror of the client's own
  `src/lib/israelTime.ts`, since the two are separate npm workspaces with no
  shared package), correctly handling Israel's DST transitions and rejecting
  a wall-clock time that doesn't exist (e.g. the ~1 hour spring-forward gap)
  regardless of the server process's own timezone. The schedule must also be
  strictly in the future.
- **Editing**: only a still-`pending` or `failed` (not yet sent) reminder can
  be edited (`PATCH /api/reminders/:id`) — title, body, schedule, and/or
  recipient. A successful edit always resets it to a fresh `pending` state
  (clearing any prior failure/attempt history), which doubles as an explicit
  manual retry for a reminder that previously failed. Both this and
  cancellation apply their write via an atomic compare-and-swap
  (`WHERE status IN ('pending','failed')`) — if the delivery worker claims
  or sends the exact same row in the narrow window between reading it and
  writing to it, the request gets a clear `409 Conflict` instead of
  silently overwriting worker-owned state.
- **Cancellation** (`POST /api/reminders/:id/cancel`) is only available for a
  still-`pending` or `failed` reminder (same compare-and-swap guarantee as
  editing), and is terminal — there is no "reopen"; creating a new reminder
  is the way back.
- **Anti-abuse cap**: a creator may have at most 100 "active" reminders
  (pending, currently claimed for sending, or failed-but-retryable) at once;
  creating another beyond that returns `429`. Sending to both counts as two;
  recipient authorization, capacity checks, and both inserts share one
  transaction, so a rejected or failed batch creates neither reminder.
  This is a private two-user
  app, but a partner's email address is still a real recipient, so this
  guardrail stays in place regardless.
- **Delivery worker** (`server/src/lib/scheduledReminders.ts`,
  `npm run send-scheduled-reminders --workspace server` /
  `node dist/sendScheduledReminders.js`): claims and sends every currently
  due reminder. Claiming is a single atomic SQL `UPDATE ... WHERE status IN
  (...) AND ...` per row, so two overlapping worker invocations (e.g. a slow
  previous run still in flight when the next timer tick fires) can never
  both send the same reminder — the loser's UPDATE simply matches zero rows.
  The recipient is re-validated (still self or the current accepted
  partner) again at delivery time, not just at create/edit time — if it's
  no longer authorized, the reminder is auto-cancelled without ever calling
  the email provider. Every claimed reminder's whole processing (recipient
  re-check, user lookups, building the email, sending it) is wrapped so one
  row's failure — a bug, a transient DB error, a lookup miss — can never
  abort the rest of the run; every other due reminder is still attempted
  independently. A reminder is never marked `sent` unless the branded email
  actually sent without error. On failure, a bounded exponential backoff
  (5/15/45/135/405 minutes) schedules the next automatic retry, up to a
  maximum of 5 attempts; beyond that it's a terminal `failed` state (no
  further automatic retries — only an explicit edit/resave via the API
  requeues it). A worker that crashes mid-send leaves the row's
  `claimed_at` lease behind, but the next run checks that lease against a
  10-minute stale threshold — a crash can never leave a reminder stuck in
  `sending` forever, since the next run reclaims it once the lease goes stale.
- **Email content**: a branded, RTL HTML email (reusing the same header
  image and app-URL CTA button as the weekly WAM reminder) with the
  reminder's title/body and its Israel-local scheduled time, and — when the
  recipient differs from the creator — identifies who scheduled it (their
  display name, falling back to their email if no display name is set).
- **Honest delivery semantics — at-least-once, not exactly-once**: overlapping
  worker invocations can never both send the same reminder (the atomic
  per-row claim), but if the process crashes after the email provider has
  already accepted/sent a message and before that "sent" status is
  persisted, the row is left claimed and — once its lease goes stale — a
  future run may resend the same email. This is an accepted, documented
  limitation.
- Deploy the worker as a **systemd timer firing every minute** using the
  samples in `deploy/`: `12-week-dashboard-scheduled-reminders.service.sample`
  (`oneshot`, `TimeoutStartSec=300` — comfortably below the 10-minute
  stale-claim lease, so a hung run is killed well before another invocation
  could start reclaiming its in-flight rows) and
  `12-week-dashboard-scheduled-reminders.timer.sample`
  (`OnCalendar=*-*-* *:*:00`) — copy both (dropping the `.sample` suffix) to
  `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl
  enable --now 12-week-dashboard-scheduled-reminders.timer`. It reuses the
  same `ACS_EMAIL_CONNECTION_STRING` / `EMAIL_SENDER_ADDRESS` /
  `APP_PUBLIC_URL` env vars as the weekly WAM reminder — no new secrets.
  **`ReadWritePaths` in the service file must match your actual deployed
  `DATA_DIR`**, and must point at the containing *directory*, not just the
  `.sqlite` file — WAL mode also writes sidecar `-wal`/`-shm` files
  alongside it that this service needs to create/modify too.

## BROOST (partner encouragement)

BROOST ("Bro" + "Boost") is a short supportive/playful message one partner
sends the other — a pick-me-up, not a task. Reachable from the "BROOST" tab
(always available, with no active cycle required, mirroring the WAM tab's
"connect a partner first" onboarding fallback when unpaired).

- **Reply from the notification bell**: write a custom reply inline
  (up to 500 characters), without leaving the current page. The existing
  mark-read action remains available. A reply targets the **original sender**
  of that received notification, only while they are still the current
  accepted partner; it never gets redirected to a replacement partner.
- **Sending** (`POST /api/broosts`) always targets the sender's *current*
  accepted partner — no arbitrary recipient can be supplied. Exactly one
  of a preset key or a non-empty (post-trim, ≤500 char) custom message is
  required, never both, never neither. The 6-8 built-in presets
  (`server/src/lib/broosts.ts`, exposed to the client via
  `GET /api/broosts/presets` — never hardcoded a second time client-side)
  are supportive/playful, never insulting. Every BROOST's `message` column
  is a fully **rendered, immutable snapshot** taken at send time — editing a
  preset's copy later never rewrites history.
- **Anti-spam**: at most 5 BROOSTs from one sender to one recipient in a
  rolling 24-hour window, plus a 60-second cooldown between consecutive
  sends — both checked (and the row inserted) inside one `db.transaction()`,
  so overlapping requests can never both slip past the same limit. Exceeding
  either returns a clear `429` Hebrew error.
- **Delivery**: the `POST /api/broosts` response returns `201` with
  `emailStatus: 'pending'` the instant the in-app row is committed — the
  actual send attempt is scheduled via `setImmediate` to run strictly
  *after* the response has already gone out (`scheduleImmediateBroostSend`
  in `server/src/lib/broosts.ts`), so a provider round trip never
  contributes to request/response latency (mirrors the same non-blocking
  pattern used by `POST /api/auth/forgot-password`). A failed send never
  rolls back or hides the already-created, already-visible BROOST (its
  `emailStatus` simply settles to `failed` shortly afterward, with only a
  `hasError` boolean and a derived `emailWillRetry` boolean ever exposed —
  never the raw provider error or the internal retry timestamp). A periodic
  delivery worker
  (`server/src/lib/broosts.ts`'s `runDueBroostEmails`,
  `npm run send-broost-emails --workspace server` /
  `node dist/sendBroostEmails.js`) is a safety-net catch-all for anything
  not already resolved (a backoff retry, or a process that was down at
  creation time) — it shares the *exact same* atomic per-row claim function
  as the immediate send path, which is what makes it impossible for the two
  to ever double-send the same BROOST. Same bounded-backoff/max-attempts/
  stale-lease-recovery semantics as scheduled reminders (see above), and the
  same honest **at-least-once, not exactly-once** limitation.
  Deliberately re-checks only that both participants still exist as users at
  delivery time — **not** that they're still a current accepted partnership
  (unlike scheduled reminders): a BROOST's validity is anchored at creation
  time, since the supportive message was genuine when sent.
- **History & privacy**: `GET /api/broosts/history` returns the caller's own
  combined sent+received history (paginated, capped), including BROOSTs
  from a partnership that has since been removed — history belongs to its
  two original participants forever, independent of whether they're still
  paired (though no *new* sends are possible once unpaired). A stranger has
  no route to any other pair's BROOSTs at all. Every response uses a
  profile-safe participant shape (`id`, `displayName`-falling-back-to-email
  as a single `label`, `hasAvatar`/`avatarVersion`) — never a raw email
  field, never bio. The authenticated avatar image endpoint is self-only by
  design (see Profile section below), so the client deliberately renders a
  BROOST participant's identity as initials only, never attempting to fetch
  an avatar image for a non-self user (which would either silently serve
  back the *viewer's own* avatar bytes mislabeled as the partner's, or
  require a new cross-user image route this feature doesn't need).
- **Read state**: only the recipient can mark a BROOST read
  (`POST /api/broosts/:id/read`) or mark all of their own unread ones read
  at once (`POST /api/broosts/read-all`) — the sender gets a `403` if they
  try (they can see the row in their own "sent" history, just can't act on
  it on the recipient's behalf); a total stranger gets the same `404` as a
  nonexistent id, never leaking existence either way.
- **Client**: a TopBar badge + compact popover (`useBroostUnread`) shows the
  unread count and a short recent preview, refreshing on mount, on the
  browser window regaining focus, via modest polling (never faster than
  60s), and whenever any *other* mounted BROOST hook instance publishes a
  change over a tiny in-memory pub/sub (`client/src/lib/broostBus.ts`,
  mirroring `saveStatusBus.ts`) — e.g. marking a BROOST read from the bell's
  popover immediately refreshes the BROOST page's own history if it's
  mounted, and vice versa, with each hook ignoring its own publish to avoid
  a redundant double-fetch. No websockets/SSE, no real-time push
  infrastructure; this app doesn't need it. The BROOST tab itself (composer
  + full paginated history) refreshes the same way on its own mount/focus/
  bus-event — a refresh always re-fetches and merges only the "top window"
  covering everything already loaded, so it never snaps an already-
  scrolled-down view back to page 1, and `loadMore` always appends
  (de-duplicated) rather than replacing the current page. A monotonic
  per-hook request-sequence guard discards any response that resolves
  after a newer request has already started, so an out-of-order network
  response can never overwrite fresher state. A short micro-animation
  ("💪 נשלח בהצלחה!") confirms a successful send (skipped under
  `prefers-reduced-motion: reduce`). Every read action (mark-one, mark-all)
  is wrapped in a visible saving/saved/error indicator — no bare rejected
  promise is ever left silent.
- Deploy the worker as a **systemd timer firing every minute**, same pattern
  as scheduled reminders: `deploy/12-week-dashboard-broost-emails.service.sample`
  (`oneshot`, `TimeoutStartSec=300`) and
  `deploy/12-week-dashboard-broost-emails.timer.sample`
  (`OnCalendar=*-*-* *:*:00`) — copy both (dropping `.sample`) to
  `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl
  enable --now 12-week-dashboard-broost-emails.timer`. No new env vars —
  reuses the same `ACS_EMAIL_CONNECTION_STRING` / `EMAIL_SENDER_ADDRESS` /
  `APP_PUBLIC_URL` as every other automated email in this app.
- Included in the immutable WAM completion backup snapshots (migration 014;
  `partner_broosts` in the snapshot allowlist — the rendered message is
  genuine user app data and is included in full; only the raw email
  delivery error text is redacted to a boolean, exactly like every other
  delivery-status table in that allowlist).

## Backups

The SQLite database lives at `server/data/app.sqlite` (path configurable via
`DATA_DIR`/`DB_FILE` in `.env`) and runs in WAL mode, so it's safe to back up
while the server is running:


```bash
# Linux/root only, from an independently trusted, root-controlled release:
bash scripts/backup.sh /path/to/data /path/to/backups /path/to/evidence
# Database-only development copy (does NOT include evidence files):
sqlite3 server/data/app.sqlite ".backup 'backups/app-manual.sqlite'"
```

**Important: tactic-evidence file bytes live entirely outside SQLite** (see
"Tactic evidence" above) — a database-only backup (the `sqlite3 .backup`
command shown above on its own) captures every evidence *row* (note, link,
original filename, MIME, size) but **not the file itself**.
`scripts/backup.sh` accounts for this with an explicit consistency
guarantee: its isolated standard-library Python producer queries the **just-created**
database backup (not the live, still-mutable database) for exactly which
stored filenames it references, copies exactly those files, retries briefly
on one that's momentarily missing, and — if any referenced file is still
missing after that — **exits non-zero with a clear error** rather than
silently reporting a complete backup with dangling file metadata. Evidence is
published first and the database last; failures do not produce a successful
complete-snapshot receipt. There is no raw-copy or database-only fallback.
The producer requires Linux/root, fixed OS Python/SQLite with a working
positive heap limit, and a nonroot-owned source database. It confines live
SQLite inside the data directory and permanently drops privileges before
opening it. Evidence copies reject unsafe names, links and unstable files.
The `npm run backup` alias has these same requirements; it is not a portable
macOS/nonroot backup command. If you build your own procedure, it must copy
`EVIDENCE_DIR` too (ideally with the same reference-verified approach), or
every uploaded evidence file will be silently lost on restore even though
its metadata row looks intact.

### Scheduled local and optional off-VM backups

`scripts/backup-with-monitoring.sh` wraps the accepted evidence-aware backup
with four explicit absolute directories: source data, backup destination,
evidence, and protected monitoring state. Its service/timer samples run
daily at 03:20 Asia/Jerusalem. Check existing schedules before enabling
another timer; one backup schedule should own this work.

Local backups alone do not protect against loss of the VM or disk. The
optional Azure Blob pipeline packages the completed SQLite-and-evidence
snapshot, streams compressed blocks, and confirms the committed remote
object before publishing a separate cloud-success receipt. In cloud mode,
failed upload advances neither local nor cloud success timestamps.
Transfer confirmation is not a restore drill: restore the archive in a
separate location and check both database and referenced evidence before
relying on it.

Configuration and deployment steps are in
`deploy/cloud-backup.integration.txt`, with dedicated backup-only environment
and systemd drop-in samples. The intended destination is a private
Standard_LRS Hot container accessed by the VM's managed identity with
container-scoped permissions, not a stored account key. Account creation,
retention, access controls, and identity assignment are operator steps;
code installation alone does not provision them.

Snapshot reference validation uses a bounded `/usr/bin/python3 -I -S` helper
with standard-library SQLite, not the web application's native Node binding.
It requires Python 3.8+ and SQLite 3.31+ with a positive `hard_heap_limit`
no greater than 64 MiB; an unsupported zero limit fails before database parsing.
The existing server build includes this helper in `server/dist/assets`.

Root-run backup code and its complete dependency chain must come from an
independently trusted, protected release. Do not run app-writable modules as
root, including copies authenticated only by hashes generated from those
same live files. The standalone release instead packages the required Zod
runtime from a pinned, authenticated build artifact and never imports the
live application's dependencies.

The default compressed limit is 128 MiB, configurable up to a hard 256 MiB,
with a 1 GiB source limit and a ten-minute deadline. Oversized snapshots fail
explicitly rather than omit evidence. Monitor growth and review these
limits before data approaches them. Configure a 30-day remote lifecycle;
soft-deleted data and uncommitted blocks can add retained bytes. Complete
and failed local snapshot directories are not automatically removed by
this integration, so local retention also needs an operator policy.

Full SQLite file backups contain authentication records as well as app
data; they are not the redacted in-database WAM snapshots described below.
Never expose the backup container, files, or restore artifacts publicly.
Keep backup-only configuration out of the HTTP application's environment.

### In-database WAM completion snapshots (defense in depth, not a replacement)

Every time a Weekly Accountability Meeting (WAM) transitions from draft to
**complete** (after any required next-meeting calendar invite deliveries
have already succeeded), the server writes one immutable row to a `backup`
table in the *same* SQLite database, in the *same* transaction as marking
the WAM complete and freezing both partners' score snapshots — so either
all three land together or none do (see `server/src/lib/wamCompletionBackup.ts`
and the `POST /api/wams/:id/complete` handler in `server/src/routes/wams.ts`).
Each row holds a deterministic, versioned, table-structured JSON snapshot of
**all users'** safe application data at that exact moment — every cycle,
goal, tactic, completion, WAM/review/commitment/punishment, weekly planning
ritual, scheduled/calendar email delivery record, and tactic-evidence
*metadata* (note/link/original filename/MIME/size — never the file bytes
themselves, see "Tactic evidence" above), across both partners, through
migration 017 (see the module doc comment in `wamCompletionBackup.ts` for
the exact, explicitly-audited table/column allowlist).

**This intentionally complements, not replaces, the external `.sqlite` file
backups above.** These snapshots live *inside* the very same database file
they're meant to protect against application-level mistakes (e.g. a bug that
corrupts derived data) — if the DB file itself is lost, corrupted, or its
disk fails, every in-database snapshot is lost right along with it. Losing
the file is exactly the scenario the external, separately-stored `npm run
backup` / `.backup` copies above exist to protect against; keep making
those. The two mechanisms protect against different failure modes and both
matter.

Security-sensitive exclusions (never present in a snapshot): `sessions`,
`password_reset_tokens`, the `backup` table itself (no recursive backups),
`schema_migrations`/SQLite-internal tables, `users.password_hash`,
`users.avatar_data` (raw bytes — only `avatarMime`/`avatarVersion`/a computed
`hasAvatar` boolean are kept), the raw `error`/`last_error` text on any
email/calendar delivery row (reduced to a computed `hasError` boolean,
keeping `status` and timestamps), and `tactic_evidence.file_stored_name`
(the random on-disk filename — an operational detail, not user content;
reduced to a computed `hasFile` boolean, and the file's bytes were never in
SQLite to begin with). There is no read, update, or delete API
for the `backup` table at all — the only way rows are ever created is the
one code path described above, and at most one row can ever exist per WAM
(enforced by a UNIQUE index): **reopening and re-completing the same WAM
never creates a second backup — the very first completion's row is
preserved forever, immutable, regardless of how many times the WAM is later
reopened and completed again.** This is deliberate, not a limitation: the
one-per-WAM guarantee is exactly what was asked for, so later completions
of the same WAM simply become no-ops against the backup table specifically
(everything else — status, frozen scores, calendar scheduling — still
updates normally on every completion).

`triggering_wam_id`/`triggering_wam_week`/`wam_completed_at` are a plain
integer plus two frozen scalar values — **deliberately not a foreign key**.
A backup is meant to durably outlive the very data it snapshots: if the
triggering WAM's partnership is later removed (cascading the WAM row away),
or some future migration ever has to rebuild the `wams` table (SQLite's
`ALTER TABLE` limitations already required exactly that once, for `wams`
itself, in migration 003), the backup row — including which week it was and
exactly when it completed — survives untouched, rather than being deleted
or having its linkage silently erased.

An `auditSnapshotSchema()` check runs on every single snapshot build (i.e.
on every WAM completion) and fails loudly, refusing to produce a backup at
all, if the live database schema has drifted from the allowlist in
`wamCompletionBackup.ts` without conscious review: a brand-new table that's
neither allowlisted nor in the intentional-exclusions list, or a new column
on an already-allowlisted table (e.g. a hypothetical future `users.phone`)
that's neither selected nor explicitly excluded. A test suite "golden" test
additionally pins the exact current table/column shape and
`BACKUP_SNAPSHOT_SCHEMA_VERSION`, so any deliberate future change to what's
captured requires touching that test (and consciously deciding whether the
version should bump) rather than silently drifting.

**Growth and retention are a deliberate, explicit tradeoff, not yet solved:**
every snapshot captures *all* users' full application data, so the `backup`
table's total size grows roughly in proportion to (number of completed WAMs
across every partnership) × (total application data size at each one) —
there is intentionally **no retention/pruning policy** in V1, because the
spec called for exactly one immutable row per WAM, forever. Over a long
enough time horizon this is a real disk-growth concern for the same SQLite
file everything else lives in; it isn't addressed here, and is expected to
surface first as ordinary disk-usage monitoring on the deployed host, at
which point a deliberate retention/archival policy would need to be
designed (e.g. compacting old snapshots, or moving them out of the live
`app.sqlite` entirely) — not silently deleting history that was explicitly
asked to be permanent.

## Multi-cycle history

A user can run any number of 12-week cycles over time. "Finishing" a cycle
(the cycle header's "סיום מחזור והתחלת מחזור חדש" button) **archives it — it
is never deleted**: its goals, tactics, and completions become permanent,
immutable, read-only history, browsable any time from the "מחזורים קודמים"
(previous cycles) tab (for both the owner and their read-only partner), while
a brand-new active cycle starts fresh at week 1. The backend rejects any
attempted edit to a goal/tactic/completion once its cycle is archived.

Weekly Accountability Meetings are pinned to the specific cycle each partner
had active when the meeting was created. If either partner later finishes
their cycle, that meeting becomes permanently locked history too (all fields,
ratings, and commitments become read-only) — and starting the same week
number again under the new cycle creates a brand-new, independent meeting
rather than colliding with the old one.

## Tactic evidence

Photos/files now belong to one **whole-cycle/week album**, not to a tactic
or daily checkbox. To add one or several photos, open **השבוע**, choose the
week, and use its single album's **הוספת תמונות או קבצים** control; no
completed checkbox is needed. A single “תמונות וצרופות · שבוע N” panel appears under
the selected week's only execution grid, and under Home's intentional
current-week quick list. There are no row-level attachment actions and no
duplicate execution table on the Week tab. Owners may select multiple files
(PNG, JPEG, WebP, PDF, DOCX, TXT; existing 8MB **per-file** limit), add notes
or validated HTTP(S) links, edit captions, and remove individual items.
There is no tactic/completion prerequisite or arbitrary album item limit.
Files upload independently: a failed file never discards successful siblings.
Images have an explicit “הצגת תמונה” action; no bytes load before a preview
or download request. Cycle history groups all albums by week, read-only.

- **Lossless migration 019**: deployed migration `018` is unchanged. New
  rows in the same `tactic_evidence` table use `cycle_id`, a NULL `tactic_id`,
  and storage `weekday = -1`. Multiple independent rows are allowed per
  cycle/week. Every existing daily and tactic-week row retains its id,
  note, link, timestamps and file reference; only the new nullable column
  is added. The table copy/swap is transactional, retaining the sequence
  high-water mark and all historical migration records. No files are moved,
  deleted or merged. The album also lists **every** legacy item for the
  selected cycle/week, with its original tactic/day context. New uploads
  cannot overwrite a legacy slot. Deleting a tactic keeps independent
  cycle/week album items; legacy tactic cascade behavior stays unchanged.
- **Export/backups**: owner JSON export adds `cycles[].weekEvidence[]`
  containing whole-week and legacy metadata/ids, with no stored filenames
  or bytes. Existing nested tactic `evidence[]` remains compatible. Snapshot
  schema version 6 adds `cycleId` to evidence rows; existing frozen snapshots
  are not rewritten. Raw database/file backups still enumerate the same
  table/file columns, so new album files remain included in backup and
  orphan-detection coverage. Completion rows/scoring are untouched.
- **Album API**: `GET /api/week-evidence/:cycleId/:week` returns
  `{access, items}`; `GET /api/week-evidence/:cycleId` reads all weeks.
  `POST /:cycleId/:week` creates a note/link item; raw `POST
  /:cycleId/:week/files` creates one file item using `X-Evidence-Filename`.
  Each item has `id`, `cycleId`, `week`, nullable `tacticId`/`weekday`,
  `scope` (`week`, `tactic-week`, `tactic-day`), original context, and safe
  metadata. `PUT /:cycleId/:week/:id` edits note/link, `DELETE` removes the
  item, and `GET/DELETE /:cycleId/:week/:id/file` downloads/detaches its file.
  Every item lookup includes cycle/week/id. Upload commits and downloads
  recheck session/admission/relationship after disk I/O; rejected uploads
  finish file rollback before denial. Deleting one item never clears the
  album or other files.
- **Authorization**: owners can create/edit/remove album items without any
  completion prerequisite. The old tactic APIs below retain their creation
  rules for backwards compatibility. Evidence works identically for an
  active or an archived cycle (unlike tactic/goal edits, which lock once a
  cycle is archived — evidence is explicitly exempt from that lock, since
  it's after-the-fact documentation, not a change to the plan itself). The
  accepted partner can always read (metadata and file download) but never
  write; a stranger is denied entirely.
- **File storage & permissions**: file bytes are stored **on disk**, never
  in SQLite — under `EVIDENCE_DIR` (defaults to `<DATA_DIR>/evidence`; see
  `.env.example`). `ensureEvidenceDir()` (called once at server startup, and
  again defensively before every write) creates/tightens the directory to
  owner-only `0700` and every written file to owner-only `0600` on POSIX —
  failing loudly (crashing startup) rather than silently continuing if it
  can't be made usable at all. `config.evidenceDir` itself is a
  side-effect-free getter (never creates the directory), so tests can freely
  redirect it per-test via `EVIDENCE_DIR`. Every stored filename is a fresh
  cryptographically random 192-bit hex string plus a fixed extension derived
  from the *sniffed* format (never the client's original filename or
  declared Content-Type) — the declared original filename is normalized at
  ingest (reduced to its final path segment, control characters stripped,
  bounded to 255 Unicode code points without ever splitting a surrogate
  pair/emoji in half) and kept only as display metadata for downloads, never
  trusted as a filesystem path. `server/src/lib/tacticEvidence.ts` sniffs
  the real format from content alone (PNG/JPEG/WebP/PDF magic bytes; DOCX
  requires at minimum a ZIP signature *and* a `.docx` name; TXT requires
  strict UTF-8/no NUL/no other raw control characters *and* a `.txt` name)
  and rejects a mismatch between the declared Content-Type and the sniffed
  content — this is what actually blocks SVG, HTML, renamed executables, and
  MIME-spoofed uploads, not just a Content-Type allowlist.
- **Legacy tactic upload concurrency**: since the file write is asynchronous (it
  yields the event loop) but must happen before the DB write that follows
  it, `upsertEvidenceFileRecord` re-checks the selected scope's current state
  fresh, atomically, inside one synchronous transaction immediately before
  writing the DB row — if it's still a brand-new weekly record and the last
  completed occurrence was unchecked during that window, the upsert is aborted and the
  just-written file is deleted, never creating an invalid record. The
  "previous file to clean up" is always read fresh at that same moment, so
  an overlapping replacement from a different concurrent request is
  correctly cleaned up rather than orphaned; a final post-commit check
  self-deletes this request's own file if a still-later request has since
  won the race for the same occurrence. A file that's written to disk but
  then fails to commit to the DB at all is likewise deleted again (rolled
  back). Session/owner authorization is rechecked after the async write.
- **Legacy API (retained)**: `GET/PUT/DELETE /api/tactic-evidence/weekly/:tacticId/:week`
  (JSON note/link metadata; GET returns `evidence`, every `legacyEvidence`
  entry, `access` and `canCreate`) plus `PUT/DELETE/GET
  /api/tactic-evidence/weekly/:tacticId/:week/file` (raw binary
  upload/replace/delete/download — the original filename travels via an
  `X-Evidence-Filename` header, since a raw binary body has no other place
  for it without a multipart/base64 dependency) and `GET
  /api/tactic-evidence/cycle/:cycleId` (the flat gallery list for one whole
  cycle). The old `/:tacticId/:week/:weekday` and `/file` endpoints remain
  available for legacy records and reject `-1` as a day. Downloads are
  authenticated/authorized on every single request, rechecked after file I/O
  for revoked sessions/partnerships or replaced/deleted files (no
  signed/anonymous URLs), set `Content-Type` to the *stored, sniffed* MIME,
  `Content-Disposition: inline` for images/PDF or `attachment` for DOCX/TXT,
  `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and
  (on `inline` responses only) `Content-Security-Policy: sandbox` — defense
  in depth so a directly-opened image/PDF response can never execute
  scripts or navigate, independent of `nosniff`. `Content-Disposition`'s
  filename is built via RFC 6266-safe encoding: an ASCII-only quoted-string
  fallback (every non-printable-ASCII character replaced, since Node's HTTP
  layer rejects a raw Hebrew/emoji byte in a header value outright) plus a
  code-point-bounded, percent-encoded `filename*=UTF-8''...` value for
  modern clients — Hebrew, emoji, quotes, CR/LF, and path separators in an
  original filename can never crash the response or inject into headers.
  Deleting just the file (keeping a note/link) is supported; if that would
  leave the record completely empty, the whole row is deleted instead,
  matching the DB's own non-empty-record `CHECK` constraint.
- **Client**: never auto-loads a file's bytes — a download only ever
  fetches when the user explicitly clicks the download button
  (fetch-then-blob, same pattern as `ExportDataButton`).
- **Offline maintenance (orphan files)**: there is no user/cycle-deletion
  route in this app today (only cycle *archiving*, which never deletes
  anything) — if the app ever gains a route that deletes a user/cycle
  outright, it must collect and clean up evidence files for every affected
  tactic first, exactly like the existing goal/tactic `DELETE` routes
  already do, since SQL's own `ON DELETE CASCADE` down to `tactic_evidence`
  has no way to also remove files from disk. `npm run evidence-maintenance
  --workspace server` (optionally with `--delete`) reports — and, only with
  that flag, removes — on-disk evidence files no longer referenced by any
  `tactic_evidence` row; it only ever considers a generated-name (48 hex
  characters + a known extension) *regular file* a candidate (never a
  symlink or an unrecognized filename), and is never invoked automatically
  (not at startup, not from any request path). **Run it with the app server
  stopped** for deterministic results — a live server can legitimately have
  a brand-new file on disk whose DB row hasn't committed yet at the exact
  instant of a scan.

## Direct partner pairing (V1)

There is no invitation/acceptance flow. An authenticated, operator-approved user can list
**other approved accounts** (email + id, via `GET /api/partnerships/candidates`)
and immediately select one as their accountability partner (`POST
/api/partnerships/pair { targetUserId }`) — the partnership is mutual and active the
instant it's created, with no separate "pending" state.

- **This is a trusted-membership trade-off**: approved members can discover
  other approved members' email addresses. There is no invitation-based consent
  barrier; production signup is closed and unapproved accounts cannot enter the app.
- **One partner max, enforced transactionally**: pairing is rejected (`409`) if either
  the chooser or the chosen user already has a partner, or if you try to pick
  yourself (`400`). The check-then-insert runs inside a single `db.transaction()`;
  since better-sqlite3 is fully synchronous and Node serializes handling of this
  (non-`async`-blocking) request, there's no window for a race to create two
  partnerships for the same user.
- **Immediate mutual read access**: as soon as pairing succeeds, both users can read
  (never write) each other's dashboard.
- **Removing the pairing** (`DELETE /api/partnerships/:id`, either side, with a
  confirm step in the UI) revokes access immediately.
- The partner panel's UI is a single searchable list (type to filter by email, click
  to pair) — there is no separate "email input" vs. "user list" mode.

### V2 backlog (not implemented)

- **Real transactional invitation email** with accept/decline and a pending state,
  sent via a provider such as Azure Communication Services Email — deliberately out
  of scope for V1 in favor of the simpler direct-pairing model above. If revisited,
  this would replace direct pairing's discoverability trade-off with an
  invitation-based flow that doesn't expose the full user directory.

## Weekly Accountability Meetings (WAMs)

The "פגישה משותפת" (WAM) destination is always discoverable. Once paired, it shows a
weekly (1–12) meeting per partnership per cycle generation:

- Both partners can jointly edit shared fields (wins, misses, blockers,
  lessons learned, notes, "should we adjust goals?") while the meeting is a
  draft, and maintain a shared commitments checklist (labeled per-partner or
  shared) at any time.
- Each partner has their own 1–10 self-rating, editable only by themselves,
  with both ratings always visible to both.
- Marking a meeting **complete** freezes both partners' weekly execution score
  snapshots (further completions edits elsewhere no longer change the frozen
  numbers) and locks shared-content editing until an explicit **reopen**.
- Completing a non-historical draft meeting offers an optional "next WAM"
  date/time, entered and displayed as Israel local time regardless of the
  browser's own timezone (default 60 minutes, validated to be in the future).
  If one is chosen, both partners are emailed a real RFC 5545 calendar
  invitation (`METHOD:REQUEST`, base64 ICS attachment, week-agnostic subject)
  via the existing Azure Communication Services sender; sending is
  idempotent/retryable per WAM/recipient/schedule generation, and the meeting
  only becomes complete once every invitation for the current schedule
  succeeds — a partial failure keeps it a draft with the failure recorded,
  and a later retry only re-sends to the recipient(s) that failed. The
  schedule and per-partner delivery status are shown on the completed
  meeting and preserved across reopen. Once a schedule has ever been sent,
  it can be changed but never cleared back to "no schedule" (there is no
  invitation-cancellation feature, so this would otherwise leave a stale
  invite in both partners' calendars) — this is enforced server-side
  regardless of the client.
- If the two partners' cycles are on different current weeks, the meeting
  shows a clear mismatch warning — weeks are never auto-synced or mutated.
- A compact "edit my goals/tactics" panel is embedded in the meeting, always
  scoped to the logged-in user's own data (reusing the same owner-only API —
  a partner can never edit the other's goals from here either).
- The tab also offers a weekly list, the latest meeting's summary, a simple
  substring search across notes/commitments, and a print/export view.

### Duo Streak + post-completion celebration (no migration — fully derived)

A "Duo Streak" card (shared avatars, current/best streak, total duo wins) is
shown in both the WAM list and detail views, and a celebratory modal appears
immediately after a **successful** `POST /:id/complete` call (never merely
from opening or reloading an already-complete WAM).

- **Fully derived, no new table.** `computeDuoStreak` (`server/src/lib/
  duoStreak.ts`) reads only the existing `wams.status` and
  `wam_reviews.score_snapshot` columns — a "successful Duo week" is a
  currently-**complete** WAM whose two frozen score snapshots are both
  non-null and >= 85. The sequence considered is every WAM in `status =
  'complete'` for the partnership, ordered by **WAM id** (never week number),
  so it is inherently stable across skipped weeks and cycle resets. Draft
  WAMs (including a reopened one) are excluded from the sequence entirely
  rather than treated as failures — reopening a WAM temporarily drops it out
  until it is completed again with a fresh snapshot. See that module's doc
  comment for the full semantics (current/best/total/latest-success).
- `duoStreak` is included in both the WAM list envelope (`null` when there is
  no accepted partnership) and every WAM detail response, with both
  participants' profile-safe fields (`displayName`/`email`/`hasAvatar`/
  `avatarVersion` — never bio or avatar bytes).
- The **celebration** descriptor (`duo-success` / `spotlight` / `tie` /
  `completion`) is computed once, from the exact frozen scores just written,
  and attached **only** to that one successful completion response (`{ wam,
  celebration }`) — never to `GET`/list responses — so the client can tell
  "just completed via this mutation" apart from "merely (re)loaded an
  already-complete WAM" with no extra bookkeeping. `duo-success` requires
  both >= 85 regardless of which is numerically higher (an exact tie that
  both clear 85 is still `duo-success`, never `tie`); `tie` is reserved for
  an exact equal score *below* 85. Reopening and successfully re-completing a
  WAM produces a brand-new celebration each time.
- The avatar route (`GET /api/profile/avatar?u=<userId>`) now allows fetching
  either your own avatar or your **currently accepted partner's** — a
  stranger (or a former, unpaired ex-partner) gets the exact same
  indistinguishable 404 as "no avatar set", never a distinguishable
  "forbidden" response. Avatars use `private, no-store` and `Vary: Cookie`;
  a browser cache cannot bypass authorization after an account/partner change.
- The celebration overlay is a focus-safe accessible modal
  (`role="dialog"`/`aria-modal`/`aria-label`, message body
  `role="status"`/`aria-live="polite"`), dismissible via the visible close
  button, `Escape`, or a backdrop click — the backdrop is deliberately
  disarmed for ~400ms after mount so the very click that triggered
  completion can never instantly close it. Focus moves to the close button
  on open, stays inside the modal, and is restored on close (or to the
  meeting's Back control if completion removed the original trigger).
  Animation is CSS-only (no new dependency), every element finishes
  animating well under 4 seconds with no infinite loops, particle count is
  small and bounded (and further reduced on narrow screens), and
  `prefers-reduced-motion: reduce` disables all non-essential animation
  while restoring every element's final resting state directly (content is
  never stuck invisible).
- Client state: `WamsTab` owns one ephemeral `celebration` value, shown once
  per successful `complete()` call and cleared on close, on returning to the
  list, or when switching to a different WAM. A ref-based stale-response
  guard ensures a completion response that resolves only after the user has
  already navigated away from that specific WAM can never pop up a
  celebration for the wrong meeting, including leaving and reopening the same ID.
  Completion/reopen controls disable while saving; completion also takes a
  per-WAM lock in the single-process server while sending invitations.
  Cycle/partnership state is rechecked after delivery before scores are frozen.
- **No backup/export changes needed.** Both the streak and the celebration
  are computed on the fly from data (`wams`, `wam_reviews`, `users` profile
  fields) that is already covered by the existing WAM completion backup
  allowlist and the authenticated JSON export — there is no new persistent
  state to allowlist, and the backup schema version is unchanged.

### Punishments (migration 016)

Either partner can write a lighthearted "punishment" for themself or the
other partner directly inside a draft, non-historical WAM (`wam_punishments`
table): a short required label, an author (always the logged-in user —
never client-supplied), and an assignee (must be one of the two WAM
participants). The item then becomes due in the **next WAM ever created**
for that same partnership — deliberately by WAM creation order (smallest
later WAM id), never by naive `week + 1`, so it is correct across skipped
weeks and across a week-12-into-a-new-cycle transition, since WAM ids are
monotonic per partnership and there is no WAM-delete API. Binding happens
transactionally either the moment a later WAM is created (sweeping every
still-unbound earlier punishment at once) or immediately at punishment
creation time if a later WAM already exists; an already-bound punishment is
never rebound.

- Only the item's own author may edit its label/assignee or delete it, and
  only while its *source* WAM is still an editable draft and non-historical
  **and** its own *due* WAM (once bound) has not itself become
  complete/historical — once the due-side checklist (and, if it was ever
  completed, its own immutable backup snapshot) is frozen, source-side edits
  must stop too rather than silently diverging from it. The serialized
  `canEdit` flag reflects both conditions so the UI hides the controls
  automatically. This is **reopen-aware, not permanent**: explicitly
  reopening the due WAM (`POST /:id/reopen`) puts it back in `draft` and
  immediately re-allows source edit/reassign/delete again — the exact same
  product-consistent behavior already used for the due WAM's own shared
  content/commitments; only an archived-cycle (historical) due WAM, which
  has no reopen path at all, stays permanently locked.
- Reassigning a punishment to a *different* user atomically clears any
  prior `done`/`completedAt` — that attribution belonged to the previous
  assignee — while a same-assignee update (or a label-only edit) leaves it
  untouched.
- The due WAM shows every bound item as a "Due Punishments" checklist; only
  the assigned/punished user gets an enabled checkbox (never the author
  merely by authorship), and only while the due WAM itself is a
  non-historical draft. Toggling is idempotent: repeatedly marking an
  already-done item done again preserves the *original* `completedAt`
  (never bumps it), while unchecking always clears it and a later check
  records a genuinely new timestamp. A completed item crosses out with a
  playful animation (disabled under `prefers-reduced-motion`, and the
  client's checkbox is an optimistic-with-rollback control synced from the
  server-confirmed value) but stays visible in that due WAM's history
  rather than silently migrating forward.
- Completing the due WAM does **not** require every punishment to be
  checked off first — the checklist is accountability visibility, not a
  release gate — and completing the source WAM preserves every outgoing
  punishment and its due binding untouched.
- Adding a punishment is rejected outright if the already-existing next WAM
  is already complete or historical, since the item could never be checked
  off. Punishment labels are included in the WAM substring search (both the
  authoring WAM and the due WAM are matched, deduplicated) and in the
  authenticated JSON export (including timestamps); the table is included
  in the WAM completion backup allowlist (see below).
- Request bodies are strictly validated (`.strict()` Zod schemas — an
  unknown/extra field like a spoofed `authorUserId` is rejected outright,
  never silently ignored) and an update body must supply at least one of
  `label`/`assignedUserId`. The schema itself backstops
  `due_wam_id IS NULL OR due_wam_id > source_wam_id` (WAM ids are
  AUTOINCREMENT, so a due WAM is always later than its own source) plus two
  triggers: `source_wam_id` is immutable after insert, and an already-bound
  `due_wam_id` can never be directly re-pointed to a *different* non-null
  WAM (only unbound via the existing `ON DELETE SET NULL` foreign key
  action, which the triggers are careful not to block).
- Client mutations for a given WAM detail are strictly FIFO-queued (never
  more than one in flight at a time) so a rapid sequence of edits can never
  have an out-of-order/stale response overwrite a newer one; every row's
  save/reassign/delete/toggle actions share one status indicator and
  disable each other while any one of them is in flight.
- The source-side list also shows a "✔️ בוצע" indicator once the due item
  is completed, and requires an explicit confirmation before reassigning or
  deleting an already-completed item (reassigning resets its completion —
  see above; cancelling leaves the assignment/record untouched).
- `WamDetail.canAddPunishment` (server-derived) is true only when the
  source WAM is an editable, non-historical draft **and** its own next-WAM
  candidate (if one already exists) is not itself frozen — the client uses
  it to hide the composer proactively and show a concise read-only
  explanation, instead of allowing an add attempt that the server would
  always reject with a 400.
- Returning from a WAM's detail view to the summary list reloads the list
  so its per-WAM commitment/punishment counters (which detail-view
  mutations never update in place) are never stale.

## Execution recovery plans

From Wednesday onward (Israel time), the Home dashboard flags an owner's
active-cycle *current* week as "at risk" if either the completion rate of
actions already due this week (Sunday through today) is below 65%, or even
completing every remaining not-yet-due action this week could not reach the
85% target score (a due-but-undone action is treated as a permanent miss for
that best-case calculation — it can't retroactively un-happen). The flag
never fires Sunday-Tuesday, regardless of the numbers. All of this is a pure,
fully-tested calculation (`server/src/lib/executionRisk.ts`) reusing the
exact same per-week tactic-override logic (`isScheduled` in `scoring.ts`) as
every other score in the app — Israel weekday is computed independently of
the server's own timezone (`israelWeekday()` in `lib/israelTime.ts`).

- **Two response strategies**, offered as a choice, never framed as
  destructive: **reduce next week's commitment** to fit reality, or **commit
  to a concrete rescue maneuver** for the current week.
- **Reducing next week is a real, explicit adjustment, not just a note**: the
  client presents every tactic effectively scheduled for next week (target =
  current week + 1) with its current weekday selection, and the owner
  consciously picks the reduced set per tactic (including removing a tactic
  entirely for that one week). The server (`POST
  /api/execution-recovery/:userId/reduce-next-week`) independently validates
  ownership, that every next-week tactic (and only those) is included, that
  the total scheduled-occurrence count strictly decreases, and that at least
  one remains — then, in one transaction, upserts `tactic_week_overrides` for
  *next week only* (never the base tactic, the current week, or any other
  week) and records a plan that is already `resolved` (applying the
  reduction *is* the complete action), with a JSON before/after snapshot.
  Week 12 has no "next week" to reduce — only a maneuver is offered there.
  Rejected outright (no silent overwrite/rebaseline) if a plan already exists
  for the current cycle/week under *any* strategy or status — a stale tab
  that's unaware a plan now exists can never clobber it. Duplicate `tacticId`
  entries in the submission are rejected before any before/after math runs
  (and the count math is computed from a de-duplicated map as a second line
  of defense either way), closing an exploit where a duplicated entry could
  otherwise make a real schedule *increase* look like a valid reduction.
- **A maneuver** requires a concrete, non-empty free-text commitment and
  stays pinned on the Home dashboard, for the owner, until they explicitly
  mark it resolved — never auto-resolved just because the live risk numbers
  later improve. The owner can edit or reopen *a maneuver* at any time; an
  accepted partner sees the same plan read-only (nothing at all is shown for
  an absent/not-yet-created plan). A `reduce_next_week` plan is a completed,
  one-way action, by contrast — it is always recorded already `resolved` and
  can never be reopened (the client never offers the control, and the server
  rejects a reopen attempt for one outright with a clear message), since its
  `tactic_week_overrides` are never undone. Likewise, an existing
  `reduce_next_week` plan can never be converted into, or silently
  overwritten by, a maneuver.
- **History is retained in the database**: one plan per (cycle, current
  week) — a resolved plan (or a completed reduction) remains queryable
  forever via the database itself, and reopening a maneuver never deletes or
  mutates its record. There is no dedicated current-UI history list for past
  execution-recovery plans yet (unlike, say, cycle history) — that data will
  become browsable once the planned global archive/search feature ships;
  until then it's durable but not yet surfaced anywhere beyond the current
  week's own card. An archived cycle is immutable by construction: every
  endpoint only ever operates against the owner's *currently active* cycle,
  so once a cycle is archived there is no code path left that can
  create/edit a plan against it.
- **Exact threshold math**: the 65%/85% comparisons are decided by exact
  integer cross-multiplication against the raw due/scheduled counts, never
  by comparing the *rounded* percentages shown in the UI — e.g. a true 64.6%
  due-completion rate (which *displays* as a rounded 65%) still correctly
  triggers, and a true exact 85.0% maximum-achievable score never does,
  regardless of how any other fraction happens to round.
- Included in the immutable WAM completion backup snapshots (migration 013;
  `execution_recovery_plans` in the snapshot allowlist — nothing on it is
  error-like, so it's included in full, no redaction needed).

## Execution heatmap

The profile and dashboard trend view include an accessible 12-column by
7-row activity grid. `GET /api/execution-heatmap/:userId?cycleId=<id>`
returns only aggregated scheduled/completed occurrences for an own or
currently paired user's cycle, using the same tactic overrides as scoring.
Each day is inspectable by touch or arrow keys; rest, future, pending,
missed, partial and successful days have distinct labels and visual states.

Daily success uses exact integer comparisons at 85%, not a rounded score.
Rest days are neutral, past scheduled failures break the streak, and an
unfinished today has until Israel midnight before breaking it. Future days
never earn streak credit. The summary also shows the best run and strongest
finalized weekday. Archived cycles finalize their recorded current week;
later weeks are marked outside that cycle.

**Date limitation:** cycles store a manually advanced week, not a calendar
start date. Dates are therefore explicitly labeled approximate, anchored
to the current Israel week or the archive's final update week. They are
planning-day labels, not timestamps of when a checkbox was clicked. No new
table or migration is needed.

## Global archive search

The always-available search view queries active/archived cycles, goals,
tactics, WAM text, commitments, punishments and reminders. Results include
bounded plain-text excerpts, exact per-category counts, ownership/archive
context and navigation to the exact cycle, meeting or reminder ID.
Current-partner cycle history is visible; reminders are strictly
creator-owned. Existing authorization is checked again when opening a result.

`GET /api/archive-search?q=<literal>&limit=5` accepts 1-120 characters and
a per-category limit of 1-20. `%`, `_` and backslashes are literal text, not
wildcards. Queries are parameterized, response caches are disabled, and
changing the query invalidates stale responses. Search does not change the
active cycle or its selected current week.

## Read-only operational monitoring

The authenticated monitoring page combines process uptime, database/WAL
size, immutable WAM-backup metadata, aggregate email-delivery records,
and optional timer, certificate, local-backup, and cloud-backup observations.
Every logged-in user can see these anonymous system aggregates; there is
no new administrator role. The API accepts GET/HEAD only and performs no
commands, network requests, repairs, or control operations.

A separate root-run local probe publishes bounded JSON into
`MONITORING_STATE_DIR`. Keep that directory root:copilot-agent 0750 and its
published files 0640; the application needs read access, never write
access. The probe uses a dedicated non-secret environment file and only
the fixed timer names documented in `deploy/monitoring.integration.txt`.
For the separately installed Blob pipeline, include `backup` in `MONITORING_TIMERS`
and set `MONITORING_BACKUP_TIMER=standalone-blob`. The default `standard` keeps the
existing backup timer, including when cloud upload is added to that standard service.
Missing observations remain unknown. Defaults consider the probe stale
after 15 minutes and backup receipts stale after 36 hours.

Certificate observations use a regular copy of the public leaf PEM,
updated atomically by the certificate-renewal hook; do not supply private
keys or a renewal-managed symlink. This reports the locally observed
validity, not a live HTTPS check. Likewise, timer state is not proof that
its last job succeeded, and a backup receipt attests completion rather
than restoration. This on-VM dashboard cannot alert when its whole host
is unavailable.

## Mobile navigation and motion

Desktop and mobile expose four primary destinations: Home, Week, Goals, and
Shared Meeting. At widths up to 720px they appear in a fixed bottom bar.
The More menu groups planning, progress/archive, communication/reminders, and
account/system tools instead of showing a horizontally scrolling tab strip.
The single **פגישה משותפת** destination contains both personal next-week planning
and the shared WAM. Home's planning CTA opens that same page; there is no separate
personal-planning destination in desktop/mobile/More navigation. Personal planning
still targets the selected dashboard cycle's current week + 1, never week 13;
WAM selection, archive links, records and participant permissions stay independent.
The page retains the planning section without a partner, its week-12/no-cycle
explanation when applicable, and read-only partner planning alongside shared WAMs.
Cycle-level planning and Goals remain separate.

Menu navigation, the selected board and historical week, and exact cycle/WAM/
archive-result identifiers are URL-backed. Refresh keeps the requested board
(including a partner), and browser Back/Forward restores the corresponding view.
Cycle and WAM detail open/close actions also update history; a data refresh never
adds a navigation entry. Pending partnership lookup shows a loading state, and an
unavailable bookmarked board shows an explicit recovery action instead of silently
falling back to the owner's board. URLs contain navigation identifiers, not drafts,
notes or credentials. Home's week album continues to use the current cycle week;
the Week tab uses the URL-selected week.

Controls accommodate touch and safe
areas. The sheet supports keyboard containment, Escape, and focus return.
Standalone metadata, home-screen icons, and theme-color updates improve
installed-browser presentation; there is no service worker or offline
cache of private data.

Route/card entrances, tactile controls, completion feedback, and the
dedicated WAM celebration provide the higher-intensity motion treatment.
Route transforms are not retained after animation and are disabled around
open dialogs, keeping fixed overlays viewport-relative. Reduced-motion
preferences disable nonessential movement and retain the final states.

Confirmed owner score crossings from below85% to85% or higher always trigger
milestone fireworks, independently of surprise odds, quotas or cooldowns.
Each genuine re-crossing has its own mutation identity. Reduced motion keeps
the milestone message without particles; initial/GET-only gold scores do not fire.

Surprise celebrations consider other confirmed owner tactic completions
or newly saved BROOSTs. They never arise from
initial loads, unchecking, read actions, failed saves, or partner views.
Stable occurrence IDs prevent replay from toggling the same completion.
Eligible events have a 16% chance, a 90-second cooldown, and a maximum of
four notices per account/tab session. Events while hidden or while a modal
is open are consumed without replay; a WAM uses its dedicated modal rather
than a competing toast. Account/navigation changes discard late feedback.

## Profile, avatar, and success streak

Every user has a minimal profile, self-scoped and self-editable via
`GET/PATCH /api/profile` (never a second user's) plus an authenticated
password-change endpoint — reachable from the "פרופיל" (Profile) tab, which
is always available regardless of whether the user (or, when viewing a
partner, that partner) currently has an active cycle.

- **Display name & bio**: a trimmed, non-empty display name (max 80 chars)
  and an optional bio (max 500 chars). The display name (never the bio) is
  also surfaced to an accepted partner in a few opt-in, profile-safe
  contexts — the BROOST sender's name, and the WAM Duo Streak
  card/celebration overlay (see above) — always via the same
  displayName-with-email-fallback convention. The Duo card shows visible names
  (or the already-authorized email fallback) to distinguish matching initials;
  it does not expose either participant's bio.
- **Avatar**: upload via `PUT /api/profile/avatar` as a raw binary body
  (`Content-Type: image/png|jpeg|webp`, max 2MB) — never base64/JSON. The
  server verifies the real file format from its magic bytes (never trusting
  the claimed Content-Type alone) and always rejects SVG outright. Read back
  via `GET /api/profile/avatar` (authenticated; `Cache-Control: private,
  no-store`, `Vary: Cookie`, and `X-Content-Type-Options: nosniff`).
  Authorization is checked on every fetch rather than keeping partner images
  in a shared browser's HTTP cache after logout/unpairing. User ID and avatar
  version in the URL still trigger image reloads after changes. Remove via
  `DELETE /api/profile/avatar`.
  An optional `?u=<userId>` fetches a *different* user's avatar, allowed only
  when that user is the caller themself or their currently accepted partner
  (used by the WAM Duo Streak card/celebration overlay) — a stranger, or a
  former/unpaired ex-partner, gets the exact same indistinguishable 404 as
  "no avatar set", never a distinguishable "forbidden" response. Avatar
  bytes are never included in any JSON response (profile, auth, WAM, or
  export).
- **Password change**: `PATCH /api/profile/password` takes the current and
  new password, verifies the current hash, rejects re-using the same
  password, enforces the same password rules as registration, and — on
  success — revokes every *other* active session for that user while
  preserving the session making the request (so changing your password
  never logs you out of your own current tab).
- **Personal success streak**: the number of consecutive *finished* weeks
  (across all of a user's cycles, oldest to newest) scored at or above the
  85% target — shown as a small numbered chip on the Avatar (TopBar and
  ProfilePage). It's fully derived on read from the same scoring data used
  everywhere else (never a duplicated/persisted counter): an active cycle's
  weeks 1..current_week-1 count as finished (the current week is still in
  progress and never affects it either way), while an archived cycle's weeks
  1..current_week all count as finished (ending a cycle finalizes its
  last-recorded week), and the streak can continue across an archive
  boundary into the very next cycle. A week with no scheduled tactics at all
  (null score) or a week scoring below 85% immediately ends the streak.

## Password reset (forgot password)

Alongside the authenticated in-session password *change* above, any user who
can't log in at all can request a self-service reset email from the
"שכחת סיסמה?" link on the login screen.

- **Enumeration resistance**: `POST /api/auth/forgot-password` always
  returns the exact same generic `200` response (`{"message": "אם קיים
  חשבון המשויך לכתובת האימייל הזו, נשלח אליו קישור לאיפוס הסיסמה"}`) no
  matter whether the email is malformed, belongs to no account, is
  rate-limited, or a real reset email was just sent — nothing about account
  existence is ever observable from the response. The response is also sent
  *before* the actual email provider call: everything that determines the
  response (validation, throttle bookkeeping, the account lookup, and token
  creation) is fast, synchronous SQLite work, while the one step with
  variable, provider-dependent latency — the ACS network round trip — is
  deliberately deferred (`setImmediate`, fully try/caught, never an
  unhandled rejection) to run *after* the response has already been sent.
  This isn't a claim of exact timing equality across every branch, but it
  does remove the dominant, variable-cost step from the response's own
  critical path.
- **Rate limiting, without revealing existence**: a per-account limit (3
  requests per 15-minute window) is enforced both by a fast in-process
  in-memory check and by a durable, restart-surviving count of
  `password_reset_tokens` rows created for that account in the window
  (query `server/src/lib/passwordReset.ts`). The in-memory check is recorded
  for *every* syntactically-valid email address *before* the account lookup
  even runs — including ones that turn out to belong to no account — so
  throttling behavior can never itself be used to distinguish a real address
  from a fake one. Because that means arbitrary (attacker-chosen, possibly
  nonexistent) addresses can accumulate entries, the in-memory map is capped
  at a bounded size (`MAX_TRACKED_EMAILS`, LRU-evicted) and every prune
  fully deletes an email's entry once its timestamps age out (never left as
  a dangling empty array) — real cleanup, not just filtering. Being
  rate-limited never changes the response — it's still the same generic
  `200` as every other case.
- **Tokens**: a cryptographically random 256-bit token is generated per
  request; only its SHA-256 hash is ever persisted (migration
  `011_password_reset.sql`, independent of any profile column so it applies
  cleanly regardless of migration order) — never the plaintext, and no
  request metadata (no IP, no user-agent) is stored at all. Tokens expire
  after 45 minutes and are single-use; requesting a new one immediately
  invalidates any previously outstanding, unused token for that account.
  Rows are never deleted (only marked used) so the rate-limit count above
  stays accurate over time. Changing the password via the authenticated
  in-session profile flow (above) *also* invalidates any outstanding reset
  token for that account in the same atomic step — an authenticated change
  is itself a security reset, so an old leaked reset link must not remain
  usable afterwards.
- **Delivery**: a branded RTL HTML email (reusing the same header image as
  the other automated emails) with a link to `APP_PUBLIC_URL` carrying the
  plaintext token in the URL **fragment** (`#resetToken=...`), not the query
  string — fragments are never transmitted to the server by a browser, so
  the token never appears in a reverse proxy's access log or in the
  `Referer` header of any subsequent cross-origin navigation from the reset
  page. (A legacy `?resetToken=...` query-string link is still accepted
  client-side, for any already-sent emails.) This is the only place the
  plaintext token ever exists outside of the brief window between
  generating and hashing it; it is never logged. If sending fails for any
  reason (including `ACS_EMAIL_CONNECTION_STRING` etc. simply not being
  configured), the just-created token is immediately invalidated server-side
  — this happens in the deferred background step, so it never delays or
  affects the (already-sent) response.
- **Resetting**: `POST /api/auth/reset-password` hashes the supplied token
  and atomically claims it in one `UPDATE ... WHERE used_at IS NULL AND
  expires_at > now()` statement, so two simultaneous submissions of the same
  token can never both succeed — the loser gets the same generic
  invalid/expired error a genuinely bad token would. A successful reset
  rejects re-using the current password; otherwise, once the new password
  is hashed, the password update, invalidation of every other outstanding
  token, and revocation of **every** existing session for that user are all
  applied together in one explicit database transaction — never left
  partially applied. (Unlike the authenticated in-session password
  *change*, which preserves the caller's own current session, a password
  *reset* has no "current session" to preserve, since the caller isn't
  logged in to begin with.) The token is burned by the atomic claim the
  moment a reset attempt is made, even if a later check — e.g. the
  same-password rejection — fails the request; retrying requires a fresh
  reset link, a deliberate simplicity/race-safety tradeoff.
- **Client**: the login screen's "שכחת סיסמה?" link opens a minimal
  email-only request form. Reset-token capture/stripping is hoisted to the
  top of `App.tsx` (`lib/resetToken.ts`) so it runs on every mount
  regardless of auth state — a user who is *already logged in* when they
  open their own reset link still sees the reset UI (with a cleaned-up URL)
  instead of the dashboard. The token (from either the fragment or a legacy
  query param) is captured only in React state (never
  `localStorage`/`sessionStorage`) and immediately stripped from the visible
  URL via `history.replaceState`. `AuthCard` itself never reads
  `window.location` — it receives the token as a prop. The reset form (new +
  confirm password) validates the confirmation client-side before ever
  calling the API; a successful reset also calls `logout()` client-side
  (clearing any stale `AuthContext` user state, since the server just
  revoked every session for that account) and transitions to the login
  screen with a one-time success notice.
- No new environment variables — this reuses the exact same
  `ACS_EMAIL_CONNECTION_STRING` / `EMAIL_SENDER_ADDRESS` / `APP_PUBLIC_URL`
  vars as the other automated emails (see `.env.example`). Unlike those,
  this is the one place the **main web server itself** (not just a
  standalone CLI) sends email, from the live `/forgot-password` request —
  see the comment on `getEmailConfig()` in `server/src/config.ts`.

## Testing

```bash
npm test               # backend: vitest + supertest integration tests (in-memory SQLite)
npm run test:client    # frontend: vitest + Testing Library unit/component tests
npm run typecheck      # strict TypeScript checks, both workspaces
```

Backend tests cover: scoring math, week-range/bounds enforcement, the 3-goal
limit, cascading goal deletion, per-user data isolation, owner/partner
authorization (mutual read-only access, no cross-mutation), unrelated-user
no-access, immediate revoke on partnership removal, direct-pairing rules
(discoverable-users listing, self-pairing rejection, one-partner-max
enforced transactionally for both sides, re-pairing after removal), the
shared Weekly Accountability Meeting (WAM) rules (one WAM per partnership per
week per cycle-generation, mutual editing, self-only ratings, score-snapshot
freezing on completion, mismatch warning, unrelated-user denial, revocation
on partnership removal), multi-cycle history (archiving never deletes,
archived goals/tactics/completions become immutable, cycle history read
access for owner/partner and denial for others, a WAM becomes permanently
locked once either referenced cycle is archived, and restarting a week
number under a new cycle never collides with old history), the authenticated
JSON export (includes every own cycle — active and archived — safe profile
metadata, and joint WAM data, while never leaking a partner's private
goals/tactics/completions, avatar bytes, or the password hash), and the
profile/avatar/password-change surface (self-only read/write, display
name/bio validation, avatar MIME-spoofing and magic-byte checks, SVG
rejection, oversized-upload rejection, current-password verification,
same-password rejection, other-session revocation with current-session
preservation, and the personal success-streak math — threshold, break/reset,
in-progress-week exclusion, empty/null weeks, and cross-cycle continuation),
and scheduled one-time email reminders (creator-only authorization,
self/current-partner recipient validation including a since-removed former
partner, title/body limits, past-schedule rejection, Israel wall-clock DST
validation independent of server TZ, edit/cancel state-machine rules, list
privacy, and the delivery worker's atomic claiming, bounded-backoff retries
up to a max attempt count, stale-lease crash recovery, safety against
overlapping worker runs, and branded email content), and the password-reset
("forgot password") flow (enumeration-resistant identical generic responses
for existing/nonexistent/malformed/rate-limited/send-failed cases, the
response never blocking on a hung/slow email provider call, per-account and
bounded-map in-memory rate limiting that survives simulated process restarts
via the durable DB-backed count, real cleanup of expired in-memory entries,
token single-use and expiry, older-token invalidation on a newer request,
race-safe concurrent double-submit of the same token, old-password rejection
alongside new-password login success, full session revocation, atomic
finalization of the password/token/session updates together,
current-password reuse rejection, invalidation of outstanding reset tokens
on an authenticated password change, the reset URL using the fragment (not
the query string), and HTML-escaping in the reset email), and the immutable
in-database WAM completion backup snapshots (exactly one backup row created
per successful completion, the snapshot containing both partnered users'
data and the just-completed WAM/frozen scores across every current safe
table, the security exclusion list — no password hashes, avatar bytes,
sessions, reset-token hashes, prior backups, or raw delivery error text —
durable triggering-WAM identity/week/completed-timestamp metadata surviving
partnership/WAM cascade deletion, a failed calendar-invite delivery
producing no backup, reopen/re-complete preserving the original single
backup rather than duplicating it, race safety, whole-transaction rollback
if snapshot construction throws, schema-drift enforcement catching both an
injected unknown table and an unreviewed new column on an existing table
while the current schema passes cleanly, a golden test pinning the exact
table/column shape and schema version, sorted applied-migrations metadata,
a data-independent shape identifier, and the edge case where calendar
invites already succeeded but the backup transaction itself then failed —
proving the WAM stays draft and a same-schedule retry after restoring the
schema completes with no duplicate invitation sends), and BROOST partner
encouragement (send/anti-spam boundary and concurrency, preset validation,
custom-message length limits, immutable message-snapshot independence from
later preset edits, combined sent+received paginated history with stranger
denial and post-unpairing history retention without new sends, recipient-only
read/mark-all-read with sender/stranger rejection, immediate-send success and
failure with the in-app BROOST surviving either way, delivery-time
participant-existence re-check that deliberately does *not* re-check
partnership, worker retry/backoff/max-attempts/stale-lease recovery, the
immediate-send and worker sharing one claim so neither ever double-sends, one
row's failure never aborting the run, and HTML-escaping of custom messages
and the sender's display name), and tactic evidence (owner/partner/stranger
authorization derived from the tactic's owning cycle, creation requiring a
currently-completed occurrence while editing/deleting an existing record
remains allowed after the completion is unchecked, owner CRUD continuing to
work after the cycle is archived, the non-empty-record invariant, upsert
idempotency, `http(s)`-only link validation, every allowed file
signature/name pairing and every rejected one (SVG/HTML/executable-looking
content/MIME-spoofed/DOCX or TXT without the matching name/NUL-byte TXT),
the 8MB size limit, random unguessable stored filenames with no
path-traversal characters, replacement cleanup happening only after the DB
commit and rollback-cleanup of an orphaned file on a forced DB failure,
authenticated download headers/content, cycle-wide gallery grouping/access
for both current and archived cycles, a Hebrew/emoji original filename
round-tripping correctly through `Content-Disposition` without ever
crashing, a malicious original filename (quotes/CRLF/path separators)
never injecting into response headers, `Content-Security-Policy: sandbox`
present only on inline (image/PDF) downloads, deleting a goal cleaning up
every evidence file under all its tactics (not only the DB rows), original-
filename normalization bounding to 255 Unicode code points without ever
splitting a surrogate pair/emoji in half, private on-disk permissions
(`0700`/`0600`, POSIX-conditional), the offline orphan-file finder never
touching a symlink or unrecognized filename, and — the concurrent-upload
race safety in particular — both a deterministic end-to-end test using an
injected/deferred file write (proving an in-flight upload aborts and cleans
up if its occurrence is unchecked mid-write, and that an overlapping
replacement is cleaned up rather than orphaned) and focused unit tests
directly against the underlying transactional helper), all run against a
freshly created in-memory SQLite database per test file, with any
filesystem-touching tactic-evidence tests using a unique temp directory
under the server package (never `/tmp`) removed again afterward.

### End-to-end (real browser)

Playwright specs live in `client/e2e/`:

- `smoke.spec.ts` — register → create cycle → add goal → add tactic → see it rendered.
- `wam.spec.ts` — two separate browser contexts (two users) pair up and run a
  full Weekly Accountability Meeting: start it, mutually edit shared content,
  each rates themselves, add/toggle a shared commitment, mark complete
  (verifying content locks), then explicitly reopen.
- `cycle-history.spec.ts` — finishes a cycle, confirms the new active cycle
  starts clean, and confirms the old one is preserved, clearly marked
  finished, and fully read-only under "מחזורים קודמים".

Run `npm run e2e` **from the project root**. The existing Playwright runner
uses a freshly built local server and a unique project-local temporary
SQLite/evidence directory. The harness disables dotenv and email sending,
checks that its own process owns the selected port, and cleans up its
process/data on exit. It never reads or writes the development/production DB.
Use `E2E_PORT=4180 npm run e2e` if the default 4179 is occupied; no existing
process is stopped automatically. Non-loopback test targets are rejected.

Install Chromium once with `npm run e2e:install --workspace client` if
the existing browser runner reports it missing.

## Known limitations

- Single partner per user (by design); no group/team accountability.
- No invitation/acceptance flow in V1 — pairing is immediate and approved
  members can discover other approved members' email addresses (see
  "Direct partner pairing" above); real invitation email is a V2 backlog item.
- Password reset is race-safe for concurrent uses of the *same* token, but is
  honestly **at-least-once**, not exactly-once, for the email itself: if the
  process crashed between the ACS provider accepting the reset email and the
  token being marked used, a user could in principle receive the email but
  find the token already invalid (they would just request a new one) — the
  same category of limitation already documented for scheduled reminders.
  The provider round trip is off the `/forgot-password` response's critical
  path (see above), which removes its variable latency as a signal, but this
  is not a claim of exact timing equality across every branch (e.g. a
  malformed email still returns marginally faster than a well-formed one,
  since it skips the DB work entirely) — enumeration resistance here is
  primarily response-content-based, with timing as a secondary, partial
  mitigation.
- "Today" scheduling is derived from the real-world weekday combined with the
  cycle's manually-advanced current week — there's no calendar-date mapping
  per week.
- WAMs optionally send real calendar invitations for the next scheduled
  meeting (see above) via Azure Communication Services Email, using the same
  `ACS_EMAIL_CONNECTION_STRING` / `EMAIL_SENDER_ADDRESS` / `APP_PUBLIC_URL`
  env vars as the weekly reminder script — there is no invitation
  cancellation or RSVP ingestion (attendee responses are not read back). A
  separate operational script (not part of the app itself) still sends a
  weekly "did you schedule your WAM?" reminder email — see "Weekly WAM email
  reminder" above.
- No account deletion, CSV export/import, or admin panel in V1.
