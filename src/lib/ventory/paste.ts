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
  if (/🏡|🏠|🛖|\b(?:home|here)\b/i.test(line)) return "home";
  if (/🚚|🚗|🚙|🛻|🚛|🏎️|🚘/.test(line)) return "car";
  return "";
}

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

function takeSale(line: string) {
  const notes: string[] = [];
  const net = line.match(/\bfor\s+\$\s*[0-9.]+\s*-\s*[0-9.]+\s*=\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  let cents = net ? dollarsToCents(net[1]) : null;
  if (cents == null) {
    const amounts = [...line.matchAll(/\b(?:sold\s+)?for\s+\$\s*([0-9]+(?:\s*\.\s*[0-9]{1,2})?)/gi)];
    cents = amounts.length ? dollarsToCents(amounts[amounts.length - 1][1].replace(/\s+/g, "")) : null;
  }
  if (cents == null && /\bsold\b/i.test(line)) {
    const inn = line.match(/\bin\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
    if (inn) cents = dollarsToCents(inn[1]);
  }
  const plus = line.match(/\+\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*delivery/i);
  if (plus && cents != null) {
    cents += dollarsToCents(plus[1]);
    notes.push(`Delivery $${plus[1]}`);
  } else {
    const delivery = line.match(/\(\s*delivery\s*\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*\)/i);
    if (delivery) notes.push(`Delivery $${delivery[1]}`);
  }
  return { cents, notes };
}

function takeSize(line: string) {
  const notes: string[] = [];
  const clean = line.replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim();
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
  if (offered) notes.push(`Offered as ${tidyUs(offered[1])}`);
  if (/\bused\b/i.test(clean)) notes.push("Used");
  if (/\bmine\b/i.test(clean)) notes.push("Mine");
  return { system, label, us, notes };
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
  return { receivedOn, soldOn, saidSold };
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
  const present = text.match(/\b([\p{Lu}][\p{L}'’.-]+)'s\s+(?:birthday\s+)?present\b/u);
  if (present) return personName(present[1]);
  const dashed = text.match(/[-–—]\s*([\p{Lu}][\p{L}'’.-]+\s+[\p{Lu}][\p{L}'’.-]+)\s*[-–—]/u);
  if (dashed) return personName(dashed[1]);
  const tail = text.match(/\b([\p{Lu}][\p{L}'’.-]+\s+[\p{Lu}][\p{L}'’.-]+)\s*$/u);
  return tail ? personName(tail[1]) : "";
}

function noteBits(line: string) {
  const bits: string[] = [];
  const plain = stripMarks(line);
  if (/\bgift\b|\bpresent\b|\bbirthday\b|\bgave it to me\b/i.test(plain)) bits.push("Gift");
  if (/\breturned\b/i.test(plain)) bits.push("Returned");
  if (/likely to return/i.test(plain)) bits.push("Likely return");
  if (/full refund/i.test(plain)) bits.push("Full refund");
  const percent = plain.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:%|percent)\b/i);
  if (percent) bits.push(`${percent[1]}%`);
  const comment = line.match(/\/\*\s*(.+?)\s*\*\//);
  if (comment) {
    const long = comment[1].match(/long to be\s*([0-9.]+)/i);
    bits.push(long ? `Runs long, should be ${long[1]}` : stripMarks(comment[1]));
  }
  const percentOff = /[0-9.]+\s*%\s*off\b/i.test(plain);
  const off = percentOff ? null : plain.match(/\$?\s*([0-9]+(?:\s*\.\s*[0-9]+)?)\s*off\b/i);
  if (off) bits.push(`Credit $${off[1].replace(/\s+/g, "")}`);
  return { bits, discount: off ? dollarsToCents(off[1].replace(/\s+/g, "")) : 0 };
}

/**
 * A title, then one line per piece. Sold lines become sold.
 * Pass soldBatch when the whole note is already sold: those land in the archive and still count.
 */
export function parseFloorNotes(text: string, today = new Date(), soldBatch = false): PieceInput[] {
  let title = "";
  let category = "Boot";
  let fit = "men";
  let source = "";
  let nextUnsure = false;
  const rows: PieceInput[] = [];
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
    const { receivedOn, soldOn, saidSold } = datesOf(body, today, soldBatch);
    DATE_RE.lastIndex = 0;
    const dated = body.replace(DATE_RE, " ");
    const cost = takeCost(dated);
    const sale = takeSale(cost.line);
    const sized = cost.line
      .replace(/\b(?:sold\s+)?for\s+\$\s*[0-9.\s]+/gi, " ")
      .replace(/\+\s*\$\s*[0-9.]+\s*delivery/gi, " ")
      .replace(/\bdelivery\s*\$\s*[0-9.]+/gi, " ")
      .replace(/\$\s*[0-9.]+\s*off\b/gi, " ")
      .replace(/\bin\s+\$\s*[0-9.]+/gi, " ");
    const size = takeSize(sized);
    const extra = noteBits(line);
    const coming = /\bcoming\b/i.test(line) || /💙/.test(line);
    const unsure = nextUnsure || /\?/.test(line) || /likely to return/i.test(line);
    nextUnsure = false;
    const counted = soldBatch || saidSold;
    const base = emptyInput();
    const notes = [...size.notes, ...sale.notes, ...cost.notes, ...extra.bits].filter((bit, index, all) => bit && all.indexOf(bit) === index);
    rows.push({
      ...base,
      name: named?.name || title || category || "Piece",
      category: named?.category || category,
      brand: named?.brand || "",
      status: soldBatch ? "archived" : saidSold ? "sold" : coming ? "incoming" : "available",
      wasSold: counted,
      sizeSystem: size.system || "US",
      sizeLabel: size.label,
      usSize: size.system === "US" ? "" : size.us,
      fit: named?.fit || fit,
      costCents: cost.cents,
      askCents: sale.cents ?? 0,
      saleCents: counted && sale.cents != null ? sale.cents : null,
      discountCents: extra.discount,
      source: source || sourceOf(line),
      channel: /\bebay\b/i.test(line) ? "Ebay" : "",
      place: placeOf(line),
      clientName: clientOf(line),
      receivedOn,
      soldOn,
      notes: notes.join(" · "),
      problem: unsure ? "unsure" : "",
    });
  }
  return rows;
}
