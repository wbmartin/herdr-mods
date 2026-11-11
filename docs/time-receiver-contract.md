# Time tracker → gsd-notes receiver contract (v0.1, draft)

The interface between the Herdr time-tracker mod (`docs/time-tracker-spec.md`) and a new
gsd-notes module that receives, stores, folds and analyses its events. This is the brief for
the gsd-notes side; gsd-notes' own conventions (migrations, module isolation, scopes) decide
how it's built.

## Auth

A gsd-notes API token (`gsdt_…`) with a new scope, e.g. **Write time events**, plus
**Read time events** for later read-back. One token per machine, named for it; revoke on retire.

## `POST /time/eventBatch`

Body:

```json
{ "machine": "nuc2018", "trackerVersion": "0.1.0",
  "eventList": [ { "v": 1, "id": "0193…", "at": "2026-11-11T14:03:05.123Z",
                   "machine": "nuc2018", "type": "focus", "space": "…", "…": "…" } ] }
```

- ≤ 500 events, ≤ 1 MiB.
- Each event is stored **verbatim** (JSON) with `id`, `at`, `machine`, `type` as columns and a
  server `receivedTs`.
- **Idempotent on `id`**: a known id is skipped, not an error. Unknown `type`s are stored, not
  rejected (forward compatibility; the fold ignores them).
- A malformed event is rejected individually; the rest of the batch still lands.

Response `200`:

```json
{ "acceptedCount": 498, "duplicateCount": 2, "rejectedList": [ { "id": "…", "reason": "…" } ] }
```

`401/403` bad token or scope; `413` too big; `5xx` → client retries the whole batch later.

## Server-side

- Events are immutable. Reconciliation (assign, unbill, discard, split, merge) appends
  `reconciled` events through the same store. They come from the b-loc-utils daily review
  (`POST /time/eventBatch`, `machine: "b-loc-utils"`, type `reconciled`), with bmux's rules
  (ADR 0004): a decision addresses an interval `from..to`, not a block; it only re-reads observed
  time, never creates any; later decisions win in log order; discard is a category, reversible.
- Blocks are folded on read (per day, in the owner's time zone), never stored. Cache settled days
  only if measured slow.
- Fold rules and test fixtures: `docs/time-tracker-spec.md` §3 and §6. Both implementations
  should pass the same JSON fixture table.
- Flag `|at − receivedTs| > 2 min` as clock skew.

## Realtime hint

Every accepted `POST /time/eventBatch` that adds at least one event emits one hint per touched day
on the existing `/realtime` feed: entity `timeDay`, entityId `yyyymmdd` (owner's time zone).
Readers re-read that day; nobody polls. **Read time events** goes in `TokenReadGrantList` so a
read token hears it.

## Project catalogue

Folded from `projectDefined {projectId, name, billable}`, `projectArchived {projectId}` and
`projectSeen {projectId, folder, machine}` events (the time module's own; not tech-tracker
projects). `projectId` is a stable slug, default the repo name; renames change `name` only.
A seen-but-undefined id lists as `name = projectId`, `billable: false`.

`GET /time/projectList` → `[{projectId, name, billable, archived, firstSeenAt}]`.
b-loc-utils edits the catalogue by posting `projectDefined` / `projectArchived` events.

## Reconciliation event (from b-loc-utils)

`{v, id (UUIDv7), at (decision time), machine: "b-loc-utils", type: "reconciled", from, to,
decision: "assign"|"unbill"|"discard", projectId (assign only)}`

## Read side (for the b-loc-utils daily view, #177)

`GET /time/blockList?day=YYYY-MM-DD&tz=America/New_York` → the folded blocks for that day across
all machines: `from, to, stream (attention|agent|blocked|pending|idle|discarded), projectId,
projectName, billable` (from the catalogue), `machine, context {app, title, domain, terminalTitle,
agentApp}`, plus `pending` totals.
- `attention` never overlaps itself, across machines (later `input` takes over). `agent` and
  `blocked` overlap attention and each other: draw them as lanes.
- Per machine: `lastEventAt` and `skewSec` (flag when |at − receivedTs| > 120 s), so a silent
  machine shows as "not reporting", not idle. Herdr ships every 5 min, so up to 5 min lag is normal.
b-loc-utils aggregates and draws this beside its calendar overlay; it never
samples activity itself. Other-app window titles are included (sensitive: mail subjects, document names; the receiver PR needs a security doc).

## Analysis (first questions to answer)

Hours of attention and agent time per project per day/week; agent-to-attention ratio; time
`blocked` (agents waiting on you); pending time awaiting reconciliation; context switches per hour.
