import { useState, type ReactNode } from "react";
import { Camera, Check, ChevronDown } from "lucide-react";
import type { Advice, AdviceCard } from "@/lib/ventory/advisor";
import { missingOf } from "@/lib/ventory/advisor";
import { daysHeld, money, type Piece } from "@/lib/ventory/model";

const GREEN = "#5f8f72";
const AMBER = "#b08a3e";
const RED = "#a33b32";

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
  const onHand = pieces.filter((piece) => piece.status === "available").sort((a, b) => b.costCents * b.qty - a.costCents * a.qty);
  const coming = pieces.filter((piece) => piece.status === "incoming").reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
  const action = pieces.find((piece) => piece.id === advice.actionPieceId) ?? null;
  const price = advice.cards.find((card) => card.id === "price");
  const average = price?.title.match(/\$[0-9,]+\.\d{2}/)?.[0] ?? price?.body.match(/\$[0-9,]+\.\d{2}/)?.[0] ?? null;
  const notes = advice.cards.filter((card) => GLANCE.has(card.id));
  const counted = advice.cards.filter((card) => !GLANCE.has(card.id) && card.id !== "price" && card.id !== "aging");

  const pieceTasks = onHand
    .filter((piece) => piece.id !== action?.id && missingOf(piece).length > 0)
    .map((piece) => ({ id: piece.id, piece, focus: focusOf(piece), kind: "piece" as const }));
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

  return (
    <div className="mt-4 space-y-5">
      <section>
        <p className="text-[11px] tracking-[0.16em] text-ink uppercase">Your shelf · {advice.stage}</p>
        <h2 className="mt-2 font-display text-4xl leading-tight break-words">{leadOf(advice.headline)}</h2>
        <p className="mt-3 font-display text-3xl leading-none">{advice.ready} of {onHand.length} ready</p>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {onHand.map((piece) => {
            const ready = missingOf(piece).length === 0;
            return (
              <li key={piece.id} className="flex max-w-full items-start gap-2 text-sm text-ink">
                <span className="mt-1 size-2.5 shrink-0 rounded-full border" style={{ background: ready ? GREEN : "transparent", borderColor: ready ? GREEN : AMBER }} aria-hidden />
                <span className="break-words">{piece.name}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-ink">
          <span className="rounded-full bg-panel px-3 py-1.5">On hand {money(advice.onHandCents)}</span>
          <span className="rounded-full bg-panel px-3 py-1.5">Coming {money(coming)}</span>
          <span className="rounded-full bg-panel px-3 py-1.5 break-words">Oldest: {advice.oldestLabel}</span>
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
        if (!open) {
          return (
            <button key={task.id} type="button" className="press flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left text-sm text-ink" onClick={() => { setLater((current) => current.filter((id) => id !== task.id)); setFront(task.id); }}>
              <span className="break-words">{task.kind === "price" ? "Set asking prices" : task.piece?.name}</span>
              <span className="shrink-0 tabular-nums text-ink">{task.kind === "price" ? average : task.focus ? BUTTON[task.focus] : "Open"}</span>
            </button>
          );
        }
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

      {donePieces.map((piece) => <DoneLine key={piece.id} text={`${piece.name} is ready to list`} />)}

      <section className="space-y-3">
        <p className="text-[11px] tracking-[0.16em] text-ink uppercase">What makes the next sale easier</p>

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
              <ul className="mt-3 border-t border-line">
                {sizes.map((row) => (
                  <li key={row.label} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 text-sm text-ink last:border-b-0">
                    <span className="break-words">{row.label}</span>
                    <span className="shrink-0 tabular-nums">{row.n} sold</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {unsized.length ? (
            <ul className="mt-3 border-t border-line">
              {unsized.map((piece) => (
                <li key={piece.id}>
                  <button type="button" className="press flex w-full items-baseline justify-between gap-3 border-b border-line py-2.5 text-left text-sm text-ink last:border-b-0" onClick={() => onOpen(piece, "size")}>
                    <span className="break-words">{piece.name}</span>
                    <span className="shrink-0" style={{ color: AMBER }}>Add size</span>
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
          <ul className="mt-3 border-t border-line">
            {waiting.map(({ piece, days }) => (
              <li key={piece.id} className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 text-sm text-ink last:border-b-0">
                <span className="min-w-0 break-words">{piece.name}{piece.status === "incoming" ? " · on the way" : ""}</span>
                <span className="shrink-0 tabular-nums">{days == null ? "No date" : `${days}d`}</span>
              </li>
            ))}
          </ul>
        </article>

        {notes.map((card) => (
          <article key={card.id} className="rounded-3xl border border-line bg-panel px-4 py-4" style={{ borderLeftWidth: 4, borderLeftColor: card.tone === "loss" ? RED : card.id === "ads" ? AMBER : GREEN }}>
            <p className="text-sm leading-relaxed text-ink">{decisionLine(card)}</p>
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
                <div key={card.id}>
                  <h3 className="font-display text-xl leading-tight break-words">{card.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink">{open && text.rest ? `${text.short} ${text.rest}` : text.short}</p>
                  {text.rest ? <button type="button" className="press mt-1 text-sm text-ink" onClick={() => setMore((current) => open ? current.filter((id) => id !== card.id) : [...current, card.id])}>{open ? "Less" : "More"}</button> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <p className="text-sm leading-relaxed text-ink">If a detail is not on a piece's card, I say what is missing instead of inventing it.</p>
      <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm text-ink" onClick={() => void navigator.clipboard?.writeText(advice.plan)}>
        Copy plan
      </button>
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
  const color = tone === "green" ? GREEN : tone === "red" ? RED : AMBER;
  const missing = piece ? missingOf(piece) : [];
  return (
    <article className="rounded-3xl border border-line bg-panel p-4" style={{ borderLeftWidth: 6, borderLeftColor: color }}>
      <div className="flex items-start gap-3">
        {piece ? <Thumb piece={piece} onPhoto={onPhoto} /> : null}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[0.14em] text-ink uppercase">{kicker}</p>
          <h3 className="mt-1 font-display text-3xl leading-tight break-words">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink">{body}</p>
          {missing.length ? <p className="mt-2 text-sm text-ink">Missing {missing.join(", ")}.</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="press h-11 rounded-full px-4 text-sm font-medium" style={{ background: color, color: "#f3f0e8" }} onClick={onOpen}>{button}</button>
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
      <Check className="mt-0.5 size-4 shrink-0" style={{ color: GREEN }} strokeWidth={2.25} />
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
