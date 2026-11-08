import { Doc, hex, textWidth, wrapText, type RGB } from "./doc";
import { dayLong, dayShort, type Model, type SectionId } from "./model";
import { axisCash, cash, netCost, niceStep, pct, saleTake, sizeName, type AgeBucket, type Group } from "../metrics";
import { daysHeld, type Piece } from "../model";

/**
 * Ventory's PDF report (1.1.0), drawn with the family's page engine (Brizna's doc.ts:
 * vector pages, the standard Helvetica, nothing fetched, works offline and in the
 * Android app). A readable report, not a copy of the worksheet: the figures that
 * matter first, one plain sentence per section, the chart each fact needs, then
 * clean tables. Names are wrapped, never cut. Long lists are summed up here and
 * every row lives in the worksheet.
 */

const C = {
  ink: hex("1A1C17"),
  muted: hex("5C5850"),
  subtle: hex("8A8478"),
  rule: hex("DDD6C8"),
  faint: hex("F7F4EE"),
  white: [1, 1, 1] as RGB,
  night: hex("16181A"),
  nightLine: hex("2A2D30"),
  bone: hex("F3F0E8"),
  sage: hex("8FB89A"),
  accent: hex("3F6B50"),
  accentSoft: hex("E4EEE7"),
  green: hex("5F8F72"),
  amber: hex("B08A3E"),
  amberSoft: hex("F4EAD3"),
  red: hex("A33B32"),
  redSoft: hex("F6E6E3"),
  blue: hex("5D86AD"),
  blueSoft: hex("E3ECF5"),
  copper: hex("C47B4A"),
  teal: hex("4F7F8A"),
  plum: hex("7D5A86"),
};
const HUES = [C.amber, C.green, C.blue, C.copper, C.teal, C.plum];

const W = 612;
const H = 792;
const L = 40;
const R = W - 40;
const CW = R - L;
const TOP = 70;
const BOTTOM = 742;

type Align = "left" | "right" | "center";
type Col = { label: string; w: number; align?: Align };
type Cell = string | { text: string; color?: RGB; bold?: boolean; sub?: string } | { chip: string; fg: RGB; bg: RGB } | { bar: number; color: RGB; text?: string };

type Ctx = { doc: Doc; md: Model; y: number; section: string; starts: Partial<Record<SectionId | "summary", number>> };

const TITLES: Record<SectionId, string> = {
  trend: "Over time",
  earns: "What earns",
  stock: "Stock and aging",
  sales: "Sales",
  sizes: "Sizes, sources and channels",
  advisor: "Advisor",
};

export function renderReport(md: Model) {
  const first = layout(md, null);
  return layout(md, first.starts).doc;
}

export function reportPdfBytes(md: Model): Uint8Array {
  return renderReport(md).toBytes(`Ventory · ${md.title} · ${md.periodLabel}`, "Ventory");
}

/* ------------------------------------------------------------------ marks */

/** The V mark: the app's own path (viewBox 2 0 43.2 40), drawn at height s. */
function vmark(doc: Doc, x: number, y: number, s: number, ink: RGB, accent: RGB) {
  const k = s / 40;
  const p = (px: number, py: number): [number, number] => [x + (px - 2) * k, y + py * k];
  doc.poly([p(3, 1.5), p(24, 38.5), p(45, 1.5), p(33.2, 1.5), p(24, 22.8), p(14.8, 1.5)], ink);
  doc.round(x + (19.3 - 2) * k, y + 3.4 * k, 9.4 * k, 8.2 * k, 2.1 * k, accent);
}

function chip(doc: Doc, x: number, y: number, text: string, fg: RGB, bg: RGB, size = 7) {
  const w = textWidth(text, size, true) + 10;
  doc.round(x, y, w, size + 6, (size + 6) / 2, bg);
  doc.text(x + 5, y + 3.2, text, { size, bold: true, color: fg });
  return w;
}

/** A thick arc (ring segment) as a polygon, angles in radians, 0 = 3 o'clock, clockwise on the page. */
function arc(doc: Doc, cx: number, cy: number, r1: number, r2: number, a0: number, a1: number, color: RGB) {
  if (a1 - a0 < 0.001) return;
  const steps = Math.max(6, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 72));
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r2, cy + Math.sin(a) * r2]);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
  }
  doc.poly(pts, color);
}

/* ------------------------------------------------------------------ layout */

function layout(md: Model, known: Ctx["starts"] | null) {
  const doc = new Doc(W, H);
  const ctx: Ctx = { doc, md, y: TOP, section: "", starts: {} };
  doc.addPage();
  drawCover(ctx, known);
  for (const id of md.sections) {
    if (id === "advisor") newPage(ctx);
    sectionHead(ctx, id);
    if (id === "trend") drawTrend(ctx);
    else if (id === "earns") drawEarns(ctx);
    else if (id === "stock") drawStock(ctx);
    else if (id === "sales") drawSales(ctx);
    else if (id === "sizes") drawSizes(ctx);
    else if (id === "advisor") drawAdvisor(ctx);
    ctx.y += 18;
  }
  const total = doc.pageCount;
  for (let i = 0; i < total; i += 1) {
    doc.usePage(i);
    if (i > 0) {
      vmark(doc, L, 30, 11, C.ink, C.green);
      doc.text(L + 15, 31, "Ventory", { size: 8.5, bold: true, color: C.ink });
      doc.text(R, 31, `${md.title} · ${md.periodLabel}`, { size: 8, color: C.muted, align: "right" });
      doc.line(L, 48, R, 48, C.rule, 0.6);
    }
    doc.line(L, 758, R, 758, C.rule, 0.6);
    doc.text(L, 766, `Ventory · ${md.title} · ${md.periodLabel}${md.sample ? " · sample floor" : ""}`, { size: 7.5, color: C.muted });
    doc.text(R, 766, `Page ${i + 1} of ${total}`, { size: 7.5, bold: true, color: C.muted, align: "right" });
  }
  return { doc, starts: ctx.starts };
}

