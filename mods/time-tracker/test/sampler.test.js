import { test } from "node:test";
import assert from "node:assert/strict";
import { diff, inputEvent, GAP_MS } from "../lib/sampler.js";

const base = (over = {}) => ({
  ms: 100_000,
  herdrFront: true,
  focus: { space: "s1", tab: "t", terminal: "t1", program: "shell", title: "~", cwd: "/" },
  spaces: { s1: { name: "a", folder: "/a", spaceMachine: null, branch: "main" } },
  agents: { t2: { space: "s1", app: "claude-code", status: "working" } },
  terminals: {
    t1: { space: "s1", cwd: "/a", repo: "a", program: "shell", title: "~" },
    t2: { space: "s1", cwd: "/a", repo: "a", program: "claude", title: "claude" },
  },
  ...over,
});
const types = (evs) => evs.map((e) => e.type);

test("the first snapshot records everything once", () => {
  assert.deepEqual(types(diff(null, base())), ["herdrFront", "focus", "space", "agent", "terminal", "terminal"]);
});

test("an unchanged snapshot records nothing", () => {
  assert.deepEqual(diff(base(), base({ ms: 105_000 })), []);
});

test("a focus move is recorded; a title change in the same terminal is a terminal event, not a focus", () => {
  const p = base();
  assert.deepEqual(types(diff(p, base({ ms: 105_000, focus: { ...p.focus, terminal: "t2" } }))), ["focus"]);
  const evs = diff(p, base({ ms: 105_000, focus: { ...p.focus, title: "vim" }, terminals: { ...p.terminals, t1: { ...p.terminals.t1, title: "vim" } } }));
  assert.deepEqual(types(evs), ["terminal"]);
  assert.deepEqual(evs[0].fields, { terminal: "t1", space: "s1", cwd: "/a", repo: "a", program: "shell", title: "vim" });
});

test("a terminal moving to another repo is recorded with its new cwd and repo", () => {
  const p = base();
  const evs = diff(p, base({ ms: 105_000, terminals: { ...p.terminals, t2: { ...p.terminals.t2, cwd: "/b", repo: "b" } } }));
  assert.deepEqual(evs.map((e) => [e.type, e.fields.terminal, e.fields.repo]), [["terminal", "t2", "b"]]);
});

test("a closed terminal is recorded as gone", () => {
  const p = base();
  const { t2, ...rest } = p.terminals;
  const evs = diff(p, base({ ms: 105_000, terminals: rest }));
  assert.deepEqual(evs.map((e) => e.fields), [{ terminal: "t2", gone: true }]);
});

test("Herdr losing the front is recorded", () => {
  const evs = diff(base(), base({ ms: 105_000, herdrFront: false }));
  assert.deepEqual(evs.map((e) => [e.type, e.fields.active]), [["herdrFront", false]]);
});

test("a wall-clock jump past 30 s is a gap from the last sample to now", () => {
  const evs = diff(base(), base({ ms: 100_000 + GAP_MS + 1 }));
  assert.equal(evs[0].type, "gap");
  assert.equal(evs[0].fields.from, new Date(100_000).toISOString());
  assert.equal(diff(base(), base({ ms: 100_000 + GAP_MS })).length, 0);
});

test("an agent's status change is recorded; a finished agent is recorded as gone", () => {
  const p = base();
  assert.deepEqual(diff(p, base({ ms: 105_000, agents: { t2: { ...p.agents.t2, status: "blocked" } } })).map((e) => e.fields.status), ["blocked"]);
  assert.deepEqual(diff(p, base({ ms: 105_000, agents: {} })).map((e) => [e.type, e.fields.status]), [["agent", "gone"]]);
});

test("a terminal whose repo becomes known is recorded again", () => {
  const p = base();
  const unknown = base({ terminals: { ...p.terminals, t1: { ...p.terminals.t1, repo: null } } });
  const evs = diff(unknown, base({ ms: 105_000 }));
  assert.deepEqual(evs.map((e) => [e.type, e.fields.terminal, e.fields.repo]), [["terminal", "t1", "a"]]);
});

test("losing focus entirely is recorded", () => {
  assert.deepEqual(diff(base(), base({ ms: 105_000, focus: null })).map((e) => e.fields), [{ space: null }]);
});

test("input: only while idle is under the sample interval, at most every 30 s", () => {
  assert.equal(inputEvent(null, 0, 10, 5000), null);
  assert.equal(inputEvent(null, 0, null, 5000), null);
  assert.deepEqual(inputEvent(null, 0, 2, 5000), { type: "input", fields: { idleSec: 2 }, ms: 0 });
  assert.equal(inputEvent(0, 29_999, 1, 5000), null);
  assert.ok(inputEvent(0, 30_000, 1, 5000));
});
