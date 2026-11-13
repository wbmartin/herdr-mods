import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXprintidle, parseIoregIdle, parseActiveWindow, parseXpropWindow, parseLsappinfoName, domainOf, scrub, makeProbes } from "../lib/probes.js";

test("xprintidle ms becomes whole seconds", () => {
  assert.equal(parseXprintidle("6690\n"), 6);
  assert.equal(parseXprintidle(""), null);
});

test("ioreg HIDIdleTime ns becomes whole seconds", () => {
  assert.equal(parseIoregIdle('  |   "HIDIdleTime" = 12500000000\n'), 12);
  assert.equal(parseIoregIdle("nothing"), null);
});

test("xprop active window, and none", () => {
  assert.equal(parseActiveWindow("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x5200001, 0x0\n"), "0x5200001");
  assert.equal(parseActiveWindow("_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0\n"), null);
});

test("xprop window: the class name and the title", () => {
  const out = 'WM_CLASS(STRING) = "Navigator", "firefox"\n_NET_WM_NAME(UTF8_STRING) = "Inbox \\"work\\" — Mozilla Firefox"\n';
  assert.deepEqual(parseXpropWindow(out), { app: "firefox", title: 'Inbox "work" — Mozilla Firefox' });
  assert.deepEqual(parseXpropWindow('WM_CLASS(STRING) = "herdr-app", "herdr-app"\n'), { app: "herdr-app", title: null });
});

test("lsappinfo display name", () => {
  assert.equal(parseLsappinfoName('"LSDisplayName"="Microsoft Outlook"\n'), "Microsoft Outlook");
});

test("domain only, never path or query", () => {
  assert.equal(domainOf("https://Mail.Google.com/mail/u/0/#inbox?x=1"), "mail.google.com");
  assert.equal(domainOf("http://localhost:5173/app"), "localhost");
  assert.equal(domainOf("about:blank"), null);
  assert.equal(domainOf(null), null);
});

test("password managers and private windows lose their title and domain", () => {
  assert.deepEqual(scrub({ app: "1Password 7", title: "Bank login", domain: null }), { app: "1Password 7", title: null, domain: null, excluded: true });
  assert.equal(scrub({ app: "firefox", title: "x — Mozilla Firefox Private Browsing", domain: "a.com" }).title, null);
  assert.equal(scrub({ app: "Google Chrome", title: "News (Incognito)", domain: "b.com" }).domain, null);
  assert.deepEqual(scrub({ app: "Outlook", title: "RE: plan", domain: null }), { app: "Outlook", title: "RE: plan", domain: null });
});

const fakeExec = (table) => async (cmd, args) => {
  const k = [cmd, ...args].join(" ");
  for (const [pat, r] of table) if (k.startsWith(pat)) { if (r instanceof Error) throw r; return { code: 0, stderr: "", ...r }; }
  return { code: 1, stdout: "", stderr: "unexpected " + k };
};

test("linux probes read xprintidle and xprop", async () => {
  const p = makeProbes(fakeExec([
    ["xprintidle", { stdout: "2100\n" }],
    ["xprop -root", { stdout: "window id # 0x42\n" }],
    ["xprop -id 0x42", { stdout: 'WM_CLASS(STRING) = "outlook", "Outlook"\n_NET_WM_NAME(UTF8_STRING) = "RE: plan"\n' }],
  ]), "linux", "x11");
  assert.equal(await p.idleSec(), 2);
  assert.deepEqual(await p.front(), { app: "Outlook", title: "RE: plan", domain: null });
  assert.deepEqual(p.health, { idle: "ok", front: "ok" });
});

test("linux without xprintidle says to install it; Wayland skips the front app", async () => {
  const p = makeProbes(fakeExec([["xprintidle", new Error("cannot run xprintidle: No such file or directory")]]), "linux", "wayland");
  assert.equal(await p.idleSec(), null);
  assert.equal(p.health.idle, "install xprintidle");
  assert.equal(await p.front(), null);
  assert.match(p.health.front, /Wayland/);
});

test("macOS without Accessibility records the app name only and says why", async () => {
  const p = makeProbes(fakeExec([
    ["ioreg", { stdout: '"HIDIdleTime" = 3000000000\n' }],
    ["lsappinfo front", { stdout: "ASN:0x0-0x1:\n" }],
    ["lsappinfo info", { stdout: '"LSDisplayName"="Safari"\n' }],
    ["osascript -e tell application \"System Events\"", { code: 1, stdout: "", stderr: "not allowed assistive access" }],
    ["osascript -e tell application \"Safari\"", { stdout: "https://www.example.com/a/b?c\n" }],
  ]), "macos", "");
  assert.equal(await p.idleSec(), 3);
  assert.deepEqual(await p.front(), { app: "Safari", title: null, domain: "www.example.com" });
  assert.match(p.health.front, /Accessibility/);
});