function newPage(ctx: Ctx, cont?: string) {
  ctx.doc.addPage();
  ctx.y = TOP;
  if (cont) {
    ctx.doc.text(L, ctx.y, cont, { size: 9, bold: true, color: C.subtle });
    ctx.y += 18;
  }
}

function ensure(ctx: Ctx, h: number) {
  if (ctx.y + h > BOTTOM) {
    newPage(ctx, ctx.section ? `${ctx.section} (continued)` : undefined);
    return true;
  }
  return false;
}

function para(ctx: Ctx, text: string, size = 10, color: RGB = C.ink, bold = false, width = CW, x = L, lead = 1.4) {
  for (const line of wrapText(text, size, width, bold)) {
    ensure(ctx, size * lead);
    ctx.doc.text(x, ctx.y, line, { size, color, bold });
    ctx.y += size * lead;
  }
}

function sectionHead(ctx: Ctx, id: SectionId) {
  const { doc, md } = ctx;
  ctx.section = "";
  if (ctx.y > TOP + 4) ensure(ctx, 190);
  ctx.section = TITLES[id];
  ctx.starts[id] = doc.pageCount;
  doc.round(L, ctx.y + 1, 4, 16, 2, C.accent);
  doc.text(L + 12, ctx.y, TITLES[id], { size: 17, bold: true, color: C.ink });
  ctx.y += 27;
  const sentence = takeaway(md, id);
  if (sentence) {
    para(ctx, sentence, 10.5, C.muted);
    ctx.y += 8;
  }
}

function subhead(ctx: Ctx, text: string, need = 60) {
  ensure(ctx, need);
  ctx.doc.text(L, ctx.y, text.toUpperCase(), { size: 8, bold: true, color: C.accent });
  ctx.y += 15;
}

function note(ctx: Ctx, text: string) {
  ctx.y += 2;
  para(ctx, text, 8.2, C.subtle, false, CW, L, 1.38);
  ctx.y += 4;
}

/* ------------------------------------------------------------------ takeaways */

function takeaway(md: Model, id: SectionId): string {
  const m = md.m;
  if (id === "trend") {
    if (!md.months.length) return "No dated sale falls in this period, so there is no timeline to draw.";
    const best = [...md.months].sort((a, b) => b.profit - a.profit)[0];
    return `${best.label} was the strongest month: ${cash(best.revenue)} in and ${cash(best.profit)} left after cost from ${best.units} ${best.units === 1 ? "sale" : "sales"}.${m.undatedSales ? ` ${m.undatedSales} ${m.undatedSales === 1 ? "sale has" : "sales have"} no date and stay off the timeline.` : ""}`;
  }
  if (id === "earns") {
    const top = m.byProduct.filter((g) => g.soldUnits > 0)[0];
    return top ? `${top.label} earned the most: ${cash(top.profit)} left after cost from ${top.soldUnits} ${top.soldUnits === 1 ? "sale" : "sales"}${top.margin != null ? `, a ${pct(top.margin)} margin` : ""}.` : "Nothing sold in this period, so nothing can be ranked.";
  }
  if (id === "stock") {
    const units = m.units.onHand + m.units.incoming;
    const late = m.aging.buckets.filter((b) => b.min > 90).reduce((s, b) => s + b.units, 0);
    return units ? `${units} ${units === 1 ? "piece waits" : "pieces wait"}, ${cash(m.stockCost)} at cost: ${m.units.onHand} on hand and ${m.units.incoming} on the way.${late ? ` ${late} on hand ${late === 1 ? "has" : "have"} sat past 90 days.` : " None has sat past 90 days."} Stock is always as of today, whatever the period.` : "Nothing is waiting on the shelf or on the way.";
  }
  if (id === "sales") return m.units.sold ? `${m.units.sold} ${m.units.sold === 1 ? "piece" : "pieces"} sold: ${cash(m.revenue)} in, ${cash(m.costOfSales)} of cost, ${cash(m.profit)} left.${m.units.unpriced ? ` ${m.units.unpriced} ${m.units.unpriced === 1 ? "sale has" : "sales have"} no price and count as sales without money.` : ""}` : "No sale falls in this period.";
  if (id === "sizes") {
    const top = m.bySize.filter((g) => g.label !== "No size").sort((a, b) => b.soldUnits - a.soldUnits)[0];
    return top && top.soldUnits ? `${top.label} sold most: ${top.soldUnits} ${top.soldUnits === 1 ? "time" : "times"}, with ${top.stockUnits} still here.` : "No sized piece has sold yet in this period.";
  }
  return md.advice.headline;
}

/* ------------------------------------------------------------------ table */

const LINE_H = 10.6;

function cellLines(cell: Cell, size: number, max: number): number {
  if (typeof cell === "string") return Math.max(1, wrapText(cell, size, max).length);
  if ("bar" in cell || "chip" in cell) return 1;
  return Math.max(1, wrapText(cell.text, size, max, cell.bold).length) + (cell.sub ? wrapText(cell.sub, size - 1.3, max).length : 0);
}

