// Browser replacement for the Grok server functions in src/lib/ventory/server.ts (same names, same shapes), so
// house.tsx runs unchanged. Everything is read from and written to this device first (store.ts) and synced with
// Supabase in the background.
import { asPlace, asProblem, asStatus, asWorked, type Ad, type Piece, type PieceInput, type Status } from "@/lib/ventory/model";
import { convertToUs } from "@/lib/ventory/sizes";
import { asTheme } from "@/lib/ventory/themes";
import * as store from "./store";

type Mark = { category: string; subcategory: string; photo: string };
type Check = { id: string; label: string; createdAt: string };

function toPiece(id: string, raw: Record<string, unknown>): Piece {
  const r = raw as Partial<Piece>;
  return {
    id,
    name: String(r.name ?? ""),
    category: String(r.category ?? ""),
    subcategory: String(r.subcategory ?? ""),
    brand: String(r.brand ?? ""),
    status: asStatus(r.status),
    qty: Number(r.qty) || 1,
    sizeSystem: String(r.sizeSystem ?? ""),
    sizeLabel: String(r.sizeLabel ?? ""),
    usSize: String(r.usSize ?? ""),
    fit: String(r.fit ?? "women"),
    costCents: Number(r.costCents) || 0,
    askCents: Number(r.askCents) || 0,
    saleCents: r.saleCents == null ? null : Number(r.saleCents),
    discountCents: Number(r.discountCents) || 0,
    source: String(r.source ?? ""),
    channel: String(r.channel ?? ""),
    clientName: String(r.clientName ?? ""),
    receivedOn: r.receivedOn ? String(r.receivedOn) : null,
    soldOn: r.soldOn ? String(r.soldOn) : null,
    notes: String(r.notes ?? ""),
    place: asPlace(r.place),
    photo: String(r.photo ?? ""),
    problem: asProblem(r.problem),
    wasSold: Boolean(r.wasSold),
    sort: Number(r.sort) || 0,
  };
}

// Same rules as the Grok server's clean().
function clean(raw: PieceInput): PieceInput {
  return {
    ...raw,
    name: String(raw.name ?? "").slice(0, 160).trim(),
    category: String(raw.category ?? "").slice(0, 80).trim(),
    subcategory: String(raw.subcategory ?? "").slice(0, 80).trim(),
    brand: String(raw.brand ?? "").slice(0, 80),
    status: asStatus(raw.status),
    qty: Math.max(1, Math.min(999, Number(raw.qty) || 1)),
    sizeSystem: String(raw.sizeSystem ?? "").slice(0, 12),
    sizeLabel: String(raw.sizeLabel ?? "").slice(0, 24),
    usSize: String(raw.usSize ?? "").slice(0, 24),
    fit: raw.fit === "men" || raw.fit === "unisex" ? raw.fit : "women",
    costCents: Math.max(0, Math.round(Number(raw.costCents) || 0)),
    askCents: Math.max(0, Math.round(Number(raw.askCents) || 0)),
    saleCents: raw.saleCents == null ? null : Math.max(0, Math.round(Number(raw.saleCents) || 0)),
    discountCents: Math.max(0, Math.round(Number(raw.discountCents) || 0)),
    source: String(raw.source ?? "").slice(0, 80),
    channel: String(raw.channel ?? "").slice(0, 80),
    clientName: String(raw.clientName ?? "").slice(0, 120),
    receivedOn: raw.receivedOn || null,
    soldOn: raw.soldOn || null,
    notes: String(raw.notes ?? "").slice(0, 2000),
    place: asPlace(raw.place),
    photo: String(raw.photo ?? "").startsWith("data:image/") ? String(raw.photo).slice(0, 180_000) : "",
    problem: asProblem(raw.problem),
    wasSold: Boolean(raw.wasSold) || raw.status === "sold",
  };
}

