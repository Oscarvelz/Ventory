// Ventory's floor on this device (IndexedDB) and its sync with Supabase.
// Every piece, ad, subcategory mark and the preferences are separate records. A change is saved here first (the app
// works with no internet), marked dirty, and pushed when a session and a connection exist. Each record keeps the
// newest edit (last write wins per record, by updated_at), and removals travel as tombstones, so two devices merge
// instead of one overwriting the other. "Save backup" snapshots go to ventory_checkpoints.
import { CLOUD_READY, supabase } from "./cloud";

export type Kind = "piece" | "ad" | "mark" | "pref";
export type Rec = { uid: string; kind: Kind; id: string; data: Record<string, unknown>; updatedAt: string; deleted: boolean; dirty: boolean };
export type CheckRow = { id: string; label: string; createdAt: string; pending?: boolean };
type Meta = { cursor: string; checks: CheckRow[]; wipeChecksBefore: string; lastSync: string };

const DB = "ventory";
const STORE = "records";
const META = "meta";
const CPQ = "cpq"; // checkpoint payloads waiting to be uploaded

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: ["uid", "kind", "id"] }).createIndex("uid", "uid");
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        if (!d.objectStoreNames.contains(CPQ)) d.createObjectStore(CPQ, { keyPath: "id" }).createIndex("uid", "uid");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}
function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function ask<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let uid = "";
const mem = new Map<string, Rec>();
let meta: Meta = { cursor: "", checks: [], wipeChecksBefore: "", lastSync: "" };
const key = (kind: Kind, id: string) => `${kind}\u0001${id}`;
let lastStamp = 0;
function stamp() {
  // Strictly increasing on this device, so two edits in the same millisecond still order.
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export function currentUid() {
  return uid;
}

export async function openFloor(userId: string) {
  if (uid === userId && mem.size) return;
  uid = userId;
  mem.clear();
  const d = await db();
  const tx = d.transaction([STORE, META], "readonly");
  const rows = (await ask(tx.objectStore(STORE).index("uid").getAll(userId))) as Rec[];
  const m = (await ask(tx.objectStore(META).get(userId))) as Meta | undefined;
  for (const r of rows) mem.set(key(r.kind, r.id), r);
  meta = { cursor: "", checks: [], wipeChecksBefore: "", lastSync: "", ...(m ?? {}) };
  for (const r of rows) lastStamp = Math.max(lastStamp, Date.parse(r.updatedAt) || 0);
}

async function persist(recs: Rec[]) {
  if (!recs.length) return;
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const s = tx.objectStore(STORE);
  for (const r of recs) s.put(r);
  await done(tx);
}
async function persistMeta() {
  const d = await db();
  const tx = d.transaction(META, "readwrite");
  tx.objectStore(META).put(meta, uid);
  await done(tx);
}

export function list(kind: Kind): Rec[] {
  const out: Rec[] = [];
  for (const r of mem.values()) if (r.kind === kind && !r.deleted) out.push(r);
  return out;
}
export function get(kind: Kind, id: string): Rec | undefined {
  const r = mem.get(key(kind, id));
  return r && !r.deleted ? r : undefined;
}

/** Saves records on this device right away and queues them for the cloud. */
export async function write(items: { kind: Kind; id: string; data?: Record<string, unknown>; deleted?: boolean }[]) {
  const recs: Rec[] = items.map((it) => ({ uid, kind: it.kind, id: it.id, data: it.deleted ? {} : (it.data ?? {}), updatedAt: stamp(), deleted: Boolean(it.deleted), dirty: true }));
  for (const r of recs) mem.set(key(r.kind, r.id), r);
  await persist(recs);
  soon();
}

export function pendingCount() {
  let n = 0;
  for (const r of mem.values()) if (r.dirty) n++;
  return n + meta.checks.filter((c) => c.pending).length;
}
export function lastSynced() {
  return meta.lastSync;
}

/* ---------- checkpoints ("Save backup") ---------- */

export function checkpoints(): CheckRow[] {
  return [...meta.checks].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
}
export async function addCheckpoint(label: string, payload: unknown) {
  const row: CheckRow = { id: crypto.randomUUID(), label: label.slice(0, 80), createdAt: new Date().toISOString(), pending: true };
  const d = await db();
  const tx = d.transaction(CPQ, "readwrite");
  tx.objectStore(CPQ).put({ id: row.id, uid, label: row.label, createdAt: row.createdAt, payload });
  await done(tx);
  meta.checks = [row, ...meta.checks].slice(0, 40);
  await persistMeta();
  soon();
  return checkpoints();
}
export async function wipeCheckpoints() {
  const n = meta.checks.length;
  meta.checks = [];
  meta.wipeChecksBefore = new Date().toISOString();
  const d = await db();
  const tx = d.transaction(CPQ, "readwrite");
  const s = tx.objectStore(CPQ);
  const keys = (await ask(s.index("uid").getAllKeys(uid))) as IDBValidKey[];
  for (const k of keys) s.delete(k);
  await done(tx);
  await persistMeta();
  soon();
  return n;
}

/* ---------- sync ---------- */

let timer = 0;
let running: Promise<void> | null = null;
let again = false;
let syncError = "";
export function lastSyncError() {
  return syncError;
}
export function soon(ms = 1200) {
  if (!CLOUD_READY || typeof window === "undefined") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), ms);
}

function emit(name: string) {
  try {
    window.dispatchEvent(new Event(name));
  } catch {
    /* ignore */
  }
}