/** A table whose header repeats on each page, zebra rows, wrapped names (never cut) and optional totals. */
function table(ctx: Ctx, cols: Col[], rows: Cell[][], opts: { totals?: Cell[]; size?: number } = {}) {
  const { doc } = ctx;
  const size = opts.size ?? 8.3;
  const pad = 5;
  const scale = CW / cols.reduce((a, c) => a + c.w, 0);
  const widths = cols.map((c) => c.w * scale);
  const xs = widths.map((_, i) => L + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const head = () => {
    const lines = Math.max(...cols.map((c, i) => wrapText(c.label, 7, widths[i] - pad * 2, true).length));
    const hh = 8 + lines * 9;
    doc.rect(L, ctx.y, CW, hh, C.accentSoft);
    cols.forEach((c, i) => {
      const x = c.align === "right" ? xs[i] + widths[i] - pad : c.align === "center" ? xs[i] + widths[i] / 2 : xs[i] + pad;
      wrapText(c.label, 7, widths[i] - pad * 2, true).forEach((part, k) => doc.text(x, ctx.y + 5 + k * 9, part, { size: 7, bold: true, color: C.accent, align: c.align ?? "left" }));
    });
    ctx.y += hh;
  };
  const heights = rows.map((row) => 7 + Math.max(...row.map((cell, i) => cellLines(cell, size, widths[i] - pad * 2))) * LINE_H);
  ensure(ctx, 26 + (heights[0] ?? 16) * Math.min(3, rows.length));
  head();
  rows.forEach((row, ri) => {
    const h = heights[ri];
    const need = ri === rows.length - 1 && opts.totals ? h + 22 : h;
    if (ctx.y + need > BOTTOM) {
      newPage(ctx, `${ctx.section} (continued)`);
      head();
    }
    if (ri % 2 === 1) doc.rect(L, ctx.y, CW, h, C.faint);
    row.forEach((cell, ci) => drawCell(doc, cell, xs[ci], ctx.y, widths[ci], h, cols[ci], size));
    ctx.y += h;
  });
  doc.line(L, ctx.y, R, ctx.y, C.rule, 0.6);
  if (opts.totals) {
    doc.line(L, ctx.y, R, ctx.y, C.ink, 0.9);
    opts.totals.forEach((cell, ci) => drawCell(doc, typeof cell === "string" ? { text: cell, bold: true } : cell, xs[ci], ctx.y + 1, widths[ci], 18, cols[ci], size));
    ctx.y += 20;
  }
  ctx.y += 10;
}

function drawCell(doc: Doc, cell: Cell, x: number, y: number, w: number, h: number, col: Col, size: number) {
  const pad = 5;
  const align = col.align ?? "left";
  const tx = align === "right" ? x + w - pad : align === "center" ? x + w / 2 : x + pad;
  const max = w - pad * 2;
  if (typeof cell === "string") cell = { text: cell };
  if ("chip" in cell) {
    if (!cell.chip) return;
    const cw = textWidth(cell.chip, 7, true) + 10;
    const cx = align === "right" ? x + w - pad - cw : align === "center" ? x + (w - cw) / 2 : x + pad;
    chip(doc, cx, y + (h - 13) / 2, cell.chip, cell.fg, cell.bg);
    return;
  }
  if ("bar" in cell) {
    const textW = cell.text ? Math.min(40, max * 0.45) : 0;
    const bw = Math.max(0, max - textW - (textW ? 4 : 0));
    doc.round(x + pad, y + h / 2 - 3, bw, 6, 3, C.faint, C.rule, 0.3);
    if (cell.bar > 0) doc.round(x + pad, y + h / 2 - 3, Math.max(3, bw * Math.min(1, cell.bar)), 6, 3, cell.color);
    if (cell.text) doc.text(x + w - pad, y + (h - size * 0.72) / 2 - 0.5, cell.text, { size: size - 0.5, color: C.ink, align: "right" });
    return;
  }
  const lines = wrapText(cell.text, size, max, cell.bold);
  const subs = cell.sub ? wrapText(cell.sub, size - 1.3, max) : [];
  const block = (lines.length + subs.length) * LINE_H;
  let top = y + (h - block) / 2 + 1.2;
  for (const line of lines) {
    doc.text(tx, top, line, { size, bold: cell.bold, color: cell.color ?? C.ink, align });
    top += LINE_H;
  }
  for (const line of subs) {
    doc.text(tx, top, line, { size: size - 1.3, color: C.muted, align });
    top += LINE_H;
  }
}

/* ------------------------------------------------------------------ charts */

/** Ranked bars: wrapped label, bar, figure, and a note under the figure. */
function hbars(ctx: Ctx, rows: { label: string; value: number; text: string; sub?: string; color?: RGB }[], labelW = 170) {
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const textW = 92;
  const barW = CW - labelW - textW - 8;
  for (const r of rows) {
    const lines = wrapText(r.label, 8.6, labelW - 10);
    const h = Math.max(r.sub ? 24 : 18, lines.length * 10.5 + 6);
    ensure(ctx, h);
    lines.forEach((line, i) => ctx.doc.text(L, ctx.y + 3 + i * 10.5, line, { size: 8.6, color: C.ink }));
    const mid = ctx.y + h / 2 - 5;
    ctx.doc.round(L + labelW, mid, barW, 9, 4.5, C.faint);
    if (r.value !== 0) ctx.doc.round(L + labelW, mid, Math.max(4, (Math.abs(r.value) / peak) * barW), 9, 4.5, r.value < 0 ? C.red : (r.color ?? C.green));
    ctx.doc.text(R, ctx.y + 2.5, r.text, { size: 8.6, bold: true, color: r.value < 0 ? C.red : C.ink, align: "right" });
    if (r.sub) ctx.doc.text(R, ctx.y + 12.5, r.sub, { size: 7.2, color: C.muted, align: "right" });
    ctx.y += h + 2;
  }
  ctx.y += 6;
}

/** Money in (bars) and left after cost (line with dots), by month. */
function trendChart(ctx: Ctx, height = 150) {
  const { doc, md } = ctx;
  const list = md.months.slice(-24);
  if (!list.length) return;
  ensure(ctx, height + 50);
  doc.round(L, ctx.y + 1, 9, 7, 2, C.amber);
  doc.text(L + 13, ctx.y, "Money in", { size: 7.5, color: C.muted });
  const lx = L + 26 + textWidth("Money in", 7.5);
  doc.line(lx, ctx.y + 4.5, lx + 12, ctx.y + 4.5, C.green, 2, undefined, true);
  doc.text(lx + 16, ctx.y, "Left after cost", { size: 7.5, color: C.muted });
  const top = ctx.y + 18;
  const axisW = 42;
  const x0 = L + axisW;
  const w = CW - axisW;
  const hi = Math.max(1, ...list.map((b) => Math.max(b.revenue, b.profit)));
  const lo = Math.min(0, ...list.map((b) => b.profit));
  const step = niceStep((hi - lo) / 4);
  const ceil = Math.ceil(hi / step) * step;
  const floor = lo < 0 ? -Math.ceil(-lo / step) * step : 0;
  const yOf = (v: number) => top + (1 - (v - floor) / (ceil - floor)) * height;
  for (let v = floor; v <= ceil + 0.5; v += step) {
    doc.line(x0, yOf(v), R, yOf(v), v === 0 ? C.muted : C.rule, v === 0 ? 0.7 : 0.4, v === 0 ? undefined : [2, 2]);
    doc.text(x0 - 6, yOf(v) - 3, axisCash(v), { size: 6.6, color: C.subtle, align: "right" });
  }
  const slot = w / list.length;
  const bw = Math.min(22, slot * 0.5);
  const every = Math.ceil(list.length / 12);
  const pts: [number, number][] = [];
  list.forEach((b, i) => {
    const cx = x0 + slot * i + slot / 2;
    const hb = yOf(0) - yOf(Math.max(0, b.revenue));
    if (hb > 0) doc.round(cx - bw / 2, yOf(0) - hb, bw, hb, Math.min(2.5, hb / 2), C.amber);
    if (list.length <= 12 && b.revenue > 0) doc.text(cx, yOf(0) - hb - 9, axisCash(b.revenue), { size: 6.3, bold: true, color: C.amber, align: "center" });
    if (i % every === (list.length - 1) % every) doc.text(cx, top + height + 5, b.short.replace("’", "'"), { size: 6.6, color: C.muted, align: "center" });
    pts.push([cx, yOf(b.profit)]);
  });
  for (let i = 1; i < pts.length; i += 1) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], C.green, 1.8, undefined, true);
  pts.forEach(([x, y], i) => doc.circle(x, y, 2.6, list[i].profit < 0 ? C.red : C.green, C.white));
  ctx.y = top + height + 22;
}

