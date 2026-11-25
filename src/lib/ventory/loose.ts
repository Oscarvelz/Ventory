/*
 * The loose-text reader (1.12.0) — Vela's batch pattern carried to
 * merchandise, as Oscar ordered: a supplier's message, a sale note, an ad's
 * text, pasted as it was written (English, Spanish, mixed, typos), read and
 * settled as pieces with the house's fields — product, brand, category,
 * quantity, the prices and costs, dates, status, source, channel, client.
 *
 * paste.ts remains the reader for Oscar's ledger lines; this reader is for
 * prose. It returns the same { rows, loose } shape, so the tray, its review
 * groups and its duplicate clusters work unchanged.
 *
 * The law is Vela's, word for word: nothing is invented. A field the text
 * does not speak to stays empty, and whatever words could not be turned
 * into a field stay on the piece as its note — or, when a whole sentence
 * carries no piece at all, as a loose line the tray still shows.
 */
import { dollarsToCents, emptyInput } from "./model";
import {
  marksOf,
  personName,
  placeOf,
  takeCost,
  takeRebate,
  takeSale,
  takeSize,
  type DetailedRow,
  type LooseLine,
  type RowIssue,
  type RowKind,
} from "./paste";
import {
  ASK_FRAME,
  BUY_RE,
  CHANNEL_RULES,
  COST_FRAME,
  DESCRIPTORS,
  EACH_MARK,
  FAILED_RE,
  FILLER,
  FUZZY_STOP,
  FUZZY_WORDS,
  GIFT_RE,
  INCOMING_RE,
  KEPT_RE,
  KNOWN_BRANDS,
  MONTHS,
  NAME_STOP,
  NEGATORS,
  NOT_YET_AFTER,
  NUMBER_WORDS,
  PRODUCT_BLOCKS,
  PRODUCT_RULES,
  RESERVED_RE,
  RETURNED_RE,
  SALE_FRAME,
  SELL_RE,
  SOURCE_RULES,
  STILL_HAVE_RE,
  TOTAL_MARK,
  WEEKDAYS,
  looksSpanish,
} from "./loose-lexicon";

// ------------------------------------------------------------------ helpers

type Span = { start: number; end: number };

/** Lower case, accents off, one output char per input UTF-16 unit, so indices line up with the original. */
export function fold(text: string) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) {
      out += " ";
      continue;
    }
    if (ch === "’" || ch === "‘" || ch === "´" || ch === "`") {
      out += "'";
      continue;
    }
    let f = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (f.length !== 1) f = f ? f[0] : " ";
    out += f;
  }
  return out;
}

function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function overlaps(a: Span, b: Span) {
  return a.start < b.end && b.start < a.end;
}

function freeOf(spans: Span[], span: Span) {
  return !spans.some((s) => overlaps(s, span));
}

function* matches(re: RegExp, text: string) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    yield m;
  }
}

