import { dollarsToCents, emptyInput, type PieceInput } from "./model";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Agu(?:st)?|Sep(?:t(?:ember)?)?|Set|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const DATE_RE = new RegExp(
  `(?:(Added|Sold|Solg|Buy\\s*Day)\\s*[:\\-]?\\s*)?(${MONTH})\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*[/,-]\\s*(\\d{2,4}))?`,
  "gi",
);

const NOT_A_PERSON = new Set([
  "home", "here", "sold", "added", "watch", "watches", "boot", "boots", "hat", "hats", "real", "used", "mine", "gift",
  "full", "temu", "ebay", "the", "for", "with", "this", "they", "under", "back", "good", "one", "true", "black",
  "brown", "yellow", "gray", "grey", "silver", "beige", "orange", "dark", "light", "classic", "classical", "vintage",
  "cowboy", "nike", "box", "ramon", "ramón",
]);

function stripMarks(value: string) {
  return value.replace(/\p{Extended_Pictographic}/gu, "").replace(/[\uFE0F\u200D]/g, "").replace(/\s+/g, " ").trim();
}

function tidyUs(raw: string) {
  const spaced = raw.trim().replace(/\s+/g, "");
  if (/^box\b/i.test(spaced)) return spaced.replace(/^box/i, "BOX");
  // Shoes come in whole and half sizes: a converted "7.57" lands on 7.5.
  if (/^\d+\.\d+$/.test(spaced) && !Number.isInteger(Number(spaced) * 8)) {
    const n = Math.round(Number(spaced) * 2) / 2;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  return spaced;
}

function monthIndex(name: string) {
  const lower = name.toLowerCase();
  if (lower.startsWith("sept") || lower === "set") return 9;
  if (lower.startsWith("agu")) return 8;
  return MONTHS[lower.slice(0, 3)] ?? 0;
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fullYear(raw: string) {
  const n = Number(raw);
  if (n > 1900) return n;
  if (n >= 0 && n < 100) return 2000 + n;
  return null;
}

/** "Aug28" / "Sept13th" → month and day. */
export function parseAddedDate(token: string, today = new Date()) {
  const match = token.trim().match(new RegExp(`^(${MONTH})\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*[/,-]\\s*(\\d{2,4}))?$`, "i"));
  if (!match) return null;
  const month = monthIndex(match[1]);
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  const written = match[3] ? fullYear(match[3]) : null;
  let year = written ?? today.getFullYear();
  if (!written && new Date(year, month - 1, day).getTime() > today.getTime() + 45 * 86_400_000) year -= 1;
  return iso(year, month, day);
}

function placeOf(line: string): "" | "home" | "car" {
  if (/🏡|🏠|🛖|🪹|\b(?:home|here)\b/i.test(line)) return "home";
  // 1.0.16: vehicles are MARKS, not a place — in Oscar's notes they ride on the same line as
  // "*Home*" dozens of times, so they cannot be where the piece is. Only the written word counts.
  if (/\bcar\b/i.test(line)) return "car";
  return "";
}

const PLACE_MARKS = new Set(["🏡", "🏠", "🛖", "🪹"]);

/**
 * The marks on a line, kept verbatim (🥬💚, 🚚✨, 🛻🛻…), minus the ones that already mean
 * something structural: the home emojis (place) and 💙 (the Coming signal). Never interpreted.
 */
function marksOf(line: string) {
  const found: string[] = [];
  let cluster = "";
  const flush = () => {
    if (!cluster) return;
    const base = cluster.replace(/[\uFE0F\u200D]/g, "");
    if (!PLACE_MARKS.has(base) && base !== "💙" && !found.includes(cluster)) found.push(cluster);
    cluster = "";
  };
  for (const ch of line) {
    if (/\p{Extended_Pictographic}/u.test(ch) || ch === "\uFE0F" || ch === "\u200D") cluster += ch;
    else flush();
  }
  flush();
  return found.join(" ");
}

/** A death in the family, written into the notebook. It dates the batch; it is never piece data. */
const PERSONAL_RE = /(mi\s+t[ií]a\s+ha\s+muerto|my\s+aunt\s+(?:has\s+)?died|ha\s+muerto|passed\s+away)/i;

const FAILED_SALE_RE = /\bno los quiso\b|\bno quiso\b|\bdid ?n[o']?t want\b|\brejected\b/i;
const KEPT_RE = /\badded this to my wallet\b|\bto my wallet\b|\bfor myself\b|\bi'?m keeping\b|\bkeeping (?:it|this|them) for me\b|\bme lo quedo\b/i;

function stripIndex(line: string) {
  let next = line.replace(/^[+#.\s]+/, "").replace(/^\d+(?:st|nd|rd|th)\.?\s+/i, "");
  for (;;) {
    const mark = next.match(/^(\d+)\s*([.)])\s*/);
    if (!mark) break;
    const rest = next.slice(mark[0].length);
    const fraction = rest.match(/^(\d+)/);
    const decimal = mark[2] === "." && !!fraction && fraction[1].length === 1 && Number(fraction[1]) <= 5 && Number(mark[1]) < 16;
    if (decimal || (mark[2] === "." && !fraction)) break;
    next = rest;
  }
  return next.replace(/^[_\s]+/, "").trim();
}

function headingName(line: string) {
  return stripMarks(line)
    .replace(/^[#^_*.\s\-–—:]+/, "")
    .replace(/[*_]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function kindOf(name: string): { category: string; fit: string } | null {
  const n = name.toLowerCase();
  if (/\bwatches?\b/.test(n)) return { category: "Watch", fit: "unisex" };
  if (/\bpiano\b/.test(n)) return { category: "Piano", fit: "unisex" };
  if (/\bhats?\b/.test(n)) return { category: "Hat", fit: "unisex" };
  if (/\bloafers?\b/.test(n)) return { category: "Loafer", fit: "men" };
  if (/\bboots?\b|\bbotas\b/.test(n)) return { category: "Boot", fit: "men" };
  return null;
}

function sourceOf(name: string) {
  const found = name.match(/\b(temu|aliexpress|shein|amazon)\b/i);
  if (!found) return "";
  const word = found[1].toLowerCase();
  if (word === "aliexpress") return "AliExpress";
  if (word === "temu") return "Temu";
  return word[0].toUpperCase() + word.slice(1);
}

function isWeakHeading(name: string) {
  return /^(better ones|here|home)\b/i.test(name);
}

function isSummary(line: string) {
  return /\bpairs\b/i.test(line);
}

function prettyBrand(word: string) {
  if (word.length > 1 && word === word.toUpperCase()) return word[0] + word.slice(1).toLowerCase();
  return word;
}

function lineProduct(body: string): { name: string; category: string; fit: string; brand: string } | null {
  const piano = body.match(/\b([A-Za-z0-9]+)\s+piano\b/i);
  if (piano && !/^my$/i.test(piano[1])) {
    const brand = prettyBrand(piano[1]);
    return { name: `${brand} piano`, category: "Piano", fit: "unisex", brand };
  }
  const watch = body.match(/^([A-Za-z][\p{L}'’.-]*(?:\s+[A-Za-z][\p{L}'’.-]*){0,3})\s+(watche?s?)\b/iu);
  if (watch && !/^watche?s?$/i.test(watch[1])) {
    const brand = /^[A-Z0-9]{2,}$/.test(watch[1]) ? watch[1] : "";
    return { name: `${watch[1]} ${watch[2]}`, category: "Watch", fit: "unisex", brand };
  }
  const loafer = body.match(/^([A-Za-z][\p{L}'’.-]*(?:\s+[A-Za-z][\p{L}'’.-]*){0,4})\s+loafers?\b/iu);
  if (loafer) return { name: `${loafer[1]} Loafers`, category: "Loafer", fit: "men", brand: "" };
  return null;
}

function isRow(body: string) {
  if (!body || isSummary(body)) return false;
  if (lineProduct(body)) return true;
  if (/^used\b/i.test(body)) return true;
  if (/^[0-9]{1,2}(?:\s*\.\s*[0-9]+)?\+?$/.test(body)) return true;
  return /\d/.test(body) && (/\$/.test(body) || /\bsold\b/i.test(body) || /=/.test(body) || /\breal\b/i.test(body) || /\bwith\b/i.test(body) || /\bfor\b/i.test(body) || /\bused\b/i.test(body) || /equivalent/i.test(body) || /"|“|”/.test(body));
}

export type RowIssue =
  | "bad-arithmetic"
  | "uncertain-rebate"
  | "rebate-no-amount"
  | "true-cost"
  | "coming-sold"
  | "personal-note";

const MINUS = "[\\-−–]";
const AMT = "\\$\\s*([0-9]+(?:\\s*\\.\\s*[0-9]{1,2})?)";
const AMT_LOOSE = "\\$?\\s*([0-9]+(?:\\s*\\.\\s*[0-9]{1,2})?)";
const centsOf = (raw: string) => dollarsToCents(raw.replace(/\s+/g, ""));

/**
 * The PURCHASE rebate, read before the cost so its arithmetic can never leak into the size
 * (the old parser turned "($11.48 − 3.91 = 7.57)" into a US size of 7.57). Five-plus written
 * forms are recognised; anything doubtful is recorded AND flagged, never silently decided:
 * an "off" bigger than the cost, arithmetic that does not square, a credit with no amount.
 * Returns the line with every rebate span removed.
 */
function takeRebate(line: string) {
  const issues: RowIssue[] = [];
  const notes: string[] = [];
  let next = line;
  let rebate = 0;
  let grossOverride: number | null = null;
  let netBasisRebate = 0;
  let pendingPercent: number | null = null;

  const netFormula = (a: number, b: number, c: number) => {
    grossOverride = a;
    rebate += Math.max(0, a - c);
    if (Math.abs(a - b - c) > 1) issues.push("bad-arithmetic");
  };

  // 1) "($A − B = C)" — the whole cost story inside one parenthesis. (The result often has no $.)
  let match = next.match(new RegExp(`\\(\\s*${AMT}\\s*${MINUS}\\s*${AMT_LOOSE}\\s*=\\s*${AMT_LOOSE}\\s*\\)`, "i"));
  if (match) {
    netFormula(centsOf(match[1]), centsOf(match[2]), centsOf(match[3]));
    next = next.replace(match[0], " ");
  }
  // 1b) "($A) = $C" — paid A, after an unnamed credit it stands at C.
  if (grossOverride == null) {
    match = next.match(new RegExp(`\\(\\s*${AMT}\\s*\\)\\s*=\\s*${AMT_LOOSE}`, "i"));
    if (match) {
      grossOverride = centsOf(match[1]);
      rebate += Math.max(0, centsOf(match[1]) - centsOf(match[2]));
      next = next.replace(match[0], " ");
    }
  }
  // 2) "$A − B off = $C" — the same formula written bare.
  if (grossOverride == null) {
    match = next.match(new RegExp(`${AMT}\\s*${MINUS}\\s*${AMT_LOOSE}\\s*off\\s*=\\s*${AMT_LOOSE}`, "i"));
    if (match) {
      netFormula(centsOf(match[1]), centsOf(match[2]), centsOf(match[3]));
      next = next.replace(match[0], " ");
    }
  }
  // 3) "($A − $B credit)" — the parenthesis explains a NET cost written elsewhere on the line:
  //    the rebate is real, but the cost figure is already after it, so the gross is rebuilt.
  match = next.match(new RegExp(`\\(\\s*${AMT}\\s*${MINUS}\\s*${AMT}\\s*credit[^)]*\\)`, "i"));
  if (match) {
    netBasisRebate += centsOf(match[2]);
    rebate += centsOf(match[2]);
    next = next.replace(match[0], " ");
  }
  // 4) "$N off in credit to claim…" — a supplier credit, still to claim.
  match = next.match(new RegExp(`${AMT}\\s*off\\s+in\\s+credit[^,.]*`, "i"));
  if (match) {
    rebate += centsOf(match[1]);
    notes.push("Credit to claim");
    next = next.replace(match[0], " ");
  }
  // 5) "P% off", with or without the amount written next to it.
  match = next.match(new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*%\\s*off(?:\\s*\\(\\s*${MINUS}\\s*${AMT}\\s*\\+?\\s*\\))?`, "i"));
  if (match) {
    notes.push(`${match[1]}% off`);
    if (match[2]) rebate += centsOf(match[2]);
    else pendingPercent = Number(match[1]);
    next = next.replace(match[0], " ");
  }
  // 6) "($N credit)" — an amount, but nothing says whether the cost beside it is gross or net.
  match = next.match(new RegExp(`\\(\\s*${AMT}\\s*credit[^)]*\\)`, "i"));
  if (match) {
    rebate += centsOf(match[1]);
    issues.push("uncertain-rebate");
    next = next.replace(match[0], " ");
  }
  // 7) "(−$N)" stuck to the cost, unexplained.
  match = next.match(new RegExp(`\\(\\s*${MINUS}\\s*${AMT}\\s*\\)`, "i"));
  if (match) {
    rebate += centsOf(match[1]);
    issues.push("uncertain-rebate");
    next = next.replace(match[0], " ");
  }
  // 8) "− $N in discount" — the word is "discount", not "off".
  match = next.match(new RegExp(`${MINUS}\\s*${AMT}\\s*in\\s+discount`, "i"));
  if (match) {
    rebate += centsOf(match[1]);
    issues.push("uncertain-rebate");
    next = next.replace(match[0], " ");
  }
  // 9) Plain "N off" — the canonical form.
  match = next.match(new RegExp(`${AMT_LOOSE}\\s*off\\b`, "i"));
  if (match) {
    rebate += centsOf(match[1]);
    next = next.replace(match[0], " ");
  }
  // 10) A credit named with NO amount (RewardsBack, Credit Reward): flagged, never invented.
  if (/\bcredit\s*reward\b|\brewards?\s*back\b/i.test(next)) {
    issues.push("rebate-no-amount");
    notes.push("Credit reward (no amount)");
    next = next.replace(/\bcredit\s*reward\b|\brewards?\s*back\b/gi, " ");
  }
  return { line: next, rebate, grossOverride, netBasisRebate, pendingPercent, issues, notes };
}

function takeCost(line: string) {
  const notes: string[] = [];
  let next = line.replace(/\(\s*\$\s*[0-9.]+\s*-\s*\$\s*[0-9.]+[^)]*\)/gi, " ");
  const broken = next.match(/\(\s*\$+\s*([0-9]+)\s*\)\s*\.\s*([0-9]+)\s*\)?/);
  if (broken) return { cents: dollarsToCents(`${broken[1]}.${broken[2]}`), line: next.replace(broken[0], " "), notes };
  const normal = next.match(/\(\s*\$+\s*([0-9]+(?:\s*\.\s*[0-9]+)?)\s*\)/);
  if (normal) return { cents: dollarsToCents(normal[1].replace(/\s+/g, "")), line: next.replace(normal[0], " "), notes };
  const got = next.match(/\bgot(?:\s+it)?\s+for\s+\$\s*([0-9]+(?:\s*\.\s*[0-9]+)?)/i);
  if (got) return { cents: dollarsToCents(got[1].replace(/\s+/g, "")), line: next.replace(got[0], " "), notes };
  const bare = /(?<![\w])\$\s*([0-9]+(?:\s*\.\s*[0-9]+)?)(?!\s*off\b)/gi;
  for (const match of next.matchAll(bare)) {
    const start = match.index ?? 0;
    const before = next.slice(Math.max(0, start - 14), start);
    if (/\bfor\s*$/i.test(before) || /\bin\s*$/i.test(before) || /\bdelivery\s*$/i.test(before) || /=\s*$/.test(before) || /\+\s*$/.test(before)) continue;
    if (Number(match[1].replace(/\s+/g, "")) === 0) {
      notes.push("Full refund");
      return { cents: 0, line: next.replace(match[0], " "), notes };
    }
    return { cents: dollarsToCents(match[1].replace(/\s+/g, "")), line: next.slice(0, start) + " " + next.slice(start + match[0].length), notes };
  }
  const plain = next.match(/(?<![\d.])([0-9]+\.[0-9]{2})(?!\s*off\b)/);
  if (plain) return { cents: dollarsToCents(plain[1]), line: next.replace(plain[0], " "), notes };
  return { cents: 0, line: next, notes };
}

/**
 * The selling money, 1.0.16. One "for $X" is read by CONTEXT (the caller decides): on a sold line
 * it is what was charged, on an unsold line it is the ask — and the charged amount is never copied
 * into the ask, or the derived price cut would be born at zero. Delivery is its own money: it is
 * taken OUT of the line into `delivery`, never added into the price, and the original ask survives
 * a "for $40 for $50 (delivery $10)" line because 50 − 40 is exactly the delivery.
 */
function takeSale(line: string) {
  const notes: string[] = [];
  let next = line;
  let delivery = 0;
  let askFromPrice: number | null = null;
  let price: number | null = null;
  let arrowSold = false;

  const parenDelivery = next.match(/\(\s*delivery\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*\)/i);
  if (parenDelivery) {
    delivery += dollarsToCents(parenDelivery[1]);
    next = next.replace(parenDelivery[0], " ");
  }
  const plusDelivery = next.match(/\+\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*delivery/i);
  if (plusDelivery) {
    delivery += dollarsToCents(plusDelivery[1]);
    next = next.replace(plusDelivery[0], " ");
  }
  const barePlus = next.match(/\+\s*([0-9]+\.[0-9]{2})\s+to\b/i);
  if (barePlus) {
    delivery += dollarsToCents(barePlus[1]);
    next = next.replace(barePlus[0], " ");
  }

  const arrow = next.match(/\bfor\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:→|->|➜|⟶)\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (arrow) {
    askFromPrice = dollarsToCents(arrow[1]);
    price = dollarsToCents(arrow[2]);
    arrowSold = true;
    next = next.replace(arrow[0], " ");
  }
  if (price == null) {
    const net = next.match(/\bfor\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*[-\u2212–]\s*[0-9.]+\s*=\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
    if (net) {
      askFromPrice = dollarsToCents(net[1]);
      price = dollarsToCents(net[2]);
      next = next.replace(net[0], " ");
    }
  }
  if (price == null) {
    const amounts = [...next.matchAll(/\b(?:sold\s+)?for\s+\$\s*([0-9]+(?:\s*\.\s*[0-9]{1,2})?)/gi)].map((m) => dollarsToCents(m[1].replace(/\s+/g, "")));
    if (amounts.length >= 2 && delivery > 0 && amounts[amounts.length - 1] - amounts[0] === delivery) {
      price = amounts[0];
    } else if (amounts.length) {
      price = amounts[amounts.length - 1];
    }
  }
  if (price == null && /\bsold\b/i.test(next)) {
    const inn = next.match(/\bin\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
    if (inn) price = dollarsToCents(inn[1]);
  }
  // What the client actually handed over, when it is more than the price: the extra is collected
  // money, so it rides with the delivery bucket — visible, and out of the piece's profit.
  const handed = line.match(/(?:gave|paid)\s+me\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i) || line.match(/me\s+di[oó]\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  if (handed && price != null) {
    const total = dollarsToCents(handed[1]);
    if (total > price) {
      delivery += total - price;
      notes.push(`Paid extra $${((total - price) / 100).toFixed(2).replace(/\.00$/, "")}`);
    }
  }
  return { price, askFromPrice, delivery, arrowSold, notes, line: next };
}

function takeSize(line: string) {
  const notes: string[] = [];
  let clean = line.replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim();
  let bare = false;
  // "BOX 9" is a size in its own right: capture it whole before the number hunt loses both halves.
  let boxUs = "";
  const boxMatch = clean.match(/\bBOX\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (boxMatch) {
    boxUs = `BOX ${boxMatch[1]}`;
    clean = clean.replace(boxMatch[0], " ").replace(/\s+/g, " ").trim();
  }
  // A written range ("8 a 8.5", "9.5 o 10", "9.5 0 10" — his 0 is the letter o): the first end is
  // the size, the second is kept as an "or" note instead of being dropped.
  let rangeAlt = "";
  const sizeish = (v: number) => (v >= 4 && v <= 20) || (v >= 30 && v <= 60);
  const range = clean.match(/(?<![\d$.])([0-9]+(?:\.[0-9]+)?)\s+(?:a|0|o|or)\s+([0-9]+(?:\.[0-9]+)?)(?![\d])/);
  if (range && sizeish(Number(range[1])) && sizeish(Number(range[2]))) {
    rangeAlt = range[2];
    clean = clean.replace(range[0], ` ${range[1]} `).replace(/\s+/g, " ").trim();
  }
  const real = clean.match(/\breal\s*([0-9]+\s*(?:\.\s*[0-9]+)?)/i);
  const like = clean.match(/\/\s*like\s*([0-9]+(?:\s*\.\s*[0-9]+)?)\s*\//i);
  const also = clean.match(/\bwith\s*([0-9]+\s*(?:\.\s*[0-9]+)?)/i);
  const alt = clean.match(/\b(?:or|o)\s+([0-9]+\s*(?:\.\s*[0-9]+)?)/i);
  const offered = clean.match(/\b(?:sold|offered)(?:\s+\w+){0,2}\s+as\s+([0-9]+\s*(?:\.\s*[0-9]+)?)/i);
  let system: "CN" | "EU" | "US" | "" = "";
  let label = "";
  let us = "";
  const usBit = "([0-9]+\\s*(?:\\.\\s*[0-9]+)?\\+?)";
  const eu = clean.match(new RegExp(`\\bEU\\s*(\\d{2})\\s*(?:=\\s*${usBit})?`, "i")) || clean.match(new RegExp(`(?:^|\\s)(\\d{2})\\s*EU\\s*(?:=\\s*${usBit})?`, "i"));
  const cnWord = clean.match(new RegExp(`\\bCN\\s*(\\d{2})\\s*(?:=\\s*${usBit})?`, "i")) || clean.match(new RegExp(`(?:^|\\s)(\\d{2})\\s*CN\\s*(?:=\\s*${usBit})?`, "i"));
  if (eu && Number(eu[1]) >= 30) {
    system = "EU";
    label = eu[1];
    if (eu[2]) us = tidyUs(eu[2]);
  } else if (cnWord && Number(cnWord[1]) >= 30) {
    system = "CN";
    label = cnWord[1];
    if (cnWord[2]) us = tidyUs(cnWord[2]);
  } else {
    const cnEq = clean.match(new RegExp(`(?:^|[^\\d])(\\d{2})\\s*=\\s*(?:BOX\\s*[0-9.]+|${usBit})?`, "i"));
    if (cnEq && Number(cnEq[1]) >= 30) {
      system = "CN";
      bare = true;
      label = cnEq[1];
      if (cnEq[2] && (/^box/i.test(cnEq[2]) || Number(cnEq[2].replace(/\s+/g, "").replace("+", "")) < 20)) us = tidyUs(cnEq[2]);
    } else {
      const equivalent = clean.match(new RegExp(`equivalent\\s+to\\s*${usBit}`, "i"));
      const fraction = clean.match(/\b([0-9])\s+([0-9])\s*\/\s*([0-9])\b/);
      const used = clean.match(new RegExp(`\\bused\\s+in\\s*${usBit}`, "i"));
      const cnLoose = clean.match(/(?:^|\s)(\d{2})(?=\s|$|\()/);
      const lead = clean.match(new RegExp(`(?:^|\\s)${usBit}(?=\\s|$|\\()`, "i"));
      if (fraction) {
        system = "US";
        label = `${fraction[1]} ${fraction[2]}/${fraction[3]}`;
      } else if (cnLoose && Number(cnLoose[1]) >= 30 && (equivalent || clean.match(new RegExp(`\\(\\s*${usBit}\\s*\\)`)))) {
        system = "CN";
        bare = true;
        label = cnLoose[1];
        const paren = clean.match(new RegExp(`\\(\\s*${usBit}\\s*\\)`));
        const picked = equivalent?.[1] || paren?.[1] || "";
        if (picked && Number(picked.replace(/\s+/g, "").replace("+", "")) < 20) us = tidyUs(picked);
      } else {
        const raw = equivalent?.[1] || used?.[1] || lead?.[1] || "";
        if (raw) {
          const n = Number(raw.replace(/\s+/g, "").replace("+", ""));
          if (n > 0 && n < 20) {
            system = "US";
            label = tidyUs(raw);
          } else if (n >= 30 && n < 60) {
            system = "CN";
            bare = true;
            label = String(Math.round(n));
          }
        }
      }
    }
  }
  if (system !== "US" && !us) {
    const paren = clean.match(new RegExp(`\\(\\s*${usBit}\\s*\\)`));
    if (paren && Number(paren[1].replace(/\s+/g, "").replace("+", "")) < 20) us = tidyUs(paren[1]);
  }
  const truth = real?.[1] || like?.[1] || "";
  if (truth) {
    if (us || (system === "US" && label)) notes.push(`Marked ${us || label}`);
    us = tidyUs(truth);
    if (system === "US") label = us;
  }
  if (also) notes.push(`With ${tidyUs(also[1])}`);
  if (alt) notes.push(`or ${tidyUs(alt[1])}`);
  if (!alt && rangeAlt) notes.push(`or ${tidyUs(rangeAlt)}`);
  if (offered) notes.push(`Offered as ${tidyUs(offered[1])}`);
  if (/\bused\b/i.test(clean)) notes.push("Used");
  if (/\bmine\b/i.test(clean)) notes.push("Mine");
  if (boxUs && !us) us = boxUs;
  return { system, label, us, notes, bare };
}

function dateKind(prefix: string | undefined): "" | "added" | "sold" {
  const word = prefix?.toLowerCase().replace(/\s+/g, "") ?? "";
  if (word.startsWith("sold") || word.startsWith("solg")) return "sold";
  if (word.startsWith("added") || word.startsWith("buy")) return "added";
  return "";
}

function datesOf(line: string, today: Date, soldBatch: boolean) {
  DATE_RE.lastIndex = 0;
  const found: { kind: "" | "added" | "sold"; month: number; day: number; year: number | null }[] = [];
  for (const match of line.matchAll(DATE_RE)) {
    const month = monthIndex(match[2]);
    const day = Number(match[3]);
    if (!month || day < 1 || day > 31) continue;
    found.push({ kind: dateKind(match[1]), month, day, year: match[4] ? fullYear(match[4]) : null });
  }
  const saidSold = found.some((item) => item.kind === "sold") || /\bsold\b/i.test(line);
  const saidAdded = /\badded\b|\bbuy\s*day\b/i.test(line);
  let added = found.find((item) => item.kind === "added") ?? null;
  let sold = found.find((item) => item.kind === "sold") ?? null;
  const bare = found.filter((item) => !item.kind);
  if (!added && saidAdded) added = bare.shift() ?? null;
  if (!sold && (saidSold || soldBatch)) sold = bare.shift() ?? null;
  if (!added) added = bare.shift() ?? null;

  const afterToday = (year: number, month: number, day: number) => new Date(year, month - 1, day).getTime() > today.getTime();
  let addedYear = added ? (added.year ?? today.getFullYear()) : null;
  if (added && addedYear != null && !added.year && !sold) {
    const when = new Date(addedYear, added.month - 1, added.day).getTime();
    if (when > today.getTime() + 45 * 86_400_000) addedYear -= 1;
  }
  let soldYear = sold ? (sold.year ?? addedYear ?? today.getFullYear()) : null;
  if (sold && soldYear != null && added && addedYear != null && !sold.year) {
    const crosses = sold.month < added.month || (sold.month === added.month && sold.day < added.day);
    soldYear = crosses ? addedYear + 1 : addedYear;
  }
  if (sold && soldYear != null && !sold.year && afterToday(soldYear, sold.month, sold.day)) {
    soldYear -= 1;
    if (added && addedYear != null && !added.year) addedYear -= 1;
  }
  const receivedOn = added && addedYear != null ? iso(addedYear, added.month, added.day) : null;
  const soldOn = sold && soldYear != null ? iso(soldYear, sold.month, sold.day) : null;
  return { receivedOn, soldOn, saidSold, addedYearWritten: !!added?.year, soldYearWritten: !!sold?.year };
}

function personName(raw: string) {
  const parts = raw.trim().split(/\s+/).slice(0, 2).filter(Boolean);
  if (!parts.length || !/^[\p{Lu}]/u.test(parts[0])) return "";
  if (NOT_A_PERSON.has(parts[0].toLowerCase())) return "";
  if (parts[1] && (!/^[\p{Lu}]/u.test(parts[1]) || NOT_A_PERSON.has(parts[1].toLowerCase()))) parts.pop();
  return parts.join(" ");
}

function clientOf(line: string) {
  const text = stripMarks(line);
  const lead = text.match(/\b(?:sold\s+to|shipping\s+to|shipped\s+to|to)\s+([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)/u)
    || text.match(/\bfor\s+([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)/u);
  const fromLead = lead ? personName(lead[1]) : "";
  if (fromLead) return fromLead;
  const present = text.match(/\b([\p{Lu}][\p{L}'’.-]+(?:\s+[\p{Lu}][\p{L}'’.-]+)?)'s\s+(?:birthday\s+)?present\b/u);
  if (present) return personName(present[1]);
  const dashed = text.match(/[-–—]\s*([\p{Lu}][\p{L}'’.-]+\s+[\p{Lu}][\p{L}'’.-]+)\s*[-–—]/u);
  if (dashed) return personName(dashed[1]);
  const tail = text.match(/\b([\p{Lu}][\p{L}'’.-]+\s+[\p{Lu}][\p{L}'’.-]+)\s*$/u);
  return tail ? personName(tail[1]) : "";
}

function noteBits(line: string) {
  const bits: string[] = [];
  const plain = stripMarks(line);
  if (/\bgifts?\b|\bregalos?\b|\bpresent\b|\bbirthday\b|\bgave it to me\b/i.test(plain)) bits.push("Gift");
  if (/\breturned\b/i.test(plain)) bits.push("Returned");
  if (/likely to return/i.test(plain)) bits.push("Likely return");
  if (/full refund/i.test(plain)) bits.push("Full refund");
  const comment = line.match(/\/\*\s*(.+?)\s*\*\//);
  if (comment) {
    const long = comment[1].match(/long to be\s*([0-9.]+)/i);
    bits.push(long ? `Runs long, should be ${long[1]}` : stripMarks(comment[1]));
  }
  // The "N off" money itself is NOT a note any more: since 1.0.16 it lives in buyRebateCents
  // (takeRebate). The old parser wrote it twice — a "Credit $N" note and the field — which is
  // how a rebate could be counted twice.
  return { bits };
}

export type RowKind = "sale" | "stock" | "gift" | "returned" | "used" | "kept" | "failed-sale";
export type CostState = "" | "gift" | "refunded" | "approx";

export type DetailedRow = {
  input: PieceInput;
  raw: string;
  section: string;
  kind: RowKind;
  soldDated: boolean;
  issues: RowIssue[];
  /** The person named on the line, whatever the line is. Only a sale stores it as the client. */
  person: string;
  personalNote: string;
  marks: string;
  costState: CostState;
  /** The size system was read from a bare number with no EU/CN written — a batch rule may relabel it. */
  sizeBare: boolean;
  addedYearWritten: boolean;
  soldYearWritten: boolean;
};

export type LooseLine = { raw: string; section: string; kind: "loose" | "personal"; text: string };

/**
 * The detailed parse behind the tray (1.0.16): every line is classified on its own evidence —
 * the document is never trusted as a whole. `parseFloorNotes` below stays as the plain wrapper.
 */
export function parseDetailedNotes(text: string, today = new Date(), soldBatch = false): { rows: DetailedRow[]; loose: LooseLine[] } {
  let title = "";
  let category = "Boot";
  let fit = "men";
  let source = "";
  let nextUnsure = false;
  const rows: DetailedRow[] = [];
  const loose: LooseLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[.\s…]+$/.test(line)) continue;
    if (/^[?.!\s]+$/.test(line)) {
      nextUnsure = true;
      continue;
    }
    const section = /^[#^]/.test(line) || isSummary(line);
    const body = stripIndex(line);
    if (section || !isRow(body)) {
      if (!section && PERSONAL_RE.test(body)) {
        loose.push({ raw: line, section: title, kind: "personal", text: body });
        continue;
      }
      const name = headingName(section ? line : body);
      if (!name || /^[?.]+$/.test(name)) continue;
      if (isSummary(name)) {
        const kind = kindOf(name);
        if (kind) {
          category = kind.category;
          fit = kind.fit;
        }
        continue;
      }
      if (isWeakHeading(name)) continue;
      title = name;
      const kind = kindOf(name);
      if (kind) {
        category = kind.category;
        fit = kind.fit;
      }
      source = sourceOf(name);
      continue;
    }
    const named = lineProduct(body);
    // A personal note riding on a row is cut off the row first: it belongs to the batch, never
    // to the piece, and it never touches a number.
    let work = body;
    let personalNote = "";
    const pm = work.match(PERSONAL_RE);
    if (pm && pm.index != null) {
      personalNote = work.slice(pm.index).replace(/^[\s.\-–—:]+/, "").trim();
      work = work.slice(0, pm.index).trim();
    }
    const marks = marksOf(line);
    const person = clientOf(work);
    const dates = datesOf(work, today, soldBatch);
    const { receivedOn, soldOn } = dates;
    DATE_RE.lastIndex = 0;
    const dated = work.replace(DATE_RE, " ");
    let costGift = false;
    let workD = dated;
    if (/\(\s*\$?\s*gift\s*\)/i.test(workD)) {
      costGift = true;
      workD = workD.replace(/\(\s*\$?\s*gift\s*\)/i, " ");
    }
    const reb = takeRebate(workD);
    let gross: number;
    let costLine: string;
    const costNotes: string[] = [...reb.notes];
    if (reb.grossOverride != null) {
      gross = reb.grossOverride;
      costLine = reb.line;
    } else {
      const found = takeCost(reb.line);
      gross = found.cents + reb.netBasisRebate;
      costLine = found.line;
      costNotes.push(...found.notes);
    }
    let rebate = reb.rebate;
    if (reb.pendingPercent != null && gross > 0) rebate += Math.round((gross * reb.pendingPercent) / 100);
    const issues: RowIssue[] = [...reb.issues];
    if (rebate > gross && gross > 0) issues.push("uncertain-rebate");
    let costState: CostState = costGift ? "gift" : "";
    if (/\bfull\s*refund/i.test(work)) {
      costState = "refunded";
      gross = 0;
    }
    const approxCost = /likely\s*\$/i.test(work) || /don'?t remember/i.test(work) || /\bno recuerdo\b/i.test(work);
    if (approxCost) {
      costState = "approx";
      issues.push("true-cost");
    }
    const sale = takeSale(costLine);
    const saidSold = dates.saidSold || sale.arrowSold;
    const sized = sale.line
      .replace(/\b(?:sold\s+)?for\s+\$\s*[0-9.\s]+/gi, " ")
      .replace(/\+\s*\$\s*[0-9.]+\s*delivery/gi, " ")
      .replace(/\bdelivery\s*\$\s*[0-9.]+/gi, " ")
      .replace(/\$\s*[0-9.]+\s*off\b/gi, " ")
      .replace(/\bin\s+\$\s*[0-9.]+/gi, " ");
    const size = takeSize(sized);
    const extra = noteBits(line);
    const coming = /\bcoming\b/i.test(line) || /💙/.test(line);
    const unsure = nextUnsure || /\?/.test(line) || /likely to return/i.test(line) || approxCost;
    nextUnsure = false;

    const returned = /\breturned\b/i.test(work);
    const failed = FAILED_SALE_RE.test(work);
    const keptLine = KEPT_RE.test(work);
    const giftOut = /\bpresent\b/i.test(work) || (/\bgifts?\b/i.test(work) && !!person) || (/\bmine\b/i.test(work) && !!person && /\bto\s+\p{Lu}/u.test(work));
    const usedLine = /\bused\b/i.test(work);
    let kind: RowKind;
    if (returned) kind = "returned";
    else if (failed) kind = "failed-sale";
    else if (keptLine) kind = "kept";
    else if (!saidSold && !soldBatch && giftOut) kind = "gift";
    else if (saidSold || soldBatch) kind = "sale";
    else if (usedLine) kind = "used";
    else kind = "stock";
    if (kind === "sale" && coming) issues.push("coming-sold");
    if (personalNote) issues.push("personal-note");

    const base = emptyInput();
    const noteList = [...size.notes, ...sale.notes, ...costNotes, ...extra.bits];
    if (kind === "failed-sale") noteList.push("Failed sale");
    if (kind === "gift" && person) noteList.push(`For ${person}`);
    if (marks) noteList.push(`Marks: ${marks}`);
    const notes = noteList.filter((bit, index, all) => bit && all.indexOf(bit) === index);
    const status =
      kind === "sale"
        ? soldBatch
          ? "archived"
          : "sold"
        : kind === "kept"
          ? "kept"
          : kind === "gift"
            ? "archived"
            : kind === "stock" && coming
              ? "incoming"
              : "available";
    rows.push({
      input: {
        ...base,
        name: named?.name || title || category || "Piece",
        category: named?.category || category,
        brand: named?.brand || "",
        status,
        wasSold: kind === "sale",
        sizeSystem: size.system || "US",
        sizeLabel: size.label,
        usSize: size.system === "US" ? "" : size.us,
        fit: named?.fit || fit,
        costCents: gross,
        askCents: kind === "sale" ? (sale.askFromPrice ?? 0) : kind === "stock" || kind === "used" || kind === "failed-sale" ? (sale.price ?? 0) : 0,
        saleCents: kind === "sale" ? sale.price : null,
        buyRebateCents: rebate,
        deliveryCents: sale.delivery,
        source: source || sourceOf(line),
        channel: /\bebay\b/i.test(line) ? "Ebay" : "",
        place: placeOf(line),
        // Oscar's rule: a name becomes the client only on a real sale. A gift keeps its
        // recipient in the notes; stock and failed sales keep the name out of the client field.
        clientName: kind === "sale" ? person : "",
        receivedOn,
        soldOn: kind === "sale" ? soldOn : null,
        notes: notes.join(" · "),
        problem: unsure ? "unsure" : "",
      },
      raw: line,
      section: title,
      kind,
      soldDated: kind === "sale" && !!soldOn,
      issues,
      person,
      personalNote,
      marks,
      costState,
      sizeBare: size.bare,
      addedYearWritten: dates.addedYearWritten,
      soldYearWritten: dates.soldYearWritten,
    });
  }
  return { rows, loose };
}

/**
 * A title, then one line per piece. Sold lines become sold.
 * Pass soldBatch when the whole note is already sold: those land in the archive and still count.
 */
export function parseFloorNotes(text: string, today = new Date(), soldBatch = false): PieceInput[] {
  return parseDetailedNotes(text, today, soldBatch).rows.map((row) => row.input);
}
