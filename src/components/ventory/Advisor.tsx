import { useMemo, useState, type ReactNode } from "react";
import { CalendarRange, Camera, Check, ChevronDown, Copy, ClipboardList, Hourglass, Info, Repeat, TrendingDown, Lightbulb, Megaphone, Ruler, ShoppingBag, Store, Tags, Timer, type LucideIcon } from "lucide-react";
import type { Advice, AdviceCard } from "@/lib/ventory/advisor";
import { missingLabel, missingOf } from "@/lib/ventory/advisor";
import { tx, type Lang } from "@/lib/ventory/i18n";
import { daysHeld, money, todayISO, type Ad, type Piece } from "@/lib/ventory/model";
import { askInventory, type AskAnswer } from "@/lib/ventory/ask";
import { tone as litTone, toneInk } from "@/lib/ventory/tones";
import { moveList, priceList, restockList } from "@/lib/ventory/insights";
import { ageTone, cash, halfSize, measure, pct, TONES } from "@/lib/ventory/metrics";
import { commas } from "@/lib/ventory/export/model";
import { AgeColumns, PairBars, PriceTrack } from "@/components/ventory/charts";

const GREEN = "#5f8f72";
const AMBER = "#b08a3e";
const RED = "#a33b32";
const TEAL = "#4f7f8a";

/** A name that may wrap between words but never inside one: "Casio G-Shock" never breaks as "G-" / "Shock". */
function NoSplit({ text }: { text: string }) {
  // A spaced dash stays at the end of its line ("Design -" / "Ramón"), never leading the next one.
  const words = text.replace(/ ([-–—]) /g, "\u00a0$1 ").split(/(\s+)/);
  return <>{words.map((word, i) => (/\S-\S/.test(word) ? <span key={i} className="whitespace-nowrap">{word}</span> : word))}</>;
}

function ReadyRing({ ready, total }: { ready: number; total: number }) {
  const p = total ? ready / total : 0;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden>
      <circle cx="32" cy="32" r="26" fill="none" stroke={litTone(AMBER)} strokeOpacity={0.4} strokeWidth="8" />
      {p > 0 ? <circle cx="32" cy="32" r="26" fill="none" stroke={litTone(GREEN)} strokeWidth="8" strokeLinecap="round" pathLength={1} strokeDasharray={`${p} 1`} className="gauge-grow" /> : null}
      <text x="32" y="32" dy="0.35em" textAnchor="middle" transform="rotate(90 32 32)" fontSize="15" fontWeight="600" fill="var(--v-ink)" className="tabular-nums">{Math.round(p * 100)}%</text>
    </svg>
  );
}

export type AdviceFocus = "photo" | "size" | "ask" | "brand" | "place" | "date" | "source" | "cost";

const FOCUS_OF: Record<string, AdviceFocus> = {
  photo: "photo",
  size: "size",
  "asking price": "ask",
  brand: "brand",
  place: "place",
  date: "date",
  "bought from": "source",
  cost: "cost",
};

const BUTTON_KEY: Record<AdviceFocus, "adv.addPhoto" | "adv.addSize" | "adv.setPrice" | "adv.addBrand" | "adv.setPlace" | "adv.addDate" | "adv.addSource" | "adv.addCost"> = {
  photo: "adv.addPhoto",
  size: "adv.addSize",
  ask: "adv.setPrice",
  brand: "adv.addBrand",
  place: "adv.setPlace",
  date: "adv.addDate",
  source: "adv.addSource",
  cost: "adv.addCost",
};

function buttonFor(focus: AdviceFocus, lang: Lang): string {
  return tx(lang, BUTTON_KEY[focus]);
}

const GLANCE = new Set(["buy", "ads", "sources", "season", "lesson"]);

function focusOf(piece: Piece): AdviceFocus | null {
  const order = ["photo", "size", "asking price", "brand", "place", "date", "bought from", "cost"];
  const hit = order.find((item) => missingOf(piece).includes(item));
  return hit ? FOCUS_OF[hit] : null;
}

function leadOf(headline: string) {
  const cut = headline.indexOf(". ");
  return (cut === -1 ? headline : headline.slice(0, cut + 1)).replace(/\s+/g, " ").trim();
}

