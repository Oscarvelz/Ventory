import { daysHeld, money, type Ad, type Piece } from "./model";

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
  if (piece.saleCents == null) return null;
  return piece.saleCents * piece.qty - piece.costCents * piece.qty - adSpend(piece, ads);
}

function list(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function iso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function removalReason(piece: Piece) {
  const match = piece.notes.match(/Removed:\s*([^·\n]+)/i);
  return match?.[1]?.trim() ?? "";
}

function sourceNote(sold: Piece[]) {
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
  if (!best) return "No sold piece names a source, so the next buy cannot cite one.";
  if (best.n < 2) return `${best.name} has one sale. That source is a lesson, not a pattern.`;
  const avg = best.days.length ? Math.round(best.days.reduce((sum, days) => sum + days, 0) / best.days.length) : null;
  return `${best.name} sold ${best.n} times${avg != null ? ` in about ${avg} days` : ""}. Cite that before buying there again.`;
}

function ladder(piece: Piece, days: number) {
  const ask = piece.askCents > 0 ? piece.askCents : null;
  const cut = ask != null ? Math.round(ask * 0.9) : null;
  const left = cut != null ? cut - piece.costCents : null;
  if (days <= 14) return `${piece.name} is inside the normal window (${days} days from arrival — there is no listing date on the card). Check that the card stays complete.`;
  if (days <= 30) return `${piece.name} has sat ${days} days. Review the photo, put the size and brand in the title, and set the asking price against its break-even. Break-even is the lowest price that leaves you whole: at least the $${(piece.costCents / 100).toFixed(2)} it cost, until fees and shipping are on the card.`;
  if (days <= 60 && cut != null && left != null) return `${piece.name} has sat ${days} days. A first cut of about 10% would ask ${money(cut)}. If it sells there, about ${money(left)} stays after cost — fees are still unknown, so that is not the final net.`;
  if (days <= 90) return `${piece.name} has sat ${days} days. Decide: a measured ad only if the margin after the ad stays above cost, a bundle, or a lower ask. I will not name a profit I cannot see.`;
  return `${piece.name} is cold at ${days} days. Aging means how long a piece has been sitting; past 90 days, recovering the ${money(piece.costCents)} cost beats waiting for a dream price. You can sell at cost, keep it on purpose, or remove it.`;
}

export function buildAdvice(pieces: Piece[], ads: Ad[], today = new Date()): Advice {
  const onHand = pieces.filter((piece) => piece.status === "available");
  const incoming = pieces.filter((piece) => piece.status === "incoming");
  const sold = pieces.filter(isSale);
  const removed = pieces.filter(isRemoved);
  const kept = pieces.filter(isKept);
  const live = pieces.filter((piece) => !isRemoved(piece) && !isKept(piece));
  const onHandCents = costOf(onHand);
  const incomingCents = costOf(incoming);
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

  const clock = iso(today);
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
  const revenue = priced.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
  const soldCost = priced.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
  const adOnSales = priced.reduce((sum, piece) => sum + adSpend(piece, ads), 0);
  const net = revenue - soldCost - adOnSales;

  const readyCost = costOf(readyPieces);
  const cards: AdviceCard[] = [];

  cards.push({
    id: "ready",
    question: "What is ready?",
    horizon: "Today",
    title: onHandQty === 0
      ? "Nothing on hand to list"
      : readyQty === 0
        ? `None of the ${onHandQty} on hand are ready yet`
        : `${readyQty} of ${onHandQty} on hand are ready`,
    tone: readyQty === onHandQty && onHandQty > 0 ? "ready" : "watch",
    pieceIds: incomplete.map((piece) => piece.id),
    body: onHandQty === 0
      ? "Nothing is on hand to list. Incoming pieces are paid for, not sellable yet."
      : incomplete.length === 0
        ? `${readyQty} of ${onHandQty} on hand are ready: size where the type needs it, photo, cost, asking price, date, brand, bought-from and place are on the card. ${money(readyCost)} can be listed. I still have no listing date, so I will not call them published. Condition is not a field, so I will not invent it.`
        : `${readyQty === 0 ? "" : `${readyQty} of ${onHandQty} are ready (${Math.round((readyQty / onHandQty) * 100)}%), ${money(readyCost)} that can be listed. `}${list(incomplete.map((piece) => `${piece.name} needs ${list(missingOf(piece))}`))}. A boot without a size is hard for a buyer to find. There is no listing date, so I will not call a piece published. Condition is not a field, so I will not invent it.`,
  });

  if (average != null) {
    const sample = onHand.find((piece) => piece.askCents > 0 && piece.askCents < piece.costCents) ?? onHand[0];
    const below = sample && sample.askCents > 0 && sample.askCents < sample.costCents;
    cards.push({
      id: "price",
      question: "What should I charge?",
      horizon: "Today",
      title: `On-hand pieces cost ${money(average)} each`,
      tone: below ? "loss" : "watch",
      pieceIds: onHand.map((piece) => piece.id),
      body: below && sample
        ? `${sample.name} is asking ${money(sample.askCents)}, under the ${money(sample.costCents)} it cost. That is below break-even — the lowest price that leaves you whole. Fees and shipping are not on the card, so the real floor is higher, not lower.`
        : `Use ${money(average)} as the floor for a price talk. Break-even is the lowest price that leaves you whole: cost, then fees and shipping. Markup is how much you add over that cost when you set the asking price — before fees take their share. Those fees are not on the card, so I will not invent them. ${first ? `${first.name} needs an asking price above its ${money(first.costCents)} cost before anyone promotes it.` : ""}`,
    });
  }

  const cold = ages.filter((row) => row.days > 60);
  const removalLessons = removed
    .map((piece) => {
      const reason = removalReason(piece);
      return reason ? `${piece.name} left as ${reason} (${money(piece.costCents)}). That is a lesson for the next buy, not a sale.` : "";
    })
    .filter(Boolean);
  const unrecovered = removed.filter((piece) => /gifted|damaged/i.test(removalReason(piece)) && piece.costCents > 0);
  cards.push({
    id: "buy",
    question: "What do I buy?",
    horizon: "This stretch",
    title: mode === "startup" ? "Hold the next purchase" : "Buy only what already moved",
    tone: "watch",
    pieceIds: [...incoming, ...onHand].map((piece) => piece.id),
    body: mode === "startup"
      ? `There is no sell-through yet — of every 10 pieces you put up, how many actually sold. Nothing has, so this is not evidence. ${money(committed)} is committed (${qty(onHand)} on hand ${money(onHandCents)}, ${qty(incoming)} on the way ${money(incomingCents)}). ${bootShare ? `${qty(boots)} of ${qty(live)} pieces are ${topType} (${bootShare}%). Quiet and concentrated is the risk; concentrated and selling would be the strategy, and nothing has sold.` : ""} Sleeping capital would be a piece listed more than 60 days. There is no listing date, so I will not call the ${money(committed)} sleeping — the ${money(incomingCents)} on the way only raises what is committed, with no demand yet. ${cold.length ? `${list(cold.map((row) => row.piece.name))} ${cold.length === 1 ? "has" : "have"} been here past 60 days from arrival, which is not the same thing.` : ""} Wait for a first sale before buying more, unless you call one piece a deliberate test. ${removalLessons.join(" ")}`
      : `Sell-through — of every 10 pieces you put up, how many sold — is ${qty(sold)} sold against ${qty(onHand)} still on hand. ${bootShare ? `${topType} are ${bootShare}% of what you are holding. ${sales.length < 2 ? "Quiet and concentrated stays a risk until that type sells more than once." : "If that type is what sold, the concentration is a strategy."}` : ""} ${sourceNote(sold)} A single sale is a lesson, not a pattern. ${removalLessons.join(" ")}`,
  });

  const promotable = onHand.filter((piece) => piece.askCents > piece.costCents && piece.costCents > 0);
  cards.push({
    id: "ads",
    question: "Should I promote?",
    horizon: "Today",
    title: ads.reduce((sum, ad) => sum + ad.spentCents, 0) === 0 ? "Do not promote yet" : "Count the ad against the piece",
    tone: "watch",
    pieceIds: promotable.map((piece) => piece.id),
    body: ads.length === 0
      ? "Ad spend is $0.00. I will not tell you to promote until I can show the money left after the ad. Asking prices and fees are not both known, so that margin is not on the card."
      : `You have spent ${money(ads.reduce((sum, ad) => sum + ad.spentCents, 0))} promoting by product name. Subtract it from that piece's net — what is really yours after cost, fees, shipping and the ad. Fees are still unknown, so I will not call a promotion a win.`,
  });

  cards.push({
    id: "states",
    question: "What counts where?",
    horizon: "Today",
    title: "Only a sale enters revenue",
    tone: unrecovered.length ? "loss" : "ready",
    pieceIds: [...kept, ...removed].map((piece) => piece.id),
    body: `Sold pieces enter revenue. On hand (${money(onHandCents)}) and incoming (${money(incomingCents)}) are committed capital, not sales. Tied-up capital is money sleeping on the shelf — not lost, but it cannot work anywhere else until the piece sells — and I will not call this tied up without a listing date. Archive ${removed.length === 0 ? "is empty and is not in the revenue numbers. A piece you remove without a sale stays out of revenue." : `holds ${list(removed.map((piece) => piece.name))} removed without a sale — removed means it left without selling, and it is not revenue.${unrecovered.length ? ` ${list(unrecovered.map((piece) => piece.name))} did not come back, so that cost is a real loss.` : " I will not call it a loss unless the cost did not come back."}`} If a sale comes back, clearing it reverses that revenue. There is no return-date field, so the reversal is not placed in a week; the piece is on hand again and its days count from the arrival date. ${kept.length ? `${list(kept.map((piece) => `${piece.name} (${money(costOf([piece]))})`))} ${kept.length === 1 ? "is" : "are"} kept: a piece you decided is yours. That cost is possession, not a failed sale and not a loss.` : "Kept means a piece you decided is yours. It leaves the selling game on purpose — not a failed sale."}`,
  });

  const dateNames = [...undatedHand.map((piece) => piece.name), ...undatedSales.map((piece) => piece.name)];
  cards.push({
    id: "dates",
    question: "Which date is missing?",
    horizon: "Today",
    title: datedSales.length === 0 ? "No dated sale to learn from" : `${datedSales.length} dated ${datedSales.length === 1 ? "sale" : "sales"}`,
    tone: dateNames.length || undatedSales.length ? "watch" : "ready",
    pieceIds: [...undatedHand, ...undatedSales].map((piece) => piece.id),
    body: datedSales.length === 0
      ? `There is no dated sale yet. When the first piece sells, write the day it left — without that date I cannot say how long the money sat. ${undatedHand.length ? `${list(undatedHand.map((piece) => piece.name))} also ${undatedHand.length === 1 ? "has" : "have"} no arrival date, so age is unknown.` : "Arrival dates that are missing will be asked for by name."}`
      : `${list(datedSales.map((piece) => piece.name))} ${datedSales.length === 1 ? "has" : "have"} a sale date, so only ${datedSales.length === 1 ? "that one" : "those"} can be compared across weeks. ${undatedSales.length ? `${list(undatedSales.map((piece) => piece.name))} sold with no date and stays out of the comparison until you add it.` : ""}`,
  });

  const sizeless = onHand.filter((piece) => needsSize(piece) && !piece.usSize && !piece.sizeLabel);
  if (sizeless.length || boots.length) {
    cards.push({
      id: "sizes",
      question: "Which size can a buyer filter?",
      horizon: "Today",
      title: sizeless.length ? `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "has" : "have"} no size` : "Sizes are on the cards",
      tone: sizeless.length ? "watch" : "ready",
      pieceIds: sizeless.map((piece) => piece.id),
      body: sizeless.length
        ? `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "is" : "are"} missing a size. Online, a buyer filters by size before the photo. Put the size on ${sizeless[0].name} before anything else on that card.`
        : "Every sized piece on hand has a size. When sales exist, the size that leaves is the one to buy again.",
    });
  }

  if (oldest) cards.push({
    id: "aging",
    question: "What has sat too long?",
    horizon: "This stretch",
    title: oldest.days > 60 ? `${oldest.piece.name} is getting cold` : `${oldest.piece.name} is the oldest`,
    tone: oldest.days > 90 ? "watch" : oldest.days > 30 ? "watch" : "ready",
    pieceIds: ages.map((row) => row.piece.id),
    body: `${oldest.days > 90 ? "" : "Aging is how long a piece has been sitting. "}${ladder(oldest.piece, oldest.days)} The clock is the arrival date, not a listing date. ${[
      ["0–30", ages.filter((row) => row.days <= 30).length],
      ["31–60", ages.filter((row) => row.days > 30 && row.days <= 60).length],
      ["61–90", ages.filter((row) => row.days > 60 && row.days <= 90).length],
      ["90+", ages.filter((row) => row.days > 90).length],
    ].filter(([, count]) => count).map(([label, count]) => `${count} in ${label}`).join(", ")}.`,
  });

  const inCar = onHand.filter((piece) => piece.place === "car");
  const atHome = onHand.filter((piece) => piece.place === "home");
  cards.push({
    id: "place",
    question: "What can I ship from home?",
    horizon: "Today",
    title: inCar.length ? `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car` : "Location",
    tone: inCar.length ? "watch" : "ready",
    pieceIds: inCar.map((piece) => piece.id),
    body: inCar.length
      ? `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car. Move ${inCar.length === 1 ? "it" : "them"} home before you promise a shipment. ${atHome.length ? `${qty(atHome)} ${qty(atHome) === 1 ? "piece is" : "pieces are"} already home.` : "Nothing on hand is marked home."}`
      : atHome.length
        ? `${qty(atHome)} on hand ${qty(atHome) === 1 ? "is" : "are"} marked home. The rest have no place on the card, so I will not guess.`
        : "No on-hand piece is marked home or car. Add the place when you know it — I will not invent one.",
  });

  if (mode === "selling") {
    const lesson = [...priced].sort((a, b) => (b.soldOn ?? "").localeCompare(a.soldOn ?? ""))[0];
    if (lesson && lesson.saleCents != null) {
      const days = daysHeld(lesson.receivedOn, lesson.soldOn);
      const gained = netOf(lesson, ads);
      cards.unshift({
        id: "lesson",
        question: "What did the last sale teach?",
        horizon: "This stretch",
        title: priced.length === 1 ? `${lesson.name} is one lesson, not a pattern` : `${lesson.name} is the latest sale`,
        tone: gained != null && gained < 0 ? "loss" : "ready",
        pieceIds: [lesson.id],
        body: `${lesson.name} came in at ${money(lesson.saleCents)} against ${money(lesson.costCents)} cost${days != null ? ` and ${days} days on hand` : ", with no arrival date, so the days are unknown"}. Net profit — what stayed after cost and any ad on this name, before fees I do not have — is ${gained == null ? "unknown" : money(gained)}.${gained != null && days != null && days > 0 ? ` Speed is ${money(Math.round(gained / days))} a day, with what I can see.` : ""} ${priced.length === 1 ? "One sale does not tell you what to buy next." : "Buy again only where this type, size and source have done it more than once."}`,
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
      question: "Has it arrived?",
      horizon: "Today",
      title: late.length ? `Ask about ${list(late.map((row) => row.piece.name))}` : `Ask for a date on ${list(undatedIncoming.map((piece) => piece.name))}`,
      tone: "watch",
      pieceIds: [...late.map((row) => row.piece.id), ...undatedIncoming.map((piece) => piece.id)],
      body: [
        late.length
          ? `${list(late.map((row) => `${row.piece.name} has been incoming ${row.days} days from the date on the card`))}. Past 30 days I ask, because there is no separate arrival promise. Not sellable, and ${money(lateCost)} is not a loss unless you say the piece is gone.`
          : "",
        undatedIncoming.length
          ? `${list(undatedIncoming.map((piece) => piece.name))} ${undatedIncoming.length === 1 ? "is" : "are"} still incoming with no date, so I cannot tell if ${undatedIncoming.length === 1 ? "it is" : "they are"} late. Not sellable, and not a loss.`
          : "",
      ].filter(Boolean).join(" "),
    });
  }

  const sourced = live.filter((piece) => piece.source.trim());
  const sourceNames = [...new Set(sourced.map((piece) => piece.source.trim()))];
  cards.push({
    id: "sources",
    question: "Which source earns the next buy?",
    horizon: "This stretch",
    title: sales.length === 0 ? "No source has earned a repeat buy" : "Rank only what sold",
    tone: "watch",
    pieceIds: sourced.map((piece) => piece.id),
    body: sales.length === 0
      ? sourceNames.length
        ? `${list(sourceNames)} ${sourceNames.length === 1 ? "is" : "are"} written on the cards. Nothing from there has sold, so this is not a ranking.`
        : "Bought-from is empty. I will not invent a source, and I will not rank one."
      : sourceNote(sold),
  });

  const month = today.getMonth();
  const bootSeason = month >= 8 || month <= 1;
  if (bootSeason && boots.length) {
    cards.push({
      id: "season",
      question: "Is this the season?",
      horizon: "This stretch",
      title: "Boot season is a question, not a promise",
      tone: "watch",
      pieceIds: boots.filter((piece) => piece.status === "available").map((piece) => piece.id),
      body: `We are in the months when boots usually get looked at. Are your ${qty(boots.filter((piece) => piece.status === "available"))} boots on hand listed with a size? I cannot promise they will sell.`,
    });
  }

  const actionBody = first
    ? missingOf(first).length
      ? `Open ${first.name}. It cost ${money(first.costCents)}. Add ${list(missingOf(first))} before you list it.`
      : `${first.name} has the card a buyer needs. I still cannot see a listing date — list it, then write that day down.`
    : "Add the first piece with its cost and date.";

  const stage = mode === "startup" ? "Setup week" : net >= 0 ? "Your pieces are moving" : "A sale came back short";
  const headline = mode === "startup"
    ? `No sales yet — this is a setup week, not a verdict. ${money(committed)} is committed: ${qty(onHand)} on hand ${money(onHandCents)}, ${qty(incoming)} on the way ${money(incomingCents)}. The job is the first sale.`
    : `${qty(priced)} priced ${qty(priced) === 1 ? "sale has" : "sales have"} brought ${money(revenue)} in. ${money(net)} stayed after cost and ads. That is net profit, not revenue. Fees are not on the card.`;

  const lines: Record<string, string> = {
    numbers: mode === "startup"
      ? `${money(committed)} is committed and none of it is profit yet — revenue stays $0.00 until a piece actually sells.`
      : `${money(revenue)} came in and ${money(net)} stayed after cost and ads. Fees are still unknown, so do not read revenue as profit.`,
    stretch: datedSales.length
      ? `Only ${datedSales.length} dated ${datedSales.length === 1 ? "sale is" : "sales are"} in this comparison. A sale with no date stays out.`
      : "No dated sales to compare. A sale without a date cannot enter this stretch.",
    time: datedSales.length
      ? "The bars use sale dates only. Undated sales are left out on purpose."
      : "There is no dated sale, so this chart cannot show a pace yet.",
    product: sales.length
      ? "Compare pieces that sold. Removed and kept pieces are not in this ranking."
      : "Nothing has sold, so there is no product ranking yet.",
    where: `On hand and incoming are committed (${money(committed)}). Only sold pieces enter revenue. Removed pieces do not.${kept.length ? ` ${list(kept.map((piece) => piece.name))} ${kept.length === 1 ? "is" : "are"} possession and not in these tiles.` : ""}`,
    sizes: sizeless.length
      ? `${list(sizeless.map((piece) => piece.name))} ${sizeless.length === 1 ? "has" : "have"} no size — fix that before reading which size sells.`
      : "Sized pieces on hand have a size. Sales will show which size leaves.",
    sources: "A source earns trust only after its pieces sell. With no sales, this list is where they came from, not a ranking.",
    place: inCar.length
      ? `${list(inCar.map((piece) => piece.name))} ${inCar.length === 1 ? "is" : "are"} in the car — bring ${inCar.length === 1 ? "it" : "them"} home before a shipment.`
      : "Nothing sellable is marked in the car.",
    ads: "Do not promote until the margin after the ad is visible. Fees are not on the card, so that number is not ready.",
  };

  const plan = [
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
    oldestLabel: oldest ? `${oldest.piece.name} · ${oldest.days}d` : undatedHand.length ? "No date yet" : "—",
    actionTitle: first ? first.name : "Add a piece",
    actionBody,
    actionPieceId: first?.id ?? null,
    cards,
    plan,
    lines,
  };
}
