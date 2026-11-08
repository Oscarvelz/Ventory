import { useMemo, useState, type ReactNode } from "react";
import { Camera, Check, ChevronDown } from "lucide-react";
import type { Advice, AdviceCard } from "@/lib/ventory/advisor";
import { missingOf } from "@/lib/ventory/advisor";
import { daysHeld, money, type Piece } from "@/lib/ventory/model";
import { tone as litTone, toneInk } from "@/lib/ventory/tones";
import { moveList, priceList, restockList } from "@/lib/ventory/insights";
import { ageTone, cash, measure } from "@/lib/ventory/metrics";
import { commas } from "@/lib/ventory/export/model";
import { AgeColumns, Bars, PriceTrack } from "@/components/ventory/charts";

const GREEN = "#5f8f72";
const AMBER = "#b08a3e";
const RED = "#a33b32";
const TEAL = "#4f7f8a";

/** A name that may wrap between words but never inside one: "Casio G-Shock" never breaks as "G-" / "Shock". */
function NoSplit({ text }: { text: string }) {
  const words = text.split(/(\s+)/);
  return <>{words.map((word, i) => (/\S-\S/.test(word) ? <span key={i} className="whitespace-nowrap">{word}</span> : word))}</>;
}

function ReadyRing({ ready, total }: { ready: number; total: number }) {
  const p = total ? ready / total : 0;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90" aria-hidden>
      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--v-panel-2)" strokeWidth="8" />
      {p > 0 ? <circle cx="32" cy="32" r="26" fill="none" stroke={litTone(GREEN)} strokeWidth="8" strokeLinecap="round" pathLength={1} strokeDasharray={`${p} 1`} className="gauge-grow" /> : null}
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

