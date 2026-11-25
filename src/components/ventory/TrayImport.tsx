import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BadgePercent, CalendarDays, Check, CircleAlert, CircleHelp, CircleUserRound, Layers, ListChecks, MapPin, NotebookPen, PackageSearch, Ruler, Scale, Tag, Truck, Undo2 } from "lucide-react";
import { dollarsToCents, emptyInput, money, type Piece, type PieceInput } from "@/lib/ventory/model";
import { parseDetailedNotes } from "@/lib/ventory/paste";
import { applyTray, buildTray, defaultDecisions, defaultRules, styleKey, type BatchRules, type TrayDecisions } from "@/lib/ventory/tray";
import { tone as litTone, toneInk } from "@/lib/ventory/tones";
import { tx, type Lang } from "@/lib/ventory/i18n";

/* The review's architecture (1.3.0): the tray used to read as one long scroll of prose —
   Oscar's word: boring text, no design. Now it has chapters with kickers, a count band
   instead of a chip river, rule rows with their own icons, decision cards whose evidence
   sits in a quiet inner panel, and a closing import card that ends the review like a
   footer. The jewel material is the same one the Main and History cards wear (1.2.4). */
function JewelDisc({ tone: rawTone, children }: { tone: string; children: ReactNode }) {
  const tone = litTone(rawTone);
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-full"
      style={{
        background: `linear-gradient(145deg, color-mix(in srgb, ${tone} 82%, #ffffff) 0%, ${tone} 55%, color-mix(in srgb, ${tone} 76%, #000000) 100%)`,
        color: toneInk("#f6f3ec"),
        boxShadow: `0 6px 14px -6px ${tone}, inset 0 1px 0 rgba(255, 255, 255, 0.35)`,
      }}
    >
      {children}
    </span>
  );
}

function Kicker({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline gap-3 first:mt-0">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-accent uppercase">{children}</p>
      <span className="h-px flex-1 bg-line" />
      {right ? <span className="text-xs text-muted">{right}</span> : null}
    </div>
  );
}

const GROUP_STYLE: Record<string, { tone: string; icon: typeof CircleAlert }> = {
  returns: { tone: "#a33b32", icon: Undo2 },
  "bad-arithmetic": { tone: "#b08a3e", icon: Scale },
  "uncertain-rebate": { tone: "#b08a3e", icon: BadgePercent },
  names: { tone: "#8d6aad", icon: CircleUserRound },
  "coming-sold": { tone: "#5d86ad", icon: Truck },
  "true-cost": { tone: "#b08a3e", icon: CircleHelp },
  "personal-notes": { tone: "#5f8f72", icon: NotebookPen },
};

const CLASS_TONE: Record<string, string> = {
  sale: "#5f8f72",
  stock: "#5d86ad",
  gift: "#8d6aad",
  returned: "#a33b32",
  used: "#b08a3e",
  kept: "#4f7f8a",
  "failed-sale": "#a33b32",
};

export type TrayPayload = { add: PieceInput[]; update: PieceInput[]; batchNotes: string[] };

/**
 * LA BANDEJA — the batch tray (1.0.16). Paste a whole document; nothing is imported until
 * the preview has classified every line, the batch rules have been asked once, and the
 * review groups and duplicate clusters carry a decision. What the old paste did silently
 * (a return counted as a sale, a rebate decided without asking, a duplicate counted twice)
 * is exactly what the tray puts in front of him, in groups, before a single row lands.
 */