function ageChart(ctx: Ctx, buckets: AgeBucket[]) {
  const { doc } = ctx;
  const tones: Record<string, RGB> = { fresh: C.green, settling: C.teal, slow: C.amber, cold: C.copper, frozen: C.red };
  const h = 78;
  ensure(ctx, h + 44);
  const peak = Math.max(1, ...buckets.map((b) => b.units));
  const slot = CW / buckets.length;
  const top = ctx.y + 14;
  buckets.forEach((b, i) => {
    const cx = L + slot * i + slot / 2;
    const bh = b.units ? Math.max(4, (b.units / peak) * h) : 0;
    doc.round(cx - 22, top, 44, h, 5, C.faint);
    if (bh) doc.round(cx - 22, top + h - bh, 44, bh, 5, tones[b.id] ?? C.green);
    doc.text(cx, top - 13, String(b.units), { size: 11, bold: true, color: C.ink, align: "center" });
    doc.text(cx, top + h + 5, b.label, { size: 7.6, color: C.muted, align: "center" });
    doc.text(cx, top + h + 15, cash(b.cost, true), { size: 7.6, bold: true, color: C.ink, align: "center" });
  });
  ctx.y = top + h + 32;
}

function gauge(ctx: Ctx, x: number, y: number, value: number | null, label: string) {
  const { doc } = ctx;
  const p = value == null ? 0 : Math.max(0, Math.min(1, value));
  const cx = x + 46;
  const cy = y + 46;
  arc(doc, cx, cy, 34, 44, Math.PI, Math.PI * 2, C.faint);
  if (p > 0) arc(doc, cx, cy, 34, 44, Math.PI, Math.PI + Math.PI * p, C.green);
  doc.text(cx, cy - 16, pct(value), { size: 15, bold: true, color: C.ink, align: "center" });
  doc.text(cx, cy + 5, label, { size: 7.5, color: C.muted, align: "center" });
}

function splitBar(ctx: Ctx, parts: { label: string; value: number; color: RGB; text: string }[]) {
  const { doc } = ctx;
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (total <= 0) return;
  ensure(ctx, 40);
  let at = L;
  const shown = parts.filter((p) => p.value > 0);
  shown.forEach((p, i) => {
    const pw = (p.value / total) * CW;
    doc.round(at, ctx.y, Math.max(2, pw - (i < shown.length - 1 ? 1.5 : 0)), 10, 3, p.color);
    at += pw;
  });
  ctx.y += 17;
  let lx = L;
  for (const p of parts) {
    const label = `${p.label}  ${p.text}`;
    const lw = textWidth(label, 8, false) + 26;
    if (lx + lw > R) {
      lx = L;
      ctx.y += 13;
    }
    doc.circle(lx + 4, ctx.y + 3.2, 3.6, p.color);
    doc.text(lx + 12, ctx.y, p.label, { size: 8, color: C.muted });
    doc.text(lx + 12 + textWidth(`${p.label}  `, 8), ctx.y, p.text, { size: 8, bold: true, color: C.ink });
    lx += lw;
  }
  ctx.y += 20;
}

/* ------------------------------------------------------------------ cover */

