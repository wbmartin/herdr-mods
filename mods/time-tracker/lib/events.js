// Event lines for the local log (docs/time-tracker-spec.md section 5).
// Pure: no Herdr imports, so `node --test` can load it.

export const SCHEMA_VERSION = 1;
export const TEXT_MAX = 512;
const TEXT_FIELDS = ["title", "terminalTitle", "name", "cwd", "folder"];

// UUIDv7: 48-bit unix ms, version 7, 74 random bits, variant 10.
export function uuidv7(ms, randomBytes) {
  const b = randomBytes(16);
  let t = Math.floor(ms);
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function truncate(value) {
  if (typeof value !== "string") return value;
  return Array.from(value).length > TEXT_MAX ? Array.from(value).slice(0, TEXT_MAX).join("") : value;
}

export const RESERVED = ["v", "id", "at", "machine", "type"];

// One event object. `machine` is this computer's short hostname; a field
// naming another machine (a space's ssh host) is `spaceMachine`.
export function makeEvent(type, fields, { ms, machine, randomBytes }) {
  const e = { v: SCHEMA_VERSION, id: uuidv7(ms, randomBytes), at: new Date(ms).toISOString(), machine, type };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (RESERVED.includes(k)) throw new Error(`event field "${k}" is reserved`);
    if (v === undefined) continue;
    e[k] = TEXT_FIELDS.includes(k) ? truncate(v) : v;
  }
  return e;
}

// The local file a moment belongs to: the machine's own calendar day.
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// A stable project id from a repo or space name.
export function slug(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
