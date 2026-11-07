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
  discountCents: number;
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
    discountCents: 0,
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