function drawCover(ctx: Ctx, known: Ctx["starts"] | null) {
  const { doc, md } = ctx;
  const m = md.m;
  ctx.starts.summary = 1;
  doc.rect(0, 0, W, 150, C.night);
  doc.rect(0, 148, W, 2, C.green);
  vmark(doc, L, 36, 34, C.bone, C.sage);
  doc.text(L + 38, 38, "entory", { size: 33, bold: true, color: C.bone });
  doc.text(R, 42, md.title.toUpperCase(), { size: 8, bold: true, color: C.sage, align: "right" });
  doc.text(R, 56, md.periodLabel, { size: 13, bold: true, color: C.bone, align: "right" });
  doc.text(R, 74, md.generated, { size: 8, color: hex("A39E93"), align: "right" });
  const contents = md.sections.map((id) => `${TITLES[id]}${known?.[id] ? ` ${known[id]}` : ""}`).join("   ·   ");
  if (contents) wrapText(`Inside: ${contents}`, 7.6, CW).forEach((line, i) => doc.text(L, 96 + i * 11, line, { size: 7.6, color: hex("A39E93") }));
  doc.text(L, 122, `Sales counted inside the period · stock always as of ${dayLong(md.today)}${md.sample ? " · this floor includes the sample pieces" : ""}`, { size: 7.6, color: hex("8A857B") });

  const tiles = [
    { label: "LEFT AFTER COST", value: cash(m.profit), sub: `${m.units.priced} priced ${m.units.priced === 1 ? "sale" : "sales"}`, color: m.profit < 0 ? C.red : C.accent },
    { label: "MONEY IN", value: cash(m.revenue), sub: `${cash(m.costOfSales)} cost of sales`, color: C.amber },
    { label: "MARGIN", value: pct(m.margin), sub: "of every dollar stays", color: C.ink },
    { label: "SELL-THROUGH", value: pct(m.sellThrough), sub: `${m.units.sold} sold · ${m.units.onHand + m.units.incoming} waiting`, color: C.green },
  ];
  const gap = 10;
  const tw = (CW - gap * 3) / 4;
  const ty = 174;
  tiles.forEach((t, i) => {
    const x = L + i * (tw + gap);
    doc.round(x, ty, tw, 76, 9, C.faint, C.rule, 0.6);
    doc.rect(x + 11, ty, 24, 2.5, t.color);
    doc.text(x + 11, ty + 12, t.label, { size: 6.8, bold: true, color: C.muted });
    doc.text(x + 11, ty + 28, t.value, { size: textWidth(t.value, 21, true) > tw - 20 ? 16 : 21, bold: true, color: t.color });
    wrapText(t.sub, 7.4, tw - 20).forEach((line, k) => doc.text(x + 11, ty + 55 + k * 9, line, { size: 7.4, color: C.muted }));
  });
  const small = [
    { label: "Pieces sold", value: String(m.units.sold) },
    { label: "Average sale", value: m.avgSale == null ? "—" : cash(m.avgSale) },
    { label: "Median days to sell", value: m.days.median == null ? "—" : `${m.days.median} days` },
    { label: "Stock at cost", value: cash(m.stockCost) },
    { label: "On hand / on the way", value: `${m.units.onHand} / ${m.units.incoming}` },
    { label: "Ready to list", value: `${md.ready} of ${m.units.onHand}` },
  ];
  const sw = CW / 3;
  small.forEach((s, i) => {
    const x = L + (i % 3) * sw;
    const y = 266 + Math.floor(i / 3) * 30;
    doc.text(x, y, s.label, { size: 7.6, color: C.muted });
    doc.text(x, y + 10.5, s.value, { size: 12, bold: true, color: C.ink });
  });
  ctx.y = 334;
  doc.line(L, ctx.y - 8, R, ctx.y - 8, C.rule, 0.6);
  doc.text(L, ctx.y, "IN ONE SENTENCE", { size: 7.5, bold: true, color: C.accent });
  ctx.y += 14;
  const lines = wrapText(md.advice.headline, 12.5, CW - 16);
  doc.rect(L, ctx.y - 2, 3, lines.length * 17 + 2, C.green);
  lines.forEach((line) => {
    doc.text(L + 14, ctx.y, line, { size: 12.5, color: C.ink });
    ctx.y += 17;
  });
  ctx.y += 16;
  if (md.months.length > 1) {
    doc.text(L, ctx.y, "MONTH BY MONTH", { size: 7.5, bold: true, color: C.accent });
    ctx.y += 14;
    trendChart(ctx, 128);
  }
  if (ctx.y < BOTTOM - 120) {
    doc.text(L, ctx.y, "HOW OLD THE STOCK ON HAND IS", { size: 7.5, bold: true, color: C.accent });
    ctx.y += 16;
    ageChart(ctx, m.aging.buckets);
  }
}

/* ------------------------------------------------------------------ sections */

function drawTrend(ctx: Ctx) {
  const md = ctx.md;
  if (!md.months.length) return;
  trendChart(ctx, 170);
  const rows = md.months.slice().reverse();
  table(
    ctx,
    [{ label: "Month", w: 110 }, { label: "Sales", w: 50, align: "right" }, { label: "Money in", w: 90, align: "right" }, { label: "Left after cost", w: 90, align: "right" }, { label: "Margin", w: 60, align: "right" }, { label: "Share of the period", w: 130 }],
    rows.map((r) => [r.label, String(r.units), cash(r.revenue), { text: cash(r.profit), color: r.profit < 0 ? C.red : C.ink }, pct(r.margin), { bar: md.m.revenue ? r.revenue / Math.max(...md.months.map((x) => x.revenue), 1) : 0, color: C.amber, text: md.m.revenue ? pct(r.revenue / md.m.revenue) : "" }]),
    { totals: ["Dated sales", String(md.months.reduce((s, r) => s + r.units, 0)), cash(md.months.reduce((s, r) => s + r.revenue, 0)), cash(md.months.reduce((s, r) => s + r.profit, 0)), pct(md.m.margin), ""] },
  );
}

function groupNeed(rows: Group[]) {
  return 44 + Math.min(rows.length, 3) * 18;
}

function groupTable(ctx: Ctx, rows: Group[], first: string) {
  table(
    ctx,
    [{ label: first, w: 170 }, { label: "Sold", w: 44, align: "right" }, { label: "Money in", w: 78, align: "right" }, { label: "Left after cost", w: 78, align: "right" }, { label: "Margin", w: 52, align: "right" }, { label: "Days to sell", w: 54, align: "right" }, { label: "Still here", w: 52, align: "right" }],
    rows.map((g) => [g.label, String(g.soldUnits), cash(g.revenue), { text: cash(g.profit), color: g.profit < 0 ? C.red : C.ink, bold: true }, pct(g.margin), g.avgDays == null ? "—" : `${g.avgDays} d`, String(g.stockUnits)]),
  );
}

