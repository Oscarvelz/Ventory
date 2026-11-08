import { daysHeld, PROBLEMS, STATUS_LABEL, type Piece } from "../model";
import { isSale, isStock, netCost, sizeName, type Group } from "../metrics";
import { dayLong, type Model } from "./model";

/**
 * Ventory's worksheet (1.1.1): a real .xlsx with a financial report's finish, written the
 * family's way (hand-built OOXML in a stored zip, no library, works offline and in the
 * Android app). Every tab wears the report's charcoal title band with the V mark, a
 * "Back to Summary" link and the PDF's palette. Data tabs are real Excel Tables (filters,
 * a totals row that follows the filter, frozen header), money is currency, dates are
 * dates, derived money is live formulas, and the numbers carry quiet conditional
 * formatting (data bars, colour scales, status pills, negatives in rust). The Summary is
 * a dashboard: KPI tiles, the one sentence, native charts and a linked table of contents.
 * Print setup is landscape, one page wide, header row repeated, "Page n of N" footers.
 * Opens without a repair prompt in Excel (desktop and Android), Google Sheets and LibreOffice.
 */

/* ------------------------------------------------------------------ palette (the PDF's) */

const INK = "1A1C17";
const MUTED = "5C5850";
const SUBTLE = "8A8478";
const RULE = "DDD6C8";
const HAIR = "ECE7DD";
const CREAM = "F7F4EE";
const BAND = "FAF8F3";
const NIGHT = "16181A";
const NIGHT_INK = "9A968C";
const BONE = "F3F0E8";
const SAGE = "8FB89A";
const ACCENT = "3F6B50";
const ACCENT_SOFT = "E4EEE7";
const GREEN = "5F8F72";
const GREEN_BAR = "BFD6C6";
const AMBER = "B08A3E";
const AMBER_INK = "8A6A2C";
const AMBER_SOFT = "F4EAD3";
const AMBER_BAR = "E8D7AE";
const RED = "A33B32";
const RED_SOFT = "F6E6E3";
const BLUE = "5D86AD";
const BLUE_SOFT = "E3ECF5";
const COPPER = "C47B4A";
const COPPER_BAR = "EBCBB3";
const TEAL = "4F7F8A";
const PLUM = "7D5A86";
const PLUM_SOFT = "EEE6F0";
const STONE_SOFT = "EEEBE4";
const WHITE = "FFFFFF";
const FONT = "Calibri";

/** The app's V mark (bone V, sage chip) as a small transparent PNG for the title band. */
const VMARK_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAFYAAABQCAYAAACDD4LqAAAQy0lEQVR42u1de5BkVXn/vnPuvf26j+6ex+7MIhCMPIIVElg0liSZtSIVTDSJqV0NaAxlCchLQZa3NbuGqCUKxmgUjCSxLIk9/0gKQ6EmM1VxiYpAoFh2mT8QCTuzy8x093103+c5X/7o7tneqd2Zne47D2RP1f7Xc885v/s73/l93++cuwjtRkQIa9gQkWATtbWe7xuyrQeo2OnIdWcHpYwTAEQLzFTYZYMNlnU6AIAHAAliq7vNAO709LT5luFhxQYgK6Vn2gBgWRY5ziGuEBEDAKAEv2GYgzs8xxEe83kas+eUETJpcM91f2yVR3YREdvIkNCeKwX1w2eAou5rUpTlQoKL/TMYAYBJkkkIKpJyGxIRR0TRqM++Tcvlf5ZEEQCmt1IQEQiAUNBbM8bAgYmJCbZr1y6x0lLdA4AvTEyc1EB+a+d+2gt7CXD51UBECiImbu3wZ/Xi0B2ePQeKoqQyTykl5HUdPMc5oFtbLlQQUbTB/bldnfmWWSp91K3XYwBQUsI2MYol1alXr80iXk+Tk8uBhZVKhSGi6CVkVCoVfqKX1o6rYm5uzgBMrgybdQIAGccxS2meQkqpIODNiBhg9xJpNudHQNJBhqwQxzEi9k9dIiJVVUGIxC5A7jfBNKsrqYQvTj4wmGHq6XEYLT/pGEBVFcCc4j/3whPTD179YDw+Ps727t0rT8RWzz5yZcG0HnJqVcEY4ymFGGGYJnds+8dWefTdRMQXgZucnFR27NiRONXDdxml0j1ObSHNjhOjWFa8eu0mo7T1y51Jdv0Ax/fsQTj/fKVsOZ/lKvsbKWngpJ8viZjCp6PA3/Op91z7b+M0zvbiseCOjxODPXvgU7Vrnszrhd/1m00JADylcCcVVZNJEG3Xy1ueIyKGS5YKAsxkG46yX9W0M8IgIERkKQArs7kcC5rNaaM081aAixJABGwv9w4Q9z/2je9YQ+UrnAUbpJSrCQWoZTRQMxoETuMDn7jsqkp3WOjsI25tdixXKEw2Gw2ZxrzasVWYpQHu1BYetMqjV3f6YksEPCJuayYiuUvLZhGIKKU3ygLfF7plnd2sbftjRCRoq5FKpcL34l5532P/+PvZQv4Ke74eSykJV9cgCqMkCiMSQF/80hOV3K6dOyUQHBPKJMkbuKICAMqUViJpmoZNz7bDJNozPj7OOnsDWwKAICJulUYfduv1/ykYBicikabkEQxu7IwLAGD/0FBr8qi8i3FOQNRTbEdEJQ4jUFTlTVR3zgVEqkxUWFviCb9+5M2Kqv1pw3UIEdIKcTJbMFgcxZ8bHj5zdmxsjCG2Xho7Yfop2W4hBGBK0gsRecNxSFW1Ha57+LcRkSqVyuIECSHbSVj6TZ1561mdxgAAEqCr8rqpSSlFGv0Qkczl8qzh1F+yyuIrRMTGxsbEMZ0ej7XmwJZ9frP5Pd2yeHsw/b9hAJHNFzgIug4AaOfOnUf7pdQyMpQk26thPwKAmJ+fNgnoI2HTg7RiKwCQmtGQSN6OeLrfgu6o0mHLhA/UEO/wG01fURSkdOIt9z2XEPGDrjs7jIji/Lk5BmvU3r7t7RwRSePmBwyrtCUMQ7HMnFclr3TD4E69vs8ojkx0NixYukyOJx8AgOVKI7+Mo/Dv84bFAECksEwxSRJRMEsmJuwjAABDFw+tGbDeW7yEaJwByWtFHBFj6XTFGIM4jgkku+WEv1lOSRARE5D9fNOpz2pahhNRGrspi8MmSRJXT09PZ+bOnIvXCthduEt49WvGcrr+O81Gg9LQrVJKUTAtHvj+w9bg1p8ej63LAtuRX+Vy2RYyGc/k86mEg5b0CqRhFd+8dcj6k124S8AaNgl0o6IonVWYRhaJQaPRULPZO9van1bL2M5Gxozi6EOeXfvfgq6nJ7+IiEjckMYOvbQpTGFEhLb96tmqql3WcB0iSkViiZxusiiO7svny78CAHaiF8ZOMjQKALwVEVMpfCEi9zyXtEzmD+fnX7mYiJCnlD4DAHFkCiISJXhNrmBoUpJoJXr9ySstk+ENp37ILCr3tusrspcYe4z8Mopbf9Rw3Ed1Mx35RUQymy8gR3Z9K+xglMZyBQK0o3qViLKc8b8Om14qsZWIKJPLo5DybsQhd6m86oWxi/ILVO3WwPdjzjlS/7qT+55Lqqr9JRFZTsN7jCQxAqSeYjlBomoqiES8dtcvPvlC4C5coRdLA1EUiX6rdEQkCrrBXbv2tFnc+u1ONrfsDn2y1RsAYKY5eCAK/AcKZpEB9BdrF6WXYeVd+8j1n/6LTzzhe81/Lw4WVWxVx+Vq/nFVUTK5LBLQbvwMyjAJbxJRCGmUPlvDIUCCW9pYrPhMXMVbQ4A96LpXlTmoL3LOi3Ecr4b1xw8H2SwLguAVt3novEdnZyCsz98PCB/ijOVPdoStRAv/Lwrie25+z8cedOuH350rFH7Y9FyJ2J94lVIKs1jiTq32iDUw+ucnklc9A9tds3Vrhz+pF0v3p1GzJSJhWBb3HPuDRnHkewAA9z76T2fkTfXMJIqZCCWe0MtIADIZRsi5f2Su8fzeXdd7AABObeYRwyq+z3OcBPpwQoiIOGfEuBpHibjANAen24tNpgrs0ZotKF79yHOZXPbswPf7qtkSkSgYBvccZ59VHr3kgV88oF69/eqekobxyXHljguvO0ty9rwUQmmHauxjbIlRLCtubf5+s7zt5pNla0+dLpqP1cN/lrfM77uOLRCx311XapkMBo3gHebA1p8/9dRTyksvvXTSCmECAG476yy2ffv22KnO3meUyje59WqCiP34dlJVVRCJqCYQnWua22oAQCfrMmOPb5IjonCqM/+pW9a7PMfpC9wWM4qKXa9/p1ga+fBqmNFZSYgItdovLRXz04qqDEVRRP1sXB1nwK5VbyiWR7662jH1uIQnWn+Myu4oDGUKOy9vui6pnL+/0Zg/rZPxrebvAYCQMpcXrOJQFEVJP2MiIpkvFJhXrx2wSlsfWCkZSA1YxF2CiLheGn468oN/1a0i6ydpQEQUQoi8YeVFmHy0h7G1LXz4eBIFfSmVxeyNK4iMdiNivFIykFooaL/VRcscJR4EhELSh2VORDKTybAwDF81mvIcGB31u4pBK4alev3IpUYh/3jD9SSy/jZT3TS5Z9s/Msujl642BPQZClpJw9TUFC8UhmaSOPpCrmCwfsqKiMjCIBRGsXiak8P3twHlJx2WSNzIGIeVTsOshCtDxCgIBQO+u/v5q55Pnxq0I7+ynn3kBS2TOb0fy7yVOurMc90nzdLo77U24RNrxnZqKQN77hzJ4HkhBO9nTotW9sLCN63B0at6ZWvfsQgRaWpqiiFiEwDu7NcyR0Te9DzK5fNvc5wj70BESUQnZu3UFAMAiCi5JqebSj8lzY6V7XuOzaUy3m1lrzuwAAA7duxIKpUK160tD7u12k8LhtlXzZYApZrJAAhx44qrZWxMUL1eYsA+HDTdvqpYHSs7Ecnn9OHhY6zsdQ8FSzeQpnPknYqW/UkU+IJ6nGQrjeQAAGGYJOeWy6O/6iz5Jb9rnRysz16nW+Wv9pMQtGoWOQzD4GXdis4HeFO4mmRgTRjbXbPNm1v2+U2vUujDMu+SXlmV48eWGaeYnJxUiCgNiUVqJoMAdFwre8MY2y2/gqB+Jki5XwqREUL0JL+IiDKZDEZRNNMM8Zzh4eFGt/TqrBB7YeYy3TL/o+E4Enu0YDtWtuu6+6zSyCX9bFipM7a7ZpvLlX4ZheFX8obVs/xCRAyCQOhWcTSryZ1LpdfEREsCIcPrERlAP0u2bWUrDG+BFFuqRl5HftVqNUPl0UFN1YbDMOz19InI5fOs6XlPG6WRizvlus5x+/n5mfPyWe1ZmSScepxHS16VuVOrftcqj16RFltTZWzXUm1Z5okc13J51odlzpuNBuUK+kWuO/cHiEhExKdaEotUDh/PFQxF9qhAOla23/CaEvGu5azsDQe2QwQiYlZ55FuuXXu2ZZn3eooGpaKqQIm4oT1pHBsbE/X6K2XO+OVBwwXoXX3InG6yOA7vK5VGXoZlrOxNAezRc7YoEHA3Ius5BCICb7gOKaryXr9++CwAEK3ThOqHCmax3KtRSEQyk80yz6nPxCJzby/Vq41g7DGWuevaP+jDMkcppcjrphaDvKYdDjQpWhKrj4IPZXJ5lFLePTg46KQhr9Z08zqe/ArdhXOJs2dFEvPWQe1V9ylVVUWRJAt5c3hLw37tj3K6/rjn2JL1ILGISOQLBd70Gs8Ypa3buxQNbHrGdsuvrDl4IIqCfixzFoahzJulQc8+8leS6ErGlZ6zog7JEU/eyt5UwHbYNj4+zpDre5uuXdU0radYhojM9xwCoi8jwvt818ZerCAppdBNizca3iNGaeS/0pRX6xYKltYR7NrMTWZx4L5eLXMiAkVRQEoJUtKqz5ARETHOSVGUGGJxQWYVVvZmZOyi/DKLI1/z7NqLuXy+p4wMESFJEmrdqOlpHKJgWCzwg69nraEX05ZX6w5sl/yKiOB2VdV6FuKLd496eLmaprGmZ8+jIu9ZC3m1EYw9emGktPX7jl2f1E0z9WtOK8RWyuR1FsfxZyzrtIW1kFfrHmOXxlqv9tqFSkZ9Mo7CTv9rPQaRzeVY4PsHdWvLBdC6S0FrDSxbL2A7rNVLw08HfvPbbctcrsMLBc4VlEi39mplb2rGdicNi5Y5UCFJklRumZ9g1xSGaXK3+1b2GsmrDWNsJ2noWOZRHN2b002W0k2c475HjohRGAqObSt7YmL95grr3Do128OHD+f0PNuvadrpad0yX9JPYhRLilOrftMq92dlb3rGduTX1NQUGxkZaQiR3KVlc6ndMu9OBlRVZX7DtbmmjKdda92UwAK0LPP2LfPvurXqz9K+Zb5oZUfR53V9eHZqaoqvZTKwKULBUvnlVA9dki3o/x35vVvmS0HNZLMYRdHLuhmmYmW/bhh7TNJQ3vYTv+FNFNK7ZU5aJouC5B1pWdmvK8Z2yy/bPvIbGVV9vh/LvP08UTAM3nCcJ8zy6DvXe8PaFIztll/F4taXwtD/h35vmTOGkMQJEWe3wAa3Df9w4tETizWj6SQHFVXpyTI/amXPP2yVT7t8I9m64YztyC+YmmKIZVtQb5b50VvZXlNDfudGyKtNBywAAIyNCSJiTz1z4CHPrj2b13W2SvnVupUdhvfnSiMvb4S82nShYKn88uqHLs0VrMebnivgJOyX9q1sTOJ4Noj5eQMDA95GyKvNydgu+aUXt/2w4Tk/aH3kZ2XWdt3K/vTg4KDTPgi94Z9S3TTAduGEwOHWwA9izhnSMrGyfbSeu7XaM2Zx679UKhW+Y8eOZDNMRNlMqHaOxpvm6Av2wsyDZnngOrdeTeAEB4pbchdBVVtW9rLH6t/gjAXoWOYq7G16dlXVtOOqhI6V7TfcR3LG2lrZr3vGduRX+6jmnF2b+TuzaH0pjqrH3OJuH6fHwG9GxOn2zSCvXg+MBVi0zL2vefXqdDaXW/ppKlEwiywM/K+b5raDsMZW9q8NsEct87NDBnjbEstcaprGfM+ZR8X42/Wwsn/tWmczshcOTcqkQU5tNnFqszFRSG519obu35xqqwK29bXOen3mosCvCac2m8Rhndza7AEiUomInfqPIvpkrVOd+WcpGhSHNtnV2feeYmv/wDIiQs97bSRo1qRdnZk8BWrKrK3Pv3q3W5sdIyLs/qjvqdYfuKdi6VqCewrgN3j7fyVHNTTsx5hDAAAAAElFTkSuQmCC";