function readPieces(): Piece[] {
  return store
    .list("piece")
    .map((r) => toPiece(r.id, r.data))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
function readMarks(): Mark[] {
  return store
    .list("mark")
    .map((r) => ({ category: String(r.data.category ?? ""), subcategory: String(r.data.subcategory ?? ""), photo: String(r.data.photo ?? "") }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory));
}
function readAds(): Ad[] {
  return store
    .list("ad")
    .map((r) => ({
      id: r.id,
      product: String(r.data.product ?? ""),
      spentCents: Number(r.data.spentCents) || 0,
      startedOn: r.data.startedOn ? String(r.data.startedOn) : null,
      endedOn: r.data.endedOn ? String(r.data.endedOn) : null,
      worked: asWorked(r.data.worked),
    }))
    .sort((a, b) => (b.startedOn ?? "").localeCompare(a.startedOn ?? "") || a.product.localeCompare(b.product));
}
function prefs() {
  const p = store.get("pref", "main")?.data ?? {};
  return { theme: asTheme(p.theme), adsOn: p.adsOn !== false };
}
function readChecks(): Check[] {
  return store.checkpoints().map((c) => ({ id: c.id, label: c.label, createdAt: c.createdAt }));
}
function pieceData(id: string, p: PieceInput, sort: number): Record<string, unknown> {
  const { id: _drop, ...rest } = { ...p, id };
  void _drop;
  return { ...rest, name: p.name || "Untitled", sort };
}
function nextSort() {
  return store.list("piece").reduce((m, r) => Math.max(m, Number(r.data.sort) || 0), 0) + 1;
}

export async function loadFloor() {
  const p = prefs();
  return { pieces: readPieces(), marks: readMarks(), ads: readAds(), theme: p.theme, adsOn: p.adsOn, checkpoints: readChecks() };
}

export async function saveMark({ data: raw }: { data: { category: string; subcategory: string; photo: string } }) {
  const category = String(raw.category ?? "").trim().slice(0, 80);
  const subcategory = String(raw.subcategory ?? "").trim().slice(0, 80);
  const photo = String(raw.photo ?? "").startsWith("data:image/") ? String(raw.photo).slice(0, 180_000) : "";
  if (category && subcategory) await store.write([{ kind: "mark", id: `${category}|${subcategory}`, data: { category, subcategory, photo } }]);
  return readMarks();
}

export async function saveAd({ data: raw }: { data: { id?: string; product: string; spentCents: number; startedOn: string | null; endedOn: string | null; worked: string } }) {
  const product = String(raw.product ?? "").trim().slice(0, 160);
  if (!product) return readAds();
  const id = raw.id ? String(raw.id).slice(0, 80) : crypto.randomUUID();
  await store.write([{ kind: "ad", id, data: { product, spentCents: Math.max(0, Math.round(Number(raw.spentCents) || 0)), startedOn: raw.startedOn || null, endedOn: raw.endedOn || null, worked: asWorked(raw.worked) } }]);
  return readAds();
}

export async function deleteAd({ data: id }: { data: string }) {
  if (store.get("ad", String(id))) await store.write([{ kind: "ad", id: String(id), deleted: true }]);
  return readAds();
}

async function upsert(input: PieceInput) {
  const id = input.id && input.id.length < 80 ? input.id : crypto.randomUUID();
  const existing = store.get("piece", id);
  const sort = existing ? Number(existing.data.sort) || 0 : nextSort();
  await store.write([{ kind: "piece", id, data: pieceData(id, input, sort) }]);
  return id;
}

export async function savePiece({ data }: { data: PieceInput }) {
  const id = await upsert(clean(data));
  return readPieces().find((piece) => piece.id === id) ?? null;
}

export async function setStatus({ data }: { data: { id: string; status: Status; saleCents?: number | null; soldOn?: string | null; clientName?: string; channel?: string; discountCents?: number } }) {
  const cur = store.get("piece", data.id);
  if (cur) {
    const p = toPiece(data.id, cur.data);
    const status = asStatus(data.status);
    const next: Piece = {
      ...p,
      status,
      saleCents: status === "sold" ? (data.saleCents ?? null) : status === "archived" ? p.saleCents : null,
      soldOn: status === "sold" ? (data.soldOn ?? null) : status === "archived" ? p.soldOn : null,
      wasSold: status === "sold" ? true : status === "archived" ? p.wasSold || p.status === "sold" : p.wasSold,
      clientName: data.clientName ?? "",
      channel: data.channel ?? "",
      discountCents: Math.max(0, Number(data.discountCents) || 0),
    };
    await store.write([{ kind: "piece", id: p.id, data: pieceData(p.id, next, p.sort) }]);
  }
  return readPieces();
}

export async function deletePiece({ data: id }: { data: string }) {
  if (store.get("piece", id)) await store.write([{ kind: "piece", id, deleted: true }]);
  return readPieces();
}

const CLEARABLE = ["incoming", "available", "sold", "archived", "kept"] as const;

export async function clearSelected({ data: raw }: { data: unknown }) {
  const body = raw && typeof raw === "object" ? (raw as { statuses?: unknown; ads?: unknown; backups?: unknown }) : {};
  const asked = Array.isArray(body.statuses) ? body.statuses.map((item) => String(item)) : [];
  const statuses = CLEARABLE.filter((status) => asked.includes(status));
  const gone = store.list("piece").filter((r) => (statuses as readonly string[]).includes(asStatus(r.data.status)));
  const adsGone = body.ads === true ? store.list("ad") : [];
  await store.write([...gone.map((r) => ({ kind: "piece" as const, id: r.id, deleted: true })), ...adsGone.map((r) => ({ kind: "ad" as const, id: r.id, deleted: true }))]);
  const removedBackups = body.backups === true ? await store.wipeCheckpoints() : 0;
  return { pieces: readPieces(), ads: readAds(), checkpoints: readChecks(), removedPieces: gone.length, removedAds: adsGone.length, removedBackups };
}

export async function saveTheme({ data }: { data: string }) {
  const theme = asTheme(data);
  await store.write([{ kind: "pref", id: "main", data: { ...prefs(), theme } }]);
  return theme;
}

export async function saveAds({ data }: { data: boolean }) {
  const on = data !== false;
  await store.write([{ kind: "pref", id: "main", data: { ...prefs(), adsOn: on } }]);
  return on;
}

export async function importPieces({ data: raw }: { data: PieceInput[] }) {
  const rows = (Array.isArray(raw) ? raw.slice(0, 400).map(clean) : []).filter((p) => p.name);
  let sort = nextSort();
  await store.write(rows.map((p) => {
    const id = crypto.randomUUID();
    return { kind: "piece" as const, id, data: pieceData(id, p, sort++) };
  }));
  return readPieces();
}

/**
 * Restore: the Grok app's backup ({ app: "ventory", pieces }) or this app's fuller one (also ads and subcategory marks).
 * The floor as it was is kept first as a saved backup, so a restore can always be walked back.
 */
export async function replaceFloor({ data: raw }: { data: unknown }) {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { pieces?: unknown }).pieces)) {
    throw new Error("That file is not a Ventory backup.");
  }
  const body = raw as { pieces: PieceInput[]; ads?: unknown; marks?: unknown };
  const incoming = body.pieces.slice(0, 2000).map(clean);
  const before = readPieces();
  if (before.length) await store.addCheckpoint(`Before restore ${new Date().toISOString().slice(0, 10)}`, { pieces: before, ads: readAds(), marks: readMarks() });
  const items: { kind: "piece" | "ad" | "mark"; id: string; data?: Record<string, unknown>; deleted?: boolean }[] = before.map((p) => ({ kind: "piece", id: p.id, deleted: true }));
  let sort = 1;
  for (const p of incoming) {
    const id = crypto.randomUUID();
    items.push({ kind: "piece", id, data: pieceData(id, p, sort++) });
  }
  if (Array.isArray(body.ads)) {
    const known = new Set(readAds().map((a) => a.id));
    for (const a of body.ads.slice(0, 2000) as Partial<Ad>[]) {
      const product = String(a?.product ?? "").trim().slice(0, 160);
      if (!product) continue;
      const id = a.id && String(a.id).length < 80 && !known.has(String(a.id)) ? String(a.id) : crypto.randomUUID();
      items.push({ kind: "ad", id, data: { product, spentCents: Math.max(0, Math.round(Number(a.spentCents) || 0)), startedOn: a.startedOn || null, endedOn: a.endedOn || null, worked: asWorked(a.worked) } });
    }
  }
  if (Array.isArray(body.marks)) {
    for (const m of body.marks.slice(0, 2000) as Partial<Mark>[]) {
      const category = String(m?.category ?? "").trim().slice(0, 80);
      const subcategory = String(m?.subcategory ?? "").trim().slice(0, 80);
      const photo = String(m?.photo ?? "").startsWith("data:image/") ? String(m.photo).slice(0, 180_000) : "";
      if (category && subcategory) items.push({ kind: "mark", id: `${category}|${subcategory}`, data: { category, subcategory, photo } });
    }
  }
  await store.write(items);
  window.setTimeout(() => window.dispatchEvent(new Event("ventory-remote")), 0);
  return readPieces();
}

