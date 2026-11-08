import { daysHeld, effectiveCostCents, priceCutCents, profitOf, todayISO, type Ad, type Piece } from "./model";

/* One reading of the floor (1.1.0), shared by Statistics, the Advisor's
   visuals, the PDF report and the worksheet, so every surface tells the same
   numbers. The money rules are the house's own (unchanged since 1.0):
   - a sale is a piece marked sold, or archived after it sold (wasSold);
   - revenue counts priced sales only (sale price × qty); a sale with no
     price is counted as a sale and named as unpriced, never guessed;
   - the cost of a sale is its effective cost: cost less the buying rebate
     (model.effectiveCostCents, 1.0.16), never below zero; profit = revenue −
     that cost (model.profitOf; delivery is outside price and profit; ads apart);
   - the price cut is derived (ask − charged, model.priceCutCents), never stored;
   - stock is what is on hand plus what is on the way; kept and removed
     pieces are neither stock nor sales. */

export type Grain = "week" | "month" | "year";

export type Group = {
  label: string;
  soldUnits: number;
  pricedUnits: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  avgSale: number | null;
  stockUnits: number;
  stockCost: number;
  avgDays: number | null;
  sellThrough: number | null;
};

export type Period = { key: string; label: string; short: string; revenue: number; profit: number; units: number };

export type AgeBucket = { id: string; label: string; min: number; max: number; units: number; cost: number; tone: string };

export type Aged = { piece: Piece; days: number };

export type Metrics = {
  asOf: string;
  units: { onHand: number; incoming: number; sold: number; priced: number; unpriced: number; archived: number; kept: number; removed: number; problems: number };
  revenue: number;
  costOfSales: number;
  profit: number;
  margin: number | null;
  avgSale: number | null;
  avgProfit: number | null;
  priceCuts: number;
  rebates: number;
  delivery: number;
  stockCost: number;
  onHandCost: number;
  incomingCost: number;
  stockAsk: number;
  stockAskCost: number;
  unaskedUnits: number;
  sellThrough: number | null;
  days: { n: number; avg: number | null; median: number | null; fastest: number | null; slowest: number | null; buckets: { label: string; units: number }[] };
  aging: { buckets: AgeBucket[]; undated: number; oldest: Aged[]; avg: number | null };
  adSpend: number;
  datedSales: number;
  undatedSales: number;
  firstSale: string | null;
  lastSale: string | null;
  byCategory: Group[];
  byProduct: Group[];
  byBrand: Group[];
  bySize: Group[];
  bySource: Group[];
  byChannel: Group[];
  byClient: Group[];
  sales: Piece[];
  stock: Piece[];
};

export const TONES = {
  green: "#5f8f72",
  amber: "#b08a3e",
  red: "#a33b32",
  blue: "#5d86ad",
  copper: "#c47b4a",
  teal: "#4f7f8a",
  plum: "#7d5a86",
};

export function isSale(piece: Piece) {
  return piece.status === "sold" || piece.wasSold;
}

export function isStock(piece: Piece) {
  return piece.status === "available" || piece.status === "incoming";
}

export function netCost(piece: Piece) {
  return effectiveCostCents(piece);
}

export function saleTake(piece: Piece): { revenue: number; cost: number; profit: number } | null {
  const take = profitOf(piece);
  return take ? { revenue: take.revenue, cost: take.cost, profit: take.profit } : null;
}

export function sizeName(piece: Piece) {
  if (piece.usSize) return `US ${piece.usSize}`;
  if (piece.sizeLabel) return `${piece.sizeSystem} ${piece.sizeLabel}`.trim();
  return "";
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function mean(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
}

function units(pieces: Piece[]) {
  return pieces.reduce((sum, piece) => sum + piece.qty, 0);
}

export function groupBy(pieces: Piece[], key: (piece: Piece) => string, empty: string, today = todayISO()): Group[] {
  const map = new Map<string, { label: string; sold: Piece[]; stock: Piece[] }>();
  for (const piece of pieces) {
    const sale = isSale(piece);
    const stock = isStock(piece);
    if (!sale && !stock) continue;
    const raw = key(piece).trim();
    const label = raw || empty;
    const id = label.toLowerCase();
    const row = map.get(id) ?? { label, sold: [], stock: [] };
    if (sale) row.sold.push(piece);
    if (stock) row.stock.push(piece);
    map.set(id, row);
  }
  return [...map.values()]
    .map(({ label, sold, stock }) => {
      let revenue = 0;
      let cost = 0;
      let pricedUnits = 0;
      for (const piece of sold) {
        const t = saleTake(piece);
        if (!t) continue;
        revenue += t.revenue;
        cost += t.cost;
        pricedUnits += piece.qty;
      }
      const soldUnits = units(sold);
      const stockUnits = units(stock);
      const days = sold.map((piece) => daysHeld(piece.receivedOn, piece.soldOn, today)).filter((d): d is number => d != null && !!sold.length);
      return {
        label,
        soldUnits,
        pricedUnits,
        revenue,
        cost,
        profit: revenue - cost,
        margin: revenue > 0 ? (revenue - cost) / revenue : null,
        avgSale: pricedUnits ? Math.round(revenue / pricedUnits) : null,
        stockUnits,
        stockCost: stock.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0),
        avgDays: mean(days),
        sellThrough: soldUnits + stockUnits > 0 ? soldUnits / (soldUnits + stockUnits) : null,
      };
    })
    .sort((a, b) => b.profit - a.profit || b.soldUnits - a.soldUnits || b.stockUnits - a.stockUnits || a.label.localeCompare(b.label));
}