/* ------------------------------------------------------------------ cell model */

type Fmt = "date" | "money" | "int" | "pct" | "num1" | "days" | "rows" | "dot" | "month";
const FMT_ID: Record<Fmt, number> = { money: 164, date: 165, num1: 166, pct: 167, int: 168, days: 169, rows: 170, dot: 171, month: 172 };
const FMT_CODE: Record<Fmt, string> = {
  money: `"$"#,##0.00;-"$"#,##0.00;"–"`,
  date: "mmm d, yyyy",
  num1: "0.0",
  pct: "0%",
  int: "#,##0",
  days: `#,##0" days"`,
  rows: `[=1]0" row";#,##0" rows"`,
  dot: `"●  "@`,
  month: "mmm yyyy",
};

type Side = { style: "thin" | "medium" | "thick" | "hair" | "double"; color: string };
interface Style {
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "center" | "bottom";
  indent?: number;
  wrap?: boolean;
  fmt?: Fmt;
  top?: Side;
  bottom?: Side;
  left?: Side;
  right?: Side;
}
interface XCell {
  v?: string | number | null;
  f?: string;
  s?: Style;
}

/** Conditional-format feature styles (dxf). */
interface Dxf {
  color?: string;
  bold?: boolean;
  fill?: string;
  top?: Side;
}

type CF =
  | { kind: "expr"; sqref: string; formula: string; dxf: Dxf }
  | { kind: "less0"; sqref: string; dxf: Dxf }
  | { kind: "equal"; sqref: string; text: string; dxf: Dxf }
  | { kind: "greater0"; sqref: string; dxf: Dxf }
  | { kind: "scale"; sqref: string; colors: [string, string, string] }
  | { kind: "bar"; sqref: string; color: string };

interface ChartSeries {
  name: string;
  ref: string;
  values: (number | null)[];
  color: string;
  kind: "bar" | "line";
  points?: string[];
}
interface Chart {
  from: [number, number, number?, number?];
  to: [number, number, number?, number?];
  dir: "col" | "bar";
  catRef: string;
  cats: string[];
  catNums?: number[];
  catFmt?: string;
  series: ChartSeries[];
  legend: boolean;
  labels?: boolean;
  hideValueAxis?: boolean;
  axisFmt: string;
  labelFmt?: string;
  gap?: number;
  reverse?: boolean;
}

interface Table {
  name: string;
  ref: string;
  header: number;
  first: number;
  last: number;
  totals: boolean;
  cols: { name: string; total?: string; label?: string }[];
  col0: number;
}

class Grid {
  rows = new Map<number, Map<number, XCell>>();
  heights = new Map<number, number>();
  merges: string[] = [];
  set(r: number, c: number, cell: XCell) {
    let row = this.rows.get(r);
    if (!row) this.rows.set(r, (row = new Map()));
    row.set(c, cell);
  }
  /** Merge r1..r2 × c1..c2: the value sits top-left, every cell wears the style (borders and fills stay whole). */
  merge(r1: number, c1: number, r2: number, c2: number, cell: XCell) {
    for (let r = r1; r <= r2; r += 1) for (let c = c1; c <= c2; c += 1) this.set(r, c, r === r1 && c === c1 ? cell : { s: cell.s });
    if (r1 !== r2 || c1 !== c2) this.merges.push(`${colName(c1)}${r1}:${colName(c2)}${r2}`);
  }
  fill(r: number, c1: number, c2: number, s: Style) {
    for (let c = c1; c <= c2; c += 1) if (!this.rows.get(r)?.get(c)) this.set(r, c, { s });
  }
  height(r: number, h: number) {
    this.heights.set(r, h);
  }
}

interface Sheet {
  name: string;
  grid: Grid;
  widths: number[];
  tab: string;
  freeze?: { row: number; col: number };
  tables: Table[];
  cfs: CF[];
  links: { ref: string; target: string; tip: string }[];
  charts: Chart[];
  printTitle?: number;
  landscape: boolean;
  breaks?: number[];
}

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

const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;
const absRange = (sheet: string, c: number, r1: number, r2: number) => `${quoted(sheet)}!$${colName(c)}$${r1}:$${colName(c)}$${r2}`;

/* ------------------------------------------------------------------ styles */

class Styles {
  fonts = [`<font><sz val="10"/><color rgb="FF${INK}"/><name val="${FONT}"/><family val="2"/><scheme val="none"/></font>`];
  fills = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`];
  borders = [`<border><left/><right/><top/><bottom/><diagonal/></border>`];
  xfs = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  dxfs: string[] = [];
  private seen = new Map<string, number>();
  private seenDxf = new Map<string, number>();

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
    const font = this.index(
      this.fonts,
      `<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}${style.underline ? `<u/>` : ""}<sz val="${style.size ?? 10}"/><color rgb="FF${style.color ?? INK}"/><name val="${FONT}"/><family val="2"/><scheme val="none"/></font>`,
    );
    const fill = style.fill ? this.index(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const side = (name: string, s?: Side) => (s ? `<${name} style="${s.style}"><color rgb="FF${s.color}"/></${name}>` : `<${name}/>`);
    const hasBorder = style.top || style.bottom || style.left || style.right;
    const border = hasBorder ? this.index(this.borders, `<border>${side("left", style.left)}${side("right", style.right)}${side("top", style.top)}${side("bottom", style.bottom)}<diagonal/></border>`) : 0;
    const numFmt = style.fmt ? FMT_ID[style.fmt] : 0;
    const align = `<alignment${style.align ? ` horizontal="${style.align}"` : ""} vertical="${style.valign ?? "center"}"${style.wrap ? ` wrapText="1"` : ""}${style.indent ? ` indent="${style.indent}"` : ""}/>`;
    this.xfs.push(`<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"${numFmt ? ` applyNumberFormat="1"` : ""}>${align}</xf>`);
    const id = this.xfs.length - 1;
    this.seen.set(key, id);
    return id;
  }

  dxf(d: Dxf): number {
    const key = JSON.stringify(d);
    const known = this.seenDxf.get(key);
    if (known != null) return known;
    const font = d.color || d.bold ? `<font>${d.bold ? "<b/>" : ""}${d.color ? `<color rgb="FF${d.color}"/>` : ""}</font>` : "";
    const fill = d.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="FF${d.fill}"/><bgColor rgb="FF${d.fill}"/></patternFill></fill>` : "";
    const border = d.top ? `<border><top style="${d.top.style}"><color rgb="FF${d.top.color}"/></top></border>` : "";
    this.dxfs.push(`<dxf>${font}${fill}${border}</dxf>`);
    const id = this.dxfs.length - 1;
    this.seenDxf.set(key, id);
    return id;
  }

  xml(): string {
    // The custom table style: what Excel paints on rows added later inside a table.
    const whole = this.dxf({ color: INK });
    const head = this.dxf({ color: ACCENT, bold: true, fill: ACCENT_SOFT });
    const total = this.dxf({ bold: true, top: { style: "thin", color: ACCENT } });
    const numFmts = (Object.keys(FMT_ID) as Fmt[]).map((k) => `<numFmt numFmtId="${FMT_ID[k]}" formatCode="${xml(FMT_CODE[k])}"/>`);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${numFmts.length}">${numFmts.join("")}</numFmts>
<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>
<fills count="${this.fills.length}">${this.fills.join("")}</fills>
<borders count="${this.borders.length}">${this.borders.join("")}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>
<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"><tableStyle name="Ventory" pivot="0" count="3"><tableStyleElement type="wholeTable" dxfId="${whole}"/><tableStyleElement type="headerRow" dxfId="${head}"/><tableStyleElement type="totalRow" dxfId="${total}"/></tableStyle></tableStyles>
</styleSheet>`;
  }
}