export async function createCheckpoint({ data }: { data: string }) {
  await store.addCheckpoint(String(data || "Backup").slice(0, 80), { pieces: readPieces(), ads: readAds(), marks: readMarks() });
  return readChecks();
}

function emptySample(name: string, category: string, subcategory: string, status: Status, sizeSystem: string, sizeLabel: string, fit: string, costCents: number, askCents: number, source: string): PieceInput {
  return { name, category, subcategory, brand: "", status, qty: 1, sizeSystem, sizeLabel, usSize: "", fit, costCents, askCents, saleCents: null, discountCents: 0, source, channel: "", clientName: "", receivedOn: new Date().toISOString().slice(0, 10), soldOn: null, notes: "", place: "", photo: "", problem: "", wasSold: false };
}
const SAMPLES: PieceInput[] = [
  emptySample("Chelsea boot", "Boot", "Chelsea", "available", "CN", "37", "women", 2800, 7500, "Shein"),
  emptySample("Combat boot", "Boot", "Combat", "available", "CN", "42", "men", 3500, 9000, "Temu"),
  emptySample("Seiko 5", "Watch", "", "available", "", "", "unisex", 8000, 16000, "eBay"),
  emptySample("Square-toe boot", "Boot", "Square-toe", "incoming", "CN", "40", "women", 3200, 8500, "AliExpress"),
];

export async function addSamples() {
  for (const sample of SAMPLES) {
    const us = sample.sizeLabel ? convertToUs(sample.sizeSystem, sample.sizeLabel, sample.fit) : null;
    await upsert({ ...sample, usSize: us ?? "" });
  }
  return readPieces();
}