export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        try {
          await syncOnce();
          syncError = "";
        } catch (err) {
          syncError = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
          break;
        }
      } while (again);
    } finally {
      running = null;
      emit("ventory-sync");
    }
  })();
  return running;
}

const BATCH_BYTES = 1_500_000;
async function syncOnce() {
  if (!CLOUD_READY || !uid || uid === "local") return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const { data: s } = await supabase.auth.getSession();
  if (!s.session || s.session.user.id !== uid) return;
  const me = uid;

  // 1) push dirty records in batches
  const dirty = [...mem.values()].filter((r) => r.dirty);
  let batch: Rec[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const rows = batch.map((r) => ({ kind: r.kind, id: r.id, data: r.data, updated_at: r.updatedAt, deleted: r.deleted }));
    const { error } = await supabase.rpc("ventory_put", { p_rows: rows });
    if (error) throw error;
    const clean: Rec[] = [];
    for (const r of batch) {
      const now = mem.get(key(r.kind, r.id));
      // Only clear the flag if nothing changed it while it was on the way.
      if (now && now.updatedAt === r.updatedAt && uid === me) {
        now.dirty = false;
        clean.push(now);
      }
    }
    await persist(clean);
    batch = [];
    bytes = 0;
  };
  for (const r of dirty) {
    const size = JSON.stringify(r.data).length + 200;
    if (batch.length && (bytes + size > BATCH_BYTES || batch.length >= 150)) await flush();
    batch.push(r);
    bytes += size;
  }
  await flush();

  // 2) checkpoints: wipe asked offline, then upload the waiting ones
  if (meta.wipeChecksBefore) {
    const { error } = await supabase.from("ventory_checkpoints").delete().eq("user_id", me).lte("created_at", meta.wipeChecksBefore);
    if (!error) meta.wipeChecksBefore = "";
  }
  const d = await db();
  const waiting = (await ask(d.transaction(CPQ, "readonly").objectStore(CPQ).index("uid").getAll(me))) as { id: string; label: string; createdAt: string; payload: unknown }[];
  for (const w of waiting) {
    const { error } = await supabase.from("ventory_checkpoints").insert({ id: w.id, label: w.label, payload: w.payload, created_at: w.createdAt });
    if (error && !/duplicate key/i.test(error.message)) throw error;
    const tx = d.transaction(CPQ, "readwrite");
    tx.objectStore(CPQ).delete(w.id);
    await done(tx);
    meta.checks = meta.checks.map((c) => (c.id === w.id ? { ...c, pending: false } : c));
  }
  const { data: cps } = await supabase.from("ventory_checkpoints").select("id,label,created_at").order("created_at", { ascending: false }).limit(12);
  if (cps) {
    const pend = meta.checks.filter((c) => c.pending);
    meta.checks = [...pend, ...cps.map((c) => ({ id: String(c.id), label: String(c.label), createdAt: String(c.created_at) }))];
  }

  // 3) pull what changed since the last pull (two minutes of overlap: merging is idempotent)
  let cursor = meta.cursor ? new Date(Date.parse(meta.cursor) - 120_000).toISOString() : "1970-01-01T00:00:00Z";
  let changed = false;
  for (let page = 0; page < 400; page++) {
    const { data: rows, error } = await supabase
      .from("ventory_records")
      .select("kind,id,data,updated_at,deleted,synced_at")
      .gt("synced_at", cursor)
      .order("synced_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    if (!rows?.length) break;
    const take: Rec[] = [];
    for (const row of rows) {
      const k = key(row.kind as Kind, String(row.id));
      const local = mem.get(k);
      const remoteAt = Date.parse(String(row.updated_at));
      const localAt = local ? Date.parse(local.updatedAt) : -1;
      if (local && local.dirty && localAt >= remoteAt) continue; // ours is newer: it goes up next push
      if (local && !local.dirty && localAt === remoteAt && local.deleted === Boolean(row.deleted)) continue; // already here
      if (local && localAt > remoteAt) continue;
      const rec: Rec = { uid: me, kind: row.kind as Kind, id: String(row.id), data: (row.data ?? {}) as Record<string, unknown>, updatedAt: new Date(remoteAt).toISOString(), deleted: Boolean(row.deleted), dirty: false };
      mem.set(k, rec);
      take.push(rec);
      lastStamp = Math.max(lastStamp, remoteAt);
    }
    if (uid !== me) return;
    await persist(take);
    if (take.length) changed = true;
    cursor = String(rows[rows.length - 1].synced_at);
    meta.cursor = cursor;
    if (rows.length < 100) break;
  }
  meta.lastSync = new Date().toISOString();
  await persistMeta();
  if (changed) emit("ventory-remote");
}

/** Signing out: forget this account's floor on this device. */
export async function forgetDevice(userId: string) {
  const d = await db();
  const tx = d.transaction([STORE, META, CPQ], "readwrite");
  const s = tx.objectStore(STORE);
  for (const k of (await ask(s.index("uid").getAllKeys(userId))) as IDBValidKey[]) s.delete(k);
  const q = tx.objectStore(CPQ);
  for (const k of (await ask(q.index("uid").getAllKeys(userId))) as IDBValidKey[]) q.delete(k);
  tx.objectStore(META).delete(userId);
  await done(tx);
  if (uid === userId) {
    mem.clear();
    uid = "";
    meta = { cursor: "", checks: [], wipeChecksBefore: "", lastSync: "" };
  }
}

export function startAutoSync() {
  if (typeof window === "undefined" || !CLOUD_READY) return;
  window.addEventListener("online", () => soon(300));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") soon(300);
    else if (pendingCount()) void syncNow();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, 60_000);
}