class Strings {
  list: string[] = [];
  private map = new Map<string, number>();
  count = 0;
  id(text: string) {
    this.count += 1;
    const known = this.map.get(text);
    if (known != null) return known;
    this.list.push(text);
    this.map.set(text, this.list.length - 1);
    return this.list.length - 1;
  }
  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">${this.list.map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`).join("")}</sst>`;
  }
}


/* ------------------------------------------------------------------ worksheet xml */

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";

function guid(n: number, salt: number) {
  const h = (x: number, len: number) => (x >>> 0).toString(16).toUpperCase().padStart(len, "0").slice(-len);
  return `{5E1C0A7D-${h(salt, 4)}-4C4E-9A1B-${h(n, 12)}}`;
}

function sheetXml(sheet: Sheet, index: number, styles: Styles, strings: Strings, rels: { drawing?: string; tables: string[] }): string {
  const rowIds = [...new Set([...sheet.grid.rows.keys(), ...sheet.grid.heights.keys()])].sort((a, b) => a - b);
  const body = rowIds
    .map((r) => {
      const row = sheet.grid.rows.get(r);
      const cells = row
        ? [...row.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([c, cell]) => {
              const ref = `${colName(c)}${r}`;
              const s = styles.id(cell.s);
              const sa = s ? ` s="${s}"` : "";
              if (cell.f) {
                const cached = typeof cell.v === "number" && Number.isFinite(cell.v) ? `<v>${cell.v}</v>` : "";
                const str = typeof cell.v === "string" ? ` t="str"` : "";
                return `<c r="${ref}"${sa}${str}><f>${xml(cell.f)}</f>${str ? `<v>${xml(cell.v)}</v>` : cached}</c>`;
              }
              if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}"${sa}><v>${cell.v}</v></c>`;
              if (cell.v == null || cell.v === "") return `<c r="${ref}"${sa}/>`;
              return `<c r="${ref}"${sa} t="s"><v>${strings.id(String(cell.v))}</v></c>`;
            })
            .join("")
        : "";
      const height = sheet.grid.heights.get(r);
      return `<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`;
    })
    .join("");
  const lastCol = sheet.widths.length - 1;
  const lastRow = rowIds.length ? rowIds[rowIds.length - 1] : 1;
  const fz = sheet.freeze;
  let pane = "";
  if (fz && (fz.row > 0 || fz.col > 0)) {
    const tl = `${colName(fz.col)}${fz.row + 1}`;
    const active = fz.row && fz.col ? "bottomRight" : fz.row ? "bottomLeft" : "topRight";
    pane = `<pane${fz.col ? ` xSplit="${fz.col}"` : ""}${fz.row ? ` ySplit="${fz.row}"` : ""} topLeftCell="${tl}" activePane="${active}" state="frozen"/><selection pane="${active}" activeCell="${tl}" sqref="${tl}"/>`;
  }
  const cols = sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  const merges = sheet.grid.merges.length ? `<mergeCells count="${sheet.grid.merges.length}">${sheet.grid.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  let priority = 1;
  const x14: string[] = [];
  const cf = sheet.cfs
    .map((rule, n) => {
      const p = priority++;
      if (rule.kind === "scale") {
        const [lo, mid, hi] = rule.colors;
        return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="colorScale" priority="${p}"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FF${lo}"/><color rgb="FF${mid}"/><color rgb="FF${hi}"/></colorScale></cfRule></conditionalFormatting>`;
      }
      if (rule.kind === "bar") {
        const id = guid(n + 1, index + 1);
        x14.push(`<x14:conditionalFormatting xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:cfRule type="dataBar" id="${id}"><x14:dataBar minLength="0" maxLength="100" gradient="0" negativeBarColorSameAsPositive="0" axisPosition="automatic"><x14:cfvo type="autoMin"/><x14:cfvo type="autoMax"/><x14:negativeFillColor rgb="FF${RED_SOFT}"/><x14:axisColor rgb="FF${SUBTLE}"/></x14:dataBar></x14:cfRule><xm:sqref>${rule.sqref}</xm:sqref></x14:conditionalFormatting>`);
        return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="dataBar" priority="${p}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF${rule.color}"/></dataBar><extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}" xmlns:x14="${X14}"><x14:id>${id}</x14:id></ext></extLst></cfRule></conditionalFormatting>`;
      }
      const dxf = styles.dxf(rule.dxf);
      if (rule.kind === "less0") return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="cellIs" dxfId="${dxf}" priority="${p}" operator="lessThan"><formula>0</formula></cfRule></conditionalFormatting>`;
      if (rule.kind === "greater0") return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="cellIs" dxfId="${dxf}" priority="${p}" operator="greaterThan"><formula>0</formula></cfRule></conditionalFormatting>`;
      if (rule.kind === "equal") return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="cellIs" dxfId="${dxf}" priority="${p}" operator="equal"><formula>${xml(`"${rule.text.replace(/"/g, '""')}"`)}</formula></cfRule></conditionalFormatting>`;
      return `<conditionalFormatting sqref="${rule.sqref}"><cfRule type="expression" dxfId="${dxf}" priority="${p}"><formula>${xml(rule.formula)}</formula></cfRule></conditionalFormatting>`;
    })
    .join("");
  const links = sheet.links.length
    ? `<hyperlinks>${sheet.links.map((l) => `<hyperlink ref="${l.ref}" location="${xml(`${quoted(l.target)}!A1`)}" tooltip="${xml(l.tip)}" display="${xml(l.tip)}"/>`).join("")}</hyperlinks>`
    : "";
  const foot = (text: string) => text.replace(/&/g, "&&");
  const footer = `&C&"${FONT},Regular"&8&K${SUBTLE}Ventory · ${foot(sheet.name)} · Page &P of &N`;
  const ext = x14.length ? `<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:x14="${X14}"><x14:conditionalFormattings>${x14.join("")}</x14:conditionalFormattings></ext></extLst>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><tabColor rgb="FF${sheet.tab}"/><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(lastCol)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="100"${index === 0 ? ` tabSelected="1"` : ""}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18" customHeight="1"/>
<cols>${cols}</cols>
<sheetData>${body}</sheetData>
${merges}${cf}${links}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.55" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="1" orientation="${sheet.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>${xml(footer)}</oddFooter></headerFooter>
${sheet.breaks?.length ? `<rowBreaks count="${sheet.breaks.length}" manualBreakCount="${sheet.breaks.length}">${sheet.breaks.map((b) => `<brk id="${b}" max="16383" man="1"/>`).join("")}</rowBreaks>` : ""}
${rels.drawing ? `<drawing r:id="${rels.drawing}"/>` : ""}${rels.tables.length ? `<tableParts count="${rels.tables.length}">${rels.tables.map((id) => `<tablePart r:id="${id}"/>`).join("")}</tableParts>` : ""}${ext}
</worksheet>`;
}

function tableXml(t: Table, id: number): string {
  const lastCol = t.col0 + t.cols.length - 1;
  const lastRow = t.totals ? t.last + 1 : t.last;
  const ref = `${colName(t.col0)}${t.header}:${colName(lastCol)}${lastRow}`;
  const cols = t.cols
    .map((c, i) => {
      if (c.label) return `<tableColumn id="${i + 1}" name="${xml(c.name)}" totalsRowLabel="${xml(c.label)}"/>`;
      if (c.total) return `<tableColumn id="${i + 1}" name="${xml(c.name)}" totalsRowFunction="custom"><totalsRowFormula>${xml(c.total)}</totalsRowFormula></tableColumn>`;
      return `<tableColumn id="${i + 1}" name="${xml(c.name)}"/>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${id}" name="${t.name}" displayName="${t.name}" ref="${ref}"${t.totals ? ` totalsRowCount="1"` : ` totalsRowShown="0"`}><autoFilter ref="${colName(t.col0)}${t.header}:${colName(lastCol)}${t.last}"/><tableColumns count="${t.cols.length}">${cols}</tableColumns><tableStyleInfo name="Ventory" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>`;
}

/* ------------------------------------------------------------------ drawings and charts */

