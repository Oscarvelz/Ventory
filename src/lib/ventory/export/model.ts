import type { Advice } from "../advisor";
import { missingOf } from "../advisor";
import { moveList, priceList, restockList, type MoveGroup, type PriceRow, type Restock } from "../insights";
import { measure, series, type Metrics, type Period } from "../metrics";
import { todayISO, type Ad, type Piece } from "../model";

/* What an export prints (1.1.0): one model for the PDF and the worksheet,
   so the two files always agree with each other and with Statistics. */

export type PeriodId = "all" | "year" | "12m" | "month" | "lastMonth";
export type SectionId = "trend" | "earns" | "stock" | "sales" | "sizes" | "advisor";

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "12m", label: "Last 12 months" },
  { id: "year", label: "This year" },
  { id: "month", label: "This month" },
  { id: "lastMonth", label: "Last month" },
];

export const SECTIONS: { id: SectionId; label: string; hint: string }[] = [
  { id: "trend", label: "Over time", hint: "Money in and left after cost, month by month" },
  { id: "earns", label: "What earns", hint: "Products, types and brands ranked by profit" },
  { id: "stock", label: "Stock and aging", hint: "What waits, what it cost, how long it has sat" },
  { id: "sales", label: "Sales", hint: "Every sale in the period, with its numbers" },
  { id: "sizes", label: "Sizes, sources and channels", hint: "What moves, where it came from, where it sold" },
  { id: "advisor", label: "Advisor", hint: "What to buy again, what to move, how to price" },
];

export type ExportOptions = { period: PeriodId; sections: SectionId[] };

export type Model = {
  title: string;
  periodLabel: string;
  from: string | null;
  to: string;
  generated: string;
  today: string;
  m: Metrics;
  months: Period[];
  advice: Advice;
  restock: Restock[];
  move: MoveGroup[];
  price: PriceRow[];
  pieces: Piece[];
  ads: Ad[];
  sections: SectionId[];
  ready: number;
  missing: { field: string; units: number }[];
  sample: boolean;
};

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayLong(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function dayShort(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function windowOf(period: PeriodId, today = todayISO()): { from: string | null; to: string; label: string } {
  const [y, m] = today.split("-").map(Number);
  if (period === "year") return { from: `${y}-01-01`, to: today, label: `${y} to date` };
  if (period === "12m") {
    const from = iso(new Date(y, m - 12, 1));
    return { from, to: today, label: `${dayShort(from)} – ${dayShort(today)}` };
  }
  if (period === "month") {
    const from = iso(new Date(y, m - 1, 1));
    return { from, to: today, label: new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  if (period === "lastMonth") {
    const from = iso(new Date(y, m - 2, 1));
    const to = iso(new Date(y, m - 1, 0));
    return { from, to, label: new Date(y, m - 2, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  return { from: null, to: today, label: "All time" };
}

export function buildModel(pieces: Piece[], ads: Ad[], advice: Advice, options: ExportOptions, today = todayISO()): Model {
  const w = windowOf(options.period, today);
  // All time counts every sale, the undated ones too (a window needs a date to place a sale in it).
  const m = measure(pieces, ads, w.from ? { from: w.from, to: w.to, today } : { today });
  const months = series(m.sales, "month", { today: w.to, from: w.from });
  const onHand = pieces.filter((piece) => piece.status === "available");
  const fields = new Map<string, number>();
  for (const piece of onHand) for (const field of missingOf(piece)) fields.set(field, (fields.get(field) ?? 0) + piece.qty);
  return {
    title: "Inventory and sales report",
    periodLabel: w.label,
    from: w.from,
    to: w.to,
    generated: `Made ${new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`,
    today,
    m,
    months,
    advice: { ...advice, headline: commas(advice.headline), actionBody: commas(advice.actionBody), plan: commas(advice.plan) },
    restock: restockList(pieces, today),
    move: moveList(pieces, today),
    price: priceList(pieces),
    pieces,
    ads,
    sections: SECTIONS.map((s) => s.id).filter((id) => options.sections.includes(id)),
    ready: onHand.filter((piece) => missingOf(piece).length === 0).reduce((sum, piece) => sum + piece.qty, 0),
    missing: [...fields.entries()].map(([field, units]) => ({ field, units })).sort((a, b) => b.units - a.units),
    sample: pieces.some((piece) => piece.id.startsWith("sample-")),
  };
}

export function fileBase(model: Model, period: PeriodId) {
  const span = period === "all" ? `all-time-${model.today}` : model.from ? `${model.from}_${model.to}` : model.to;
  return `Ventory_${model.sample ? "Sample_" : ""}${span}`;
}

/** The Advisor writes $3509.00; a printed report reads $3,509.00. */
export function commas(text: string) {
  return text.replace(/\$(\d{4,})(\.\d{2})?/g, (_, whole: string, cents = "") => `$${Number(whole).toLocaleString("en-US")}${cents}`);
}
