import { daysHeld, todayISO, type Piece } from "./model";
import { isSale, isStock, netCost, sizeName } from "./metrics";

/* The Advisor's evidence (1.1.0): what to buy again, what to move, how to
   price — read from the seller's own history, grouped by product so a shelf
   of 200 pairs reads as a dozen decisions, not 200 rows. Every suggestion
   names its evidence (how many sales, how many days); with too little
   history it says so instead of inventing a number. */

export type Restock = {
  product: string;
  size: string | null;
  sold: number;
  recent: number;
  left: number;
  avgDays: number | null;
  perMonth: number;
  weeksLeft: number | null;
  profitEach: number | null;
};

export type MoveGroup = {
  product: string;
  pieces: { piece: Piece; days: number }[];
  units: number;
  oldest: number;
  cost: number;
  pace: number | null;
  ask: number | null;
  cut: number | null;
  floor: number;
};

export type PriceRow = {
  product: string;
  sales: number;
  low: number;
  high: number;
  median: number;
  cost: number;
  asks: number[];
  stock: number;
  below: number;
  above: number;
  unasked: number;
  suggest: number;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function shift(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Products (and their best size) that sold more than once, fastest movers first. */
export function restockList(pieces: Piece[], today = todayISO()): Restock[] {
  const since = shift(today, -90);
  const map = new Map<string, { product: string; sold: Piece[]; stock: Piece[] }>();
  for (const piece of pieces) {
    if (!isSale(piece) && !isStock(piece)) continue;
    const product = piece.name.trim() || "Untitled";
    const row = map.get(product.toLowerCase()) ?? { product, sold: [], stock: [] };
    if (isSale(piece)) row.sold.push(piece);
    else row.stock.push(piece);
    map.set(product.toLowerCase(), row);
  }
  const out: Restock[] = [];
  for (const { product, sold, stock } of map.values()) {
    const units = sold.reduce((sum, piece) => sum + piece.qty, 0);
    if (units < 2) continue;
    const recent = sold.filter((piece) => piece.soldOn && piece.soldOn >= since).reduce((sum, piece) => sum + piece.qty, 0);
    const days = sold.map((piece) => daysHeld(piece.receivedOn, piece.soldOn, today)).filter((d): d is number => d != null);
    const left = stock.reduce((sum, piece) => sum + piece.qty, 0);
    const perMonth = recent / 3;
    const sizes = new Map<string, number>();
    for (const piece of sold) {
      const size = sizeName(piece);
      if (size) sizes.set(size, (sizes.get(size) ?? 0) + piece.qty);
    }
    const best = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0];
    const priced = sold.filter((piece) => piece.saleCents != null);
    const profit = priced.reduce((sum, piece) => sum + ((piece.saleCents ?? 0) - netCost(piece)) * piece.qty, 0);
    const pricedUnits = priced.reduce((sum, piece) => sum + piece.qty, 0);
    out.push({
      product,
      size: best && best[1] >= 2 ? best[0] : null,
      sold: units,
      recent,
      left,
      avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
      perMonth,
      weeksLeft: perMonth > 0 ? Math.round((left / perMonth) * 4.345) : null,
      profitEach: pricedUnits ? Math.round(profit / pricedUnits) : null,
    });
  }
  return out.sort((a, b) => b.recent - a.recent || b.sold - a.sold || (a.avgDays ?? 999) - (b.avgDays ?? 999));
}

/** On-hand pieces that have outstayed their product's usual selling time (or 60 days when there is no history). */
export function moveList(pieces: Piece[], today = todayISO()): MoveGroup[] {
  const pace = new Map<string, number[]>();
  for (const piece of pieces.filter(isSale)) {
    const d = daysHeld(piece.receivedOn, piece.soldOn, today);
    if (d == null) continue;
    const key = piece.name.trim().toLowerCase();
    pace.set(key, [...(pace.get(key) ?? []), d]);
  }
  const all = [...pace.values()].flat();
  const overall = all.length ? median(all) : null;
  const map = new Map<string, MoveGroup>();
  for (const piece of pieces.filter((p) => p.status === "available")) {
    const days = daysHeld(piece.receivedOn, null, today);
    if (days == null) continue;
    const key = piece.name.trim().toLowerCase();
    const own = pace.get(key);
    const usual = own && own.length >= 2 ? median(own) : overall;
    const limit = Math.max(60, usual != null ? Math.round(usual * 1.5) : 60);
    if (days < limit) continue;
    const product = piece.name.trim() || "Untitled";
    const row = map.get(key) ?? { product, pieces: [], units: 0, oldest: 0, cost: 0, pace: usual, ask: null, cut: null, floor: 0 };
    row.pieces.push({ piece, days });
    row.units += piece.qty;
    row.oldest = Math.max(row.oldest, days);
    row.cost += piece.costCents * piece.qty;
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => {
      const asks = row.pieces.map(({ piece }) => piece.askCents).filter((a) => a > 0);
      const ask = asks.length ? median(asks) : null;
      const floor = Math.max(...row.pieces.map(({ piece }) => netCost(piece)));
      const cut = ask != null ? Math.max(floor, Math.round((ask * (row.oldest > 90 ? 0.8 : 0.9)) / 100) * 100) : null;
      row.pieces.sort((a, b) => b.days - a.days);
      return { ...row, ask, cut, floor };
    })
    .sort((a, b) => b.cost - a.cost || b.oldest - a.oldest);
}

/** Price evidence per product with two or more priced sales: the range buyers paid against today's asks. */
export function priceList(pieces: Piece[]): PriceRow[] {
  const map = new Map<string, { product: string; sold: Piece[]; stock: Piece[] }>();
  for (const piece of pieces) {
    if (!isSale(piece) && !isStock(piece)) continue;
    const product = piece.name.trim() || "Untitled";
    const row = map.get(product.toLowerCase()) ?? { product, sold: [], stock: [] };
    if (isSale(piece)) {
      if (piece.saleCents != null && piece.saleCents > 0) row.sold.push(piece);
    } else row.stock.push(piece);
    map.set(product.toLowerCase(), row);
  }
  const out: PriceRow[] = [];
  for (const { product, sold, stock } of map.values()) {
    if (sold.length < 2 || !stock.length) continue;
    const prices = sold.map((piece) => piece.saleCents as number);
    const asks = stock.map((piece) => piece.askCents).filter((a) => a > 0);
    const costs = [...sold, ...stock].map(netCost).filter((c) => c > 0);
    const med = median(prices);
    const high = Math.max(...prices);
    const cost = costs.length ? median(costs) : 0;
    out.push({
      product,
      sales: sold.length,
      low: Math.min(...prices),
      high,
      median: med,
      cost,
      asks,
      stock: stock.reduce((sum, piece) => sum + piece.qty, 0),
      below: stock.filter((piece) => piece.askCents > 0 && piece.askCents < netCost(piece)).length,
      above: stock.filter((piece) => piece.askCents > Math.round(high * 1.15)).length,
      unasked: stock.filter((piece) => piece.askCents <= 0).length,
      suggest: Math.max(med, cost),
    });
  }
  return out.sort((a, b) => b.stock - a.stock || b.sales - a.sales);
}
