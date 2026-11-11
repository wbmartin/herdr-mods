# Herdr time tracker — spec (v0.1, draft)

*Draft from the design conversation of 2026-11-11. Harvests the bmux time-tracking work
(github.com/wbmartin/bmux: `specs/100-initial-spec.md` v3 on `main`, v5 and ADRs 0001/0003/0004
on `loop/initial-build`). Not reviewed yet.*

## 1. Purpose

Brandon works across several clients and projects, mostly in Herdr with coding agents. He wants
to know where his time and his agents' time goes, without stopwatch discipline, so it can be
analysed for productivity in gsd-notes. Billing is a later use of the same data, not v1.

Platforms: **Linux (X11) and macOS.** Single user, several machines.

## 2. Shape

- A **Herdr mod**, `mods/time-tracker` in this repo. It runs while Herdr runs, observes, and
  appends events to a **local log**. Nothing is tracked while Herdr is closed.
- A **shipper** inside the same mod sends the raw events to a **gsd-notes receiver**
  (`docs/time-receiver-contract.md`). Shipping is idempotent; the local log is never edited.
- **gsd-notes is the store and the fold.** It keeps every shipped event, folds blocks on read and
  serves them to readers.
- **b-loc-utils presents it**: the daily view (gsd-notes project 10, #177) aggregates the blocks
  from gsd-notes with its own calendar overlay (#179). Herdr shows only today's totals and a
  pending nudge.
- **Reconciliation is the b-loc-utils daily review** (owner, 2026-11-11), ported from bmux's
  Swift day timeline (`Sources/BmuxApp/Reconciliation/ReconciliationView.swift`,
  `Sources/BmuxCore/Ledger/Reconciler.swift`, ADR 0004 on `loop/initial-build`). Its decisions are
  `reconciled` events posted to gsd-notes.
- **Herdr is the only activity writer** (owner, 2026-11-11, on #177 question 1). b-loc-utils does
  not sample; #178's sampler is this mod.

```
Herdr live data ─┐
OS idle / front app ─┼─► time-tracker mod ─► local JSONL log ─► shipper ─► gsd-notes receiver
wall-clock gaps ─┘                                                       └─► fold ─► b-loc-utils daily view
```

## 3. Principles carried over from bmux

1. **The log records observations only.** No "focus moved" or "gap opened" conclusions are
   stored. Grace, dwell and thresholds are fold parameters, so changing one re-folds history.
2. **Blocks are never stored:** `blocks(day) = fold(events)`, a pure function that never reads the
   clock (takes `asOf`). Reconciliation decisions are events too, addressing a time interval
   (not a block id), and later decisions win.
3. **Pending, never silently dropped.** A gap past grace becomes pending, not lost.
4. **Grace is 5 minutes**; exactly 5:00 is inside.
5. **Restored terminals are dormant** — no time until real activity after a Herdr start.
6. **Reassignment is forward-only** from the moment it's made; reconciliation fixes the past.
7. **Days are folded one at a time in an explicit time zone**; a range is a sum of days.
8. **Append-only JSONL, one file per day**, flushed on every append, tolerant of a torn last line
   (skip and report damaged lines, never append onto one).

## 4. Projects

- **Project id defaults to the git repo name** at the space's folder (`git rev-parse
  --show-toplevel` basename, run on the space's machine). No repo: the space name.
- **The project catalogue lives in gsd-notes**, folded from events (bmux model): `projectDefined
  {projectId, name, billable}`, `projectArchived {projectId}`. `projectId` is a stable slug
  (default: the repo name); renaming changes `name`, never the id. b-loc-utils edits it by posting
  those events; readers get it from `GET /time/projectList` (contract).
- The mod emits `projectSeen {projectId, folder, machine}` the first time a key appears; the
  server lists a seen-but-undefined id as a project named after it, `billable: false`.
- A local **alias file** (`~/.config/herdr-app/data/time-tracker/projects.json`) only maps a key
  to another `projectId` (merge two repos into one project). When it changes, the mod appends a
  `projectMapped {key, projectId}` event so the fold stays reproducible. Billable is not set here.
- Work that doesn't fit a repo (calls, admin, Scouts) is handled in gsd-notes: assigned during
  reconciliation or entered manually there.

## 5. What is observed

Sampled every **5 s** by `cx.timer`; an event is written **only on change** (except `input`,
below). Every line: `v`, `id` (UUIDv7), `at` (UTC ISO-8601, ms), `machine` (hostname), `type`.

| type | fields | source |
|---|---|---|
| `trackerStarted` | `version, platform, tz, graceSec` | mod init |
| `trackerStopped` | — | mod close / Herdr quit (best effort) |
| `gap` | `from, to` | wall clock jumped > 30 s between samples: sleep, lid, suspend, hang |
| `input` | `idleSec` | OS idle time < sample interval; at most one per 30 s while you're active |
| `herdrFront` | `active` | `window().active` |
| `focus` | `space, tab, terminal, program, title, cwd` | `focused()` (+ `panes()`/`terminals()`) |
| `space` | `space, name, folder, machine, repo, branch` | `spaces()`; on first sight and change |
| `agent` | `terminal, space, app, status, turn` | `agents()` status changes |
| `title` | `terminal, title` | terminal title changes |
| `app` | `app, title, domain?` | frontmost app when Herdr isn't (informational); shipped, title included (§8) |
| `projectSeen` | `projectId, folder, machine` | first sight of a project key |
| `projectMapped` | `key, projectId` | alias file change |
| `reconciled` | `from, to, decision (assign\|unbill\|discard), projectId?` | b-loc-utils daily review, never the mod |
| `projectDefined` / `projectArchived` | `projectId, name, billable` / `projectId` | catalogue edits from b-loc-utils |

Not captured, ever: terminal contents, typed commands, scrollback, transcripts.

### Platform probes (run through `exec`)

| | Linux X11 | macOS |
|---|---|---|
| OS idle | `xprintidle` (ms) | `ioreg -c IOHIDSystem` → `HIDIdleTime` (ns) |
| front app + title | `xprop -root _NET_ACTIVE_WINDOW`, then `xprop -id … WM_CLASS _NET_WM_NAME` | `osascript` via System Events (needs **Accessibility** permission; prompt handled, app name only until granted) |

Wayland: no portable front-app probe. The mod detects it, skips `app`, and says so once.
A missing probe degrades (no `input` → attention relies on focus changes and Herdr-front only)
and is reported in the panel, never silently.

## 6. The fold — two streams

**Attention** (exclusive, one at a time **across all machines**): you, in a project. When two
machines both show attention, the one with the later `input` takes over from that moment.
- Accrues to the project of the focused space while Herdr is front and the last `input` is within
  grace. A `focus` change moves it immediately (it's a deliberate click/keystroke in Herdr).
- Herdr not front → time is **pending**, carrying the `app` events as context ("Outlook 14 m").
  Never auto-attributed.
- `gap` → **idle**. After a gap, nothing accrues until the next `input`.
- No `input` for > grace → the block ends at the last `input`; the remainder is pending if
  something resumes, nothing if the day simply stops (bmux rule).

**Agent time** (parallel, per terminal): agents working for you.
- Accrues from `agent status=working` to the next non-working status, per terminal, to that
  space's project. Several can overlap each other and your attention.
- `blocked` is recorded separately (waiting on you) — a productivity signal in its own right.

Categories: `attention`, `agent`, `blocked`, `pending`, `idle`, `discarded`; `billable` is a
property from the mapping, not a category.

The fold lives in a pure JS module (`mods/time-tracker/fold.js`) with no Herdr imports so it
runs under `node --test`, and gsd-notes can run the same rules (port or share; §10).

## 7. Storage (local)

```
~/.config/herdr-app/data/time-tracker/
  events/2026-11-11.jsonl    source of truth, local-zone day of `at`
  projects.json              mapping (yours to edit)
  outbox.json                shipping cursor: last shipped id per day file
  token                      gsd-notes API token, 0600, never in git
```

Spike first: mod `fs` has no tested `appendFile`. Fallback: append through
`exec("sh", ["-c", 'printf "%s\n" "$1" >> "$2"', "sh", line, path])`. Reads are capped at 1 MiB;
a busy day is ~0.5 MB, so the fold reads days by file and never one big file.

Retention: local files kept 90 days after they're shipped, then removed. gsd-notes keeps forever.

## 8. Shipping

- Every **5 min** and on Herdr quit: send unshipped events in batches (≤ 500) to the receiver.
  Advance the cursor only on a 2xx; retry with backoff; offline just waits.
- Idempotent by event `id`; re-sending is harmless.
- **Everything is shipped, window titles included** (owner, 2026-11-11, superseding #178's
  "local only"): app names and titles of other apps, and terminal titles. Titles can hold mail
  subjects and document names, so gsd-notes stores sensitive text; this needs a security doc on
  the receiver's PR. An exclusion list (password managers, private browser windows) blanks the
  title before it is written, locally and on the server.
- Clock skew: the server stamps `receivedAt`; skew between `at` and `receivedAt` beyond 2 min is
  flagged, not corrected.

## 9. Herdr UI (v1, small)

A sidebar/status block: today's attention and agent totals per project, a **pending** count with
a link to gsd-notes, probe health (idle/front-app working or not), and last ship time.
No timeline, no reconciliation here.

## 10. Verification

- `node --test mods/time-tracker/test/` — the fold. Port the bmux table cases that still apply
  (focus/grace, pending, sleep→idle, dormant restore, reassignment forward-only, unknown type
  ignored, out-of-order absorbed, per-day folding, `asOf`) and add the two-stream and Herdr-front
  cases. A change to the fold needs a test that fails without it.
- `herdr-app check mods/time-tracker`, then `sh install.sh`.
- Probes: a manual check on each OS (stated in the ticket), since they can't be unit-tested.

## 11. Out of scope for v1

Billing (clients, rates, invoices), transcripts and search, manual entry in Herdr, a timeline UI
in Herdr, tracking while Herdr is closed, Wayland front-app tracking, Windows.

## 12. Open items


1. Dwell before a takeover (bmux ticket 52) — likely unnecessary, since Herdr focus is an
   explicit act rather than inferred from output. Confirm on real data.
2. Should agent time on a space you're not attending be shown as "parallel" capacity in analysis?
   (gsd-notes question.)
3. Fold location: one JS implementation shared by mod and server, or a Go port in gsd-notes with
   a shared test-case table (JSON fixtures). Leaning: JSON fixtures, two implementations.
4. Remote spaces (ssh machines): repo name probed with `exec(..., {on: machine})`; confirm cost.
