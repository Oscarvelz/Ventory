import { daysHeld, effectiveCostCents, money, profitOf, type Ad, type Piece } from "./model";
import { measure } from "./metrics";
import { tx, type Lang } from "./i18n";

export type AdviceTone = "ready" | "watch" | "loss";

export type AdviceCard = {
  id: string;
  question: string;
  horizon: string;
  title: string;
  body: string;
  tone: AdviceTone;
  pieceIds: string[];
};

export type Advice = {
  mode: "startup" | "selling";
  stage: string;
  headline: string;
  ready: number;
  onHandCents: number;
  oldestLabel: string;
  actionTitle: string;
  actionBody: string;
  actionPieceId: string | null;
  cards: AdviceCard[];
  plan: string;
  lines: Record<string, string>;
};

function qty(pieces: Piece[]) {
  return pieces.reduce((sum, piece) => sum + piece.qty, 0);
}

function costOf(pieces: Piece[]) {
  return pieces.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
}

function isSale(piece: Piece) {
  return piece.status === "sold" || piece.wasSold;
}

function isRemoved(piece: Piece) {
  return piece.status === "archived" && !piece.wasSold;
}

function isKept(piece: Piece) {
  return piece.status === "kept";
}

function needsSize(piece: Piece) {
  return /boot|shoe|sneaker|heel|loafer|sandal/i.test(`${piece.category} ${piece.subcategory} ${piece.name}`);
}

export function missingOf(piece: Piece) {
  const missing: string[] = [];
  if (needsSize(piece) && !piece.usSize && !piece.sizeLabel) missing.push("size");
  if (!piece.photo) missing.push("photo");
  if (piece.costCents <= 0) missing.push("cost");
  if (piece.askCents <= 0) missing.push("asking price");
  if (!piece.receivedOn) missing.push("date");
  if (!piece.brand.trim()) missing.push("brand");
  if (!piece.source.trim()) missing.push("bought from");
  if (!piece.place) missing.push("place");
  return missing;
}

function ready(piece: Piece) {
  return piece.status === "available" && missingOf(piece).length === 0;
}

function adSpend(piece: Piece, ads: Ad[]) {
  const name = piece.name.trim().toLowerCase();
  return ads.filter((ad) => ad.product.trim().toLowerCase() === name).reduce((sum, ad) => sum + ad.spentCents, 0);
}

function netOf(piece: Piece, ads: Ad[]) {
  const profit = profitOf(piece);
  if (profit == null) return null;
  return profit.profit - adSpend(piece, ads);
}

