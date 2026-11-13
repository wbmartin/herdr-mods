// Time-tracker spike: runs each check once, writes results to
// ~/.config/herdr-app/data/time-tracker-spike/result.json. Throwaway.
import { View, div } from "gpui-kit";
import { exec, agents, focused, terminals, spaces, window, appHome, home, readTextFile } from "herdr";
import * as fs from "fs/promises";

const now = () => Date.now();
async function timed(fn) { const t0 = now(); try { return { ok: true, v: await fn(), ms: now() - t0 }; } catch (e) { return { ok: false, err: String(e), ms: now() - t0 }; } }

export default class Spike extends View {
  init(_p, cx) {
    this.state = "running";
    cx.spawn(async (cx) => {
      const dir = appHome() + "/data/time-tracker-spike";
      const r = { at: new Date().toISOString(), home: home(), appHome: appHome() };
      r.mkdir = await timed(() => fs.mkdir(dir, { recursive: true }));
      r.fsKeys = Object.keys(fs);
      r.appendFile = await timed(async () => {
        await fs.appendFile(dir + "/a.jsonl", '{"n":1}\n');
        await fs.appendFile(dir + "/a.jsonl", '{"n":2}\n');
        return await fs.readFile(dir + "/a.jsonl", "utf8");
      });
      r.execAppend = await timed(async () => {
        await exec("sh", ["-c", 'printf "%s\\n" "$1" >> "$2"', "sh", '{"n":3}', dir + "/b.jsonl"]);
        return await readTextFile(dir + "/b.jsonl");
      });
      r.execTrue = await timed(() => exec("true", []));
      r.hostname = await timed(async () => (await exec("hostname", ["-s"])));
      r.cryptoRandomUUID = await timed(async () => (await import("crypto")).randomUUID?.() ?? "no randomUUID");
      r.getRandomValues = await timed(async () => { const a = new Uint8Array(4); globalThis.crypto.getRandomValues(a); return Array.from(a); });
      r.websocket = await timed(async () => Object.keys(await import("websocket")));
      r.globalWebSocket = typeof globalThis.WebSocket;
      r.window = window();
      r.focused = focused();
      r.agents = agents().map((a) => ({ address: a.address, app: a.app, status: a.status, space: a.space_name, focused: a.focused }));
      r.terminalSample = terminals().slice(0, 2).map((t) => Object.keys(t));
      r.spaceSample = spaces().slice(0, 1).map((s) => ({ keys: Object.keys(s), name: s.name, folder: s.folder, machine: s.machine }));
      r.xprop = await timed(async () => (await exec("xprop", ["-root", "_NET_ACTIVE_WINDOW"])));
      r.xprintidle = await timed(async () => (await exec("xprintidle", [])));
      r.timerDrift = await timed(() => new Promise((res) => { const t0 = now(); cx.timer.after ? cx.timer.after(1000, () => res(now() - t0)) : res("no timer.after"); }));
      await fs.writeFile(dir + "/result.json", JSON.stringify(r, null, 1));
      this.state = "done";
      cx.notify();
    });
  }
  render() { return div().p(8).child("time-tracker spike: " + this.state); }
}
