# Herdr time tracker — spec (v0.2)

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
- **gsd-notes is the store and the only fold.** Herdr sends events only: no fold, no totals.
  gsd-notes keeps every event, folds windows (nightly for closed days, on read for today) and serves them.
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
2. **The events are the record; windows are a rebuildable cache.** gsd-notes folds them (a pure
   function that never reads the clock) and may store a closed day's windows, but can always
   rebuild them from events. Reconciliation decisions are events too, addressing a time interval
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
below). Every line: `v`, `id` (UUIDv7), `at` (UTC ISO-8601, ms), `machine` (short hostname, always), `type`.

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

Free text (`title`, `terminalTitle`, space `name`, `cwd`, `folder`) is **truncated to 512
characters** before writing, so no event nears the receiver's 4 KiB cap.

Not captured, ever: terminal contents, typed commands, scrollback, transcripts.

### Platform probes (run through `exec`)

| | Linux X11 | macOS |
|---|---|---|
| OS idle | `xprintidle` (ms) | `ioreg -c IOHIDSystem` → `HIDIdleTime` (ns) |
| front app + title | `xprop -root _NET_ACTIVE_WINDOW`, then `xprop -id … WM_CLASS _NET_WM_NAME` | `osascript` via System Events (needs **Accessibility** permission; prompt handled, app name only until granted) |

Wayland: no portable front-app probe. The mod detects it, skips `app`, and says so once.
A missing probe degrades (no `input` → human time relies on focus changes and Herdr-front only)
and is reported in the panel, never silently.

## 6. Claude Code hook — tool start and end (AI wait)

Herdr only sees an agent's reported status (working/blocked/done/idle), which cannot tell thinking
from waiting on a gate. A **Claude Code hook**, owned by this repo (`hooks/claude-time.sh`,
installed into `~/.claude/settings.json` by `install.sh`), adds the signal.

| hook | event written |
|---|---|
| `PreToolUse` | `toolStarted {terminal, toolUseId, tool, script?, background}` |
| `PostToolUse` (foreground) | `toolEnded {terminal, toolUseId, durationMs}` |
| `PostToolUse` (background launch) | `toolLaunched {terminal, toolUseId, taskId}` |
| `UserPromptSubmit` carrying `<task-notification>` | `toolEnded {terminal, toolUseId, taskId}` (background end) |

- `terminal` = `HC_TERMINAL_ID` (verified 2026-11-13: equals the `hc` address and Herdr's agent
  address for the same terminal). Outside Herdr there is no `HC_TERMINAL_ID`, so the hook does nothing.
- `script` = the repo `bin/` script name when the command runs one (`bin/300-run-tests`).
  **Never arguments, output or the rest of the command**: the hook drops them before writing.
- One append per call, nothing else (it runs on every tool call). It writes its **own file**,
  `events/<day>.hook.jsonl`, so two writers never share a file; the shipper reads both.
- Untested (spike, gsd-notes #181 comments): interactive mode (a notification may wait for a busy
  turn; the output file's mtime gives the true end), sub-agents' tool calls, per-call cost.
- Remote ssh machines: v1 tracks hooks on this machine only; a remote agent's tool calls are not seen.

## 7. Storage (local)

```
~/.config/herdr-app/data/time-tracker/
  events/2026-11-13.jsonl        the mod's observations, local-zone day of `at`
  events/2026-11-13.hook.jsonl   the Claude Code hook's tool events
  projects.json                  alias file (yours to edit)
  outbox.json                    shipping cursor per file
  token                          the shared Herdr gsd-notes token, 0600, never in git
```

Spike (2026-11-13, `spikes/ttspike`, Linux, Herdr 0.1.13): the mod `fs` has `exists, mkdir,
readFile, readdir, rmdir, unlink, writeFile`, **no `appendFile`**. So each line is appended
through `exec("sh", ["-c", 'printf "%s\n" "$1" >> "$2"', "sh", line, path])` (~10 ms; a
single `write` with `O_APPEND`, so the hook and the mod could even share a file safely, but they
don't). Also found: `exec` costs ~14 ms; `crypto.randomUUID` (v4) and `getRandomValues` exist, so
UUIDv7 is built from the clock plus `getRandomValues`; `import "websocket"` gives `WebSocket` for
`/realtime`; `cx.timer.after` exists; `focused().agent` / `agents()[].address` are the same
`t10`-style address as `HC_TERMINAL_ID`. Reads are capped at 1 MiB, so files are per day.
Local files are kept 90 days after they're shipped.

## 8. Shipping

- Every **5 min** and on Herdr quit: send unshipped events in batches (≤ 500) to the receiver.
  Advance the cursor only on a 2xx; retry with backoff; offline just waits.
- **Machine name on every event and every batch:** `machine` is the short hostname, and the
  server trusts it. One Herdr token is shared by all machines (owner, 2026-11-13).
- Idempotent by event `id` (UUIDv7); re-sending is harmless.
- **Everything is shipped, window titles included** (owner, 2026-11-11). Titles are kept forever
  on the server (owner's risk acceptance, gsd-notes #185). An exclusion list (password managers,
  private browser windows) blanks the title before it is written.

## 9. Herdr UI — low profile

A status indicator only (owner, 2026-11-13). Mouseover shows probe health (idle, front app, hook),
last ship time, and `totals.pending` **read from gsd-notes** `blockList` (so the token also has
the read grant). It reads only after its own successful ship and on a `timeDay` hint for today
from `/realtime`; it never polls. No totals, no timeline, no reconciliation in Herdr.

## 10. Verification

- `node --test mods/time-tracker/test/`: event serialisation, the change-only sampler, title
  exclusion, the shipper's cursor and retry (against a fake receiver), and the hook's command
  scrubbing (a test that feeds it full commands and checks only the `bin/` label survives).
- `herdr-app check mods/time-tracker`, then `sh install.sh`.
- Probes and the hook: a manual check on each OS (Linux run here; macOS via
  `spikes/20261111_125324-mac-probes.sh`).
- The fold has no tests here: it is not here (§11).

## 11. Not in Herdr

- **The fold.** Herdr sends events only (owner, 2026-11-13, gsd-notes decision 23). gsd-notes is
  the only code that turns events into windows: a daily run at 03:00 America/New_York folds
  yesterday, and today is folded on read. Fold rules, parameters (grace, AI-wait minimum) and the
  bmux test cases are gsd-notes' (#185); §3 here is the shared understanding, not code.
- Billing, transcripts, manual entry, tracking while Herdr is closed, Wayland front-app, Windows.

## 12. Open items

1. Remote spaces (ssh machines): repo name probed with `exec(..., {on: machine})`; confirm cost.
   Remote hooks (§6) are out of v1.
