/**
 * The page engine behind Ventory's exports (taken from Brizna's, the family's engine). Pages are recorded once as simple drawing steps
 * (boxes, lines, shapes, Helvetica text measured with the standard font metrics) and then
 * either written as a vector PDF (no fonts embedded, nothing fetched, works offline) or
 * painted onto a <canvas> for direct printing, so the PDF and the printed pages match.
 * Coordinates are in points from the top-left corner of the page.
 */

export type RGB = [number, number, number];

const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** WinAnsi codes for the typographic marks the reports use. */
const SPECIAL: Record<string, { code: number; regular: number; bold: number }> = {
  "•": { code: 0x95, regular: 350, bold: 350 },
  "–": { code: 0x96, regular: 556, bold: 556 },
  "—": { code: 0x97, regular: 1000, bold: 1000 },
  "…": { code: 0x85, regular: 1000, bold: 1000 },
  "’": { code: 0x92, regular: 222, bold: 278 },
  "‘": { code: 0x91, regular: 222, bold: 278 },
  "“": { code: 0x93, regular: 333, bold: 500 },
  "”": { code: 0x94, regular: 333, bold: 500 },
  "€": { code: 0x80, regular: 556, bold: 556 },
};

/** Latin-1 widths that differ from their plain letter (Helvetica AFM). */
const LATIN1: Record<string, [number, number]> = {
  "·": [278, 278], "×": [584, 584], "¿": [611, 611], "¡": [333, 333], "°": [400, 400], "º": [365, 365], "ª": [370, 370],
  "«": [556, 556], "»": [556, 556], "½": [834, 834], "¼": [834, 834], "©": [737, 737], "®": [737, 737],
};

function charWidth(char: string, bold: boolean): number {
  const special = SPECIAL[char];
  if (special) return bold ? special.bold : special.regular;
  const latin = LATIN1[char];
  if (latin) return bold ? latin[1] : latin[0];
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return (bold ? BOLD : REGULAR)[code - 32] ?? 556;
  const base = char.normalize("NFD").charAt(0);
  const baseCode = base.charCodeAt(0);
  if (baseCode >= 32 && baseCode <= 126) return (bold ? BOLD : REGULAR)[baseCode - 32] ?? 556;
  return 556;
}

/** Keeps what WinAnsi can print (every Spanish accent, ñ, ¿, ¡ stay); folds or drops the rest. */
export function printable(text: string): string {
  let out = "";
  for (const char of String(text ?? "")) {
    if (SPECIAL[char]) {
      out += char;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code >= 32 && code <= 126) out += char;
    else if (code >= 0xa0 && code <= 0xff) out += code === 0xa0 ? " " : char;
    else if (char === "\t" || char === "\n" || char === "\r") out += " ";
    else if (char === "\u2011" || char === "\u2010") out += "-";
    else {
      const base = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (/^[\x20-\x7e]+$/.test(base)) out += base;
    }
  }
  return out;
}

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const special = SPECIAL[char];
    const code = special ? special.code : char.charCodeAt(0);
    if (char === "\\" || char === "(" || char === ")") out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    else out += `\\${code.toString(8).padStart(3, "0")}`;
  }
  return out;
}

export function textWidth(text: string, size: number, bold = false): number {
  let total = 0;
  for (const char of printable(text)) total += charWidth(char, bold);
  return (total * size) / 1000;
}

export function fitText(text: string, size: number, max: number, bold = false): string {
  const clean = printable(text);
  if (textWidth(clean, size, bold) <= max) return clean;
  let cut = clean;
  while (cut.length > 0 && textWidth(`${cut}…`, size, bold) > max) cut = cut.slice(0, -1);
  return cut ? `${cut.trimEnd()}…` : "";
}

/** Splits text into lines that fit a width (a word longer than the line is cut). */
export function wrapText(text: string, size: number, max: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of String(text ?? "").split(/\n+/)) {
    const words = printable(para).split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const tryLine = line ? `${line} ${word}` : word;
      if (textWidth(tryLine, size, bold) <= max || !line) line = tryLine;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.map((item) => fitText(item, size, max, bold));
}

export function hex(value: string): RGB {
  const clean = value.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(clean.slice(at, at + 2), 16) / 255) as RGB;
}

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: "left" | "right" | "center";
  max?: number;
}

