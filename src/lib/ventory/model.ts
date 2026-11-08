export const STATUSES = ["incoming", "available", "sold", "archived"] as const;
export type Status = (typeof STATUSES)[number] | "kept";

export const STATUS_LABEL: Record<Status, string> = {
  incoming: "Incoming",
  available: "Available",
  sold: "Sold",
  archived: "Archive",
  kept: "Kept",
};

export type Piece = {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  status: Status;
  qty: number;
  sizeSystem: string;
  sizeLabel: string;
  usSize: string;
  fit: string;
  costCents: number;
  askCents: number;
  saleCents: number | null;
  /** Money back on the PURCHASE (wholesale rebate / supplier credit). It lowers what the piece
   *  effectively cost; it is never a cut on the selling price. (Was `discountCents` before 1.0.16:
   *  the old field mixed both meanings, so "discounts" raised profit in some sums and lowered it in
   *  others. Old records are migrated on read — see toPiece/clean in src/spa/api.ts.) */
  buyRebateCents: number;
  /** Delivery charged to the client on top of the price. It is collected in the operation, but it is
   *  not part of the piece's price and never enters the piece's profit. Client overpay rides here too. */
  deliveryCents: number;
  source: string;
  channel: string;
  clientName: string;
  receivedOn: string | null;
  soldOn: string | null;
  notes: string;
  place: string;
  photo: string;
  problem: string;
  wasSold: boolean;
  sort: number;
};

export type PieceInput = Omit<Piece, "id" | "sort"> & { id?: string };

/** What a piece effectively cost after the purchase rebate came back. Never below zero. */
export function effectiveCostCents(piece: { costCents: number; buyRebateCents: number }) {
  return Math.max(0, piece.costCents - piece.buyRebateCents);
}

/**
 * The price cut is DERIVED, never stored: what was asked minus what was actually charged.
 * Zero when the ask is unknown (a cut cannot be derived from a missing ask).
 */
export function priceCutCents(piece: { askCents: number; saleCents: number | null }) {
  if (piece.saleCents == null || piece.askCents <= 0) return 0;
  return Math.max(0, piece.askCents - piece.saleCents);
}

/** Per-unit profit in cents, or null when the piece has no sale price yet. */
export function unitProfitCents(piece: Piece): number | null {
  if (piece.saleCents == null) return null;
  return piece.saleCents - effectiveCostCents(piece);
}

/**
 * THE profit function (1.0.16). Every surface that talks about profit uses this one:
 * revenue is the price charged for the piece (delivery is NOT revenue of the piece),
 * cost is the effective cost (sticker cost minus the purchase rebate), and `collected`
 * is everything that actually came in on the operation, delivery included.
 */
export function profitOf(piece: Piece) {
  const unit = unitProfitCents(piece);
  if (unit == null || piece.saleCents == null) return null;
  const revenue = piece.saleCents * piece.qty;
  const cost = effectiveCostCents(piece) * piece.qty;
  return { revenue, cost, profit: unit * piece.qty, collected: revenue + (piece.deliveryCents || 0) * piece.qty };
}

export function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function dollarsToCents(value: string) {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function daysHeld(received: string | null, sold: string | null, today = todayISO()) {
  if (!received) return null;
  const start = Date.parse(received);
  const end = Date.parse(sold || today);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

export function emptyInput(): PieceInput {
  return {
    name: "",
    category: "Boot",
    subcategory: "",
    brand: "",
    status: "available",
    qty: 1,
    sizeSystem: "CN",
    sizeLabel: "",
    usSize: "",
    fit: "women",
    costCents: 0,
    askCents: 0,
    saleCents: null,
    buyRebateCents: 0,
    deliveryCents: 0,
    source: "",
    channel: "",
    clientName: "",
    receivedOn: todayISO(),
    soldOn: null,
    notes: "",
    place: "",
    photo: "",
    problem: "",
    wasSold: false,
  };
}

export const PROBLEMS = [
  { id: "missing", label: "Can't find it" },
  { id: "unknown", label: "Don't know where it is" },
  { id: "late", label: "Hasn't arrived" },
  { id: "lost", label: "Lost" },
  { id: "unsure", label: "Not sure" },
] as const;

export function asProblem(value: unknown) {
  return PROBLEMS.some((item) => item.id === value) ? String(value) : "";
}

export function asPlace(value: unknown): "" | "home" | "car" {
  return value === "home" || value === "car" ? value : "";
}

export type Ad = {
  id: string;
  product: string;
  spentCents: number;
  startedOn: string | null;
  endedOn: string | null;
  worked: "yes" | "no" | "running";
};

export function asWorked(value: unknown): Ad["worked"] {
  return value === "yes" || value === "no" || value === "running" ? value : "running";
}

export function asStatus(value: unknown): Status {
  if (value === "kept") return "kept";
  return STATUSES.includes(value as (typeof STATUSES)[number]) ? (value as Status) : "available";
}
