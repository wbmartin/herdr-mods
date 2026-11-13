// Turns successive snapshots of what Herdr shows into observation events,
// written only on change (docs/time-tracker-spec.md section 5). Pure.
//
// A snapshot:
//   { ms, herdrFront: bool,
//     focus: { space, tab, terminal, program, title, cwd } | null,
//     spaces: { [id]: { name, folder, spaceMachine, branch } },
//     agents: { [terminal]: { space, app, status } },
//     terminals: { [terminal]: { space, cwd, repo, program, title } } }
//
// A terminal's `cwd` is its foreground program's live folder and `repo` the
// git repo there: the project comes from the terminal, not the space (a
// space's folder is only where it was made).

export const GAP_MS = 30_000;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// prev: the last snapshot (null on start). Returns [{type, fields, ms}].
export function diff(prev, cur) {
  const out = [];
  const push = (type, fields, ms = cur.ms) => out.push({ type, fields, ms });

  if (prev && cur.ms - prev.ms > GAP_MS) {
    push("gap", { from: new Date(prev.ms).toISOString(), to: new Date(cur.ms).toISOString() });
  }

  if (!prev || prev.herdrFront !== cur.herdrFront) push("herdrFront", { active: cur.herdrFront });

  const fk = (f) => (f ? [f.space, f.tab, f.terminal] : null);
  if (!prev || !same(fk(prev.focus), fk(cur.focus))) push("focus", cur.focus ?? { space: null });

  for (const [id, s] of Object.entries(cur.spaces)) {
    if (!prev || !same(prev.spaces[id], s)) push("space", { space: id, ...s });
  }

  for (const [terminal, a] of Object.entries(cur.agents)) {
    const p = prev?.agents[terminal];
    if (!p || p.status !== a.status || p.app !== a.app) push("agent", { terminal, ...a });
  }
  for (const terminal of Object.keys(prev?.agents ?? {})) {
    if (!(terminal in cur.agents)) push("agent", { terminal, status: "gone" });
  }

  for (const [terminal, t] of Object.entries(cur.terminals)) {
    if (!prev || !same(prev.terminals[terminal], t)) push("terminal", { terminal, ...t });
  }
  for (const terminal of Object.keys(prev?.terminals ?? {})) {
    if (!(terminal in cur.terminals)) push("terminal", { terminal, gone: true });
  }

  return out;
}

// `input` while the person is at the machine: idle shorter than the sample
// interval, at most one per INPUT_EVERY_MS. Returns the event or null.
export const INPUT_EVERY_MS = 30_000;
export function inputEvent(lastInputMs, ms, idleSec, sampleMs) {
  if (idleSec == null || idleSec * 1000 >= sampleMs) return null;
  if (lastInputMs != null && ms - lastInputMs < INPUT_EVERY_MS) return null;
  return { type: "input", fields: { idleSec }, ms };
}
