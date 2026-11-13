import { test } from "node:test";
import assert from "node:assert/strict";
import { uuidv7, makeEvent, truncate, TEXT_MAX, dayKey, slug } from "../lib/events.js";

const zeros = (n) => new Uint8Array(n);
const ones = (n) => new Uint8Array(n).fill(0xff);

test("uuidv7 carries the time, version 7 and variant 10", () => {
  const ms = Date.UTC(2026, 10, 13, 12, 0, 0);
  const id = uuidv7(ms, ones);
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(parseInt(id.replace(/-/g, "").slice(0, 12), 16), ms);
  assert.equal(uuidv7(ms, zeros).slice(14, 15), "7");
});

test("uuidv7 sorts by time", () => {
  const a = uuidv7(1_000, ones), b = uuidv7(2_000, zeros);
  assert.ok(a < b);
});

test("makeEvent stamps v, id, at, machine, type", () => {
  const e = makeEvent("focus", { space: "s1" }, { ms: 0, machine: "nuc2018", randomBytes: zeros });
  assert.deepEqual(Object.keys(e).slice(0, 5), ["v", "id", "at", "machine", "type"]);
  assert.equal(e.at, "1970-01-01T00:00:00.000Z");
  assert.equal(e.machine, "nuc2018");
  assert.equal(e.space, "s1");
});

test("a field may not overwrite machine or the other reserved keys", () => {
  for (const k of ["v", "id", "at", "machine", "type"]) {
    assert.throws(() => makeEvent("space", { [k]: "x" }, { ms: 0, machine: "m", randomBytes: zeros }), /reserved/);
  }
});

test("free text is cut to 512 characters, other fields are not", () => {
  const long = "é".repeat(600);
  const e = makeEvent("title", { title: long, terminal: long }, { ms: 0, machine: "m", randomBytes: zeros });
  assert.equal(Array.from(e.title).length, TEXT_MAX);
  assert.equal(e.terminal.length, 600);
  assert.equal(truncate(5), 5);
});

test("undefined fields are dropped", () => {
  const e = makeEvent("focus", { a: undefined, b: null }, { ms: 0, machine: "m", randomBytes: zeros });
  assert.ok(!("a" in e));
  assert.equal(e.b, null);
});

test("dayKey is the local calendar day", () => {
  const d = new Date(2026, 0, 2, 23, 59);
  assert.equal(dayKey(d.getTime()), "2026-01-02");
});

test("slug makes a stable project id", () => {
  assert.equal(slug("Eastern Rebate"), "eastern-rebate");
  assert.equal(slug("herdr-mods"), "herdr-mods");
  assert.equal(slug("  ~/x "), "x");
  assert.equal(slug(""), "");
});
