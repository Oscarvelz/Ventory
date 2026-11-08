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

/* ---------- the sample floor (1.0.7) ----------
   A complete example business, built backwards from every surface that has
   to speak: the four chips, the shelf in every size, History's sales board,
   every Statistics fold, and the Advisor's full hand of cards. Every date is
   computed from the day the floor is loaded (days ago / days ahead), so the
   week, month and year boards and the aging ladder read the same whenever
   it is loaded. Samples are TAGGED by their ids ("sample-…"): loading writes
   only those ids, and removeSamples tombstones exactly those ids, so a real
   record is never modified, shadowed or removed by either action. Loading
   twice refreshes the same records instead of duplicating them.
   1.0.9: the control lives in Settings (its own "Sample floor" fold, always
   present, showing its state) — the button on Main only appears on an empty
   shelf, which trapped anyone who had already loaded the first, untagged
   sample: their four pieces kept the shelf non-empty, so the button, and
   with it the complete set, became unreachable. */

export const SAMPLE_PREFIX = "sample-";

export function isSampleId(id: string) {
  return id.startsWith(SAMPLE_PREFIX);
}

/* ---------- the FIRST sample floor (before 1.0.7) ----------
   The original loader wrote four bare pieces with NO id at all, so each one
   got a random UUID and became indistinguishable from a real piece: the
   tagged-sample controls cannot see them, and while they sit on the shelf
   the "Load a sample floor" button on Main never appears (it only shows on
   an empty shelf). They are recognised here by their exact fingerprint —
   every field the old loader set, plus every field it left empty. A piece
   the owner has since edited no longer matches and is left alone: it has
   become theirs. A piece carrying a "sample-…" id is never legacy. */
const LEGACY_SAMPLES = [
  { name: "Chelsea boot", category: "Boot", subcategory: "Chelsea", status: "available", sizeSystem: "CN", sizeLabel: "37", fit: "women", costCents: 2800, askCents: 7500, source: "Shein" },
  { name: "Combat boot", category: "Boot", subcategory: "Combat", status: "available", sizeSystem: "CN", sizeLabel: "42", fit: "men", costCents: 3500, askCents: 9000, source: "Temu" },
  { name: "Seiko 5", category: "Watch", subcategory: "", status: "available", sizeSystem: "", sizeLabel: "", fit: "unisex", costCents: 8000, askCents: 16000, source: "eBay" },
  { name: "Square-toe boot", category: "Boot", subcategory: "Square-toe", status: "incoming", sizeSystem: "CN", sizeLabel: "40", fit: "women", costCents: 3200, askCents: 8500, source: "AliExpress" },
] as const;

export function isLegacySample(piece: Piece): boolean {
  if (isSampleId(piece.id)) return false;
  if (piece.brand !== "" || piece.qty !== 1 || piece.saleCents != null || piece.discountCents !== 0 || piece.channel !== "" || piece.clientName !== "" || piece.wasSold || piece.problem !== "" || piece.notes !== "" || piece.photo !== "" || piece.soldOn != null) return false;
  return LEGACY_SAMPLES.some((s) =>
    piece.name === s.name && piece.category === s.category && piece.subcategory === s.subcategory &&
    piece.status === s.status && piece.sizeSystem === s.sizeSystem && piece.sizeLabel === s.sizeLabel &&
    piece.fit === s.fit && piece.costCents === s.costCents && piece.askCents === s.askCents && piece.source === s.source);
}

function legacySampleRecords() {
  return store.list("piece").filter((r) => isLegacySample(toPiece(r.id, r.data as Record<string, unknown>)));
}