function spoken(text: string) {
  return text
    .replace(/I will not[^.]*/gi, "")
    .replace(/no (?:lo |la |las )?voy a[^.]*/gi, "")
    .replace(/no (?:las )?llamaré[^.]*/gi, "")
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Whole sentences up to about 180 characters; the rest waits behind More (never a sentence cut in half). */
function bySentence(text: string) {
  const clean = spoken(text);
  const parts = clean.split(/(?<=[.!?])\s+/);
  let short = "";
  for (const part of parts) {
    if (short && (short + " " + part).length > 180) break;
    short = short ? `${short} ${part}` : part;
  }
  short = short.trim();
  return { short, rest: clean.slice(short.length).trim() };
}

function sizeName(piece: Piece) {
  if (piece.usSize) return `US ${halfSize(piece.usSize)}`;
  if (piece.sizeLabel) return `${piece.sizeSystem} ${piece.sizeSystem === "US" ? halfSize(piece.sizeLabel) : piece.sizeLabel}`.trim();
  return "";
}

function soldPiece(piece: Piece) {
  return piece.status === "sold" || piece.wasSold;
}

/** The one decision each glance card asks for, in a full sentence (the figure and chart above it carry the numbers). */
function decisionLine(card: AdviceCard, lang: Lang = "en") {
  if (card.id === "buy") return tx(lang, "adv.buyDecision");
  if (card.id === "ads") return tx(lang, "adv.adsDecision");
  if (card.id === "sources") return `${tx(lang, "adv.sourcesDecision")}${spoken(card.body)}`;
  if (card.id === "season") return tx(lang, "adv.seasonDecision");
  return bySentence(card.body).short;
}

function needsLine(piece: Piece, lang: Lang = "en") {
  const missing = missingOf(piece);
  if (missing.includes("size") && /boot|shoe/i.test(`${piece.category} ${piece.name}`)) return tx(lang, "adv.bootNoSize");
  return "";
}

export function AdvisorView({
  advice,
  pieces,
  ads = [],
  lang = "en",
  onOpen,
  onPhoto,
  onKeep,
  onReturn,
  onRemove,
  onFlag,
}: {
  advice: Advice;
  pieces: Piece[];
  ads?: Ad[];
  lang?: Lang;
  onOpen: (piece: Piece, focus?: AdviceFocus) => void;
  onPhoto: (piece: Piece, file: File) => void;
  onKeep: (piece: Piece) => void;
  onReturn: (piece: Piece) => void;
  onRemove: (piece: Piece, reason: string) => void;
  onFlag: (piece: Piece) => void;
}) {
  const [later, setLater] = useState<string[]>([]);
  const [askText, setAskText] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [front, setFront] = useState<string | null>(null);
  const [countOpen, setCountOpen] = useState(false);
  const [more, setMore] = useState<string[]>([]);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [allReady, setAllReady] = useState(false);
  const [fixOpen, setFixOpen] = useState<string | null>(null);
  const [fixAll, setFixAll] = useState(false);
  const [allRestock, setAllRestock] = useState(false);
  const [allMove, setAllMove] = useState(false);
  const [allPrice, setAllPrice] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const restock = useMemo(() => restockList(pieces, todayISO(), lang), [pieces, lang]);
  const move = useMemo(() => moveList(pieces, todayISO(), lang), [pieces, lang]);
  const priceRows = useMemo(() => priceList(pieces, lang), [pieces, lang]);
  const ageing = useMemo(() => measure(pieces, [], { lang }).aging, [pieces, lang]);
  const onHand = pieces.filter((piece) => piece.status === "available").sort((a, b) => b.costCents * b.qty - a.costCents * a.qty);
  const coming = pieces.filter((piece) => piece.status === "incoming").reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
  const action = pieces.find((piece) => piece.id === advice.actionPieceId) ?? null;
  const price = advice.cards.find((card) => card.id === "price");
  const average = price?.title.match(/\$[0-9,]+\.\d{2}/)?.[0] ?? price?.body.match(/\$[0-9,]+\.\d{2}/)?.[0] ?? null;
  const notes = advice.cards.filter((card) => GLANCE.has(card.id));
  const counted = advice.cards.filter((card) => !GLANCE.has(card.id) && card.id !== "price" && card.id !== "aging");
  // The engine's aging card (its ladder: the numbered cut for the oldest piece)
  // was computed but never rendered — it gets its own article below (1.0.3).
  const aging = advice.cards.find((card) => card.id === "aging");

  const pieceTasks = onHand
    .filter((piece) => piece.id !== action?.id && missingOf(piece).length > 0)
    .map((piece) => ({ id: piece.id, piece, focus: focusOf(piece), kind: "piece" as const }))
    // One of each product first, so the two open cards are two different pieces of work.
    .map((task, index, all) => ({ task, rank: all.findIndex((other) => other.piece.name.trim().toLowerCase() === task.piece.name.trim().toLowerCase()) === index ? 0 : 1, index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ task }) => task);
  const priceTask = price && average
    ? { id: "price", piece: onHand.find((item) => item.askCents <= 0) ?? action, focus: "ask" as AdviceFocus, kind: "price" as const }
    : null;
  const tasks = [...pieceTasks, ...(priceTask ? [priceTask] : [])];
  const ordered = front ? [tasks.find((task) => task.id === front), ...tasks.filter((task) => task.id !== front)].filter((task): task is NonNullable<typeof task> => !!task) : tasks;
  const queue = ordered.filter((task) => !later.includes(task.id));
  const openIds = new Set(queue.slice(0, 2).map((task) => task.id));
  const actionOpen = !!action && missingOf(action).length > 0 && !later.includes("action");
  const donePieces = onHand.filter((piece) => piece.id !== action?.id && missingOf(piece).length === 0);

  const waiting = [...onHand, ...pieces.filter((piece) => piece.status === "incoming")]
    .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null) }))
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  const soldDays = pieces
    .filter(soldPiece)
    .map((piece) => daysHeld(piece.receivedOn, piece.soldOn))
    .filter((days): days is number => days != null);
  const soldPace = soldDays.length ? Math.round(soldDays.reduce((sum, days) => sum + days, 0) / soldDays.length) : null;

  const sizeMap = new Map<string, { label: string; n: number; days: number[] }>();
  for (const piece of pieces.filter(soldPiece)) {
    const label = sizeName(piece);
    if (!label) continue;
    const row = sizeMap.get(label) ?? { label, n: 0, days: [] };
    row.n += piece.qty;
    const days = daysHeld(piece.receivedOn, piece.soldOn);
    if (days != null) row.days.push(days);
    sizeMap.set(label, row);
  }
  const sizes = [...sizeMap.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const unsized = onHand.filter((piece) => /boot|shoe/i.test(`${piece.category} ${piece.name}`) && !sizeName(piece));
  const sizeLeft = new Map<string, number>();
  for (const piece of [...onHand, ...pieces.filter((p) => p.status === "incoming")]) {
    const label = sizeName(piece);
    if (label) sizeLeft.set(label, (sizeLeft.get(label) ?? 0) + piece.qty);
  }
  const readiness = (() => {
    const map = new Map<string, { name: string; ready: number; total: number }>();
    for (const piece of onHand) {
      const name = piece.name.trim() || tx(lang, "common.untitled");
      const row = map.get(name.toLowerCase()) ?? { name, ready: 0, total: 0 };
      row.total += piece.qty;
      if (missingOf(piece).length === 0) row.ready += piece.qty;
      map.set(name.toLowerCase(), row);
    }
    return [...map.values()].sort((a, b) => (b.total - b.ready) - (a.total - a.ready) || b.total - a.total || a.name.localeCompare(b.name));
  })();
  const shownIds = new Set([action?.id, ...queue.slice(0, 2).map((task) => task.piece?.id)].filter(Boolean));
  const fixes = (["photo", "size", "asking price", "brand", "date", "bought from", "place", "cost"] as const)
    .map((field) => ({
      field,
      label: (() => { const word = missingLabel(field, lang); return word[0].toUpperCase() + word.slice(1); })(),
      focus: FOCUS_OF[field],
      pieces: onHand.filter((piece) => !shownIds.has(piece.id) && missingOf(piece).includes(field)),
    }))
    .filter((fix) => fix.pieces.length > 0)
    .sort((a, b) => b.pieces.length - a.pieces.length);
  const readyPeak = Math.max(1, ...readiness.map((row) => row.total));
  const restockPeak = Math.max(1, ...restock.map((row) => row.recent));
  const restockSub = Math.max(...restock.slice(0, allRestock ? undefined : 5).map((row) => `${row.size ? `${row.size} · ` : ""}${tx(lang, "adv.in90", { n: row.recent })}`.length), 8);
  const moveUnits = move.reduce((sum, row) => sum + row.units, 0);
  const moveCost = move.reduce((sum, row) => sum + row.cost, 0);
  const priceMax = Math.max(1, ...priceRows.slice(0, 12).flatMap((row) => [row.high, row.cost, ...row.asks])) * 1.08;

  /* The glance cards (1.1.1): each answer gets a figure and a small chart
     drawn from the same floor the engine read, so a card is never prose
     alone; the words keep to whole sentences and the rest waits behind a
     sentence-boundary expander. */
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  const glance: GlanceItem[] = [];
  if (aging) {
    const aged = aging.pieceIds
      .map((id) => byId.get(id))
      .filter((piece): piece is Piece => !!piece)
      .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null) ?? -1 }))
      .sort((a, b) => b.days - a.days)[0];
    const said = spoken(aging.body).split(/(?<=[.!?])\s+/);
    const text = bySentence((aged && said[0]?.startsWith(aged.piece.name) && said.length > 1 ? said.slice(1) : said).join(" "));
    const days = aged && aged.days >= 0 ? aged.days : null;
    glance.push({
      id: "aging",
      icon: Hourglass,
      tone: litTone(days != null && days > 90 ? AMBER : days != null && days > 30 ? AMBER : GREEN),
      question: aging.question,
      horizon: aging.horizon,
      title: aged ? aged.piece.name : aging.title,
      figure: days != null ? String(days) : "—",
      unit: tx(lang, days === 1 ? "common.day" : "common.days"),
      caption: days == null ? tx(lang, "adv.noArrival") : days > 90 ? tx(lang, "adv.onHandPast90") : days > 60 ? tx(lang, "adv.onHandCold") : tx(lang, "adv.onHandOldest"),
      visual: <AgeRamp buckets={ageing.buckets} />,
      lead: text.short,
      rest: text.rest,
    });
  }
  for (const card of notes) {
    if (card.id === "lesson") {
      const piece = byId.get(card.pieceIds[0]);
      const net = card.body.match(/(?:is|es) (-?\$[0-9,]+\.\d{2})\./)?.[1] ?? null;
      const netCents = net ? Math.round(Number(net.replace(/[$,]/g, "")) * 100) : null;
      const days = piece ? daysHeld(piece.receivedOn, piece.soldOn) : null;
      const sentences = spoken(card.body).split(/(?<=[.!?])\s+/);
      const text = bySentence(sentences.slice(1).join(" ") || card.body);
      glance.push({
        id: card.id,
        icon: Lightbulb,
        tone: litTone(card.tone === "loss" ? RED : GREEN),
        question: card.question,
        horizon: card.horizon,
        title: piece ? piece.name : card.title,
        figure: piece?.saleCents != null ? money(piece.saleCents) : "—",
        caption: lang === "es" ? `vendida por${days != null ? `, después de ${days} ${days === 1 ? "día" : "días"} en inventario` : ""}${piece && piece.costCents <= 0 ? ", sin costo ingresado" : ""}` : `sold for${days != null ? `, after ${days} ${days === 1 ? "day" : "days"} on hand` : ""}${piece && piece.costCents <= 0 ? ", cost not entered" : ""}`,
        visual: piece?.saleCents != null && netCents != null && piece.costCents > 0 ? <KeptSplit lang={lang} sale={piece.saleCents} kept={netCents} /> : undefined,
        lead: text.short,
        rest: text.rest,
      });
      continue;
    }
    if (card.id === "buy") {
      const soldUnits = pieces.filter(soldPiece).reduce((sum, piece) => sum + piece.qty, 0);
      const handUnits = onHand.reduce((sum, piece) => sum + piece.qty, 0);
      const through = soldUnits + handUnits ? soldUnits / (soldUnits + handUnits) : null;
      const share = lang === "es"
        ? card.body.match(/piezas son (botas) \((\d+) %\)/) ?? card.body.match(/Las (botas) son el (\d+) %/)
        : card.body.match(/([A-Za-z][A-Za-z ]*?) are (\d+)% of what you are holding/) ?? card.body.match(/pieces are ([a-z ]+) \((\d+)%\)/);
      glance.push({
        id: card.id,
        icon: ShoppingBag,
        tone: litTone(GREEN),
        question: card.question,
        horizon: card.horizon,
        title: card.title,
        figure: through == null ? "—" : pct(through),
        caption: tx(lang, "adv.boughtSoldCaption"),
        visual: share ? <ShareBar label={tx(lang, "adv.holdShare", { what: share[1].trim().toLowerCase() })} share={Number(share[2])} /> : undefined,
        lead: decisionLine(card, lang),
        rest: "",
      });
      continue;
    }
    if (card.id === "ads") {
      const spent = card.body.match(/(?:spend is|spent|gasto en anuncios es|gastado) (\$[0-9,]+\.\d{2})/)?.[1] ?? "$0.00";
      const priced = onHand.filter((piece) => piece.askCents > 0 && piece.costCents > 0);
      const above = priced.filter((piece) => piece.askCents > piece.costCents).length;
      glance.push({
        id: card.id,
        icon: Megaphone,
        tone: litTone(AMBER),
        question: card.question,
        horizon: card.horizon,
        title: card.title,
        figure: spent,
        caption: tx(lang, "adv.adsSpentCaption"),
        visual: priced.length ? <ShareBar label={tx(lang, "adv.askingAboveCost")} share={Math.round((above / priced.length) * 100)} count={tx(lang, "adv.ofPriced", { a: above, n: priced.length })} /> : undefined,
        lead: decisionLine(card, lang),
        rest: "",
      });
      continue;
    }
    if (card.id === "sources") {
      const map = new Map<string, { name: string; n: number }>();
      for (const piece of pieces.filter(soldPiece)) {
        const name = piece.source.trim();
        if (!name) continue;
        const row = map.get(name.toLowerCase()) ?? { name, n: 0 };
        row.n += piece.qty;
        map.set(name.toLowerCase(), row);
      }
      const ranked = [...map.values()].sort((a, b) => b.n - a.n);
      glance.push({
        id: card.id,
        icon: Store,
        tone: litTone(TEAL),
        question: card.question,
        horizon: card.horizon,
        title: card.title,
        figure: ranked[0] ? String(ranked[0].n) : "0",
        unit: tx(lang, ranked[0] && ranked[0].n === 1 ? "common.saleWordOne" : "common.saleWordOther"),
        caption: ranked[0] ? `${lang === "es" ? "de" : "from"} ${ranked[0].name}${ranked.length > 1 ? tx(lang, "adv.mostOfAny") : ""}` : tx(lang, "adv.nameSource"),
        visual: ranked.length > 1 ? <MiniRank rows={ranked.slice(0, 3)} tone={litTone(TEAL)} /> : undefined,
        lead: decisionLine(card, lang),
        rest: "",
      });
      continue;
    }
    if (card.id === "season") {
      const boots = onHand.filter((piece) => /boot/i.test(`${piece.category} ${piece.name}`)).reduce((sum, piece) => sum + piece.qty, 0);
      glance.push({
        id: card.id,
        icon: CalendarRange,
        tone: litTone(TONES.copper),
        question: card.question,
        horizon: card.horizon,
        title: card.title,
        figure: String(boots),
        unit: tx(lang, boots === 1 ? "adv.bootOne" : "adv.bootOther"),
        caption: tx(lang, "adv.onHandSeason"),
        visual: <MonthStrip lang={lang} tone={litTone(TONES.copper)} />,
        lead: decisionLine(card, lang),
        rest: "",
      });
      continue;
    }
    const text = bySentence(card.body);
    glance.push({ id: card.id, icon: Tags, tone: litTone(GREEN), question: card.question, horizon: card.horizon, title: card.title, lead: text.short, rest: text.rest });
  }

  return (
    <div className="mt-4 space-y-5">
      <section data-shot="adv-hero" className="advice-hero framed rounded-3xl bg-panel p-5">
        <p className="text-[11px] tracking-[0.16em] text-faint uppercase">{tx(lang, "adv.yourShelf")} · {advice.stage}</p>
        <h2 className="mt-2 font-display text-4xl leading-tight break-words">{commas(leadOf(advice.headline))}</h2>
        <div className="mt-4 flex items-center gap-4">
          <ReadyRing ready={advice.ready} total={onHand.length} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-3xl leading-none tabular-nums">{tx(lang, "adv.readyOf", { ready: advice.ready, total: onHand.length })}</p>
            <p className="mt-1.5 text-sm text-muted">{onHand.length === 0 ? tx(lang, "adv.nothingList") : advice.ready === onHand.length ? tx(lang, "adv.everyComplete") : tx(lang, "adv.readyWhen")}</p>
          </div>
        </div>
        {readiness.length ? (
          <ul className="mt-4 space-y-2.5 border-t border-line pt-3.5">
            {(allReady ? readiness : readiness.slice(0, 5)).map((row, index) => (
              <li key={row.name} className="row-in" style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 text-ink">{row.name}</span>
                  <span className="shrink-0 tabular-nums text-muted"><span className="text-ink">{row.ready}</span>/{row.total}</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-panel-2" aria-hidden>
                  <div className="bar-fill flex h-full overflow-hidden rounded-full" style={{ width: `${Math.max(4, (row.total / readyPeak) * 100)}%`, animationDelay: `${Math.min(index * 45, 360)}ms` }}>
                    <span className="lit-bar block h-full" style={{ width: `${(row.ready / row.total) * 100}%`, background: litTone(GREEN), ["--glow" as string]: litTone(GREEN) }} />
                    <span className="block h-full flex-1" style={{ background: litTone(AMBER), opacity: 0.55 }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {readiness.length > 5 ? (
          <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllReady((v) => !v)}>{allReady ? tx(lang, "charts.showFewer") : tx(lang, "adv.showAllProducts", { n: readiness.length })}</button>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 text-sm text-ink">
          <span className="row-in inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5 whitespace-nowrap tabular-nums" style={{ animationDelay: "40ms" }}><span className="size-2 shrink-0 rounded-full" style={{ background: litTone(GREEN) }} aria-hidden />{tx(lang, "adv.onHandChip")} {cash(advice.onHandCents)}</span>
          <span className="row-in inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5 whitespace-nowrap tabular-nums" style={{ animationDelay: "90ms" }}><span className="size-2 shrink-0 rounded-full" style={{ background: litTone("#5d86ad") }} aria-hidden />{tx(lang, "adv.comingChip")} {cash(coming)}</span>
        </div>
        {advice.oldestLabel ? <p className="row-in mt-2.5 flex items-start gap-2 text-sm text-pretty text-muted" style={{ animationDelay: "140ms" }}><span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: litTone(AMBER) }} aria-hidden /><span>{tx(lang, "adv.oldestOnHand")} <span className="text-ink"><NoSplit text={advice.oldestLabel} /></span></span></p> : null}
      </section>

      <section data-shot="ask-door" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-4 pb-4" style={{ ["--tone" as string]: litTone(TEAL) }}>
        <span className="tone-edge" aria-hidden />
        <CardHead icon={Lightbulb} tone={litTone(TEAL)} title={tx(lang, "door.title")} />
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (askText.trim()) setAnswer(askInventory(pieces, ads, askText, { lang }));
          }}
        >
          <input value={askText} onChange={(event) => setAskText(event.target.value)} placeholder={tx(lang, "door.placeholder")} className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink" />
          <button type="submit" className="press shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white">{tx(lang, "door.ask")}</button>
        </form>
        <p className="mt-2 text-xs leading-relaxed text-faint">{tx(lang, "door.hint")}</p>
        {answer ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-sm leading-relaxed text-pretty text-ink">{answer.text}</p>
            {answer.pieceIds.length ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {[...new Map(answer.pieceIds.map((id) => [id, pieces.find((piece) => piece.id === id)] as const)).values()].filter((piece): piece is Piece => !!piece).slice(0, 4).map((piece) => (
                  <button key={piece.id} type="button" className="press rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs whitespace-nowrap text-ink" onClick={() => onOpen(piece)}>{piece.name}</button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {action && actionOpen ? (
        <ActionCard
          lang={lang}
          kicker={tx(lang, "adv.doFirst")}
          title={action.name}
          body={`${tx(lang, "adv.priciestBody", { money: money(action.costCents) })}${needsLine(action, lang)}`.trim()}
          piece={action}
          tone="green"
          button={buttonFor(focusOf(action) ?? "photo", lang)}
          onOpen={() => onOpen(action, focusOf(action) ?? "photo")}
          onPhoto={onPhoto}
          onLater={() => setLater((current) => [...current, "action"])}
          extra={<PieceActs lang={lang} piece={action} reasonFor={reasonFor} setReasonFor={setReasonFor} onKeep={onKeep} onReturn={onReturn} onRemove={onRemove} onFlag={onFlag} />}
        />
      ) : action && missingOf(action).length === 0 ? (
        <DoneLine text={tx(lang, "adv.readyToList", { name: action.name })} />
      ) : action ? (
        <button type="button" className="press w-full rounded-2xl border border-line bg-panel px-3 py-3 text-left text-sm break-words text-ink" onClick={() => setLater((current) => current.filter((id) => id !== "action"))}>
          {action.name}
        </button>
      ) : null}

      {tasks.map((task) => {
        if (!task.piece && task.kind === "piece") return null;
        const open = openIds.has(task.id);
        if (!open) return null;
        if (task.kind === "price") {
          return (
            <ActionCard
              lang={lang}
              key={task.id}
              kicker={tx(lang, "adv.priceKicker")}
              title={tx(lang, "adv.setAsking")}
              body={price?.tone === "loss" ? bySentence(price.body).short : tx(lang, "adv.priceBody", { average: average ?? "" })}
              piece={task.piece}
              tone={price?.tone === "loss" ? "red" : "amber"}
              button={tx(lang, "adv.pricePieces")}
              onOpen={() => task.piece && onOpen(task.piece, "ask")}
              onPhoto={onPhoto}
              onLater={() => setLater((current) => [...current, task.id])}
            />
          );
        }
        if (!task.piece || !task.focus) return null;
        return (
          <ActionCard
            lang={lang}
            key={task.id}
            kicker={tx(lang, "adv.alsoToday")}
            title={task.piece.name}
            body={[needsLine(task.piece, lang), task.piece.costCents ? tx(lang, "adv.itCost", { money: money(task.piece.costCents) }) : ""].filter(Boolean).join(" ")}
            piece={task.piece}
            tone="amber"
            button={buttonFor(task.focus, lang)}
            onOpen={() => task.focus && task.piece && onOpen(task.piece, task.focus)}
            onPhoto={onPhoto}
            onLater={() => setLater((current) => [...current, task.id])}
            extra={<PieceActs lang={lang} piece={task.piece} reasonFor={reasonFor} setReasonFor={setReasonFor} onKeep={onKeep} onReturn={onReturn} onRemove={onRemove} onFlag={onFlag} />}
          />
        );
      })}

      {fixes.length ? (
        <section data-shot="fixes" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-4 pb-3" style={{ ["--tone" as string]: litTone(AMBER) }}>
          <span className="tone-edge" aria-hidden />
          <CardHead icon={ClipboardList} tone={litTone(AMBER)} title={tx(lang, "adv.fixesTitle")} />
          <p className="mt-2.5 text-sm leading-relaxed text-muted">{tx(lang, "adv.fixesSub", { n: onHand.length })}</p>
          <ul className="mt-3 border-t border-line">
            {fixes.map((fix, index) => {
              const open = fixOpen === fix.field;
              const shown = open ? fix.pieces.slice(0, fixAll ? undefined : 6) : [];
              return (
                <li key={fix.field} className="border-b border-line last:border-b-0">
                  <button type="button" aria-expanded={open} className="press row-in flex w-full items-center gap-3 py-2.5 text-left" style={{ animationDelay: `${index * 40}ms` }} onClick={() => { setFixOpen(open ? null : fix.field); setFixAll(false); }}>
                    <span className="w-24 shrink-0 text-sm whitespace-nowrap text-ink">{fix.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                      <span className="bar-fill lit-bar block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((fix.pieces.length / Math.max(1, onHand.length)) * 100))}%`, background: litTone(AMBER), ["--glow" as string]: litTone(AMBER), animationDelay: `${index * 40}ms` }} />
                    </span>
                    <span className="w-9 shrink-0 text-right text-sm tabular-nums text-ink">{fix.pieces.length}</span>
                    <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
                  </button>
                  {open ? (
                    <div className="row-in pb-2">
                      {shown.map((piece) => (
                        <button key={piece.id} type="button" className="press flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-sm" onClick={() => onOpen(piece, fix.focus)}>
                          <span className="min-w-0 text-ink">{piece.name}{sizeName(piece) ? <span className="text-muted"> · {sizeName(piece)}</span> : null}</span>
                          <span className="shrink-0" style={{ color: litTone(AMBER) }}>{buttonFor(fix.focus, lang)}</span>
                        </button>
                      ))}
                      {fix.pieces.length > 6 ? <button type="button" className="press mt-1 text-sm text-accent" onClick={() => setFixAll((v) => !v)}>{fixAll ? tx(lang, "charts.showFewer") : tx(lang, "charts.showAll", { n: fix.pieces.length })}</button> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {donePieces.length > 0 && donePieces.length <= 3 ? donePieces.map((piece) => <DoneLine key={piece.id} text={tx(lang, "adv.readyToList", { name: piece.name })} />) : donePieces.length > 3 ? <DoneLine text={tx(lang, "adv.piecesReady", { n: donePieces.length })} /> : null}

      {restock.length || move.length || priceRows.length ? (
        <section className="space-y-3">
          <p className="text-[11px] tracking-[0.16em] text-faint uppercase">{tx(lang, "adv.nextMoves")}</p>
          {restock.length ? (
            <article data-shot="restock" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-3.5 pb-4" style={{ ["--tone" as string]: litTone(GREEN) }}>
              <span className="tone-edge" aria-hidden />
              <Kick icon={Repeat} tone={litTone(GREEN)} text={tx(lang, "adv.buyAgain")} />
              <h3 className="mt-2.5 font-display text-xl leading-snug"><NoSplit text={restock[0].product} /></h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                {lang === "es" ? <>{restock[0].sold} vendidas{restock[0].avgDays != null ? `, unos ${restock[0].avgDays} días cada una` : ""}{restock[0].size ? `, ${restock[0].size} sobre todo` : ""}. {restock[0].left === 0 ? "No queda ninguna." : `Quedan ${restock[0].left}${restock[0].weeksLeft != null ? `, unas ${restock[0].weeksLeft} ${restock[0].weeksLeft === 1 ? "semana" : "semanas"} a este ritmo` : ""}.`}</> : <>{restock[0].sold} sold{restock[0].avgDays != null ? `, about ${restock[0].avgDays} days each` : ""}{restock[0].size ? `, ${restock[0].size} most of all` : ""}. {restock[0].left === 0 ? "None left." : `${restock[0].left} still here${restock[0].weeksLeft != null ? `, about ${restock[0].weeksLeft} ${restock[0].weeksLeft === 1 ? "week" : "weeks"} at this pace` : ""}.`}</>}
              </p>
              <ul className="mt-3.5 space-y-3">
                {restock.slice(0, allRestock ? undefined : 5).map((row, index) => (
                  <li key={row.product} className="row-in" style={{ animationDelay: `${index * 45}ms` }}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 text-ink"><NoSplit text={row.product} /></span>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap tabular-nums" style={{ background: row.left === 0 || (row.weeksLeft != null && row.weeksLeft <= 4) ? `color-mix(in srgb, ${litTone(AMBER)} 24%, transparent)` : "var(--v-panel-2)", color: "var(--v-ink)" }}>{row.left === 0 ? tx(lang, "adv.soldOut") : tx(lang, "adv.leftCount", { n: row.left })}</span>
                    </div>
                    <div className="mt-1.5 grid items-center gap-3 text-xs" style={{ gridTemplateColumns: `minmax(0,1fr) calc(${restockSub}ch * 0.86)` }}>
                      <span className="h-1.5 overflow-hidden rounded-full bg-panel-2"><span className="bar-fill lit-bar block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((row.recent / Math.max(1, restockPeak)) * 100))}%`, background: litTone(GREEN), ["--glow" as string]: litTone(GREEN), animationDelay: `${index * 45}ms` }} /></span>
                      <span className="text-right whitespace-nowrap tabular-nums text-muted">{row.size ? `${row.size} · ` : ""}{tx(lang, "adv.in90", { n: row.recent })}</span>
                    </div>
                  </li>
                ))}
              </ul>
              {restock.length > 5 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllRestock((v) => !v)}>{allRestock ? tx(lang, "charts.showFewer") : tx(lang, "charts.showAll", { n: restock.length })}</button> : null}
              <p className="mt-3 text-xs leading-relaxed text-muted">{tx(lang, "adv.restockNote")}</p>
            </article>
          ) : null}
          {move.length ? (
            <article data-shot="move" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-3.5 pb-4" style={{ ["--tone" as string]: litTone(AMBER) }}>
              <span className="tone-edge" aria-hidden />
              <Kick icon={TrendingDown} tone={litTone(AMBER)} text={tx(lang, "adv.moveThese")} />
              <h3 className="mt-2.5 font-display text-xl leading-snug">{tx(lang, moveUnits === 1 ? "adv.outstayedOne" : "adv.outstayedOther", { n: moveUnits })}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{tx(lang, "adv.moveBody", { cash: cash(moveCost) })}</p>
              <ul className="mt-3 border-t border-line">
                {move.slice(0, allMove ? undefined : 4).map((row, index) => (
                  <li key={row.product} className="row-in border-b border-line py-2 last:border-b-0" style={{ animationDelay: `${index * 45}ms` }}>
                    <button type="button" className="press grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 text-left" onClick={() => onOpen(row.pieces[0].piece, "ask")}>
                      <span className="min-w-0 text-sm text-ink"><NoSplit text={row.product} /></span>
                      <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums" style={{ background: `color-mix(in srgb, ${litTone(AMBER)} 18%, transparent)`, color: litTone(AMBER) }}>{row.cut != null ? tx(lang, "adv.tryPrice", { x: cash(row.cut, true) }) : tx(lang, "adv.setAPrice")}</span>
                      <span className="col-span-2 text-xs tabular-nums text-muted">{lang === "es" ? <>{row.units} {row.units === 1 ? "pieza" : "piezas"} · la mayor {row.oldest} d{row.pace != null ? ` · suele tardar ${row.pace} d` : ""}{row.ask != null ? ` · pide ${cash(row.ask, true)}` : ""}</> : <>{row.units} {row.units === 1 ? "piece" : "pieces"} · oldest {row.oldest} d{row.pace != null ? ` · usually ${row.pace} d` : ""}{row.ask != null ? ` · asking ${cash(row.ask, true)}` : ""}</>}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {move.length > 4 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllMove((v) => !v)}>{allMove ? tx(lang, "charts.showFewer") : tx(lang, "adv.showAllProducts", { n: move.length })}</button> : null}
            </article>
          ) : null}
          {priceRows.length ? (
            <article data-shot="price" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-3.5 pb-4" style={{ ["--tone" as string]: litTone(TEAL) }}>
              <span className="tone-edge" aria-hidden />
              <Kick icon={Tags} tone={litTone(TEAL)} text={tx(lang, "adv.priceFromSales")} />
              <h3 className="mt-2.5 font-display text-xl leading-snug">{tx(lang, "adv.buyersPaid")}</h3>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full" style={{ background: litTone(GREEN), opacity: 0.45 }} /> {tx(lang, "adv.rangePaid")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: litTone(GREEN) }} /> {tx(lang, "adv.usual")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px]" style={{ background: litTone(AMBER) }} /> {tx(lang, "adv.yourAsks")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-muted" /> {tx(lang, "adv.costWord")}</span>
              </div>
              <ul className="mt-3 space-y-3.5">
                {priceRows.slice(0, allPrice ? undefined : 4).map((row, index) => (
                  <li key={row.product} className="row-in" style={{ animationDelay: `${index * 45}ms` }}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 text-ink">{row.product}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: row.below ? "var(--v-danger)" : "var(--v-ink)" }}>{tx(lang, "adv.askWord")} ${Math.round(row.suggest / 100)}</span>
                    </div>
                    <PriceTrack cost={row.cost} low={row.low} high={row.high} median={row.median} asks={row.asks} scaleMax={priceMax} />
                    <p className="text-xs tabular-nums text-muted">{lang === "es" ? <>{row.low === row.high ? `${row.sales} ventas a ${money(row.low)}` : `${row.sales} ventas de ${money(row.low)} a ${money(row.high)}`}{row.below ? ` · ${row.below} con precio bajo el costo` : row.above ? ` · ${row.above} con precio sobre toda venta` : row.unasked ? ` · ${row.unasked} sin precio` : ""}</> : <>{row.low === row.high ? `${row.sales} sales at ${money(row.low)}` : `${row.sales} sales from ${money(row.low)} to ${money(row.high)}`}{row.below ? ` · ${row.below} asking under cost` : row.above ? ` · ${row.above} asking above any sale` : row.unasked ? ` · ${row.unasked} with no ask` : ""}</>}</p>
                  </li>
                ))}
              </ul>
              {priceRows.length > 4 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllPrice((v) => !v)}>{allPrice ? tx(lang, "charts.showFewer") : tx(lang, "charts.showAll", { n: priceRows.length })}</button> : null}
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <p className="text-[11px] tracking-[0.16em] text-faint uppercase">{tx(lang, "adv.nextSaleEasier")}</p>

        <article data-shot="sizes" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-4 pb-4" style={{ ["--tone" as string]: litTone(TONES.blue) }}>
          <span className="tone-edge" aria-hidden />
          <CardHead icon={Ruler} tone={litTone(TONES.blue)} title={tx(lang, "adv.whichSize")} />
          {sizes.length === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-pretty text-ink">{tx(lang, "adv.noSizeSold")}</p>
          ) : (
            <>
              <Figure tone={litTone(TONES.blue)} value={sizes[0].label} caption={lang === "es" ? `vendida ${sizes[0].n} ${sizes[0].n === 1 ? "vez" : "veces"}${sizes[0].days.length ? `, unos ${Math.round(sizes[0].days.reduce((sum, days) => sum + days, 0) / sizes[0].days.length)} días cada una` : ""}` : `sold ${sizes[0].n} ${sizes[0].n === 1 ? "time" : "times"}${sizes[0].days.length ? `, about ${Math.round(sizes[0].days.reduce((sum, days) => sum + days, 0) / sizes[0].days.length)} days each` : ""}`} />
              <p className="mt-2.5 text-sm leading-relaxed text-pretty text-ink">{sizes[0].n === 1 ? tx(lang, "adv.oneSaleLesson") : tx(lang, "adv.sizeToBuy")}</p>
              <div className="mt-3.5">
                <PairBars lang={lang} rows={sizes.map((row) => ({ label: row.label, a: row.n, b: sizeLeft.get(row.label) ?? 0 }))} aLabel={tx(lang, "status.sold")} bLabel={tx(lang, "stats.stillHere")} aTone={TONES.blue} limit={6} />
              </div>
            </>
          )}
          {unsized.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] font-medium tracking-[0.14em] text-faint uppercase">{tx(lang, "adv.noSizeCard")}</p>
              <ul className="mt-1">
                {unsized.slice(0, 5).map((piece) => (
                  <li key={piece.id}>
                    <button type="button" className="press flex w-full items-center justify-between gap-3 py-1.5 text-left text-sm text-ink" onClick={() => onOpen(piece, "size")}>
                      <span className="min-w-0"><NoSplit text={piece.name} /></span>
                      <span className="shrink-0 rounded-full px-3 py-1 text-xs font-medium" style={{ background: `color-mix(in srgb, ${litTone(AMBER)} 18%, transparent)`, color: litTone(AMBER) }}>{tx(lang, "adv.addSize")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        <article data-shot="sit" className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-4 pb-4" style={{ ["--tone" as string]: litTone(TONES.teal) }}>
          <span className="tone-edge" aria-hidden />
          <CardHead icon={Timer} tone={litTone(TONES.teal)} title={tx(lang, "adv.howLongSit")} />
          {soldPace == null ? (
            <p className="mt-3 text-sm leading-relaxed text-pretty text-ink">{tx(lang, "adv.noPaceYet")}</p>
          ) : (
            <>
              <Figure tone={litTone(TONES.teal)} value={String(soldPace)} unit={tx(lang, soldPace === 1 ? "common.day" : "common.days")} caption={tx(lang, "adv.paceCaption")} />
              <p className="mt-2.5 text-sm leading-relaxed text-pretty text-ink">{tx(lang, "adv.usePace")}</p>
            </>
          )}
          <div className="mt-4"><AgeColumns buckets={ageing.buckets} /></div>
          <ul className="mt-3 border-t border-line">
            {waiting.slice(0, 5).map(({ piece, days }) => (
              <li key={piece.id} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm text-ink last:border-b-0">
                <span className="min-w-0"><NoSplit text={piece.name} />{piece.status === "incoming" ? <span className="text-muted">{tx(lang, "adv.onTheWay")}</span> : null}</span>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums" style={{ background: days == null ? "var(--v-panel-2)" : `color-mix(in srgb, ${litTone(ageTone(days))} 24%, transparent)` }}>{days == null ? tx(lang, "stats.noDate") : `${days} d`}</span>
              </li>
            ))}
          </ul>
          {waiting.length > 5 ? <p className="mt-2 text-xs text-pretty text-muted">{tx(lang, "adv.waitingNote", { n: waiting.length })}</p> : null}
        </article>

        {glance.map((item) => (
          <InsightCard key={item.id} shot={item.id} {...item} lang={lang} open={more.includes(item.id)} onToggle={() => setMore((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />
        ))}
      </section>

      <section data-shot="counted" className="rounded-3xl border border-line bg-panel">
        <button type="button" className="press flex w-full items-center gap-2 px-4 py-2.5 text-left" aria-expanded={countOpen} onClick={() => setCountOpen((open) => !open)}>
          <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${countOpen ? "" : "-rotate-90"}`} strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base leading-tight">{tx(lang, "adv.countedTitle")}</span>
            {!countOpen ? <span className="mt-0.5 block text-xs leading-snug text-muted">{tx(lang, "adv.countedSub", { n: counted.length })}</span> : null}
          </span>
        </button>
        {countOpen ? (
          <div className="row-in px-4 pb-3">
            {counted.map((card) => {
              const text = bySentence(card.body);
              const open = more.includes(card.id);
              return (
                <div key={card.id} className="border-t border-line py-3 first:border-t-0 first:pt-1">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="min-w-0 font-display text-base leading-snug"><NoSplit text={card.title} /></h3>
                    <span className="mt-0.5 shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] leading-tight whitespace-nowrap text-faint">{card.horizon}</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-pretty text-ink">{commas(open && text.rest ? `${text.short} ${text.rest}` : text.short)}</p>
                  {text.rest ? <Expander lang={lang} open={open} onToggle={() => setMore((current) => open ? current.filter((id) => id !== card.id) : [...current, card.id])} /> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <div data-shot="footer" className="flex items-center gap-4 border-t border-line pt-4">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-relaxed text-pretty text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>{tx(lang, "adv.footerNote")}</span>
        </p>
        <button type="button" className="press inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-accent-soft px-4 text-sm font-medium whitespace-nowrap text-ink" onClick={async () => {
          // Verify before claiming (button audit V-1): "Copied" only once the clipboard
          // has actually taken the plan; a denial or a missing clipboard says so instead.
          setCopyFailed(false);
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(advice.plan);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          } catch {
            setCopyFailed(true);
            window.setTimeout(() => setCopyFailed(false), 2600);
          }
        }}>
          {copied ? <Check className="size-4" strokeWidth={2} style={{ color: litTone(GREEN) }} aria-hidden /> : <Copy className="size-4" strokeWidth={1.75} aria-hidden />}
          <span className={copyFailed ? "text-danger" : undefined}>{copied ? tx(lang, "common.copied") : copyFailed ? tx(lang, "adv.copyFailed") : tx(lang, "adv.copyPlan")}</span>
        </button>
      </div>
    </div>
  );
}

function ActionCard({
  lang = "en",
  kicker,
  title,
  body,
  piece,
  tone,
  button,
  onOpen,
  onPhoto,
  onLater,
  extra,
}: {
  lang?: Lang;
  kicker: string;
  title: string;
  body: string;
  piece: Piece | null;
  tone: "green" | "amber" | "red";
  button: string;
  onOpen: () => void;
  onPhoto: (piece: Piece, file: File) => void;
  onLater: () => void;
  extra?: ReactNode;
}) {
  const color = tone === "green" ? litTone(GREEN) : tone === "red" ? litTone(RED) : litTone(AMBER);
  const missing = piece ? missingOf(piece) : [];
  return (
    <article data-shot={`action-${kicker.replace(/\W+/g, "-").toLowerCase()}`} className="insight advice-in framed relative overflow-hidden rounded-3xl border border-line p-4" style={{ ["--tone" as string]: color, background: `color-mix(in srgb, ${color} 7%, var(--v-panel))` }}>
      <span className="tone-edge" aria-hidden />
      <div className="flex items-start gap-3">
        {piece ? <Thumb lang={lang} piece={piece} onPhoto={onPhoto} /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color }}>{kicker}</p>
          <h3 className="mt-2.5 font-display text-xl leading-snug"><NoSplit text={title} /></h3>
          {piece && piece.name === title && (sizeName(piece) || piece.receivedOn) ? <p className="mt-0.5 text-xs tabular-nums text-muted">{[sizeName(piece), piece.receivedOn ? `${lang === "es" ? "llegó el" : "arrived"} ${new Date(`${piece.receivedOn}T12:00:00`).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""].filter(Boolean).join(" · ")}</p> : null}
          {body ? <p className="mt-2 text-sm leading-relaxed text-pretty text-ink">{body}</p> : null}
          {missing.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">{tx(lang, "adv.missing")}</span>
              {missing.map((item) => <span key={item} className="rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap" style={{ color: litTone(AMBER), boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${litTone(AMBER)} 55%, transparent)` }}>{missingLabel(item, lang)}</span>)}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="press h-11 rounded-full px-4 text-sm font-medium" style={{ background: color, color: toneInk("#f3f0e8") }} onClick={onOpen}>{button}</button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm text-ink" onClick={onLater}>{tx(lang, "adv.later")}</button>
          </div>
          {extra}
        </div>
      </div>
    </article>
  );
}

function Thumb({ piece, onPhoto, lang = "en" }: { piece: Piece; onPhoto: (piece: Piece, file: File) => void; lang?: Lang }) {
  if (piece.photo) return <img src={piece.photo} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />;
  return (
    <label className="grid size-16 shrink-0 cursor-pointer place-items-center rounded-2xl border border-dashed border-line text-ink" aria-label={tx(lang, "adv.addPhotoOf", { name: piece.name })}>
      <Camera className="size-5" strokeWidth={1.75} />
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPhoto(piece, file);
        }}
      />
    </label>
  );
}

function DoneLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-ink">
      <Check className="mt-0.5 size-4 shrink-0" style={{ color: litTone(GREEN) }} strokeWidth={2.25} />
      <span className="break-words">{text}</span>
    </p>
  );
}

function PieceActs({
  lang = "en",
  piece,
  reasonFor,
  setReasonFor,
  onKeep,
  onReturn,
  onRemove,
  onFlag,
}: {
  lang?: Lang;
  piece: Piece;
  reasonFor: string | null;
  setReasonFor: (id: string | null) => void;
  onKeep: (piece: Piece) => void;
  onReturn: (piece: Piece) => void;
  onRemove: (piece: Piece, reason: string) => void;
  onFlag: (piece: Piece) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink">
      {piece.status === "available" ? <button type="button" className="press" onClick={() => onKeep(piece)}>{tx(lang, "adv.keep")}</button> : null}
      {piece.status === "kept" ? <button type="button" className="press" onClick={() => onReturn(piece)}>{tx(lang, "adv.shelve")}</button> : null}
      {piece.status === "incoming" ? <button type="button" className="press" onClick={() => onFlag(piece)}>{tx(lang, "adv.markLate")}</button> : null}
      {piece.status === "incoming" ? <button type="button" className="press" onClick={() => onReturn(piece)}>{tx(lang, "adv.itsHere")}</button> : null}
      {(piece.status === "sold" || piece.wasSold) && piece.status !== "kept" && piece.status !== "available" ? <button type="button" className="press" onClick={() => onReturn(piece)}>{tx(lang, "adv.cameBack")}</button> : null}
      {piece.status === "available" || piece.status === "incoming" ? <button type="button" className="press" onClick={() => setReasonFor(reasonFor === piece.id ? null : piece.id)}>{tx(lang, "common.remove")}</button> : null}
      {reasonFor === piece.id ? [tx(lang, "adv.reasonGifted"), tx(lang, "adv.reasonDamaged"), tx(lang, "adv.reasonSentBack")].map((reason) => (
        <button key={reason} type="button" className="press" onClick={() => { onRemove(piece, reason); setReasonFor(null); }}>{reason}</button>
      )) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- glance cards (1.1.1) */

type GlanceItem = {
  id: string;
  icon: LucideIcon;
  tone: string;
  question: string;
  horizon: string;
  title: string;
  figure?: string;
  unit?: string;
  caption?: string;
  visual?: ReactNode;
  lead: string;
  rest: string;
};

/** A card's head: its icon in a lit disc, the heading, and (optionally) when it applies, as a pill on the same line. */
function CardHead({ icon: Icon, tone, title, pill }: { icon: LucideIcon; tone: string; title: string; pill?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="icon-disc grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }} aria-hidden>
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <h3 className="min-w-0 flex-1 font-display text-xl leading-tight">{title}</h3>
      {pill ? <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] leading-tight whitespace-nowrap text-faint">{pill}</span> : null}
    </div>
  );
}

/** The key figure: big, with its unit and one short caption. */
function Figure({ value, unit, caption, tone }: { value: string; unit?: string; caption?: string; tone: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="figure-lit font-display text-3xl leading-none whitespace-nowrap tabular-nums" style={{ ["--tone" as string]: tone }}>{value}</span>
      {unit ? <span className="text-sm whitespace-nowrap text-muted">{unit}</span> : null}
      {caption ? <span className="text-sm text-muted">{caption}</span> : null}
    </div>
  );
}

function Expander({ open, onToggle, lang = "en" }: { open: boolean; onToggle: () => void; lang?: Lang }) {
  return (
    <button type="button" aria-expanded={open} className="press mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-accent" onClick={onToggle}>
      {open ? tx(lang, "adv.showLess") : tx(lang, "adv.readReasoning")}
      <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.9} aria-hidden />
    </button>
  );
}

function InsightCard({ shot, icon: Icon, tone, question, horizon, title, figure, unit, caption, visual, lead, rest, open, onToggle, lang = "en" }: GlanceItem & { shot: string; open: boolean; onToggle: () => void; lang?: Lang }) {
  return (
    <article data-shot={shot} className="insight advice-in relative overflow-hidden rounded-3xl border border-line bg-panel px-4 pt-3.5 pb-4" style={{ ["--tone" as string]: tone }}>
      <span className="tone-edge" aria-hidden />
      <div className="flex items-center gap-2.5">
        <span className="icon-disc grid size-7 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }} aria-hidden>
          <Icon className="size-3.5" strokeWidth={2} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-tight font-medium text-muted">{question}</p>
        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] leading-tight whitespace-nowrap text-faint">{horizon}</span>
      </div>
      <h3 className="mt-2.5 font-display text-xl leading-snug"><NoSplit text={title} /></h3>
      {figure && !visual ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="figure-lit font-display text-3xl leading-none whitespace-nowrap tabular-nums" style={{ ["--tone" as string]: tone }}>{figure}</span>
          {unit ? <span className="text-sm whitespace-nowrap text-muted">{unit}</span> : null}
          {caption ? <span className="text-sm text-muted">{caption}</span> : null}
        </p>
      ) : figure ? (
        <div className="mt-3 flex items-center gap-4">
          <div className="min-w-0 shrink-0" style={{ maxWidth: "48%" }}>
            <p className="flex items-baseline gap-1.5">
              <span className="figure-lit font-display text-3xl leading-none whitespace-nowrap tabular-nums" style={{ ["--tone" as string]: tone }}>{figure}</span>
              {unit ? <span className="text-sm whitespace-nowrap text-muted">{unit}</span> : null}
            </p>
            {caption ? <p className="mt-1 text-xs leading-snug text-muted">{caption}</p> : null}
          </div>
          {visual ? <div className="min-w-0 flex-1">{visual}</div> : null}
        </div>
      ) : null}
      <p className="mt-3 text-sm leading-relaxed text-pretty text-ink">{commas(open && rest ? `${lead} ${rest}` : lead)}</p>
      {rest ? <Expander lang={lang} open={open} onToggle={onToggle} /> : null}
    </article>
  );
}

/** Pieces on hand across the age ramp, as one segmented line with the count under each step. */
function AgeRamp({ buckets }: { buckets: { id: string; label: string; units: number; tone: string }[] }) {
  const total = buckets.reduce((sum, b) => sum + b.units, 0);
  if (!total) return null;
  return (
    <div aria-hidden>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {buckets.filter((b) => b.units > 0).map((b, i) => (
          <span key={b.id} className="bar-fill lit-bar block h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(b.units / total) * 100}%`, background: litTone(b.tone), ["--glow" as string]: litTone(b.tone), animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
      <div className="mt-1.5 grid text-[10px] leading-tight tabular-nums text-muted" style={{ gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` }}>
        {buckets.map((b) => (
          <span key={b.id} className="text-center whitespace-nowrap"><span className="block text-xs text-ink">{b.units}</span>{b.label.replace(/\s*d$/, "")}</span>
        ))}
      </div>
    </div>
  );
}

/** Of what a sale brought in: what went back to cost and what stayed. */
function KeptSplit({ sale, kept, lang = "en" }: { sale: number; kept: number; lang?: Lang }) {
  if (sale <= 0) return null;
  const k = Math.max(0, Math.min(sale, kept));
  const green = litTone(GREEN);
  return (
    <div aria-hidden>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span className="bar-fill block h-full rounded-l-full" style={{ width: `${((sale - k) / sale) * 100}%`, background: "color-mix(in srgb, var(--v-muted) 45%, var(--v-panel-2))" }} />
        {k > 0 ? <span className="bar-fill lit-bar block h-full rounded-r-full" style={{ width: `${(k / sale) * 100}%`, background: green, ["--glow" as string]: green, animationDelay: "120ms" }} /> : null}
      </div>
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] whitespace-nowrap tabular-nums text-muted">
        <span>{tx(lang, "adv.costAndAd", { x: money(sale - k) })}</span>
        <span style={{ color: kept < 0 ? "var(--v-danger)" : green }}>{tx(lang, "adv.keptWord", { x: money(kept) })}</span>
      </div>
    </div>
  );
}

/** One share of a whole, e.g. how much of the shelf is one type. */
function ShareBar({ label, share, count }: { label: string; share: number; count?: string }) {
  const tone = "var(--tone)";
  return (
    <div aria-hidden>
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <span className="bar-fill lit-bar block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, share))}%`, background: tone, ["--glow" as string]: tone }} />
      </div>
      <p className="mt-1.5 text-[11px] leading-snug tabular-nums text-muted"><span className="text-ink">{share}%</span> {label}{count ? ` · ${count}` : ""}</p>
    </div>
  );
}

/** The top few names, each a slim bar on one line. */
function MiniRank({ rows, tone }: { rows: { name: string; n: number }[]; tone: string }) {
  const peak = Math.max(1, ...rows.map((row) => row.n));
  return (
    <ul className="space-y-1" aria-hidden>
      {rows.map((row, i) => (
        <li key={row.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-[11px] text-muted">
          <span className="min-w-0 leading-tight break-words">{row.name}</span>
          <span className="tabular-nums text-ink">{row.n}</span>
          <span className="col-span-2 h-1 overflow-hidden rounded-full bg-panel-2"><span className="bar-fill lit-bar block h-full rounded-full" style={{ width: `${(row.n / peak) * 100}%`, background: tone, ["--glow" as string]: tone, animationDelay: `${i * 60}ms` }} /></span>
        </li>
      ))}
    </ul>
  );
}

/** The twelve months, boot season (September to February) lit, this month ringed. */
function MonthStrip({ tone, lang = "en" }: { tone: string; lang?: Lang }) {
  const now = new Date().getMonth();
  const names = lang === "es" ? ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] : ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <div aria-hidden>
      <div className="grid grid-cols-12 gap-0.5">
        {names.map((name, m) => {
          const season = m >= 8 || m <= 1;
          return (
            <span key={m} className="flex flex-col items-center gap-1">
              <span className={`block h-2 w-full rounded-full ${season ? "lit-bar" : ""}`} style={{ background: season ? tone : "var(--v-panel-2)", ["--glow" as string]: tone, opacity: season ? (m === now ? 1 : 0.7) : 1, outline: m === now ? "1.5px solid var(--v-ink)" : undefined, outlineOffset: 1.5 }} />
              <span className={`text-[10px] leading-none ${m === now ? "font-semibold text-ink" : "text-faint"}`}>{name}</span>
            </span>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] whitespace-nowrap text-muted">{tx(lang, "adv.bootSeason")}</p>
    </div>
  );
}

/** A small lit kicker: icon disc and label in the card's tone. */
function Kick({ icon: Icon, tone, text }: { icon: LucideIcon; tone: string; text: string }) {
  return (
    <p className="flex items-center gap-2.5 text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color: tone }}>
      <span className="icon-disc grid size-7 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }} aria-hidden>
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      {text}
    </p>
  );
}
