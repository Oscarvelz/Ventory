import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { axisCash, cash, niceStep, pct, series, TONES, type AgeBucket, type Grain, type Period } from "@/lib/ventory/metrics";
import type { Piece } from "@/lib/ventory/model";
import { tone as litTone } from "@/lib/ventory/tones";

/* Ventory's charts (1.1.0). Drawn in the house language: no frames inside
   frames (a chart sits straight on its fold), theme variables for every
   neutral, the fixed tones (lit under Tron by tones.ts) for meaning — green
   for what stays, amber for what comes in, the age ramp green → red. Motion
   follows the 1.0.6 rule: values are exact from the first frame and only
   their arrival is staged (bars grow by transform, lines draw through their
   own dash, dots pop, numbers count once); none of it exists under
   prefers-reduced-motion, where the settled state simply stands. */

export function reduced() {
  return typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useWidth<T extends HTMLElement>() {
  // A callback ref: the measured node can appear later (a chart shows once
  // data loads), and a plain ref would have missed it.
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** Counts a number up once, on first view; the last frame is the caller's own exact text. */
export function useCount(value: number, format: (n: number) => string, final: string, ms = 800) {
  const [text, setText] = useState(() => (reduced() || value === 0 ? final : format(0)));
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || reduced() || value === 0) {
      first.current = false;
      setText(final);
      return;
    }
    first.current = false;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      if (t >= 1) return setText(final);
      setText(format(value * (1 - Math.pow(1 - t, 3))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, final]); // eslint-disable-line react-hooks/exhaustive-deps
  return text;
}

export function Count({ value, format, final, className }: { value: number; format: (n: number) => string; final: string; className?: string }) {
  const text = useCount(value, format, final);
  return <span className={className}>{text}</span>;
}

export function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11px] font-medium tracking-[0.14em] text-faint uppercase ${className}`}>{children}</p>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (id: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded-full bg-panel-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`press h-7 rounded-full px-3 text-xs whitespace-nowrap ${value === option.id ? "bg-accent text-accent-ink" : "text-muted"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- spark */

export function Spark({ values, tone = TONES.green, height = 44 }: { values: number[]; tone?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const color = litTone(tone);
  const id = useMemo(() => `sp${Math.random().toString(36).slice(2, 8)}`, []);
  const shown = values.length === 1 ? [values[0], values[0]] : values;
  const lo = Math.min(0, ...shown);
  const hi = Math.max(1, ...shown);
  const pad = 4;
  const pts = shown.map((v, i) => [pad + (i / Math.max(1, shown.length - 1)) * (width - pad * 2), pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const zero = pad + (1 - (0 - lo) / (hi - lo)) * (height - pad * 2);
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${zero.toFixed(1)} L${pts[0][0].toFixed(1)} ${zero.toFixed(1)} Z` : "";
  const last = pts[pts.length - 1];
  return (
    <div ref={ref} className="w-full" style={{ height }} aria-hidden>
      {width > 0 && shown.length > 0 ? (
        <svg width={width} height={height} className="block overflow-visible">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} className="chart-fade" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="line-draw" />
          {last ? <circle cx={last[0]} cy={last[1]} r="3.5" fill={color} className="dot-pop" style={{ animationDelay: "850ms" }} /> : null}
        </svg>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- trend */

const GRAINS: { id: Grain; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

export function Trend({ sales }: { sales: Piece[] }) {
  const [grain, setGrain] = useState<Grain>("month");
  const rows = useMemo(() => series(sales, grain, { limit: grain === "year" ? undefined : 12 }), [sales, grain]);
  const [pick, setPick] = useState<string | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  const selected = rows.find((row) => row.key === pick) ?? rows.at(-1) ?? null;
  const amber = litTone(TONES.amber);
  const green = litTone(TONES.green);
  const H = 168;
  const top = 10;
  const bottom = 22;
  const left = 38;
  const plotH = H - top - bottom;
  const hi = Math.max(1, ...rows.map((row) => Math.max(row.revenue, row.profit)));
  const lo = Math.min(0, ...rows.map((row) => row.profit));
  const stepV = niceStep((hi - lo) / 3);
  const ceil = Math.ceil(hi / stepV) * stepV;
  const floor = lo < 0 ? -Math.ceil(-lo / stepV) * stepV : 0;
  const y = (v: number) => top + (1 - (v - floor) / (ceil - floor)) * plotH;
  const plotW = Math.max(0, width - left);
  const slot = rows.length ? plotW / rows.length : 0;
  const barW = Math.max(4, Math.min(26, slot * 0.46));
  const every = slot < 30 ? Math.ceil(30 / Math.max(1, slot)) : 1;
  const ticks: number[] = [];
  for (let v = floor; v <= ceil + 0.5; v += stepV) ticks.push(v);
  const pts = rows.map((row, i) => [left + slot * i + slot / 2, y(row.profit)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-4 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: amber }} />In</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: green }} />Left after cost</span>
        </div>
        <Segmented value={grain} options={GRAINS} onChange={(id) => { setGrain(id); setPick(null); }} label="Group sales by" />
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">No dated sales yet. A sale needs its date to land on the timeline.</p> : (
        <>
          <div ref={ref} className="mt-3 w-full" style={{ height: H }}>
            {width > 0 ? (
              <svg key={grain} width={width} height={H} className="block touch-manipulation select-none" role="img" aria-label={`Sales by ${grain}`}>
                {ticks.map((v) => (
                  <g key={v}>
                    <line x1={left} x2={width} y1={y(v)} y2={y(v)} stroke="var(--v-line)" strokeWidth={v === 0 ? 1 : 0.75} strokeDasharray={v === 0 ? undefined : "3 4"} />
                    <text x={left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--v-faint)" className="tabular-nums">{axisCash(v)}</text>
                  </g>
                ))}
                {rows.map((row, i) => {
                  const cx = left + slot * i + slot / 2;
                  const active = selected?.key === row.key;
                  const h = Math.max(0, y(0) - y(Math.max(0, row.revenue)));
                  return (
                    <g key={row.key} onClick={() => setPick(row.key)} className="cursor-pointer">
                      <rect x={left + slot * i + 1} y={top} width={Math.max(0, slot - 2)} height={plotH} rx="6" fill={active ? "var(--v-panel-2)" : "transparent"} />
                      {h > 0 ? <rect x={cx - barW / 2} y={y(0) - h} width={barW} height={h} rx={Math.min(4, barW / 2)} fill={amber} opacity={active ? 1 : 0.78} className="col-fill-svg" style={{ animationDelay: `${Math.min(i * 40, 440)}ms` }} /> : null}
                      {i % every === (rows.length - 1) % every ? (
                        <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={active ? "var(--v-ink)" : "var(--v-muted)"}>{row.short}</text>
                      ) : null}
                    </g>
                  );
                })}
                {pts.length > 1 ? <path d={line} fill="none" stroke={green} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="line-draw pointer-events-none" style={{ animationDelay: "250ms" }} /> : null}
                {pts.map(([px, py], i) => (
                  <circle key={rows[i].key} cx={px} cy={py} r={selected?.key === rows[i].key ? 4.5 : 3} fill={rows[i].profit < 0 ? "var(--v-danger)" : green} stroke="var(--v-panel)" strokeWidth="1.5" className="dot-pop pointer-events-none" style={{ animationDelay: `${300 + Math.min(i * 50, 600)}ms` }} />
                ))}
              </svg>
            ) : null}
          </div>
          {selected ? <PeriodLine row={selected} /> : null}
        </>
      )}
    </div>
  );
}

function PeriodLine({ row }: { row: Period }) {
  const margin = row.revenue > 0 ? row.profit / row.revenue : null;
  return (
    <div key={row.key} className="row-in mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-line pt-2.5 text-sm">
      <span className="font-medium text-ink">{row.label}</span>
      <span className="tabular-nums text-muted"><span className="text-ink">{cash(row.revenue)}</span> in</span>
      <span className="tabular-nums text-muted"><span className={row.profit < 0 ? "text-danger" : "text-ink"}>{cash(row.profit)}</span> left</span>
      <span className="tabular-nums text-muted"><span className="text-ink">{row.units}</span> {row.units === 1 ? "sale" : "sales"}</span>
      {margin != null ? <span className="tabular-nums text-muted"><span className="text-ink">{pct(margin)}</span> margin</span> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- bars */

export type BarRow = { label: string; value: number; text: string; sub?: string; tone?: string; negative?: boolean };

/** Ranked horizontal bars. The name and its figure share the first line; the bar runs full width under them. */
export function Bars({ rows, tone = TONES.green, limit = 6, empty, onMore }: { rows: BarRow[]; tone?: string; limit?: number; empty?: string; onMore?: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const peak = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  if (!rows.length) return <p className="text-sm text-muted">{empty ?? "Nothing to measure yet."}</p>;
  return (
    <div>
      <ul className="space-y-3">
        {shown.map((row, index) => (
          <li key={row.label} className="row-in" style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 text-ink">{row.label}</span>
              <span className={`shrink-0 tabular-nums ${row.negative ? "text-danger" : "text-ink"}`}>{row.text}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                <span
                  className="bar-fill block h-full rounded-full"
                  style={{ width: `${Math.max(row.value === 0 ? 0 : 3, Math.round((Math.abs(row.value) / peak) * 100))}%`, background: row.negative ? "var(--v-danger)" : litTone(row.tone ?? tone), animationDelay: `${Math.min(index * 45, 360)}ms` }}
                />
              </span>
              {row.sub ? <span className="shrink-0 text-xs tabular-nums text-muted">{row.sub}</span> : null}
            </div>
          </li>
        ))}
      </ul>
      {(onMore ?? true) && rows.length > limit ? (
        <button type="button" className="press mt-3 text-sm text-accent" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- gauge */

export function Gauge({ value, label, caption, tone = TONES.green }: { value: number | null; label: string; caption: string; tone?: string }) {
  const p = value == null ? 0 : Math.max(0, Math.min(1, value));
  const color = litTone(tone);
  const r = 46;
  const arc = `M ${60 - r} 60 A ${r} ${r} 0 0 1 ${60 + r} 60`;
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-28 shrink-0">
        <svg viewBox="0 0 120 66" className="block w-full" aria-hidden>
          <path d={arc} fill="none" stroke="var(--v-panel-2)" strokeWidth="11" strokeLinecap="round" />
          {p > 0 ? <path d={arc} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" pathLength={1} strokeDasharray={`${p} 1`} className="gauge-grow" /> : null}
        </svg>
        <p className="absolute inset-x-0 bottom-0 text-center font-display text-2xl leading-none tabular-nums">{value == null ? "—" : <Count value={p * 100} format={(n) => `${Math.round(n)}%`} final={pct(p)} />}</p>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted">{caption}</p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- age columns */

export function AgeColumns({ buckets, money = true }: { buckets: AgeBucket[]; money?: boolean }) {
  const peak = Math.max(1, ...buckets.map((b) => b.units));
  return (
    <div className="grid grid-cols-5 gap-2">
      {buckets.map((bucket, index) => {
        const color = litTone(bucket.tone);
        return (
          <div key={bucket.id} className="flex min-w-0 flex-col items-center">
            <span className="font-display text-lg leading-none tabular-nums">{bucket.units}</span>
            <div className="mt-1.5 flex h-20 w-full items-end justify-center">
              <div className="flex h-full w-full max-w-11 flex-col justify-end overflow-hidden rounded-md bg-panel-2">
                <div className="col-fill w-full rounded-md" style={{ height: `${bucket.units ? Math.max(8, Math.round((bucket.units / peak) * 100)) : 0}%`, background: color, animationDelay: `${index * 60}ms` }} />
              </div>
            </div>
            <span className="mt-1.5 text-[11px] whitespace-nowrap text-muted">{bucket.label}</span>
            {money ? <span className="text-[11px] whitespace-nowrap tabular-nums text-faint">{axisCash(bucket.cost)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- columns (histogram) */

export function Histogram({ rows, tone = TONES.teal }: { rows: { label: string; units: number }[]; tone?: string }) {
  const peak = Math.max(1, ...rows.map((r) => r.units));
  const color = litTone(tone);
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((row, index) => (
        <div key={row.label} className="flex min-w-0 flex-col items-center">
          <span className="text-xs tabular-nums text-ink">{row.units}</span>
          <div className="mt-1 flex h-16 w-full items-end">
            <div className="col-fill w-full rounded-md" style={{ height: `${row.units ? Math.max(6, Math.round((row.units / peak) * 100)) : 2}%`, background: row.units ? color : "var(--v-panel-2)", animationDelay: `${index * 50}ms` }} />
          </div>
          <span className="mt-1.5 text-[10px] whitespace-nowrap text-muted">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- split bar */

export function Split({ parts, height = 10 }: { parts: { label: string; value: number; tone: string; text?: string }[]; height?: number }) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex w-full gap-0.5 overflow-hidden rounded-full" style={{ height }}>
        {parts.filter((p) => p.value > 0).map((p, index) => (
          <span key={p.label} className="bar-fill block h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: litTone(p.tone), animationDelay: `${index * 90}ms` }} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: litTone(p.tone) }} />
            <span className="text-muted">{p.label}</span>
            <span className="tabular-nums text-ink">{p.text ?? p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------------- delta */

export function Delta({ label, now, before, format }: { label: string; now: number; before: number | null; format: (n: number) => string }) {
  const change = before == null || before === 0 ? null : (now - before) / Math.abs(before);
  const up = change != null && change > 0.005;
  const down = change != null && change < -0.005;
  const color = up ? litTone(TONES.green) : down ? "var(--v-danger)" : "var(--v-muted)";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="min-w-0 text-sm text-muted">{label}</span>
      <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
        <span className="font-display text-lg leading-none text-ink">{format(now)}</span>
        <span className="w-24 text-right text-xs text-faint">{before == null ? "no earlier" : `was ${format(before)}`}</span>
        <span className="w-14 text-right text-xs font-medium" style={{ color }}>{change == null ? "—" : `${up ? "▲" : down ? "▼" : "•"} ${Math.abs(Math.round(change * 100))}%`}</span>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- price range */

/** One product's price evidence on a single track: its cost, the range buyers paid, the usual price, and today's asks. */
export function PriceTrack({ cost, low, high, median, asks, scaleMax }: { cost: number; low: number; high: number; median: number; asks: number[]; scaleMax: number }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / scaleMax) * 100))}%`;
  const green = litTone(TONES.green);
  const amber = litTone(TONES.amber);
  return (
    <div className="relative h-6" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-panel-2" />
      <div className="bar-fill absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})`, background: green, opacity: 0.45 }} />
      <span className="absolute top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted" style={{ left: at(cost) }} />
      <span className="dot-pop absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: at(median), background: green, borderColor: "var(--v-panel)" }} />
      {[...new Set(asks)].slice(0, 6).map((ask) => (
        <span key={ask} className="dot-pop absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]" style={{ left: at(ask), background: amber, animationDelay: "200ms" }} />
      ))}
    </div>
  );
}