type Op =
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: RGB | null; stroke?: RGB | null; lw: number }
  | { t: "round"; x: number; y: number; w: number; h: number; r: number; fill?: RGB | null; stroke?: RGB | null; lw: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: RGB; lw: number; dash?: number[]; cap?: boolean }
  | { t: "poly"; pts: [number, number][]; fill?: RGB | null; stroke?: RGB | null; lw: number; curve?: boolean }
  | { t: "tick"; x: number; y: number; s: number; stroke: RGB; lw: number }
  | { t: "text"; x: number; y: number; s: string; size: number; bold: boolean; color: RGB; w: number };

/** A document recorded page by page. */
export class Doc {
  readonly width: number;
  readonly height: number;
  private pages: Op[][] = [];
  private current = -1;

  constructor(width = 612, height = 792) {
    this.width = width;
    this.height = height;
  }

  get pageCount() {
    return this.pages.length;
  }

  get pageIndex() {
    return this.current;
  }

  addPage() {
    this.pages.push([]);
    this.current = this.pages.length - 1;
  }

  /** Returns to a page already made (footers that need the final page count). */
  usePage(index: number) {
    if (index >= 0 && index < this.pages.length) this.current = index;
  }

  private push(op: Op) {
    if (this.pages.length === 0) this.addPage();
    this.pages[this.current]?.push(op);
  }

  rect(x: number, y: number, w: number, h: number, fill?: RGB | null, stroke?: RGB | null, lw = 0.6) {
    this.push({ t: "rect", x, y, w, h, fill, stroke, lw });
  }

