/**
 * ask.ts — Ventory's Advisor question engine (1.13.0).
 *
 * Faro's architecture carried to merchandise, never its content: a
 * question map with a judgment order (most specific family first),
 * family engines over ONE reading — metrics.measure(), the same object
 * Statistics reads — and answers that carry their evidence: every
 * figure names its base and its exclusions. Deterministic, no model:
 * Oscar's law for the fleet's advisors (2026-11-21) is to squeeze the
 * logic until it seems alive. This module cannot write anything; it
 * only reads the floor and answers.
 *
 * The door is born under the loose reader's law (1.12.0): what the
 * question does not say is not invented. Names, brands, sizes, sources,
 * channels and clients in the question are matched against the floor's
 * own words first — literal shields, never reworded, never guessed.
 * When the evidence does not reach, the answer is the exact frontier,
 * never silence and never a fabrication.
 */
import { daysHeld, money, todayISO, type Ad, type Piece } from "./model";
import { groupBy, isSale, isStock, measure, pct, sizeName, type Group, type Metrics } from "./metrics";
import { missingOf, missingWords } from "./advisor";
import { moveList, priceList, restockList } from "./insights";
import { fold } from "./loose";
import { fullDate, type Lang } from "./i18n";
import { FAMILY_CUES, FRONTIER_CUES, NEGATED_SALE, WINDOW_CUES, type FamilyId } from "./ask-lexicon";

export type AskAnswer = { family: FamilyId | "unknown"; text: string; pieceIds: string[]; desk?: string };

/** The Bridge: the Statistics fold where each family's figures live, so
 *  an answer can lead to its exact place (and the fold's caption is the
 *  Advisor's own line, from the same reading). Families with no fold of
 *  their own (the single piece, what's missing, capabilities, the
 *  frontier) carry no desk: inventing a destination would break it. */
const DESK_FOR: Partial<Record<FamilyId, string>> = {
  ventas: "time", tramos: "time", ganancia: "numbers", existencias: "stock", capital: "stock",
  precios: "product", reposicion: "product", nosemueve: "aging", rotacion: "pace",
  fuentes: "sources", canales: "channels", tallas: "sizes", anuncios: "ads", marcas: "earns", envios: "numbers",
};

type Entity = { kind: "product" | "brand" | "category" | "source" | "channel" | "client" | "size"; label: string; folded: string; match?: string[] };

/** Bilingual word groups for the floor's categories: a seller asks for
 *  "caps" or "gorras" over the same Hat cards, in either language. The
 *  group words only widen MATCHING; the entity keeps its own label and
 *  its canonical folded value for scoping. */
const CATEGORY_WORDS: string[][] = [
  ["bota", "botas", "boot", "boots", "botin", "botines"],
  ["reloj", "relojes", "watch", "watches"],
  ["gorra", "gorras", "cap", "caps"],
  ["sombrero", "sombreros", "hat", "hats"],
  ["cartera", "carteras", "wallet", "wallets", "bolso", "bolsos", "bag", "bags"],
  ["cinturon", "cinturones", "belt", "belts"],
  ["tenis", "sneaker", "sneakers", "zapato", "zapatos", "shoe", "shoes"],
  ["camisa", "camisas", "shirt", "shirts"],
  ["pantalon", "pantalones", "pants", "jeans"],
  ["chaqueta", "chaquetas", "jacket", "jackets"],
  ["vestido", "vestidos", "dress", "dresses"],
];

function entitiesOf(pieces: Piece[]): Entity[] {
  const seen = new Map<string, Entity>();
  const add = (kind: Entity["kind"], label: string) => {
    const clean = label.trim();
    if (!clean) return;
    const key = `${kind}:${fold(clean)}`;
    if (!seen.has(key)) seen.set(key, { kind, label: clean, folded: fold(clean) });
  };
  for (const piece of pieces) {
    add("product", piece.name);
    add("brand", piece.brand);
    add("category", piece.category);
    add("source", piece.source);
    add("channel", piece.channel);
    add("client", piece.clientName);
    const size = sizeName(piece);
    if (size) add("size", size);
  }
  const out = [...seen.values()];
  for (const e of out) {
    // A one-word product whose name is a category word ("Gorra") is
    // asked by every word of its group ("caps" names the Gorra cards).
    if (e.kind === "product" && !e.folded.includes(" ")) {
      const group = CATEGORY_WORDS.find((g) => g.includes(e.folded));
      if (group) e.match = [...(e.match ?? []), ...group];
    }
    if (e.kind === "category") {
      const group = CATEGORY_WORDS.find((g) => e.folded.split(" ").some((t) => g.includes(t)));
      if (group) e.match = group;
    }
    if (e.kind === "channel" && e.folded === "in person") e.match = ["en persona"];
    // A leading article is not part of the name a seller says: "La paca"
    // is asked as "the paca", "paca" or "la paca" alike.
    const article = e.folded.match(/^(?:la|el|los|las|the) (.+)$/);
    if (article) e.match = [...(e.match ?? []), article[1]];
  }
  // A card's size lives in two systems at once ("44" on the label, "US
  // 10" on the name): both forms name the same size entity.
  for (const piece of pieces) {
    const canonical = fold(sizeName(piece));
    if (!canonical || !piece.sizeLabel) continue;
    const e = out.find((x) => x.kind === "size" && x.folded === canonical);
    if (!e) continue;
    const forms = [fold(piece.sizeLabel), fold(`${piece.sizeSystem} ${piece.sizeLabel}`)].filter((f) => f && f !== canonical);
    if (forms.length) e.match = [...new Set([...(e.match ?? []), ...forms])];
  }
  return out;
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The floor's own words found in the question: full labels first, then a
 *  shared head word ("reloj" names every Reloj on the floor), then one
 *  typo (edit distance 1, same first letter, never a short word). */
function findEntity(folded: string, entities: Entity[]): { entity: Entity | null; headWord: string | null } {
  // Whole-word containment: the label's words must appear as consecutive
  // words of the question (the last may carry a plural s). A raw substring
  // match would find "hat" inside "what" and "ana" inside "canal".
  const words = folded.split(/[^a-z0-9.]+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);
  const kindRank = { product: 0, client: 1, channel: 2, source: 3, brand: 4, category: 5, size: 6 } as const;
  const matchesForm = (form: string) => {
    const parts = form.split(" ").filter(Boolean);
    if (!parts.length || parts.join("").length < 3) return false;
    for (let i = 0; i + parts.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        const w = words[i + j];
        if (w !== parts[j] && !(j === parts.length - 1 && w === `${parts[j]}s`)) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  };
  // A two-word product named in the other language's order ("Justin
  // boots" for the Botas Justin card): all its words present, one of
  // them through its category group, names the product. It outranks a
  // bare brand or category hit on the same words ("Justin" alone is
  // the brand; "Justin boots" is the product).
  const setMatch = (): Entity | null => {
    for (const e of entities) {
      if (e.kind !== "product") continue;
      const parts = e.folded.split(" ").filter(Boolean);
      if (parts.length !== 2) continue;
      const group = CATEGORY_WORDS.find((g) => parts.some((p) => g.includes(p)));
      if (!group) continue;
      const other = parts.find((p) => !group.includes(p));
      if (!other || !words.includes(other)) continue;
      if (words.some((w) => group.includes(w))) return e;
    }
    return null;
  };
  const hits = entities.filter((e) => matchesForm(e.folded) || (e.match ?? []).some(matchesForm));
  if (hits.length) {
    hits.sort((a, b) => b.folded.length - a.folded.length || kindRank[a.kind] - kindRank[b.kind]);
    const top = hits[0];
    const setHit = setMatch();
    if (setHit && (top.kind === "brand" || top.kind === "category")) return { entity: setHit, headWord: null };
    // A one-word hit that is also the first word of a longer floor name
    // yields to that name when the question carries its other word too
    // ("outlet de Coach" is the Coach outlet, a source, not the brand),
    // and a store word in the question ("tienda Nike") does the same.
    if (top.folded.split(" ").length === 1) {
      const longer = entities
        .filter((e) => e !== top && e.folded.split(" ")[0] === top.folded && e.folded.split(" ").length > 1)
        .filter((e) => e.folded.split(" ").slice(1).some((t) => words.includes(t)) || (/\b(tienda|store|shop)\b/.test(folded) && e.kind === "source"))
        .sort((a, b) => kindRank[a.kind] - kindRank[b.kind]);
      if (longer.length) return { entity: longer[0], headWord: null };
    }
    return { entity: top, headWord: null };
  }
  const setHitOnly = setMatch();
  if (setHitOnly) return { entity: setHitOnly, headWord: null };
  // A bare number names a size ("size 44", "talla 9.5"), in either of
  // the size systems the card carries.
  for (const word of words) {
    if (!/^\d+(?:\.\d+)?$/.test(word)) continue;
    const sized = entities.filter((e) => e.kind === "size" && [e.folded, ...(e.match ?? [])].some((f) => f.split(" ").includes(word)));
    if (sized.length) return { entity: sized[0], headWord: null };
  }
  // One distinctive word of a longer name ("marketplace" for Facebook
  // Marketplace, "paca" for La paca, "lopez" for Maria Lopez).
  for (const word of words) {
    if (word.length < 4) continue;
    if (word === "person") continue; // "that person" is not the "In person" channel
    const sharing = entities
      .filter((e) => e.folded.split(" ").length > 1 && e.folded.split(" ").slice(1).includes(word))
      .sort((a, b) => kindRank[a.kind] - kindRank[b.kind]);
    if (sharing.length) return { entity: sharing[0], headWord: null };
  }
  // A shared first word: "reloj" names every Reloj product, "maria" her
  // full name, "nike" the Nike store before the Nike brand.
  for (const word of words) {
    if (word.length < 4) continue;
    const sharing = entities
      .filter((e) => e.kind !== "size" && e.kind !== "category" && e.folded.split(" ")[0] === word)
      .sort((a, b) => kindRank[a.kind] - kindRank[b.kind]);
    if (sharing.length) return { entity: sharing[0], headWord: sharing[0].kind === "product" ? word : null };
  }
  for (const word of words) {
    if (word.length < 5) continue;
    for (const e of entities) {
      if (e.kind !== "product") continue;
      const head = e.folded.split(" ")[0];
      if (head[0] === word[0] && editDistance(word, head) <= 1) return { entity: e, headWord: head };
    }
  }
  return { entity: null, headWord: null };
}

function inScope(piece: Piece, entity: Entity | null, headWord: string | null): boolean {
  if (!entity) return true;
  if (headWord && entity.kind === "product") return fold(piece.name).split(" ")[0] === headWord;
  switch (entity.kind) {
    case "product": return fold(piece.name) === entity.folded;
    case "brand": return fold(piece.brand) === entity.folded;
    case "category": return fold(piece.category) === entity.folded;
    case "source": return fold(piece.source) === entity.folded;
    case "channel": return fold(piece.channel) === entity.folded;
    case "client": return fold(piece.clientName) === entity.folded;
    case "size": return fold(sizeName(piece)) === entity.folded;
  }
}

function groupRow(rows: Group[], entity: Entity | null): Group | null {
  if (!entity) return null;
  return rows.find((row) => fold(row.label) === entity.folded) ?? null;
}

type Win = { from: string; to: string; kind: string } | null;

function isoOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const MONTH_NAMES: [string, string][] = [
  ["january", "enero"], ["february", "febrero"], ["march", "marzo"], ["april", "abril"],
  ["may", "mayo"], ["june", "junio"], ["july", "julio"], ["august", "agosto"],
  ["september", "septiembre"], ["october", "octubre"], ["november", "noviembre"], ["december", "diciembre"],
];

function windowOf(folded: string, today: Date): Win {
  // "Up to today / hasta hoy / so far" is the whole record, not the
  // today window: no window at all.
  if (/\b(hasta hoy|hasta ahora|up to today|so far)\b/.test(folded)) return null;
  // A named month is a window: the most recent occurrence of that month.
  // It must arrive with its preposition (en/in/de), at the start, or with
  // its year — a bare "may" or "march" in English is a verb, not a month.
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`(?:\\b(?:en|in|de)\\s+(?:${MONTH_NAMES[i][0]}|${MONTH_NAMES[i][1]})\\b)|(?:^\\s*(?:${MONTH_NAMES[i][0]}|${MONTH_NAMES[i][1]})\\b)|(?:\\b(?:${MONTH_NAMES[i][0]}|${MONTH_NAMES[i][1]})\\s+(?:de\\s+)?\\d{4}\\b)`);
    if (!re.test(folded)) continue;
    let year = today.getFullYear();
    if (i > today.getMonth()) year -= 1;
    return { from: isoOf(new Date(year, i, 1)), to: isoOf(new Date(year, i + 1, 0)), kind: `monthname-${year}-${i}` };
  }
  for (const cue of WINDOW_CUES) {
    if (!cue.re.test(folded)) continue;
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const monday = new Date(day);
    monday.setDate(day.getDate() - ((day.getDay() + 6) % 7));
    switch (cue.kind) {
      case "today": return { from: isoOf(day), to: isoOf(day), kind: "today" };
      case "yesterday": { const y = new Date(day); y.setDate(day.getDate() - 1); return { from: isoOf(y), to: isoOf(y), kind: "yesterday" }; }
      case "week": { const sun = new Date(monday); sun.setDate(monday.getDate() + 6); return { from: isoOf(monday), to: isoOf(sun), kind: "week" }; }
      case "lastweek": { const from = new Date(monday); from.setDate(monday.getDate() - 7); const to = new Date(monday); to.setDate(monday.getDate() - 1); return { from: isoOf(from), to: isoOf(to), kind: "lastweek" }; }
      case "month": return { from: isoOf(new Date(day.getFullYear(), day.getMonth(), 1)), to: isoOf(new Date(day.getFullYear(), day.getMonth() + 1, 0)), kind: "month" };
      case "lastmonth": return { from: isoOf(new Date(day.getFullYear(), day.getMonth() - 1, 1)), to: isoOf(new Date(day.getFullYear(), day.getMonth(), 0)), kind: "lastmonth" };
      case "year": return { from: isoOf(new Date(day.getFullYear(), 0, 1)), to: isoOf(new Date(day.getFullYear(), 11, 31)), kind: "year" };
    }
  }
  return null;
}