function drawEarns(ctx: Ctx) {
  const m = ctx.md.m;
  const sold = m.byProduct.filter((g) => g.soldUnits > 0);
  if (!sold.length) return;
  subhead(ctx, "Products ranked by what they left after cost");
  hbars(ctx, sold.slice(0, 14).map((g) => ({ label: g.label, value: g.profit, text: cash(g.profit), sub: `${g.soldUnits} sold · ${pct(g.margin)}`, color: C.green })));
  if (sold.length > 14) note(ctx, `${sold.length - 14} more products are in the table below and in the worksheet.`);
  subhead(ctx, "Every product that sold", groupNeed(sold));
  groupTable(ctx, sold, "Product");
  const cats = m.byCategory.filter((g) => g.soldUnits > 0);
  if (cats.length > 1) {
    subhead(ctx, "By type", groupNeed(cats));
    groupTable(ctx, cats, "Type");
  }
  const brands = m.byBrand.filter((g) => g.soldUnits > 0 && g.label !== "No brand");
  if (brands.length) {
    subhead(ctx, "By brand", groupNeed(brands));
    groupTable(ctx, brands, "Brand");
  }
}

function drawStock(ctx: Ctx) {
  const { md } = ctx;
  const m = md.m;
  splitBar(ctx, [
    { label: "On hand", value: m.onHandCost, color: C.green, text: cash(m.onHandCost) },
    { label: "On the way", value: m.incomingCost, color: C.blue, text: cash(m.incomingCost) },
  ]);
  if (m.stockAsk) note(ctx, `If every priced piece sells at its asking price: ${cash(m.stockAsk)} in, ${cash(m.stockAsk - m.stockAskCost)} over its cost.${m.unaskedUnits ? ` ${m.unaskedUnits} ${m.unaskedUnits === 1 ? "piece has" : "pieces have"} no asking price yet.` : ""}`);
  ctx.y += 6;
  if (m.units.onHand) {
    subhead(ctx, "How long the pieces on hand have waited", 150);
    ageChart(ctx, m.aging.buckets);
    if (m.aging.undated) note(ctx, `${m.aging.undated} on hand ${m.aging.undated === 1 ? "has" : "have"} no arrival date and stay out of the chart.`);
  }
  const products = m.byProduct.filter((g) => g.stockUnits > 0).sort((a, b) => b.stockCost - a.stockCost);
  if (products.length) {
    subhead(ctx, "What is waiting, by product", 80);
    const stock = m.stock;
    table(
      ctx,
      [{ label: "Product", w: 168 }, { label: "Pieces", w: 46, align: "right" }, { label: "Sizes", w: 110 }, { label: "Cost", w: 70, align: "right" }, { label: "Asking", w: 70, align: "right" }, { label: "Oldest", w: 50, align: "right" }],
      products.map((g) => {
        const these = stock.filter((p) => (p.name.trim() || "Untitled").toLowerCase() === g.label.toLowerCase());
        const sizes = [...new Set(these.map(sizeName).filter(Boolean))].sort((a, b) => parseFloat(a.replace(/[^0-9.]/g, "")) - parseFloat(b.replace(/[^0-9.]/g, "")));
        const asks = these.filter((p) => p.askCents > 0).reduce((s, p) => s + p.askCents * p.qty, 0);
        const oldest = Math.max(-1, ...these.filter((p) => p.status === "available").map((p) => daysHeld(p.receivedOn, null, md.today) ?? -1));
        const incoming = these.filter((p) => p.status === "incoming").reduce((s, p) => s + p.qty, 0);
        return [{ text: g.label, sub: incoming ? `${incoming} on the way` : undefined }, String(g.stockUnits), sizes.join(", ") || "—", cash(g.stockCost), asks ? cash(asks) : "—", oldest >= 0 ? `${oldest} d` : "—"];
      }),
      { totals: ["Total", String(m.units.onHand + m.units.incoming), "", cash(m.stockCost), m.stockAsk ? cash(m.stockAsk) : "—", ""] },
    );
  }
  if (m.aging.oldest.length) {
    subhead(ctx, "The pieces that have waited longest", 80);
    table(
      ctx,
      [{ label: "Piece", w: 190 }, { label: "Size", w: 70 }, { label: "Arrived", w: 84 }, { label: "Waiting", w: 60, align: "right" }, { label: "Cost", w: 64, align: "right" }, { label: "Asking", w: 64, align: "right" }],
      m.aging.oldest.map(({ piece, days }) => [piece.name, sizeName(piece) || "—", dayShort(piece.receivedOn), { chip: `${days} d`, fg: days > 90 ? C.red : days > 60 ? C.amber : C.accent, bg: days > 90 ? C.redSoft : days > 60 ? C.amberSoft : C.accentSoft }, cash(piece.costCents), piece.askCents ? cash(piece.askCents) : "—"]),
    );
  }
}

function drawSales(ctx: Ctx) {
  const { md } = ctx;
  const m = md.m;
  if (!m.sales.length) return;
  const sales = m.sales.slice().sort((a, b) => (b.soldOn || "").localeCompare(a.soldOn || ""));
  const limit = 90;
  const shown = sales.slice(0, limit);
  const named = sales.some((p) => p.channel || p.clientName);
  const cols: Col[] = [{ label: "Sold", w: 62 }, { label: "Piece", w: named ? 140 : 212 }, { label: "Size", w: 44 }, { label: "Cost", w: 52, align: "right" }, { label: "Sale", w: 52, align: "right" }, { label: "Left", w: 52, align: "right" }, { label: "Days", w: 32, align: "right" }];
  if (named) cols.push({ label: "Channel · client", w: 120 });
  table(
    ctx,
    cols,
    shown.map((p: Piece) => {
      const t = saleTake(p);
      const days = daysHeld(p.receivedOn, p.soldOn, md.today);
      const who = [p.channel, p.clientName].filter(Boolean).join(" · ");
      return [
        p.soldOn ? dayShort(p.soldOn) : "No date",
        { text: p.name, sub: p.qty > 1 ? `${p.qty} pieces` : undefined },
        sizeName(p) || "—",
        cash(netCost(p) * p.qty),
        t ? cash(t.revenue) : { text: "No price", color: C.subtle },
        t ? { text: cash(t.profit), color: t.profit < 0 ? C.red : C.accent, bold: true } : "—",
        days == null ? "—" : String(days),
        ...(named ? [who || "—"] : []),
      ];
    }),
    { totals: ["Total", `${m.units.sold} sold`, "", cash(m.costOfSales), cash(m.revenue), cash(m.profit), "", ...(named ? [""] : [])], size: 7.9 },
  );
  note(ctx, `${sales.length > limit ? `The ${limit} most recent sales are printed; all ${sales.length} are in the worksheet, on the Sales tab. ` : ""}Totals cover every sale in the period.${m.days.avg != null ? ` A sale took ${m.days.avg} days on average from arrival (median ${m.days.median}).` : ""} Cost is net of any buying rebate; delivery is not counted as revenue.`);
}

