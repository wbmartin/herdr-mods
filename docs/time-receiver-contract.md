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
  `reconciled` events through the same store, source `gsd-notes`.
- Blocks are folded on read (per day, in the owner's time zone), never stored. Cache settled days
  only if measured slow.
- Fold rules and test fixtures: `docs/time-tracker-spec.md` §3 and §6. Both implementations
  should pass the same JSON fixture table.
- Flag `|at − receivedTs| > 2 min` as clock skew.

## Analysis (first questions to answer)

Hours of attention and agent time per project per day/week; agent-to-attention ratio; time
`blocked` (agents waiting on you); pending time awaiting reconciliation; context switches per hour.