const WIN_LABEL: Record<string, { en: string; es: string }> = {
  today: { en: "today", es: "hoy" },
  yesterday: { en: "yesterday", es: "ayer" },
  week: { en: "this week", es: "esta semana" },
  lastweek: { en: "last week", es: "la semana pasada" },
  month: { en: "this month", es: "este mes" },
  lastmonth: { en: "last month", es: "el mes pasado" },
  year: { en: "this year", es: "este año" },
  all: { en: "in total", es: "en total" },
};

export function askInventory(pieces: Piece[], ads: Ad[], question: string, opts: { lang?: Lang; today?: Date } = {}): AskAnswer {
  const answer = computeAnswer(pieces, ads, question, opts);
  if (answer.family !== "unknown" && answer.family !== "frontera") {
    // A profit question aimed at one group lives in the earners ranking.
    if (answer.family === "ganancia" && findEntity(fold(question), entitiesOf(pieces)).entity) answer.desk = "earns";
    else answer.desk = DESK_FOR[answer.family as FamilyId];
  }
  return answer;
}

function computeAnswer(pieces: Piece[], ads: Ad[], question: string, opts: { lang?: Lang; today?: Date } = {}): AskAnswer {
  const lang = opts.lang ?? "en";
  const todayD = opts.today ?? new Date();
  const today = isoOf(todayD);
  const es = lang === "es";
  const folded = fold(question);
  const entities = entitiesOf(pieces);
  const { entity, headWord } = findEntity(folded, entities);
  const win = windowOf(folded, todayD);
  const m = measure(pieces, ads, { lang, today });
  const mw = win ? measure(pieces, ads, { lang, today, from: win.from, to: win.to }) : m;
  const winName = win?.kind.startsWith("monthname")
    ? (es ? `en ${new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(new Date(`${win.from}T12:00:00`))}` : `in ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${win.from}T12:00:00`))}`)
    : WIN_LABEL[win?.kind ?? "all"][lang];
  const longDate = (iso: string) => new Intl.DateTimeFormat(es ? "es" : "en-US", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00`));
  const scoped = pieces.filter((piece) => inScope(piece, entity, headWord));
  const scopedStock = scoped.filter(isStock);
  const scopedSales = scoped.filter(isSale);
  const ids = (list: Piece[]) => list.map((piece) => piece.id);
  const units = (list: Piece[]) => list.reduce((sum, piece) => sum + piece.qty, 0);
  const STATUS_WORD: Record<string, { en: string; es: string }> = {
    available: { en: "on hand", es: "en inventario" }, incoming: { en: "on the way", es: "en camino" },
    sold: { en: "sold", es: "vendida" }, archived: { en: "archived", es: "archivada" }, kept: { en: "kept", es: "guardada" },
  };
  // A named thing with cards but no sales gets its own declaration —
  // never the floor's totals bent into its answer.
  const noSalesText = (name: string) => {
    const states = [...new Set(scoped.map((piece) => piece.status))].map((s) => STATUS_WORD[s][lang]).join(", ");
    return es
      ? `${name} no se ha vendido (${states}): no entra en ninguna cifra de ventas ni de ganancia.`
      : `${name} has not sold (${states}): it enters no sales or profit figure.`;
  };
  const cost = (list: Piece[]) => list.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);

  const noFamily = (): AskAnswer => ({ family: "unknown", text: es
    ? "Esa pregunta todavía no tiene familia en esta casa: no la voy a acomodar a otra ni a inventar su respuesta. Pregúntame «¿qué puedes hacer?» y te digo las familias vivas, cada una con su ejemplo."
    : "That question has no family in this house yet: I will not bend it to another one or invent its answer. Ask me “what can you do?” and I will tell you the live families, each with its example.", pieceIds: [] });

  // A request addressed to the assistant itself ("can you call…",
  // "¿puedes borrar…") is not a floor question: the door only answers.
  if (/^\s*[¿?]*\s*(?:(?:me )?(?:puedes|podrias)|can you)\s+(?:sell me|call|delete|add|buy me|venderme|llamar|borrar|agregar|anadir|remove|quitar|erase|cambiar|change|conseguir|actualizar|update|fetch|traer|bring)\b/.test(folded)) return noFamily();

  // The weather is not on any card either, and it does not become the
  // market frontier just because the question names the market place.
  if (/\b(llover|lluvia|rain|weather|clima|pronostico|forecast|temperatura|temperature)\b/.test(folded)) return noFamily();

  // ---- Frontier first: a fee, a listing date, a market price is a
  // boundary, not a number, whichever family the words also touch.
  for (const cue of FRONTIER_CUES) {
    if (!cue.re.test(folded)) continue;
    const text =
      cue.kind === "fees" ? (es ? "Eso no lo puedo cerrar: las tarifas de venta no están en ninguna tarjeta, así que no existe un neto final que pueda nombrarte. Lo que sí puedo darte es la ganancia según las tarjetas — precio de venta menos costo, con el anuncio restado cuando lo hay — y el piso real siempre es más alto que el costo, porque las tarifas toman su parte antes." : "I cannot close that one: selling fees are not on any card, so there is no final net I can name. What I can give you is profit by the cards — sale price minus cost, with the ad subtracted when there is one — and the real floor is always higher than cost, because fees take their share first.")
      : cue.kind === "listing" ? (es ? "No hay fecha de publicación en las tarjetas, así que no puedo decir desde cuándo está publicada una pieza. El reloj de esta casa es la fecha de llegada: la antigüedad se mide desde que la pieza llegó, y eso sí te lo puedo dar por pieza o por grupo." : "There is no listing date on the cards, so I cannot say since when a piece has been listed. This house's clock is the arrival date: aging is measured from when the piece arrived, and that I can give you per piece or per group.")
      : cue.kind === "market" ? (es ? "No tengo precios de mercado ni sé lo que otros cobran: Ventory solo conoce tus tarjetas. Lo que sí puedo mostrarte es a cuánto se ha vendido esto en tu propio inventario, que es evidencia tuya, no del mercado." : "I have no market prices and I do not know what others charge: Ventory only knows your cards. What I can show you is what this has actually sold for in your own inventory — your evidence, not the market's.")
      : cue.kind === "condition" ? (es ? "La condición de una pieza no es un campo de la tarjeta, así que no la voy a inventar. Si la escribes en las notas de la pieza, la cito tal cual; sin eso, no hay respuesta honesta a esa pregunta." : "A piece's condition is not a field on the card, so I will not invent it. If you write it in the piece's notes I will quote it as written; without that, there is no honest answer to that question.")
      : cue.kind === "appearance" ? (es ? "Eso no lo puedo ver desde aquí: respondo desde los datos de las tarjetas (cifras, fechas y nombres), no desde la apariencia de una pieza. Si la pieza tiene foto, está en su tarjeta: ábrela y la ves tú mismo." : "I cannot see that from here: I answer from the cards' data (figures, dates and names), not from how a piece looks. If the piece has a photo it is on its card: open it and see for yourself.")
      : cue.kind === "notowned" ? (es ? "Esa pieza todavía no es tuya ni está en tus tarjetas: sin su costo ni tu historial con ella, no hay precio honesto que pueda darte. Cuando la compres y la anotes, te digo a cuánto se ha vendido lo parecido en tu propio piso." : "That piece is not yours yet and is on none of your cards: with no cost of yours and no history with it, there is no honest price I can give you. When you buy it and note it down, I will tell you what its like has sold for on your own floor.")
      : (es ? "No hay fecha de devolución en las tarjetas: una devolución no se puede colocar en una semana. La pieza vuelve a inventario y sus días cuentan desde su fecha de llegada." : "There is no return date on the cards: a return cannot be placed in a week. The piece goes back on hand and its days count from its arrival date.");
    return { family: "frontera", text, pieceIds: [] };
  }

  // A brand named after "marca/brand" that no card carries gets a
  // declaration, not the floor's totals. Verbs and question words after
  // "marca" ("¿qué marca vende más?") are not names.
  const brandAsk = question.match(/\b(?:marca|brand)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
  if (brandAsk) {
    const word = fold(brandAsk[1]);
    const NOT_A_NAME = new Set(["vende", "venden", "sells", "sell", "es", "is", "se", "mas", "mejor", "best", "tiene", "tienen", "tengo", "of", "the", "que", "cual", "cuales", "hay", "moves", "move", "conviene", "deja", "dejan", "rota", "rotan", "manda", "mandan", "gana", "ganan", "queda", "quedan", "cobra", "leaves", "leave", "leads", "lead", "rotates", "rotate", "suits", "suit", "has", "have", "does", "goes", "takes", "take", "comes", "did", "son", "estan", "puede", "quiero", "cuesta", "cuestan", "me", "trae", "traen", "brings", "bring", "da", "dan", "no", "not", "nunca", "never", "nada", "ninguna", "ningun", "any", "yet", "todavia", "aun", "sin", "without", "mi", "mis", "su", "sus", "una", "un", "este", "esta", "ese", "esa", "this", "that", "it", "its", "on", "in", "at", "hasn", "haven", "isn", "aren", "didn", "don", "won", "can", "could", "would", "should", "there", "their", "they", "them", "then", "than", "ever", "come", "came", "get", "got"]);
    if (!NOT_A_NAME.has(word) && !findEntity(word, entities).entity) {
      const name = brandAsk[1][0].toUpperCase() + brandAsk[1].slice(1);
      return { family: "unknown", text: es
        ? `No hay nada de ${name} en este inventario: esa marca no está en ninguna tarjeta, así que no tiene ventas ni ganancia que pueda mostrarte. Si llega una pieza de ${name}, la anotas y desde ahí sí respondo por ella.`
        : `There is nothing from ${name} in this inventory: that brand is on no card, so it has no sales or profit I can show you. If a ${name} piece arrives, note it and from then on I can answer for it.`, pieceIds: [] };
    }
  }

  // Questions whose honest answer is silence, whichever family words
  // they carry: causes, predictions, deleted records, somebody else's
  // business, a member's personal data, audience numbers no card
  // holds, and strategy advice with no record behind it. "¿Por qué
  // canal…?" is "through which channel", not a cause, and stays.
  if (/^\s*[¿?]*\s*(?:por que|why)\b/.test(folded) && !/^\s*[¿?]*\s*por que (?:canal|fuente|channel|source)\b/.test(folded)) return noFamily();
  if (/\bwill\b/.test(folded) || /\b(?:mes|ano|semana) que viene\b/.test(folded) || /\b(vendere|vendera|venderan|tendre|ganare|ganara|rendira|rendire|volvera|comprara|compraran|vendra|vendran|habra|seguire|costara|costaran|valdra)\b/.test(folded) || /\b(next (?:month|year|quarter)|proximo (?:mes|ano)|el proximo (?:mes|ano))\b/.test(folded)) return noFamily();
  if (/\b(borr\w*|delet\w*|elimin\w*)\b/.test(folded)) return noFamily();
  if (/\b(compet\w*)\b/.test(folded)) return noFamily();
  if (/\b(mi hermano|mi hermana|my brother|my sister|su tienda|su negocio|his store|her store|his shop|her shop)\b/.test(folded)) return noFamily();
  if (/\b(telefono|phone|direccion|address|correo|e-?mail|birthday|cumpleanos|mensajes|messages)\b/.test(folded)) return noFamily();
  if (/\b(vieron|impresiones|impressions|views|alcance|reach|how many people|cuantas personas)\b/.test(folded)) return noFamily();
  if (/\b(llego a la gente|cuanta gente|gente (?:vio|ve)|audiencia|me quedara bien|quedara bien|would fit me|fit me|size for me|talla me queda)\b/.test(folded)) return noFamily();
  if (/^\s*[¿?]*\s*(?:should|deberia|debo)\b/.test(folded) && !/\b(buy|order|stock|restock|charge|cobr\w*|compr\w*|pedir|reponer|cut|sell|vend\w*|price|precio)\b/.test(folded)) return noFamily();

  let family = (FAMILY_CUES.find((cue) => cue.re.test(folded))?.id ?? "unknown") as FamilyId | "unknown";
  // Judgment refinements, in order. A negated sale is what-is-not-moving,
  // unless "todavía/yet" makes it the still-on-the-shelf reading. A speed
  // or duration frame is rotation, whichever family the words touched
  // first. A comparative frame is stretches. A question whose subject is
  // one dimension — asked with which/por/by, or naming a member of the
  // dimension — belongs to that dimension's family: the member's own
  // figures live there, not in the floor's totals.
  const SPEED = /\b(rapid|fast|rapido|cuanto (?:tarda|demora|se tarda|tardo)|tardo mas|tarda mas|took (?:the )?longest|how long|take to sell|takes to sell|in how many days|en cuantos dias|days to sell|selling speed|velocidad|se vende mas|sell-through|sellthrough|porcentaje|percentage|en cuanto (?:tiempo|se vende)|in how much time|tarda en venderse|tardo en venderse|on average|en promedio|fastest|sells (?:fastest|slowest)|moves (?:faster|fastest)|venta mas rapida|tiempo usual|usual (?:selling|sale))\b/;
  const dimFamilyOf = (text: string): FamilyId =>
    /\b(marcas?|brands?|categorias?|category|categories)\b/.test(text) ? "marcas"
    : /\b(fuentes?|sources?|proveedor\w*|suppliers?)\b/.test(text) ? "fuentes"
    : /\b(canales|canal|channels?)\b/.test(text) ? "canales" : "tallas";
  // "El mes que viene" is a future, not incoming stock; a named piece
  // asked with "desde cuándo/cuándo" is the piece's own arrival. And a
  // dimension member named by a question with NO family of its own only
  // earns its family when the question carries a record frame (how it
  // sells, how it is doing, what was spent): a phone number, an address
  // or a birthday asked about that same member stays unanswered.
  const PERF = /\b(como vende|como le va|que tal vende|how does|how is|how are|gast\w*|spend|spent|se vende|que compro|vendio|vendieron|sold|moved)\b/;
  const MONTH_WORDS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const monthNameCount = (text: string) => MONTH_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(text)).length;
  if (family === "existencias" && /\b(?:mes|ano|semana) que viene\b/.test(folded)) family = "unknown";
  else if (family === "existencias" && entity && (entity.kind === "product" || entity.kind === "brand" || entity.kind === "category") && /\b(?:desde cuando|cuando|when)\b/.test(folded)) family = "pieza";
  else if (family === "ventas" && entity && (entity.kind === "product" || entity.kind === "brand") && /\b(?:desde cuando|cuando|when)\b/.test(folded) && !/\bfor\b/.test(folded)) family = "pieza";
  else if (family === "existencias" && entity && /\bme quedan\b/.test(folded) && /\b(cuantos|cuantas|how many)\b/.test(folded)) family = "reposicion";
  if (/\b(?:nunca he vendido|nunca ha vendido|never sold|que nunca)\b/.test(folded) && /\b(?:comprar|deberia|should|buy|stock|pedir)\b/.test(folded)) family = "unknown";
  // A source or channel named as the seller itself ("how much does
  // Temu sell") is somebody else's business, not this floor's record
  // of what came from it.
  const entIdx = entity ? folded.indexOf(entity.folded) : -1;
  const afterEnt = entity && entIdx >= 0 ? folded.slice(entIdx + entity.folded.length).trimStart() : "";
  if (entity && (entity.kind === "source" || entity.kind === "channel") && /^(?:sell|sells|sold|vende|venden|vendio)\b/.test(afterEnt) && !/(?:lo de|de|from|del) $/.test(folded.slice(0, entIdx + 1))) family = "unknown";
  if ((family === "ventas" || family === "ganancia") && /\b(?:marcas?|brands?|fuentes?|sources?|proveedor\w*|suppliers?|canales|canal|channels?|tallas?|sizes?|categorias?|category|categories)\b/.test(folded) && /\b(?:que|which|por|by|cada|each|cual|mas|most|mejor|best)\b/.test(folded)) family = dimFamilyOf(folded);
  else if (family === "ventas" && NEGATED_SALE.test(folded)) family = /\b(todavia|yet|aun)\b/.test(folded) && /\b(tengo|tienes|hay|queda|quedan|still have|do i have|have i)\b/.test(folded) ? "existencias" : "nosemueve";
  else if (family === "ganancia" && /\bpor donde\b/.test(folded)) family = "canales";
  else if (family === "reposicion" && /\b(?:tallas?|sizes?)\b/.test(folded)) family = "tallas";
  else if (family === "reposicion" && entity?.kind === "size") family = "tallas";
  else if (family === "reposicion" && (entity?.kind === "source" || entity?.kind === "channel") && /(?:cuanto (?:me )?queda|cuantas me quedan|how much is left of|have left)/.test(folded)) family = entity.kind === "source" ? "fuentes" : "canales";
  else if (family === "reposicion" && /\b(?:where (?:do|should) i buy|de donde|donde (?:compro|comprar))\b/.test(folded)) family = "fuentes";
  else if (family === "precios" && /\b(?:marcas?|brands?|fuentes?|sources?|proveedor\w*|suppliers?|canales|canal|channels?|tallas?|sizes?|categorias?|category|categories)\b/.test(folded)) family = dimFamilyOf(folded);
  else if (family === "ventas" && (/\b(?:sell|sold|go|went)\b[^.?]*\bfor\b/.test(folded) || /(?:en cuanto|a cuanto) se vendio/.test(folded)) && (!entity || entity.kind === "product" || entity.kind === "brand" || entity.kind === "category" || /\b(everything|todo)\b/.test(folded)) && !/\bhow much did i sell\b/.test(folded)) family = entity && scopedSales.length === 1 && scopedSales[0].qty === 1 && !/\b(did i|can i|should i|do i|has|have|se ha|se han)\b/.test(folded) ? "pieza" : "precios";
  else if (family === "ventas" && SPEED.test(folded)) family = "rotacion";
  else if ((family === "ventas" || family === "unknown" || family === "marcas") && /\b(?:where (?:do|should) i buy|de donde (?:viene|vino|vienen)|comes? from|donde compro)\b/.test(folded)) family = "fuentes";
  else if (family === "ganancia" && (entity?.kind === "source" || entity?.kind === "channel") && /\b(?:de|from|del)\b/.test(folded) && /\b(?:stock|left|queda|quedan|tengo|inventario|inventory|on hand)\b/.test(folded)) family = entity.kind === "source" ? "fuentes" : "canales";
  else if (entity?.kind === "category" && (family === "ventas" || family === "unknown" || family === "existencias") && /\b(categoria|category|categorias|categories)\b/.test(folded)) family = "marcas";
  else if (entity?.kind === "channel" && (family === "ventas" || family === "existencias" || (family === "unknown" && PERF.test(folded)))) family = "canales";
  else if (entity?.kind === "source" && (family === "ventas" || family === "existencias" || (family === "unknown" && PERF.test(folded)))) family = "fuentes";
  else if (entity?.kind === "brand" && (family === "ventas" || (family === "unknown" && PERF.test(folded)))) family = "marcas";
  else if (entity?.kind === "client" && (family === "ventas" || family === "existencias" || (family === "unknown" && PERF.test(folded)))) family = "clientes";
  else if (entity?.kind === "size" && family === "ventas") family = "tallas";
  else if (family === "ventas" && /\b(?:que mes|cual mes|which month)\b/.test(folded)) family = "tramos";
  else if ((family === "ventas" || family === "unknown") && monthNameCount(folded) >= 2) family = "tramos";
  else if ((family === "ventas" || family === "ganancia") && !entity && /(?:\bmas\b[^.?]{0,30}\bque\b|\bmore\b[^.?]{0,30}\bthan\b|\bthan\b|\bmas\b[^.?]{0,24}\bo\b|\bmore\b[^.?]{0,24}\bor\b|\bentre\b|\bbetween\b|contra|against|compar\w*|versus|vs\b)/.test(folded)) family = "tramos";
  else if (family === "faltantes" && /\b(?:surtir|stock up|to stock|restock)\b/.test(folded)) family = "reposicion";
  else if (family === "nosemueve" && (/\b(?:dinero|money|inversion|investment|inverti|invest)\b/.test(folded) || (/\b(?:mercancia|merchandise)\b/.test(folded) && /\b(?:cuanto|cuanta|how much)\b/.test(folded)))) family = "capital";
  else if (family === "ventas" && /\b(?:stuck|atascad\w*|won'?t sell|no se vende\w*)\b/.test(folded) && /\b(?:money|dinero|capital|invert\w*|invest\w*)\b/.test(folded)) family = "capital";
  else if (family === "rotacion" && /\b(?:past their|past its usual|pasaron su tiempo)\b/.test(folded)) family = "nosemueve";
  else if (family === "clientes" && /\b(?:pay|paid|pagaron|pagado)\b/.test(folded) && entity?.kind !== "client") family = "precios";
  else if (family === "anuncios" && /\b(?:gane|ganancia|profit|made|make|earn)\b/.test(folded)) family = "ganancia";
  else if (family === "reposicion" && /\b(?:nunca he vendido|nunca ha vendido|never sold|i'?ve never|que nunca)\b/.test(folded)) family = "unknown";
  else if (family === "reposicion" && /\b(?:en dinero|in money)\b/.test(folded)) family = "capital";
  else if (family === "precios" && entity && scopedSales.length === 1 && scopedSales[0].qty === 1 && /(?:sell for|sold for|se vendio)\b/.test(folded) && !/\b(did i|can i|should i|do i|has|have|se ha|se han)\b/.test(folded)) family = "pieza";
  else if (family === "precios" && (entity?.kind === "source" || entity?.kind === "channel")) family = entity.kind === "source" ? "fuentes" : "canales";
  else if (family === "tramos" && (entity?.kind === "channel" || entity?.kind === "source")) family = entity.kind === "channel" ? "canales" : "fuentes";
  else if (family === "ventas" && /\b(?:available to sell|disponible para vender)\b/.test(folded)) family = "existencias";
  else if (family === "ventas" && /\b(?:where (?:do )?i sell|donde vendo|por donde)\b/.test(folded)) family = "canales";
  else if (family === "ganancia" && /\b(?:left unsold|quedo sin vender)\b/.test(folded)) family = "nosemueve";

  switch (family) {
    case "capacidades": {
      const text = es
        ? "Puedo responderte, en inglés o español, sobre tu inventario con las cifras de tus tarjetas: existencias (qué tienes, cuánto hay, qué está en camino o en el carro), ventas por tramo (hoy, esta semana, este mes), ganancia y margen con su base, precios (a cuánto se ha vendido algo y qué pedir), lo que no se mueve y cuánto lleva esperando, cuánto capital tienes comprometido, en cuántos días se vende algo, qué volver a comprar, qué fuente, canal, cliente, marca o talla se mueve más, cuánto gastaste en anuncios, cuánto cobraste por envíos, qué le falta a una tarjeta y los hechos de una pieza (su costo, su llegada, su venta). Lo que no puedo hacer también te lo digo con su frontera exacta: tarifas, fecha de publicación, precios de mercado y condición no están en las tarjetas."
        : "I can answer, in English or Spanish, about your inventory with the figures on your cards: stock (what you have, how much, what is on the way or in the car), sales by stretch (today, this week, this month), profit and margin with their base, prices (what something has sold for and what to ask), what is not moving and how long it has sat, how much capital you have committed, how many days something takes to sell, what to buy again, which source, channel, client, brand or size moves most, how much you spent on ads, how much you collected in delivery charges, what a card is missing, and a piece's own facts (its cost, its arrival, its sale). What I cannot do I also tell you, with its exact frontier: fees, listing dates, market prices and condition are not on the cards.";
      return { family, text, pieceIds: [] };
    }

    case "existencias": {
      const place = /\b(carro|car)\b/.test(folded) ? "car" : /\b(casa|home)\b/.test(folded) ? "home" : null;
      let stock = scopedStock;
      if (place) stock = stock.filter((piece) => piece.place === place);
      const onHand = stock.filter((piece) => piece.status === "available");
      const incoming = stock.filter((piece) => piece.status === "incoming");
      const negated = NEGATED_SALE.test(folded);
      const names = [...new Set(stock.map((piece) => piece.name))].slice(0, 4);
      const aged = onHand
        .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null, today) }))
        .filter((row): row is { piece: Piece; days: number } => row.days != null)
        .sort((a, b) => b.days - a.days);
      const head = entity ? `${entity.label}: ` : "";
      const incomingAsk = /\b(en camino|incoming|on (?:its|the) way|on their way|viene en camino|por llegar)\b/.test(folded);
      if (!negated && !place && incomingAsk && incoming.length) {
        const inNames = [...new Set(incoming.map((piece) => piece.name))];
        const text = es
          ? `En camino: ${units(incoming)} unidades (${money(cost(incoming))} al costo): ${inNames.join(", ")}. En inventario tienes ${units(onHand)} (${money(cost(onHand))} al costo).`
          : `On the way: ${units(incoming)} units (${money(cost(incoming))} at cost): ${inNames.join(", ")}. On hand you have ${units(onHand)} (${money(cost(onHand))} at cost).`;
        return { family, text, pieceIds: ids(stock) };
      }
      const text = negated
        ? (es ? `Sin vender todavía: ${units(onHand)} en inventario${incoming.length ? ` y ${units(incoming)} en camino` : ""}. ${aged.length ? `Lo que más lleva esperando es ${aged[0].piece.name} (${aged[0].days} días desde su llegada).` : "Sin fechas de llegada no puedo ordenarlas por espera."} ${names.length ? `En el estante: ${names.join(", ")}.` : ""}`
               : `Not sold yet: ${units(onHand)} on hand${incoming.length ? ` and ${units(incoming)} on the way` : ""}. ${aged.length ? `The longest waiting is ${aged[0].piece.name} (${aged[0].days} days from arrival).` : "With no arrival dates I cannot order them by waiting."} ${names.length ? `On the shelf: ${names.join(", ")}.` : ""}`)
        : (es ? `${head}${units(onHand)} en inventario (${money(cost(onHand))} al costo)${incoming.length ? ` y ${units(incoming)} en camino (${money(cost(incoming))})` : ""}${place ? ` en ${place === "car" ? "el carro" : "casa"}` : ""}. ${names.length ? `Piezas: ${names.join(", ")}.` : "No hay piezas en ese alcance."}`
               : `${head}${units(onHand)} on hand (${money(cost(onHand))} at cost)${incoming.length ? ` and ${units(incoming)} on the way (${money(cost(incoming))})` : ""}${place ? ` in the ${place}` : ""}. ${names.length ? `Pieces: ${names.join(", ")}.` : "No pieces in that scope."}`);
      return { family, text, pieceIds: ids(stock) };
    }

    case "ventas": {
      if (/\b(mejor venta|venta mas grande|best sale|biggest sale|largest sale)\b/.test(folded)) {
        const priced = m.sales.filter((piece) => piece.saleCents != null);
        if (priced.length) {
          const best = priced.reduce((a, b) => ((b.saleCents ?? 0) * b.qty > (a.saleCents ?? 0) * a.qty ? b : a));
          const amount = money((best.saleCents ?? 0) * best.qty);
          const text = es
            ? `Tu mejor venta fue ${best.name}: ${amount}${best.soldOn ? `, el ${fullDate(lang, best.soldOn)}` : " (sin fecha en su tarjeta)"}${best.clientName ? `, a ${best.clientName}` : ""}. Es la venta individual con precio más alta; las ventas sin precio no compiten.`
            : `Your best sale was ${best.name}: ${amount}${best.soldOn ? `, on ${fullDate(lang, best.soldOn)}` : " (no date on its card)"}${best.clientName ? `, to ${best.clientName}` : ""}. It is the highest single priced sale; unpriced sales do not compete.`;
          return { family, text, pieceIds: [best.id] };
        }
      }
      const row = entity ? groupRow(entity.kind === "brand" ? mw.byBrand : entity.kind === "category" ? mw.byCategory : entity.kind === "source" ? mw.bySource : entity.kind === "channel" ? mw.byChannel : entity.kind === "client" ? mw.byClient : entity.kind === "size" ? mw.bySize : mw.byProduct, entity) : null;
      if (!row && entity && scoped.length && !scopedSales.length) return { family, text: noSalesText(entity.label), pieceIds: ids(scoped) };
      if (row) {
        const text = es
          ? `${row.label}: ${row.soldUnits} ${row.soldUnits === 1 ? "unidad vendida" : "unidades vendidas"} ${winName}, ${money(row.revenue)} en ventas con precio (${row.pricedUnits} con precio). ${row.avgDays != null ? `Se venden en unos ${row.avgDays} días.` : "Sin fechas no puedo decir en cuántos días se venden."}`
          : `${row.label}: ${row.soldUnits} units sold ${winName}, ${money(row.revenue)} in priced sales (${row.pricedUnits} priced). ${row.avgDays != null ? `They sell in about ${row.avgDays} days.` : "With no dates I cannot say in how many days they sell."}`;
        return { family, text, pieceIds: ids(scopedSales) };
      }
      const unpricedNote = mw.units.unpriced ? (es ? ` ${mw.units.unpriced} ${mw.units.unpriced === 1 ? "unidad se vendió" : "unidades se vendieron"} sin precio y no entra en el dinero.` : ` ${mw.units.unpriced} unit${mw.units.unpriced === 1 ? "" : "s"} sold with no price and stay${mw.units.unpriced === 1 ? "s" : ""} out of the money.`) : "";
      const text = es
        ? `Vendiste ${mw.units.sold} ${mw.units.sold === 1 ? "unidad" : "unidades"} ${winName}: ${money(mw.revenue)} en ventas con precio.${unpricedNote} Las ventas sin fecha no entran en ningún tramo.`
        : `You sold ${mw.units.sold} unit${mw.units.sold === 1 ? "" : "s"} ${winName}: ${money(mw.revenue)} in priced sales.${unpricedNote} Sales with no date enter no stretch.`;
      return { family, text, pieceIds: ids(mw.sales) };
    }

    case "ganancia": {
      const costless = mw.sales.filter((piece) => piece.saleCents != null && piece.costCents <= 0);
      const costlessRevenue = costless.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
      const known = mw.sales.filter((piece) => piece.saleCents != null && piece.costCents > 0);
      const knownRevenue = known.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
      const knownProfit = known.reduce((sum, piece) => sum + ((piece.saleCents ?? 0) - Math.max(0, piece.costCents - piece.buyRebateCents)) * piece.qty, 0);
      const margin = knownRevenue > 0 ? pct(knownProfit / knownRevenue) : "—";
      const row = entity ? groupRow(entity.kind === "brand" ? mw.byBrand : entity.kind === "category" ? mw.byCategory : entity.kind === "source" ? mw.bySource : entity.kind === "channel" ? mw.byChannel : entity.kind === "client" ? mw.byClient : mw.byProduct, entity) : null;
      if (row) {
        const text = es
          ? `${row.label}: ganancia de ${money(row.profit)} sobre ${money(row.revenue)} en ventas con precio${row.margin != null ? `, un margen de ${pct(row.margin)}` : ", sin margen calculable: falta el costo en alguna tarjeta"}. La base son ${row.pricedUnits} unidades con precio.`
          : `${row.label}: profit of ${money(row.profit)} over ${money(row.revenue)} in priced sales${row.margin != null ? `, a margin of ${pct(row.margin)}` : ", no margin to compute: a card is missing its cost"}. The base is ${row.pricedUnits} priced units.`;
        return { family, text, pieceIds: ids(scopedSales) };
      }
      if (entity && scoped.length && !scopedSales.length) return { family, text: noSalesText(entity.label), pieceIds: ids(scoped) };
      if (/\b(anuncios?|ads?)\b/.test(folded)) {
        const net = mw.profit - m.adSpend;
        const text = es
          ? `Ya quitando los anuncios: la ganancia según las tarjetas ${winName} es ${money(mw.profit)}; los anuncios suman ${money(m.adSpend)}, así que lo que queda es ${money(net)}. Las tarifas de venta siguen fuera: no están en ninguna tarjeta.`
          : `After ads are taken out: profit by the cards ${winName} is ${money(mw.profit)}; ads add up to ${money(m.adSpend)}, so what stays is ${money(net)}. Selling fees are still out: they are on no card.`;
        return { family, text, pieceIds: ids(mw.sales) };
      }
      const text = es
        ? `Ganancia según las tarjetas ${winName}: ${money(mw.profit)}, sobre ${money(mw.revenue)} en ventas con precio. El margen es ${margin}, calculado solo sobre las ${units(known)} unidades vendidas con costo en su tarjeta (${money(knownRevenue)}).${costless.length ? ` ${costless.map((piece) => piece.name).join(", ")} se vendió sin costo en su tarjeta: sus ${money(costlessRevenue)} cuentan como entrada, pero su ganancia real es desconocida y no entra en el margen.` : ""}${mw.units.unpriced ? ` Y ${mw.units.unpriced} unidad sin precio no entra en ninguna de estas cifras.` : ""}`
        : `Profit by the cards ${winName}: ${money(mw.profit)}, over ${money(mw.revenue)} in priced sales. The margin is ${margin}, computed only over the ${units(known)} sold units with a cost on their card (${money(knownRevenue)}).${costless.length ? ` ${costless.map((piece) => piece.name).join(", ")} sold with no cost on its card: its ${money(costlessRevenue)} counts as money in, but its real profit is unknown and stays out of the margin.` : ""}${mw.units.unpriced ? ` And ${mw.units.unpriced} unpriced unit enters none of these figures.` : ""}`;
      return { family, text, pieceIds: ids(mw.sales) };
    }

    case "envios": {
      const pool = entity ? scopedSales : m.sales;
      const charged = pool.filter((piece) => piece.deliveryCents > 0);
      const total = charged.reduce((sum, piece) => sum + piece.deliveryCents * piece.qty, 0);
      if (charged.length && /\b(quien|who)\b/.test(folded)) {
        const text = es
          ? `Pagó envío: ${charged.map((piece) => `${piece.clientName ? `${piece.clientName} ` : ""}(${piece.name}, ${money(piece.deliveryCents * piece.qty)})`).join(", ")}. En total cobraste ${money(total)} por envíos.`
          : `Delivery was paid by: ${charged.map((piece) => `${piece.clientName ? `${piece.clientName} ` : ""}(${piece.name}, ${money(piece.deliveryCents * piece.qty)})`).join(", ")}. In total you collected ${money(total)} in delivery charges.`;
        return { family, text, pieceIds: ids(charged) };
      }
      if (entity && charged.length && /\b(total|con envio|incluid\w*|included)\b/.test(folded)) {
        const parts = charged.map((piece) => {
          const price = (piece.saleCents ?? 0) * piece.qty;
          const del = piece.deliveryCents * piece.qty;
          return es ? `${piece.name}: ${money(price)} de precio + ${money(del)} de envío = ${money(price + del)} cobrados` : `${piece.name}: ${money(price)} price + ${money(del)} delivery = ${money(price + del)} collected`;
        });
        const text = es
          ? `Por ${entity.label}, con envío: ${parts.join("; ")}. El envío se suma a lo cobrado, no a la ganancia.`
          : `For ${entity.label}, delivery included: ${parts.join("; ")}. Delivery adds to what was collected, not to profit.`;
        return { family, text, pieceIds: ids(charged) };
      }
      const text = charged.length
        ? (es ? `Cobraste ${money(total)} por envíos, en ${charged.length} ${charged.length === 1 ? "venta que lo cobró" : "ventas que lo cobraron"}: ${charged.map((piece) => `${piece.name} (${money(piece.deliveryCents * piece.qty)})`).join(", ")}. El envío es dinero cobrado aparte del precio: se suma a lo cobrado, no a la ganancia.`
               : `You collected ${money(total)} in delivery charges, on ${charged.length} sale${charged.length === 1 ? "" : "s"} that charged it: ${charged.map((piece) => `${piece.name} (${money(piece.deliveryCents * piece.qty)})`).join(", ")}. Delivery is money collected apart from the price: it adds to what was collected, not to profit.`)
        : (es ? "Ninguna venta trae cobro de envío en su tarjeta: lo cobrado por envíos es $0.00 según las tarjetas." : "No sale carries a delivery charge on its card: delivery collected is $0.00 by the cards.");
      return { family, text, pieceIds: ids(charged) };
    }

    case "precios": {
      const priceRows = priceList(pieces, lang);
      // A price question aimed at one thing is answered from that thing's
      // own evidence first: what it asks today, what buyers have paid,
      // and the cut its own waiting has earned.
      if (entity) {
        const move = moveList(pieces, today, lang).find((g) => fold(g.product) === fold(entity.label) || fold(g.product).split(" ")[0] === (headWord ?? ""));
        const prowE = priceRows.find((row) => fold(row.product) === fold(entity.label) || fold(row.product).split(" ")[0] === (headWord ?? ""));
        const growE = groupRow(mw.byProduct, entity) ?? groupRow(mw.byBrand, entity) ?? groupRow(mw.byCategory, entity);
        const asks = [...new Set(scopedStock.filter((piece) => piece.askCents > 0).map((piece) => piece.askCents))];
        if (asks.length || prowE || move || (growE && growE.avgSale != null)) {
          const askPart = asks.length
            ? (es ? `hoy pides ${asks.map((a) => money(a)).join(", ")} por lo que queda` : `today you ask ${asks.map((a) => money(a)).join(", ")} for what is left`)
            : (es ? "lo que queda no tiene precio pedido" : "what is left has no asking price");
          const paidPart = prowE
            ? (es ? `los compradores pagaron entre ${money(prowE.low)} y ${money(prowE.high)} (mediana ${money(prowE.median)}, ${prowE.sales} ventas con precio)` : `buyers paid between ${money(prowE.low)} and ${money(prowE.high)} (median ${money(prowE.median)}, ${prowE.sales} priced sales)`)
            : growE && growE.avgSale != null
              ? (es ? `se ha vendido a ${money(growE.avgSale)} en promedio (${growE.pricedUnits} con precio)` : `it has sold at ${money(growE.avgSale)} on average (${growE.pricedUnits} priced)`)
              : (es ? "todavía no se ha vendido con precio, así que no hay rango de lo pagado" : "it has not sold at a price yet, so there is no paid range");
          const movePart = move
            ? (move.cut != null
              ? (es ? ` Lleva ${move.oldest} días esperando, pasado su tiempo usual: la rebaja con evidencia es a ${money(move.cut)}, sobre su piso de ${money(move.floor)} (su costo neto).` : ` It has waited ${move.oldest} days, past its usual time: the cut with evidence is to ${money(move.cut)}, above its floor of ${money(move.floor)} (its net cost).`)
              : (es ? ` Lleva ${move.oldest} días esperando y aún no tiene precio: antes de rebajar hay que pedírselo, y su piso es ${money(move.floor)} (su costo neto).` : ` It has waited ${move.oldest} days and still has no price: before any cut it needs one, and its floor is ${money(move.floor)} (its net cost).`))
            : "";
          const text = es ? `${entity.label}: ${askPart}; ${paidPart}.${movePart}` : `${entity.label}: ${askPart}; ${paidPart}.${movePart}`;
          return { family, text, pieceIds: ids(scoped) };
        }
      }
      const prow = entity ? priceRows.find((row) => fold(row.product) === fold(entity.label) || fold(row.product).split(" ")[0] === (headWord ?? "")) : null;
      if (prow) {
        const text = es
          ? `${prow.product}: los compradores pagaron entre ${money(prow.low)} y ${money(prow.high)} (mediana ${money(prow.median)}, ${prow.sales} ventas con precio). Hoy pides ${prow.asks.length ? prow.asks.map((a) => money(a)).join(", ") : "sin precio"} por las ${prow.stock} que quedan. Con esa evidencia, ${money(prow.suggest)} es un precio con base; no es el mercado, es tu propio historial.`
          : `${prow.product}: buyers paid between ${money(prow.low)} and ${money(prow.high)} (median ${money(prow.median)}, ${prow.sales} priced sales). Today you ask ${prow.asks.length ? prow.asks.map((a) => money(a)).join(", ") : "no price"} for the ${prow.stock} left. On that evidence, ${money(prow.suggest)} is a price with a base; it is not the market, it is your own history.`;
        return { family, text, pieceIds: ids(scoped) };
      }
      const row = entity ? groupRow(mw.byProduct, entity) ?? groupRow(mw.byBrand, entity) ?? groupRow(mw.byCategory, entity) : null;
      if (row && row.avgSale != null) {
        const asks = scopedStock.filter((piece) => piece.askCents > 0).map((piece) => piece.askCents);
        const text = es
          ? `${row.label}: se ha vendido a ${money(row.avgSale)} en promedio (${row.pricedUnits} con precio). ${asks.length ? `Hoy pides ${[...new Set(asks)].map((a) => money(a)).join(", ")} por lo que queda.` : "Lo que queda no tiene precio pedido."} Es evidencia de ${row.soldUnits} ${row.soldUnits === 1 ? "venta" : "ventas"}, no un patrón cerrado.`
          : `${row.label}: it has sold at ${money(row.avgSale)} on average (${row.pricedUnits} priced). ${asks.length ? `Today you ask ${[...new Set(asks)].map((a) => money(a)).join(", ")} for what is left.` : "What is left has no asking price."} That is evidence from ${row.soldUnits} sale${row.soldUnits === 1 ? "" : "s"}, not a closed pattern.`;
        return { family, text, pieceIds: ids(scoped) };
      }
      const below = m.stock.filter((piece) => piece.askCents > 0 && piece.askCents < Math.max(0, piece.costCents - piece.buyRebateCents));
      const text = es
        ? `El inventario pide ${money(m.stockAsk)} en total por las piezas con precio; ${m.unaskedUnits} unidades no tienen precio pedido. ${below.length ? `Por debajo de su costo: ${below.map((piece) => `${piece.name} (pide ${money(piece.askCents)}, costó ${money(piece.costCents)})`).join(", ")}.` : "Ninguna pieza con precio pide por debajo de su costo."} Las rebajas ya hechas suman ${money(m.priceCuts)} (lo pedido menos lo cobrado, solo en ventas con ambos números).`
        : `Stock asks ${money(m.stockAsk)} in total over the pieces with a price; ${m.unaskedUnits} units have no asking price. ${below.length ? `Below their cost: ${below.map((piece) => `${piece.name} (asks ${money(piece.askCents)}, cost ${money(piece.costCents)})`).join(", ")}.` : "No priced piece asks below its cost."} Price cuts already taken add up to ${money(m.priceCuts)} (asked minus charged, only on sales with both numbers).`;
      return { family, text, pieceIds: ids(m.stock) };
    }

    case "nosemueve": {
      const move = moveList(pieces, today, lang);
      const oldest = m.aging.oldest;
      const top = oldest[0];
      const moveText = move.length ? (es ? ` Pasado su tiempo usual de venta: ${move.map((g) => `${g.product} (${g.oldest} días, ${money(g.cost)} al costo${g.cut != null ? `; una rebaja a ${money(g.cut)} lo dejaría sobre su piso de ${money(g.floor)}` : ""})`).join("; ")}.` : ` Past their usual selling time: ${move.map((g) => `${g.product} (${g.oldest} days, ${money(g.cost)} at cost${g.cut != null ? `; a cut to ${money(g.cut)} would keep it above its floor of ${money(g.floor)}` : ""})`).join("; ")}.`) : "";
      const text = top
        ? (es ? `Lo que más lleva esperando es ${top.piece.name}: ${top.days} días desde su llegada, ${money(top.piece.costCents * top.piece.qty)} al costo. Por cubetas: ${m.aging.buckets.filter((b) => b.units).map((b) => `${b.units} en ${b.label}`).join(", ")}${m.aging.undated ? `, y ${m.aging.undated} sin fecha de llegada, que no se pueden ordenar` : ""}.${moveText} El reloj es la fecha de llegada, no una de publicación.`
             : `${top.piece.name} has waited the longest: ${top.days} days from arrival, ${money(top.piece.costCents * top.piece.qty)} at cost. By bucket: ${m.aging.buckets.filter((b) => b.units).map((b) => `${b.units} in ${b.label}`).join(", ")}${m.aging.undated ? `, and ${m.aging.undated} with no arrival date, which cannot be ordered` : ""}.${moveText} The clock is the arrival date, not a listing date.`)
        : (es ? "Ninguna pieza en inventario tiene fecha de llegada, así que no puedo decir qué lleva más tiempo: sin fecha no hay antigüedad honesta." : "No on-hand piece has an arrival date, so I cannot say what has sat longest: with no date there is no honest aging.");
      return { family, text, pieceIds: ids(oldest.map((row) => row.piece)) };
    }

    case "capital": {
      if (entity && scopedStock.length) {
        const scopedIncoming = scopedStock.filter((piece) => piece.status === "incoming");
        const text = es
          ? `${entity.label}: tienes ${money(cost(scopedStock))} al costo en ese alcance: ${units(scopedStock)} unidades${scopedIncoming.length ? ` (${units(scopedStock) - units(scopedIncoming)} en inventario y ${units(scopedIncoming)} en camino)` : " en inventario"}. Es capital comprometido en esa parte del piso; el total de la casa es ${money(m.stockCost)} al costo.`
          : `${entity.label}: you have ${money(cost(scopedStock))} at cost in that scope: ${units(scopedStock)} units${scopedIncoming.length ? ` (${units(scopedStock) - units(scopedIncoming)} on hand and ${units(scopedIncoming)} on the way)` : " on hand"}. It is capital committed in that part of the floor; the house total is ${money(m.stockCost)} at cost.`;
        return { family, text, pieceIds: ids(scopedStock) };
      }
      const text = es
        ? `Tienes ${money(m.stockCost)} en inventario al costo: ${money(m.onHandCost)} en mano (${m.units.onHand} unidades) y ${money(m.incomingCost)} en camino (${m.units.incoming} unidades). Es capital comprometido, no ventas: no se perdió, pero no trabaja en otro lugar hasta que las piezas se vendan.`
        : `You have ${money(m.stockCost)} in stock at cost: ${money(m.onHandCost)} on hand (${m.units.onHand} units) and ${money(m.incomingCost)} on the way (${m.units.incoming} units). It is committed capital, not sales: not lost, but it cannot work anywhere else until the pieces sell.`;
      return { family, text, pieceIds: ids(m.stock) };
    }

    case "rotacion": {
      // "Which piece sold fastest / took the longest" names the pieces,
      // not just the day counts.
      const perPiece = pieces.filter(isSale).map((piece) => ({ piece, days: daysHeld(piece.receivedOn, piece.soldOn, today) })).filter((r): r is { piece: Piece; days: number } => r.days != null);
      if (!entity && perPiece.length && /\b(que pieza|which piece|venta mas rapida|fastest sale|sold (?:the )?fastest|se vendio mas rapido|tardo mas|took (?:the )?longest|slowest|mas lenta)\b/.test(folded)) {
        const fastest = perPiece.reduce((a, b) => (b.days < a.days ? b : a));
        const slowest = perPiece.reduce((a, b) => (b.days > a.days ? b : a));
        const text = es
          ? `La venta más rápida fue ${fastest.piece.name}: ${fastest.days} días de llegada a venta. La más lenta, ${slowest.piece.name}: ${slowest.days} días. En general una pieza se vende en unos ${m.days.avg ?? "—"} días (mediana ${m.days.median ?? "—"}).`
          : `The fastest sale was ${fastest.piece.name}: ${fastest.days} days from arrival to sale. The slowest, ${slowest.piece.name}: ${slowest.days} days. Overall a piece sells in about ${m.days.avg ?? "—"} days (median ${m.days.median ?? "—"}).`;
        return { family, text, pieceIds: [fastest.piece.id, slowest.piece.id] };
      }
      const days = scopedSales.map((piece) => daysHeld(piece.receivedOn, piece.soldOn, today)).filter((d): d is number => d != null);
      if (entity || headWord) {
        if (!days.length) return { family, text: es ? `De ${entity?.label ?? ""} no hay ventas con las dos fechas, así que no puedo decir en cuántos días se vende: faltan fechas, no velocidad.` : `There are no sales of ${entity?.label ?? ""} with both dates, so I cannot say in how many days it sells: dates are missing, not speed.`, pieceIds: ids(scopedSales) };
        const avg = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
        const text = es
          ? `${entity?.label ?? ""}: se vende en unos ${avg} días (promedio de ${days.length} ${days.length === 1 ? "venta con las dos fechas" : "ventas con las dos fechas"}; la más rápida en ${Math.min(...days)}, la más lenta en ${Math.max(...days)}).`
          : `${entity?.label ?? ""}: it sells in about ${avg} days (average of ${days.length} sale${days.length === 1 ? "" : "s"} with both dates; fastest ${Math.min(...days)}, slowest ${Math.max(...days)}).`;
        return { family, text, pieceIds: ids(scopedSales) };
      }
      const text = es
        ? `En general: una pieza se vende en unos ${m.days.avg ?? "—"} días (mediana ${m.days.median ?? "—"}, sobre ${m.days.n} ventas con las dos fechas; la más rápida en ${m.days.fastest ?? "—"}, la más lenta en ${m.days.slowest ?? "—"}). La rotación es ${pct(m.sellThrough)}: de cada 100 piezas que han pasado por tus manos, ${m.sellThrough != null ? Math.round(m.sellThrough * 100) : "—"} se vendieron. Las ventas sin fecha no entran en los días.`
        : `Overall: a piece sells in about ${m.days.avg ?? "—"} days (median ${m.days.median ?? "—"}, over ${m.days.n} sales with both dates; fastest ${m.days.fastest ?? "—"}, slowest ${m.days.slowest ?? "—"}). Sell-through is ${pct(m.sellThrough)}: of every 100 pieces that passed through your hands, ${m.sellThrough != null ? Math.round(m.sellThrough * 100) : "—"} sold. Sales with no date enter no day count.`;
      return { family, text, pieceIds: ids(m.sales) };
    }

    case "reposicion": {
      const rows = restockList(pieces, today, lang);
      if (!rows.length) return { family, text: es ? "Todavía nada se ha vendido dos veces, así que no hay reposición con evidencia: una sola venta es una lección, no un patrón. Cuando un producto se venda por segunda vez, aquí aparecerá con su ritmo." : "Nothing has sold twice yet, so there is no restock with evidence: one sale is a lesson, not a pattern. When a product sells a second time it will appear here with its pace.", pieceIds: [] };
      const top = rows.slice(0, 3).map((row) => es
        ? `${row.product}: vendido ${row.sold} veces${row.size ? `, su talla que más sale es ${row.size}` : ""}, quedan ${row.left}${row.weeksLeft != null ? ` (a su ritmo de los últimos 90 días, unas ${row.weeksLeft} semanas)` : ""}${row.profitEach != null ? `, y deja unos ${money(row.profitEach)} por pieza` : ""}`
        : `${row.product}: sold ${row.sold} times${row.size ? `, its best-selling size is ${row.size}` : ""}, ${row.left} left${row.weeksLeft != null ? ` (at its pace of the last 90 days, about ${row.weeksLeft} weeks)` : ""}${row.profitEach != null ? `, and leaves about ${money(row.profitEach)} per piece` : ""}`);
      const text = (es ? `Lo que ya se ganó una segunda compra, por evidencia: ${top.join("; ")}. El ritmo es lo observado, no una promesa.` : `What has already earned a second buy, on evidence: ${top.join("; ")}. The pace is what was observed, not a promise.`);
      return { family, text, pieceIds: [] };
    }

    case "fuentes": case "canales": case "clientes": case "marcas": case "tallas": {
      // "Who bought this?" is answered from the piece's own sales, not
      // from the client ranking.
      if (family === "clientes" && entity && entity.kind !== "client" && scopedSales.length) {
        const named = scopedSales.filter((piece) => piece.clientName);
        if (named.length) {
          const text = named.map((piece) => es
            ? `${piece.clientName} compró ${piece.name}${piece.saleCents != null ? ` por ${money(piece.saleCents * piece.qty)}` : " sin precio en su tarjeta"}${piece.soldOn ? ` el ${fullDate(lang, piece.soldOn)}` : ""}`
            : `${piece.clientName} bought ${piece.name}${piece.saleCents != null ? ` for ${money(piece.saleCents * piece.qty)}` : " with no price on its card"}${piece.soldOn ? ` on ${fullDate(lang, piece.soldOn)}` : ""}`).join(". ") + ".";
          return { family, text, pieceIds: ids(named) };
        }
      }
      // A named client's own purchases: what they took, for how much,
      // and the total — not the ranking.
      if (family === "clientes" && entity?.kind === "client") {
        const bought = scopedSales;
        if (!bought.length) return { family, text: es ? `${entity.label} no tiene compras en las tarjetas: nadie con ese nombre ha comprado todavía.` : `${entity.label} has no purchases on the cards: no one by that name has bought yet.`, pieceIds: [] };
        const total = bought.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
        const list = bought.map((piece) => es
          ? `${piece.name}${piece.saleCents != null ? ` por ${money(piece.saleCents * piece.qty)}` : " sin precio"}${piece.soldOn ? ` el ${fullDate(lang, piece.soldOn)}` : ""}`
          : `${piece.name}${piece.saleCents != null ? ` for ${money(piece.saleCents * piece.qty)}` : " with no price"}${piece.soldOn ? ` on ${fullDate(lang, piece.soldOn)}` : ""}`).join("; ");
        const text = es
          ? `${entity.label} te ha comprado ${bought.length} ${bought.length === 1 ? "vez" : "veces"}: ${list}. En total, ${money(total)} en ventas con precio.`
          : `${entity.label} has bought from you ${bought.length} time${bought.length === 1 ? "" : "s"}: ${list}. In total, ${money(total)} in priced sales.`;
        return { family, text, pieceIds: ids(bought) };
      }
      // A thing asked through a dimension ("¿por qué canal se vendió la
      // cartera?") is answered from that thing's own sales.
      if ((family === "canales" || family === "fuentes") && entity && entity.kind !== "channel" && entity.kind !== "source" && scopedSales.length) {
        const keyOf = (piece: Piece) => (family === "canales" ? piece.channel : piece.source);
        const byKey = new Map<string, { units: number; revenue: number }>();
        for (const piece of scopedSales) {
          const key = keyOf(piece);
          if (!key) continue;
          const cur = byKey.get(key) ?? { units: 0, revenue: 0 };
          cur.units += piece.qty;
          cur.revenue += (piece.saleCents ?? 0) * piece.qty;
          byKey.set(key, cur);
        }
        if (byKey.size) {
          const parts = [...byKey.entries()].map(([key, v]) => es ? `${key} (${v.units} ${v.units === 1 ? "unidad" : "unidades"}, ${money(v.revenue)})` : `${key} (${v.units} unit${v.units === 1 ? "" : "s"}, ${money(v.revenue)})`).join(", ");
          const text = es
            ? `${entity.label} se vendió por: ${parts}. Es la evidencia de sus propias ventas, no la clasificación del ${family === "canales" ? "canal" : "fuente"}.`
            : `${entity.label} sold through: ${parts}. That is the evidence of its own sales, not the ${family === "canales" ? "channel" : "source"} ranking.`;
          return { family, text, pieceIds: ids(scopedSales) };
        }
      }
      // A cross question — the source of what sold through one channel,
      // the channel of what came from one source — is answered from
      // the named member's own sales, grouped by the asked dimension.
      if ((family === "fuentes" && entity?.kind === "channel") || (family === "canales" && entity?.kind === "source")) {
        if (scopedSales.length) {
          const keyOf = (piece: Piece) => (family === "fuentes" ? piece.source : piece.channel);
          const byKey = new Map<string, { units: number; revenue: number }>();
          for (const piece of scopedSales) {
            const key = keyOf(piece);
            if (!key) continue;
            const cur = byKey.get(key) ?? { units: 0, revenue: 0 };
            cur.units += piece.qty;
            cur.revenue += (piece.saleCents ?? 0) * piece.qty;
            byKey.set(key, cur);
          }
          if (byKey.size) {
            const parts = [...byKey.entries()].map(([key, v]) => es ? `${key} (${v.units} ${v.units === 1 ? "unidad" : "unidades"}, ${money(v.revenue)})` : `${key} (${v.units} unit${v.units === 1 ? "" : "s"}, ${money(v.revenue)})`).join(", ");
            const text = es
              ? `Lo vendido por ${entity.label} vino de: ${parts}. Es la evidencia de esas ventas, no la clasificación completa.`
              : `What sold through ${entity.label} came from: ${parts}. That is the evidence of those sales, not the full ranking.`;
            return { family, text, pieceIds: ids(scopedSales) };
          }
        }
      }
      const rows = family === "fuentes" ? m.bySource : family === "canales" ? m.byChannel : family === "clientes" ? m.byClient : family === "tallas" ? m.bySize : (entity?.kind === "category" || /\b(categoria|category|categorias)\b/.test(folded) ? m.byCategory : m.byBrand);
      // "Which member has sold nothing" names the zero-sale members:
      // they are on the floor but in no sale.
      if (/\b(no ha vendido|no han vendido|no vendio|no he vendido|hasn'?t sold|has not sold|have not sold|sin vender nada|nothing sold)\b/.test(folded)) {
        const keyOfAll = family === "fuentes" ? (p: Piece) => p.source : family === "canales" ? (p: Piece) => p.channel : family === "clientes" ? (p: Piece) => p.clientName : family === "tallas" ? (p: Piece) => sizeName(p) : family === "marcas" && /\b(categoria|category|categorias)\b/.test(folded) ? (p: Piece) => p.category : (p: Piece) => p.brand;
        const allKeys = [...new Set(pieces.map((p) => keyOfAll(p)).filter(Boolean))];
        const zero = allKeys.filter((k) => !rows.some((r) => fold(r.label) === fold(k) && r.soldUnits > 0));
        if (zero.length) {
          const text = es
            ? `Sin vender nada todavía: ${zero.join(", ")}. Están en el piso, pero ninguna venta suya está en las tarjetas.`
            : `Nothing sold yet: ${zero.join(", ")}. They are on the floor, but no sale of theirs is on the cards.`;
          return { family, text, pieceIds: [] };
        }
      }
      // A member asked for its stock ("what do I have left from the
      // Nike store") is answered with its own pieces, not the ranking.
      if (entity && (entity.kind === "source" || entity.kind === "channel" || entity.kind === "brand") && /\b(stock|queda|quedan|left|tengo|tiene|inventario|inventory|on hand|in stock)\b/.test(folded) && scopedStock.length) {
        const text = es
          ? `De ${entity.label} tienes en inventario: ${[...new Set(scopedStock.map((p) => p.name))].join(", ")}: ${units(scopedStock)} unidades (${money(cost(scopedStock))} al costo).`
          : `From ${entity.label} you have in stock: ${[...new Set(scopedStock.map((p) => p.name))].join(", ")}: ${units(scopedStock)} units (${money(cost(scopedStock))} at cost).`;
        return { family, text, pieceIds: ids(scopedStock) };
      }
      // Sizes asked through one product or category rank inside that
      // scope, and name the size in both systems the card carries.
      if (family === "tallas" && entity && entity.kind !== "size") {
        const stockFrame = /\b(tienen|quedan|queda|still have|left|tengo|in stock)\b/.test(folded);
        const pool = stockFrame ? scopedStock : scopedSales;
        if (pool.length) {
          const bySizeMap = new Map<string, { units: number; revenue: number; label: string }>();
          for (const piece of pool) {
            const name = sizeName(piece);
            if (!name) continue;
            const lbl = piece.sizeLabel && !name.includes(piece.sizeLabel) ? `${name} (${piece.sizeLabel})` : name;
            const cur = bySizeMap.get(name) ?? { units: 0, revenue: 0, label: lbl };
            cur.units += piece.qty;
            cur.revenue += (piece.saleCents ?? 0) * piece.qty;
            bySizeMap.set(name, cur);
          }
          const ranked = [...bySizeMap.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue);
          if (ranked.length) {
            const text = stockFrame
              ? (es ? `De ${entity.label} te quedan tallas: ${ranked.map((r) => `${r.label} (${r.units} ${r.units === 1 ? "unidad" : "unidades"})`).join(", ")}.` : `In ${entity.label} you still have sizes: ${ranked.map((r) => `${r.label} (${r.units} unit${r.units === 1 ? "" : "s"})`).join(", ")}.`)
              : (es ? `De ${entity.label}, la talla que más sale es ${ranked[0].label}: ${ranked[0].units} ${ranked[0].units === 1 ? "unidad vendida" : "unidades vendidas"} por ${money(ranked[0].revenue)}.` : `For ${entity.label}, the size that moves most is ${ranked[0].label}: ${ranked[0].units} unit${ranked[0].units === 1 ? "" : "s"} sold for ${money(ranked[0].revenue)}.`);
            return { family, text, pieceIds: ids(pool) };
          }
        }
      }
      // "Where does my best-selling brand come from" is answered from
      // that brand's own cards: its source, named.
      if (family === "fuentes" && /\b(best-selling brand|best selling brand|marca (?:mas vendida|que mas vende))\b/.test(folded)) {
        const topBrand = [...m.byBrand].sort((a, b) => b.revenue - a.revenue)[0];
        if (topBrand) {
          const brandPieces = pieces.filter((p) => fold(p.brand) === fold(topBrand.label));
          const srcs = [...new Set(brandPieces.map((p) => p.source).filter(Boolean))];
          const text = es
            ? `Tu marca que más vende es ${topBrand.label} (${money(topBrand.revenue)} en ventas con precio), y viene de: ${srcs.join(", ")}. Es la fuente escrita en sus tarjetas, no una procedencia inventada.`
            : `Your best-selling brand is ${topBrand.label} (${money(topBrand.revenue)} in priced sales), and it comes from: ${srcs.join(", ")}. That is the source written on its cards, not invented provenance.`;
          return { family, text, pieceIds: ids(brandPieces) };
        }
      }
      const row = entity ? groupRow(rows, entity) : null;
      const label = family === "fuentes" ? (es ? "fuente" : "source") : family === "canales" ? (es ? "canal" : "channel") : family === "clientes" ? (es ? "cliente" : "client") : family === "tallas" ? (es ? "talla" : "size") : (es ? "marca" : "brand");
      // Two members named against each other ("WhatsApp versus in
      // person") are answered with both members' figures.
      const present = rows.filter((r) => folded.includes(fold(r.label)) || (fold(r.label) === "in person" && /\ben persona\b/.test(folded)));
      if (present.length >= 2 && /\b(compar\w*|versus|vs| o | or | y | and )\b/.test(folded)) {
        const parts = present.map((r) => es ? `${r.label}: ${r.soldUnits} unidades, ${money(r.revenue)}` : `${r.label}: ${r.soldUnits} units, ${money(r.revenue)}`);
        const text = es
          ? `Comparando por ${label}: ${parts.join("; ")}. Es lo vendido en las tarjetas; lo que no se ha vendido no clasifica.`
          : `Comparing by ${label}: ${parts.join("; ")}. That is what sold on the cards; what has not sold does not rank.`;
        return { family, text, pieceIds: [] };
      }
      if (row) {
        const text = es
          ? `${row.label}: ${row.soldUnits} unidades vendidas por ${money(row.revenue)}${row.avgDays != null ? `, en unos ${row.avgDays} días` : ""}, y quedan ${row.stockUnits} en inventario (${money(row.stockCost)} al costo).`
          : `${row.label}: ${row.soldUnits} units sold for ${money(row.revenue)}${row.avgDays != null ? `, in about ${row.avgDays} days` : ""}, and ${row.stockUnits} left in stock (${money(row.stockCost)} at cost).`;
        return { family, text, pieceIds: [] };
      }
      // A profit question over a dimension ranks by profit, not revenue:
      // the two leaders are not always the same. "Deja más dinero"
      // without the profit word reads as money in — revenue.
      const profitAsk = /\b(ganancia|profit|margen|margin|gana|earn)\b/.test(folded);
      const sold = rows.filter((r) => r.soldUnits > 0).sort((a, b) => (profitAsk ? b.profit - a.profit : b.revenue - a.revenue) || b.soldUnits - a.soldUnits);
      if (!sold.length) return { family, text: es ? `Todavía no hay ventas con ${label} en la tarjeta, así que no hay clasificación honesta: sin ventas, esto sería procedencia, no ranking.` : `There are no sales with a ${label} on the card yet, so there is no honest ranking: with no sales this would be provenance, not a ranking.`, pieceIds: [] };
      const top = sold[0];
      const text = profitAsk
        ? (es
          ? `Por ${label}, en ganancia manda ${top.label}: ${money(top.profit)} de ganancia sobre ${money(top.revenue)} en ventas con precio (${top.soldUnits} unidades). Le siguen ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.profit)})`).join(", ") || "nadie más con ventas"}. La ganancia es según las tarjetas: las ventas sin costo no dan ganancia calculable.`
          : `By ${label}, on profit ${top.label} leads: ${money(top.profit)} of profit over ${money(top.revenue)} in priced sales (${top.soldUnits} units). Next: ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.profit)})`).join(", ") || "no one else with sales"}. Profit is by the cards: sales with no cost give no computable profit.`)
        : (es
          ? `Por ${label}, manda ${top.label}: ${top.soldUnits} unidades vendidas por ${money(top.revenue)}${top.avgDays != null ? `, en unos ${top.avgDays} días` : ""}. Le siguen ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.revenue)})`).join(", ") || "nadie más con ventas"}. La clasificación es solo sobre lo vendido; lo que no se ha vendido no clasifica.`
          : `By ${label}, ${top.label} leads: ${top.soldUnits} units sold for ${money(top.revenue)}${top.avgDays != null ? `, in about ${top.avgDays} days` : ""}. Next: ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.revenue)})`).join(", ") || "no one else with sales"}. The ranking is over what sold only; what has not sold does not rank.`);
      return { family, text, pieceIds: [] };
    }

    case "tramos": {
      // Two months named in one question are compared by name, with
      // the difference — not folded into this-vs-last.
      const monthIdxs = [...new Set(MONTH_WORDS.map((w, i) => ({ w, i: i % 12 })).filter(({ w }) => new RegExp(`\\b${w}\\b`).test(folded)).map(({ i }) => i))]
        .sort((x, y) => folded.indexOf(MONTH_WORDS.find((w, i) => i % 12 === x && new RegExp(`\\b${w}\\b`).test(folded))!) - folded.indexOf(MONTH_WORDS.find((w, i) => i % 12 === y && new RegExp(`\\b${w}\\b`).test(folded))!));
      if (monthIdxs.length >= 2) {
        const [a, b] = monthIdxs.slice(0, 2).map((i) => {
          let year = todayD.getFullYear();
          if (i > todayD.getMonth()) year -= 1;
          const mm = measure(pieces, ads, { lang, today, from: isoOf(new Date(year, i, 1)), to: isoOf(new Date(year, i + 1, 0)) });
          const name = new Intl.DateTimeFormat(es ? "es" : "en-US", { month: "long", year: "numeric" }).format(new Date(year, i, 15));
          return { name, revenue: mm.revenue, units: mm.units.sold };
        });
        const winner = a.revenue === b.revenue ? null : a.revenue > b.revenue ? a : b;
        const text = es
          ? `${a.name}: ${a.units} unidades vendidas, ${money(a.revenue)} en ventas con precio. ${b.name}: ${b.units} unidades, ${money(b.revenue)}. La diferencia en ventas es ${money(Math.abs(a.revenue - b.revenue))}${winner ? `, a favor de ${winner.name}` : ""}. Solo entran ventas con fecha; las sin fecha quedan fuera de los dos meses.`
          : `${a.name}: ${a.units} units sold, ${money(a.revenue)} in priced sales. ${b.name}: ${b.units} units, ${money(b.revenue)}. The sales difference is ${money(Math.abs(a.revenue - b.revenue))}${winner ? `, in favor of ${winner.name}` : ""}. Only dated sales enter; undated ones stay out of both months.`;
        return { family, text, pieceIds: [] };
      }
      // "Which month was best" ranks the dated months; it is not the
      // this-vs-last comparison.
      if (/\b(mejor mes|best month)\b/.test(folded) || (/\b(?:que mes|cual mes|which month)\b/.test(folded) && /\b(?:mejor|mas|better|more|vendio|sold)\b/.test(folded))) {
        const byMonth = new Map<string, { revenue: number; units: number }>();
        for (const piece of pieces) {
          if (!isSale(piece) || !piece.soldOn) continue;
          const key = piece.soldOn.slice(0, 7);
          const cur = byMonth.get(key) ?? { revenue: 0, units: 0 };
          cur.revenue += (piece.saleCents ?? 0) * piece.qty;
          cur.units += piece.qty;
          byMonth.set(key, cur);
        }
        const ranked = [...byMonth.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
        if (!ranked.length) return { family, text: es ? "No hay ventas con fecha, así que ningún mes se puede coronar: sin fecha no hay mes." : "There are no dated sales, so no month can be crowned: with no date there is no month.", pieceIds: [] };
        const [key, best] = ranked[0];
        const name = new Intl.DateTimeFormat(es ? "es" : "en-US", { month: "long", year: "numeric" }).format(new Date(`${key}-15T12:00:00`));
        const text = es
          ? `Tu mejor mes fue ${name}: ${best.units} unidades vendidas, ${money(best.revenue)} en ventas con precio.${ranked[1] ? ` Le sigue ${new Intl.DateTimeFormat("es", { month: "long", year: "numeric" }).format(new Date(`${ranked[1][0]}-15T12:00:00`))} con ${money(ranked[1][1].revenue)}.` : ""} Solo entran ventas con fecha y con precio en el dinero.`
          : `Your best month was ${name}: ${best.units} units sold, ${money(best.revenue)} in priced sales.${ranked[1] ? ` Next is ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${ranked[1][0]}-15T12:00:00`))} with ${money(ranked[1][1].revenue)}.` : ""} Only dated sales enter, and only priced ones enter the money.`;
        return { family, text, pieceIds: [] };
      }
      const nowM = measure(pieces, ads, { lang, today, from: isoOf(new Date(todayD.getFullYear(), todayD.getMonth(), 1)), to: isoOf(new Date(todayD.getFullYear(), todayD.getMonth() + 1, 0)) });
      const prevM = measure(pieces, ads, { lang, today, from: isoOf(new Date(todayD.getFullYear(), todayD.getMonth() - 1, 1)), to: isoOf(new Date(todayD.getFullYear(), todayD.getMonth(), 0)) });
      const text = es
        ? `Este mes: ${nowM.units.sold} unidades vendidas, ${money(nowM.revenue)} en ventas con precio y ${money(nowM.profit)} de ganancia según las tarjetas. El mes pasado: ${prevM.units.sold} unidades, ${money(prevM.revenue)} y ${money(prevM.profit)}. La diferencia en ventas es ${money(nowM.revenue - prevM.revenue)}. Solo entran ventas con fecha; las sin fecha quedan fuera de los dos meses.`
        : `This month: ${nowM.units.sold} units sold, ${money(nowM.revenue)} in priced sales and ${money(nowM.profit)} of profit by the cards. Last month: ${prevM.units.sold} units, ${money(prevM.revenue)} and ${money(prevM.profit)}. The sales difference is ${money(nowM.revenue - prevM.revenue)}. Only dated sales enter; undated ones stay out of both months.`;
      return { family, text, pieceIds: [] };
    }

    case "anuncios": {
      const per = new Map<string, number>();
      for (const ad of ads) per.set(ad.product, (per.get(ad.product) ?? 0) + ad.spentCents);
      if (entity) {
        const mine = [...per.entries()].filter(([product]) => fold(product) === fold(entity.label) || fold(product).split(" ")[0] === (headWord ?? ""));
        if (mine.length) {
          const totalMine = mine.reduce((sum, [, v]) => sum + v, 0);
          const text = es
            ? `En anuncios de ${entity.label} has gastado ${money(totalMine)} (${mine.map(([p, v]) => `${p}: ${money(v)}`).join(", ")}). El total de la casa en anuncios es ${money(m.adSpend)}.`
            : `On ads for ${entity.label} you have spent ${money(totalMine)} (${mine.map(([p, v]) => `${p}: ${money(v)}`).join(", ")}). The house total on ads is ${money(m.adSpend)}.`;
          return { family, text, pieceIds: [] };
        }
      }
      const list = [...per.entries()].sort((a, b) => b[1] - a[1]);
      const text = es
        ? `Has gastado ${money(m.adSpend)} en anuncios${list.length ? `: ${list.map(([p, v]) => `${p} (${money(v)})`).join(", ")}` : ""}. El anuncio se resta de la pieza que nombra: lo que queda después del costo y del anuncio es lo tuyo, y sin restarlo ninguna promoción se puede llamar ganancia.`
        : `You have spent ${money(m.adSpend)} on ads${list.length ? `: ${list.map(([p, v]) => `${p} (${money(v)})`).join(", ")}` : ""}. The ad is subtracted from the piece it names: what stays after cost and the ad is yours, and without subtracting it no promotion can be called a win.`;
      return { family, text, pieceIds: [] };
    }

    case "faltantes": {
      // A named field ("which pieces are missing their price") is
      // answered over every card with that gap, named.
      const field = /\b(precio|price|asking)\b/.test(folded) ? "asking price"
        : /\b(foto|photo)\b/.test(folded) ? "photo"
        : /\b(marca|brand)\b/.test(folded) ? "brand"
        : /\b(fecha|date)\b/.test(folded) ? "date"
        : /\b(costo|cost)\b/.test(folded) ? "cost"
        : /\b(talla|size)\b/.test(folded) ? "size"
        : /\b(fuente|source)\b/.test(folded) ? "bought from"
        : /\b(lugar|place)\b/.test(folded) ? "place" : null;
      if (field) {
        const lacking = pieces.filter((piece) => missingOf(piece).includes(field));
        const fieldWord = es ? ({ "asking price": "precio pedido", photo: "foto", brand: "marca", date: "fecha de llegada", cost: "costo", size: "talla", "bought from": "fuente", place: "lugar" } as Record<string, string>)[field] : field === "asking price" ? "asking price" : field === "bought from" ? "source" : field;
        if (!lacking.length) return { family, text: es ? `Ninguna tarjeta tiene ese hueco: todas traen su ${fieldWord}.` : `No card has that gap: every card carries its ${fieldWord}.`, pieceIds: [] };
        const text = es
          ? `Sin ${fieldWord}: ${lacking.slice(0, 6).map((p) => p.name).join(", ")}${lacking.length > 6 ? ` y ${lacking.length - 6} más` : ""}. Son ${lacking.length} ${lacking.length === 1 ? "tarjeta" : "tarjetas"} con ese hueco.`
          : `Missing their ${fieldWord}: ${lacking.slice(0, 6).map((p) => p.name).join(", ")}${lacking.length > 6 ? ` and ${lacking.length - 6} more` : ""}. That is ${lacking.length} card${lacking.length === 1 ? "" : "s"} with that gap.`;
        return { family, text, pieceIds: ids(lacking) };
      }
      const targets = entity ? scoped.filter((piece) => piece.status === "available" || piece.status === "incoming") : pieces.filter((piece) => piece.status === "available");
      const incomplete = targets.map((piece) => ({ piece, missing: missingWords(piece, lang) })).filter((row) => row.missing.length);
      if (!incomplete.length) return { family, text: es ? "Las tarjetas en ese alcance están completas: talla donde el tipo la necesita, foto, costo, precio, fecha, marca, fuente y lugar." : "The cards in that scope are complete: size where the type needs it, photo, cost, price, date, brand, source and place.", pieceIds: ids(targets) };
      const text = incomplete.slice(0, 4).map((row) => es ? `A ${row.piece.name} le falta: ${row.missing.join(", ")}` : `${row.piece.name} is missing: ${row.missing.join(", ")}`).join(". ") + (es ? ". Sin eso, esa pieza es difícil de encontrar o de juzgar." : ". Without that, the piece is hard to find or to judge.");
      return { family, text, pieceIds: ids(incomplete.map((row) => row.piece)) };
    }

    case "pieza": {
      if (!entity) return { family: "unknown", text: es ? "¿De qué pieza? Nómbrala como está en su tarjeta y te digo su costo, su llegada o su venta." : "Which piece? Name it as it is written on its card and I will tell you its cost, its arrival or its sale.", pieceIds: [] };
      const records = scoped;
      if (!records.length) return { family, text: es ? `No hay ninguna pieza llamada ${entity.label} en tu inventario: no voy a acomodar el nombre a otra.` : `There is no piece called ${entity.label} in your inventory: I will not bend the name to another one.`, pieceIds: [] };
      const wantsDate = /\b(cuando|when|llegada|arrival)\b/.test(folded);
      const wantsSold = /\b(vendi\w*|sold|sell|venta)\b/.test(folded);
      // An explicit cost ask ("¿cuánto costó el reloj que vendí?") is a
      // cost question even though it mentions the sale.
      const wantsCost = /\b(costo|cuesta|costaron|cost)\b/.test(folded);
      const stockRecords = records.filter((piece) => piece.status === "available" || piece.status === "incoming");
      if (wantsDate && !wantsSold) {
        const pool = /\b(tengo|have|queda|left)\b/.test(folded) && stockRecords.length ? stockRecords : records;
        const dated = pool.filter((piece): piece is Piece & { receivedOn: string } => !!piece.receivedOn);
        const text = dated.length
          ? (es ? `${entity.label}: ${dated.map((piece) => `llegó el ${longDate(piece.receivedOn)} (${piece.status === "incoming" ? "en camino" : piece.status === "available" ? "en inventario" : piece.status})`).join("; ")}.` : `${entity.label}: ${dated.map((piece) => `arrived ${longDate(piece.receivedOn)} (${piece.status})`).join("; ")}.`)
          : (es ? `${entity.label} no tiene fecha de llegada en su tarjeta: sin esa fecha no hay antigüedad honesta.` : `${entity.label} has no arrival date on its card: with no date there is no honest aging.`);
        return { family, text, pieceIds: ids(pool) };
      }
      if ((wantsSold || wantsDate) && !wantsCost) {
        const sold = records.filter(isSale);
        const text = sold.length
          ? (es ? `${entity.label}: ${sold.map((piece) => `se vendió${piece.soldOn ? ` el ${longDate(piece.soldOn)}` : " sin fecha"}${piece.saleCents != null ? ` por ${money(piece.saleCents)}` : " sin precio"}${piece.clientName ? ` a ${piece.clientName}` : ""}`).join("; ")}.` : `${entity.label}: ${sold.map((piece) => `sold${piece.soldOn ? ` ${longDate(piece.soldOn)}` : " with no date"}${piece.saleCents != null ? ` for ${money(piece.saleCents)}` : " with no price"}${piece.clientName ? ` to ${piece.clientName}` : ""}`).join("; ")}.`)
          : (es ? `${entity.label} no se ha vendido: sigue ${stockRecords.length ? "en el inventario" : "fuera del inventario sin venta"}.` : `${entity.label} has not sold: it is ${stockRecords.length ? "still in stock" : "out of stock without a sale"}.`);
        return { family, text, pieceIds: ids(records) };
      }
      // A cost of 0 on a card is an unknown cost, never "$0.00": costed
      // cards speak, uncosted ones are declared.
      const costed = records.filter((piece) => piece.costCents > 0);
      const costs = [...new Set(costed.map((piece) => piece.costCents))];
      const uncosted = records.length - costed.length;
      const text = costs.length
        ? (es
          ? `${entity.label}: ${costs.length === 1 ? `costó ${money(costs[0])} por unidad` : `los costos en sus tarjetas son ${costs.map((c) => money(c)).join(", ")}`} (sobre ${records.length} ${records.length === 1 ? "tarjeta" : "tarjetas"} con ese nombre).${uncosted ? ` ${uncosted} ${uncosted === 1 ? "tarjeta no trae" : "tarjetas no traen"} costo: el de esa pieza es desconocido, no cero.` : ""}${records.some((piece) => piece.buyRebateCents > 0) ? " El reembolso de compra baja ese costo en la tarjeta que lo trae." : ""}`
          : `${entity.label}: ${costs.length === 1 ? `it cost ${money(costs[0])} per unit` : `the costs on its cards are ${costs.map((c) => money(c)).join(", ")}`} (over ${records.length} card${records.length === 1 ? "" : "s"} with that name).${uncosted ? ` ${uncosted} card${uncosted === 1 ? " carries" : "s carry"} no cost: that piece's cost is unknown, not zero.` : ""}${records.some((piece) => piece.buyRebateCents > 0) ? " The buying rebate lowers that cost on the card that carries it." : ""}`)
        : (es
          ? `${entity.label}: ninguna de sus tarjetas trae costo, así que no puedo decir cuánto costó: desconocido no es cero.`
          : `${entity.label}: none of its cards carries a cost, so I cannot say what it cost: unknown is not zero.`);
      return { family, text, pieceIds: ids(records) };
    }

    default: {
      const text = es
        ? "Esa pregunta todavía no tiene familia en esta casa: no la voy a acomodar a otra ni a inventar su respuesta. Pregúntame «¿qué puedes hacer?» y te digo las familias vivas, cada una con su ejemplo."
        : "That question has no family in this house yet: I will not bend it to another one or invent its answer. Ask me “what can you do?” and I will tell you the live families, each with its example.";
      return { family: "unknown", text, pieceIds: [] };
    }
  }
}