function drawSizes(ctx: Ctx) {
  const m = ctx.md.m;
  const sizes = m.bySize.slice().sort((a, b) => b.soldUnits - a.soldUnits || b.stockUnits - a.stockUnits);
  if (sizes.length) {
    subhead(ctx, "Sizes: what sold against what is still here", 120);
    table(
      ctx,
      [{ label: "Size", w: 90 }, { label: "Sold", w: 50, align: "right" }, { label: "Still here", w: 60, align: "right" }, { label: "Sell-through", w: 140 }, { label: "Days to sell", w: 70, align: "right" }, { label: "Left after cost", w: 90, align: "right" }],
      sizes.map((g) => [g.label, String(g.soldUnits), String(g.stockUnits), { bar: g.sellThrough ?? 0, color: C.blue, text: pct(g.sellThrough) }, g.avgDays == null ? "—" : `${g.avgDays} d`, cash(g.profit)]),
    );
  }
  const sources = m.bySource;
  if (sources.length) {
    subhead(ctx, "Where the pieces were bought", 100);
    table(
      ctx,
      [{ label: "Bought from", w: 150 }, { label: "Sold", w: 50, align: "right" }, { label: "Still here", w: 60, align: "right" }, { label: "Sell-through", w: 120 }, { label: "Margin", w: 60, align: "right" }, { label: "Left after cost", w: 90, align: "right" }],
      sources.map((g) => [g.label, String(g.soldUnits), String(g.stockUnits), { bar: g.sellThrough ?? 0, color: C.teal, text: pct(g.sellThrough) }, pct(g.margin), cash(g.profit)]),
    );
  }
  const channels = m.byChannel.filter((g) => g.label !== "Not recorded");
  if (channels.length) {
    subhead(ctx, "Where they sold", 80);
    splitBar(ctx, channels.slice(0, 6).map((g, i) => ({ label: g.label, value: g.revenue, color: HUES[i % HUES.length], text: cash(g.revenue) })));
  }
  const clients = m.byClient.filter((g) => g.label !== "Not recorded").sort((a, b) => b.revenue - a.revenue);
  if (clients.length) {
    subhead(ctx, "Clients", 80);
    table(
      ctx,
      [{ label: "Client", w: 200 }, { label: "Buys", w: 60, align: "right" }, { label: "Money in", w: 100, align: "right" }, { label: "Left after cost", w: 100, align: "right" }],
      clients.slice(0, 25).map((g) => [g.label, String(g.soldUnits), cash(g.revenue), cash(g.profit)]),
    );
  }
}

function card(ctx: Ctx, kicker: string, title: string, body: string, color: RGB, soft: RGB) {
  const { doc } = ctx;
  const lines = wrapText(body, 9.2, CW - 34);
  const titleLines = wrapText(title, 12.5, CW - 34, true);
  const h = 24 + titleLines.length * 16 + lines.length * 12.6 + 6;
  ensure(ctx, h + 8);
  doc.round(L, ctx.y, CW, h, 8, soft);
  doc.round(L, ctx.y, 4, h, 2, color);
  let y = ctx.y + 10;
  doc.text(L + 16, y, kicker.toUpperCase(), { size: 7, bold: true, color });
  y += 13;
  for (const line of titleLines) {
    doc.text(L + 16, y, line, { size: 12.5, bold: true, color: C.ink });
    y += 16;
  }
  for (const line of lines) {
    doc.text(L + 16, y, line, { size: 9.2, color: C.ink });
    y += 12.6;
  }
  ctx.y += h + 10;
}

