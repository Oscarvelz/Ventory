import { daysHeld, STATUS_LABEL, type Piece } from "../model";
import { isSale, isStock, netCost, sizeName, type Group } from "../metrics";
import { dayLong, type Model } from "./model";

/**
 * Ventory's worksheet (1.1.0): a real .xlsx (Excel, Google Sheets, LibreOffice, Numbers),
 * written the family's way (Brizna's report-xlsx: hand-built OOXML in a stored zip, no
 * library, works offline). Data to sort, filter and sum: dates are dates, money is
 * currency, percentages are percentages, every tab has a frozen header and a filter,
 * and its totals row follows the filter (SUBTOTAL). Money columns that derive from
 * others are live formulas, so an edit in the sheet recomputes.
 */

const ACCENT = "3F6B50";
const ACCENT_SOFT = "E4EEE7";
const INK = "1A1C17";
const MUTED = "5C5850";
const RULE = "DDD6C8";
const FAINT = "F7F4EE";
const AMBER = "8A6A2C";
const RED = "A33B32";
const NIGHT = "16181A";
const BONE = "F3F0E8";

type Fmt = "date" | "money" | "int" | "pct" | "num1";
interface Style {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  border?: boolean;
  wrap?: boolean;
  fmt?: Fmt;
  top?: boolean;
}
interface XCell {
  v?: string | number | null;
  f?: string;
  s?: Style;
}
interface Sheet {
  name: string;
  rows: (XCell | null)[][];
  widths: number[];
  merges?: string[];
  freeze?: number;
  filter?: string;
  heights?: Record<number, number>;
  tab?: string;
  landscape?: boolean;
}

const FMT: Record<Fmt, number> = { money: 164, date: 165, num1: 166, int: 1, pct: 167 };

function colName(index: number): string {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const digit = (current - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function xml(value: unknown): string {
  const amp = String.fromCharCode(38);
  return String(value ?? "")
    .split("&").join(`${amp}amp;`)
    .split("<").join(`${amp}lt;`)
    .split(">").join(`${amp}gt;`)
    .split('"').join(`${amp}quot;`)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function serial(iso: string | null): number | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86400000);
}

class Styles {
  fonts = [`<font><sz val="10"/><color rgb="FF${INK}"/><name val="Calibri"/><family val="2"/></font>`];
  fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`];
  borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`];
  xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  private seen = new Map<string, number>();

  private index(list: string[], item: string): number {
    const at = list.indexOf(item);
    if (at >= 0) return at;
    list.push(item);
    return list.length - 1;
  }

  id(style: Style | undefined): number {
    if (!style) return 0;
    const key = JSON.stringify(style);
    const known = this.seen.get(key);
    if (known != null) return known;
    const font = this.index(this.fonts, `<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}<sz val="${style.size ?? 10}"/><color rgb="FF${style.color ?? INK}"/><name val="Calibri"/><family val="2"/></font>`);
    const fill = style.fill ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (name: string, color = RULE, weight = "thin") => `<${name} style="${weight}"><color rgb="FF${color}"/></${name}>`;
    const border = style.border
      ? this.index(this.borders, `<border>${side("left")}${side("right")}${style.top ? side("top", INK, "medium") : side("top")}${side("bottom")}<diagonal/></border>`)
      : style.top
        ? this.index(this.borders, `<border><left/><right/>${side("top", INK, "medium")}<bottom/><diagonal/></border>`)
        : 0;
    const numFmt = style.fmt ? FMT[style.fmt] : 0;
    const align = `<alignment${style.align ? ` horizontal="${style.align}"` : ""} vertical="center"${style.wrap ? ` wrapText="1"` : ""}/>`;
    this.xfs.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${numFmt ? ` applyNumberFormat="1"` : ""}>${align}</xf>`);
    const id = this.xfs.length - 1;
    this.seen.set(key, id);
    return id;
  }

  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00;[Red]\\-&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="mmm d, yyyy"/><numFmt numFmtId="166" formatCode="0.0"/><numFmt numFmtId="167" formatCode="0.0%"/></numFmts>
<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>
<fills count="${this.fills.length}">${this.fills.join("")}</fills>
<borders count="${this.borders.length}">${this.borders.join("")}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }
}

function sheetXml(sheet: Sheet, styles: Styles): string {
  const body = sheet.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, column) => {
          if (!cell) return "";
          const ref = `${colName(column)}${rowIndex + 1}`;
          const s = styles.id(cell.s);
          if (cell.f) {
            const cached = typeof cell.v === "number" && Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : "";
            return `<c r="${ref}" s="${s}"><f>${xml(cell.f)}</f>${cached}</c>`;
          }
          if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}" s="${s}"><v>${cell.v}</v></c>`;
          if (cell.v == null || cell.v === "") return `<c r="${ref}" s="${s}"/>`;
          return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xml(cell.v)}</t></is></c>`;
        })
        .join("");
      const height = sheet.heights?.[rowIndex + 1];
      return `<row r="${rowIndex + 1}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");
  const freeze = sheet.freeze
    ? `<pane xSplit="1" ySplit="${sheet.freeze}" topLeftCell="B${sheet.freeze + 1}" activePane="bottomRight" state="frozen"/><selection pane="topRight"/><selection pane="bottomLeft"/><selection pane="bottomRight" activeCell="B${sheet.freeze + 1}" sqref="B${sheet.freeze + 1}"/>`
    : "";
  const cols = sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const merges = sheet.merges?.length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const filter = sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr>${sheet.tab ? `<tabColor rgb="FF${sheet.tab}"/>` : ""}<pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="17"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