const AGE: Omit<AgeBucket, "units" | "cost">[] = [
  { id: "fresh", label: "0–30 d", min: 0, max: 30, tone: TONES.green },
  { id: "settling", label: "31–60 d", min: 31, max: 60, tone: TONES.teal },
  { id: "slow", label: "61–90 d", min: 61, max: 90, tone: TONES.amber },
  { id: "cold", label: "91–180 d", min: 91, max: 180, tone: TONES.copper },
  { id: "frozen", label: "180+ d", min: 181, max: Infinity, tone: TONES.red },
];

export function ageTone(days: number) {
  return (AGE.find((bucket) => days >= bucket.min && days <= bucket.max) ?? AGE[AGE.length - 1]).tone;
}

const SELL_DAYS = [
  { label: "1 week", max: 7 },
  { label: "2–4 wk", max: 30 },
  { label: "1–2 mo", max: 60 },
  { label: "2–3 mo", max: 90 },
  { label: "3–6 mo", max: 180 },
  { label: "6 mo +", max: Infinity },
];

/** Reads the whole floor. `from`/`to` (ISO, inclusive) narrow the SALES to a window; stock is always today's. */
export function measure(pieces: Piece[], ads: Ad[] = [], opts: { from?: string | null; to?: string | null; today?: string } = {}): Metrics {
  const today = opts.today ?? todayISO();
  const inWindow = (piece: Piece) => {
    if (!opts.from && !opts.to) return true;
    if (!piece.soldOn) return false;
    if (opts.from && piece.soldOn < opts.from) return false;
    if (opts.to && piece.soldOn > opts.to) return false;
    return true;
  };
  const sales = pieces.filter((piece) => isSale(piece) && inWindow(piece));
  const stock = pieces.filter(isStock);
  const onHand = pieces.filter((piece) => piece.status === "available");
  const incoming = pieces.filter((piece) => piece.status === "incoming");
  const priced = sales.filter((piece) => piece.saleCents != null);
  let revenue = 0;
  let costOfSales = 0;
  for (const piece of priced) {
    const t = saleTake(piece)!;
    revenue += t.revenue;
    costOfSales += t.cost;
  }
  const profit = revenue - costOfSales;
  const pricedUnits = units(priced);
  const soldUnits = units(sales);
  const stockUnits = units(stock);

  const held = sales.map((piece) => daysHeld(piece.receivedOn, piece.soldOn, today)).filter((d): d is number => d != null);
  const sellBuckets = SELL_DAYS.map((bucket, i) => ({
    label: bucket.label,
    units: held.filter((d) => d <= bucket.max && (i === 0 || d > SELL_DAYS[i - 1].max)).length,
  }));

  const aged = onHand
    .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null, today) }))
    .filter((row): row is Aged => row.days != null)
    .sort((a, b) => b.days - a.days || b.piece.costCents - a.piece.costCents);
  const buckets = AGE.map((bucket) => {
    const rows = aged.filter((row) => row.days >= bucket.min && row.days <= bucket.max);
    return { ...bucket, units: rows.reduce((sum, row) => sum + row.piece.qty, 0), cost: rows.reduce((sum, row) => sum + row.piece.costCents * row.piece.qty, 0) };
  });

  const asked = stock.filter((piece) => piece.askCents > 0);
  const datedSold = sales.filter((piece) => piece.soldOn).map((piece) => piece.soldOn as string).sort();
  const adSpend = ads.reduce((sum, ad) => sum + ad.spentCents, 0);

  return {
    asOf: today,
    units: {
      onHand: units(onHand),
      incoming: units(incoming),
      sold: soldUnits,
      priced: pricedUnits,
      unpriced: soldUnits - pricedUnits,
      archived: units(pieces.filter((piece) => piece.status === "archived")),
      kept: units(pieces.filter((piece) => piece.status === "kept")),
      removed: units(pieces.filter((piece) => piece.status === "archived" && !piece.wasSold)),
      problems: pieces.filter((piece) => piece.problem && isStock(piece)).length,
    },
    revenue,
    costOfSales,
    profit,
    margin: revenue > 0 ? profit / revenue : null,
    avgSale: pricedUnits ? Math.round(revenue / pricedUnits) : null,
    avgProfit: pricedUnits ? Math.round(profit / pricedUnits) : null,
    priceCuts: sales.reduce((sum, piece) => sum + priceCutCents(piece) * piece.qty, 0),
    rebates: sales.reduce((sum, piece) => sum + Math.min(piece.costCents, piece.buyRebateCents || 0) * piece.qty, 0),
    delivery: sales.reduce((sum, piece) => sum + (piece.deliveryCents || 0) * piece.qty, 0),
    stockCost: stock.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0),
    onHandCost: onHand.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0),
    incomingCost: incoming.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0),
    stockAsk: asked.reduce((sum, piece) => sum + piece.askCents * piece.qty, 0),
    stockAskCost: asked.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0),
    unaskedUnits: units(stock.filter((piece) => piece.askCents <= 0)),
    sellThrough: soldUnits + stockUnits > 0 ? soldUnits / (soldUnits + stockUnits) : null,
    days: { n: held.length, avg: mean(held), median: median(held), fastest: held.length ? Math.min(...held) : null, slowest: held.length ? Math.max(...held) : null, buckets: sellBuckets },
    aging: { buckets, undated: units(onHand.filter((piece) => !piece.receivedOn)), oldest: aged.slice(0, 8), avg: mean(aged.map((row) => row.days)) },
    adSpend,
    datedSales: datedSold.length,
    undatedSales: sales.filter((piece) => !piece.soldOn).length,
    firstSale: datedSold[0] ?? null,
    lastSale: datedSold[datedSold.length - 1] ?? null,
    byCategory: groupBy([...sales, ...stock], (piece) => piece.category, "Unsorted", today),
    byProduct: groupBy([...sales, ...stock], (piece) => piece.name, "Untitled", today),
    byBrand: groupBy([...sales, ...stock], (piece) => piece.brand, "No brand", today),
    bySize: groupBy([...sales, ...stock], sizeName, "No size", today),
    bySource: groupBy([...sales, ...stock], (piece) => piece.source, "Not recorded", today),
    byChannel: groupBy(sales, (piece) => piece.channel, "Not recorded", today),
    byClient: groupBy(sales, (piece) => piece.clientName, "Not recorded", today),
    sales,
    stock,
  };
}

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function keyOf(date: Date, grain: Grain) {
  const y = date.getFullYear();
  if (grain === "year") return { key: String(y), start: new Date(y, 0, 1) };
  if (grain === "month") return { key: `${y}-${String(date.getMonth() + 1).padStart(2, "0")}`, start: new Date(y, date.getMonth(), 1) };
  const start = new Date(date);
  start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return { key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`, start };
}

function step(date: Date, grain: Grain) {
  if (grain === "year") return new Date(date.getFullYear() + 1, 0, 1);
  if (grain === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const next = new Date(date);
  next.setDate(date.getDate() + 7);
  return next;
}

function labels(start: Date, grain: Grain) {
  if (grain === "year") return { label: String(start.getFullYear()), short: String(start.getFullYear()) };
  if (grain === "month") {
    const mon = start.toLocaleDateString("en-US", { month: "short" });
    return { label: `${mon} ${start.getFullYear()}`, short: start.getMonth() === 0 ? `${mon} ’${String(start.getFullYear()).slice(2)}` : mon };
  }
  const label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { label: `Week of ${label}`, short: label };
}

/** Continuous periods (empty ones included, so gaps read as gaps) from the first dated sale to today. */
export function series(sales: Piece[], grain: Grain, opts: { today?: string; limit?: number; from?: string | null } = {}): Period[] {
  const dated = sales.filter((piece) => piece.soldOn);
  if (!dated.length) return [];
  const today = parse(opts.today ?? todayISO());
  const first = opts.from ? parse(opts.from) : parse(dated.map((piece) => piece.soldOn as string).sort()[0]);
  const map = new Map<string, Period>();
  let cursor = keyOf(first, grain).start;
  const end = keyOf(today, grain).start;
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 600) {
    const { key } = keyOf(cursor, grain);
    map.set(key, { key, ...labels(cursor, grain), revenue: 0, profit: 0, units: 0 });
    cursor = step(cursor, grain);
    guard += 1;
  }
  for (const piece of dated) {
    const { key } = keyOf(parse(piece.soldOn as string), grain);
    const row = map.get(key);
    if (!row) continue;
    row.units += piece.qty;
    const t = saleTake(piece);
    if (t) {
      row.revenue += t.revenue;
      row.profit += t.profit;
    }
  }
  const rows = [...map.values()];
  return opts.limit ? rows.slice(-opts.limit) : rows;
}

/** Plain-language percent: 0.4123 → "41%". */
export function pct(value: number | null | undefined, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Money with thousands separators: 351234 → "$3,512.34". */
export function cash(cents: number | null | undefined, whole = false) {
  if (cents == null) return "—";
  const sign = cents < 0 ? "−" : "";
  const value = Math.abs(cents) / 100;
  return `${sign}$${value.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}

/** Axis money: $0, $450, $1.2k. */
export function axisCash(cents: number) {
  const value = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (value >= 10000) return `${sign}$${Math.round(value / 1000)}k`;
  if (value >= 1000) return `${sign}$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}$${Math.round(value)}`;
}

export function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Same window, one step back: this month vs last month, this week vs last week. */
export function compare(sales: Piece[], grain: "week" | "month", today = todayISO()) {
  const rows = series(sales, grain, { today, from: null });
  const now = rows.at(-1) ?? null;
  const before = rows.at(-2) ?? null;
  return { now, before };
}
