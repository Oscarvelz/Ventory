import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FileDown, FileSpreadsheet, FileText, X } from "lucide-react";
import type { Advice } from "@/lib/ventory/advisor";
import { buildModel, fileBase, PERIODS, SECTIONS, type PeriodId, type SectionId } from "@/lib/ventory/export/model";
import { reportPdfBytes } from "@/lib/ventory/export/report-pdf";
import { reportXlsxBytes } from "@/lib/ventory/export/report-xlsx";
import { cash } from "@/lib/ventory/metrics";
import type { Ad, Piece } from "@/lib/ventory/model";
import { inAndroidApp } from "@/spa/native";

/* Export (1.1.0): the PDF report and the worksheet, the family's export
   center adapted to Ventory. A download is a Blob behind an <a download>,
   so in the Android app spa/native.ts hands it to the shell, which saves it
   in Downloads › Ventory; in a browser it is an ordinary download. */

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KEY = "ventory-export";

function remembered(): { period: PeriodId; sections: SectionId[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && PERIODS.some((p) => p.id === raw.period) && Array.isArray(raw.sections)) {
      return { period: raw.period, sections: SECTIONS.map((s) => s.id).filter((id) => raw.sections.includes(id)) };
    }
  } catch {
    /* first time */
  }
  return { period: "all", sections: SECTIONS.map((s) => s.id) };
}

function save(name: string, bytes: Uint8Array, mime: string) {
  const raw = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(raw).set(bytes);
  const url = URL.createObjectURL(new Blob([raw], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function ExportCenter({ pieces, ads, advice, onClose, onDone }: { pieces: Piece[]; ads: Ad[]; advice: Advice; onClose: () => void; onDone: (text: string) => void }) {
  const start = useMemo(remembered, []);
  const [period, setPeriod] = useState<PeriodId>(start.period);
  const [sections, setSections] = useState<SectionId[]>(start.sections);
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const model = useMemo(() => buildModel(pieces, ads, advice, { period, sections }), [pieces, ads, advice, period, sections]);
  const m = model.m;
  const where = inAndroidApp() ? "Saved in Downloads › Ventory" : "Downloaded";

  function remember(next: { period?: PeriodId; sections?: SectionId[] }) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ period: next.period ?? period, sections: next.sections ?? sections }));
    } catch {
      /* private mode */
    }
  }

  function run(kind: "pdf" | "xlsx") {
    setBusy(kind);
    window.setTimeout(() => {
      try {
        const name = `${fileBase(model, period)}.${kind}`;
        if (kind === "pdf") save(name, reportPdfBytes(model), "application/pdf");
        else save(name, reportXlsxBytes(model), XLSX);
        // In the Android app the shell confirms with its own toast once the file is written.
        if (!inAndroidApp()) onDone(`${where}: ${name}`);
      } catch (err) {
        onDone(err instanceof Error ? `Could not export: ${err.message}` : "Could not export");
      } finally {
        setBusy(null);
      }
    }, 30);
  }

  // Portalled to <body>: the desk panel carries a transform/filter, which would trap a fixed sheet inside it.
  return createPortal(
    <div className="veil-in fixed inset-0 z-30 grid place-items-end bg-black/50 p-3 sm:place-items-center" onClick={onClose}>
      <div className="sheet-in max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl border border-line bg-canvas p-5" role="dialog" aria-label="Export" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><FileDown className="size-[18px]" strokeWidth={1.75} /></span>
          <h2 className="min-w-0 flex-1 font-display text-2xl leading-tight">Export</h2>
          <button type="button" aria-label="Close" className="press grid size-9 shrink-0 place-items-center rounded-full border border-line text-muted" onClick={onClose}><X className="size-4" strokeWidth={1.75} /></button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">A report to read and a worksheet to work in, with the same numbers as Statistics.</p>

        <p className="mt-5 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">Sales from</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => { setPeriod(p.id); remember({ period: p.id }); }}
              className={`press h-9 rounded-full border px-3.5 text-sm whitespace-nowrap ${period === p.id ? "border-accent bg-accent text-accent-ink" : "border-line text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-2.5 text-sm text-muted">
          <span className="tabular-nums text-ink">{m.units.sold}</span> {m.units.sold === 1 ? "sale" : "sales"} · <span className="tabular-nums text-ink">{cash(m.revenue)}</span> in · <span className={`tabular-nums ${m.profit < 0 ? "text-danger" : "text-ink"}`}>{cash(m.profit)}</span> left after cost. Stock is always as of today.
        </p>

        <p className="mt-5 text-[11px] font-medium tracking-[0.14em] text-faint uppercase">In the PDF, after the summary</p>
        <ul className="mt-1 divide-y divide-line border-y border-line">
          {SECTIONS.map((s) => {
            const on = sections.includes(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => {
                    const next = on ? sections.filter((id) => id !== s.id) : SECTIONS.map((x) => x.id).filter((id) => id === s.id || sections.includes(id));
                    setSections(next);
                    remember({ sections: next });
                  }}
                  className="press flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className={`grid size-5 shrink-0 place-items-center rounded-md border ${on ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>{on ? <Check className="size-3.5" strokeWidth={2.5} /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{s.label}</span>
                    <span className="block text-xs text-muted">{s.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={!!busy} onClick={() => run("pdf")} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-60">
            <FileText className="size-[18px]" strokeWidth={1.75} />
            {busy === "pdf" ? "Making it" : "PDF report"}
          </button>
          <button type="button" disabled={!!busy} onClick={() => run("xlsx")} className="press inline-flex h-12 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink disabled:opacity-60">
            <FileSpreadsheet className="size-[18px]" strokeWidth={1.75} />
            {busy === "xlsx" ? "Making it" : "Worksheet"}
          </button>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-muted">The worksheet holds every piece and every sale (.xlsx, opens in Excel, Google Sheets and Numbers), whatever you pick for the PDF.</p>
      </div>
    </div>,
    document.body,
  );
}