  round(x: number, y: number, w: number, h: number, r: number, fill?: RGB | null, stroke?: RGB | null, lw = 0.6) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    this.push({ t: "round", x, y, w, h, r: rr, fill, stroke, lw });
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: RGB, lw = 0.6, dash?: number[], cap = false) {
    this.push({ t: "line", x1, y1, x2, y2, stroke, lw, dash, cap });
  }

  /** A closed shape through points; curve = smooth quadratic through the midpoints (leaves, blades). */
  poly(pts: [number, number][], fill?: RGB | null, stroke?: RGB | null, lw = 0.6, curve = false) {
    if (pts.length < 3) return;
    this.push({ t: "poly", pts, fill, stroke, lw, curve });
  }

  checkbox(x: number, y: number, size: number, stroke: RGB) {
    this.round(x, y, size, size, 1.6, [1, 1, 1], stroke, 0.8);
  }

  tick(x: number, y: number, size: number, stroke: RGB, lw = 1.2) {
    this.push({ t: "tick", x, y, s: size, stroke, lw });
  }

  circle(cx: number, cy: number, r: number, fill?: RGB | null, stroke?: RGB | null) {
    this.round(cx - r, cy - r, r * 2, r * 2, r, fill, stroke, 0.7);
  }

  /** Text whose top sits at y (cap-height aligned). Returns the width drawn. */
  text(x: number, y: number, value: string, options: TextOptions = {}) {
    const size = options.size ?? 9;
    const bold = options.bold ?? false;
    const shown = options.max != null ? fitText(value, size, options.max, bold) : printable(value);
    if (!shown) return 0;
    const width = textWidth(shown, size, bold);
    let left = x;
    if (options.align === "right") left = x - width;
    else if (options.align === "center") left = x - width / 2;
    this.push({ t: "text", x: left, y, s: shown, size, bold, color: options.color ?? [0, 0, 0], w: width });
    return width;
  }

  /** Paints one page on a 2D canvas context, scaled. Used by Print. */
  paint(index: number, ctx: CanvasRenderingContext2D, scale: number) {
    const ops = this.pages[index] ?? [];
    const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.width, this.height);
    const roundPath = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    };
    const finish = (fill?: RGB | null, stroke?: RGB | null, lw = 0.6) => {
      if (fill) {
        ctx.fillStyle = css(fill);
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = css(stroke);
        ctx.lineWidth = lw;
        ctx.stroke();
      }
    };
    for (const op of ops) {
      if (op.t === "rect") {
        ctx.beginPath();
        ctx.rect(op.x, op.y, op.w, op.h);
        finish(op.fill, op.stroke, op.lw);
      } else if (op.t === "round") {
        roundPath(op.x, op.y, op.w, op.h, op.r);
        finish(op.fill, op.stroke, op.lw);
      } else if (op.t === "line") {
        ctx.beginPath();
        ctx.setLineDash(op.dash ?? []);
        ctx.lineCap = op.cap ? "round" : "butt";
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.strokeStyle = css(op.stroke);
        ctx.lineWidth = op.lw;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = "butt";
      } else if (op.t === "poly") {
        ctx.beginPath();
        polyPath(op.pts, op.curve ?? false, (x, y) => ctx.moveTo(x, y), (x, y) => ctx.lineTo(x, y), (cx, cy, x, y) => ctx.quadraticCurveTo(cx, cy, x, y));
        ctx.closePath();
        finish(op.fill, op.stroke, op.lw);
      } else if (op.t === "tick") {
        ctx.beginPath();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.moveTo(op.x, op.y + op.s * 0.55);
        ctx.lineTo(op.x + op.s * 0.36, op.y + op.s * 0.9);
        ctx.lineTo(op.x + op.s, op.y + op.s * 0.12);
        ctx.strokeStyle = css(op.stroke);
        ctx.lineWidth = op.lw;
        ctx.stroke();
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
      } else {
        ctx.font = `${op.bold ? "bold " : ""}${op.size}px Helvetica, Arial, "Liberation Sans", Arimo, Roboto, sans-serif`;
        ctx.fillStyle = css(op.color);
        ctx.textBaseline = "alphabetic";
        // maxWidth keeps a slightly wider screen font inside the column the PDF measured.
        ctx.fillText(op.s, op.x, op.y + op.size * 0.72, Math.max(1, op.w + 0.3));
      }
    }
    ctx.restore();
  }

  toBytes(title: string, author: string): Uint8Array {
    const n = (value: number) => (Math.round(value * 100) / 100).toString();
    const color = (rgb: RGB) => rgb.map((part) => n(part)).join(" ");
    const H = this.height;
    const roundCmd = (x: number, y: number, w: number, h: number, r: number) => {
      const k = 0.5523 * r;
      const top = H - y;
      const bottom = top - h;
      return [
        `${n(x + r)} ${n(bottom)} m`,
        `${n(x + w - r)} ${n(bottom)} l`,
        `${n(x + w - r + k)} ${n(bottom)} ${n(x + w)} ${n(bottom + r - k)} ${n(x + w)} ${n(bottom + r)} c`,
        `${n(x + w)} ${n(top - r)} l`,
        `${n(x + w)} ${n(top - r + k)} ${n(x + w - r + k)} ${n(top)} ${n(x + w - r)} ${n(top)} c`,
        `${n(x + r)} ${n(top)} l`,
        `${n(x + r - k)} ${n(top)} ${n(x)} ${n(top - r + k)} ${n(x)} ${n(top - r)} c`,
        `${n(x)} ${n(bottom + r)} l`,
        `${n(x)} ${n(bottom + r - k)} ${n(x + r - k)} ${n(bottom)} ${n(x + r)} ${n(bottom)} c`,
        "h",
      ].join(" ");
    };
    const paintCmd = (path: string, fill?: RGB | null, stroke?: RGB | null, lw = 0.6) => {
      if (fill && stroke) return `${color(fill)} rg ${color(stroke)} RG ${n(lw)} w ${path} B`;
      if (fill) return `${color(fill)} rg ${path} f`;
      if (stroke) return `${color(stroke)} RG ${n(lw)} w ${path} S`;
      return "";
    };
    const pageStreams = this.pages.map((ops) =>
      ops
        .map((op) => {
          if (op.t === "rect") return paintCmd(`${n(op.x)} ${n(H - op.y - op.h)} ${n(op.w)} ${n(op.h)} re`, op.fill, op.stroke, op.lw);
          if (op.t === "round") return paintCmd(op.r > 0 ? roundCmd(op.x, op.y, op.w, op.h, op.r) : `${n(op.x)} ${n(H - op.y - op.h)} ${n(op.w)} ${n(op.h)} re`, op.fill, op.stroke, op.lw);
          if (op.t === "line") {
            const pattern = op.dash ? `[${op.dash.map(n).join(" ")}] 0 d ` : "";
            const reset = op.dash ? " [] 0 d" : "";
            const cap = op.cap ? "1 J " : "";
            const capReset = op.cap ? " 0 J" : "";
            return `${pattern}${cap}${color(op.stroke)} RG ${n(op.lw)} w ${n(op.x1)} ${n(H - op.y1)} m ${n(op.x2)} ${n(H - op.y2)} l S${reset}${capReset}`;
          }
          if (op.t === "poly") {
            const parts: string[] = [];
            polyPath(
              op.pts,
              op.curve ?? false,
              (x, y) => parts.push(`${n(x)} ${n(H - y)} m`),
              (x, y) => parts.push(`${n(x)} ${n(H - y)} l`),
              (cx, cy, x, y, px, py) => {
                // Quadratic → cubic.
                const c1x = px + (2 / 3) * (cx - px);
                const c1y = py + (2 / 3) * (cy - py);
                const c2x = x + (2 / 3) * (cx - x);
                const c2y = y + (2 / 3) * (cy - y);
                parts.push(`${n(c1x)} ${n(H - c1y)} ${n(c2x)} ${n(H - c2y)} ${n(x)} ${n(H - y)} c`);
              },
            );
            parts.push("h");
            return paintCmd(parts.join(" "), op.fill, op.stroke, op.lw);
          }
          if (op.t === "tick") {
            const top = H - op.y;
            return `${color(op.stroke)} RG ${n(op.lw)} w 1 J 1 j ${n(op.x)} ${n(top - op.s * 0.55)} m ${n(op.x + op.s * 0.36)} ${n(top - op.s * 0.9)} l ${n(op.x + op.s)} ${n(top - op.s * 0.12)} l S 0 J 0 j`;
          }
          const baseline = H - op.y - op.size * 0.72;
          return `BT /${op.bold ? "F2" : "F1"} ${n(op.size)} Tf ${color(op.color)} rg ${n(op.x)} ${n(baseline)} Td (${encode(op.s)}) Tj ET`;
        })
        .filter(Boolean)
        .join("\n"),
    );
    const chunks: string[] = [];
    chunks[1] = "1 0 obj << /Type /Catalog /Pages 2 0 R /ViewerPreferences << /PrintScaling /None /DisplayDocTitle true >> >> endobj\n";
    const pageIds: number[] = [];
    let nextId = 3;
    const fontId = nextId;
    const boldId = nextId + 1;
    const infoId = nextId + 2;
    nextId += 3;
    for (const stream0 of pageStreams) {
      const contentId = nextId;
      const pageId = nextId + 1;
      nextId += 2;
      pageIds.push(pageId);
      const stream = `${stream0}\n`;
      chunks[contentId] = `${contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}endstream endobj\n`;
      chunks[pageId] = `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R /F2 ${boldId} 0 R >> >> >> endobj\n`;
    }
    chunks[fontId] = `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n`;
    chunks[boldId] = `${boldId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n`;
    chunks[infoId] = `${infoId} 0 obj << /Title (${encode(printable(title))}) /Author (${encode(printable(author))}) /Producer (Ventory) /Creator (Ventory) >> endobj\n`;
    chunks[2] = `2 0 obj << /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >> endobj\n`;
    const ids = Object.keys(chunks).map(Number).sort((a, b) => a - b);
    let body = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
    const offsets: number[] = [];
    for (const id of ids) {
      offsets[id] = body.length;
      body += chunks[id];
    }
    const xref = body.length;
    const size = Math.max(...ids) + 1;
    body += `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let id = 1; id < size; id += 1) body += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
    body += `trailer << /Size ${size} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(body.length);
    for (let index = 0; index < body.length; index += 1) bytes[index] = body.charCodeAt(index) & 0xff;
    return bytes;
  }
}

function polyPath(
  pts: [number, number][],
  curve: boolean,
  move: (x: number, y: number) => void,
  line: (x: number, y: number) => void,
  quad: (cx: number, cy: number, x: number, y: number, px: number, py: number) => void,
) {
  if (!curve) {
    pts.forEach(([x, y], i) => (i === 0 ? move(x, y) : line(x, y)));
    return;
  }
  // Smooth closed curve: start at the midpoint of the last edge, curve through each point.
  const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const last = pts[pts.length - 1]!;
  let prev = mid(last, pts[0]!);
  move(prev[0], prev[1]);
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const m = mid(p, next);
    quad(p[0], p[1], m[0], m[1], prev[0], prev[1]);
    prev = m;
  }
}
