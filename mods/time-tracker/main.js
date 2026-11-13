// Herdr time tracker: observes what Herdr shows and appends events to a local
// JSONL log (docs/time-tracker-spec.md). It never folds or totals; gsd-notes does.

import { View, div } from "gpui-kit";
import { exec, agents, focused, terminals, spaces, window, appHome } from "herdr";
import * as fs from "fs/promises";
import { makeEvent, dayKey, slug } from "./lib/events.js";
import { diff } from "./lib/sampler.js";

const VERSION = "0.1.0";
const SAMPLE_MS = 5000;
const GRACE_SEC = 300;

const randomBytes = (n) => {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
};

export default class TimeTracker extends View {
  init(_props, cx) {
    this.dir = appHome() + "/data/time-tracker/events";
    this.prev = null;
    this.busy = false;
    this.repos = {}; // "<machine>|<folder>" -> repo name, or null while unknown
    this.seenProjects = new Set();
    this.health = { log: "starting" };
    cx.spawn(async (cx) => {
      await fs.mkdir(this.dir, { recursive: true });
      const h = await exec("hostname", ["-s"]);
      this.machine = h.stdout.trim() || "unknown";
      // QuickJS has no Intl: the zone is the name /etc/localtime links to (Linux and macOS).
      const z = await exec("sh", ["-c", "readlink /etc/localtime 2>/dev/null | sed 's#.*/zoneinfo/##'"]);
      const tz = z.stdout.trim() || null;
      const utcOffsetMin = -new Date().getTimezoneOffset();
      await this.write([{ type: "trackerStarted", fields: { version: VERSION, platform: window().platform, tz, utcOffsetMin, graceSec: GRACE_SEC }, ms: Date.now() }]);
      await this.tick();
      cx.timer.every(SAMPLE_MS, () => { this.tick(); });
    });
  }

  async close() {
    if (this.machine) await this.write([{ type: "trackerStopped", fields: {}, ms: Date.now() }]);
  }

  snapshot(ms) {
    const termList = terminals().filter((t) => t.state === "live");
    const byAddr = Object.fromEntries(termList.map((t) => [t.address, t]));
    const f = focused();
    const ft = f?.terminal ? byAddr[f.terminal] : null;
    const spaceMap = {};
    for (const s of spaces()) {
      spaceMap[s.id] = { name: s.name, folder: s.folder, spaceMachine: s.machine ?? null, branch: s.branch ?? null };
    }
    const agentMap = {};
    for (const a of agents()) agentMap[a.address] = { space: a.space, app: a.app, status: a.status };
    const termMap = {};
    for (const t of termList) {
      const space = t.labels?.["herdr.space"] ?? null;
      const cwd = t.foreground?.cwd ?? t.cwd ?? null;
      const on = spaceMap[space]?.spaceMachine ?? null;
      termMap[t.address] = { space, cwd, repo: this.repoFor(cwd, on), program: t.program?.key ?? null, title: t.title ?? "" };
    }
    return {
      ms,
      herdrFront: Boolean(window().active),
      focus: f ? { space: f.space, tab: f.tab, terminal: f.terminal ?? null, program: ft?.program?.key ?? null, title: ft?.title ?? null, cwd: f.cwd ?? null } : null,
      spaces: spaceMap,
      agents: agentMap,
      terminals: termMap,
    };
  }

  // The repo name at a folder ("" outside a repo), looked up once in the
  // background; null while unknown, so the terminal is recorded again then.
  repoFor(folder, on) {
    if (!folder) return null;
    const key = `${on ?? ""}|${folder}`;
    if (key in this.repos) return this.repos[key];
    this.repos[key] = null;
    exec("git", ["-C", folder, "rev-parse", "--show-toplevel"], { on })
      .then((r) => { this.repos[key] = r.code === 0 ? r.stdout.trim().split("/").pop() : ""; })
      .catch(() => { this.repos[key] = ""; });
    return null;
  }

  projectEvents(snap) {
    const out = [];
    for (const t of Object.values(snap.terminals)) {
      if (!t.repo) continue; // still looking, or not in a repo
      const projectId = slug(t.repo);
      if (!projectId || this.seenProjects.has(projectId)) continue;
      this.seenProjects.add(projectId);
      out.push({ type: "projectSeen", fields: { projectId, folder: t.cwd, spaceMachine: snap.spaces[t.space]?.spaceMachine ?? null }, ms: snap.ms });
    }
    return out;
  }

  async tick() {
    if (this.busy || !this.machine) return;
    this.busy = true;
    try {
      const snap = this.snapshot(Date.now());
      const evs = [...diff(this.prev, snap), ...this.projectEvents(snap)];
      this.prev = snap;
      if (evs.length) await this.write(evs);
    } catch (e) {
      this.health.log = "error: " + e;
    } finally {
      this.busy = false;
    }
  }

  // One exec per tick and per day file: the mod fs has no appendFile.
  async write(evs) {
    const byDay = {};
    for (const e of evs) {
      const line = JSON.stringify(makeEvent(e.type, e.fields, { ms: e.ms, machine: this.machine, randomBytes }));
      (byDay[dayKey(e.ms)] ??= []).push(line);
    }
    for (const [day, lines] of Object.entries(byDay)) {
      const r = await exec("sh", ["-c", 'f=$1; shift; printf "%s\\n" "$@" >> "$f"', "sh", `${this.dir}/${day}.jsonl`, ...lines]);
      if (r.code !== 0) throw new Error(r.stderr || "append failed");
    }
    this.health.log = "ok";
    this.health.lastWriteMs = Date.now();
  }

  render() {
    return div().text_size(11).child("time-tracker: " + (this.health.log ?? ""));
  }
}