function list(names: string[], lang: Lang = "en") {
  const and = lang === "es" ? " y " : " and ";
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]}${and}${names[1]}`;
  return `${names.slice(0, -1).join(", ")}${and}${names[names.length - 1]}`;
}

const MISS_KEY: Record<string, "miss.size" | "miss.photo" | "miss.cost" | "miss.ask" | "miss.date" | "miss.brand" | "miss.source" | "miss.place"> = {
  size: "miss.size", photo: "miss.photo", cost: "miss.cost", "asking price": "miss.ask", date: "miss.date", brand: "miss.brand", "bought from": "miss.source", place: "miss.place",
};

/** The missing-field words in the reader's language (missingOf itself returns stable ids). */
export function missingWords(piece: Piece, lang: Lang): string[] {
  return missingOf(piece).map((id) => tx(lang, MISS_KEY[id] ?? "miss.size"));
}

/** One missing-field id in the reader's language. */
export function missingLabel(id: string, lang: Lang): string {
  return tx(lang, MISS_KEY[id] ?? "miss.size");
}

function iso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function removalReason(piece: Piece) {
  const match = piece.notes.match(/(?:Removed|Retirado):\s*([^·\n]+)/i);
  return match?.[1]?.trim() ?? "";
}

function sourceNote(sold: Piece[], lang: Lang = "en") {
  const map = new Map<string, { name: string; n: number; days: number[] }>();
  for (const piece of sold) {
    const name = piece.source.trim();
    if (!name) continue;
    const row = map.get(name.toLowerCase()) ?? { name, n: 0, days: [] as number[] };
    row.n += piece.qty;
    const days = daysHeld(piece.receivedOn, piece.soldOn);
    if (days != null) row.days.push(days);
    map.set(name.toLowerCase(), row);
  }
  const best = [...map.values()].sort((a, b) => b.n - a.n)[0];
  if (!best) return lang === "es" ? "Ninguna pieza vendida nombra un lugar de compra, así que la próxima compra no puede citar uno." : "No sold piece names a source, so the next buy cannot cite one.";
  if (best.n < 2) return lang === "es" ? `${best.name} tiene una venta. Ese lugar es una lección, no un patrón.` : `${best.name} has one sale. That source is a lesson, not a pattern.`;
  const avg = best.days.length ? Math.round(best.days.reduce((sum, days) => sum + days, 0) / best.days.length) : null;
  return lang === "es" ? `${best.name} vendió ${best.n} veces${avg != null ? ` en unos ${avg} días` : ""}. Cítalo antes de volver a comprar ahí.` : `${best.name} sold ${best.n} times${avg != null ? ` in about ${avg} days` : ""}. Cite that before buying there again.`;
}

function ladder(piece: Piece, days: number, lang: Lang = "en") {
  const ask = piece.askCents > 0 ? piece.askCents : null;
  const cut = ask != null ? Math.round(ask * 0.9) : null;
  const left = cut != null ? cut - effectiveCostCents(piece) : null;
  if (days <= 14) return lang === "es" ? `${piece.name} está dentro del plazo normal (${days} días desde la llegada; no hay fecha de publicación en la tarjeta). Revisa que la tarjeta se mantenga completa.` : `${piece.name} is inside the normal window (${days} days from arrival — there is no listing date on the card). Check that the card stays complete.`;
  if (days <= 30) return lang === "es" ? `${piece.name} lleva ${days} días esperando. Revisa la foto, pon la talla y la marca en el título, y fija el precio pedido contra su punto de equilibrio. El punto de equilibrio es el precio más bajo que te deja entero: al menos los $${(piece.costCents / 100).toFixed(2)} que costó, hasta que las tarifas y el envío estén en la tarjeta.` : `${piece.name} has sat ${days} days. Review the photo, put the size and brand in the title, and set the asking price against its break-even. Break-even is the lowest price that leaves you whole: at least the $${(piece.costCents / 100).toFixed(2)} it cost, until fees and shipping are on the card.`;
  if (days <= 60 && cut != null && left != null) return lang === "es" ? `${piece.name} lleva ${days} días esperando. Una primera rebaja de cerca del 10 % pediría ${money(cut)}. Si se vende ahí, quedan unos ${money(left)} después del costo; las tarifas aún no se conocen, así que no es el neto final.` : `${piece.name} has sat ${days} days. A first cut of about 10% would ask ${money(cut)}. If it sells there, about ${money(left)} stays after cost — fees are still unknown, so that is not the final net.`;
  if (days <= 90) return lang === "es" ? `${piece.name} lleva ${days} días esperando. Decide: un anuncio medido solo si el margen después del anuncio queda por encima del costo, un paquete, o un precio más bajo. No voy a nombrar una ganancia que no puedo ver.` : `${piece.name} has sat ${days} days. Decide: a measured ad only if the margin after the ad stays above cost, a bundle, or a lower ask. I will not name a profit I cannot see.`;
  return lang === "es" ? `${piece.name} está fría con ${days} días. La antigüedad es cuánto tiempo lleva esperando una pieza; pasados los 90 días, recuperar el costo de ${money(piece.costCents)} vale más que esperar un precio soñado. Puedes venderla al costo, guardarla a propósito o retirarla.` : `${piece.name} is cold at ${days} days. Aging means how long a piece has been sitting; past 90 days, recovering the ${money(piece.costCents)} cost beats waiting for a dream price. You can sell at cost, keep it on purpose, or remove it.`;
}

export function buildAdvice(pieces: Piece[], ads: Ad[], today: Date | Lang = new Date(), langArg?: Lang): Advice {
  const lang: Lang = typeof today === "string" ? today : langArg ?? "en";
  const todayD = typeof today === "string" ? new Date() : today;
  const H_TODAY = lang === "es" ? "Hoy" : "Today";
  const H_STRETCH = lang === "es" ? "Este tramo" : "This stretch";
  const onHand = pieces.filter((piece) => piece.status === "available");
  const incoming = pieces.filter((piece) => piece.status === "incoming");
  const sold = pieces.filter(isSale);
  const removed = pieces.filter(isRemoved);
  const kept = pieces.filter(isKept);
  const live = pieces.filter((piece) => !isRemoved(piece) && !isKept(piece));
  // One reading (1.13.0): the deck's floor totals come from the same
  // measure() object Statistics reads — never a second arithmetic. The
  // old adOnSales summed a product's ad once per priced sale record of
  // that product (double-counting it) and dropped ads whose product had
  // no priced sale; the reading's adSpend counts every ad once.
  const reading = measure(pieces, ads, { lang, today: `${todayD.getFullYear()}-${String(todayD.getMonth() + 1).padStart(2, "0")}-${String(todayD.getDate()).padStart(2, "0")}` });
  const onHandCents = reading.onHandCost;
  const incomingCents = reading.incomingCost;
  const committed = onHandCents + incomingCents;
  const onHandQty = qty(onHand);
  const readyPieces = onHand.filter(ready);
  const readyQty = qty(readyPieces);
  const sales = sold.filter((piece) => piece.saleCents != null);
  const datedSales = sales.filter((piece) => piece.soldOn);
  const undatedSales = sales.filter((piece) => !piece.soldOn);
  const mode = sales.length === 0 ? "startup" : "selling";

  const boots = live.filter((piece) => /boot/i.test(`${piece.category} ${piece.name}`));
  const bootShare = qty(live) ? Math.round((qty(boots) / qty(live)) * 100) : 0;
  const topType = boots.length ? "boots" : "one type";

  const clock = iso(todayD);
  const ages = onHand
    .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null, clock) }))
    .filter((row): row is { piece: Piece; days: number } => row.days != null)
    .sort((a, b) => b.days - a.days);
  const oldest = ages[0];
  const undatedHand = onHand.filter((piece) => !piece.receivedOn);

  const incomplete = [...onHand].filter((piece) => !ready(piece)).sort((a, b) => b.costCents - a.costCents);
  const first = incomplete[0] ?? onHand[0] ?? incoming[0] ?? null;
  const average = onHandQty ? Math.round(onHandCents / onHandQty) : null;

  const priced = sold.filter((piece) => piece.saleCents != null);
  const revenue = reading.revenue;
  const soldCost = reading.costOfSales;
  const adOnSales = reading.adSpend;
  const net = revenue - soldCost - adOnSales;

  const readyCost = costOf(readyPieces);
  const cards: AdviceCard[] = [];

  cards.push({
    id: "ready",
    question: lang === "es" ? "¿Qué está listo?" : "What is ready?",
    horizon: H_TODAY,
    title: onHandQty === 0
      ? (lang === "es" ? "Nada en inventario para publicar" : "Nothing on hand to list")
      : readyQty === 0
        ? (lang === "es" ? `Ninguna de las ${onHandQty} en inventario está lista todavía` : `None of the ${onHandQty} on hand are ready yet`)
        : (lang === "es" ? `${readyQty} de ${onHandQty} en inventario están listas` : `${readyQty} of ${onHandQty} on hand are ready`),
    tone: readyQty === onHandQty && onHandQty > 0 ? "ready" : "watch",
    pieceIds: incomplete.map((piece) => piece.id),
    body: onHandQty === 0
      ? (lang === "es" ? "No hay nada en inventario para publicar. Las piezas en camino están pagadas, todavía no se pueden vender." : "Nothing is on hand to list. Incoming pieces are paid for, not sellable yet.")
      : incomplete.length === 0
        ? (lang === "es" ? `${readyQty} de ${onHandQty} en inventario están listas: la talla donde el tipo la necesita, la foto, el costo, el precio pedido, la fecha, la marca, el lugar de compra y el lugar están en la tarjeta. ${money(readyCost)} se puede publicar. Todavía no tengo fecha de publicación, así que no las llamaré publicadas. El estado no es un campo, así que no lo voy a inventar.` : `${readyQty} of ${onHandQty} on hand are ready: size where the type needs it, photo, cost, asking price, date, brand, bought-from and place are on the card. ${money(readyCost)} can be listed. I still have no listing date, so I will not call them published. Condition is not a field, so I will not invent it.`)
        : (lang === "es" ? `${readyQty === 0 ? "" : `${readyQty} de ${onHandQty} están listas (${Math.round((readyQty / onHandQty) * 100)} %), ${money(readyCost)} que se puede publicar. `}${list(incomplete.map((piece) => `A ${piece.name} le falta ${list(missingWords(piece, lang), lang)}`), lang)}. Una bota sin talla es difícil de encontrar para un comprador. No hay fecha de publicación, así que no llamaré publicada a ninguna pieza. El estado no es un campo, así que no lo voy a inventar.` : `${readyQty === 0 ? "" : `${readyQty} of ${onHandQty} are ready (${Math.round((readyQty / onHandQty) * 100)}%), ${money(readyCost)} that can be listed. `}${list(incomplete.map((piece) => `${piece.name} needs ${list(missingOf(piece))}`))}. A boot without a size is hard for a buyer to find. There is no listing date, so I will not call a piece published. Condition is not a field, so I will not invent it.`),
  });

  if (average != null) {
    const sample = onHand.find((piece) => piece.askCents > 0 && piece.askCents < piece.costCents) ?? onHand[0];
    const below = sample && sample.askCents > 0 && sample.askCents < sample.costCents;
    cards.push({
      id: "price",
      question: lang === "es" ? "¿Cuánto debo cobrar?" : "What should I charge?",
      horizon: H_TODAY,
      title: lang === "es" ? `Las piezas en inventario cuestan ${money(average)} cada una` : `On-hand pieces cost ${money(average)} each`,
      tone: below ? "loss" : "watch",
      pieceIds: onHand.map((piece) => piece.id),
      body: below && sample
        ? (lang === "es" ? `${sample.name} pide ${money(sample.askCents)}, por debajo de los ${money(sample.costCents)} que costó. Está por debajo del punto de equilibrio, el precio más bajo que te deja entero. Las tarifas y el envío no están en la tarjeta, así que el piso real es más alto, no más bajo.` : `${sample.name} is asking ${money(sample.askCents)}, under the ${money(sample.costCents)} it cost. That is below break-even — the lowest price that leaves you whole. Fees and shipping are not on the card, so the real floor is higher, not lower.`)
        : (lang === "es" ? `Usa ${money(average)} como piso para hablar de precio. El punto de equilibrio es el precio más bajo que te deja entero: el costo, luego las tarifas y el envío. El recargo es cuánto agregas sobre ese costo al fijar el precio pedido, antes de que las tarifas tomen su parte. Esas tarifas no están en la tarjeta, así que no las voy a inventar. ${first ? `${first.name} necesita un precio pedido por encima de su costo de ${money(first.costCents)} antes de que alguien lo promocione.` : ""}` : `Use ${money(average)} as the floor for a price talk. Break-even is the lowest price that leaves you whole: cost, then fees and shipping. Markup is how much you add over that cost when you set the asking price — before fees take their share. Those fees are not on the card, so I will not invent them. ${first ? `${first.name} needs an asking price above its ${money(first.costCents)} cost before anyone promotes it.` : ""}`),
    });
  }

  const cold = ages.filter((row) => row.days > 60);
  const removalLessons = removed
    .map((piece) => {
      const reason = removalReason(piece);
      return reason ? (lang === "es" ? `${piece.name} salió como ${reason} (${money(piece.costCents)}). Es una lección para la próxima compra, no una venta.` : `${piece.name} left as ${reason} (${money(piece.costCents)}). That is a lesson for the next buy, not a sale.`) : "";
    })
    .filter(Boolean);
  const unrecovered = removed.filter((piece) => /gifted|damaged|regalad|dañad/i.test(removalReason(piece)) && piece.costCents > 0);
  cards.push({
    id: "buy",
    question: lang === "es" ? "¿Qué compro?" : "What do I buy?",
    horizon: H_STRETCH,
    title: mode === "startup" ? (lang === "es" ? "Espera la próxima compra" : "Hold the next purchase") : (lang === "es" ? "Compra solo lo que ya se movió" : "Buy only what already moved"),
    tone: "watch",
    pieceIds: [...incoming, ...onHand].map((piece) => piece.id),
    body: mode === "startup"
      ? (lang === "es" ? `Todavía no hay rotación: de cada 10 piezas que publicas, cuántas se vendieron de verdad. Ninguna, así que esto no es evidencia. ${money(committed)} está comprometido (${qty(onHand)} en inventario ${money(onHandCents)}, ${qty(incoming)} en camino ${money(incomingCents)}). ${bootShare ? `${qty(boots)} de ${qty(live)} piezas son botas (${bootShare} %). El riesgo es silencioso y concentrado; concentrado y vendiendo sería la estrategia, y nada se ha vendido.` : ""} El capital dormido sería una pieza publicada más de 60 días. No hay fecha de publicación, así que no llamaré dormido al ${money(committed)}: los ${money(incomingCents)} en camino solo aumentan lo comprometido, sin demanda todavía. ${cold.length ? `${list(cold.map((row) => row.piece.name), lang)} ${cold.length === 1 ? "lleva" : "llevan"} aquí más de 60 días desde la llegada, que no es lo mismo.` : ""} Espera la primera venta antes de comprar más, a menos que llames a una pieza una prueba deliberada. ${removalLessons.join(" ")}` : `There is no sell-through yet — of every 10 pieces you put up, how many actually sold. Nothing has, so this is not evidence. ${money(committed)} is committed (${qty(onHand)} on hand ${money(onHandCents)}, ${qty(incoming)} on the way ${money(incomingCents)}). ${bootShare ? `${qty(boots)} of ${qty(live)} pieces are ${topType} (${bootShare}%). Quiet and concentrated is the risk; concentrated and selling would be the strategy, and nothing has sold.` : ""} Sleeping capital would be a piece listed more than 60 days. There is no listing date, so I will not call the ${money(committed)} sleeping — the ${money(incomingCents)} on the way only raises what is committed, with no demand yet. ${cold.length ? `${list(cold.map((row) => row.piece.name))} ${cold.length === 1 ? "has" : "have"} been here past 60 days from arrival, which is not the same thing.` : ""} Wait for a first sale before buying more, unless you call one piece a deliberate test. ${removalLessons.join(" ")}`)
      : (lang === "es" ? `La rotación — de cada 10 piezas que publicas, cuántas se vendieron — es ${qty(sold)} vendidas contra ${qty(onHand)} todavía en inventario. ${bootShare ? `Las botas son el ${bootShare} % de lo que tienes. ${sales.length < 2 ? "Silencioso y concentrado sigue siendo un riesgo hasta que ese tipo se venda más de una vez." : "Si ese tipo es lo que se vendió, la concentración es una estrategia."}` : ""} ${sourceNote(sold, lang)} Una sola venta es una lección, no un patrón. ${removalLessons.join(" ")}` : `Sell-through — of every 10 pieces you put up, how many sold — is ${qty(sold)} sold against ${qty(onHand)} still on hand. ${bootShare ? `${topType} are ${bootShare}% of what you are holding. ${sales.length < 2 ? "Quiet and concentrated stays a risk until that type sells more than once." : "If that type is what sold, the concentration is a strategy."}` : ""} ${sourceNote(sold)} A single sale is a lesson, not a pattern. ${removalLessons.join(" ")}`),
  });

  const promotable = onHand.filter((piece) => piece.askCents > piece.costCents && piece.costCents > 0);
  cards.push({
    id: "ads",
    question: lang === "es" ? "¿Debo promocionar?" : "Should I promote?",
    horizon: H_TODAY,
    title: ads.reduce((sum, ad) => sum + ad.spentCents, 0) === 0 ? (lang === "es" ? "No promociones todavía" : "Do not promote yet") : (lang === "es" ? "Carga el anuncio a la pieza" : "Count the ad against the piece"),
    tone: "watch",
    pieceIds: promotable.map((piece) => piece.id),
    body: ads.length === 0
      ? (lang === "es" ? "El gasto en anuncios es $0.00. No te diré que promociones hasta poder mostrarte el dinero que queda después del anuncio. Los precios pedidos y las tarifas no se conocen a la vez, así que ese margen no está en la tarjeta." : "Ad spend is $0.00. I will not tell you to promote until I can show the money left after the ad. Asking prices and fees are not both known, so that margin is not on the card.")
      : (lang === "es" ? `Has gastado ${money(ads.reduce((sum, ad) => sum + ad.spentCents, 0))} promocionando por nombre de producto. Réstalo del neto de esa pieza: lo que de verdad es tuyo después del costo, las tarifas, el envío y el anuncio. Las tarifas aún no se conocen, así que no llamaré ganancia a una promoción.` : `You have spent ${money(ads.reduce((sum, ad) => sum + ad.spentCents, 0))} promoting by product name. Subtract it from that piece's net — what is really yours after cost, fees, shipping and the ad. Fees are still unknown, so I will not call a promotion a win.`),
  });

  cards.push({
    id: "states",
    question: lang === "es" ? "¿Qué cuenta dónde?" : "What counts where?",
    horizon: H_TODAY,
    title: lang === "es" ? "Solo una venta entra en ingresos" : "Only a sale enters revenue",
    tone: unrecovered.length ? "loss" : "ready",
    pieceIds: [...kept, ...removed].map((piece) => piece.id),
    body: lang === "es" ? `Las piezas vendidas entran en ingresos. En inventario (${money(onHandCents)}) y en camino (${money(incomingCents)}) son capital comprometido, no ventas. El capital atado es dinero dormido en el estante: no se perdió, pero no puede trabajar en otro lugar hasta que la pieza se venda; y no llamaré atado a esto sin una fecha de publicación. El archivo ${removed.length === 0 ? "está vacío y no está en los números de ingresos. Una pieza que retiras sin venta queda fuera de los ingresos." : `guarda ${list(removed.map((piece) => piece.name), lang)} retiradas sin venta: retirada significa que salió sin venderse, y no es ingreso.${unrecovered.length ? ` ${list(unrecovered.map((piece) => piece.name), lang)} no volvió, así que ese costo es una pérdida real.` : " No lo llamaré pérdida a menos que el costo no haya vuelto."}`} Si una venta regresa, borrarla revierte ese ingreso. No hay campo de fecha de devolución, así que la reversión no se coloca en una semana; la pieza vuelve a inventario y sus días cuentan desde la fecha de llegada. ${kept.length ? `${list(kept.map((piece) => `${piece.name} (${money(costOf([piece]))})`), lang)} ${kept.length === 1 ? "está guardada" : "están guardadas"}: una pieza que decidiste que es tuya. Ese costo es posesión, no una venta fallida ni una pérdida.` : "Guardada significa una pieza que decidiste que es tuya. Sale del juego de vender a propósito, no es una venta fallida."}` : `Sold pieces enter revenue. On hand (${money(onHandCents)}) and incoming (${money(incomingCents)}) are committed capital, not sales. Tied-up capital is money sleeping on the shelf — not lost, but it cannot work anywhere else until the piece sells — and I will not call this tied up without a listing date. Archive ${removed.length === 0 ? "is empty and is not in the revenue numbers. A piece you remove without a sale stays out of revenue." : `holds ${list(removed.map((piece) => piece.name))} removed without a sale — removed means it left without selling, and it is not revenue.${unrecovered.length ? ` ${list(unrecovered.map((piece) => piece.name))} did not come back, so that cost is a real loss.` : " I will not call it a loss unless the cost did not come back."}`} If a sale comes back, clearing it reverses that revenue. There is no return-date field, so the reversal is not placed in a week; the piece is on hand again and its days count from the arrival date. ${kept.length ? `${list(kept.map((piece) => `${piece.name} (${money(costOf([piece]))})`))} ${kept.length === 1 ? "is" : "are"} kept: a piece you decided is yours. That cost is possession, not a failed sale and not a loss.` : "Kept means a piece you decided is yours. It leaves the selling game on purpose — not a failed sale."}`,
  });

  const dateNames = [...undatedHand.map((piece) => piece.name), ...undatedSales.map((piece) => piece.name)];
  cards.push({
    id: "dates",
    question: lang === "es" ? "¿Qué fecha falta?" : "Which date is missing?",
    horizon: H_TODAY,
    title: datedSales.length === 0 ? (lang === "es" ? "Ninguna venta con fecha para aprender" : "No dated sale to learn from") : (lang === "es" ? `${datedSales.length} ${datedSales.length === 1 ? "venta con fecha" : "ventas con fecha"}` : `${datedSales.length} dated ${datedSales.length === 1 ? "sale" : "sales"}`),
    tone: dateNames.length || undatedSales.length ? "watch" : "ready",
    pieceIds: [...undatedHand, ...undatedSales].map((piece) => piece.id),
    body: datedSales.length === 0
      ? (lang === "es" ? `Todavía no hay ninguna venta con fecha. Cuando se venda la primera pieza, escribe el día en que salió: sin esa fecha no puedo decir cuánto tiempo estuvo el dinero esperando. ${undatedHand.length ? `${list(undatedHand.map((piece) => piece.name), lang)} tampoco ${undatedHand.length === 1 ? "tiene" : "tienen"} fecha de llegada, así que la antigüedad no se conoce.` : "Las fechas de llegada que falten se pedirán por nombre."}` : `There is no dated sale yet. When the first piece sells, write the day it left — without that date I cannot say how long the money sat. ${undatedHand.length ? `${list(undatedHand.map((piece) => piece.name))} also ${undatedHand.length === 1 ? "has" : "have"} no arrival date, so age is unknown.` : "Arrival dates that are missing will be asked for by name."}`)
      : (lang === "es" ? `${list(datedSales.map((piece) => piece.name), lang)} ${datedSales.length === 1 ? "tiene" : "tienen"} fecha de venta, así que solo ${datedSales.length === 1 ? "esa" : "esas"} se pueden comparar entre semanas. ${undatedSales.length ? `${list(undatedSales.map((piece) => piece.name), lang)} se vendió sin fecha y queda fuera de la comparación hasta que la agregues.` : ""}` : `${list(datedSales.map((piece) => piece.name))} ${datedSales.length === 1 ? "has" : "have"} a sale date, so only ${datedSales.length === 1 ? "that one" : "those"} can be compared across weeks. ${undatedSales.length ? `${list(undatedSales.map((piece) => piece.name))} sold with no date and stays out of the comparison until you add it.` : ""}`),
  });

  const sizeless = onHand.filter((piece) => needsSize(piece) && !piece.usSize && !piece.sizeLabel);
  if (sizeless.length || boots.length) {
    cards.push({
      id: "sizes",
      question: lang === "es" ? "¿Qué talla puede filtrar un comprador?" : "Which size can a buyer filter?",
      horizon: H_TODAY,
      title: sizeless.length ? (lang === "es" ? `${list(sizeless.map((piece) => piece.name), lang)} no ${sizeless.length === 1 ? "tiene" : "tienen"} talla` : `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "has" : "have"} no size`) : (lang === "es" ? "Las tallas están en las tarjetas" : "Sizes are on the cards"),
      tone: sizeless.length ? "watch" : "ready",
      pieceIds: sizeless.map((piece) => piece.id),
      body: sizeless.length
        ? (lang === "es" ? `Falta la talla en ${list(sizeless.map((piece) => piece.name), lang)}. En línea, un comprador filtra por talla antes de ver la foto. Pon la talla en ${sizeless[0].name} antes que nada en esa tarjeta.` : `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "is" : "are"} missing a size. Online, a buyer filters by size before the photo. Put the size on ${sizeless[0].name} before anything else on that card.`)
        : (lang === "es" ? "Toda pieza con talla en inventario la tiene puesta. Cuando haya ventas, la talla que sale es la que hay que volver a comprar." : "Every sized piece on hand has a size. When sales exist, the size that leaves is the one to buy again."),
    });
  }

  if (oldest) cards.push({
    id: "aging",
    question: lang === "es" ? "¿Qué lleva demasiado tiempo esperando?" : "What has sat too long?",
    horizon: H_STRETCH,
    title: oldest.days > 60 ? (lang === "es" ? `${oldest.piece.name} se está enfriando` : `${oldest.piece.name} is getting cold`) : (lang === "es" ? `${oldest.piece.name} es la más antigua` : `${oldest.piece.name} is the oldest`),
    tone: oldest.days > 90 ? "watch" : oldest.days > 30 ? "watch" : "ready",
    pieceIds: ages.map((row) => row.piece.id),
    body: `${oldest.days > 90 ? "" : (lang === "es" ? "La antigüedad es cuánto tiempo lleva esperando una pieza. " : "Aging is how long a piece has been sitting. ")}${ladder(oldest.piece, oldest.days, lang)} ${lang === "es" ? "El reloj es la fecha de llegada, no una de publicación." : "The clock is the arrival date, not a listing date."} ${[
      ["0–30", ages.filter((row) => row.days <= 30).length],
      ["31–60", ages.filter((row) => row.days > 30 && row.days <= 60).length],
      ["61–90", ages.filter((row) => row.days > 60 && row.days <= 90).length],
      ["90+", ages.filter((row) => row.days > 90).length],
    ].filter(([, count]) => count).map(([label, count]) => (lang === "es" ? `${count} en ${label}` : `${count} in ${label}`)).join(", ")}.`,
  });

  const inCar = onHand.filter((piece) => piece.place === "car");
  const atHome = onHand.filter((piece) => piece.place === "home");
  cards.push({
    id: "place",
    question: lang === "es" ? "¿Qué puedo enviar desde casa?" : "What can I ship from home?",
    horizon: H_TODAY,
    title: inCar.length ? (lang === "es" ? `${list(inCar.map((piece) => piece.name), lang)} ${inCar.length === 1 ? "está" : "están"} en el carro` : `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car`) : (lang === "es" ? "Lugar" : "Location"),
    tone: inCar.length ? "watch" : "ready",
    pieceIds: inCar.map((piece) => piece.id),
    body: inCar.length
      ? (lang === "es" ? `${list(inCar.map((piece) => piece.name), lang)} ${inCar.length === 1 ? "está" : "están"} en el carro. ${inCar.length === 1 ? "Muévela" : "Muévelas"} a casa antes de prometer un envío. ${atHome.length ? `${qty(atHome)} ${qty(atHome) === 1 ? "pieza ya está" : "piezas ya están"} en casa.` : "Nada en inventario está marcado en casa."}` : `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car. Move ${inCar.length === 1 ? "it" : "them"} home before you promise a shipment. ${atHome.length ? `${qty(atHome)} ${qty(atHome) === 1 ? "piece is" : "pieces are"} already home.` : "Nothing on hand is marked home."}`)
      : atHome.length
        ? (lang === "es" ? `${qty(atHome)} en inventario ${qty(atHome) === 1 ? "está marcada" : "están marcadas"} en casa. El resto no tiene lugar en la tarjeta, así que no voy a adivinar.` : `${qty(atHome)} on hand ${qty(atHome) === 1 ? "is" : "are"} marked home. The rest have no place on the card, so I will not guess.`)
        : (lang === "es" ? "Ninguna pieza en inventario está marcada en casa o en el carro. Agrega el lugar cuando lo sepas: no voy a inventar uno." : "No on-hand piece is marked home or car. Add the place when you know it — I will not invent one."),
  });

  if (mode === "selling") {
    const lesson = [...priced].sort((a, b) => (b.soldOn ?? "").localeCompare(a.soldOn ?? ""))[0];
    if (lesson && lesson.saleCents != null) {
      const days = daysHeld(lesson.receivedOn, lesson.soldOn);
      // A sale with no cost on its card has an unknown profit, never a 100% one (1.1.2).
      const gained = lesson.costCents > 0 ? netOf(lesson, ads) : null;
      cards.unshift({
        id: "lesson",
        question: lang === "es" ? "¿Qué enseñó la última venta?" : "What did the last sale teach?",
        horizon: H_STRETCH,
        title: priced.length === 1 ? (lang === "es" ? `${lesson.name} es una lección, no un patrón` : `${lesson.name} is one lesson, not a pattern`) : (lang === "es" ? `${lesson.name} es la venta más reciente` : `${lesson.name} is the latest sale`),
        tone: gained != null && gained < 0 ? "loss" : "ready",
        pieceIds: [lesson.id],
        body: lang === "es" ? `${lesson.name} entró en ${money(lesson.saleCents)} ${lesson.costCents > 0 ? `contra un costo de ${money(lesson.costCents)}` : "sin costo en su tarjeta"}${days != null ? ` y ${days} días en inventario` : ", sin fecha de llegada, así que los días no se conocen"}. La ganancia neta — lo que quedó después del costo y de cualquier anuncio con este nombre, antes de tarifas que no tengo — es ${gained == null ? "desconocida hasta que el costo esté en la tarjeta" : money(gained)}.${gained != null && days != null && days > 0 ? ` La velocidad es ${money(Math.round(gained / days))} al día, con lo que puedo ver.` : ""} ${priced.length === 1 ? "Una venta no te dice qué comprar después." : "Vuelve a comprar solo donde este tipo, talla y lugar de compra lo hayan hecho más de una vez."}` : `${lesson.name} came in at ${money(lesson.saleCents)} ${lesson.costCents > 0 ? `against ${money(lesson.costCents)} cost` : "with no cost on its card"}${days != null ? ` and ${days} days on hand` : ", with no arrival date, so the days are unknown"}. Net profit — what stayed after cost and any ad on this name, before fees I do not have — is ${gained == null ? "unknown until the cost is on the card" : money(gained)}.${gained != null && days != null && days > 0 ? ` Speed is ${money(Math.round(gained / days))} a day, with what I can see.` : ""} ${priced.length === 1 ? "One sale does not tell you what to buy next." : "Buy again only where this type, size and source have done it more than once."}`,
      });
    }
  }

  const late = incoming
    .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null, clock) }))
    .filter((row): row is { piece: Piece; days: number } => row.days != null && row.days > 30);
  const undatedIncoming = incoming.filter((piece) => !piece.receivedOn);
  if (late.length || undatedIncoming.length) {
    const lateCost = late.reduce((sum, row) => sum + row.piece.costCents * row.piece.qty, 0);
    cards.push({
      id: "late",
      question: lang === "es" ? "¿Ya llegó?" : "Has it arrived?",
      horizon: H_TODAY,
      title: late.length ? (lang === "es" ? `Pregunta por ${list(late.map((row) => row.piece.name), lang)}` : `Ask about ${list(late.map((row) => row.piece.name))}`) : (lang === "es" ? `Pide una fecha para ${list(undatedIncoming.map((piece) => piece.name), lang)}` : `Ask for a date on ${list(undatedIncoming.map((piece) => piece.name))}`),
      tone: "watch",
      pieceIds: [...late.map((row) => row.piece.id), ...undatedIncoming.map((piece) => piece.id)],
      body: [
        late.length
          ? (lang === "es" ? `${list(late.map((row) => `${row.piece.name} lleva ${row.days} días en camino desde la fecha de la tarjeta`), lang)}. Pasados 30 días pregunto, porque no hay una promesa de llegada aparte. No se puede vender, y ${money(lateCost)} no es una pérdida a menos que digas que la pieza se perdió.` : `${list(late.map((row) => `${row.piece.name} has been incoming ${row.days} days from the date on the card`))}. Past 30 days I ask, because there is no separate arrival promise. Not sellable, and ${money(lateCost)} is not a loss unless you say the piece is gone.`)
          : "",
        undatedIncoming.length
          ? (lang === "es" ? `${list(undatedIncoming.map((piece) => piece.name), lang)} ${undatedIncoming.length === 1 ? "sigue" : "siguen"} en camino sin fecha, así que no puedo decir si ${undatedIncoming.length === 1 ? "va" : "van"} con retraso. No se puede vender, y no es una pérdida.` : `${list(undatedIncoming.map((piece) => piece.name))} ${undatedIncoming.length === 1 ? "is" : "are"} still incoming with no date, so I cannot tell if ${undatedIncoming.length === 1 ? "it is" : "they are"} late. Not sellable, and not a loss.`)
          : "",
      ].filter(Boolean).join(" "),
    });
  }

  const sourced = live.filter((piece) => piece.source.trim());
  const sourceNames = [...new Set(sourced.map((piece) => piece.source.trim()))];
  cards.push({
    id: "sources",
    question: lang === "es" ? "¿Qué lugar de compra se gana la próxima compra?" : "Which source earns the next buy?",
    horizon: H_STRETCH,
    title: sales.length === 0 ? (lang === "es" ? "Ningún lugar se ha ganado una compra repetida" : "No source has earned a repeat buy") : (lang === "es" ? "Clasifica solo lo que se vendió" : "Rank only what sold"),
    tone: "watch",
    pieceIds: sourced.map((piece) => piece.id),
    body: sales.length === 0
      ? sourceNames.length
        ? (lang === "es" ? `${list(sourceNames, lang)} ${sourceNames.length === 1 ? "está escrito" : "están escritos"} en las tarjetas. Nada de ahí se ha vendido, así que esto no es una clasificación.` : `${list(sourceNames)} ${sourceNames.length === 1 ? "is" : "are"} written on the cards. Nothing from there has sold, so this is not a ranking.`)
        : (lang === "es" ? "El lugar de compra está vacío. No voy a inventar un lugar, ni clasificar uno." : "Bought-from is empty. I will not invent a source, and I will not rank one.")
      : sourceNote(sold, lang),
  });

  const month = todayD.getMonth();
  const bootSeason = month >= 8 || month <= 1;
  if (bootSeason && boots.length) {
    cards.push({
      id: "season",
      question: lang === "es" ? "¿Es la temporada?" : "Is this the season?",
      horizon: H_STRETCH,
      title: lang === "es" ? "La temporada de botas es una pregunta, no una promesa" : "Boot season is a question, not a promise",
      tone: "watch",
      pieceIds: boots.filter((piece) => piece.status === "available").map((piece) => piece.id),
      body: lang === "es" ? `Estamos en los meses en que las botas suelen mirarse. ¿Tus ${qty(boots.filter((piece) => piece.status === "available"))} botas en inventario están publicadas con talla? No puedo prometer que se vendan.` : `We are in the months when boots usually get looked at. Are your ${qty(boots.filter((piece) => piece.status === "available"))} boots on hand listed with a size? I cannot promise they will sell.`,
    });
  }

  const actionBody = first
    ? missingOf(first).length
      ? (lang === "es" ? `Abre ${first.name}. Costó ${money(first.costCents)}. Agrega ${list(missingWords(first, lang), lang)} antes de publicarla.` : `Open ${first.name}. It cost ${money(first.costCents)}. Add ${list(missingOf(first))} before you list it.`)
      : (lang === "es" ? `${first.name} tiene la tarjeta que un comprador necesita. Todavía no veo una fecha de publicación: publícala y luego escribe ese día.` : `${first.name} has the card a buyer needs. I still cannot see a listing date — list it, then write that day down.`)
    : (lang === "es" ? "Agrega la primera pieza con su costo y su fecha." : "Add the first piece with its cost and date.");

  const stage = mode === "startup" ? (lang === "es" ? "Semana de arranque" : "Setup week") : net >= 0 ? (lang === "es" ? "Tus piezas se están moviendo" : "Your pieces are moving") : (lang === "es" ? "Una venta quedó corta" : "A sale came back short");
  const headline = mode === "startup"
    ? (lang === "es" ? `Sin ventas todavía: es una semana de arranque, no un veredicto. ${money(committed)} está comprometido: ${qty(onHand)} en inventario ${money(onHandCents)}, ${qty(incoming)} en camino ${money(incomingCents)}. El trabajo es la primera venta.` : `No sales yet — this is a setup week, not a verdict. ${money(committed)} is committed: ${qty(onHand)} on hand ${money(onHandCents)}, ${qty(incoming)} on the way ${money(incomingCents)}. The job is the first sale.`)
    : (lang === "es" ? `${qty(priced)} ${qty(priced) === 1 ? "venta con precio ha" : "ventas con precio han"} traído ${money(revenue)}. ${money(net)} quedó después del costo y los anuncios. Eso es ganancia neta, no ingreso. Las tarifas no están en la tarjeta.` : `${qty(priced)} priced ${qty(priced) === 1 ? "sale has" : "sales have"} brought ${money(revenue)} in. ${money(net)} stayed after cost and ads. That is net profit, not revenue. Fees are not on the card.`);

  const lines: Record<string, string> = {
    numbers: mode === "startup"
      ? (lang === "es" ? `${money(committed)} está comprometido y nada de eso es ganancia todavía: el ingreso se queda en $0.00 hasta que una pieza se venda de verdad.` : `${money(committed)} is committed and none of it is profit yet — revenue stays $0.00 until a piece actually sells.`)
      : (lang === "es" ? `Entraron ${money(revenue)} y quedaron ${money(net)} después del costo y los anuncios. Las tarifas aún no se conocen, así que no leas el ingreso como ganancia.` : `${money(revenue)} came in and ${money(net)} stayed after cost and ads. Fees are still unknown, so do not read revenue as profit.`),
    stretch: datedSales.length
      ? (lang === "es" ? `Solo ${datedSales.length} ${datedSales.length === 1 ? "venta con fecha está" : "ventas con fecha están"} en esta comparación. Una venta sin fecha queda fuera.` : `Only ${datedSales.length} dated ${datedSales.length === 1 ? "sale is" : "sales are"} in this comparison. A sale with no date stays out.`)
      : (lang === "es" ? "Sin ventas con fecha para comparar. Una venta sin fecha no puede entrar en este tramo." : "No dated sales to compare. A sale without a date cannot enter this stretch."),
    time: datedSales.length
      ? (lang === "es" ? "Las barras usan solo fechas de venta. Las ventas sin fecha se dejan fuera a propósito." : "The bars use sale dates only. Undated sales are left out on purpose.")
      : (lang === "es" ? "No hay ninguna venta con fecha, así que este gráfico todavía no puede mostrar un ritmo." : "There is no dated sale, so this chart cannot show a pace yet."),
    product: sales.length
      ? (lang === "es" ? "Compara las piezas que se vendieron. Las retiradas y guardadas no están en esta clasificación." : "Compare pieces that sold. Removed and kept pieces are not in this ranking.")
      : (lang === "es" ? "Nada se ha vendido, así que todavía no hay clasificación de productos." : "Nothing has sold, so there is no product ranking yet."),
    where: lang === "es" ? `En inventario y en camino están comprometidos (${money(committed)}). Solo las piezas vendidas entran en ingresos. Las retiradas, no.${kept.length ? ` ${list(kept.map((piece) => piece.name), lang)} ${kept.length === 1 ? "es posesión y no está en estas tarjetas" : "son posesión y no están en estas tarjetas"}.` : ""}` : `On hand and incoming are committed (${money(committed)}). Only sold pieces enter revenue. Removed pieces do not.${kept.length ? ` ${list(kept.map((piece) => piece.name))} ${kept.length === 1 ? "is" : "are"} possession and not in these tiles.` : ""}`,
    sizes: sizeless.length
      ? (lang === "es" ? `A ${list(sizeless.map((piece) => piece.name), lang)} le falta la talla: arréglalo antes de leer qué talla se vende.` : `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "has" : "have"} no size — fix that before reading which size sells.`)
      : (lang === "es" ? "Las piezas con talla en inventario la tienen puesta. Las ventas mostrarán qué talla sale." : "Sized pieces on hand have a size. Sales will show which size leaves."),
    sources: lang === "es" ? "Un lugar de compra se gana la confianza solo después de que sus piezas se venden. Sin ventas, esta lista es de dónde vinieron, no una clasificación." : "A source earns trust only after its pieces sell. With no sales, this list is where they came from, not a ranking.",
    place: inCar.length
      ? (lang === "es" ? `${list(inCar.map((piece) => piece.name), lang)} ${inCar.length === 1 ? "está" : "están"} en el carro: ${inCar.length === 1 ? "tráela" : "tráelas"} a casa antes de un envío.` : `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car — bring ${inCar.length === 1 ? "it" : "them"} home before a shipment.`)
      : (lang === "es" ? "Nada vendible está marcado en el carro." : "Nothing sellable is marked in the car."),
    ads: lang === "es" ? "No promociones hasta que el margen después del anuncio sea visible. Las tarifas no están en la tarjeta, así que ese número no está listo." : "Do not promote until the margin after the ad is visible. Fees are not on the card, so that number is not ready.",
  };

  const plan = lang === "es" ? [
    "Plan de Ventory",
    first ? `Hoy: termina ${first.name} (${missingOf(first).length ? list(missingWords(first, lang), lang) : "publícala y escribe el día"}).` : "Hoy: agrega una pieza con su costo.",
    `Esta semana: deja listas las ${onHandQty} en inventario, y escribe un punto de equilibrio por encima del costo cuando se conozcan las tarifas.`,
    incoming.length ? `Cuando llegue ${incoming[0].name} (${money(incoming[0].costCents)}), escribe su fecha antes de guardarla.` : "Ninguna pieza viene en camino.",
    "Este mes: ninguna compra nueva hasta que algo se venda. Si una pieza publicada lleva 30 días, usa la escalera: foto, título, luego una rebaja numerada.",
    "En la primera venta: escribe el precio y la fecha, luego los días que esperó. Una venta es una lección, no un patrón.",
  ].join("\n") : [
    "Ventory plan",
    first ? `Today: finish ${first.name} (${missingOf(first).length ? list(missingOf(first)) : "list it and write the day"}).` : "Today: add a piece with its cost.",
    `This week: get the ${onHandQty} on hand ready, and write a break-even above cost once fees are known.`,
    incoming.length ? `When ${incoming[0].name} arrives (${money(incoming[0].costCents)}), write its date before you shelve it.` : "No piece is on the way.",
    "This month: no new buy until something sells. If a listed piece sits 30 days, use the ladder: photo, title, then a numbered cut.",
    "On the first sale: write the price and the date, then the days it sat. One sale is a lesson, not a pattern.",
  ].join("\n");

  return {
    mode,
    stage,
    headline,
    ready: readyQty,
    onHandCents,
    oldestLabel: oldest ? `${oldest.piece.name} · ${oldest.days}d` : undatedHand.length ? (lang === "es" ? "Sin fecha todavía" : "No date yet") : "—",
    actionTitle: first ? first.name : (lang === "es" ? "Agrega una pieza" : "Add a piece"),
    actionBody,
    actionPieceId: first?.id ?? null,
    cards,
    plan,
    lines,
  };
}