function isoInDays(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function samplePhoto(initials: string, bg: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' rx='18' fill='${bg}'/><text x='48' y='61' font-family='Georgia, serif' font-size='30' fill='#f3f0e8' text-anchor='middle'>${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function sized(system: string, label: string, fit: string) {
  return { sizeSystem: system, sizeLabel: label, usSize: convertToUs(system, label, fit) ?? "" };
}

function samplePiece(id: string, fields: Partial<PieceInput> & { name: string }): PieceInput {
  return {
    id: `${SAMPLE_PREFIX}${id}`,
    category: "Boot",
    subcategory: "",
    brand: "",
    status: "available",
    qty: 1,
    sizeSystem: "",
    sizeLabel: "",
    usSize: "",
    fit: "women",
    costCents: 0,
    askCents: 0,
    saleCents: null,
    discountCents: 0,
    source: "",
    channel: "",
    clientName: "",
    receivedOn: null,
    soldOn: null,
    notes: "",
    place: "home",
    photo: "",
    problem: "",
    wasSold: false,
    ...fields,
  };
}

export function buildSamples(): { pieces: PieceInput[]; ads: { id: string; product: string; spentCents: number; startedOn: string | null; endedOn: string | null; worked: Ad["worked"] }[] } {
  const pieces: PieceInput[] = [
    /* On hand — the shelf itself, in every state of readiness. The priciest
       piece has no size, so the Advisor's first action is "Add size"; the
       oldest has sat 52 days, inside the ladder's 31–60 rung, so its named
       10% cut and what stays after cost are spoken out loud. */
    samplePiece("01", { name: "Rancher boot", subcategory: "Ranch", brand: "Nocona", fit: "men", costCents: 6800, askCents: 14500, source: "eBay", receivedOn: isoInDays(-20), photo: samplePhoto("RB", "#7a4a2b") }),
    samplePiece("02", { name: "Chelsea boot", subcategory: "Chelsea", brand: "Marc Fisher", costCents: 3400, askCents: 8900, ...sized("CN", "38", "women"), source: "AliExpress", receivedOn: isoInDays(-52), photo: samplePhoto("CB", "#4a5d7a") }),
    samplePiece("03", { name: "Combat boot", subcategory: "Combat", brand: "Timberland", fit: "men", costCents: 5200, askCents: 12800, ...sized("CN", "43", "men"), source: "Temu", place: "car", receivedOn: isoInDays(-38), photo: samplePhoto("CB", "#5d6b4a") }),
    samplePiece("04", { name: "Square-toe boot", subcategory: "Square-toe", brand: "Justin", costCents: 4600, askCents: 9900, ...sized("CN", "40", "women"), source: "eBay", receivedOn: isoInDays(-26), photo: samplePhoto("SB", "#8a6a3b") }),
    samplePiece("05", { name: "Seiko 5", category: "Watch", brand: "Seiko", fit: "unisex", costCents: 5900, askCents: 13900, source: "eBay", receivedOn: isoInDays(-15), photo: samplePhoto("S5", "#3b4a5d") }),
    samplePiece("06", { name: "Hiking boot", subcategory: "Hiking", brand: "Merrell", fit: "men", costCents: 4800, askCents: 11200, ...sized("CN", "44", "men"), source: "Amazon", receivedOn: isoInDays(-8), problem: "unsure", photo: samplePhoto("HB", "#6b4a3b") }),
    samplePiece("07", { name: "Ankle boot", subcategory: "Ankle", brand: "Sam Edelman", costCents: 3900, askCents: 9200, ...sized("CN", "37", "women"), source: "Shein", receivedOn: isoInDays(-5), photo: samplePhoto("AB", "#7a3b4a") }),
    samplePiece("08", { name: "Casio G-Shock", category: "Watch", brand: "Casio", fit: "unisex", costCents: 4500, askCents: 9800, source: "AliExpress", receivedOn: isoInDays(-12) }),
    samplePiece("09", { name: "Work boot", subcategory: "Work", brand: "CAT", fit: "men", costCents: 5600, askCents: 12400, ...sized("CN", "42", "men"), source: "Temu", receivedOn: isoInDays(-33), photo: samplePhoto("WB", "#4a4a4a") }),
    samplePiece("10", { name: "Fossil Grant", category: "Watch", brand: "Fossil", fit: "unisex", qty: 2, costCents: 5100, askCents: 11900, source: "eBay", receivedOn: isoInDays(-3), photo: samplePhoto("FG", "#5d3b6b") }),
    samplePiece("11", { name: "Penny loafer", category: "Loafer", subcategory: "Penny", brand: "Cole Haan", costCents: 4200, askCents: 3900, ...sized("CN", "39", "women"), source: "Shein", receivedOn: isoInDays(-18), notes: "Priced under cost by mistake — the Advisor should catch this.", photo: samplePhoto("PL", "#6b5a3b") }),
    samplePiece("12", { name: "Rain boot", subcategory: "Rain", brand: "Hunter", costCents: 3000, askCents: 7400, ...sized("CN", "36", "women"), source: "AliExpress", receivedOn: isoInDays(-1), photo: samplePhoto("RB", "#3b6b5a") }),

    /* Incoming — one fresh, one expected, one 36 days late, one with no date
       at all, so the Advisor's "Has it arrived?" card has both its lines. */
    samplePiece("13", { name: "Western boot", subcategory: "Western", brand: "Ariat", status: "incoming", costCents: 6100, askCents: 13800, ...sized("CN", "39", "women"), source: "eBay", receivedOn: isoInDays(-2), photo: samplePhoto("WB", "#8a5a2b") }),
    samplePiece("14", { name: "Steel-toe boot", subcategory: "Steel-toe", brand: "Wolverine", fit: "men", status: "incoming", costCents: 5400, askCents: 12100, ...sized("CN", "43", "men"), source: "Amazon", place: "", receivedOn: isoInDays(-36), problem: "late", photo: samplePhoto("ST", "#555f6b") }),
    samplePiece("15", { name: "Timex Weekender", category: "Watch", brand: "Timex", fit: "unisex", status: "incoming", costCents: 2600, askCents: 5900, source: "AliExpress", receivedOn: null, photo: samplePhoto("TW", "#6b3b3b") }),
    samplePiece("16", { name: "Knee-high boot", subcategory: "Knee-high", brand: "Frye", status: "incoming", costCents: 6400, askCents: 14900, ...sized("CN", "38", "women"), source: "eBay", receivedOn: isoInDays(-6), photo: samplePhoto("KB", "#4a3b2b") }),

    /* Sold — a coherent sales history: this week, this month, last month and
       earlier this year, across channels, with discounts, one sale with no
       date and one with no price, so every Statistics fold has its story. */
    samplePiece("17", { name: "Chelsea boot", subcategory: "Chelsea", brand: "Marc Fisher", status: "sold", wasSold: true, costCents: 3300, askCents: 8900, saleCents: 8400, ...sized("CN", "38", "women"), source: "AliExpress", channel: "Facebook Marketplace", clientName: "Marisol G.", receivedOn: isoInDays(-30), soldOn: isoInDays(-1), photo: samplePhoto("CB", "#4a5d7a") }),
    samplePiece("18", { name: "Chelsea boot", subcategory: "Chelsea", brand: "Marc Fisher", status: "sold", wasSold: true, costCents: 3100, askCents: 8200, saleCents: 7900, ...sized("CN", "37", "women"), source: "AliExpress", channel: "eBay", clientName: "Dana R.", receivedOn: isoInDays(-70), soldOn: isoInDays(-40), photo: samplePhoto("CB", "#4a5d7a") }),
    samplePiece("19", { name: "Combat boot", subcategory: "Combat", brand: "Timberland", fit: "men", status: "sold", wasSold: true, costCents: 5000, askCents: 12800, saleCents: 11900, discountCents: 500, ...sized("CN", "42", "men"), source: "Temu", channel: "Facebook Marketplace", clientName: "Jose M.", receivedOn: isoInDays(-55), soldOn: isoInDays(-9), photo: samplePhoto("CB", "#5d6b4a") }),
    samplePiece("20", { name: "Seiko 5", category: "Watch", brand: "Seiko", fit: "unisex", status: "sold", wasSold: true, costCents: 7800, askCents: 15900, saleCents: 15400, source: "eBay", channel: "eBay", clientName: "Priya S.", receivedOn: isoInDays(-120), soldOn: isoInDays(-80), photo: samplePhoto("S5", "#3b4a5d") }),
    samplePiece("21", { name: "Square-toe boot", subcategory: "Square-toe", brand: "Justin", status: "sold", wasSold: true, qty: 2, costCents: 4400, askCents: 9900, saleCents: 9600, ...sized("CN", "40", "women"), source: "eBay", channel: "In person", clientName: "Carla T.", receivedOn: isoInDays(-95), soldOn: isoInDays(-45), photo: samplePhoto("SB", "#8a6a3b") }),
    samplePiece("22", { name: "Ankle boot", subcategory: "Ankle", brand: "Sam Edelman", status: "sold", wasSold: true, costCents: 3600, askCents: 9200, saleCents: 8800, discountCents: 300, ...sized("CN", "37", "women"), source: "Shein", channel: "Instagram", clientName: "Bea L.", receivedOn: isoInDays(-25), soldOn: isoInDays(-3), photo: samplePhoto("AB", "#7a3b4a") }),
    samplePiece("23", { name: "Casio Vintage", category: "Watch", brand: "Casio", fit: "unisex", status: "sold", wasSold: true, costCents: 1900, askCents: 4500, saleCents: 4200, source: "AliExpress", channel: "Facebook Marketplace", receivedOn: isoInDays(-60), soldOn: null, photo: samplePhoto("CV", "#6b6b3b") }),
    samplePiece("24", { name: "Rain boot", subcategory: "Rain", brand: "Hunter", status: "sold", wasSold: true, costCents: 2800, askCents: 7400, saleCents: null, ...sized("CN", "36", "women"), source: "Shein", channel: "In person", receivedOn: isoInDays(-50), soldOn: isoInDays(-20), photo: samplePhoto("RB", "#3b6b5a") }),
    samplePiece("25", { name: "Hiking boot", subcategory: "Hiking", brand: "Merrell", fit: "men", status: "sold", wasSold: true, costCents: 4700, askCents: 11200, saleCents: 10900, ...sized("CN", "44", "men"), source: "Amazon", channel: "eBay", clientName: "Tom W.", receivedOn: isoInDays(-210), soldOn: isoInDays(-160), photo: samplePhoto("HB", "#6b4a3b") }),

    /* Archive and kept — a gifted piece and a damaged one (the Advisor reads
       their "Removed:" reasons as lessons and unrecovered cost), a sale that
       was later archived, and a pair the seller kept on purpose. */
    samplePiece("26", { name: "Strappy heel", category: "Heel", subcategory: "Strappy", brand: "Nine West", status: "archived", costCents: 2400, askCents: 5600, ...sized("CN", "37", "women"), source: "Shein", receivedOn: isoInDays(-80), notes: "Removed: Gifted", photo: samplePhoto("SH", "#8a3b5a") }),
    samplePiece("27", { name: "Moto boot", subcategory: "Moto", brand: "Frye", fit: "men", status: "archived", costCents: 5800, askCents: 13200, ...sized("CN", "43", "men"), source: "eBay", receivedOn: isoInDays(-100), notes: "Removed: Damaged", photo: samplePhoto("MB", "#3b3b4a") }),
    samplePiece("28", { name: "Driving loafer", category: "Loafer", subcategory: "Driving", brand: "Cole Haan", fit: "men", status: "archived", wasSold: true, costCents: 4100, askCents: 9200, saleCents: 8900, ...sized("CN", "42", "men"), source: "Amazon", channel: "eBay", clientName: "Sam K.", receivedOn: isoInDays(-150), soldOn: isoInDays(-110), photo: samplePhoto("DL", "#5a4a6b") }),
    samplePiece("29", { name: "Engineer boot", subcategory: "Engineer", brand: "Red Wing", fit: "men", status: "kept", costCents: 8900, askCents: 0, ...sized("CN", "43", "men"), source: "eBay", receivedOn: isoInDays(-140), notes: "My own pair — not for sale.", photo: samplePhoto("EB", "#6b2b2b") }),
  ];

  /* Ads matched to pieces by product name, the way the engine reads them:
     one that worked on a sold watch, one that did not on a sold boot, and
     one still running on the piece the Advisor sends you to first. */
  const ads = [
    { id: `${SAMPLE_PREFIX}ad-1`, product: "Seiko 5", spentCents: 900, startedOn: isoInDays(-100), endedOn: isoInDays(-85), worked: "yes" as const },
    { id: `${SAMPLE_PREFIX}ad-2`, product: "Combat boot", spentCents: 700, startedOn: isoInDays(-50), endedOn: isoInDays(-30), worked: "no" as const },
    { id: `${SAMPLE_PREFIX}ad-3`, product: "Rancher boot", spentCents: 400, startedOn: isoInDays(-6), endedOn: null, worked: "running" as const },
  ];

  return { pieces, ads };
}

export function sampleSetSize() {
  const s = buildSamples();
  return { pieces: s.pieces.length, ads: s.ads.length };
}

export async function addSamples() {
  /* Turning the sample floor on also retires the untagged first sample:
     those four pieces are replaced by the complete set, never duplicated
     alongside it. */
  const legacy = legacySampleRecords();
  if (legacy.length) {
    await store.write(legacy.map((r) => ({ kind: "piece" as const, id: r.id, deleted: true })));
  }
  const { pieces, ads } = buildSamples();
  for (const piece of pieces) await upsert(piece);
  for (const ad of ads) {
    await store.write([{ kind: "ad", id: ad.id, data: { product: ad.product, spentCents: ad.spentCents, startedOn: ad.startedOn, endedOn: ad.endedOn, worked: ad.worked } }]);
  }
  return { pieces: readPieces(), ads: readAds() };
}

/** Takes the sample floor back out — the sample-tagged records, plus any
    untagged pieces still matching the first sample's exact fingerprint, and
    nothing else. Real pieces and ads keep their ids, their sort and their
    data, so the floor is precisely what it was before the samples loaded. */
export async function removeSamples() {
  const pieces = store.list("piece").filter((r) => isSampleId(r.id));
  const legacy = legacySampleRecords();
  const ads = store.list("ad").filter((r) => isSampleId(r.id));
  await store.write([
    ...pieces.map((r) => ({ kind: "piece" as const, id: r.id, deleted: true })),
    ...legacy.map((r) => ({ kind: "piece" as const, id: r.id, deleted: true })),
    ...ads.map((r) => ({ kind: "ad" as const, id: r.id, deleted: true })),
  ]);
  return { pieces: readPieces(), ads: readAds(), removedPieces: pieces.length + legacy.length, removedAds: ads.length };
}
