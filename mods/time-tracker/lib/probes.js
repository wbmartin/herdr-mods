// OS probes: idle time and the frontmost app (docs/time-tracker-spec.md section 5).
// `exec` is injected, so the parsers and the exclusion rules are testable.

// Apps whose window titles are never written, and title marks of private windows.
export const EXCLUDED_APPS = ["1password", "keepassxc", "bitwarden", "keychain access", "lastpass", "dashlane"];
export const PRIVATE_MARKS = ["private browsing", "incognito", "inprivate", "private window"];

const BROWSERS_MAC = {
  Safari: 'tell application "Safari" to get URL of front document',
  "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
  "Microsoft Edge": 'tell application "Microsoft Edge" to get URL of active tab of front window',
};

export function parseXprintidle(stdout) {
  const ms = parseInt(String(stdout).trim(), 10);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export function parseIoregIdle(stdout) {
  const m = /"HIDIdleTime"\s*=\s*(\d+)/.exec(String(stdout));
  return m ? Math.floor(Number(m[1]) / 1e9) : null;
}

// `xprop -root _NET_ACTIVE_WINDOW` -> "0x5200001", or null for none/0x0.
export function parseActiveWindow(stdout) {
  const m = /window id # (0x[0-9a-f]+)/i.exec(String(stdout));
  return m && m[1] !== "0x0" ? m[1] : null;
}

// `xprop -id <w> WM_CLASS _NET_WM_NAME` -> { app, title }.
export function parseXpropWindow(stdout) {
  const s = String(stdout);
  const cls = /WM_CLASS\(STRING\) = (.*)/.exec(s);
  const names = cls ? [...cls[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]) : [];
  const t = /_NET_WM_NAME\(UTF8_STRING\) = "((?:[^"\\]|\\.)*)"/.exec(s);
  return { app: names[1] ?? names[0] ?? null, title: t ? t[1].replace(/\\(.)/g, "$1") : null };
}

// `lsappinfo info -only name <asn>` -> "Safari".
export function parseLsappinfoName(stdout) {
  const m = /"LSDisplayName"\s*=\s*"?([^"\n]*)"?/.exec(String(stdout));
  return m ? m[1].trim() : null;
}

// Domain only: never path, query or full URL.
export function domainOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(String(url ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

// Blank the title (and domain) of password managers and private windows.
export function scrub(front) {
  if (!front) return front;
  const app = (front.app ?? "").toLowerCase();
  const title = (front.title ?? "").toLowerCase();
  if (EXCLUDED_APPS.some((x) => app.includes(x)) || PRIVATE_MARKS.some((x) => title.includes(x))) {
    return { ...front, title: null, domain: null, excluded: true };
  }
  return front;
}

// Probes for this platform. Each returns null (not throws) when it can't tell,
// and records why in `health`.
export function makeProbes(exec, platform, session) {
  const health = { idle: "unknown", front: "unknown" };
  const ok = (k) => { health[k] = "ok"; };
  const bad = (k, why) => { health[k] = why; };
  const run = async (cmd, args) => {
    const r = await exec(cmd, args);
    if (r.code !== 0) throw new Error((r.stderr || `${cmd} exited ${r.code}`).trim());
    return r.stdout;
  };

  if (platform === "macos") {
    return {
      health,
      async idleSec() {
        try { const v = parseIoregIdle(await run("ioreg", ["-c", "IOHIDSystem", "-d", "4"])); v == null ? bad("idle", "no HIDIdleTime") : ok("idle"); return v; }
        catch (e) { bad("idle", String(e.message ?? e)); return null; }
      },
      async front() {
        let app = null;
        try {
          const asn = (await run("lsappinfo", ["front"])).trim();
          app = parseLsappinfoName(await run("lsappinfo", ["info", "-only", "name", asn]));
        } catch (e) { bad("front", String(e.message ?? e)); return null; }
        let title = null, domain = null;
        try {
          title = (await run("osascript", ["-e", 'tell application "System Events" to tell (first application process whose frontmost is true) to get name of front window'])).trim() || null;
          ok("front");
        } catch (_) { bad("front", "app names only: grant Herdr Accessibility for window titles"); }
        if (BROWSERS_MAC[app]) {
          try { domain = domainOf(await run("osascript", ["-e", BROWSERS_MAC[app]])); } catch (_) {}
        }
        return scrub({ app, title, domain });
      },
    };
  }

  const wayland = session === "wayland";
  return {
    health,
    async idleSec() {
      try { const v = parseXprintidle(await run("xprintidle", [])); v == null ? bad("idle", "xprintidle gave nothing") : ok("idle"); return v; }
      catch (e) { bad("idle", /No such file/.test(String(e)) ? "install xprintidle" : String(e.message ?? e)); return null; }
    },
    async front() {
      if (wayland) { bad("front", "Wayland: no front-app probe"); return null; }
      try {
        const w = parseActiveWindow(await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"]));
        if (!w) { ok("front"); return { app: null, title: null, domain: null }; }
        const f = parseXpropWindow(await run("xprop", ["-id", w, "WM_CLASS", "_NET_WM_NAME"]));
        ok("front");
        return scrub({ ...f, domain: null });
      } catch (e) { bad("front", String(e.message ?? e)); return null; }
    },
  };
}