export function TrayImport({ pieces, onApply, onImportCsv, onClose, onDirtyChange, lang = "en" }: {
  pieces: Piece[];
  lang?: Lang;
  onApply: (payload: TrayPayload) => Promise<{ added: number; updated: number }>;
  onImportCsv?: (rows: PieceInput[]) => Promise<number>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [soldBatch, setSoldBatch] = useState(false);
  const [parsed, setParsed] = useState<ReturnType<typeof parseDetailedNotes> | null>(null);
  const [bareSize, setBareSize] = useState<"CN" | "EU">("CN");
  const [year, setYear] = useState("");
  const [place, setPlace] = useState<"" | "home" | "car">("");
  const [usualAsk, setUsualAsk] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<TrayDecisions | null>(null);
  // 1.8.0: success is a RESULT, not a hope — the applied counts come back from the
  // write itself, and a failed write lands on applyError instead of this screen.
  const [appliedResult, setAppliedResult] = useState<{ added: number; updated: number; notes: string[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState(false);
  const [csvDone, setCsvDone] = useState(0);

  // The Editor's discard guard watches the tray through this: unimported text is
  // unsaved work; a completed import is not (1.8.0, G-6).
  useEffect(() => {
    onDirtyChange?.(Boolean(text.trim()) && !appliedResult && !csvDone);
  }, [text, appliedResult, csvDone, onDirtyChange]);

  const rules: BatchRules = useMemo(() => {
    const usual: Record<string, number> = {};
    for (const [key, value] of Object.entries(usualAsk)) {
      const cents = dollarsToCents(value);
      if (cents > 0) usual[key] = cents;
    }
    const yearNum = Number(year);
    return { ...defaultRules(), bareSize, year: Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : null, place, usualAsk: usual };
  }, [bareSize, year, place, usualAsk]);

  const batch = useMemo(() => (parsed ? buildTray(parsed, pieces, rules, lang) : null), [parsed, pieces, rules, lang]);
  const preview = useMemo(() => (batch && decisions ? applyTray(batch, decisions, pieces) : null), [batch, decisions, pieces]);

  const review = () => {
    const next = parseDetailedNotes(text, new Date(), soldBatch);
    setParsed(next);
    setAppliedResult(null); setApplyError(false);
    setDecisions(defaultDecisions(buildTray(next, pieces, rules, lang)));
  };

  // The batch's own answer — products on hand, or a batch of pieces already sold — is read
  // into the parse itself (the parser's soldBatch), so flipping it after a review re-reads
  // the whole note. Before any review it simply records the answer (1.2.6: the question is
  // asked on the entry screen, where Oscar looks for it, not only inside the review).
  const reclassify = (next: boolean) => {
    setSoldBatch(next);
    if (!parsed || !text.trim()) return;
    const reparsed = parseDetailedNotes(text, new Date(), next);
    setParsed(reparsed);
    setAppliedResult(null); setApplyError(false);
    setDecisions(defaultDecisions(buildTray(reparsed, pieces, rules, lang)));
  };

  const csvRows = (): PieceInput[] => {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines[0].split(/,|\t/).map((cell) => cell.trim().toLowerCase());
    const start = headers.some((cell) => cell.includes("name")) ? 1 : 0;
    return lines.slice(start).map((line) => {
      const cells = line.split(/,|\t/).map((cell) => cell.trim());
      const pick = (name: string, index: number) => {
        const at = headers.findIndex((cell) => cell.includes(name));
        return cells[at >= 0 ? at : index] ?? "";
      };
      const size = pick("size", 1);
      const system = size.toUpperCase().includes("CN") ? "CN" : size.toUpperCase().includes("EU") ? "EU" : "US";
      const base = emptyInput();
      return {
        ...base,
        name: pick("name", 0),
        sizeSystem: system,
        sizeLabel: size.replace(/cn|eu|us/gi, "").trim(),
        costCents: dollarsToCents(pick("cost", 2)),
        source: pick("source", 3) || pick("from", 3),
        receivedOn: pick("date", 4) || base.receivedOn,
      };
    }).filter((row) => row.name);
  };

  const control = "h-11 w-full rounded-xl border border-line bg-panel px-3 outline-none focus:border-accent";
  const chip = (active: boolean) => `press h-9 rounded-full border px-3 text-sm ${active ? "border-accent bg-accent-soft" : "border-line"}`;
  const seg = (active: boolean) => `press flex min-h-11 items-center justify-center rounded-xl border px-2 py-2 text-center text-[13px] leading-snug ${active ? "border-accent bg-accent-soft font-medium text-ink" : "border-line text-muted"}`;
  const lightDot = { green: "#3d9970", amber: "#d9930d", red: "#c0392b" } as const;

  if (appliedResult || csvDone) {
    const notes = appliedResult?.notes ?? [];
    return (
      <div className="mt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-accent-soft"><Check className="size-5" strokeWidth={2} /></span>
          <p className="font-display text-2xl">{tx(lang, "tray.batchIn")}</p>
        </div>
        <p className="mt-3 text-sm text-muted">
          {csvDone
            ? tx(lang, "tray.csvDone", { n: csvDone })
            : lang === "es"
              ? `${appliedResult!.added} ${appliedResult!.added === 1 ? "pieza nueva importada" : "piezas nuevas importadas"}${appliedResult!.updated ? `, y ${appliedResult!.updated} que ya estaban en el inventario se completaron en vez de duplicarse` : ""}.`
              : `${appliedResult!.added} new ${appliedResult!.added === 1 ? "piece" : "pieces"} imported${appliedResult!.updated ? `, and ${appliedResult!.updated} already on the floor were completed instead of duplicated` : ""}.`}
        </p>
        {notes.length ? (
          <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <p className="text-sm font-medium">{tx(lang, "tray.batchNotes")}</p>
            <p className="mt-1 text-xs text-muted">{tx(lang, "tray.batchNotesSub")}</p>
            <ul className="mt-2 space-y-1">
              {notes.map((note, i) => <li key={i} className="text-sm">{note}</li>)}
            </ul>
          </div>
        ) : null}
        <button type="button" className="press mt-5 h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink" onClick={onClose}>{tx(lang, "common.done")}</button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        {tx(lang, "tray.intro")}
      </p>
      <textarea
        value={text}
        onChange={(event) => { setText(event.target.value); setParsed(null); setDecisions(null); }}
        className="mt-3 h-40 w-full rounded-2xl border border-line bg-canvas p-3 text-sm outline-none focus:border-accent"
        placeholder={tx(lang, "tray.placeholder")}
      />
      {/* The entrada/salida question, asked up front (1.2.6): products he has, or products he
          already sold. The same answer lives in the review's rules card, where flipping it
          re-reads the note. */}
      <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
        <p className="text-sm font-medium">{tx(lang, "tray.haveOrSold")}</p>
        <div className="mt-2 flex gap-2">
          {([[false, tx(lang, "tray.onHand")], [true, tx(lang, "tray.alreadySold")]] as const).map(([value, label]) => (
            <button key={label} type="button" aria-pressed={soldBatch === value} className={chip(soldBatch === value)} onClick={() => reclassify(value)}>{label}</button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{tx(lang, "tray.haveOrSoldNote")}</p>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" disabled={!text.trim()} onClick={review}>
          {tx(lang, "tray.reviewBatch")}
        </button>
        {parsed && parsed.rows.length === 0 && onImportCsv ? (
          <button
            type="button"
            className="press h-11 rounded-full border border-line px-4 text-sm disabled:opacity-40"
            disabled={applying}
            onClick={async () => {
              const rows = csvRows();
              if (!rows.length || applying) return;
              setApplying(true);
              setApplyError(false);
              try {
                setCsvDone(await onImportCsv(rows));
              } catch {
                setApplyError(true);
              } finally {
                setApplying(false);
              }
            }}
          >
            {tx(lang, "tray.importCsv")}
          </button>
        ) : null}
      </div>
      {applyError && !batch ? <p className="mt-2 text-sm text-danger">{tx(lang, "tray.importFailed")}</p> : null}

      {batch && decisions ? (
        <>
          <Kicker>{tx(lang, "tray.theCount")}</Kicker>
          <div
            className="rounded-2xl border px-4 py-3"
            style={{
              background: `linear-gradient(120deg, color-mix(in srgb, ${litTone("#5f8f72")} 22%, var(--v-panel)) 0%, var(--v-panel) 70%)`,
              borderColor: `color-mix(in srgb, ${litTone("#5f8f72")} 45%, transparent)`,
            }}
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: `color-mix(in srgb, ${litTone("#5f8f72")} 75%, var(--v-ink))` }}>{tx(lang, "board.in")}</p>
                <p className="mt-0.5 truncate font-display text-xl leading-none tabular-nums">{money(batch.totals.revenue)}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted">{lang === "es" ? `${batch.totals.sales} ventas · ${batch.totals.salesDated} con fecha` : `${batch.totals.sales} sales · ${batch.totals.salesDated} dated`}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">{tx(lang, "tray.stockCost")}</p>
                <p className="mt-0.5 truncate font-display text-xl leading-none tabular-nums">{money(batch.totals.stockCost)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">{tx(lang, "tray.linesWord")}</p>
                <p className="mt-0.5 truncate font-display text-xl leading-none tabular-nums">{batch.totals.rows}</p>
              </div>
            </div>
            <p className="mt-2 border-t border-line/50 pt-2 text-[11px] text-muted">
              {tx(lang, "tray.rebatesWord")} {money(batch.totals.rebates)} · {tx(lang, "tray.deliveryWord")} {money(batch.totals.delivery)} · {lang === "es" ? `${batch.totals.salesNoPrice} ventas sin precio` : `${batch.totals.salesNoPrice} sales with no price`}
              {batch.loose.length ? (lang === "es" ? ` · ${batch.loose.length} ${batch.loose.length === 1 ? "línea suelta" : "líneas sueltas"}, no piezas` : ` · ${batch.loose.length} loose ${batch.loose.length === 1 ? "line" : "lines"}, not pieces`) : ""}
            </p>
          </div>

          <Kicker>{tx(lang, "tray.batchRules")}</Kicker>
          <div className="rounded-2xl border border-line bg-panel p-4">
            <div className="grid gap-4">
              <div className="flex min-w-0 gap-3">
                <JewelDisc tone="#5f8f72"><Layers className="size-4" strokeWidth={1.75} /></JewelDisc>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{lang === "es" ? `Este lote está ${soldBatch ? "ya vendido" : "en inventario"}` : `This batch is ${soldBatch ? "already sold" : "on hand"}`}</p>
                  <p className="mt-0.5 text-xs text-muted">{tx(lang, "tray.flipNote")}</p>
                  <div className="mt-2 flex gap-2">
                    {([[false, tx(lang, "tray.onHand")], [true, tx(lang, "tray.alreadySold")]] as const).map(([value, label]) => (
                      <button key={label} type="button" aria-pressed={soldBatch === value} className={chip(soldBatch === value)} onClick={() => reclassify(value)}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 gap-3">
                <JewelDisc tone="#5d86ad"><Ruler className="size-4" strokeWidth={1.75} /></JewelDisc>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tx(lang, "tray.bareSizes", { system: bareSize })}</p>
                  <p className="mt-0.5 text-xs text-muted">{tx(lang, "tray.bareSizesSub")}</p>
                  <div className="mt-2 flex gap-2">
                    {(["CN", "EU"] as const).map((system) => (
                      <button key={system} type="button" aria-pressed={bareSize === system} className={chip(bareSize === system)} onClick={() => setBareSize(system)}>{system}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-w-0 gap-3">
                <JewelDisc tone="#b08a3e"><CalendarDays className="size-4" strokeWidth={1.75} /></JewelDisc>
                <label className="block min-w-0 flex-1 text-sm">
                  <span className="font-medium">{tx(lang, "tray.batchYear")}</span>
                  <span className="mt-0.5 block text-xs text-muted">{tx(lang, "tray.batchYearSub")}</span>
                  <input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" placeholder={tx(lang, "tray.optional")} className={`mt-2 ${control}`} />
                </label>
              </div>
              <div className="flex min-w-0 gap-3">
                <JewelDisc tone="#4f7f8a"><MapPin className="size-4" strokeWidth={1.75} /></JewelDisc>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tx(lang, "tray.where")}</p>
                  <p className="mt-0.5 text-xs text-muted">{tx(lang, "tray.whereSub")}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {([["", tx(lang, "tray.anywhere")], ["home", tx(lang, "tray.home")], ["car", tx(lang, "tray.car")]] as const).map(([value, label]) => (
                      <button key={label} type="button" aria-pressed={place === value} className={chip(place === value)} onClick={() => setPlace(value)}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {batch.styles.length ? (
                <div className="flex min-w-0 gap-3">
                  <JewelDisc tone="#8d6aad"><Tag className="size-4" strokeWidth={1.75} /></JewelDisc>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{tx(lang, "tray.usualAsk")}</p>
                    <p className="mt-0.5 text-xs text-muted">{tx(lang, "tray.usualAskSub")}</p>
                    <div className="mt-2 grid min-w-0 gap-2">
                      {batch.styles.map((style) => (
                        <label key={style} className="flex min-w-0 items-center gap-3 text-sm">
                          <span className="min-w-0 flex-1 truncate">{style}</span>
                          <input
                            value={usualAsk[styleKey(style)] ?? ""}
                            onChange={(event) => setUsualAsk((current) => ({ ...current, [styleKey(style)]: event.target.value }))}
                            inputMode="decimal"
                            placeholder="$"
                            className="h-9 w-24 rounded-xl border border-line bg-canvas px-3 outline-none focus:border-accent"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {batch.groups.length || batch.clusters.length ? (
            <Kicker right={tx(lang, "tray.toDecide", { n: batch.groups.length + batch.clusters.length })}>{tx(lang, "tray.needsWord")}</Kicker>
          ) : null}

          {batch.groups.map((group) => {
            const style = GROUP_STYLE[group.id] ?? { tone: "#b08a3e", icon: CircleAlert };
            const GroupIcon = style.icon;
            const count = group.id === "personal-notes" ? batch.batchNotes.length : group.rowIndexes.length;
            return (
              <div key={group.id} className="mb-3 rounded-2xl border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <JewelDisc tone={style.tone}><GroupIcon className="size-4" strokeWidth={1.75} /></JewelDisc>
                  <p className="min-w-0 flex-1 text-sm leading-snug font-medium">{group.label}</p>
                  <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-xs tabular-nums text-muted">{count}</span>
                </div>
                {group.id === "personal-notes" ? (
                  <ul className="mt-3 space-y-1 rounded-xl bg-canvas/60 px-3 py-2">
                    {batch.batchNotes.map((note, i) => <li key={i} className="truncate text-xs text-muted">{note}</li>)}
                  </ul>
                ) : (
                  <ul className="mt-3 space-y-1 rounded-xl bg-canvas/60 px-3 py-2">
                    {group.rowIndexes.slice(0, 6).map((index) => (
                      <li key={index} className="truncate text-xs text-muted">{batch.rows[index].row.raw}</li>
                    ))}
                    {group.rowIndexes.length > 6 ? <li className="text-xs text-muted">{tx(lang, "tray.moreRows", { n: group.rowIndexes.length - 6 })}</li> : null}
                  </ul>
                )}
                <div className={group.options.length === 2 ? "mt-3 grid grid-cols-2 gap-2" : "mt-3 flex flex-wrap gap-2"}>
                  {group.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={decisions.groups[group.id] === option.id}
                      className={group.options.length === 2 ? seg(decisions.groups[group.id] === option.id) : chip(decisions.groups[group.id] === option.id)}
                      onClick={() => setDecisions((current) => (current ? { ...current, groups: { ...current.groups, [group.id]: option.id } } : current))}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {batch.clusters.map((cluster) => {
            const batchMembers = cluster.members.filter((m) => m.source === "batch");
            const floorMembers = cluster.members.filter((m) => m.source === "floor");
            return (
              <div key={cluster.id} className="mb-3 rounded-2xl border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <JewelDisc tone="#4f7f8a"><PackageSearch className="size-4" strokeWidth={1.75} /></JewelDisc>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: `color-mix(in srgb, ${litTone("#4f7f8a")} 75%, var(--v-ink))` }}>{tx(lang, "tray.alreadyHere")}</p>
                    <p className="mt-0.5 text-[15px] leading-snug font-medium">{cluster.styleName}</p>
                    <p className="mt-1 text-xs text-muted">
                      {lang === "es" ? <>costo {money(cluster.costCents)} · {floorMembers.length ? `${floorMembers.length} en tu inventario · ` : ""}{batchMembers.length} en este lote{cluster.sizeDiffers ? " · la talla está escrita de dos maneras: la misma pieza hace eso" : ""}</> : <>cost {money(cluster.costCents)} · {floorMembers.length ? `${floorMembers.length} on your floor · ` : ""}{batchMembers.length} in this batch{cluster.sizeDiffers ? " · the size is written two ways — the same piece does that" : ""}</>}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([["same", tx(lang, "tray.samePiece"), tx(lang, "tray.samePieceSub")], ["different", tx(lang, "tray.diffPieces"), tx(lang, "tray.diffPiecesSub")]] as const).map(([value, title, sub]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={decisions.clusters[cluster.id] === value}
                      className={`${seg(decisions.clusters[cluster.id] === value)} flex-col gap-0`}
                      onClick={() => setDecisions((current) => (current ? { ...current, clusters: { ...current.clusters, [cluster.id]: value } } : current))}
                    >
                      <span>{title}</span>
                      <span className="text-[11px] font-normal text-muted">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <Kicker right={tx(lang, "tray.importingOf", { a: batch.rows.filter((r) => decisions.include[r.index] !== false).length, b: batch.rows.length })}>
            <span className="inline-flex items-center gap-1.5"><ListChecks className="size-3.5" strokeWidth={1.75} /> {tx(lang, "tray.everyLine")}</span>
          </Kicker>
          <ul className="max-h-80 divide-y divide-line/50 overflow-auto rounded-2xl border border-line bg-panel px-3">
            {batch.rows.map((trayRow) => {
              const input = trayRow.input;
              const bits = [
                input.costCents ? `${tx(lang, "tray.bitCost")} ${money(input.costCents)}` : "",
                input.askCents ? `${tx(lang, "tray.bitAsk")} ${money(input.askCents)}` : "",
                input.saleCents != null ? `${tx(lang, "tray.bitSold")} ${money(input.saleCents)}` : "",
                input.buyRebateCents ? `${tx(lang, "tray.bitRebate")} ${money(input.buyRebateCents)}` : "",
                input.deliveryCents ? `${tx(lang, "tray.bitDelivery")} ${money(input.deliveryCents)}` : "",
                trayRow.priceCut ? `${tx(lang, "tray.bitCut")} ${money(trayRow.priceCut)}` : "",
              ].filter(Boolean).join(" · ");
              const classTone = litTone(CLASS_TONE[trayRow.classLabel.split(" · ")[0]] ?? "#5f8f72");
              return (
                <li key={trayRow.index} className="flex items-start gap-2.5 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--v-accent)]"
                    checked={decisions.include[trayRow.index] !== false}
                    onChange={(event) => setDecisions((current) => (current ? { ...current, include: { ...current.include, [trayRow.index]: event.target.checked } } : current))}
                    aria-label={tx(lang, "tray.importLine", { n: trayRow.index + 1 })}
                  />
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: lightDot[trayRow.light] }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className="shrink-0 rounded-full px-2 py-px text-[10px] font-semibold tracking-wide uppercase"
                        style={{ background: `color-mix(in srgb, ${classTone} 18%, transparent)`, color: `color-mix(in srgb, ${classTone} 80%, var(--v-ink))` }}
                      >
                        {trayRow.classLabel}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {input.name}{input.sizeLabel ? ` · ${input.sizeSystem} ${input.sizeLabel}` : ""}{input.usSize ? ` · US ${input.usSize}` : ""}
                      </span>
                    </span>
                    {bits ? <span className="mt-0.5 block truncate text-xs text-muted tabular-nums">{bits}</span> : null}
                    <span className="block truncate text-[11px] text-faint">{trayRow.row.raw}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          {preview ? (
            <div className="mt-4 rounded-2xl border border-line bg-panel p-3">
              <p className="px-1 pb-2 text-xs text-muted">
                {lang === "es" ? <>{preview.add.length} {preview.add.length === 1 ? "pieza nueva" : "piezas nuevas"}{preview.update.length ? ` · ${preview.update.length} completadas en el inventario` : ""}{batch.totals.revenue ? ` · ${money(batch.totals.revenue)} entraron` : ""}</> : <>{preview.add.length} new {preview.add.length === 1 ? "piece" : "pieces"}{preview.update.length ? ` · ${preview.update.length} completed on the floor` : ""}{batch.totals.revenue ? ` · ${money(batch.totals.revenue)} in` : ""}</>}
              </p>
              <button
                type="button"
                className="press h-12 w-full rounded-full bg-accent text-sm font-medium text-accent-ink disabled:opacity-40"
                disabled={applying || (!preview.add.length && !preview.update.length)}
                onClick={async () => {
                  if (applying) return;
                  setApplying(true);
                  setApplyError(false);
                  try {
                    const res = await onApply(preview);
                    setAppliedResult({ added: res.added, updated: res.updated, notes: preview.batchNotes ?? [] });
                  } catch {
                    setApplyError(true);
                  } finally {
                    setApplying(false);
                  }
                }}
              >
                {applying ? tx(lang, "tray.importing") : lang === "es" ? `Importar ${preview.add.length} ${preview.add.length === 1 ? "pieza" : "piezas"}${preview.update.length ? ` · completar ${preview.update.length} en el inventario` : ""}` : `Import ${preview.add.length} ${preview.add.length === 1 ? "piece" : "pieces"}${preview.update.length ? ` · complete ${preview.update.length} on the floor` : ""}`}
              </button>
              {applyError ? <p className="px-1 pt-2 text-sm text-danger">{tx(lang, "tray.importFailed")}</p> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