const EMU = 9525;
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function drawingXml(sheet: Sheet, chartRids: string[], logoRid: string): string {
  const anchors: string[] = [];
  let id = 2;
  // The V mark, in the gutter of the band, beside the wordmark.
  anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${8 * EMU}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${10 * EMU}</xdr:rowOff></xdr:from><xdr:ext cx="${26 * EMU}" cy="${24 * EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id++}" name="Ventory mark" descr="Ventory"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${logoRid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${26 * EMU}" cy="${24 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
  sheet.charts.forEach((chart, i) => {
    const [c1, r1, co1 = 0, ro1 = 0] = chart.from;
    const [c2, r2, co2 = 0, ro2 = 0] = chart.to;
    anchors.push(`<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c1}</xdr:col><xdr:colOff>${co1 * EMU}</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>${ro1 * EMU}</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c2}</xdr:col><xdr:colOff>${co2 * EMU}</xdr:colOff><xdr:row>${r2}</xdr:row><xdr:rowOff>${ro2 * EMU}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${id++}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${C_NS}"><c:chart xmlns:c="${C_NS}" r:id="${chartRids[i]}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${A_NS}" xmlns:r="${R_NS}">${anchors.join("")}</xdr:wsDr>`;
}

const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
const txPr = (size: number, color: string, bold = false) =>
  `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size * 100}" b="${bold ? 1 : 0}">${solid(color)}<a:latin typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function chartXml(chart: Chart): string {
  const n = chart.cats.length;
  const strCache = (values: string[]) => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const numCache = (values: (number | null)[], fmt: string) =>
    `<c:numCache><c:formatCode>${xml(fmt)}</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => (v == null || !Number.isFinite(v) ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("")}</c:numCache>`;
  const cat = chart.catNums
    ? `<c:cat><c:numRef><c:f>${xml(chart.catRef)}</c:f>${numCache(chart.catNums, chart.catFmt ?? "General")}</c:numRef></c:cat>`
    : `<c:cat><c:strRef><c:f>${xml(chart.catRef)}</c:f>${strCache(chart.cats)}</c:strRef></c:cat>`;
  const labels = (color: string) =>
    chart.labels
      ? `<c:dLbls><c:numFmt formatCode="${xml(chart.labelFmt ?? chart.axisFmt)}" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(9, color, true)}<c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
      : "";
  const bars = chart.series.filter((s) => s.kind === "bar");
  const lines = chart.series.filter((s) => s.kind === "line");
  let idx = 0;
  const serHead = (s: ChartSeries) => {
    const i = idx++;
    return `<c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xml(s.name)}</c:v></c:tx>`;
  };
  const barSer = bars
    .map((s) => {
      const points = (s.points ?? []).map((color, i) => `<c:dPt><c:idx val="${i}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/><c:spPr>${solid(color)}<a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join("");
      return `<c:ser>${serHead(s)}<c:spPr>${solid(s.color)}<a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${points}${labels(INK)}${cat}<c:val><c:numRef><c:f>${xml(s.ref)}</c:f>${numCache(s.values, chart.axisFmt)}</c:numRef></c:val></c:ser>`;
    })
    .join("");
  const lineSer = lines
    .map(
      (s) =>
        `<c:ser>${serHead(s)}<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solid(WHITE)}<a:ln w="19050"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></a:ln></c:spPr></c:marker>${cat}<c:val><c:numRef><c:f>${xml(s.ref)}</c:f>${numCache(s.values, chart.axisFmt)}</c:numRef></c:val><c:smooth val="0"/></c:ser>`,
    )
    .join("");
  const ax = `<c:axId val="50010"/><c:axId val="50020"/>`;
  const barChart = bars.length
    ? `<c:barChart><c:barDir val="${chart.dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${barSer}<c:gapWidth val="${chart.gap ?? 70}"/>${ax}</c:barChart>`
    : "";
  const lineChart = lines.length ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lineSer}<c:marker val="1"/>${ax}</c:lineChart>` : "";
  const noLine = `<a:ln><a:noFill/></a:ln>`;
  const catPos = chart.dir === "bar" ? "l" : "b";
  const valPos = chart.dir === "bar" ? "b" : "l";
  const catAx = `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="${chart.reverse ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${catPos}"/><c:numFmt formatCode="${xml(chart.catFmt ?? "General")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="${RULE}"/></a:solidFill></a:ln></c:spPr>${txPr(9, MUTED)}<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${n > 14 && chart.dir === "col" ? `<c:tickLblSkip val="2"/>` : ""}<c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${chart.hideValueAxis ? 1 : 0}"/><c:axPos val="${valPos}"/>${chart.hideValueAxis ? "" : `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="${HAIR}"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr></c:majorGridlines>`}<c:numFmt formatCode="${xml(chart.axisFmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr>${noLine}</c:spPr>${txPr(8, SUBTLE)}<c:crossAx val="50010"/><c:crosses val="${chart.reverse ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
  const legend = chart.legend ? `<c:legend><c:legendPos val="t"/><c:overlay val="0"/>${txPr(9, MUTED)}</c:legend>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C_NS}" xmlns:a="${A_NS}" xmlns:r="${R_NS}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/>${barChart}${lineChart}${catAx}${valAx}<c:spPr><a:noFill/>${noLine}</c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr>${solid(WHITE)}${noLine}</c:spPr>${txPr(9, MUTED)}<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}


/* ------------------------------------------------------------------ the title band */

const HEAD = 6; // header row of every table tab
const GUTTER = 5.2;

function band(sheet: Sheet, md: Model, title: string, summary = false) {
  const g = sheet.grid;
  const last = sheet.widths.length - 1;
  const night: Style = { fill: NIGHT };
  g.height(1, 30);
  g.height(2, 22);
  g.height(3, 3);
  g.fill(1, 0, last, night);
  g.fill(2, 0, last, night);
  g.fill(3, 0, last, { fill: GREEN });
  g.set(1, 1, { v: "Ventory", s: { fill: NIGHT, color: BONE, bold: true, size: 17, valign: "bottom" } });
  g.set(2, 1, { v: title, s: { fill: NIGHT, color: summary ? BONE : WHITE, bold: true, size: 12 } });
  const right = last - 1;
  if (summary) {
    g.set(1, right, { v: md.title.toUpperCase(), s: { fill: NIGHT, color: SAGE, bold: true, size: 8.5, align: "right", valign: "bottom" } });
  }
  const made = md.generated.replace(/^Made /, "Made ");
  g.set(2, right, { v: summary ? made : `${md.periodLabel}  ·  ${made}`, s: { fill: NIGHT, color: NIGHT_INK, size: 9, align: "right" } });
}

function textWidth(widths: number[], from: number, to: number) {
  let w = 0;
  for (let c = from; c <= to; c += 1) w += widths[c] ?? 9;
  return w;
}

/** Rows a wrapped text needs at a given width (in Excel's character units). */
function linesFor(text: string, width: number, size = 10) {
  const per = Math.max(4, (width - 1.5) * (10 / size) * 1.12);
  let lines = 0;
  for (const para of text.split("\n")) {
    let line = 0;
    lines += 1;
    for (const word of para.split(/\s+/)) {
      const len = word.length + (line ? 1 : 0);
      if (line + len > per && line > 0) {
        lines += 1;
        line = word.length;
      } else line += len;
    }
  }
  return lines;
}

function description(sheet: Sheet, text: string) {
  const g = sheet.grid;
  const right = sheet.widths.length - 2;
  // The way back sits on the light row, right-aligned; the description stops short of it.
  g.set(4, right, { v: "← Back to Summary", s: { color: ACCENT, underline: true, bold: true, size: 9, align: "right" } });
  sheet.links.push({ ref: `${colName(right)}4`, target: "Summary", tip: "Back to Summary" });
  let last = right - 1;
  let room = sheet.widths[right] ?? 0;
  while (room < 19 && last > 2) room += sheet.widths[last--] ?? 0;
  const w = textWidth(sheet.widths, 1, last);
  const lines = linesFor(text, w, 9.5);
  g.height(4, Math.max(26, lines * 13 + 12));
  g.merge(4, 1, 4, last, { v: text, s: { italic: true, size: 9.5, color: MUTED, wrap: true, valign: "center" } });
  g.height(5, 6);
}

/* ------------------------------------------------------------------ table tabs */

type ColType = "text" | "date" | "month" | "money" | "int" | "pct" | "num1" | "days" | "pill";
interface Col {
  key: string;
  h: string;
  type: ColType;
  total?: "sum" | "avg" | "count";
  bold?: boolean;
  color?: string;
  optional?: boolean;
  bar?: string;
  scale?: "high" | "low";
  pills?: Record<string, [string, string]>;
  flag?: boolean;
  max?: number;
  min?: number;
}
type Val = string | number | null | undefined | { f: string; v?: number | string | null };
type RowFn = (L: (key: string) => string, r: number) => Record<string, Val>;

const NUMERIC: ColType[] = ["money", "int", "pct", "num1", "days"];
const fmtOf = (t: ColType): Fmt | undefined => (t === "pill" ? "dot" : t === "month" ? "month" : t === "money" ? "money" : t === "pct" ? "pct" : t === "int" ? "int" : t === "num1" ? "num1" : t === "days" ? "int" : t === "date" ? "date" : undefined);

function shown(col: Col, value: Val): string {
  const v = value && typeof value === "object" ? value.v : value;
  if (v == null || v === "") return "";
  if (typeof v === "string") return col.type === "date" ? "Mmm 00, 0000" : col.type === "month" ? "Mmm 0000" : col.type === "pill" ? `●  ${v}` : v;
  if (col.type === "money") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (col.type === "pct") return `${Math.round(v * 100)}%`;
  if (col.type === "date") return "Mmm 00, 0000";
  if (col.type === "num1") return v.toFixed(1);
  return Math.round(v).toLocaleString("en-US");
}

/** A money value as the sheet stores it (dollars), from the app's cents. */
function stored(col: Col, value: Val): XCell["v"] {
  if (value && typeof value === "object") return typeof value.v === "number" && !Number.isFinite(value.v) ? null : value.v ?? null;
  if (value == null || value === "") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (col.type === "date") return typeof value === "string" ? serial(value) : null;
  if (col.type === "month") return typeof value === "string" ? serial(`${value.slice(0, 7)}-01`) : null;
  if (col.type === "money") return typeof value === "number" ? Math.round(value) / 100 : value;
  if (col.type === "pct") return typeof value === "number" ? Math.round(value * 10000) / 10000 : value;
  return value;
}

interface Built {
  sheet: Sheet;
  L: (key: string) => string;
  C: (key: string) => number;
  first: number;
  last: number;
  rows: number;
  values: Record<string, XCell["v"]>[];
}

let TABLE_SEQ = 0;

function tableSheet(opts: {
  name: string;
  title: string;
  sub: string;
  cols: Col[];
  rows: RowFn[];
  tab: string;
  md: Model;
  extra?: number[];
  freezeCol?: boolean;
}): Built {
  const { md } = opts;
  // Drop optional columns nobody filled (a premium sheet carries no empty columns).
  const probeL = (cols: Col[]) => (key: string) => colName(1 + Math.max(0, cols.findIndex((c) => c.key === key)));
  const probe = opts.rows.map((fn, i) => fn(probeL(opts.cols), HEAD + 1 + i));
  const cols = opts.cols.filter((c) => !c.optional || probe.some((r) => { const v = r[c.key]; return v != null && v !== "" && v !== 0; }));
  const C = (key: string) => 1 + cols.findIndex((c) => c.key === key);
  const L = (key: string) => colName(C(key));
  const data = opts.rows.map((fn, i) => fn(L, HEAD + 1 + i));
  const first = HEAD + 1;
  const last = HEAD + data.length;
  const totals = data.length > 0 && cols.some((c) => c.total);

  // Widths sized to what each column shows.
  const widths: number[] = [GUTTER];
  const wraps: number[] = [];
  cols.forEach((c) => {
    const k = c.bold ? 1.06 : 1;
    const content = Math.max(0, ...data.map((r) => shown(c, r[c.key]).length)) * k;
    const words = c.h.split(/\s+/);
    const head = Math.max(Math.max(...words.map((w) => w.length)) * 1.05, c.h.length / 2 + 1) + 4.2;
    const max = c.max ?? (c.type === "text" ? 46 : 18);
    const min = c.min ?? 8;
    const want = Math.max(head, content + 3.2, min);
    widths.push(Math.round(Math.min(max, want) * 10) / 10);
    wraps.push(want > max ? 1 : 0);
  });
  widths.push(...(opts.extra ?? []), 2.6);

  const sheet: Sheet = {
    name: opts.name,
    grid: new Grid(),
    widths,
    tab: opts.tab,
    freeze: { row: HEAD, col: opts.freezeCol ? 2 : 0 },
    tables: [],
    cfs: [],
    links: [],
    charts: [],
    printTitle: HEAD,
    landscape: true,
  };
  const g = sheet.grid;
  band(sheet, md, opts.title);
  description(sheet, opts.sub);

  // Header
  g.height(HEAD, 30);
  cols.forEach((c, i) => {
    const num = NUMERIC.includes(c.type);
    g.set(HEAD, i + 1, { v: c.h, s: { fill: ACCENT_SOFT, color: ACCENT, bold: true, size: 9.5, wrap: true, align: num ? "right" : "left", indent: num ? 2 : 1, bottom: { style: "thin", color: SAGE } } });
  });

  // Rows
  const values: Record<string, XCell["v"]>[] = [];
  data.forEach((row, ri) => {
    const r = first + ri;
    let lines = 1;
    const vals: Record<string, XCell["v"]> = {};
    cols.forEach((c, ci) => {
      const raw = row[c.key];
      const v = stored(c, raw);
      vals[c.key] = v;
      const num = NUMERIC.includes(c.type);
      const s: Style = {
        fmt: fmtOf(c.type),
        align: num ? "right" : "left",
        indent: 1,
        bold: c.bold || c.type === "pill",
        color: c.color ?? (c.type === "pill" ? MUTED : undefined),
        size: c.type === "pill" ? 9.5 : undefined,
      };
      if (typeof v === "string" && num) {
        s.color = MUTED;
        s.fmt = undefined;
      }
      if (wraps[ci] && typeof v === "string") {
        s.wrap = true;
        lines = Math.max(lines, linesFor(v, widths[ci + 1], c.bold ? 10.6 : 10));
      }
      if (raw && typeof raw === "object") g.set(r, ci + 1, { f: raw.f, v, s });
      else g.set(r, ci + 1, { v, s });
    });
    values.push(vals);
    g.height(r, lines > 1 ? lines * 13 + 7 : 20);
  });
  if (!data.length) {
    g.height(first, 24);
    g.set(first, 1, { v: "Nothing here for this period.", s: { italic: true, color: MUTED, indent: 1 } });
  }

  // Totals (SUBTOTAL, so they follow the filter)
  const tcols: Table["cols"] = cols.map((c) => ({ name: c.h }));
  if (totals) {
    const r = last + 1;
    g.height(r, 24);
    cols.forEach((c, ci) => {
      const col = colName(ci + 1);
      const top: Side = { style: "thin", color: ACCENT };
      const base: Style = { bold: true, top, fill: CREAM, align: NUMERIC.includes(c.type) ? "right" : "left", indent: 1 };
      if (ci === 0) {
        g.set(r, 1, { v: "Total", s: { ...base, color: ACCENT } });
        tcols[0].label = "Total";
        return;
      }
      if (!c.total) {
        g.set(r, ci + 1, { s: base });
        return;
      }
      const fn = c.total === "count" ? 103 : c.total === "avg" ? 101 : 109;
      const nums = values.map((v) => v[c.key]).filter((n): n is number => typeof n === "number");
      const cached = c.total === "count" ? nums.length : c.total === "avg" ? (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0) : Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
      const f = `SUBTOTAL(${fn},${col}${first}:${col}${last})`;
      tcols[ci].total = f;
      g.set(r, ci + 1, { f, v: cached, s: { ...base, fmt: c.type === "money" ? "money" : c.type === "pct" ? "pct" : c.total === "avg" ? "num1" : "int", color: c.color ?? INK } });
    });
  }

  if (data.length) {
    TABLE_SEQ += 1;
    sheet.tables.push({ name: `Ventory${opts.name.replace(/[^A-Za-z0-9]/g, "")}${TABLE_SEQ}`, ref: "", header: HEAD, first, last, totals, cols: tcols, col0: 1 });
    // Quiet formatting, in priority order: pills and flags, scales, bars, negatives in rust, then the bands.
    cols.forEach((c, ci) => {
      const range = `${colName(ci + 1)}${first}:${colName(ci + 1)}${last}`;
      if (c.pills) for (const [text, [fg, bg]] of Object.entries(c.pills)) sheet.cfs.push({ kind: "equal", sqref: range, text, dxf: { color: fg, bold: true } });
      if (c.flag) sheet.cfs.push({ kind: "expr", sqref: range, formula: `LEN(${colName(ci + 1)}${first})>0`, dxf: { color: RED, fill: RED_SOFT, bold: true } });
    });
    cols.forEach((c, ci) => {
      const range = `${colName(ci + 1)}${first}:${colName(ci + 1)}${last}`;
      if (c.type === "money" || c.type === "pct") sheet.cfs.push({ kind: "less0", sqref: range, dxf: { color: RED } });
      if (c.scale) sheet.cfs.push({ kind: "scale", sqref: range, colors: c.scale === "high" ? ["F3DCD7", "FBF6EA", "CFE3D5"] : ["CFE3D5", "FBF6EA", "F3DCD7"] });
      if (c.bar) sheet.cfs.push({ kind: "bar", sqref: range, color: c.bar });
    });
    sheet.cfs.push({ kind: "expr", sqref: `B${first}:${colName(cols.length)}${last}`, formula: "MOD(ROW(),2)=0", dxf: { fill: BAND } });
  }
  return { sheet, L, C, first, last, rows: data.length, values };
}

/* ------------------------------------------------------------------ tabs */

const STATUS_PILLS: Record<string, [string, string]> = {
  "On hand": [ACCENT, ACCENT_SOFT],
  "On the way": [BLUE, BLUE_SOFT],
  Archive: [MUTED, STONE_SOFT],
  Kept: [PLUM, PLUM_SOFT],
};

function groupSheet(md: Model, name: string, title: string, sub: string, first: string, rows: Group[], tab: string, extra?: number[]): Built {
  const cols: Col[] = [
    { key: "label", h: first, type: "text", bold: true, max: 40 },
    { key: "sold", h: "Sold", type: "int", total: "sum" },
    { key: "rev", h: "Money in", type: "money", total: "sum" },
    { key: "cost", h: "Cost of sales", type: "money", total: "sum" },
    { key: "profit", h: "Left after cost", type: "money", total: "sum", bold: true, color: ACCENT, bar: GREEN_BAR },
    { key: "margin", h: "Margin", type: "pct", scale: "high" },
    { key: "avg", h: "Average sale", type: "money" },
    { key: "days", h: "Days to sell (avg)", type: "int", scale: "low" },
    { key: "still", h: "Still here", type: "int", total: "sum" },
    { key: "stock", h: "Stock at cost", type: "money", total: "sum" },
    { key: "st", h: "Sell-through", type: "pct", scale: "high" },
  ];
  return tableSheet({
    name,
    title,
    sub,
    cols,
    tab,
    md,
    extra,
    freezeCol: true,
    rows: rows.map((gr) => (L, r) => ({
      label: gr.label,
      sold: gr.soldUnits,
      rev: gr.revenue,
      cost: gr.cost,
      profit: { f: `${L("rev")}${r}-${L("cost")}${r}`, v: gr.profit / 100 },
      margin: { f: `IF(${L("rev")}${r}=0,"",${L("profit")}${r}/${L("rev")}${r})`, v: gr.margin ?? "" },
      avg: gr.avgSale,
      days: gr.avgDays,
      still: gr.stockUnits,
      stock: gr.stockCost,
      st: { f: `IF(${L("sold")}${r}+${L("still")}${r}=0,"",${L("sold")}${r}/(${L("sold")}${r}+${L("still")}${r}))`, v: gr.sellThrough ?? "" },
    })),
  });
}

const PROBLEM_LABEL: Record<string, string> = Object.fromEntries(PROBLEMS.map((p) => [p.id, p.label]));
const PLACE: Record<string, string> = { home: "Home", car: "Car" };

const stockCols = (): Col[] => [
  { key: "name", h: "Piece", type: "text", bold: true, max: 44 },
  { key: "status", h: "Status", type: "pill", pills: STATUS_PILLS, min: 11 },
  { key: "type", h: "Type", type: "text", optional: true },
  { key: "style", h: "Style", type: "text", optional: true, max: 18 },
  { key: "brand", h: "Brand", type: "text", optional: true, max: 18 },
  { key: "size", h: "Size", type: "text" },
  { key: "fit", h: "Fit", type: "text", optional: true },
  { key: "qty", h: "Qty", type: "int", total: "sum", min: 7 },
  { key: "cost", h: "Cost each", type: "money" },
  { key: "ask", h: "Asking each", type: "money", optional: true },
  { key: "costT", h: "Cost total", type: "money", total: "sum" },
  { key: "askT", h: "Asking total", type: "money", total: "sum", optional: true },
  { key: "margin", h: "Margin at ask", type: "pct", scale: "high", optional: true },
  { key: "arrived", h: "Arrived", type: "date" },
  { key: "days", h: "Days waiting", type: "int", total: "avg", scale: "low", optional: true },
  { key: "place", h: "Place", type: "text", optional: true },
  { key: "source", h: "Bought from", type: "text", optional: true, max: 22 },
  { key: "problem", h: "Problem", type: "pill", flag: true, optional: true, min: 12 },
  { key: "notes", h: "Notes", type: "text", optional: true, max: 34 },
];

function stockRows(pieces: Piece[], today: string): RowFn[] {
  return pieces.map((p) => (L, r) => ({
    name: p.name || "Untitled",
    status: STATUS_LABEL[p.status] === "Available" ? "On hand" : STATUS_LABEL[p.status] === "Incoming" ? "On the way" : STATUS_LABEL[p.status],
    type: p.category,
    style: p.subcategory,
    brand: p.brand,
    size: sizeName(p),
    fit: p.fit ? p.fit[0].toUpperCase() + p.fit.slice(1) : "",
    qty: p.qty,
    cost: p.costCents,
    ask: p.askCents || null,
    costT: { f: `${L("qty")}${r}*${L("cost")}${r}`, v: (p.costCents * p.qty) / 100 },
    askT: p.askCents ? { f: `${L("qty")}${r}*${L("ask")}${r}`, v: (p.askCents * p.qty) / 100 } : null,
    margin: p.askCents ? { f: `IF(N(${L("ask")}${r})=0,"",(${L("ask")}${r}-${L("cost")}${r})/${L("ask")}${r})`, v: (p.askCents - p.costCents) / p.askCents } : null,
    arrived: p.receivedOn,
    days: p.status === "available" ? daysHeld(p.receivedOn, null, today) : null,
    place: PLACE[p.place] ?? "",
    source: p.source,
    problem: PROBLEM_LABEL[p.problem] ?? "",
    notes: p.notes,
  }));
}

const saleCols = (): Col[] => [
  { key: "name", h: "Piece", type: "text", bold: true, max: 44 },
  { key: "sold", h: "Sold on", type: "date" },
  { key: "type", h: "Type", type: "text", optional: true },
  { key: "brand", h: "Brand", type: "text", optional: true, max: 18 },
  { key: "size", h: "Size", type: "text" },
  { key: "qty", h: "Qty", type: "int", total: "sum", min: 7 },
  { key: "cost", h: "Cost each", type: "money" },
  { key: "rebate", h: "Rebate each", type: "money", optional: true },
  { key: "sale", h: "Sale each", type: "money" },
  { key: "rev", h: "Money in", type: "money", total: "sum" },
  { key: "profit", h: "Left after cost", type: "money", total: "sum", bold: true, color: ACCENT, bar: GREEN_BAR },
  { key: "margin", h: "Margin", type: "pct", scale: "high" },
  { key: "arrived", h: "Arrived", type: "date", optional: true },
  { key: "days", h: "Days to sell", type: "int", total: "avg", scale: "low", optional: true },
  { key: "channel", h: "Channel", type: "text", optional: true, max: 20 },
  { key: "client", h: "Client", type: "text", optional: true, max: 22 },
  { key: "source", h: "Bought from", type: "text", optional: true, max: 22 },
  { key: "notes", h: "Notes", type: "text", optional: true, max: 34 },
];

function saleRows(pieces: Piece[], today: string): RowFn[] {
  return pieces.map((p) => (L, r) => {
    const priced = p.saleCents != null;
    return {
      name: p.name || "Untitled",
      sold: p.soldOn,
      type: p.category,
      brand: p.brand,
      size: sizeName(p),
      qty: p.qty,
      cost: p.costCents,
      rebate: p.buyRebateCents || null,
      sale: priced ? p.saleCents : "No price",
      rev: priced ? { f: `${L("qty")}${r}*${L("sale")}${r}`, v: ((p.saleCents ?? 0) * p.qty) / 100 } : null,
      profit: priced ? { f: `${L("rev")}${r}-${L("qty")}${r}*MAX(0,${L("cost")}${r}-N(${L("rebate") === "A" ? "0" : `${L("rebate")}${r}`}))`, v: (((p.saleCents ?? 0) - netCost(p)) * p.qty) / 100 } : null,
      margin: priced && p.saleCents ? { f: `IF(N(${L("rev")}${r})=0,"",${L("profit")}${r}/${L("rev")}${r})`, v: ((p.saleCents ?? 0) - netCost(p)) / (p.saleCents ?? 1) } : null,
      arrived: p.receivedOn,
      days: daysHeld(p.receivedOn, p.soldOn, today),
      channel: p.channel,
      client: p.clientName,
      source: p.source,
      notes: p.notes,
    };
  });
}


/* ------------------------------------------------------------------ summary dashboard */

const AGE_COLOR: Record<string, string> = { fresh: GREEN, settling: TEAL, slow: AMBER, cold: COPPER, frozen: RED };
// Summary grid: A gutter, B a slim lead column (the sentence's bar), four tile slots with gaps.
const SLOT = [1, 6, 10, 14];
const SLOT_END = [4, 8, 12, 16];
const SUM_LAST = 16; // column Q; R is the right gutter

function section(g: Grid, r: number, c1: number, c2: number, text: string) {
  g.height(r, 24);
  g.merge(r, c1, r, c2, { v: text.toUpperCase(), s: { bold: true, size: 9, color: ACCENT, valign: "bottom", bottom: { style: "thin", color: RULE } } });
}

function summarySheet(
  md: Model,
  tabs: { name: string; what: string; rows: number }[],
  refs: { month?: Built; aging?: Built; product?: Built },
): Sheet {
  const m = md.m;
  const widths = [5.2, 1.2, 9.2, 9.2, 9.2, 2.2, 9.6, 9.6, 9.6, 2.2, 9.6, 9.6, 9.6, 2.2, 9.6, 9.6, 9.6, 2.6];
  const sheet: Sheet = { name: "Summary", grid: new Grid(), widths, tab: NIGHT, tables: [], cfs: [], links: [], charts: [], landscape: false };
  const g = sheet.grid;
  band(sheet, md, md.periodLabel, true);
  g.height(4, 16);

  // KPI tiles
  const tile = (slot: number, accent: string, label: string, value: number | string | null, fmt: Fmt | undefined, sub: string, color: string) => {
    const c = SLOT[slot];
    const e = SLOT_END[slot];
    const base: Style = { fill: CREAM, indent: 1 };
    g.merge(5, c, 5, e, { v: label.toUpperCase(), s: { ...base, bold: true, size: 8.5, color: MUTED, valign: "bottom", top: { style: "medium", color: accent } } });
    const v = value == null ? "—" : value;
    g.merge(6, c, 6, e, { v, s: { ...base, bold: true, size: 22, color, fmt: typeof v === "number" ? fmt : undefined, align: "left" } });
    g.merge(7, c, 7, e, { v: sub, s: { ...base, size: 9, color: MUTED, valign: "top" } });
  };
  g.height(5, 24);
  g.height(6, 34);
  g.height(7, 22);
  tile(0, GREEN, "Left after cost", m.profit / 100, "money", `${m.units.priced} priced ${m.units.priced === 1 ? "sale" : "sales"}`, ACCENT);
  tile(1, AMBER, "Money in", m.revenue / 100, "money", `${cashText(m.costOfSales)} cost of sales`, AMBER);
  tile(2, NIGHT, "Margin", m.margin, "pct", "of every dollar in, what stays", INK);
  tile(3, SAGE, "Sell-through", m.sellThrough, "pct", `${m.units.sold} sold · ${m.units.onHand + m.units.incoming} waiting`, GREEN);

  // Secondary figures
  g.height(8, 14);
  const stat = (r: number, slot: number, label: string, value: number | string | null, fmt?: Fmt) => {
    const c = SLOT[slot];
    const e = SLOT_END[slot];
    g.merge(r, c, r, e, { v: label, s: { size: 9, color: MUTED, indent: 1, valign: "bottom" } });
    const v = value == null ? "—" : value;
    g.merge(r + 1, c, r + 1, e, { v, s: { bold: true, size: 13, color: INK, indent: 1, fmt: typeof v === "number" ? fmt : undefined, align: "left", valign: "top" } });
  };
  g.height(9, 17);
  g.height(10, 22);
  g.height(11, 6);
  g.height(12, 17);
  g.height(13, 22);
  stat(9, 0, "Pieces sold", m.units.sold, "int");
  stat(9, 1, "Average sale", m.avgSale == null ? null : m.avgSale / 100, "money");
  stat(9, 2, "Average left per sale", m.avgProfit == null ? null : m.avgProfit / 100, "money");
  stat(9, 3, "Median days to sell", m.days.median, "days");
  stat(12, 0, "Stock at cost", m.stockCost / 100, "money");
  stat(12, 1, "Stock at asking price", m.stockAsk ? m.stockAsk / 100 : null, "money");
  stat(12, 2, "On hand / on the way", `${m.units.onHand} / ${m.units.incoming}`);
  stat(12, 3, "Ready to list", `${md.ready} of ${m.units.onHand}`);

  // In one sentence
  let r = 15;
  g.height(14, 10);
  section(g, r, 1, SUM_LAST, "In one sentence");
  r += 1;
  g.height(r, 8);
  r += 1;
  const sentence = md.advice.headline;
  const lines = linesFor(sentence, textWidth(widths, 2, SUM_LAST), 13);
  g.height(r, Math.max(30, lines * 18 + 10));
  g.set(r, 1, { s: { left: { style: "thick", color: GREEN } } });
  g.merge(r, 2, r, SUM_LAST, { v: sentence, s: { size: 13, color: INK, wrap: true } });
  r += 1;
  g.height(r, 14);
  r += 1;

  // Charts
  const month = refs.month;
  if (month && month.rows && md.months.length) {
    section(g, r, 1, SUM_LAST, "Month by month · money in and left after cost");
    const chronological = md.months.slice();
    const top = r; // chart starts on the row after the label (0-based index = r)
    sheet.charts.push({
      from: [1, top, 0, 6],
      to: [SUM_LAST + 1, top + 16, 0, 0],
      dir: "col",
      catRef: absRange("By month", month.C("month"), month.first, month.last),
      cats: chronological.map((p) => p.label),
      catNums: chronological.map((p) => serial(`${p.key}-01`) ?? 0),
      catFmt: `mmm "’"yy`,
      series: [
        { name: "Money in", kind: "bar", color: AMBER, ref: absRange("By month", month.C("rev"), month.first, month.last), values: chronological.map((p) => p.revenue / 100) },
        { name: "Left after cost", kind: "line", color: GREEN, ref: absRange("By month", month.C("profit"), month.first, month.last), values: chronological.map((p) => p.profit / 100) },
      ],
      legend: true,
      axisFmt: `"$"#,##0`,
      gap: 60,
    });
    for (let i = 1; i <= 16; i += 1) g.height(r + i, 18);
    r += 17;
    g.height(r, 14);
    r += 1;
  }
  const aging = refs.aging;
  const product = refs.product;
  const buckets = m.aging.buckets;
  const tops = m.byProduct.filter((p) => p.profit > 0).slice(0, 8);
  if ((aging && aging.rows) || (product && tops.length)) {
    sheet.breaks = [r - 1];
    section(g, r, 1, 8, "How old the stock on hand is · pieces");
    section(g, r, 10, SUM_LAST, "What earns most · left after cost");
    const top = r;
    if (aging && aging.rows) {
      sheet.charts.push({
        from: [1, top, 0, 6],
        to: [9, top + 14, 0, 0],
        dir: "col",
        catRef: absRange("Aging", aging.C("label"), aging.first, aging.last),
        cats: buckets.map((b) => ageLabel(b.label)),
        series: [{ name: "Pieces", kind: "bar", color: AMBER, points: buckets.map((b) => AGE_COLOR[b.id] ?? AMBER), ref: absRange("Aging", aging.C("units"), aging.first, aging.last), values: buckets.map((b) => b.units) }],
        legend: false,
        labels: true,
        hideValueAxis: true,
        axisFmt: "#,##0",
        gap: 45,
      });
    }
    if (product && tops.length) {
      sheet.charts.push({
        from: [10, top, 0, 6],
        to: [SUM_LAST + 1, top + 14, 0, 0],
        dir: "bar",
        catRef: absRange("By product", product.C("label"), product.first, product.first + tops.length - 1),
        cats: tops.map((p) => p.label),
        series: [{ name: "Left after cost", kind: "bar", color: GREEN, ref: absRange("By product", product.C("profit"), product.first, product.first + tops.length - 1), values: tops.map((p) => p.profit / 100) }],
        legend: false,
        labels: true,
        hideValueAxis: true,
        axisFmt: `"$"#,##0`,
        gap: 45,
        reverse: true,
      });
    }
    for (let i = 1; i <= 14; i += 1) g.height(r + i, 18);
    r += 15;
    g.height(r, 14);
    r += 1;
  }

  // The figures, with what each one means
  const rule: Side = { style: "thin", color: HAIR };
  const kv = (label: string, value: number | string | null, fmt?: Fmt, note = "") => {
    g.height(r, 21);
    const v = value == null ? "—" : value;
    g.merge(r, 1, r, 5, { v: label, s: { indent: 1, bottom: rule } });
    g.merge(r, 6, r, 8, { v, s: { bold: true, align: "right", indent: 1, fmt: typeof v === "number" ? fmt : undefined, bottom: rule, color: typeof v === "number" && v < 0 ? RED : INK } });
    g.set(r, 9, { s: { bottom: rule } });
    g.merge(r, 10, r, SUM_LAST, { v: note, s: { italic: true, size: 9, color: MUTED, indent: 1, bottom: rule } });
    r += 1;
  };
  section(g, r, 1, SUM_LAST, "Money");
  r += 1;
  kv("Money in (priced sales)", m.revenue / 100, "money", `${m.units.priced} priced ${m.units.priced === 1 ? "sale" : "sales"}`);
  kv("Cost of sales", m.costOfSales / 100, "money", "Cost less the buying rebate on each card");
  kv("Left after cost", m.profit / 100, "money", "Money in − cost of sales. Fees and shipping are not on the cards.");
  kv("Margin", m.margin, "pct", "Of every dollar in, what stays");
  kv("Average sale", m.avgSale == null ? null : m.avgSale / 100, "money");
  kv("Average left per sale", m.avgProfit == null ? null : m.avgProfit / 100, "money");
  kv("Given in price cuts", m.priceCuts / 100, "money", "Asking price − price charged, on sales with an ask");
  if (m.rebates) kv("Buying rebates", m.rebates / 100, "money", "Money back on purchases; already inside cost of sales");
  if (m.delivery) kv("Delivery collected", m.delivery / 100, "money", "Charged on top of the price; not revenue or profit");
  if (md.ads.length) kv("Ad spend (all time)", m.adSpend / 100, "money");
  g.height(r, 14);
  r += 1;
  section(g, r, 1, SUM_LAST, "Pieces");
  r += 1;
  kv("Sold in the period", m.units.sold, "int", m.units.unpriced ? `${m.units.unpriced} with no price` : "");
  kv("On hand", m.units.onHand, "int", `${md.ready} ready to list`);
  kv("On the way", m.units.incoming, "int");
  kv("Stock at cost", m.stockCost / 100, "money", "On hand + on the way");
  kv("Stock at asking price", m.stockAsk ? m.stockAsk / 100 : null, "money", m.unaskedUnits ? `${m.unaskedUnits} pieces have no ask` : "");
  kv("Sell-through", m.sellThrough, "pct", "Sold ÷ (sold + still waiting)");
  kv("Days to sell (median)", m.days.median, "days", m.days.n ? `${m.days.n} sales with both dates` : "No sale has both dates");
  kv("Average days on hand", m.aging.avg, "days");
  kv("Archive / kept", `${m.units.archived} / ${m.units.kept}`, undefined, "Neither is a sale nor stock");
  g.height(r, 14);
  r += 1;

  // Table of contents
  (sheet.breaks ??= []).push(r - 1);
  section(g, r, 1, SUM_LAST, "In this workbook");
  r += 1;
  for (const t of tabs) {
    g.height(r, 21);
    g.merge(r, 1, r, 5, { v: t.name, s: { bold: true, color: ACCENT, underline: true, indent: 1, bottom: rule } });
    sheet.links.push({ ref: `${colName(1)}${r}`, target: t.name, tip: `Open ${t.name}` });
    g.merge(r, 6, r, 8, { v: t.rows, s: { color: MUTED, align: "right", indent: 1, fmt: "rows", bottom: rule } });
    g.set(r, 9, { s: { bottom: rule } });
    g.merge(r, 10, r, SUM_LAST, { v: t.what, s: { size: 9.5, color: MUTED, indent: 1, bottom: rule } });
    r += 1;
  }
  g.height(r, 10);
  r += 1;
  const tip = `Every table tab is a real Excel table: filter or sort from its header, and its Total row adds up only the rows you leave visible. Money in, Left after cost and Margin are live formulas. Sales are counted inside the period; stock is as of ${dayLong(md.today)}${md.sample ? "; includes the sample pieces" : ""}.`;
  g.height(r, Math.max(30, linesFor(tip, textWidth(widths, 1, SUM_LAST), 9) * 12 + 10));
  g.merge(r, 1, r, SUM_LAST, { v: tip, s: { italic: true, size: 9, color: SUBTLE, wrap: true, indent: 1 } });
  return sheet;
}

function cashText(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ageLabel(label: string) {
  return label.replace("–", " to ").replace(" d", " days");
}

/* ------------------------------------------------------------------ the workbook */

export function reportXlsxBytes(md: Model): Uint8Array {
  TABLE_SEQ = 0;
  const m = md.m;
  const tabs: Sheet[] = [];
  const guide: { name: string; what: string; rows: number }[] = [];
  const add = (b: Built, what: string) => {
    tabs.push(b.sheet);
    guide.push({ name: b.sheet.name, what, rows: b.rows });
    return b;
  };

  // Group tabs: data (green), breakdowns (amber), stock health (copper), advice (teal), records (stone).
  const stock = m.stock.slice().sort((a, b) => a.name.localeCompare(b.name) || (a.receivedOn || "").localeCompare(b.receivedOn || ""));
  add(tableSheet({ name: "Inventory", title: "Inventory · on hand and on the way", sub: `Every piece waiting, as of ${dayLong(md.today)}. Cost and asking totals are live formulas (qty × each); the Total row follows your filter.`, cols: stockCols(), rows: stockRows(stock, md.today), tab: ACCENT, md, freezeCol: true }), "Every piece on hand or on the way, one row each");

  const sales = m.sales.slice().sort((a, b) => (b.soldOn || "").localeCompare(a.soldOn || ""));
  add(tableSheet({ name: "Sales", title: `Sales · ${md.periodLabel}`, sub: "One row per sale. Money in = qty × sale; Left after cost = money in − qty × (cost − buying rebate); delivery is not counted. A sale with no price stays blank, never guessed.", cols: saleCols(), rows: saleRows(sales, md.today), tab: ACCENT, md, freezeCol: true }), "Every sale in the period with cost, price, profit and days to sell");

  const months = md.months.slice();
  const month = tableSheet({
    name: "By month",
    title: "Month by month",
    sub: `Dated sales only · ${md.periodLabel}. Oldest month first, so the chart reads left to right.`,
    cols: [
      { key: "month", h: "Month", type: "month", bold: true, min: 12 },
      { key: "sales", h: "Sales", type: "int", total: "sum" },
      { key: "rev", h: "Money in", type: "money", total: "sum", color: AMBER_INK },
      { key: "cost", h: "Cost of sales", type: "money", total: "sum" },
      { key: "profit", h: "Left after cost", type: "money", total: "sum", bold: true, color: ACCENT },
      { key: "margin", h: "Margin", type: "pct", scale: "high" },
    ],
    rows: months.map((p) => (L, r) => ({
      month: p.key,
      sales: p.units,
      rev: p.revenue,
      cost: p.revenue - p.profit,
      profit: { f: `${L("rev")}${r}-${L("cost")}${r}`, v: p.profit / 100 },
      margin: { f: `IF(${L("rev")}${r}=0,"",${L("profit")}${r}/${L("rev")}${r})`, v: p.revenue ? p.profit / p.revenue : "" },
    })),
    tab: AMBER,
    md,
    extra: [3, 9, 9, 9, 9, 9, 9, 9, 9, 9],
  });
  if (month.rows) {
    const c0 = 8;
    month.sheet.charts.push({
      from: [c0, HEAD - 1, 0, 0],
      to: [c0 + 9, HEAD - 1 + 18, 0, 0],
      dir: "col",
      catRef: absRange("By month", month.C("month"), month.first, month.last),
      cats: months.map((p) => p.label),
      catNums: months.map((p) => serial(`${p.key}-01`) ?? 0),
      catFmt: `mmm "’"yy`,
      series: [
        { name: "Money in", kind: "bar", color: AMBER, ref: absRange("By month", month.C("rev"), month.first, month.last), values: months.map((p) => p.revenue / 100) },
        { name: "Left after cost", kind: "line", color: GREEN, ref: absRange("By month", month.C("profit"), month.first, month.last), values: months.map((p) => p.profit / 100) },
      ],
      legend: true,
      axisFmt: `"$"#,##0`,
      gap: 60,
    });
  }
  add(month, "Sales, money in, cost and margin for each month, with its chart");

  const byProduct = m.byProduct.slice().sort((a, b) => b.profit - a.profit || b.revenue - a.revenue);
  const product = groupSheet(md, "By product", "What earns · by product", "Each product: what sold, what it left, how fast, and what is still here. Ranked by what it left after cost.", "Product", byProduct, AMBER);
  const tops = byProduct.filter((p) => p.profit > 0).slice(0, 10);
  if (tops.length) {
    const r0 = product.last + 3;
    section(product.sheet.grid, r0, 1, 6, `Top ${tops.length} · left after cost`);
    product.sheet.charts.push({
      from: [1, r0, 0, 6],
      to: [7, r0 + Math.max(8, Math.ceil(tops.length * 1.6)), 0, 0],
      dir: "bar",
      catRef: absRange("By product", product.C("label"), product.first, product.first + tops.length - 1),
      cats: tops.map((p) => p.label),
      series: [{ name: "Left after cost", kind: "bar", color: GREEN, ref: absRange("By product", product.C("profit"), product.first, product.first + tops.length - 1), values: tops.map((p) => p.profit / 100) }],
      legend: false,
      labels: true,
      hideValueAxis: true,
      axisFmt: `"$"#,##0`,
      gap: 40,
      reverse: true,
    });
  }
  add(product, "Each product ranked by what it left after cost, with its top-earners chart");
  if (m.byCategory.length > 1) add(groupSheet(md, "By type", "What earns · by type", "Boots, watches, hats… compared.", "Type", m.byCategory, AMBER), "Each type of piece compared");
  if (m.byBrand.some((x) => x.label !== "No brand")) add(groupSheet(md, "By brand", "What earns · by brand", "Pieces with no brand are grouped as No brand.", "Brand", m.byBrand, AMBER), "Each brand compared");
  add(groupSheet(md, "By size", "What moves · by size", "Which sizes sell and which sit. Sell-through = sold ÷ (sold + still here).", "Size", m.bySize.slice().sort((a, b) => b.soldUnits - a.soldUnits), AMBER), "Each size: sold, still here, sell-through, days to sell");
  add(groupSheet(md, "By source", "Bought from", "Each place you buy from, judged by what sold.", "Bought from", m.bySource, AMBER), "Each source judged by its sales");
  if (m.byChannel.some((x) => x.label !== "Not recorded")) add(groupSheet(md, "By channel", "Where they sold", "Channels named on the sales.", "Channel", m.byChannel, AMBER), "Where each sale happened");
  if (m.byClient.some((x) => x.label !== "Not recorded")) add(groupSheet(md, "Clients", "Clients", "Buyers named on the sales.", "Client", m.byClient.slice().sort((a, b) => b.revenue - a.revenue), AMBER), "Each buyer named on a sale");

  const buckets = m.aging.buckets;
  const totalUnits = Math.max(1, buckets.reduce((s, x) => s + x.units, 0));
  const aging = tableSheet({
    name: "Aging",
    title: "How long the pieces on hand have waited",
    sub: `Days since arrival, as of ${dayLong(md.today)}. ${m.aging.undated} on hand have no arrival date.`,
    cols: [
      { key: "label", h: "Waiting", type: "text", bold: true, min: 15 },
      { key: "units", h: "Pieces", type: "int", total: "sum", min: 10 },
      { key: "cost", h: "Cost tied up", type: "money", total: "sum", bar: COPPER_BAR, min: 15 },
      { key: "share", h: "Share of pieces", type: "pct", min: 12 },
    ],
    rows: buckets.map((b, i) => (L, r) => ({
      label: ageLabel(b.label),
      units: b.units,
      cost: b.cost,
      share: { f: `IF(SUM($${L("units")}$${HEAD + 1}:$${L("units")}$${HEAD + buckets.length})=0,"",${L("units")}${r}/SUM($${L("units")}$${HEAD + 1}:$${L("units")}$${HEAD + buckets.length}))`, v: b.units / totalUnits },
      _i: i,
    })),
    tab: COPPER,
    md,
    extra: [3, 9, 9, 9, 9, 9, 9, 9],
  });
  buckets.forEach((b, i) => {
    const r = aging.first + i;
    const color = AGE_COLOR[b.id] ?? AMBER;
    aging.sheet.grid.set(r, 1, { v: ageLabel(b.label), s: { bold: true, color, indent: 2, left: { style: "thick", color } } });
  });
  if (aging.rows) {
    aging.sheet.charts.push({
      from: [6, HEAD - 1, 0, 0],
      to: [13, HEAD - 1 + 14, 0, 0],
      dir: "col",
      catRef: absRange("Aging", aging.C("label"), aging.first, aging.last),
      cats: buckets.map((b) => ageLabel(b.label)),
      series: [{ name: "Pieces", kind: "bar", color: AMBER, points: buckets.map((b) => AGE_COLOR[b.id] ?? AMBER), ref: absRange("Aging", aging.C("units"), aging.first, aging.last), values: buckets.map((b) => b.units) }],
      legend: false,
      labels: true,
      hideValueAxis: true,
      axisFmt: "#,##0",
      gap: 45,
    });
  }
  add(aging, "Pieces on hand by how long they have waited, fresh to old, with its chart");

  if (md.move.length) {
    const pieces = md.move.flatMap((gr) => gr.pieces.map(({ piece, days }) => ({ gr, piece, days }))).sort((a, b) => b.days - a.days);
    add(
      tableSheet({
        name: "Move",
        title: "Move · pieces past their usual selling time",
        sub: "Try = about 10% off the usual ask (20% past 90 days), never under cost. Act now = waiting more than 90 days. Fees and shipping are not on the cards.",
        cols: [
          { key: "name", h: "Piece", type: "text", bold: true, max: 44 },
          { key: "urgency", h: "Urgency", type: "pill", pills: { "Act now": [RED, RED_SOFT], Due: [AMBER_INK, AMBER_SOFT] }, min: 11 },
          { key: "size", h: "Size", type: "text" },
          { key: "days", h: "Waiting (days)", type: "int" },
          { key: "pace", h: "Usually sells in (days)", type: "int" },
          { key: "cost", h: "Cost", type: "money", total: "sum" },
          { key: "ask", h: "Asking", type: "money" },
          { key: "try", h: "Try", type: "money", bold: true, color: ACCENT },
        ],
        rows: pieces.map(({ gr, piece, days }) => () => ({ name: piece.name, urgency: days > 90 ? "Act now" : "Due", size: sizeName(piece), days, pace: gr.pace, cost: piece.costCents * piece.qty, ask: piece.askCents || null, try: gr.cut })),
        tab: COPPER,
        md,
        freezeCol: false,
      }),
      "Every piece that has outstayed its product's selling time, with a price to try",
    );
  }
  if (md.restock.length) {
    add(
      tableSheet({
        name: "Buy again",
        title: "Buy again · products that sold more than once",
        sub: "Fastest movers first. Weeks of stock = still here ÷ the last 90 days' pace.",
        cols: [
          { key: "product", h: "Product", type: "text", bold: true, max: 44 },
          { key: "size", h: "Best size", type: "text" },
          { key: "sold", h: "Sold", type: "int", total: "sum" },
          { key: "recent", h: "Sold, last 90 days", type: "int", total: "sum" },
          { key: "days", h: "Days to sell (avg)", type: "int", scale: "low" },
          { key: "each", h: "Left per sale", type: "money", bar: GREEN_BAR, color: ACCENT, bold: true },
          { key: "left", h: "Still here", type: "int", total: "sum" },
          { key: "weeks", h: "Weeks of stock", type: "int" },
        ],
        rows: md.restock.map((x) => () => ({ product: x.product, size: x.size ?? "", sold: x.sold, recent: x.recent, days: x.avgDays, each: x.profitEach, left: x.left, weeks: x.weeksLeft })),
        tab: TEAL,
        md,
      }),
      "What sold more than once, with its pace and the stock left",
    );
  }
  if (md.price.length) {
    const priced = tableSheet({
      name: "Pricing",
      title: "Pricing · from your own sales",
      sub: "What buyers paid for each product against today's asks. Suggested ask = the usual (median) price, never under cost.",
      cols: [
        { key: "product", h: "Product", type: "text", bold: true, max: 44 },
        { key: "sales", h: "Priced sales", type: "int" },
        { key: "low", h: "Lowest paid", type: "money" },
        { key: "median", h: "Usual paid", type: "money", bold: true },
        { key: "high", h: "Highest paid", type: "money" },
        { key: "cost", h: "Usual cost", type: "money" },
        { key: "suggest", h: "Suggested ask", type: "money", bold: true, color: ACCENT },
        { key: "stock", h: "Still here", type: "int", total: "sum" },
        { key: "below", h: "Asks under cost", type: "int", total: "sum" },
        { key: "above", h: "Asks above any sale", type: "int", total: "sum" },
        { key: "unasked", h: "No ask yet", type: "int", total: "sum" },
      ],
      rows: md.price.map((x) => () => ({ product: x.product, sales: x.sales, low: x.low, median: x.median, high: x.high, cost: x.cost, suggest: x.suggest, stock: x.stock, below: x.below, above: x.above, unasked: x.unasked })),
      tab: TEAL,
      md,
    });
    if (priced.rows) {
      const rng = (k: string) => `${priced.L(k)}${priced.first}:${priced.L(k)}${priced.last}`;
      priced.sheet.cfs.unshift({ kind: "greater0", sqref: rng("below"), dxf: { color: RED, bold: true, fill: RED_SOFT } }, { kind: "greater0", sqref: rng("above"), dxf: { color: AMBER_INK, bold: true, fill: AMBER_SOFT } });
    }
    add(priced, "The price range buyers paid per product, against today's asks");
  }
  const everything = md.pieces.filter((p) => !isSale(p) && !isStock(p));
  if (everything.length) {
    add(tableSheet({ name: "Archive and kept", title: "Archive and kept", sub: "Pieces removed without a sale, and pieces you kept. Neither is a sale nor stock.", cols: stockCols(), rows: stockRows(everything, md.today), tab: "8A8478", md, freezeCol: true }), "Removed without a sale, and kept for yourself");
  }
  const summary = summarySheet(md, guide, { month: month.rows ? month : undefined, aging: aging.rows ? aging : undefined, product: product.rows ? product : undefined });
  return packWorkbook(md, [summary, ...tabs]);
}


function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function packWorkbook(md: Model, sheets: Sheet[]): Uint8Array {
  const styles = new Styles();
  const strings = new Strings();
  const encoder = new TextEncoder();
  const used = new Set<string>();
  for (const s of sheets) {
    let name = s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet";
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    s.name = name;
  }
  const files: { name: string; data: Uint8Array }[] = [];
  const overrides: string[] = [];
  const put = (name: string, text: string, type?: string) => {
    files.push({ name, data: encoder.encode(text) });
    if (type) overrides.push(`<Override PartName="/${name}" ContentType="${type}"/>`);
  };
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relsXml = (items: { id: string; type: string; target: string }[]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((i) => `<Relationship Id="${i.id}" Type="${REL}/${i.type}" Target="${i.target}"/>`).join("")}</Relationships>`;

  let chartNo = 0;
  let tableNo = 0;
  const sheetParts: { name: string; text: string }[] = [];
  sheets.forEach((sheet, index) => {
    const n = index + 1;
    const sheetRels: { id: string; type: string; target: string }[] = [];
    // drawing: the V mark on every tab, plus its charts
    const drawingId = "rId1";
    sheetRels.push({ id: drawingId, type: "drawing", target: `../drawings/drawing${n}.xml` });
    const drawRels: { id: string; type: string; target: string }[] = [{ id: "rId1", type: "image", target: "../media/vmark.png" }];
    const chartRids = sheet.charts.map((chart) => {
      chartNo += 1;
      const rid = `rId${drawRels.length + 1}`;
      drawRels.push({ id: rid, type: "chart", target: `../charts/chart${chartNo}.xml` });
      put(`xl/charts/chart${chartNo}.xml`, chartXml(chart), "application/vnd.openxmlformats-officedocument.drawingml.chart+xml");
      return rid;
    });
    put(`xl/drawings/drawing${n}.xml`, drawingXml(sheet, chartRids, "rId1"), "application/vnd.openxmlformats-officedocument.drawing+xml");
    put(`xl/drawings/_rels/drawing${n}.xml.rels`, relsXml(drawRels));
    const tableRids = sheet.tables.map((t) => {
      tableNo += 1;
      const rid = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id: rid, type: "table", target: `../tables/table${tableNo}.xml` });
      put(`xl/tables/table${tableNo}.xml`, tableXml(t, tableNo), "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml");
      return rid;
    });
    sheetParts.push({ name: `xl/worksheets/sheet${n}.xml`, text: sheetXml(sheet, index, styles, strings, { drawing: drawingId, tables: tableRids }) });
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    put(`xl/worksheets/_rels/sheet${n}.xml.rels`, relsXml(sheetRels));
  });
  for (const p of sheetParts) files.push({ name: p.name, data: encoder.encode(p.text) });
  files.push({ name: "xl/media/vmark.png", data: base64Bytes(VMARK_PNG) });

  const title = `Ventory · ${md.title} · ${md.periodLabel}`;
  const now = new Date().toISOString().slice(0, 19) + "Z";
  put(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:subject>${xml(`${md.title}, ${md.periodLabel}`)}</dc:subject><dc:creator>Ventory</dc:creator><cp:keywords>Ventory; inventory; sales</cp:keywords><dc:description>${xml(`${md.generated}. Sales counted inside the period; stock as of ${dayLong(md.today)}.`)}</dc:description><cp:lastModifiedBy>Ventory</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    "application/vnd.openxmlformats-package.core-properties+xml",
  );
  put(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Ventory</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Ventory</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged></Properties>`,
    "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  );
  const printTitles = sheets
    .map((sheet, index) => (sheet.printTitle ? `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">${xml(quoted(sheet.name))}!$${sheet.printTitle}:$${sheet.printTitle}</definedName>` : ""))
    .join("");
  put(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">
<workbookPr/>
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" tabRatio="850" activeTab="0"/></bookViews>
<sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
${printTitles ? `<definedNames>${printTitles}</definedNames>` : ""}
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  );
  put(
    "xl/_rels/workbook.xml.rels",
    relsXml([
      ...sheets.map((_, index) => ({ id: `rId${index + 1}`, type: "worksheet", target: `worksheets/sheet${index + 1}.xml` })),
      { id: `rId${sheets.length + 1}`, type: "styles", target: "styles.xml" },
      { id: `rId${sheets.length + 2}`, type: "sharedStrings", target: "sharedStrings.xml" },
    ]),
  );
  put("xl/styles.xml", styles.xml(), "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml");
  put("xl/sharedStrings.xml", strings.xml(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${overrides.join("")}</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const order = ["[Content_Types].xml", "_rels/.rels"];
  return storeZip([
    { name: order[0], data: encoder.encode(contentTypes) },
    { name: order[1], data: encoder.encode(rootRels) },
    ...files.sort((a, b) => rank(a.name) - rank(b.name)),
  ]);
}

function rank(name: string) {
  if (name.startsWith("docProps")) return 0;
  if (name === "xl/workbook.xml") return 1;
  if (name.startsWith("xl/_rels")) return 2;
  if (name.startsWith("xl/worksheets/sheet")) return 3;
  return 4;
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