${filter}${merges}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;LVentory · ${xml(sheet.name)}&amp;R&amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`;
}

/* ------------------------------------------------------------------ table tabs */

type ColType = "text" | "date" | "money" | "int" | "pct" | "num1";
interface Col {
  h: string;
  w: number;
  type: ColType;
  total?: "sum" | "count" | "avg";
  bold?: boolean;
  wrap?: boolean;
  color?: string;
}
type Val = string | number | null | { f: string; v?: number | null };

function cellFor(col: Col, value: Val, zebra: boolean): XCell {
  const base: Style = { border: true, fill: zebra ? FAINT : undefined, bold: col.bold, color: col.color, wrap: col.wrap };
  const fmt: Fmt | undefined = col.type === "money" ? "money" : col.type === "pct" ? "pct" : col.type === "int" ? "int" : col.type === "num1" ? "num1" : col.type === "date" ? "date" : undefined;
  if (value && typeof value === "object") return { f: value.f, v: value.v ?? undefined, s: { ...base, fmt, align: col.type === "date" ? "left" : "right" } };
  if (col.type === "date") return { v: typeof value === "string" ? serial(value) : null, s: { ...base, fmt: "date", align: "left" } };
  if (col.type === "money") return { v: typeof value === "number" ? Math.round(value) / 100 : null, s: { ...base, fmt: "money" } };
  if (col.type === "pct") return { v: typeof value === "number" ? Math.round(value * 10000) / 10000 : null, s: { ...base, fmt: "pct" } };
  if (col.type === "int" || col.type === "num1") {
    if (typeof value === "string" && value) return { v: value, s: { ...base, align: "right", color: MUTED } };
    return { v: typeof value === "number" ? value : null, s: { ...base, fmt } };
  }
  return { v: value == null ? "" : String(value), s: base };
}

function tableSheet(name: string, title: string, sub: string, cols: Col[], rows: Val[][], tab = ACCENT): Sheet {
  const last = colName(cols.length - 1);
  const head = 3;
  const out: (XCell | null)[][] = [];
  out.push([{ v: title, s: { bold: true, size: 15, color: ACCENT } }]);
  out.push([{ v: sub, s: { italic: true, size: 9.5, color: MUTED, wrap: true } }]);
  out.push(cols.map((c) => ({ v: c.h, s: { bold: true, color: "FFFFFF", fill: ACCENT, border: true, wrap: true, align: c.type === "text" || c.type === "date" ? "left" : "right" } as Style })));
  rows.forEach((r, ri) => out.push(cols.map((c, ci) => cellFor(c, r[ci] ?? null, ri % 2 === 1))));
  if (!rows.length) out.push([{ v: "Nothing here for this period.", s: { italic: true, color: MUTED } }]);
  const firstData = head + 1;
  const lastData = head + rows.length;
  if (rows.length && cols.some((c) => c.total)) {
    out.push(
      cols.map((c, ci) => {
        const col = colName(ci);
        if (ci === 0) return { v: "Total (follows the filter)", s: { bold: true, top: true, fill: ACCENT_SOFT } };
        if (!c.total) return { v: "", s: { top: true, fill: ACCENT_SOFT } };
        const fn = c.total === "count" ? 103 : c.total === "avg" ? 101 : 109;
        const nums = rows.map((r) => {
          const v = r[ci];
          if (typeof v === "number") return c.type === "money" ? v / 100 : v;
          if (v && typeof v === "object") return v.v ?? 0;
          return null;
        }).filter((n): n is number => n != null);
        const cached = c.total === "count" ? rows.filter((r) => r[ci] != null && r[ci] !== "").length : c.total === "avg" ? (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0) : Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
        return { f: `SUBTOTAL(${fn},${col}${firstData}:${col}${lastData})`, v: cached, s: { bold: true, top: true, fill: ACCENT_SOFT, fmt: c.type === "money" ? "money" : c.type === "pct" ? "pct" : c.total === "avg" ? "num1" : "int", align: "right" } };
      }),
    );
  }
  return {
    name,
    rows: out,
    widths: cols.map((c) => c.w),
    merges: [`A1:${last}1`, `A2:${last}2`],
    freeze: head,
    filter: rows.length ? `A${head}:${last}${lastData}` : undefined,
    heights: { 1: 26, 2: 32, 3: 32 },
    tab,
    landscape: cols.length > 7,
  };
}

/* ------------------------------------------------------------------ tabs */

function groupSheet(name: string, title: string, sub: string, first: string, rows: Group[]): Sheet {
  const cols: Col[] = [
    { h: first, w: 34, type: "text", bold: true, wrap: true },
    { h: "Sold", w: 8, type: "int", total: "sum" },
    { h: "Money in", w: 13, type: "money", total: "sum" },
    { h: "Cost of sales", w: 13, type: "money", total: "sum" },
    { h: "Left after cost", w: 14, type: "money", total: "sum", bold: true },
    { h: "Margin", w: 9, type: "pct" },
    { h: "Average sale", w: 12, type: "money" },
    { h: "Days to sell (avg)", w: 11, type: "int" },
    { h: "Still here", w: 9, type: "int", total: "sum" },
    { h: "Stock at cost", w: 13, type: "money", total: "sum" },
    { h: "Sell-through", w: 11, type: "pct" },
  ];
  const r0 = 4;
  return tableSheet(
    name,
    title,
    sub,
    cols,
    rows.map((g, i) => {
      const r = r0 + i;
      return [
        g.label,
        g.soldUnits,
        g.revenue,
        g.cost,
        { f: `C${r}-D${r}`, v: g.profit / 100 },
        { f: `IF(C${r}=0,"",E${r}/C${r})`, v: g.margin },
        g.avgSale,
        g.avgDays,
        g.stockUnits,
        g.stockCost,
        { f: `IF(B${r}+I${r}=0,"",B${r}/(B${r}+I${r}))`, v: g.sellThrough },
      ];
    }),
  );
}

function summarySheet(md: Model, tabs: { name: string; what: string; rows: number }[]): Sheet {
  const m = md.m;
  const rows: (XCell | null)[][] = [];
  const heights: Record<number, number> = { 1: 34, 2: 20, 3: 18 };
  rows.push([{ v: "Ventory", s: { bold: true, size: 22, color: BONE, fill: NIGHT } }, { v: "", s: { fill: NIGHT } }, { v: md.title.toUpperCase(), s: { bold: true, size: 9, color: "8FB89A", fill: NIGHT, align: "right" } }]);
  rows.push([{ v: md.periodLabel, s: { bold: true, size: 12, color: ACCENT } }]);
  rows.push([{ v: `${md.generated} · sales counted inside the period · stock as of ${dayLong(md.today)}${md.sample ? " · includes the sample pieces" : ""}`, s: { italic: true, size: 9, color: MUTED } }]);
  rows.push([]);
  const headRows: number[] = [];
  const head = (text: string) => {
    headRows.push(rows.length + 1);
    rows.push([{ v: text, s: { bold: true, color: "FFFFFF", fill: ACCENT, border: true } }, { v: "", s: { fill: ACCENT, border: true } }, { v: "", s: { fill: ACCENT, border: true } }]);
  };
  const kv = (label: string, value: number | string | null, fmt?: Fmt, note = "") => {
    const zebra = rows.length % 2 === 0;
    const v = value == null ? "—" : fmt === "money" && typeof value === "number" ? value / 100 : value;
    rows.push([
      { v: label, s: { border: true, fill: zebra ? FAINT : undefined } },
      { v, s: { border: true, bold: true, fmt: typeof v === "number" ? fmt : undefined, align: "right", fill: zebra ? FAINT : undefined } },
      { v: note, s: { border: true, italic: true, size: 9, color: MUTED, fill: zebra ? FAINT : undefined, wrap: true } },
    ]);
  };
  head("Money");
  kv("Money in (priced sales)", m.revenue, "money", `${m.units.priced} priced ${m.units.priced === 1 ? "sale" : "sales"}`);
  kv("Cost of sales", m.costOfSales, "money", "Cost less the buying rebate on each card");
  kv("Left after cost", m.profit, "money", "Money in − cost of sales. Fees and shipping are not on the cards.");
  kv("Margin", m.margin, "pct", "Of every dollar in, what stays");
  kv("Average sale", m.avgSale, "money");
  kv("Average left per sale", m.avgProfit, "money");
  kv("Given in price cuts", m.priceCuts, "money", "Asking price − price charged, on sales with an ask");
  if (m.rebates) kv("Buying rebates", m.rebates, "money", "Money back on purchases; already inside cost of sales");
  if (m.delivery) kv("Delivery collected", m.delivery, "money", "Charged on top of the price; not revenue or profit");
  if (md.ads.length) kv("Ad spend (all time)", m.adSpend, "money");
  head("Pieces");
  kv("Sold in the period", m.units.sold, "int", m.units.unpriced ? `${m.units.unpriced} with no price` : "");
  kv("On hand", m.units.onHand, "int", `${md.ready} ready to list`);
  kv("On the way", m.units.incoming, "int");
  kv("Stock at cost", m.stockCost, "money", "On hand + on the way");
  kv("Stock at asking price", m.stockAsk || null, "money", m.unaskedUnits ? `${m.unaskedUnits} pieces have no ask` : "");
  kv("Sell-through", m.sellThrough, "pct", "Sold ÷ (sold + still waiting)");
  kv("Days to sell (median)", m.days.median, "int", m.days.n ? `${m.days.n} sales with both dates` : "No sale has both dates");
  kv("Average days on hand", m.aging.avg, "int");
  kv("Archive / kept", `${m.units.archived} / ${m.units.kept}`);
  rows.push([]);
  rows.push([{ v: "In one sentence", s: { bold: true, color: ACCENT } }]);
  rows.push([{ v: md.advice.headline, s: { wrap: true, size: 11 } }]);
  heights[rows.length] = 48;
  rows.push([]);
  head("Tabs in this workbook");
  tabs.forEach((t, i) => {
    const zebra = i % 2 === 1;
    rows.push([
      { v: t.name, s: { bold: true, border: true, fill: zebra ? FAINT : undefined } },
      { v: t.rows, s: { border: true, fmt: "int", align: "right", fill: zebra ? FAINT : undefined } },
      { v: t.what, s: { border: true, wrap: true, size: 9, color: MUTED, fill: zebra ? FAINT : undefined } },
    ]);
  });
  rows.push([]);
  rows.push([{ v: "Tip: every tab has filters on its title row and a totals row that adds up only what you leave visible. Money in, Left after cost and Margin are live formulas.", s: { italic: true, size: 9, color: MUTED, wrap: true } }]);
  heights[rows.length] = 30;
  const merges = ["A2:C2", "A3:C3", ...headRows.map((r) => `A${r}:C${r}`)];
  rows.forEach((row, i) => {
    if (row.length === 1 && i > 3) merges.push(`A${i + 1}:C${i + 1}`);
  });
  return { name: "Summary", rows, widths: [34, 16, 62], merges, heights, tab: NIGHT };
}

const pieceCols = (sold: boolean): Col[] => sold
  ? [
      { h: "Piece", w: 40, type: "text", bold: true, wrap: true },
      { h: "Sold on", w: 13, type: "date" },
      { h: "Type", w: 10, type: "text" },
      { h: "Brand", w: 14, type: "text", wrap: true },
      { h: "Size", w: 10, type: "text" },
      { h: "Qty", w: 6, type: "int", total: "sum" },
      { h: "Cost each", w: 11, type: "money" },
      { h: "Rebate each", w: 11, type: "money" },
      { h: "Sale each", w: 11, type: "money" },
      { h: "Money in", w: 12, type: "money", total: "sum" },
      { h: "Left after cost", w: 13, type: "money", total: "sum", bold: true },
      { h: "Margin", w: 9, type: "pct" },
      { h: "Arrived", w: 13, type: "date" },
      { h: "Days to sell", w: 9, type: "int", total: "avg" },
      { h: "Channel", w: 18, type: "text", wrap: true },
      { h: "Client", w: 16, type: "text", wrap: true },
      { h: "Bought from", w: 14, type: "text", wrap: true },
      { h: "Notes", w: 30, type: "text", wrap: true },
    ]
  : [
      { h: "Piece", w: 40, type: "text", bold: true, wrap: true },
      { h: "Status", w: 11, type: "text" },
      { h: "Type", w: 10, type: "text" },
      { h: "Style", w: 12, type: "text", wrap: true },
      { h: "Brand", w: 14, type: "text", wrap: true },
      { h: "Size", w: 10, type: "text" },
      { h: "Fit", w: 8, type: "text" },
      { h: "Qty", w: 6, type: "int", total: "sum" },
      { h: "Cost each", w: 11, type: "money" },
      { h: "Asking each", w: 11, type: "money" },
      { h: "Cost total", w: 12, type: "money", total: "sum" },
      { h: "Asking total", w: 12, type: "money", total: "sum" },
      { h: "Margin at ask", w: 10, type: "pct" },
      { h: "Arrived", w: 13, type: "date" },
      { h: "Days waiting", w: 9, type: "int", total: "avg" },
      { h: "Place", w: 8, type: "text" },
      { h: "Bought from", w: 14, type: "text", wrap: true },
      { h: "Problem", w: 14, type: "text" },
      { h: "Notes", w: 30, type: "text", wrap: true },
    ];

const PLACE: Record<string, string> = { home: "Home", car: "Car" };

function stockRows(pieces: Piece[], today: string): Val[][] {
  return pieces.map((p, i) => {
    const r = 4 + i;
    return [
      p.name || "Untitled",
      STATUS_LABEL[p.status] === "Available" ? "On hand" : STATUS_LABEL[p.status] === "Incoming" ? "On the way" : STATUS_LABEL[p.status],
      p.category,
      p.subcategory,
      p.brand,
      sizeName(p),
      p.fit,
      p.qty,
      p.costCents,
      p.askCents || null,
      { f: `H${r}*I${r}`, v: (p.costCents * p.qty) / 100 },
      { f: `IF(J${r}="","",H${r}*J${r})`, v: p.askCents ? (p.askCents * p.qty) / 100 : null },
      { f: `IF(OR(J${r}="",J${r}=0),"",(J${r}-I${r})/J${r})`, v: p.askCents ? (p.askCents - p.costCents) / p.askCents : null },
      p.receivedOn,
      p.status === "available" ? daysHeld(p.receivedOn, null, today) : null,
      PLACE[p.place] ?? "",
      p.source,
      p.problem,
      p.notes,
    ];
  });
}

function saleRows(pieces: Piece[], today: string): Val[][] {
  return pieces.map((p, i) => {
    const r = 4 + i;
    const priced = p.saleCents != null;
    return [
      p.name || "Untitled",
      p.soldOn,
      p.category,
      p.brand,
      sizeName(p),
      p.qty,
      p.costCents,
      p.buyRebateCents || null,
      p.saleCents,
      priced ? { f: `F${r}*I${r}`, v: ((p.saleCents ?? 0) * p.qty) / 100 } : null,
      priced ? { f: `J${r}-F${r}*MAX(0,G${r}-N(H${r}))`, v: (((p.saleCents ?? 0) - netCost(p)) * p.qty) / 100 } : null,
      priced ? { f: `IF(J${r}=0,"",K${r}/J${r})`, v: p.saleCents ? ((p.saleCents ?? 0) - netCost(p)) / (p.saleCents ?? 1) : null } : null,
      p.receivedOn,
      daysHeld(p.receivedOn, p.soldOn, today),
      p.channel,
      p.clientName,
      p.source,
      p.notes,
    ];
  });
}

export function reportXlsxBytes(md: Model): Uint8Array {
  const m = md.m;
  const sheets: Sheet[] = [];
  const guide: { name: string; what: string; rows: number }[] = [];
  const add = (sheet: Sheet, what: string, count: number) => {
    sheets.push(sheet);
    guide.push({ name: sheet.name, what, rows: count });
  };
  const stock = m.stock.slice().sort((a, b) => a.name.localeCompare(b.name) || (a.receivedOn || "").localeCompare(b.receivedOn || ""));
  add(tableSheet("Inventory", "Inventory: on hand and on the way", `Every piece waiting, as of ${dayLong(md.today)}. Cost and asking totals are formulas (qty × each).`, pieceCols(false), stockRows(stock, md.today), ACCENT), "Every piece on hand or on the way, one row each", stock.length);
  const sales = m.sales.slice().sort((a, b) => (b.soldOn || "").localeCompare(a.soldOn || ""));
  add(tableSheet("Sales", `Sales · ${md.periodLabel}`, "One row per sale. Money in = qty × sale; Left after cost = money in − qty × (cost − buying rebate); delivery is not counted. A sale with no price stays blank, never guessed.", pieceCols(true), saleRows(sales, md.today), "B08A3E"), "Every sale in the period with cost, price, profit and days to sell", sales.length);
  const months = md.months.slice().reverse();
  add(
    tableSheet("By month", "Month by month", `Dated sales only · ${md.periodLabel}`, [
      { h: "Month", w: 16, type: "text", bold: true },
      { h: "Sales", w: 9, type: "int", total: "sum" },
      { h: "Money in", w: 14, type: "money", total: "sum" },
      { h: "Left after cost", w: 15, type: "money", total: "sum", bold: true },
      { h: "Cost of sales", w: 14, type: "money", total: "sum" },
      { h: "Margin", w: 10, type: "pct" },
    ], months.map((p, i) => {
      const r = 4 + i;
      return [p.label, p.units, p.revenue, p.profit, { f: `C${r}-D${r}`, v: (p.revenue - p.profit) / 100 }, { f: `IF(C${r}=0,"",D${r}/C${r})`, v: p.revenue ? p.profit / p.revenue : null }];
    }), "5F8F72"),
    "Sales, money in, cost and margin for each month",
    months.length,
  );
  add(groupSheet("By product", "By product", "Each product: what sold, what it left, how fast, and what is still here.", "Product", m.byProduct), "Each product ranked by what it left after cost", m.byProduct.length);
  if (m.byCategory.length > 1) add(groupSheet("By type", "By type", "Boots, watches, hats… compared.", "Type", m.byCategory), "Each type of piece compared", m.byCategory.length);
  if (m.byBrand.some((g) => g.label !== "No brand")) add(groupSheet("By brand", "By brand", "Pieces with no brand are grouped as No brand.", "Brand", m.byBrand), "Each brand compared", m.byBrand.length);
  add(groupSheet("By size", "By size", "Which sizes sell and which sit. Sell-through = sold ÷ (sold + still here).", "Size", m.bySize.slice().sort((a, b) => b.soldUnits - a.soldUnits)), "Each size: sold, still here, sell-through, days to sell", m.bySize.length);
  add(groupSheet("By source", "Bought from", "Each place you buy from, judged by what sold.", "Bought from", m.bySource), "Each source judged by its sales", m.bySource.length);
  if (m.byChannel.some((g) => g.label !== "Not recorded")) add(groupSheet("By channel", "Where they sold", "Channels named on the sales.", "Channel", m.byChannel), "Where each sale happened", m.byChannel.length);
  if (m.byClient.some((g) => g.label !== "Not recorded")) add(groupSheet("Clients", "Clients", "Buyers named on the sales.", "Client", m.byClient.slice().sort((a, b) => b.revenue - a.revenue)), "Each buyer named on a sale", m.byClient.length);
  add(
    tableSheet("Aging", "How long the pieces on hand have waited", `Days since arrival, as of ${dayLong(md.today)}. ${m.aging.undated} on hand have no arrival date.`, [
      { h: "Waiting", w: 14, type: "text", bold: true },
      { h: "Pieces", w: 10, type: "int", total: "sum" },
      { h: "Cost tied up", w: 15, type: "money", total: "sum" },
      { h: "Share of pieces", w: 14, type: "pct" },
    ], m.aging.buckets.map((b, i) => {
      const r = 4 + i;
      return [b.label.replace("–", " to ").replace(" d", " days"), b.units, b.cost, { f: `IF(SUM($B$4:$B$8)=0,"",B${r}/SUM($B$4:$B$8))`, v: m.units.onHand ? b.units / Math.max(1, m.aging.buckets.reduce((s, x) => s + x.units, 0)) : null }];
    }), "C47B4A"),
    "Pieces on hand by how long they have waited",
    m.aging.buckets.length,
  );
  if (md.restock.length) {
    add(
      tableSheet("Buy again", "Buy again: products that sold more than once", "Fastest movers first. Weeks of stock = still here ÷ the last 90 days' pace.", [
        { h: "Product", w: 34, type: "text", bold: true, wrap: true },
        { h: "Best size", w: 11, type: "text" },
        { h: "Sold", w: 8, type: "int", total: "sum" },
        { h: "Sold, last 90 days", w: 11, type: "int", total: "sum" },
        { h: "Days to sell (avg)", w: 11, type: "int" },
        { h: "Left per sale", w: 12, type: "money" },
        { h: "Still here", w: 9, type: "int", total: "sum" },
        { h: "Weeks of stock", w: 10, type: "int" },
      ], md.restock.map((r) => [r.product, r.size ?? "", r.sold, r.recent, r.avgDays, r.profitEach, r.left, r.weeksLeft]), "5F8F72"),
      "What sold more than once, with its pace and the stock left",
      md.restock.length,
    );
  }
  if (md.move.length) {
    const pieces = md.move.flatMap((g) => g.pieces.map(({ piece, days }) => ({ g, piece, days })));
    add(
      tableSheet("Move", "Move: pieces past their usual selling time", "Try = about 10% off the usual ask (20% past 90 days), never under cost. Fees and shipping are not on the cards.", [
        { h: "Piece", w: 40, type: "text", bold: true, wrap: true },
        { h: "Size", w: 10, type: "text" },
        { h: "Waiting (days)", w: 10, type: "int" },
        { h: "Usually sells in (days)", w: 12, type: "int" },
        { h: "Cost", w: 11, type: "money", total: "sum" },
        { h: "Asking", w: 11, type: "money" },
        { h: "Try", w: 11, type: "money", bold: true },
      ], pieces.map(({ g, piece, days }) => [piece.name, sizeName(piece), days, g.pace, piece.costCents * piece.qty, piece.askCents || null, g.cut]), "A33B32"),
      "Every piece that has outstayed its product's selling time, with a price to try",
      pieces.length,
    );
  }
  if (md.price.length) {
    add(
      tableSheet("Pricing", "Price from your own sales", "What buyers paid for each product against today's asks. Suggested ask = the usual (median) price, never under cost.", [
        { h: "Product", w: 34, type: "text", bold: true, wrap: true },
        { h: "Priced sales", w: 9, type: "int" },
        { h: "Lowest paid", w: 12, type: "money" },
        { h: "Usual paid", w: 12, type: "money", bold: true },
        { h: "Highest paid", w: 12, type: "money" },
        { h: "Usual cost", w: 12, type: "money" },
        { h: "Suggested ask", w: 13, type: "money", bold: true, color: ACCENT },
        { h: "Still here", w: 9, type: "int", total: "sum" },
        { h: "Asks under cost", w: 10, type: "int", total: "sum", color: RED },
        { h: "Asks above any sale", w: 11, type: "int", total: "sum", color: AMBER },
        { h: "No ask yet", w: 9, type: "int", total: "sum" },
      ], md.price.map((r) => [r.product, r.sales, r.low, r.median, r.high, r.cost, r.suggest, r.stock, r.below, r.above, r.unasked]), "B08A3E"),
      "The price range buyers paid per product, against today's asks",
      md.price.length,
    );
  }
  const everything = md.pieces.filter((p) => !isSale(p) && !isStock(p));
  if (everything.length) {
    add(tableSheet("Archive and kept", "Archive and kept", "Pieces removed without a sale, and pieces you kept. Neither is a sale nor stock.", pieceCols(false), stockRows(everything, md.today), "4F7F8A"), "Removed without a sale, and kept for yourself", everything.length);
  }
  return packWorkbook([summarySheet(md, guide), ...sheets]);
}

function packWorkbook(sheets: Sheet[]): Uint8Array {
  const styles = new Styles();
  const encoder = new TextEncoder();
  const used = new Set<string>();
  for (const s of sheets) {
    let name = s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    s.name = name;
  }
  const sheetFiles = sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: encoder.encode(sheetXml(sheet, styles)) }));
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Ventory</dc:title><dc:creator>Ventory</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;
  const abs = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, "$$$1$$$2");
  const quoted = (name: string) => `'${xml(name.replace(/'/g, "''"))}'`;
  const filters = sheets
    .map((sheet, index) => {
      if (!sheet.filter) return "";
      const [from, to] = sheet.filter.split(":");
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${quoted(sheet.name)}!${abs(from ?? "A1")}:${abs(to ?? "A1")}</definedName>`;
    })
    .join("");
  const printTitles = sheets.map((sheet, index) => (sheet.freeze ? `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${quoted(sheet.name)}!$${sheet.freeze}:$${sheet.freeze}</definedName>` : "")).join("");
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
${filters || printTitles ? `<definedNames>${filters}${printTitles}</definedNames>` : ""}
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  return storeZip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypes) },
    { name: "_rels/.rels", data: encoder.encode(rels) },
    { name: "docProps/core.xml", data: encoder.encode(core) },
    { name: "xl/workbook.xml", data: encoder.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: encoder.encode(workbookRels) },
    { name: "xl/styles.xml", data: encoder.encode(styles.xml()) },
    ...sheetFiles,
  ]);
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(data: Uint8Array) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const head = new Uint8Array(30 + name.length);
    const view = new DataView(head.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(12, 0x5821, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    head.set(name, 30);
    local.push(head, file.data);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(14, 0x5821, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, file.data.length, true);
    dv.setUint32(24, file.data.length, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += head.length + file.data.length;
  }
  const centralLength = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralLength, true);
  ev.setUint32(16, offset, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