function isoOf(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shift(base: Date, days: number) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

/** Sentence-ish pieces of one line. Keeps decimals and month abbreviations together. */
function sentences(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === ";" || ch === "!" || ch === "?") {
      out.push(line.slice(start, i + 1));
      start = i + 1;
    } else if (ch === ".") {
      const before = line.slice(Math.max(0, i - 4), i).toLowerCase();
      const next = line[i + 1] ?? "";
      if (/\d$/.test(before) && /\d/.test(next)) continue; // a decimal
      if (/\b(?:[ap]|oct|sept?|set|nov|dec|dic|jan|ene|feb|mar|apr|abr|aug|ago|jun|jul|dr|sr|sra|mr|mrs|etc)$/.test(before.trim()) && next !== "") continue;
      out.push(line.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < line.length) out.push(line.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Utterances: lines first; a long line is cut into its sentences. */
function utterances(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 110 || /[.!?;]\s+\S/.test(line)) out.push(...sentences(line));
    else out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------ dates

type Anchor = Span & { date: string; writtenYear: boolean; invalid?: boolean; future?: boolean };

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WEEKDAY_RE = Object.keys(WEEKDAYS).join("|");
const NUM_WORD_SRC = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).map(escapeRe).join("|");

function validDay(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function settle(month: number, day: number, givenYear: number | null, today: Date): { date: string; invalid?: boolean } {
  let year = givenYear ?? today.getFullYear();
  if (!givenYear && new Date(year, month - 1, day).getTime() > today.getTime() + 45 * 86_400_000) year -= 1;
  if (!validDay(year, month, day)) {
    // A stated day the month does not have (Feb 30): no date is filed and
    // the row is flagged — the typed words stay in the note (Vela B5).
    if (month >= 1 && month <= 12 && day > 28) return { date: "", invalid: true };
    return { date: "", invalid: true };
  }
  return { date: isoOf(new Date(year, month - 1, day)) };
}

function findAnchors(folded: string, today: Date, dayFirst: boolean): Anchor[] {
  const found: Anchor[] = [];
  const push = (span: Span, month: number, day: number, year: number | null) => {
    if (!freeOf(found, span)) return;
    const s = settle(month, day, year, today);
    found.push({ ...span, date: s.date, writtenYear: year != null, invalid: s.invalid });
  };
  const fullYear = (raw: string) => {
    const n = Number(raw);
    return n > 1900 ? n : n >= 0 && n < 100 ? 2000 + n : null;
  };
  for (const m of matches(new RegExp(`\\b(${MONTH_RE})\\b\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*((?:19|20)\\d{2}))?`, "g"), folded)) {
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, MONTHS[m[1]], Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  for (const m of matches(new RegExp(`\\b(?:el\\s+|the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?(${MONTH_RE})\\b\\.?(?:\\s*,?\\s*(?:de\\s+|del\\s+)?((?:19|20)\\d{2}))?`, "g"), folded)) {
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, MONTHS[m[2]], Number(m[1]), m[3] ? Number(m[3]) : null);
  }
  for (const m of matches(/(?<![\d/.])\b(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})\b/g, folded)) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) [day, month] = [a, b];
    else if (b > 12 && a <= 12) [month, day] = [a, b];
    else if (dayFirst || m[2] === ".") [day, month] = [a, b];
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, month, day, fullYear(m[4]));
  }
  for (const m of matches(/(?<![\d/.:])\b(\d{1,2})\/(\d{1,2})\b(?![\d/])/g, folded)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let month = a;
    let day = b;
    if (a > 12 && b <= 12) [day, month] = [a, b];
    else if (dayFirst && b <= 12 && a <= 31) [day, month] = [a, b];
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, month, day, null);
  }
  // "el 15" / "on the 15th": the most recent past 15th.
  for (const m of matches(/\b(?:on the|el dia|el|the)\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!\s*(?:de|del|of|veces|vez|times|min|horas|hrs|%))/g, folded)) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    let month = today.getMonth() + 1;
    let year = today.getFullYear();
    if (day > today.getDate()) {
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }
    push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }, month, day, year);
  }
  const rel = (re: RegExp, days: (m: RegExpExecArray) => number | null, futureOk = false) => {
    for (const m of matches(re, folded)) {
      const n = days(m);
      if (n === null) continue;
      const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      if (!freeOf(found, span)) continue;
      found.push({ ...span, date: isoOf(shift(today, n)), writtenYear: false, future: n > 0 && !futureOk ? true : undefined });
    }
  };
  rel(/\b(?:the )?day before yesterday\b|\bantier\b|\banteayer\b|\bantes de ayer\b/g, () => -2);
  rel(/\byesterday\b|\bayer\b|\banoche\b|\blast night\b/g, () => -1);
  rel(/\btoday\b|\bhoy\b|\besta (?:manana|tarde|noche)\b|\btonight\b/g, () => 0);
  rel(/\btomorrow\b|\bmanana\b(?!\s+por la)/g, () => 1, true);
  rel(new RegExp(`\\b(${NUM_WORD_SRC}|\\d{1,3})\\s+(?:days?|dias?)\\s+ago\\b|\\bhace\\s+(${NUM_WORD_SRC}|\\d{1,3})\\s+(?:dias?|days?)\\b`, "g"), (m) => {
    const w = m[1] || m[2];
    const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? null;
    return n && n < 400 ? -n : null;
  });
  rel(/\b(?:a|one) week ago\b|\bhace una semana\b/g, () => -7);
  rel(new RegExp(`\\b(${NUM_WORD_SRC}|\\d{1,2})\\s+(?:weeks?|semanas?)\\s+ago\\b|\\bhace\\s+(${NUM_WORD_SRC}|\\d{1,2})\\s+(?:weeks?|semanas?)\\b`, "g"), (m) => {
    const w = m[1] || m[2];
    const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? null;
    return n && n < 60 ? -7 * n : null;
  });
  rel(new RegExp(`\\b(?:(?:last|el|este|on)\\s+)?(${WEEKDAY_RE})\\b(\\s+pasado)?`, "g"), (m) => {
    const target = WEEKDAYS[m[1]];
    let back = (today.getDay() - target + 7) % 7;
    if (back === 0 && (/\b(?:last)\b/.test(m[0]) || m[2])) back = 7;
    // A bare weekday only counts with a governor ("el martes", "last Friday",
    // "on Monday") — a weekday floating in chatter is not a date.
    if (!/(?:last|el|este|on)\s+$/.test(folded.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0)) && !m[2] && !/^(?:el|este)\s/.test(m[0])) return null;
    return -back;
  });
  return found.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ products & names

type ProductHit = Span & { category: string; fit: string; noun: string };

function editDistance(a: string, b: string) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

