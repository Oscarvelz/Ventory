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
import { missingWords } from "./advisor";
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

type Entity = { kind: "product" | "brand" | "category" | "source" | "channel" | "client" | "size"; label: string; folded: string };

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
  return [...seen.values()];
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
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const hits = entities.filter((e) => {
    const parts = e.folded.split(" ").filter(Boolean);
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
  });
  if (hits.length) {
    const kindRank = { product: 0, client: 1, channel: 2, source: 3, brand: 4, category: 5, size: 6 } as const;
    hits.sort((a, b) => b.folded.length - a.folded.length || kindRank[a.kind] - kindRank[b.kind]);
    return { entity: hits[0], headWord: null };
  }
  for (const word of words) {
    if (word.length < 4) continue;
    const sharing = entities.filter((e) => e.kind === "product" && e.folded.split(" ")[0] === word);
    if (sharing.length) return { entity: sharing[0], headWord: word };
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

  // ---- Frontier first: a fee, a listing date, a market price is a
  // boundary, not a number, whichever family the words also touch.
  for (const cue of FRONTIER_CUES) {
    if (!cue.re.test(folded)) continue;
    const text =
      cue.kind === "fees" ? (es ? "Eso no lo puedo cerrar: las tarifas de venta no están en ninguna tarjeta, así que no existe un neto final que pueda nombrarte. Lo que sí puedo darte es la ganancia según las tarjetas — precio de venta menos costo, con el anuncio restado cuando lo hay — y el piso real siempre es más alto que el costo, porque las tarifas toman su parte antes." : "I cannot close that one: selling fees are not on any card, so there is no final net I can name. What I can give you is profit by the cards — sale price minus cost, with the ad subtracted when there is one — and the real floor is always higher than cost, because fees take their share first.")
      : cue.kind === "listing" ? (es ? "No hay fecha de publicación en las tarjetas, así que no puedo decir desde cuándo está publicada una pieza. El reloj de esta casa es la fecha de llegada: la antigüedad se mide desde que la pieza llegó, y eso sí te lo puedo dar por pieza o por grupo." : "There is no listing date on the cards, so I cannot say since when a piece has been listed. This house's clock is the arrival date: aging is measured from when the piece arrived, and that I can give you per piece or per group.")
      : cue.kind === "market" ? (es ? "No tengo precios de mercado ni sé lo que otros cobran: Ventory solo conoce tus tarjetas. Lo que sí puedo mostrarte es a cuánto se ha vendido esto en tu propio inventario, que es evidencia tuya, no del mercado." : "I have no market prices and I do not know what others charge: Ventory only knows your cards. What I can show you is what this has actually sold for in your own inventory — your evidence, not the market's.")
      : cue.kind === "condition" ? (es ? "La condición de una pieza no es un campo de la tarjeta, así que no la voy a inventar. Si la escribes en las notas de la pieza, la cito tal cual; sin eso, no hay respuesta honesta a esa pregunta." : "A piece's condition is not a field on the card, so I will not invent it. If you write it in the piece's notes I will quote it as written; without that, there is no honest answer to that question.")
      : (es ? "No hay fecha de devolución en las tarjetas: una devolución no se puede colocar en una semana. La pieza vuelve a inventario y sus días cuentan desde su fecha de llegada." : "There is no return date on the cards: a return cannot be placed in a week. The piece goes back on hand and its days count from its arrival date.");
    return { family: "frontera", text, pieceIds: [] };
  }

  // A brand named after "marca/brand" that no card carries gets a
  // declaration, not the floor's totals. Verbs and question words after
  // "marca" ("¿qué marca vende más?") are not names.
  const brandAsk = question.match(/\b(?:marca|brand)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)/i);
  if (brandAsk) {
    const word = fold(brandAsk[1]);
    const NOT_A_NAME = new Set(["vende", "venden", "sells", "sell", "es", "is", "se", "mas", "mejor", "best", "tiene", "tienen", "tengo", "of", "the", "que", "cual", "cuales", "hay", "moves", "move", "conviene"]);
    if (!NOT_A_NAME.has(word) && !findEntity(word, entities).entity) {
      const name = brandAsk[1][0].toUpperCase() + brandAsk[1].slice(1);
      return { family: "unknown", text: es
        ? `No hay nada de ${name} en este inventario: esa marca no está en ninguna tarjeta, así que no tiene ventas ni ganancia que pueda mostrarte. Si llega una pieza de ${name}, la anotas y desde ahí sí respondo por ella.`
        : `There is nothing from ${name} in this inventory: that brand is on no card, so it has no sales or profit I can show you. If a ${name} piece arrives, note it and from then on I can answer for it.`, pieceIds: [] };
    }
  }

  let family = (FAMILY_CUES.find((cue) => cue.re.test(folded))?.id ?? "unknown") as FamilyId | "unknown";
  // Judgment refinements: a negated sale asked as a question ("¿qué no
  // he vendido?") belongs to what-is-not-moving; stated flatly it asks
  // what is still on the shelf. A sales question aimed at one channel,
  // source or client belongs to that dimension's family.
  if (family === "ventas" && NEGATED_SALE.test(folded)) family = /\b(nunca|never)\b/.test(folded) ? "nosemueve" : "existencias";
  else if (family === "ventas" && /\b(rapid|fast|rapido|cuantos dias|days to sell|cuanto (?:tarda|demora)|velocidad)\b/.test(folded)) family = "rotacion";
  else if (family === "ventas" && entity?.kind === "channel") family = "canales";
  else if (family === "ventas" && entity?.kind === "source") family = "fuentes";
  else if (family === "ventas" && entity?.kind === "client") family = "clientes";

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
      const text = es
        ? `Ganancia según las tarjetas ${winName}: ${money(mw.profit)}, sobre ${money(mw.revenue)} en ventas con precio. El margen es ${margin}, calculado solo sobre las ${units(known)} unidades vendidas con costo en su tarjeta (${money(knownRevenue)}).${costless.length ? ` ${costless.map((piece) => piece.name).join(", ")} se vendió sin costo en su tarjeta: sus ${money(costlessRevenue)} cuentan como entrada, pero su ganancia real es desconocida y no entra en el margen.` : ""}${mw.units.unpriced ? ` Y ${mw.units.unpriced} unidad sin precio no entra en ninguna de estas cifras.` : ""}`
        : `Profit by the cards ${winName}: ${money(mw.profit)}, over ${money(mw.revenue)} in priced sales. The margin is ${margin}, computed only over the ${units(known)} sold units with a cost on their card (${money(knownRevenue)}).${costless.length ? ` ${costless.map((piece) => piece.name).join(", ")} sold with no cost on its card: its ${money(costlessRevenue)} counts as money in, but its real profit is unknown and stays out of the margin.` : ""}${mw.units.unpriced ? ` And ${mw.units.unpriced} unpriced unit enters none of these figures.` : ""}`;
      return { family, text, pieceIds: ids(mw.sales) };
    }

    case "envios": {
      const pool = entity ? scopedSales : m.sales;
      const charged = pool.filter((piece) => piece.deliveryCents > 0);
      const total = charged.reduce((sum, piece) => sum + piece.deliveryCents * piece.qty, 0);
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
      const text = es
        ? `Tienes ${money(m.stockCost)} en inventario al costo: ${money(m.onHandCost)} en mano (${m.units.onHand} unidades) y ${money(m.incomingCost)} en camino (${m.units.incoming} unidades). Es capital comprometido, no ventas: no se perdió, pero no trabaja en otro lugar hasta que las piezas se vendan.`
        : `You have ${money(m.stockCost)} in stock at cost: ${money(m.onHandCost)} on hand (${m.units.onHand} units) and ${money(m.incomingCost)} on the way (${m.units.incoming} units). It is committed capital, not sales: not lost, but it cannot work anywhere else until the pieces sell.`;
      return { family, text, pieceIds: ids(m.stock) };
    }

    case "rotacion": {
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
      const rows = family === "fuentes" ? m.bySource : family === "canales" ? m.byChannel : family === "clientes" ? m.byClient : family === "tallas" ? m.bySize : (entity?.kind === "category" || /\b(categoria|category|categorias)\b/.test(folded) ? m.byCategory : m.byBrand);
      const row = entity ? groupRow(rows, entity) : null;
      const label = family === "fuentes" ? (es ? "fuente" : "source") : family === "canales" ? (es ? "canal" : "channel") : family === "clientes" ? (es ? "cliente" : "client") : family === "tallas" ? (es ? "talla" : "size") : (es ? "marca" : "brand");
      if (row) {
        const text = es
          ? `${row.label}: ${row.soldUnits} unidades vendidas por ${money(row.revenue)}${row.avgDays != null ? `, en unos ${row.avgDays} días` : ""}, y quedan ${row.stockUnits} en inventario (${money(row.stockCost)} al costo).`
          : `${row.label}: ${row.soldUnits} units sold for ${money(row.revenue)}${row.avgDays != null ? `, in about ${row.avgDays} days` : ""}, and ${row.stockUnits} left in stock (${money(row.stockCost)} at cost).`;
        return { family, text, pieceIds: [] };
      }
      const sold = rows.filter((r) => r.soldUnits > 0).sort((a, b) => b.revenue - a.revenue || b.soldUnits - a.soldUnits);
      if (!sold.length) return { family, text: es ? `Todavía no hay ventas con ${label} en la tarjeta, así que no hay clasificación honesta: sin ventas, esto sería procedencia, no ranking.` : `There are no sales with a ${label} on the card yet, so there is no honest ranking: with no sales this would be provenance, not a ranking.`, pieceIds: [] };
      const top = sold[0];
      const text = es
        ? `Por ${label}, manda ${top.label}: ${top.soldUnits} unidades vendidas por ${money(top.revenue)}${top.avgDays != null ? `, en unos ${top.avgDays} días` : ""}. Le siguen ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.revenue)})`).join(", ") || "nadie más con ventas"}. La clasificación es solo sobre lo vendido; lo que no se ha vendido no clasifica.`
        : `By ${label}, ${top.label} leads: ${top.soldUnits} units sold for ${money(top.revenue)}${top.avgDays != null ? `, in about ${top.avgDays} days` : ""}. Next: ${sold.slice(1, 3).map((r) => `${r.label} (${money(r.revenue)})`).join(", ") || "no one else with sales"}. The ranking is over what sold only; what has not sold does not rank.`;
      return { family, text, pieceIds: [] };
    }

    case "tramos": {
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
      const top = [...per.entries()].sort((a, b) => b[1] - a[1])[0];
      const text = es
        ? `Has gastado ${money(m.adSpend)} en anuncios${top ? `; el mayor cargo es ${top[0]} con ${money(top[1])}` : ""}. El anuncio se resta de la pieza que nombra: lo que queda después del costo y del anuncio es lo tuyo, y sin restarlo ninguna promoción se puede llamar ganancia.`
        : `You have spent ${money(m.adSpend)} on ads${top ? `; the biggest charge is ${top[0]} with ${money(top[1])}` : ""}. The ad is subtracted from the piece it names: what stays after cost and the ad is yours, and without subtracting it no promotion can be called a win.`;
      return { family, text, pieceIds: [] };
    }

    case "faltantes": {
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
      const wantsDate = /\b(cuando|when)\b/.test(folded);
      const wantsSold = /\b(vendi|sold|venta)\b/.test(folded);
      // An explicit cost ask ("¿cuánto costó el reloj que vendí?") is a
      // cost question even though it mentions the sale.
      const wantsCost = /\b(costo|cuesta|costaron|cost)\b/.test(folded);
      const stockRecords = records.filter((piece) => piece.status === "available" || piece.status === "incoming");
      if (wantsDate && !wantsSold) {
        const pool = /\b(tengo|have|queda|left)\b/.test(folded) && stockRecords.length ? stockRecords : records;
        const dated = pool.filter((piece): piece is Piece & { receivedOn: string } => !!piece.receivedOn);
        const text = dated.length
          ? (es ? `${entity.label}: ${dated.map((piece) => `llegó el ${fullDate(lang, piece.receivedOn)} (${piece.status === "incoming" ? "en camino" : piece.status === "available" ? "en inventario" : piece.status})`).join("; ")}.` : `${entity.label}: ${dated.map((piece) => `arrived ${fullDate(lang, piece.receivedOn)} (${piece.status})`).join("; ")}.`)
          : (es ? `${entity.label} no tiene fecha de llegada en su tarjeta: sin esa fecha no hay antigüedad honesta.` : `${entity.label} has no arrival date on its card: with no date there is no honest aging.`);
        return { family, text, pieceIds: ids(pool) };
      }
      if ((wantsSold || wantsDate) && !wantsCost) {
        const sold = records.filter(isSale);
        const text = sold.length
          ? (es ? `${entity.label}: ${sold.map((piece) => `se vendió${piece.soldOn ? ` el ${fullDate(lang, piece.soldOn)}` : " sin fecha"}${piece.saleCents != null ? ` por ${money(piece.saleCents)}` : " sin precio"}${piece.clientName ? ` a ${piece.clientName}` : ""}`).join("; ")}.` : `${entity.label}: ${sold.map((piece) => `sold${piece.soldOn ? ` ${fullDate(lang, piece.soldOn)}` : " with no date"}${piece.saleCents != null ? ` for ${money(piece.saleCents)}` : " with no price"}${piece.clientName ? ` to ${piece.clientName}` : ""}`).join("; ")}.`)
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