function drawAdvisor(ctx: Ctx) {
  const { md, doc } = ctx;
  const m = md.m;
  gauge(ctx, L, ctx.y, m.units.onHand ? md.ready / m.units.onHand : null, "ready to list");
  gauge(ctx, L + 110, ctx.y, m.sellThrough, "sell-through");
  const x = L + 230;
  let y = ctx.y + 4;
  doc.text(x, y, "WHAT IS MISSING ON THE PIECES ON HAND", { size: 7.2, bold: true, color: C.accent });
  y += 14;
  const peak = Math.max(1, m.units.onHand);
  for (const row of md.missing.slice(0, 5)) {
    doc.text(x, y, row.field[0].toUpperCase() + row.field.slice(1), { size: 8.2, color: C.ink });
    doc.round(x + 78, y + 1, 180, 7, 3.5, C.faint);
    doc.round(x + 78, y + 1, Math.max(3, (row.units / peak) * 180), 7, 3.5, C.amber);
    doc.text(R, y, `${row.units}`, { size: 8.2, bold: true, color: C.ink, align: "right" });
    y += 13;
  }
  if (!md.missing.length) doc.text(x, y, "Every piece on hand has its card complete.", { size: 8.5, color: C.muted });
  ctx.y += 104;

  const action = md.pieces.find((p) => p.id === md.advice.actionPieceId);
  if (action) card(ctx, "Do this first", action.name, md.advice.actionBody, C.accent, C.accentSoft);

  if (md.restock.length) {
    subhead(ctx, "Buy again: what already sold more than once", 90);
    table(
      ctx,
      [{ label: "Product", w: 170 }, { label: "Best size", w: 64 }, { label: "Sold", w: 40, align: "right" }, { label: "Last 90 days", w: 56, align: "right" }, { label: "Days to sell", w: 56, align: "right" }, { label: "Left each", w: 64, align: "right" }, { label: "Still here", w: 54, align: "right" }],
      md.restock.slice(0, 12).map((r) => [r.product, r.size ?? "—", String(r.sold), String(r.recent), r.avgDays == null ? "—" : `${r.avgDays} d`, r.profitEach == null ? "—" : cash(r.profitEach), r.left === 0 ? { text: "0", sub: "sold out", color: C.amber, bold: true } : r.weeksLeft != null && r.weeksLeft <= 4 ? { text: String(r.left), sub: `about ${r.weeksLeft} wk left`, color: C.amber, bold: true } : String(r.left)]),
    );
  }
  if (md.move.length) {
    subhead(ctx, "Move: pieces past their usual selling time", 90);
    table(
      ctx,
      [{ label: "Product", w: 160 }, { label: "Pieces", w: 40, align: "right" }, { label: "Oldest", w: 46, align: "right" }, { label: "Usually sells in", w: 60, align: "right" }, { label: "Cost tied up", w: 64, align: "right" }, { label: "Asking now", w: 60, align: "right" }, { label: "Try", w: 100, align: "right" }],
      md.move.slice(0, 14).map((g) => [g.product, String(g.units), `${g.oldest} d`, g.pace == null ? "—" : `${g.pace} d`, cash(g.cost), g.ask == null ? "—" : cash(g.ask), g.cut == null ? "set a price" : { text: cash(g.cut), bold: true, color: C.accent, sub: g.cut > g.floor ? `never under ${cash(g.floor)}` : "that is its cost" }]),
    );
    note(ctx, "Try = a first cut of about 10% off the usual ask (20% past 90 days), never under what the piece cost. Fees and shipping are not on the card, so the true floor is a little higher.");
  }
  if (md.price.length) {
    subhead(ctx, "Price from your own sales", 120);
    const scale = Math.max(1, ...md.price.slice(0, 12).flatMap((r) => [r.high, ...r.asks, r.cost])) * 1.08;
    for (const r of md.price.slice(0, 12)) {
      const nameLines = wrapText(r.product, 8.6, 160);
      const h = Math.max(30, nameLines.length * 10.5 + 16);
      ensure(ctx, h);
      nameLines.forEach((line, i) => doc.text(L, ctx.y + 2 + i * 10.5, line, { size: 8.6, bold: true, color: C.ink }));
      doc.text(L, ctx.y + 2 + nameLines.length * 10.5, `${r.sales} sales · usual ${cash(r.median)}`, { size: 7.2, color: C.muted });
      const tx = L + 172;
      const tw = CW - 172 - 70;
      const at = (v: number) => tx + (v / scale) * tw;
      const ty = ctx.y + 9;
      doc.round(tx, ty, tw, 5, 2.5, C.faint);
      doc.round(at(r.low), ty, Math.max(3, at(r.high) - at(r.low)), 5, 2.5, hex("B9D2C1"));
      doc.line(at(r.cost), ty - 5, at(r.cost), ty + 10, C.muted, 1.2);
      doc.circle(at(r.median), ty + 2.5, 4.2, C.green, C.white);
      for (const ask of [...new Set(r.asks)].slice(0, 6)) doc.poly([[at(ask), ty - 2], [at(ask) + 3.5, ty + 2.5], [at(ask), ty + 7], [at(ask) - 3.5, ty + 2.5]], C.amber);
      doc.text(tx, ty + 12, cash(r.low, true), { size: 6.6, color: C.subtle });
      doc.text(tx + tw, ty + 12, cash(r.high, true), { size: 6.6, color: C.subtle, align: "right" });
      const verdict = r.below ? `${r.below} under cost` : r.above ? `${r.above} above any sale` : r.unasked ? `${r.unasked} with no ask` : "asks in range";
      doc.text(R, ctx.y + 2, `ask ${cash(r.suggest, true)}`, { size: 8.6, bold: true, color: C.accent, align: "right" });
      doc.text(R, ctx.y + 13, verdict, { size: 7.2, color: r.below ? C.red : r.above ? C.amber : C.muted, align: "right" });
      ctx.y += h + 4;
    }
    note(ctx, "Each track runs from the lowest to the highest price a buyer paid (green band). The dot is the usual price, the line is the cost, the diamonds are today's asks. The suggested ask is the usual price, never under cost.");
  }
  subhead(ctx, "The plan", 80);
  for (const line of planLines(md)) {
    ensure(ctx, 16);
    doc.circle(L + 3, ctx.y + 4, 2.2, C.green);
    para(ctx, line, 9.4, C.ink, false, CW - 14, L + 12, 1.42);
    ctx.y += 2;
  }
}

/** The plan, written from this floor's own evidence (what to finish, buy, move and reprice). */
function planLines(md: Model): string[] {
  const out: string[] = [];
  const action = md.pieces.find((p) => p.id === md.advice.actionPieceId);
  if (action) out.push(`Today: finish ${action.name}${sizeName(action) ? ` (${sizeName(action)})` : ""} — the priciest card on hand that is not ready.`);
  const top = md.missing[0];
  if (top) out.push(`This week: ${top.units} ${top.units === 1 ? "piece needs" : "pieces need"} ${top.field === "asking price" ? "an asking price" : `a ${top.field}`}. A complete card is what a buyer can find.`);
  const buy = md.restock.find((r) => r.left === 0 || (r.weeksLeft != null && r.weeksLeft <= 6)) ?? md.restock[0];
  if (buy) out.push(`Buy again: ${buy.product}${buy.size ? `, ${buy.size} first` : ""} — ${buy.recent} sold in the last 90 days, ${buy.left === 0 ? "none left" : `${buy.left} left`}.`);
  const move = md.move[0];
  if (move) out.push(`Move: ${move.product} has ${move.units} ${move.units === 1 ? "piece" : "pieces"} past ${move.pace ?? 60} days${move.cut != null ? `; try ${cash(move.cut)}` : "; give it an asking price"}.`);
  const below = md.price.filter((r) => r.below > 0);
  if (below.length) out.push(`Reprice: ${below.map((r) => r.product).join(", ")} ${below.length === 1 ? "has" : "have"} asks under cost.`);
  if (!out.length) out.push("Keep every card complete and write the date on each sale; the next report learns from it.");
  return out;
}
