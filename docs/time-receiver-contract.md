# Time tracker → gsd-notes receiver contract (v0.2)

The interface between the Herdr time-tracker mod (`docs/time-tracker-spec.md`), the b-loc-utils
daily review, and the gsd-notes time module (gsd-notes tech tracker #185). v0.2 takes in the
gsd-notes review of 2026-11-13 (comments on #177 and #181; gsd-notes decisions 23–26).
gsd-notes' own conventions (migrations, module isolation, grants) decide how it's built.

## Roles

- **Herdr** (one per machine) observes, logs locally and ships events. It never folds and shows
  no totals (decision 23).
- **gsd-notes** stores every event and is the only code that folds them into windows.
- **b-loc-utils** reads windows and the catalogue, and writes `reconciled` and `project*` events.

## Auth and machine identity

- **One Herdr token**, shared by every machine, plus one for `b-loc-utils` (owner, 2026-11-13:
  fewer tokens; a machine sending the wrong name is an accepted risk).
- **Every event and every batch carries `machine`**, the sender's short hostname. The server
  trusts it as sent; the token does not name a machine. Several machines send at once.
- Grants: **Write time events** and **Read time events** (Read in `TokenReadGrantList`).
  The Herdr token gets both (the indicator reads the pending count). The b-loc-utils token's write is
  limited to `reconciled` and `project*` types; any activity type from it is rejected.

## `POST /time/eventBatch`

```json
{ "machine": "nuc2018", "trackerVersion": "0.1.0",
  "eventList": [ { "v": 1, "id": "0193…", "at": "2026-11-13T14:03:05.123Z",
                   "machine": "nuc2018", "type": "focus", "space": "…", "…": "…" } ] }
```

- Limits: ≤ 500 events and ≤ 1 MiB per batch; a per-event size cap (gsd-notes sets it);
  `id` must be a UUIDv7, unique per tenant; `at` bounded (no far future).
- Each event is stored **verbatim** (JSON) with `id`, `at`, `machine`, `type` as columns and a
  server `receivedTs`. Events are immutable.
- **Idempotent on `id`**: a known id is skipped, not an error. Unknown `type`s are stored, not
  rejected (forward compatibility; the fold ignores them).
- A malformed event is rejected individually; the rest of the batch still lands.
- Response `200`: `{ "acceptedCount": 498, "duplicateCount": 2, "rejectedList": [ { "id": "…",
  "reason": "…" } ] }`. `401/403` bad token or grant; `413` too big; `5xx` → the client
  retries the whole batch later.
- Every new tenant table ships with the cross-tenant negative test.

## Event types

Herdr's observations: spec §5 (`trackerStarted`, `trackerStopped`, `gap`, `input`, `herdrFront`,
`focus`, `space`, `agent`, `title`, `app`, `projectSeen`, `projectMapped`). Herdr's Claude Code
hook: spec §6 (`toolStarted`, `toolLaunched`, `toolEnded`, joined on `toolUseId`; `terminal` is
`HC_TERMINAL_ID`, the same address as in `agent`/`focus`). From b-loc-utils:

- `reconciled {from, to, decision: "assign"|"unbill"|"discard", projectId (assign only)}`;
  `at` is the decision time.
- `projectDefined {projectId, name, billable}`, `projectArchived {projectId}`.

## The fold (gsd-notes)

- **Daily run at 03:00 America/New_York** (decision 24): folds yesterday 00:00–24:00, cuts any
  window that runs past midnight at 00:00, stores yesterday's windows and the state carried into
  today (focus, agents working). Stored windows are a cache, rebuildable from events.
- **Today is folded on read** from the carried state plus today's events.
- A late event, or a decision touching a closed day, re-runs that day (and the next if its
  carried state changed).
- **Which day an event belongs to:** activity by its `at`; a `reconciled` event to every day its
  `from..to` touches (not its `at`); catalogue events to no day.
- Rules carried from bmux (spec §3): grace 5 min (5:00 inside), pending never dropped, dormant
  after a Herdr start, reassignment forward-only. A decision addresses an interval, re-reads only
  observed time, later decisions win, discard is reversible (ADR 0004).
- **Measures** (decision 25):
  - `human`: you in a Herdr space (Herdr front, `input` within grace), plus other-app time once
    confirmed in the review. Exclusive across machines: the later `input` takes over.
  - `aiWork`: an agent reporting working, minus `aiWait`.
  - `aiWait`: an agent waiting on a command it started (`toolStarted`→`toolEnded`), background
    runs included; a minimum duration (e.g. 30 s) is a fold parameter. Not promised until the
    hook spike holds up in interactive mode.
  - `aiWaitingOnYou`: agent status `blocked`.
  - plus `pending`, `idle`, `discarded`.
- Clock skew: flag `|at − receivedTs| > 120 s` per machine.

## Realtime hint

Each accepted batch that adds events emits one hint per touched day on `/realtime`: entity
`timeDay`, entityId `yyyymmdd` (owner's zone). For a `reconciled` event, the days of its interval.
Readers re-read that day; nobody polls.

## Read side

- `GET /time/projectList` → `[{projectId, name, billable, archived, firstSeenAt}]`. Folded from
  catalogue events; a seen-but-undefined id lists as `name = projectId`, `billable: false`.
  `projectId` is a stable slug (default the repo name); renames change `name` only.
- `GET /time/blockList?day=YYYY-MM-DD&tz=America/New_York` → the day's windows across all
  machines: `from, to, stream, projectId, projectName, billable, machine, context {app, title,
  domain, terminalTitle, agentApp, tool, script}`, plus `pending` totals, and per machine
  `lastEventAt` and `skewSec` (a silent machine shows as "not reporting", not idle; up to 5 min lag
  is normal). `human` never overlaps itself; the AI streams overlap it and each other (lanes).
- Herdr's indicator needs today's pending count: a field of `blockList` or its own endpoint
  (gsd-notes' call).

## Window titles

Shipped and **kept forever** (owner's risk acceptance, on #185), including in the nightly B2
backups. Herdr blanks titles of excluded apps (password managers, private browser windows) before
writing; the server keeps no exclusion list of its own.

## Analysis (first questions)

Human, AI-work, AI-wait and AI-waiting-on-you hours per project per day/week (SQL sums over stored
windows); AI-to-human ratio; pending time awaiting reconciliation; context switches per hour.
