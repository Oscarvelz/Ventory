import { useMemo, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { dollarsToCents, emptyInput, money, type Piece, type PieceInput } from "@/lib/ventory/model";
import { parseDetailedNotes } from "@/lib/ventory/paste";
import { applyTray, buildTray, defaultDecisions, defaultRules, styleKey, type BatchRules, type TrayDecisions } from "@/lib/ventory/tray";

export type TrayPayload = { add: PieceInput[]; update: PieceInput[]; batchNotes: string[] };

/**
 * LA BANDEJA — the batch tray (1.0.16). Paste a whole document; nothing is imported until
 * the preview has classified every line, the batch rules have been asked once, and the
 * review groups and duplicate clusters carry a decision. What the old paste did silently
 * (a return counted as a sale, a rebate decided without asking, a duplicate counted twice)
 * is exactly what the tray puts in front of him, in groups, before a single row lands.
 */
export function TrayImport({ pieces, onApply, onImportCsv, onClose }: {
  pieces: Piece[];
  onApply: (payload: TrayPayload) => void;
  onImportCsv?: (rows: PieceInput[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof parseDetailedNotes> | null>(null);
  const [bareSize, setBareSize] = useState<"CN" | "EU">("CN");
  const [year, setYear] = useState("");
  const [place, setPlace] = useState<"" | "home" | "car">("");
  const [usualAsk, setUsualAsk] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<TrayDecisions | null>(null);
  const [applied, setApplied] = useState<TrayPayload | null>(null);
  const [csvDone, setCsvDone] = useState(0);

  const rules: BatchRules = useMemo(() => {
    const usual: Record<string, number> = {};
    for (const [key, value] of Object.entries(usualAsk)) {
      const cents = dollarsToCents(value);
      if (cents > 0) usual[key] = cents;
    }
    const yearNum = Number(year);
    return { ...defaultRules(), bareSize, year: Number.isInteger(yearNum) && yearNum > 1900 ? yearNum : null, place, usualAsk: usual };
  }, [bareSize, year, place, usualAsk]);

  const batch = useMemo(() => (parsed ? buildTray(parsed, pieces, rules) : null), [parsed, pieces, rules]);
  const preview = useMemo(() => (batch && decisions ? applyTray(batch, decisions, pieces) : null), [batch, decisions, pieces]);

  const review = () => {
    const next = parseDetailedNotes(text, new Date(), false);
    setParsed(next);
    setApplied(null);
    setDecisions(defaultDecisions(buildTray(next, pieces, rules)));
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
  const lightDot = { green: "#3d9970", amber: "#d9930d", red: "#c0392b" } as const;

  if (applied || csvDone) {
    const notes = applied?.batchNotes ?? [];
    return (
      <div className="mt-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-accent-soft"><Check className="size-5" strokeWidth={2} /></span>
          <p className="font-display text-2xl">Batch in</p>
        </div>
        <p className="mt-3 text-sm text-muted">
          {csvDone
            ? `${csvDone} rows imported from the spreadsheet paste.`
            : `${applied!.add.length} new pieces imported${applied!.update.length ? `, and ${applied!.update.length} already on the floor were completed instead of duplicated` : ""}.`}
        </p>
        {notes.length ? (
          <div className="mt-4 rounded-2xl border border-line bg-panel p-4">
            <p className="text-sm font-medium">Batch notes</p>
            <p className="mt-1 text-xs text-muted">Kept with the batch, as you wrote them. They are not attached to any piece and never touched a number.</p>
            <ul className="mt-2 space-y-1">
              {notes.map((note, i) => <li key={i} className="text-sm">{note}</li>)}
            </ul>
          </div>
        ) : null}
        <button type="button" className="press mt-5 h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink" onClick={onClose}>Done</button>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <p className="text-sm text-muted">
        Paste the note as you write it — a whole document is fine. Nothing is imported yet: the tray reads it line by line, shows you how each line lands, and only imports what you approve.
      </p>
      <textarea
        value={text}
        onChange={(event) => { setText(event.target.value); setParsed(null); setDecisions(null); }}
        className="mt-3 h-40 w-full rounded-2xl border border-line bg-canvas p-3 text-sm outline-none focus:border-accent"
        placeholder={"Yellow Detail Classic Cowboy Design\n_ 44 = 9.5 ($19) *Home* for $40 — AddedAug28 - Sold\n_ 42 = 8.5 ($18) *Home* for $40 — AddedAug29"}
      />
      <div className="mt-3 flex gap-2">
        <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" disabled={!text.trim()} onClick={review}>
          Review the batch
        </button>
        {parsed && parsed.rows.length === 0 && onImportCsv ? (
          <button
            type="button"
            className="press h-11 rounded-full border border-line px-4 text-sm"
            onClick={() => {
              const rows = csvRows();
              if (rows.length) {
                onImportCsv(rows);
                setCsvDone(rows.length);
              }
            }}
          >
            Import as spreadsheet rows
          </button>
        ) : null}
      </div>

      {batch && decisions ? (
        <>
          <div className="mt-5 rounded-2xl border border-line bg-panel p-4">
            <p className="text-sm font-medium">Batch rules — asked once</p>
            <div className="mt-3 grid gap-3">
              <div>
                <p className="text-xs text-muted">Bare size numbers (no EU or CN written on the line) will be read as <strong>{bareSize}</strong>.</p>
                <div className="mt-1 flex gap-2">
                  {(["CN", "EU"] as const).map((system) => (
                    <button key={system} type="button" aria-pressed={bareSize === system} className={chip(bareSize === system)} onClick={() => setBareSize(system)}>{system}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-muted">Batch year (when a date has none)</span>
                  <input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" placeholder="Optional" className={`mt-1 ${control}`} />
                </label>
                <div>
                  <p className="text-sm text-muted">Where, when a line does not say</p>
                  <div className="mt-1 flex gap-2">
                    {([["", "Anywhere"], ["home", "Home"], ["car", "Car"]] as const).map(([value, label]) => (
                      <button key={label} type="button" aria-pressed={place === value} className={chip(place === value)} onClick={() => setPlace(value)}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {batch.styles.length ? (
                <div>
                  <p className="text-xs text-muted">Usual asking price per style — fills the ask on sales that never wrote one, so the price cut can be derived.</p>
                  <div className="mt-2 grid gap-2">
                    {batch.styles.map((style) => (
                      <label key={style} className="flex items-center gap-3 text-sm">
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
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-line px-3 py-1">{batch.totals.rows} lines</span>
            <span className="rounded-full border border-line px-3 py-1">{batch.totals.sales} sales ({batch.totals.salesDated} dated)</span>
            <span className="rounded-full border border-line px-3 py-1">{batch.totals.salesNoPrice} sales with no price</span>
            <span className="rounded-full border border-line px-3 py-1">In: {money(batch.totals.revenue)}</span>
            <span className="rounded-full border border-line px-3 py-1">Stock cost: {money(batch.totals.stockCost)}</span>
            <span className="rounded-full border border-line px-3 py-1">Rebates: {money(batch.totals.rebates)}</span>
            <span className="rounded-full border border-line px-3 py-1">Delivery: {money(batch.totals.delivery)}</span>
            {batch.loose.length ? <span className="rounded-full border border-line px-3 py-1">{batch.loose.length} loose lines, not pieces</span> : null}
          </div>

          {batch.groups.map((group) => (
            <div key={group.id} className="mt-4 rounded-2xl border border-line bg-panel p-4">
              <p className="flex items-start gap-2 text-sm font-medium">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.75} />
                {group.label} · {group.id === "personal-notes" ? batch.batchNotes.length : group.rowIndexes.length}
              </p>
              {group.id === "personal-notes" ? (
                <ul className="mt-2 space-y-1">
                  {batch.batchNotes.map((note, i) => <li key={i} className="truncate text-xs text-muted">{note}</li>)}
                </ul>
              ) : (
                <ul className="mt-2 space-y-1">
                  {group.rowIndexes.slice(0, 6).map((index) => (
                    <li key={index} className="truncate text-xs text-muted">{batch.rows[index].row.raw}</li>
                  ))}
                  {group.rowIndexes.length > 6 ? <li className="text-xs text-muted">+{group.rowIndexes.length - 6} more</li> : null}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {group.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={decisions.groups[group.id] === option.id}
                    className={chip(decisions.groups[group.id] === option.id)}
                    onClick={() => setDecisions((current) => (current ? { ...current, groups: { ...current.groups, [group.id]: option.id } } : current))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {batch.clusters.map((cluster) => {
            const batchMembers = cluster.members.filter((m) => m.source === "batch");
            const floorMembers = cluster.members.filter((m) => m.source === "floor");
            return (
              <div key={cluster.id} className="mt-4 rounded-2xl border border-line bg-panel p-4">
                <p className="text-sm font-medium">Already here? {cluster.styleName} · cost {money(cluster.costCents)}</p>
                <p className="mt-1 text-xs text-muted">
                  {floorMembers.length ? `${floorMembers.length} on your floor · ` : ""}{batchMembers.length} in this batch
                  {cluster.sizeDiffers ? " · the size is written two ways — in your documents the same piece does that" : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([["same", "Same piece — complete the record"], ["different", "Different pieces — import as new"]] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={decisions.clusters[cluster.id] === value}
                      className={chip(decisions.clusters[cluster.id] === value)}
                      onClick={() => setDecisions((current) => (current ? { ...current, clusters: { ...current.clusters, [cluster.id]: value } } : current))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <ul className="mt-4 max-h-80 space-y-1 overflow-auto pr-1">
            {batch.rows.map((trayRow) => {
              const input = trayRow.input;
              const bits = [
                input.costCents ? `cost ${money(input.costCents)}` : "",
                input.askCents ? `ask ${money(input.askCents)}` : "",
                input.saleCents != null ? `sold ${money(input.saleCents)}` : "",
                input.buyRebateCents ? `rebate ${money(input.buyRebateCents)}` : "",
                input.deliveryCents ? `delivery ${money(input.deliveryCents)}` : "",
                trayRow.priceCut ? `cut ${money(trayRow.priceCut)}` : "",
              ].filter(Boolean).join(" · ");
              return (
                <li key={trayRow.index} className="flex items-start gap-2 rounded-xl border border-line/60 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={decisions.include[trayRow.index] !== false}
                    onChange={(event) => setDecisions((current) => (current ? { ...current, include: { ...current.include, [trayRow.index]: event.target.checked } } : current))}
                    aria-label={`Import line ${trayRow.index + 1}`}
                  />
                  <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: lightDot[trayRow.light] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="text-muted">{trayRow.classLabel} · </span>
                      {input.name}{input.sizeLabel ? ` · ${input.sizeSystem} ${input.sizeLabel}` : ""}{input.usSize ? ` · US ${input.usSize}` : ""}
                      {bits ? <span className="text-muted"> · {bits}</span> : ""}
                    </span>
                    <span className="block truncate text-xs text-muted">{trayRow.row.raw}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          {preview ? (
            <button
              type="button"
              className="press mt-4 h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-40"
              disabled={!preview.add.length && !preview.update.length}
              onClick={() => {
                onApply(preview);
                setApplied(preview);
              }}
            >
              Import {preview.add.length} pieces{preview.update.length ? ` · complete ${preview.update.length} on the floor` : ""}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