const BUTTON: Record<AdviceFocus, string> = {
  photo: "Add photo",
  size: "Add size",
  ask: "Set price",
  brand: "Add brand",
  place: "Set place",
  date: "Add date",
  source: "Add source",
  cost: "Add cost",
};

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
    .replace(/\s+([.,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clip(text: string) {
  const clean = spoken(text);
  if (clean.length <= 180) return { short: clean, rest: "" };
  const slice = clean.slice(0, 180);
  const at = slice.lastIndexOf(" ");
  const short = slice.slice(0, at > 60 ? at : 180).trim();
  return { short, rest: clean.slice(short.length).trim() };
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
  if (piece.usSize) return `US ${piece.usSize}`;
  if (piece.sizeLabel) return `${piece.sizeSystem} ${piece.sizeLabel}`.trim();
  return "";
}

function soldPiece(piece: Piece) {
  return piece.status === "sold" || piece.wasSold;
}

function decisionLine(card: AdviceCard) {
  if (card.id === "buy") {
    const committed = card.body.match(/\$[0-9,]+\.\d{2}/)?.[0];
    const share = card.body.match(/\d+%/)?.[0];
    const kind = /boot/i.test(card.body) ? "boots" : "one type";
    return `${card.title}. ${committed ?? "This shelf"} is committed${share ? `, and ${share} of the pieces are ${kind}` : ""}. Buy a size again only after it has sold more than once.`;
  }
  if (card.id === "ads") return `${card.title}. Promote a piece only when the asking price is already above what it cost.`;
  if (card.id === "sources") return `${card.title}. Order from a source again only after its pieces have sold more than once.`;
  if (card.id === "season") return `${card.title}. Use the season to list what you already own, not to buy more.`;
  if (card.id === "lesson") return clip(card.body).short;
  return clip(card.body).short;
}

function needsLine(piece: Piece) {
  const missing = missingOf(piece);
  if (missing.includes("size") && /boot|shoe/i.test(`${piece.category} ${piece.name}`)) return "A boot without a size cannot be filtered to, so it is harder to sell.";
  const show = missing.slice(0, 3).join(", ");
  return show ? `Still open: ${show}. It cost ${money(piece.costCents)}.` : `${piece.name} cost ${money(piece.costCents)}.`;
}

export function AdvisorView({
  advice,
  pieces,
  onOpen,
  onPhoto,
  onKeep,
  onReturn,
  onRemove,
  onFlag,
}: {
  advice: Advice;
  pieces: Piece[];
  onOpen: (piece: Piece, focus?: AdviceFocus) => void;
  onPhoto: (piece: Piece, file: File) => void;
  onKeep: (piece: Piece) => void;
  onReturn: (piece: Piece) => void;
  onRemove: (piece: Piece, reason: string) => void;
  onFlag: (piece: Piece) => void;
}) {
  const [later, setLater] = useState<string[]>([]);
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
  const restock = useMemo(() => restockList(pieces), [pieces]);
  const move = useMemo(() => moveList(pieces), [pieces]);
  const priceRows = useMemo(() => priceList(pieces), [pieces]);
  const ageing = useMemo(() => measure(pieces).aging, [pieces]);
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
  const agingText = aging ? clip(aging.body) : null;

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
      const name = piece.name.trim() || "Untitled";
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
      label: field === "asking price" ? "Asking price" : field === "bought from" ? "Bought from" : field[0].toUpperCase() + field.slice(1),
      focus: FOCUS_OF[field],
      pieces: onHand.filter((piece) => !shownIds.has(piece.id) && missingOf(piece).includes(field)),
    }))
    .filter((fix) => fix.pieces.length > 0)
    .sort((a, b) => b.pieces.length - a.pieces.length);
  const readyPeak = Math.max(1, ...readiness.map((row) => row.total));
  const restockPeak = Math.max(1, ...restock.map((row) => row.recent));
  const moveUnits = move.reduce((sum, row) => sum + row.units, 0);
  const moveCost = move.reduce((sum, row) => sum + row.cost, 0);
  const priceMax = Math.max(1, ...priceRows.slice(0, 12).flatMap((row) => [row.high, row.cost, ...row.asks])) * 1.08;

  return (
    <div className="mt-4 space-y-5">
      <section className="advice-hero framed rounded-3xl bg-panel p-5">
        <p className="text-[11px] tracking-[0.16em] text-faint uppercase">Your shelf · {advice.stage}</p>
        <h2 className="mt-2 font-display text-4xl leading-tight break-words">{commas(leadOf(advice.headline))}</h2>
        <div className="mt-4 flex items-center gap-4">
          <ReadyRing ready={advice.ready} total={onHand.length} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-3xl leading-none tabular-nums">{advice.ready} of {onHand.length} ready</p>
            <p className="mt-1.5 text-sm text-muted">{onHand.length === 0 ? "Nothing on hand to list." : advice.ready === onHand.length ? "Every piece on hand has its card complete." : `A card is ready when it has its size, photo, cost, asking price, date, brand, source and place.`}</p>
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
                    <span className="block h-full" style={{ width: `${(row.ready / row.total) * 100}%`, background: litTone(GREEN) }} />
                    <span className="block h-full flex-1" style={{ background: `color-mix(in srgb, ${litTone(AMBER)} 55%, transparent)` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {readiness.length > 5 ? (
          <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllReady((v) => !v)}>{allReady ? "Show fewer" : `Show all ${readiness.length} products`}</button>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2 text-sm text-ink">
          <span className="row-in inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5" style={{ animationDelay: "40ms" }}><span className="size-2 shrink-0 rounded-full" style={{ background: litTone(GREEN) }} aria-hidden />On hand {cash(advice.onHandCents)}</span>
          <span className="row-in inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5" style={{ animationDelay: "90ms" }}><span className="size-2 shrink-0 rounded-full" style={{ background: litTone("#5d86ad") }} aria-hidden />Coming {cash(coming)}</span>
          <span className="row-in inline-flex items-center gap-2 rounded-full bg-panel-2 px-3 py-1.5 break-words" style={{ animationDelay: "140ms" }}><span className="size-2 shrink-0 rounded-full" style={{ background: litTone(AMBER) }} aria-hidden />Oldest: {advice.oldestLabel}</span>
        </div>
      </section>

      {action && actionOpen ? (
        <ActionCard
          kicker="Do this first"
          title={action.name}
          body={`Your priciest piece on hand, ${money(action.costCents)}. ${needsLine(action)}`}
          piece={action}
          tone="green"
          button={BUTTON[focusOf(action) ?? "photo"]}
          onOpen={() => onOpen(action, focusOf(action) ?? "photo")}
          onPhoto={onPhoto}
          onLater={() => setLater((current) => [...current, "action"])}
          extra={<PieceActs piece={action} reasonFor={reasonFor} setReasonFor={setReasonFor} onKeep={onKeep} onReturn={onReturn} onRemove={onRemove} onFlag={onFlag} />}
        />
      ) : action && missingOf(action).length === 0 ? (
        <DoneLine text={`${action.name} is ready to list`} />
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
              key={task.id}
              kicker="Price"
              title="Set asking prices"
              body={price?.tone === "loss" ? clip(price.body).short : `Break-even is the lowest price that leaves you whole. On-hand pieces cost ${average} each.`}
              piece={task.piece}
              tone={price?.tone === "loss" ? "red" : "amber"}
              button="Price pieces"
              onOpen={() => task.piece && onOpen(task.piece, "ask")}
              onPhoto={onPhoto}
              onLater={() => setLater((current) => [...current, task.id])}
            />
          );
        }
        if (!task.piece || !task.focus) return null;
        return (
          <ActionCard
            key={task.id}
            kicker="Also today"
            title={task.piece.name}
            body={needsLine(task.piece)}
            piece={task.piece}
            tone="amber"
            button={BUTTON[task.focus]}
            onOpen={() => task.focus && task.piece && onOpen(task.piece, task.focus)}
            onPhoto={onPhoto}
            onLater={() => setLater((current) => [...current, task.id])}
            extra={<PieceActs piece={task.piece} reasonFor={reasonFor} setReasonFor={setReasonFor} onKeep={onKeep} onReturn={onReturn} onRemove={onRemove} onFlag={onFlag} />}
          />
        );
      })}

      {fixes.length ? (
        <section className="advice-in rounded-3xl border border-line bg-panel px-4 py-4">
          <h3 className="font-display text-2xl leading-tight">What the cards still need</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Of the {onHand.length} on hand, how many are missing each detail. Open a line to fill it in.</p>
          <ul className="mt-3 border-t border-line">
            {fixes.map((fix, index) => {
              const open = fixOpen === fix.field;
              const shown = open ? fix.pieces.slice(0, fixAll ? undefined : 6) : [];
              return (
                <li key={fix.field} className="border-b border-line last:border-b-0">
                  <button type="button" aria-expanded={open} className="press row-in flex w-full items-center gap-3 py-2.5 text-left" style={{ animationDelay: `${index * 40}ms` }} onClick={() => { setFixOpen(open ? null : fix.field); setFixAll(false); }}>
                    <span className="w-28 shrink-0 text-sm text-ink">{fix.label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                      <span className="bar-fill block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((fix.pieces.length / Math.max(1, onHand.length)) * 100))}%`, background: litTone(AMBER), animationDelay: `${index * 40}ms` }} />
                    </span>
                    <span className="w-9 shrink-0 text-right text-sm tabular-nums text-ink">{fix.pieces.length}</span>
                    <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
                  </button>
                  {open ? (
                    <div className="row-in pb-2">
                      {shown.map((piece) => (
                        <button key={piece.id} type="button" className="press flex w-full items-baseline justify-between gap-3 py-1.5 text-left text-sm" onClick={() => onOpen(piece, fix.focus)}>
                          <span className="min-w-0 text-ink">{piece.name}{sizeName(piece) ? <span className="text-muted"> · {sizeName(piece)}</span> : null}</span>
                          <span className="shrink-0" style={{ color: litTone(AMBER) }}>{BUTTON[fix.focus]}</span>
                        </button>
                      ))}
                      {fix.pieces.length > 6 ? <button type="button" className="press mt-1 text-sm text-accent" onClick={() => setFixAll((v) => !v)}>{fixAll ? "Show fewer" : `Show all ${fix.pieces.length}`}</button> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {donePieces.length > 0 && donePieces.length <= 3 ? donePieces.map((piece) => <DoneLine key={piece.id} text={`${piece.name} is ready to list`} />) : donePieces.length > 3 ? <DoneLine text={`${donePieces.length} pieces are ready to list`} /> : null}

      {restock.length || move.length || priceRows.length ? (
        <section className="space-y-3">
          <p className="text-[11px] tracking-[0.16em] text-faint uppercase">Next moves, from your own sales</p>
          {restock.length ? (
            <article className="advice-in rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: litTone(GREEN) }}>
              <p className="text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color: litTone(GREEN) }}>Buy again</p>
              <h3 className="mt-1 font-display text-2xl leading-tight"><NoSplit text={restock[0].product} /></h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">
                {restock[0].sold} sold{restock[0].avgDays != null ? `, about ${restock[0].avgDays} days each` : ""}{restock[0].size ? `, ${restock[0].size} most of all` : ""}. {restock[0].left === 0 ? "None left." : `${restock[0].left} still here${restock[0].weeksLeft != null ? `, about ${restock[0].weeksLeft} ${restock[0].weeksLeft === 1 ? "week" : "weeks"} at this pace` : ""}.`}
              </p>
              <ul className="mt-3 space-y-3">
                {restock.slice(0, allRestock ? undefined : 5).map((row, index) => (
                  <li key={row.product} className="row-in" style={{ animationDelay: `${index * 45}ms` }}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 text-ink">{row.product}</span>
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums" style={{ background: row.left === 0 || (row.weeksLeft != null && row.weeksLeft <= 4) ? `color-mix(in srgb, ${litTone(AMBER)} 24%, transparent)` : "var(--v-panel-2)", color: "var(--v-ink)" }}>{row.left === 0 ? "sold out" : `${row.left} left`}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2"><span className="bar-fill block h-full rounded-full" style={{ width: `${Math.max(3, Math.round((row.recent / Math.max(1, restockPeak)) * 100))}%`, background: litTone(GREEN), animationDelay: `${index * 45}ms` }} /></span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">{row.size ? `${row.size} · ` : ""}{row.recent} in 90 days</span>
                    </div>
                  </li>
                ))}
              </ul>
              {restock.length > 5 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllRestock((v) => !v)}>{allRestock ? "Show fewer" : `Show all ${restock.length}`}</button> : null}
              <p className="mt-3 text-xs leading-relaxed text-muted">Only products that sold more than once. The bar is the last 90 days.</p>
            </article>
          ) : null}
          {move.length ? (
            <article className="advice-in rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: litTone(AMBER) }}>
              <p className="text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color: litTone(AMBER) }}>Move these</p>
              <h3 className="mt-1 font-display text-2xl leading-tight">{moveUnits} {moveUnits === 1 ? "piece has" : "pieces have"} outstayed their pace</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink">{cash(moveCost)} at cost is waiting past the time these products usually take to sell. A first cut is about 10% (20% past 90 days), never under what the piece cost.</p>
              <ul className="mt-3 border-t border-line">
                {move.slice(0, allMove ? undefined : 4).map((row, index) => (
                  <li key={row.product} className="row-in border-b border-line py-2.5 last:border-b-0" style={{ animationDelay: `${index * 45}ms` }}>
                    <button type="button" className="press flex w-full items-center justify-between gap-3 text-left" onClick={() => onOpen(row.pieces[0].piece, "ask")}>
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">{row.product}</span>
                        <span className="block text-xs tabular-nums text-muted">{row.units} {row.units === 1 ? "piece" : "pieces"} · oldest {row.oldest} d{row.pace != null ? ` · usually ${row.pace} d` : ""}{row.ask != null ? ` · asking ${cash(row.ask, true)}` : ""}</span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums" style={{ color: litTone(AMBER) }}>{row.cut != null ? `Try ${cash(row.cut, true)}` : "Set a price"}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {move.length > 4 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllMove((v) => !v)}>{allMove ? "Show fewer" : `Show all ${move.length} products`}</button> : null}
            </article>
          ) : null}
          {priceRows.length ? (
            <article className="advice-in rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: litTone(TEAL) }}>
              <p className="text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color: litTone(TEAL) }}>Price from your sales</p>
              <h3 className="mt-1 font-display text-2xl leading-tight">What buyers actually paid</h3>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full" style={{ background: litTone(GREEN), opacity: 0.45 }} />Range paid</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: litTone(GREEN) }} />Usual</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 rounded-[2px]" style={{ background: litTone(AMBER) }} />Your asks</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-muted" />Cost</span>
              </div>
              <ul className="mt-3 space-y-3.5">
                {priceRows.slice(0, allPrice ? undefined : 4).map((row, index) => (
                  <li key={row.product} className="row-in" style={{ animationDelay: `${index * 45}ms` }}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 text-ink">{row.product}</span>
                      <span className="shrink-0 tabular-nums" style={{ color: row.below ? "var(--v-danger)" : "var(--v-ink)" }}>ask ${Math.round(row.suggest / 100)}</span>
                    </div>
                    <PriceTrack cost={row.cost} low={row.low} high={row.high} median={row.median} asks={row.asks} scaleMax={priceMax} />
                    <p className="text-xs tabular-nums text-muted">{row.low === row.high ? `${row.sales} sales at ${money(row.low)}` : `${row.sales} sales from ${money(row.low)} to ${money(row.high)}`}{row.below ? ` · ${row.below} asking under cost` : row.above ? ` · ${row.above} asking above any sale` : row.unasked ? ` · ${row.unasked} with no ask` : ""}</p>
                  </li>
                ))}
              </ul>
              {priceRows.length > 4 ? <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAllPrice((v) => !v)}>{allPrice ? "Show fewer" : `Show all ${priceRows.length}`}</button> : null}
            </article>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <p className="text-[11px] tracking-[0.16em] text-faint uppercase">What makes the next sale easier</p>

        <article className="rounded-3xl border border-line bg-panel px-4 py-4">
          <h3 className="font-display text-2xl leading-tight">Which size is selling</h3>
          {sizes.length === 0 ? (
            <p className="mt-2 text-sm leading-relaxed text-ink">No size has sold yet, so none can be called the one to reorder. A size only ranks after it leaves.</p>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink">
                {sizes[0].label} has sold {sizes[0].n} {sizes[0].n === 1 ? "time" : "times"}
                {sizes[0].days.length ? `, and those took about ${Math.round(sizes[0].days.reduce((sum, days) => sum + days, 0) / sizes[0].days.length)} days` : ""}.
                {sizes[0].n === 1 ? " One sale is a lesson, not a size to stock." : " That is the size to buy again."}
              </p>
              <div className="mt-3">
                <Bars rows={sizes.map((row) => ({ label: row.label, value: row.n, text: `${row.n} sold`, sub: `${sizeLeft.get(row.label) ?? 0} left`, tone: "#5d86ad" }))} limit={6} />
              </div>
            </>
          )}
          {unsized.length ? (
            <ul className="mt-3 border-t border-line">
              {unsized.slice(0, 5).map((piece) => (
                <li key={piece.id}>
                  <button type="button" className="press flex w-full items-baseline justify-between gap-3 border-b border-line py-2.5 text-left text-sm text-ink last:border-b-0" onClick={() => onOpen(piece, "size")}>
                    <span className="break-words">{piece.name}</span>
                    <span className="shrink-0" style={{ color: litTone(AMBER) }}>Add size</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </article>

        <article className="rounded-3xl border border-line bg-panel px-4 py-4">
          <h3 className="font-display text-2xl leading-tight">How long they sit</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink">
            {soldPace == null
              ? "Nothing has sold with both dates, so this is waiting time, not a selling pace."
              : `Sold pieces left in about ${soldPace} ${soldPace === 1 ? "day" : "days"}. Use that when a piece below is already past it.`}
          </p>
          <div className="mt-4"><AgeColumns buckets={ageing.buckets} /></div>
          <ul className="mt-3 border-t border-line">
            {waiting.slice(0, 5).map(({ piece, days }) => (
              <li key={piece.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-sm text-ink last:border-b-0">
                <span className="min-w-0 break-words">{piece.name}{piece.status === "incoming" ? <span className="text-muted"> · on the way</span> : null}</span>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums" style={{ background: days == null ? "var(--v-panel-2)" : `color-mix(in srgb, ${litTone(ageTone(days))} 24%, transparent)` }}>{days == null ? "No date" : `${days} d`}</span>
              </li>
            ))}
          </ul>
          {waiting.length > 5 ? <p className="mt-2 text-xs text-muted">The five that have waited longest, of {waiting.length} on hand and on the way.</p> : null}
        </article>

        {aging && agingText ? (
          <article className="advice-in rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: aging.tone === "ready" ? litTone(GREEN) : litTone(AMBER) }}>
            <p className="mb-1.5 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">{aging.question} · {aging.horizon}</p>
            <h3 className="font-display text-2xl leading-tight break-words">{aging.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink">{more.includes(aging.id) && agingText.rest ? `${agingText.short} ${agingText.rest}` : agingText.short}</p>
            {agingText.rest ? <button type="button" className="press mt-1 text-sm text-muted" onClick={() => setMore((current) => more.includes(aging.id) ? current.filter((id) => id !== aging.id) : [...current, aging.id])}>{more.includes(aging.id) ? "Less" : "More"}</button> : null}
          </article>
        ) : null}

        {notes.map((card) => (
          <article key={card.id} className="rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: card.tone === "loss" ? litTone(RED) : card.id === "ads" ? litTone(AMBER) : litTone(GREEN) }}>
            <p className="mb-1.5 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">{card.question} · {card.horizon}</p>
            {(() => {
              const text = card.id === "lesson" ? bySentence(card.body) : { short: decisionLine(card), rest: "" };
              const open = more.includes(card.id);
              return (
                <>
                  <p className="text-sm leading-relaxed text-ink">{open && text.rest ? `${text.short} ${text.rest}` : text.short}</p>
                  {text.rest ? <button type="button" className="press mt-1 text-sm text-muted" onClick={() => setMore((current) => open ? current.filter((id) => id !== card.id) : [...current, card.id])}>{open ? "Less" : "More"}</button> : null}
                </>
              );
            })()}
          </article>
        ))}
      </section>

      <section className="rounded-3xl border border-line bg-panel">
        <button type="button" className="press flex w-full items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={countOpen} onClick={() => setCountOpen((open) => !open)}>
          <span className="font-medium text-ink">How the numbers are counted</span>
          <ChevronDown className={`size-4 shrink-0 text-ink transition-transform ${countOpen ? "rotate-180" : ""}`} strokeWidth={1.75} />
        </button>
        {countOpen ? (
          <div className="space-y-3 px-4 pb-4">
            {counted.map((card) => {
              const text = clip(card.body);
              const open = more.includes(card.id);
              return (
                <div key={card.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <h3 className="font-display text-xl leading-tight break-words">{card.title} <span className="align-middle font-sans text-[11px] font-medium tracking-[0.14em] whitespace-nowrap text-faint uppercase">{card.horizon}</span></h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{open && text.rest ? `${text.short} ${text.rest}` : text.short}</p>
                  {text.rest ? <button type="button" className="press mt-1 text-sm text-ink" onClick={() => setMore((current) => open ? current.filter((id) => id !== card.id) : [...current, card.id])}>{open ? "Less" : "More"}</button> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">If a detail is not on a piece's card, I say what is missing instead of inventing it.</p>
        <button type="button" className="press h-11 shrink-0 rounded-full bg-accent-soft px-4 text-sm font-medium text-ink" onClick={() => void navigator.clipboard?.writeText(advice.plan)}>
          Copy plan
        </button>
      </div>
    </div>
  );
}

function ActionCard({
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
    <article className="advice-in framed rounded-3xl border border-line p-4" style={{ borderLeftWidth: 6, borderLeftColor: color, background: `color-mix(in srgb, ${color} 9%, var(--v-panel))` }}>
      <div className="flex items-start gap-3">
        {piece ? <Thumb piece={piece} onPhoto={onPhoto} /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-[0.14em] uppercase" style={{ color }}>{kicker}</p>
          <h3 className="mt-1 font-display text-2xl leading-tight"><NoSplit text={title} /></h3>
          {piece && piece.name === title && (sizeName(piece) || piece.receivedOn) ? <p className="mt-0.5 text-xs tabular-nums text-muted">{[sizeName(piece), piece.receivedOn ? `arrived ${new Date(`${piece.receivedOn}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""].filter(Boolean).join(" · ")}</p> : null}
          <p className="mt-2 text-sm leading-relaxed text-ink">{body}</p>
          {missing.length && !/^Still open|Still open:/.test(body) ? <p className="mt-2 text-sm text-ink">Missing {missing.join(", ")}.</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="press h-11 rounded-full px-4 text-sm font-medium" style={{ background: color, color: toneInk("#f3f0e8") }} onClick={onOpen}>{button}</button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm text-ink" onClick={onLater}>Later</button>
          </div>
          {extra}
        </div>
      </div>
    </article>
  );
}

function Thumb({ piece, onPhoto }: { piece: Piece; onPhoto: (piece: Piece, file: File) => void }) {
  if (piece.photo) return <img src={piece.photo} alt="" className="size-16 shrink-0 rounded-2xl object-cover" />;
  return (
    <label className="grid size-16 shrink-0 cursor-pointer place-items-center rounded-2xl border border-dashed border-line text-ink" aria-label={`Add photo of ${piece.name}`}>
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
  piece,
  reasonFor,
  setReasonFor,
  onKeep,
  onReturn,
  onRemove,
  onFlag,
}: {
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
      {piece.status === "available" ? <button type="button" className="press" onClick={() => onKeep(piece)}>Keep</button> : null}
      {piece.status === "kept" ? <button type="button" className="press" onClick={() => onReturn(piece)}>Shelve</button> : null}
      {piece.status === "incoming" ? <button type="button" className="press" onClick={() => onFlag(piece)}>Still coming</button> : null}
      {piece.status === "incoming" ? <button type="button" className="press" onClick={() => onReturn(piece)}>It's here</button> : null}
      {(piece.status === "sold" || piece.wasSold) && piece.status !== "kept" && piece.status !== "available" ? <button type="button" className="press" onClick={() => onReturn(piece)}>Came back</button> : null}
      {piece.status === "available" || piece.status === "incoming" ? <button type="button" className="press" onClick={() => setReasonFor(reasonFor === piece.id ? null : piece.id)}>Remove</button> : null}
      {reasonFor === piece.id ? ["Gifted", "Damaged", "Sent back"].map((reason) => (
        <button key={reason} type="button" className="press" onClick={() => { onRemove(piece, reason); setReasonFor(null); }}>{reason}</button>
      )) : null}
    </div>
  );
}