function productHits(folded: string): ProductHit[] {
  const blocked: Span[] = [];
  for (const re of PRODUCT_BLOCKS) for (const m of matches(re, folded)) blocked.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  const hits: ProductHit[] = [];
  for (const rule of PRODUCT_RULES) {
    for (const m of matches(rule.re, folded)) {
      const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      if (!freeOf(blocked, span) || !freeOf(hits, span)) continue;
      hits.push({ ...span, category: rule.category, fit: rule.fit, noun: m[0] });
    }
  }
  if (!hits.length) {
    // One typo away still names the product ("relos" for reloj) — first
    // letter and length must agree, and real neighbour words are stopped.
    for (const m of matches(/[a-z]{5,}/g, folded)) {
      const word = m[0];
      if (FUZZY_STOP.has(word)) continue;
      for (const fz of FUZZY_WORDS) {
        if (fz.kind !== "product" || fz.word[0] !== word[0] || Math.abs(fz.word.length - word.length) > 1) continue;
        if (editDistance(word, fz.word) === 1) {
          const rule = PRODUCT_RULES.find((r) => r.category === fz.value);
          if (rule) hits.push({ start: m.index ?? 0, end: (m.index ?? 0) + word.length, category: rule.category, fit: rule.fit, noun: word });
          break;
        }
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

type WordTok = Span & { raw: string; folded: string };

function wordsOf(text: string, folded: string): WordTok[] {
  const out: WordTok[] = [];
  for (const m of matches(/[\p{L}0-9][\p{L}0-9'’.-]*/gu, text)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, raw: m[0], folded: folded.slice(start, start + m[0].length) });
  }
  return out;
}

/** The piece's name, in the text's own words: brand and descriptors around the product noun. */
function nameAround(text: string, folded: string, hit: ProductHit): { name: string; brand: string; span: Span } {
  const toks = wordsOf(text, folded);
  const at = toks.findIndex((t) => t.start <= hit.start && t.end >= hit.end - 1 || (t.start >= hit.start && t.start < hit.end));
  const nounIdx = at >= 0 ? at : toks.findIndex((t) => t.start >= hit.start);
  if (nounIdx < 0) return { name: text.slice(hit.start, hit.end), brand: "", span: hit };
  const isDescriptor = (f: string) => DESCRIPTORS.has(f) || DESCRIPTORS.has(f.replace(/s$/, "")) || DESCRIPTORS.has(f.replace(/es$/, ""));
  let lo = nounIdx;
  let brand = "";
  for (let i = nounIdx - 1; i >= 0 && nounIdx - i <= 3; i -= 1) {
    const tok = toks[i];
    const f = tok.folded.replace(/['’.]/g, "");
    const twoWord = i > 0 ? `${toks[i - 1].folded} ${f}` : "";
    if (KNOWN_BRANDS.includes(twoWord)) {
      brand = `${toks[i - 1].raw} ${tok.raw}`;
      lo = i - 1;
      break;
    }
    if (KNOWN_BRANDS.includes(f)) {
      brand = tok.raw;
      lo = i;
      break;
    }
    if (isDescriptor(f)) {
      lo = i;
      continue;
    }
    if (/^\p{Lu}/u.test(tok.raw) && !NAME_STOP.has(f) && !/^\d/.test(tok.raw)) {
      brand = tok.raw;
      lo = i;
      break;
    }
    break;
  }
  let hi = nounIdx;
  for (let i = nounIdx + 1; i < toks.length && i - nounIdx <= 3; i += 1) {
    const f = toks[i].folded.replace(/['’.]/g, "");
    if (isDescriptor(f) || KNOWN_BRANDS.includes(f)) {
      if (KNOWN_BRANDS.includes(f) && !brand) brand = toks[i].raw;
      hi = i;
      continue;
    }
    // "de cuero", "de acero": the bridge word rides along when a descriptor follows it.
    if (f === "de" && i + 1 < toks.length && isDescriptor(toks[i + 1].folded.replace(/['’.]/g, ""))) {
      hi = i + 1;
      i += 1;
      continue;
    }
    break;
  }
  const span = { start: toks[lo].start, end: toks[hi].end };
  return { name: text.slice(span.start, span.end).replace(/\s+/g, " ").trim(), brand, span };
}

// ------------------------------------------------------------------ quantity

function quantityOf(folded: string, hit: ProductHit | null): { qty: number; span: Span | null } {
  const zones: Span[] = hit
    ? [
        { start: Math.max(0, hit.start - 30), end: hit.end + 20 },
        { start: 0, end: folded.length },
      ]
    : [{ start: 0, end: folded.length }];
  for (const zone of zones) {
    const text = folded.slice(zone.start, zone.end);
    const patterns: RegExp[] = [
      new RegExp(`\\b(\\d{1,3})\\s*x\\b`, "g"),
      new RegExp(`\\bx\\s*(\\d{1,3})\\b`, "g"),
      new RegExp(`\\b(${NUM_WORD_SRC}|\\d{1,3})\\s+(?:pares|pairs|piezas|pieces|unidades|units)\\b`, "g"),
      // A number before the noun, with a brand or a word riding between ("4 Casio watches", "3 pares de botas").
      new RegExp(`\\b(${NUM_WORD_SRC}|\\d{1,3})\\s+(?:(?:de)\\s+)?(?=${escapeRe(hit?.noun ?? "$^")})`, "g"),
      new RegExp(`\\b(${NUM_WORD_SRC}|\\d{1,3})\\s+(?:\\w+\\s+){1,2}?(?=${escapeRe(hit?.noun ?? "$^")})`, "g"),
      /\b(?:una docena|a dozen|dozen)\b/g,
      /\b(?:un par de|a pair of|par de)\b/g,
    ];
    for (const re of patterns) {
      for (const m of matches(re, text)) {
        const raw = m[1] ?? "";
        let qty = 0;
        if (/docena|dozen/.test(m[0])) qty = 12;
        else if (/par de|pair of/.test(m[0])) qty = 2;
        else if (/^\d+$/.test(raw)) qty = Number(raw);
        else qty = NUMBER_WORDS[raw] ?? 0;
        if (qty >= 1 && qty <= 500) {
          return { qty, span: { start: zone.start + (m.index ?? 0), end: zone.start + (m.index ?? 0) + m[0].length } };
        }
      }
    }
  }
  return { qty: 1, span: null };
}

// ------------------------------------------------------------------ status & negation

type VerbHit = Span & { text: string };

function verbHits(re: RegExp, folded: string): VerbHit[] {
  return [...matches(re, folded)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }));
}

/** Clause-scoped negation (Vela's scope, simplified): a negator in the verb's own clause, before it, kills the verb. */
function negatedAt(folded: string, hit: Span): boolean {
  const clauseStart = Math.max(
    folded.lastIndexOf(",", hit.start - 1),
    folded.lastIndexOf(".", hit.start - 1),
    folded.lastIndexOf(";", hit.start - 1),
    folded.lastIndexOf("\n", hit.start - 1),
  ) + 1;
  let before = folded.slice(clauseStart, hit.start);
  const brk = Math.max(before.lastIndexOf(" pero "), before.lastIndexOf(" but "), before.lastIndexOf(" aunque "), before.lastIndexOf(" though "));
  if (brk >= 0) before = before.slice(brk + 1);
  if (/\b(?:no|nunca|sin|not|never|didn't|didnt|don't|dont)\b/.test(before)) return true;
  if (NOT_YET_AFTER.test(folded.slice(hit.end, hit.end + 12))) return true;
  void NEGATORS;
  return false;
}

// ------------------------------------------------------------------ people

/** A name after a cue, read from the ORIGINAL text (capitals carry meaning) and validated by the house's personName. */
function cuedName(text: string, folded: string, cues: RegExp[]): { name: string; span: Span } | null {
  for (const cue of cues) {
    for (const m of matches(cue, folded)) {
      const at = (m.index ?? 0) + m[0].length;
      const rest = text.slice(at, at + 30);
      const cap = rest.match(/^\s*([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)/u);
      if (cap) {
        const name = personName(cap[1].replace(/[.,;]+$/g, ""));
        if (name) return { name, span: { start: at, end: at + cap[0].length } };
      }
    }
  }
  return null;
}

/** The lowercase cued name ("se lo vendi a maria"): only when no capitalised candidate exists anywhere in the entry. */
function cuedNameLower(text: string, folded: string, cues: RegExp[], hasCapital: boolean): { name: string; span: Span } | null {
  if (hasCapital) return null;
  for (const cue of cues) {
    for (const m of matches(cue, folded)) {
      const at = (m.index ?? 0) + m[0].length;
      const tok = folded.slice(at, at + 24).match(/^\s*([a-z]{3,20})\b/);
      if (!tok) continue;
      const word = tok[1];
      if (NAME_STOP.has(word) || DESCRIPTORS.has(word) || MONTHS[word] || WEEKDAYS[word] !== undefined) continue;
      if (PRODUCT_RULES.some((r) => new RegExp(r.re.source).test(word))) continue;
      const raw = text.slice(at).match(/^\s*(\S+)/)?.[1] ?? word;
      return { name: raw.charAt(0).toUpperCase() + raw.slice(1), span: { start: at, end: at + tok[0].length } };
    }
  }
  return null;
}

// ------------------------------------------------------------------ money

const AMOUNT_RE = /\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|\b([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:dolares|dollars|usd)\b/g;

type FramedAmount = Span & { cents: number; role: "cost" | "ask" | "sale"; each: boolean; total: boolean };

function framedAmounts(folded: string): FramedAmount[] {
  const out: FramedAmount[] = [];
  for (const m of matches(AMOUNT_RE, folded)) {
    const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
    if (!freeOf(out, span)) continue;
    const cents = dollarsToCents((m[1] ?? m[2]).replace(/\s+/g, ""));
    if (cents <= 0) continue;
    const before = folded.slice(Math.max(0, span.start - 36), span.start);
    const after = folded.slice(span.end, span.end + 18);
    let role: FramedAmount["role"] | null = null;
    if (COST_FRAME.test(before)) role = "cost";
    else if (SALE_FRAME.test(before)) role = "sale";
    else if (ASK_FRAME.test(before)) role = "ask";
    if (!role) {
      // Verb proximity: the nearest governing verb in the amount's own
      // clause names the money when a name or a few words ride between
      // the verb and the price ("Vendí las botas a Juan Pérez por $55",
      // "Me las había comprado en Temu a $38", "pedía $50 por ellas").
      const wide = folded.slice(Math.max(0, span.start - 64), span.start);
      const clause = wide.slice(Math.max(wide.lastIndexOf(","), wide.lastIndexOf("."), wide.lastIndexOf(";")) + 1);
      const near = (re: RegExp) => {
        let at = -1;
        for (const vm of matches(re, clause)) at = vm.index ?? 0;
        return at;
      };
      const buyAt = near(/\b(?:compr\w+|bought|buying|pagu\w+|traje|trajeron|recib\w+|llego|llegaron|agarr\w+|consegu\w+|pedi|pedido|ordered)\b/g);
      const sellAt = near(/\b(?:vendi|vendido|vendida|vendidos|vendidas|vendio|vendieron|sold|se fue)\b/g);
      const askAt = near(/\b(?:pid\w+|pido|asking|vendo|vendiendo|selling)\b/g);
      const prep = /(?:por|en|a|for|at|de)\s+$/.test(clause) || clause.trimEnd().length >= clause.length - 14;
      if (prep && (buyAt >= 0 || sellAt >= 0 || askAt >= 0)) {
        const best = Math.max(buyAt, sellAt, askAt);
        role = best === sellAt ? "sale" : best === askAt ? "ask" : "cost";
      }
    }
    if (!role) continue;
    out.push({
      ...span,
      cents,
      role,
      each: EACH_MARK.test(after) || /\ba\s+$/.test(before) || /\bat\s+$/.test(before),
      total: TOTAL_MARK.test(after),
    });
  }
  return out;
}

/** Per-unit settling: an amount written for the whole lot is divided only when it divides exactly. */
function settleAmount(amount: FramedAmount | null, qty: number): { perUnit: number; totalNote: string } {
  if (!amount) return { perUnit: 0, totalNote: "" };
  if (qty <= 1 || amount.each) return { perUnit: amount.cents, totalNote: "" };
  if (amount.total || !amount.each) {
    if (amount.cents % qty === 0) return { perUnit: amount.cents / qty, totalNote: `Total $${(amount.cents / 100).toFixed(2)}` };
    return { perUnit: 0, totalNote: `Total written: $${(amount.cents / 100).toFixed(2)} for ${qty}` };
  }
  return { perUnit: amount.cents, totalNote: "" };
}

function mask(text: string, spans: Span[]): string {
  const chars = text.split("");
  for (const span of spans) for (let i = span.start; i < span.end && i < chars.length; i += 1) chars[i] = " ";
  return chars.join("");
}

/** The note's residue: what is left of the text once the fields are taken out, filler dropped. */
function residueNote(leftover: string): string {
  const kept: string[] = [];
  for (const clause of leftover.split(/[,;.!?\n]+/)) {
    const words = fold(clause).split(/[^a-z0-9']+/).filter((w) => w.length >= 2);
    if (words.some((w) => !FILLER.has(w.replace(/'/g, "")) && !FILLER.has(w))) kept.push(clause.trim());
  }
  return kept.join(", ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
}

// ------------------------------------------------------------------ reading one entry

export type LooseContext = {
  lang?: "en" | "es";
  soldBatch?: boolean;
  section?: string;
  ctxSource?: string;
  ctxReceivedOn?: string | null;
};

function readEntry(text: string, today: Date, ctx: LooseContext): DetailedRow | null {
  const reb = takeRebate(text);
  const work = reb.line;
  const folded = fold(work);
  const claimed: Span[] = [];
  const issues: RowIssue[] = [...reb.issues];
  const notes: string[] = [...reb.notes];

  const dayFirst = ctx.lang === "es" || looksSpanish(folded);
  const anchors = findAnchors(folded, today, dayFirst);
  // A date inside a payment promise ("me lo paga el viernes") is not a
  // date of the piece: it is not filed, and its words stay in the note.
  const payClaused = (a: Anchor) => {
    const before = folded.slice(Math.max(0, a.start - 50), a.start);
    const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf("."), before.lastIndexOf(";")) + 1);
    return /\b(?:paga|pagara|pagar|pagaria|will pay|pays|pay me|me debe|owes)\b/.test(clause);
  };
  const validAnchors = anchors.filter((a) => a.date && !payClaused(a));
  if (anchors.some((a) => a.invalid)) {
    issues.push("bad-date");
    // The typed words stay visible in the note (never masked away), but
    // the span is claimed so its day number is not misread as a size.
    for (const a of anchors.filter((x) => x.invalid)) {
      claimed.push(a);
      const typed = work.slice(a.start, a.end).trim();
      if (typed) notes.push(typed);
    }
  }
  for (const a of validAnchors) claimed.push(a);

  const products = productHits(folded);
  // Several mentions of one product ("the watches arrived… 4 Casio
  // watches"): the mention that carries the brand names the piece.
  let product = products[0] ?? null;
  if (products.length > 1) {
    let bestScore = -1;
    for (const hit of products) {
      const around = nameAround(work, folded, hit);
      const score = (around.brand ? 10 : 0) + around.name.length;
      if (score > bestScore) {
        bestScore = score;
        product = hit;
      }
    }
  }
  const buyHits = verbHits(BUY_RE, folded);
  const sellHits = verbHits(SELL_RE, folded).filter((h) => !negatedAt(folded, h));
  const returnedHits = verbHits(RETURNED_RE, folded);
  const failedHits = verbHits(FAILED_RE, folded);
  const keptHits = verbHits(KEPT_RE, folded);
  const giftHits = verbHits(GIFT_RE, folded);
  const reservedHits = verbHits(RESERVED_RE, folded);
  const incomingHits = verbHits(INCOMING_RE, folded);
  const stillHave = STILL_HAVE_RE.test(folded);

  // Sale-side delivery the client paid on top, claimed before any other
  // money reader can mistake it for a price ("cobré $8 de envío").
  let deliveryEarly = 0;
  if (sellHits.length || returnedHits.length) {
    const delRe = /\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:de\s*)?(?:envio|shipping|delivery)\b|(?:envio|shipping|delivery)\s*(?:de\s*)?\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/g;
    for (const m of matches(delRe, folded)) {
      const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      if (!freeOf(claimed, span)) continue;
      deliveryEarly += dollarsToCents((m[1] ?? m[2]).replace(/\s+/g, ""));
      claimed.push(span);
    }
  }

  const framed = framedAmounts(folded).filter((f) => freeOf(claimed, f));
  for (const f of framed) claimed.push(f);

  // The verbs that became the kind are fields now, not note text (the
  // echo rule). Negated verbs were filtered out of these lists — a
  // "todavía no se ha vendido" stays in the note, where it belongs.
  for (const h of [...buyHits, ...sellHits, ...returnedHits, ...failedHits, ...keptHits, ...giftHits, ...reservedHits, ...incomingHits]) claimed.push(h);

  // ---- the person: client on a sale, recipient on a gift, name on a reservation
  const hasCapitalName = /\p{Lu}[\p{Ll}]+/u.test(text.slice(1));
  let person = "";
  let personSpan: Span | null = null;
  const sellCues = [
    /\b(?:vendido|vendida|vendidos|vendidas|vendi|sold)(?:\s+[^.;,]{0,40}?)?\s+(?:a|para|to)\s+/g,
    /\b(?:se (?:lo|la|los|las) llevo|lo compro|la compro|los compro|las compro)\s+/g,
  ];
  const found = cuedName(text, folded, sellCues) ?? cuedNameLower(text, folded, sellCues, hasCapitalName);
  if (found) {
    person = found.name;
    personSpan = found.span;
  }
  if (!person && (giftHits.length || reservedHits.length)) {
    const anchorHit = giftHits[0] ?? reservedHits[0];
    const after = folded.slice(anchorHit.start, anchorHit.end + 44);
    const cue = after.match(/\b(?:para|a|to)\s+/);
    if (cue && cue.index != null) {
      const at = anchorHit.start + cue.index + cue[0].length;
      const cap = text.slice(at, at + 30).match(/^([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)/u);
      const name = cap ? personName(cap[1].replace(/[.,;]+$/g, "")) : "";
      if (name) {
        person = name;
        personSpan = { start: at, end: at + (cap?.[0].length ?? 0) };
      }
    }
  }
  if (personSpan) claimed.push(personSpan);

  // ---- kind: the verbs decide, in the house's precedence order
  let kind: RowKind;
  const weakSellOnly = sellHits.length > 0 && sellHits.every((h) => h.text === "salio") && !product && !framed.length;
  if (returnedHits.length) kind = "returned";
  else if (failedHits.length) kind = "failed-sale";
  else if (keptHits.length) kind = "kept";
  else if (giftHits.length && (person || /\b(?:regale|regalo|regalado|regalada|gifted|gave)\b/.test(folded))) kind = "gift";
  else if (sellHits.length && !stillHave && !weakSellOnly) kind = "sale";
  else if (/\b(?:usados?|usadas?|used)\b/.test(folded) && (buyHits.length > 0 || !!product)) kind = "used";
  else if (ctx.soldBatch && !buyHits.length && (product || framed.length)) kind = "sale";
  else kind = "stock";
  const incoming = kind === "stock" && (incomingHits.length > 0 || validAnchors.some((a) => a.future) || /💙/.test(text));

  // ---- dates by role: the verb that governs the date's clause speaks first
  let receivedOn: string | null = null;
  let soldOn: string | null = null;
  let receivedWritten = false;
  let soldWritten = false;
  const roleOf = (a: Anchor): "received" | "sold" | "" => {
    const before = folded.slice(Math.max(0, a.start - 60), a.start);
    const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf("."), before.lastIndexOf(";")) + 1);
    if (/\b(?:sold|vend\w*)\s*(?:on\s+)?$/.test(clause.trimEnd() + " ") && /\b(?:sold|vendido|vendida|vendi)\b/.test(clause)) return "sold";
    const lastBuy = Math.max(clause.lastIndexOf("compre"), clause.lastIndexOf("llego"), clause.lastIndexOf("llegaron"), clause.lastIndexOf("recibi"), clause.lastIndexOf("bought"), clause.lastIndexOf("received"), clause.lastIndexOf("arrived"), clause.lastIndexOf("pedi"));
    const lastSell = Math.max(clause.lastIndexOf("vendi"), clause.lastIndexOf("vendido"), clause.lastIndexOf("sold"), clause.lastIndexOf("se fue"));
    if (lastSell > lastBuy && lastSell >= 0) return "sold";
    if (lastBuy >= 0) return "received";
    return "";
  };
  for (const a of validAnchors) {
    if (a.future) continue;
    const role = roleOf(a);
    if (role === "sold" && !soldOn) {
      soldOn = a.date;
      soldWritten = a.writtenYear;
    } else if (role === "received" && !receivedOn) {
      receivedOn = a.date;
      receivedWritten = a.writtenYear;
    }
  }
  const unroled = validAnchors.filter((a) => !a.future && a.date !== receivedOn && a.date !== soldOn);
  if (!receivedOn && unroled.length) {
    receivedOn = unroled[0].date;
    receivedWritten = unroled[0].writtenYear;
  }
  if (kind === "sale" && !soldOn && unroled.length > (receivedOn ? 1 : 0)) {
    const second = unroled[receivedOn ? 1 : 0];
    soldOn = second.date;
    soldWritten = second.writtenYear;
  }
  if (kind === "sale" && !soldOn && receivedOn && sellHits.length && !buyHits.length) {
    // A sale-only entry whose one date rides the sale verb reads as the sale date.
    const only = validAnchors.find((a) => a.date === receivedOn);
    if (only && roleOf(only) === "" && folded.slice(Math.max(0, only.start - 60), only.start).match(/\b(?:vendi|sold|se fue)\b/)) {
      soldOn = receivedOn;
      soldWritten = receivedWritten;
      receivedOn = null;
      receivedWritten = false;
    }
  }
  if (!receivedOn && ctx.ctxReceivedOn && (buyHits.length || kind === "stock")) receivedOn = ctx.ctxReceivedOn;
  if (receivedOn && soldOn && soldOn < receivedOn && !soldWritten) {
    const [y, m, d] = soldOn.split("-").map(Number);
    soldOn = `${y + 1}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // ---- quantity
  const { qty, span: qtySpan } = quantityOf(folded, product);
  if (qtySpan) claimed.push(qtySpan);

  // ---- name & category (claimed before the money pass, so the name's
  // words are part of the fields and never restated in the note)
  let name = "";
  let category = "";
  let fit = "";
  let brand = "";
  if (product) {
    const around = nameAround(work, folded, product);
    name = around.name;
    brand = around.brand;
    category = product.category;
    fit = product.fit;
    claimed.push(around.span);
  }

  // ---- source & channel (also claimed before the money pass)
  let source = "";
  let sourceSpan: Span | null = null;
  for (const rule of SOURCE_RULES) {
    const hit = [...matches(rule.re, folded)][0];
    if (hit) {
      source = rule.value;
      sourceSpan = { start: hit.index ?? 0, end: (hit.index ?? 0) + hit[0].length };
      break;
    }
  }
  if (!source && buyHits.length) {
    for (const hit of buyHits) {
      const slice = work.slice(hit.start, hit.end + 34);
      const m = slice.match(/\ba\s+([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)/u);
      const candidate = m ? personName(m[1]) : "";
      if (candidate) {
        source = candidate;
        break;
      }
    }
  }
  if (sourceSpan) claimed.push(sourceSpan);
  let channel = "";
  for (const rule of CHANNEL_RULES) {
    const hit = [...matches(rule.re, folded)].find((m) => {
      const span = { start: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
      return !(sourceSpan && overlaps(span, sourceSpan));
    });
    if (hit) {
      channel = rule.value;
      claimed.push({ start: hit.index ?? 0, end: (hit.index ?? 0) + hit[0].length });
      break;
    }
  }
  if ((kind === "stock" || kind === "kept") && buyHits.length && channel && !sellHits.length) {
    // Bought through a marketplace word is the source, not the channel.
    if (!source) source = channel;
    channel = "";
  }

  // ---- money: framed first, then the house takers on what is left
  const masked = mask(work, claimed);
  const costT = takeCost(masked);
  let saleT: ReturnType<typeof takeSale> | null = null;
  if (kind === "sale" || kind === "gift" || kind === "failed-sale" || framed.some((f) => f.role !== "cost")) {
    saleT = takeSale(costT.line);
  }
  const frameCost = framed.find((f) => f.role === "cost") ?? null;
  const frameAsk = framed.find((f) => f.role === "ask") ?? null;
  const frameSale = framed.find((f) => f.role === "sale") ?? null;

  let costCents = 0;
  let costUnsure = false;
  const costSettled = settleAmount(frameCost, qty);
  if (frameCost) {
    costCents = costSettled.perUnit;
    if (costSettled.totalNote) notes.push(costSettled.totalNote);
    if (costSettled.perUnit === 0 && qty > 1) costUnsure = true;
  } else if (costT.cents > 0) {
    // A lone bare amount on a sale-only entry is the price, not the cost.
    if (kind === "sale" && !buyHits.length && saleT && saleT.price == null) {
      saleT = { ...saleT, price: costT.cents };
    } else {
      costCents = costT.cents;
    }
  }
  notes.push(...costT.notes);

  let saleCents: number | null = null;
  let askCents = 0;
  // A second, unframed amount beside a framed cost still needs its role:
  // on a sale it is the price, on stock it is the ask. Dropping it would
  // lose the one number the entry was written for.
  if (frameCost && costT.cents > 0) {
    if (kind === "sale" && !frameSale && saleT && saleT.price == null) saleT = { ...saleT, price: costT.cents };
    else if (kind !== "sale" && !frameAsk) askCents = costT.cents;
  }
  const saleSettled = settleAmount(frameSale, qty);
  if (frameSale) {
    saleCents = saleSettled.perUnit || null;
    if (saleSettled.totalNote) notes.push(saleSettled.totalNote);
    if (saleSettled.perUnit === 0 && qty > 1) costUnsure = true;
  }
  if (saleT) {
    notes.push(...saleT.notes);
    if (saleCents == null && saleT.price != null) saleCents = saleT.price;
    if (saleT.askFromPrice != null) askCents = saleT.askFromPrice;
  }
  if (frameAsk) askCents = frameAsk.cents;
  if (kind !== "sale" && saleCents != null && askCents === 0) {
    // On an unsold piece the charged-looking price is the ask (the house doctrine).
    askCents = saleCents;
    saleCents = null;
  }
  if (kind === "sale" && askCents === 0 && frameAsk) askCents = frameAsk.cents;
  const deliveryCents = deliveryEarly + (saleT?.delivery ?? 0);

  const approx = /\b(?:como|about|around|aprox|approximately|mas o menos|creo que|quizas|maybe|no recuerdo|don't remember|dont remember)\b/.test(folded);
  let costState: DetailedRow["costState"] = "";
  if (approx && costCents > 0) {
    costState = "approx";
    issues.push("true-cost");
  }
  if (costUnsure) issues.push("true-cost");

  // ---- size, read by the house's own size reader on the money-free text
  const sizedText = (saleT?.line ?? costT.line)
    .replace(/\b(?:sold\s+)?for\s+\$\s*[0-9.,\s]+/gi, " ")
    .replace(/\+\s*\$\s*[0-9.,]+\s*delivery/gi, " ")
    .replace(/\bdelivery\s*\$\s*[0-9.,]+/gi, " ")
    .replace(/\$\s*[0-9.,]+\s*off\b/gi, " ")
    .replace(/\bin\s+\$\s*[0-9.,]+/gi, " ")
    .replace(/\(\s*US\s*([0-9.]+)\s*\)/gi, "($1)")
    .replace(/(\d),\s/g, "$1 ");
  const size = takeSize(sizedText);
  notes.push(...size.notes);

  // ---- place, marks, residue
  let place = placeOf(text);
  if (!place && /\ben (?:mi|la|su) casa\b|\bat home\b/.test(folded)) place = "home";
  if (!place && /\ben el (?:carro|coche|auto)\b|\bin the car\b/.test(folded)) place = "car";
  const marks = marksOf(text);
  if (marks) notes.push(`Marks: ${marks}`);
  if (reservedHits.length) notes.push("Apartado");
  if (kind === "gift" && person) notes.push(`For ${person}`);
  if (kind === "failed-sale") notes.push("Failed sale");

  // The takers' leftover string already has every claimed span blanked and
  // every taken span removed: what remains in it is exactly the residue.
  const residue = residueNote(saleT?.line ?? costT.line);
  if (residue) notes.push(residue);

  const hasSubstance = Boolean(product || framed.length || costCents > 0 || saleCents != null || buyHits.length || sellHits.length || returnedHits.length || failedHits.length);
  if (!hasSubstance) return null;

  if (!name) {
    const words = residue.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
    name = words || ctx.section || "Piece";
  }

  const status: DetailedRow["input"]["status"] =
    kind === "sale"
      ? ctx.soldBatch
        ? "archived"
        : "sold"
      : kind === "kept"
        ? "kept"
        : kind === "gift"
          ? "archived"
          : incoming
            ? "incoming"
            : "available";

  const base = emptyInput();
  return {
    input: {
      ...base,
      name,
      category,
      brand,
      status,
      wasSold: kind === "sale",
      qty,
      sizeSystem: size.system || (size.label ? "CN" : "US"),
      sizeLabel: size.label,
      usSize: size.system === "US" ? "" : size.us,
      fit: fit || "unisex",
      costCents,
      askCents: kind === "sale" ? askCents : kind === "stock" || kind === "used" || kind === "failed-sale" ? Math.max(askCents, saleT?.price ?? 0) : 0,
      saleCents: kind === "sale" ? saleCents : null,
      buyRebateCents: reb.rebate,
      deliveryCents,
      source: source || ctx.ctxSource || "",
      channel,
      clientName: kind === "sale" ? person : "",
      receivedOn,
      soldOn: kind === "sale" ? soldOn : null,
      notes: [...new Set(notes.filter(Boolean))].join(" · "),
      problem: costUnsure || !product ? "unsure" : approx && costCents > 0 ? "unsure" : "",
      place,
    },
    raw: text,
    section: ctx.section ?? "",
    kind,
    soldDated: kind === "sale" && !!soldOn,
    issues,
    person,
    personalNote: "",
    marks,
    costState,
    sizeBare: size.bare,
    addedYearWritten: receivedWritten,
    soldYearWritten: soldWritten,
  };
}

// ------------------------------------------------------------------ the whole text

/** Split one utterance at clause breaks where a new product begins; each product opens its own segment. */
function segmentsOf(utterance: string): string[] {
  const folded = fold(utterance);
  const hits = productHits(folded);
  if (hits.length <= 1) return [utterance];
  const segments: string[] = [];
  let cursor = 0;
  for (const hit of hits.slice(1)) {
    const lead = folded.slice(cursor, hit.start);
    const brk = Math.max(lead.lastIndexOf(","), lead.lastIndexOf(" and "), lead.lastIndexOf(" y "), lead.lastIndexOf(" tambien "), lead.lastIndexOf(" also "));
    const at = brk > 0 ? cursor + brk : hit.start;
    const piece = utterance.slice(cursor, at).trim();
    if (piece) segments.push(piece);
    cursor = at;
  }
  const tail = utterance.slice(cursor).replace(/^\s*(?:,|and\b|y\b|also\b|tambien\b)\s*/i, "").trim();
  if (tail) segments.push(tail);
  return segments.filter(Boolean);
}

function hasSignal(folded: string): boolean {
  return (
    productHits(folded).length > 0 ||
    /\$/.test(folded) ||
    verbHits(BUY_RE, folded).length > 0 ||
    verbHits(SELL_RE, folded).length > 0 ||
    verbHits(RETURNED_RE, folded).length > 0 ||
    verbHits(FAILED_RE, folded).length > 0 ||
    verbHits(KEPT_RE, folded).length > 0 ||
    verbHits(GIFT_RE, folded).length > 0 ||
    findAnchors(folded, new Date(), false).length > 0
  );
}

/**
 * Read a loose text — a message, a note, an ad — into tray rows.
 * Same return shape as parseDetailedNotes; the ledger reader keeps its own.
 */
export function parseLooseText(
  text: string,
  today = new Date(),
  ctx: { lang?: "en" | "es"; soldBatch?: boolean } = {},
): { rows: DetailedRow[]; loose: LooseLine[] } {
  const rows: DetailedRow[] = [];
  const loose: LooseLine[] = [];
  let section = "";
  let ctxSource = "";
  let ctxReceivedOn: string | null = null;
  let open: string[] = [];

  const flush = () => {
    if (!open.length) return;
    const joined = open.join(" ").replace(/\s+/g, " ").trim();
    open = [];
    if (!joined) return;
    const row = readEntry(joined, today, { lang: ctx.lang, soldBatch: ctx.soldBatch, section, ctxSource, ctxReceivedOn });
    if (row) rows.push(row);
    else loose.push({ raw: joined, section, kind: "loose", text: joined });
  };

  for (const utterance of utterances((text || "").normalize("NFC").replace(/\r\n?/g, "\n"))) {
    for (const segment of segmentsOf(utterance)) {
      const folded = fold(segment);
      const products = productHits(folded);
      const signal = hasSignal(folded);
      // A short line ending in a colon heads what follows ("Pedido de Temu:"),
      // even when a word in it ("pedido") also reads as a verb.
      if (!products.length && !/\$/.test(segment) && /:\s*$/.test(segment) && segment.split(/\s+/).length <= 6) {
        flush();
        section = segment.replace(/[:\s]+$/g, "").trim();
        const srcHit = SOURCE_RULES.map((r) => ({ value: r.value, hit: [...matches(r.re, folded)][0] })).find((x) => x.hit);
        if (srcHit) ctxSource = srcHit.value;
        const anchor = findAnchors(folded, today, ctx.lang === "es" || looksSpanish(folded)).find((a) => a.date && !a.future);
        if (anchor) ctxReceivedOn = anchor.date;
        continue;
      }
      if (!products.length && !signal) {
        // A short line with nothing to read is batch context (a heading) or chatter.
        const words = segment.split(/\s+/).filter(Boolean);
        if (words.length <= 8 && !/[.!?]$/.test(segment)) {
          flush();
          section = segment.replace(/[:\s]+$/g, "").trim();
          const srcHit = SOURCE_RULES.map((r) => ({ value: r.value, hit: [...matches(r.re, folded)][0] })).find((x) => x.hit);
          if (srcHit) ctxSource = srcHit.value;
          const anchor = findAnchors(folded, today, ctx.lang === "es" || looksSpanish(folded)).find((a) => a.date && !a.future);
          if (anchor) ctxReceivedOn = anchor.date;
        } else {
          loose.push({ raw: segment, section, kind: "loose", text: segment });
        }
        continue;
      }
      if (products.length) {
        const openFolded = open.length ? fold(open.join(" ")) : "";
        const openProducts = open.length ? productHits(openFolded) : [];
        const sameKind = openProducts.length > 0 && openProducts[0].category === products[0].category;
        const continuation = /^\s*(?:tambien|also|además|ademas|y tambien)\b/i.test(segment);
        const ownDeal = /\$/.test(folded) || verbHits(BUY_RE, folded).length > 0 || verbHits(SELL_RE, folded).length > 0;
        // A bare announcement ("the watches arrived yesterday") is a thin
        // entry: the sentence that carries its price and count is the same
        // purchase still being told, so it joins instead of splitting.
        const openThin = open.length > 0 && !/\$/.test(openFolded) && quantityOf(openFolded, openProducts[0] ?? null).qty <= 1;
        if (open.length && (continuation || (sameKind && !ownDeal) || (sameKind && openThin))) {
          open.push(segment);
        } else {
          flush();
          open = [segment];
        }
        continue;
      }
      // No product of its own: it belongs to the open entry, or opens an unnamed one.
      open.push(segment);
    }
  }
  flush();
  return { rows, loose };
}

/**
 * Whether a pasted text reads as prose (a message, a note, an ad) rather
 * than ledger lines. The tray pre-selects the reader with this and lets
 * Oscar flip it — the ledger stays the default when the shapes are tied.
 */
export function looksLoose(text: string): boolean {
  const lines = (text || "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  let ledger = 0;
  let prose = 0;
  for (const line of lines) {
    if (/\(\s*\$/.test(line) || /^\s*[+#._]/.test(line) || /\d{2}\s*=/.test(line) || /^\s*\d{1,2}[.)]\s/.test(line) || /[-–—]\s*sold/i.test(line)) ledger += 1;
    if (/[.!?]\s+\S/.test(line) || line.length > 85) prose += 1;
    else if (/[.!?]$/.test(line) && line.split(/\s+/).length >= 4) prose += 1;
    else if (/,/.test(line) && /\b(?:the|and|for|with|los|las|para|con|por|que|una|uno)\b/i.test(line) && line.length > 45) prose += 1;
  }
  return prose > ledger;
}
