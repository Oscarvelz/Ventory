import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, BadgeCheck, Car, Check, ChevronDown, CircleAlert, CircleDollarSign, ClipboardPaste, Clock, DatabaseBackup, FileDown, Footprints, Funnel, Glasses, House as HomeIcon, ImagePlus, LayoutGrid, List, Megaphone, Moon, Package, Palette, Pin, Plus, RectangleHorizontal, Rows2, ShieldCheck, Shirt, ShoppingBag, SlidersHorizontal, Sun, Trash2, TrendingUp, Truck, Watch } from "lucide-react";
import { AccountCard, FingerprintControl, SignOutCard } from "@/lib/auth/gates";
import { daysHeld, dollarsToCents, effectiveCostCents, emptyInput, money, priceCutCents, PROBLEMS, profitOf, STATUS_LABEL, STATUSES, todayISO, unitProfitCents, type Ad, type Piece, type PieceInput, type Status } from "@/lib/ventory/model";
import { buildAdvice } from "@/lib/ventory/advisor";
import { AdvisorView, type AdviceFocus } from "@/components/ventory/Advisor";
import { TrayImport, type TrayPayload } from "@/components/ventory/TrayImport";
import { commas } from "@/lib/ventory/export/model";
import { AgeColumns, Bars, Count, Delta, Gauge, Histogram, Kicker, PairBars, Segmented, Spark, Split, Trend } from "@/components/ventory/charts";
import { ExportCenter } from "@/components/ventory/ExportCenter";
import { ageTone, cash, compare, halfSize, marginOf, measure, pct, series, sizeName, TONES } from "@/lib/ventory/metrics";
import { convertToUs } from "@/lib/ventory/sizes";
import { APP_VERSION } from "@/spa/config";
import { addSamples, applyTrayImport, clearSelected, createCheckpoint, deleteAd, deletePiece, importPieces, isLegacySample, loadFloor, removeSamples, replaceFloor, sampleSetSize, saveAd, saveAds, saveMark, savePiece, saveTheme } from "@/lib/ventory/server";
import { asTheme, isLightTheme, LIGHT_THEMES, THEMES, type ThemeId } from "@/lib/ventory/themes";
import { tone as litTone, toneInk } from "@/lib/ventory/tones";
import { syncBarsNow } from "@/spa/native";
import { Wordmark } from "./mark";
import { useScrollBars } from "./use-scroll-bars";
import { RippleButton, rippleNav } from "./ripple";

const SETTING_FOLDS = ["theme", "ads", "backup", "sample", "security", "remove"] as const;
type Floor = Awaited<ReturnType<typeof loadFloor>>;
type View = "floor" | "history" | "ledger";
type Shelf = "live" | "all" | Status;
type Desk = "stats" | "advisor";
type Lens = "hand" | "incoming" | "revenue" | "profit";
type Layout = "card" | "medium" | "list" | "g2" | "g3" | "g4";
type Face = "large" | "medium" | "list" | "grid";

function applyTheme(theme: ThemeId) {
  const root = document.documentElement;
  // Tron carries its own type (Faro's provider pattern): Orbitron for the
  // display face, Exo 2 for text, loaded only when Tron is first chosen —
  // the styles.css tron block points the font variables at them.
  if (theme === "tron" && !document.getElementById("tron-fonts")) {
    const link = document.createElement("link");
    link.id = "tron-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Exo+2:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }
  // 1.0.4: nothing to arm or time here — styles.css carries no color
  // transition anymore, so setting data-theme swaps the palette in one frame.
  // (1.0.3 parked a .theming class for 240ms to run a blanket 180ms fade;
  // that fade WAS the lag the flip was reported for.)
  root.dataset.theme = theme;
  const color = THEMES.find((item) => item.id === theme)?.color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color ?? "#121410");
  // 1.0.5: tell the Android shell NOW, in this same task — data-theme is set and
  // the meta already carries the new colour, so the sampled bar colours are the
  // new theme's. Waiting for the debounced observer (the pre-1.0.5 path) left
  // the status strip and the bottom background in the old theme ~160ms after
  // the content had already flipped. A no-op outside the shell.
  syncBarsNow();
  try {
    localStorage.setItem("ventory-theme", theme);
  } catch {
    /* ignore */
  }
}

function typeIcon(piece: Piece) {
  const text = `${piece.category} ${piece.subcategory} ${piece.name}`;
  if (/glass|sunglass|gafa|lente/i.test(text)) return Glasses;
  if (/watch|reloj/i.test(text)) return Watch;
  if (/bag|bolso|purse|cartera/i.test(text)) return ShoppingBag;
  if (/jacket|coat|chaqueta|blazer/i.test(text)) return Shirt;
  if (/boot|shoe|chelsea|zapato|bota|sneaker/i.test(text)) return Footprints;
  return Package;
}

function styleOf(piece: Piece) {
  const set = piece.subcategory.trim();
  if (set) return set;
  const category = piece.category.trim();
  const name = piece.name.trim();
  if (!category || !name) return "";
  const stripped = name.replace(new RegExp(`\\b${category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), " ").replace(/\s+/g, " ").trim();
  if (!stripped || stripped.toLowerCase() === name.toLowerCase()) return "";
  return stripped;
}

function isSale(piece: Piece) {
  return piece.status === "sold" || piece.wasSold;
}

type SaleLine = { name: string; count: number; revenue: number; profit: number; unpriced: number; costedRevenue?: number; costedProfit?: number };

function salesOf(pieces: Piece[]): SaleLine[] {
  const map = new Map<string, SaleLine>();
  for (const piece of pieces) {
    const name = piece.name.trim() || "Untitled";
    const row = map.get(name) ?? { name, count: 0, revenue: 0, profit: 0, unpriced: 0 };
    row.count += piece.qty;
    if (piece.saleCents == null) row.unpriced += piece.qty;
    else {
      const moneyIn = profitOf(piece);
      if (moneyIn) {
        row.revenue += moneyIn.revenue;
        row.profit += moneyIn.profit;
        if (piece.costCents > 0) {
          row.costedRevenue = (row.costedRevenue ?? 0) + moneyIn.revenue;
          row.costedProfit = (row.costedProfit ?? 0) + moneyIn.profit;
        }
      }
    }
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

function take(piece: Piece) {
  const moneyIn = profitOf(piece);
  return moneyIn ? { revenue: moneyIn.revenue, profit: moneyIn.profit } : null;
}

type Grain = "week" | "month" | "year";

function periodsOf(pieces: Piece[], grain: Grain) {
  const buckets = new Map<string, { label: string; stamp: number; revenue: number; profit: number; count: number }>();
  for (const piece of pieces.filter(isSale)) {
    const moneyIn = take(piece);
    const when = piece.soldOn;
    let label = "No date";
    let stamp = 0;
    if (when) {
      const [year, month, day] = when.split("-").map(Number);
      const date = new Date(year, (month || 1) - 1, day || 1);
      if (grain === "year") {
        label = String(year);
        stamp = new Date(year, 0, 1).getTime();
      } else if (grain === "month") {
        label = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        stamp = new Date(year, (month || 1) - 1, 1).getTime();
      } else {
        const start = new Date(date);
        start.setDate(date.getDate() - ((date.getDay() + 6) % 7));
        label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        stamp = start.getTime();
      }
    }
    const row = buckets.get(label) ?? { label, stamp, revenue: 0, profit: 0, count: 0 };
    row.count += piece.qty;
    if (moneyIn) {
      row.revenue += moneyIn.revenue;
      row.profit += moneyIn.profit;
    }
    buckets.set(label, row);
  }
  return [...buckets.values()].sort((a, b) => a.stamp - b.stamp).slice(-8);
}

type Note = { title: string; body: string };

function advise(pieces: Piece[], ads: Ad[]): Note[] {
  if (!pieces.length) return [{ title: "Start", body: "The floor is empty. Add a piece, or load a sample, and this will start reading the pattern." }];
  const notes: Note[] = [];
  const sold = pieces.filter(isSale);
  const held = pieces.filter((piece) => piece.status === "available" || piece.status === "incoming");
  const months = periodsOf(pieces, "month").filter((row) => row.revenue > 0);
  const recent = months.at(-1);
  const before = months.at(-2);
  if (recent && before) {
    const change = before.profit === 0 ? null : Math.round(((recent.profit - before.profit) / Math.abs(before.profit)) * 100);
    notes.push({
      title: change == null ? "This month" : change >= 0 ? "Moving ahead" : "Slower than last month",
      body: change == null
        ? `${recent.label} left ${money(recent.profit)}. ${before.label} had not left anything yet.`
        : change >= 0
          ? `${recent.label} left ${money(recent.profit)} after cost, ${change}% more than ${before.label}.`
          : `${recent.label} left ${money(recent.profit)} after cost, ${Math.abs(change)}% less than ${before.label}.`,
    });
  } else if (recent) {
    notes.push({
      title: "Where you are",
      body: `${recent.label} is the only month with sales so far: ${money(recent.revenue)} in, ${money(recent.profit)} left, on ${recent.count} ${recent.count === 1 ? "sale" : "sales"}.`,
    });
  }

  const tracked = sold.reduce((sum, piece) => sum + piece.qty, 0) + held.reduce((sum, piece) => sum + piece.qty, 0);
  const soldQty = sold.reduce((sum, piece) => sum + piece.qty, 0);
  if (tracked) {
    const rate = Math.round((soldQty / tracked) * 100);
    notes.push({ title: "How much has left", body: `${soldQty} of ${tracked} pieces have sold. That is ${rate}% of what you have tracked.` });
  }

  const best = salesOf(sold)[0];
  if (best && best.revenue > 0) {
    notes.push({ title: "What pays", body: `${best.name} has brought in the most: ${best.count} sold, ${money(best.revenue)} in, ${money(best.profit)} left.` });
  }

  const priced = sold.filter((piece) => piece.saleCents != null);
  const revenue = priced.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
  const cost = priced.reduce((sum, piece) => sum + effectiveCostCents(piece) * piece.qty, 0);
  if (revenue > 0) {
    const margin = Math.round(((revenue - cost) / revenue) * 100);
    notes.push({
      title: margin < 30 ? "The gap is thin" : "The gap is healthy",
      body: margin < 30
        ? `You keep ${margin} cents of each dollar. Buy lower, or ask more, before the next restock.`
        : `You keep ${margin} cents of each dollar. Protect that when you offer a discount.`,
    });
  }

  const soldSizes = new Map<string, number>();
  for (const piece of sold) {
    const size = piece.usSize || piece.sizeLabel;
    if (size) soldSizes.set(size, (soldSizes.get(size) ?? 0) + piece.qty);
  }
  const stockSizes = new Set(held.map((piece) => piece.usSize || piece.sizeLabel).filter(Boolean));
  const missing = [...soldSizes.entries()].sort((a, b) => b[1] - a[1]).find(([size]) => !stockSizes.has(size));
  const topSize = [...soldSizes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (missing) notes.push({ title: "Buy this size again", body: `Size ${missing[0]} has sold ${missing[1]} ${missing[1] === 1 ? "time" : "times"} and none are on the floor now.` });
  else if (topSize) notes.push({ title: "The size that leaves", body: `Size ${topSize[0]} is the one that sells most. Keep at least one on hand.` });

  const holds = sold.map((piece) => daysHeld(piece.receivedOn, piece.soldOn)).filter((days): days is number => days != null);
  const sitting = held
    .map((piece) => ({ piece, days: daysHeld(piece.receivedOn, null) }))
    .filter((row): row is { piece: Piece; days: number } => row.days != null);
  if (holds.length && sitting.length) {
    const average = Math.round(holds.reduce((sum, days) => sum + days, 0) / holds.length);
    const oldest = [...sitting].sort((a, b) => b.days - a.days)[0];
    if (oldest && oldest.days > average + 14) {
      notes.push({ title: "Waiting too long", body: `Sold pieces left in about ${average} days. ${oldest.piece.name} has been here ${oldest.days}. Relist it or lower the ask.` });
    }
  }

  const tied = held.reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
  const profit = revenue - cost;
  if (tied > 0 && sold.length) {
    notes.push({
      title: "Money still sitting",
      body: tied > Math.max(0, profit)
        ? `The floor is holding ${money(tied)}. That is more than the ${money(profit)} you have kept so far. Sell before you buy more.`
        : `The floor is holding ${money(tied)}. You have already kept ${money(profit)}, so the stock is not ahead of you.`,
    });
  }

  const discount = sold.reduce((sum, piece) => sum + priceCutCents(piece) * piece.qty, 0);
  if (discount > 0) notes.push({ title: "Given away", body: `Discounts have taken ${money(discount)} off the sales you recorded.` });

  const unpriced = sold.length - priced.length;
  if (unpriced) notes.push({ title: "Missing prices", body: `${unpriced} sold ${unpriced === 1 ? "piece has" : "pieces have"} no final price, so the profit is still short.` });
  if (!sold.length) notes.push({ title: "No sales yet", body: "Nothing has sold yet. The available shelf is where the next sale has to come from." });

  const inCar = held.filter((piece) => piece.place === "car").reduce((sum, piece) => sum + piece.qty, 0);
  if (inCar) notes.push({ title: "In the car", body: `${inCar} ${inCar === 1 ? "piece is" : "pieces are"} in the car. They sell faster once they are listed from home.` });
  const problems = pieces.filter((piece) => piece.problem).length;
  if (problems) notes.push({ title: "Open problems", body: `${problems} ${problems === 1 ? "piece is" : "pieces are"} flagged. Settle those before buying the same thing again.` });

  if (ads.length) {
    const spent = ads.reduce((sum, ad) => sum + ad.spentCents, 0);
    const worked = ads.filter((ad) => ad.worked === "yes").length;
    notes.push({
      title: "Promotion",
      body: worked
        ? `${worked} of ${ads.length} ads worked, on ${money(spent)} spent. Put the next dollar on the product that already sold.`
        : `Ads have cost ${money(spent)} and none are marked as having worked. Pause them before you pay again.`,
    });
  }

  return notes;
}

export function House() {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [theme, setTheme] = useState<ThemeId>("night");
  const [checks, setChecks] = useState<Floor["checkpoints"]>([]);
  const [marks, setMarks] = useState<Floor["marks"]>([]);
  const [ads, setAds] = useState<Floor["ads"]>([]);
  const [adsOn, setAdsOn] = useState(true);
  const [openStats, setOpenStats] = useState<string[]>([]);
  const [pinnedStats, setPinnedStats] = useState<string[]>([]);
  const [statsReady, setStatsReady] = useState(false);
  const [view, setView] = useState<View>("floor");
  const [desk, setDesk] = useState<Desk>("stats");
  const [exporting, setExporting] = useState(false);
  const [chip, setChip] = useState<Shelf>("live");
  const [lens, setLens] = useState<Lens | null>(null);
  const [past, setPast] = useState<"sold" | "archived">("sold");
  const [face, setFace] = useState<Face>("large");
  const [cols, setCols] = useState<2 | 3 | 4>(2);
  const layout: Layout = face === "large" ? "card" : face === "medium" ? "medium" : face === "list" ? "list" : cols === 2 ? "g2" : cols === 3 ? "g3" : "g4";
  const listClass = layout === "card" ? "mt-4 space-y-3" : layout === "g2" ? "mt-4 grid grid-cols-2 gap-2" : layout === "g3" ? "mt-4 grid grid-cols-3 gap-2" : layout === "g4" ? "mt-4 grid grid-cols-4 gap-1.5" : "mt-4 space-y-2";
  const nestClass = listClass.replace("mt-4 ", "");
  // Tablet landscape (1.1.4): in a grid layout the group's cards run in ONE continuous grid across
  // its subcategories — the sub wrappers and their lists flatten (lg:contents) so the subcategory
  // header becomes a tile in the same flow and no card is left alone on a half-empty row. Below lg
  // (and in the card/list layouts) the rendering is exactly what it has always been.
  const wideCols = layout === "g2" ? "lg:grid-cols-2" : layout === "g3" ? "lg:grid-cols-3" : layout === "g4" ? "lg:grid-cols-4" : "";
  const wideGrid = wideCols !== "";
  const [filterOpen, setFilterOpen] = useState(false);
  const [kind, setKind] = useState("all");
  const [product, setProduct] = useState("all");
  const [openCats, setOpenCats] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<PieceInput | null>(null);
  const [editorFocus, setEditorFocus] = useState<AdviceFocus | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ piece: Piece; status?: Status; problem?: string; title: string; detail: string } | null>(null);
  const [undo, setUndo] = useState<{ previous: Piece; name: string; what: string } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [openSettings, setOpenSettings] = useState<string[]>([]);
  const [wipe, setWipe] = useState<string[]>([]);
  const [wipeAsk, setWipeAsk] = useState(false);
  const [sampleAsk, setSampleAsk] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [notice, setNotice] = useState("");
  // A notice reports a moment, not a state: it clears itself (button audit V-9).
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 9000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const touchX = useRef(0);
  const topRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [bars, setBars] = useState<{ top: HTMLElement | null; dock: HTMLElement | null }>({ top: null, dock: null });

  useEffect(() => {
    if (!undo || undoOpen) return;
    if (undo.what !== "Sold" && undo.what !== "Delete" && undo.what !== "Remove") {
      setUndo(null);
      return;
    }
    const timer = window.setTimeout(() => setUndo(null), 6000);
    return () => window.clearTimeout(timer);
  }, [undo, undoOpen]);

  useLayoutEffect(() => {
    const reset = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    reset();
    const frame = requestAnimationFrame(reset);
    return () => cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => {
    let cancel = false;
    loadFloor()
      .then((data) => {
        if (cancel) return;
        setPieces(data.pieces);
        setMarks(data.marks);
        setAds(data.ads);
        setAdsOn(data.adsOn);
        setTheme(asTheme(data.theme));
        setChecks(data.checkpoints);
        applyTheme(asTheme(data.theme));
        setPhase("ready");
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setError(err instanceof Error ? err.message : "Could not open the floor");
        setPhase("error");
      });
    return () => {
      cancel = true;
    };
  }, []);

  // Static app (src/spa): another device's changes arrive by sync; take them in without closing what is open.
  useEffect(() => {
    const refresh = () => {
      void loadFloor().then((data) => {
        setPieces(data.pieces);
        setMarks(data.marks);
        setAds(data.ads);
        setAdsOn(data.adsOn);
        setChecks(data.checkpoints);
        const next = asTheme(data.theme);
        setTheme(next);
        applyTheme(next);
      });
    };
    window.addEventListener("ventory-remote", refresh);
    return () => window.removeEventListener("ventory-remote", refresh);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pieces.filter((piece) => {
      if (lens === "hand" && piece.status !== "available") return false;
      if (lens === "incoming" && piece.status !== "incoming") return false;
      if (!lens && chip === "live" && piece.status !== "available" && piece.status !== "incoming") return false;
      if (!lens && chip !== "live" && chip !== "all" && piece.status !== chip) return false;
      if (kind !== "all" && piece.category.trim().toLowerCase() !== kind) return false;
      if (!q) return true;
      return `${piece.name} ${piece.brand} ${piece.category} ${piece.subcategory} ${piece.source} ${piece.clientName}`.toLowerCase().includes(q);
    });
  }, [pieces, chip, query, lens, kind]);

  const groups = useMemo(() => {
    const cats = new Map<string, Map<string, Piece[]>>();
    for (const piece of visible) {
      const category = piece.category.trim() || "Unsorted";
      const sub = styleOf(piece);
      const bucket = cats.get(category) ?? new Map<string, Piece[]>();
      const list = bucket.get(sub) ?? [];
      list.push(piece);
      bucket.set(sub, list);
      cats.set(category, bucket);
    }
    return [...cats.entries()]
      .sort((a, b) => (a[0] === "Unsorted" ? 1 : b[0] === "Unsorted" ? -1 : a[0].localeCompare(b[0])))
      .map(([category, subs]) => ({
        category,
        count: [...subs.values()].reduce((sum, list) => sum + list.length, 0),
        subs: [...subs.entries()]
          .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
          .map(([name, items]) => ({ name, items })),
      }));
  }, [visible]);

  const history = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pieces
      .filter((piece) => piece.status === past)
      .filter((piece) => (past === "sold" ? product === "all" || piece.name.trim().toLowerCase() === product : kind === "all" || piece.category.trim().toLowerCase() === kind))
      .filter((piece) => !q || `${piece.name} ${piece.brand} ${piece.category} ${piece.source} ${piece.clientName}`.toLowerCase().includes(q))
      .sort((a, b) => (b.soldOn || b.receivedOn || "").localeCompare(a.soldOn || a.receivedOn || ""));
  }, [pieces, past, query, kind, product]);

  const kinds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const piece of pieces) {
      const label = piece.category.trim();
      if (!label) continue;
      const id = label.toLowerCase();
      if (!seen.has(id)) seen.set(id, label);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [pieces]);

  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const piece of pieces) {
      const label = piece.name.trim();
      if (!label) continue;
      const id = label.toLowerCase();
      if (!seen.has(id)) seen.set(id, label);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [pieces]);

  const soldLines = useMemo(() => salesOf(pieces.filter((piece) => piece.status === "sold")), [pieces]);
  const countedLines = useMemo(() => salesOf(pieces.filter(isSale)), [pieces]);

  const stats = useMemo(() => {
    const available = pieces.filter((piece) => piece.status === "available").reduce((sum, piece) => sum + piece.qty, 0);
    const incoming = pieces.filter((piece) => piece.status === "incoming").reduce((sum, piece) => sum + piece.qty, 0);
    const sold = pieces.filter(isSale);
    const priced = sold.filter((piece) => piece.saleCents != null);
    const revenue = priced.reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0);
    const cost = priced.reduce((sum, piece) => sum + effectiveCostCents(piece) * piece.qty, 0);
    const tied = pieces.filter((piece) => piece.status === "available" || piece.status === "incoming").reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
    return { available, incoming, sold: sold.reduce((sum, piece) => sum + piece.qty, 0), revenue, profit: revenue - cost, tied, unpriced: sold.length - priced.length, cost };
  }, [pieces]);

  const picture = useMemo(() => {
    const held = pieces.filter((piece) => piece.status === "available" || piece.status === "incoming");
    const sold = pieces.filter(isSale);
    const sizeOf = (piece: Piece) => (piece.usSize ? `US ${halfSize(piece.usSize)}` : piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "No size");
    const holds = sold.map((piece) => daysHeld(piece.receivedOn, piece.soldOn)).filter((days): days is number => days != null);
    const sitting = held.map((piece) => daysHeld(piece.receivedOn, null)).filter((days): days is number => days != null);
    return {
      home: held.filter((piece) => piece.place === "home").reduce((sum, piece) => sum + piece.qty, 0),
      car: held.filter((piece) => piece.place === "car").reduce((sum, piece) => sum + piece.qty, 0),
      loose: held.filter((piece) => !piece.place).reduce((sum, piece) => sum + piece.qty, 0),
      sizesHere: barsOf(held, sizeOf),
      sizesSold: barsOf(sold, sizeOf),
      sources: barsOf(pieces.filter((piece) => piece.source), (piece) => piece.source),
      soldNow: pieces.filter((piece) => piece.status === "sold").reduce((sum, piece) => sum + piece.qty, 0),
      archived: pieces.filter((piece) => piece.status === "archived").reduce((sum, piece) => sum + piece.qty, 0),
      avgHold: holds.length ? Math.round(holds.reduce((sum, days) => sum + days, 0) / holds.length) : null,
      oldest: sitting.length ? Math.max(...sitting) : null,
      problems: pieces.filter((piece) => piece.problem).length,
      margin: (() => { const share = marginOf(pieces.filter((piece) => piece.status === "sold" || piece.wasSold)); return share == null ? null : Math.round(share * 100); })(),
    };
  }, [pieces, stats.profit, stats.revenue]);

  const month = periodsOf(pieces, "month").filter((row) => row.stamp > 0).at(-1) ?? null;
  const datedMonths = periodsOf(pieces, "month").filter((row) => row.stamp > 0);
  const datedWeeks = periodsOf(pieces, "week").filter((row) => row.stamp > 0);
  const pricedQty = pieces.filter((piece) => isSale(piece) && piece.saleCents != null).reduce((sum, piece) => sum + piece.qty, 0);
  const givenAway = pieces.filter(isSale).reduce((sum, piece) => sum + priceCutCents(piece) * piece.qty, 0);
  const sitting = (status: "available" | "incoming") => pieces.filter((piece) => piece.status === status).reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);

  useEffect(() => {
    setOpenStats(readStatList("ventory-stat-open"));
    setPinnedStats(readStatList("ventory-stat-pin"));
    setStatsReady(true);
  }, []);
  useEffect(() => {
    if (!statsReady) return;
    localStorage.setItem("ventory-stat-open", JSON.stringify(openStats));
    localStorage.setItem("ventory-stat-pin", JSON.stringify(pinnedStats));
  }, [openStats, pinnedStats, statsReady]);

  const brief = useMemo(() => buildAdvice(pieces, adsOn ? ads : []), [pieces, ads, adsOn]);

  async function onSave(input: PieceInput) {
    const saved = await savePiece({ data: input });
    if (!saved) return;
    setPieces((current) => {
      const next = current.filter((piece) => piece.id !== saved.id);
      return [...next, saved].sort((a, b) => a.sort - b.sort);
    });
    setEditor(null);
    setEditorFocus(null);
    if (saved.status === "sold" || saved.status === "archived") {
      setPast(saved.status);
      setView("history");
      return;
    }
    if (saved.status === "kept") return;
    setView("floor");
    setChip(saved.status === "available" || saved.status === "incoming" ? "live" : saved.status);
  }

  function requestStatus(piece: Piece, status: Status) {
    const next: Status = status === "incoming" && piece.status === "incoming" ? "available" : status;
    if (piece.status === next) return;
    const unselectComing = piece.status === "incoming" && next === "available";
    const word = next === "incoming" ? "Coming" : next === "sold" ? "Sold" : next === "available" ? "Available" : "Archive";
    const detail =
      next === "sold"
        ? `It moves to Sold in History at ${money(piece.saleCents ?? piece.askCents)} via ${piece.channel || "Facebook Marketplace"}. Reverse stays up for a few seconds.`
        : unselectComing
          ? "It comes off Coming and goes back to Available. Nothing changes until you confirm."
          : next === "incoming"
            ? "It counts as on the way, not ready to sell. Nothing changes until you confirm."
            : next === "archived"
              ? "It moves to Archive. Nothing changes until you confirm."
              : "It goes back on the shelf. Nothing changes until you confirm.";
    setAsk({
      piece,
      status: next,
      title: unselectComing ? `Take ${piece.name} off Coming?` : `Mark ${piece.name} as ${word}?`,
      detail,
    });
  }

  function requestProblem(piece: Piece, problem: string) {
    const label = PROBLEMS.find((item) => item.id === problem)?.label ?? "Clear the problem";
    setAsk({
      piece,
      problem,
      title: problem ? `${label} on ${piece.name}?` : `Clear the problem on ${piece.name}?`,
      detail: "Nothing changes until you confirm.",
    });
  }

  function commitAsk() {
    if (!ask) return;
    const previous = ask.piece;
    const status = ask.status;
    const next: Piece = status
      ? {
          ...previous,
          status,
          saleCents: status === "sold" ? (previous.saleCents ?? previous.askCents) : status === "archived" ? previous.saleCents : null,
          soldOn: status === "sold" ? previous.soldOn || todayISO() : status === "archived" ? previous.soldOn : null,
          wasSold: status === "sold" ? true : status === "archived" ? previous.wasSold || previous.status === "sold" : previous.wasSold,
          channel: status === "sold" && !previous.channel ? "Facebook Marketplace" : previous.channel,
        }
      : { ...previous, problem: ask.problem ?? "" };
    setAsk(null);
    void savePiece({ data: next }).then((saved) => {
      if (!saved) return;
      setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      if (status === "sold") {
        setUndo({ previous, name: previous.name, what: "Sold" });
        setUndoOpen(false);
      }
    });
  }

  function commitUndo() {
    if (!undo) return;
    const previous = undo.previous;
    const next: Piece =
      undo.what === "Sold"
        ? { ...previous, status: "available", saleCents: null, soldOn: null, wasSold: false }
        : previous;
    void savePiece({ data: next }).then((saved) => {
      if (!saved) return;
      setPieces((current) => {
        const exists = current.some((item) => item.id === saved.id);
        const next = exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
        return next.sort((a, b) => a.sort - b.sort);
      });
      setUndo(null);
      setUndoOpen(false);
    });
  }

  // Faro's quick day/night flip: one tap steps to the other side, back to the
  // theme you last used on that side (remembered per side), not a fixed default.
  function flipTheme() {
    const dark = !isLightTheme(theme);
    let stored: string | null = null;
    try {
      localStorage.setItem(dark ? "ventory-night-theme" : "ventory-day-theme", theme);
      stored = localStorage.getItem(dark ? "ventory-day-theme" : "ventory-night-theme");
    } catch {
      /* ignore */
    }
    const pool: ThemeId[] = dark ? LIGHT_THEMES : THEMES.map((item) => item.id).filter((id) => !isLightTheme(id));
    const next: ThemeId = stored && pool.includes(stored as ThemeId) ? (stored as ThemeId) : dark ? "day" : "night";
    setTheme(next);
    applyTheme(next);
    void saveTheme({ data: next });
  }

  function foldStat(id: string) {
    if (pinnedStats.includes(id)) return;
    setOpenStats((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }
  function pinStat(id: string) {
    setPinnedStats((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    setOpenStats((current) => (current.includes(id) ? current : [...current, id]));
  }

  const panel = (id: View) =>
    view === id
      ? "surface relative translate-y-0 opacity-100 blur-none"
      : "surface pointer-events-none absolute inset-x-0 top-0 h-0 overflow-hidden opacity-0";

  const samplePieces = pieces.filter((piece) => piece.id.startsWith("sample-"));
  const sampleAds = ads.filter((ad) => ad.id.startsWith("sample-"));
  const legacyPieces = pieces.filter((piece) => isLegacySample(piece));
  const sampleSet = sampleSetSize();
  const sampleComplete = samplePieces.length >= sampleSet.pieces && sampleAds.length >= sampleSet.ads && legacyPieces.length === 0;
  const sampleOn = samplePieces.length > 0 || sampleAds.length > 0 || legacyPieces.length > 0;

  function loadSampleFloor() {
    void addSamples()
      .then((next) => {
        setPieces(next.pieces);
        setAds(next.ads);
        setSettings(false);
        setView("floor");
        setNotice("Sample floor added — turn it off anytime in Settings, under Sample floor");
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not load the sample floor"));
  }

  const wipeRows = [
    { id: "available", label: "Available", count: pieces.filter((piece) => piece.status === "available").length },
    { id: "incoming", label: "Incoming", count: pieces.filter((piece) => piece.status === "incoming").length },
    { id: "sold", label: "Sold", count: pieces.filter((piece) => piece.status === "sold").length },
    { id: "archived", label: "Archive", count: pieces.filter((piece) => piece.status === "archived").length },
    { id: "kept", label: "Kept", count: pieces.filter((piece) => piece.status === "kept").length },
    { id: "ads", label: "Ad records", count: ads.length },
    { id: "backups", label: "Saved backups", count: checks.length },
  ];
  const wipePicked = wipeRows.filter((row) => wipe.includes(row.id) && row.count > 0);

  function commitWipe() {
    if (!wipePicked.length || wiping) return;
    setWiping(true);
    const statuses = wipePicked.map((row) => row.id).filter((id) => id !== "ads" && id !== "backups");
    void clearSelected({ data: { statuses, ads: wipePicked.some((row) => row.id === "ads"), backups: wipePicked.some((row) => row.id === "backups") } })
      .then((next) => {
        setPieces(next.pieces);
        setAds(next.ads);
        setChecks(next.checkpoints);
        setEditor((current) => (current?.id && !next.pieces.some((piece) => piece.id === current.id) ? null : current));
        setAsk(null);
        setUndo(null);
        setUndoOpen(false);
        setWipe([]);
        setWipeAsk(false);
        const parts = [
          next.removedPieces ? `${next.removedPieces} ${next.removedPieces === 1 ? "piece" : "pieces"}` : "",
          next.removedAds ? `${next.removedAds} ${next.removedAds === 1 ? "ad record" : "ad records"}` : "",
          next.removedBackups ? `${next.removedBackups} ${next.removedBackups === 1 ? "backup" : "backups"}` : "",
        ].filter(Boolean);
        setNotice(parts.length ? `Removed ${parts.join(", ")}` : "Nothing matched");
      })
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not remove"))
      .finally(() => setWiping(false));
  }

  useLayoutEffect(() => {
    setBars({ top: topRef.current, dock: dockRef.current });
  }, []);
  useScrollBars({
    scroller: typeof window === "undefined" ? null : window,
    header: bars.top,
    dock: bars.dock,
    pinned: Boolean(editor || settings || ask || undoOpen || wipeAsk || confirmId),
  });

  return (
    <main
      className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-28 lg:max-w-none lg:px-8"
      onTouchStart={(event) => {
        touchX.current = event.changedTouches[0]?.clientX ?? 0;
      }}
      onTouchEnd={(event) => {
        const dx = (event.changedTouches[0]?.clientX ?? 0) - touchX.current;
        if (Math.abs(dx) < 56) return;
        const order: View[] = ["floor", "history", "ledger"];
        const index = order.indexOf(view);
        const step = dx < 0 ? 1 : -1;
        const next = order[(index + step + order.length) % order.length];
        setView(next);
        rippleNav(next);
      }}
    >
      <header ref={topRef} className="shelf-top sticky top-0 z-30 -mx-4 flex items-start justify-between gap-3 bg-canvas px-4 pt-[max(0.875rem,calc(env(safe-area-inset-top)+0.625rem))] pb-3 lg:-mx-8 lg:px-8">
        <Wordmark className="text-[2.156rem]" />
        {/* Two-storey corner (1.2.6, Oscar's word): Add owns the top-right corner alone, and
            Day/Night, Export and Settings step down to a smaller second row beneath it, so the
            shelf grows taller and the cluster reads at a glance. The Tron beams anchor to the
            shelf's bottom edge, so they follow the taller shelf on their own. */}
        <div className="flex flex-col items-end gap-1.5">
          <button type="button" aria-label="Add" className="press grid size-9 place-items-center rounded-full bg-accent text-accent-ink" onClick={() => { setFilterOpen(false); setEditorFocus(null); setEditor(emptyInput()); }}>
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label={isLightTheme(theme) ? "Night" : "Day"} className="press grid size-7 place-items-center rounded-full border border-line" onClick={flipTheme}>
              {isLightTheme(theme) ? <Moon className="size-3" strokeWidth={1.75} /> : <Sun className="size-3" strokeWidth={1.75} />}
            </button>
            {/* Export lives in the header (1.1.3, Faro's placement) — since 1.2.6 on the lower row. */}
            <button type="button" aria-label="Export a report" aria-haspopup="dialog" className="press grid size-7 place-items-center rounded-full border border-line" onClick={() => setExporting(true)}>
              <FileDown className="size-3" strokeWidth={1.75} />
            </button>
            <button type="button" aria-label="Settings" className="press grid size-7 place-items-center rounded-full border border-line" onClick={() => { setFilterOpen(false); setOpenSettings([]); setWipe([]); setWipeAsk(false); setSettings(true); }}>
              <SlidersHorizontal className="size-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </header>

      <div className="relative mt-5">
        <section className={`${panel("floor")} bloom`}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pieces"
            className="surface fold-row h-12 w-full rounded-2xl border border-line bg-panel px-4 text-sm outline-none focus:border-accent"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ["hand", "On hand", String(stats.available), stats.available ? `${money(sitting("available"))} ready` : "Nothing on the floor yet", Package, "#5f8f72"],
              ["incoming", "Incoming", String(stats.incoming), stats.incoming ? `${money(sitting("incoming"))} on the way` : "Nothing on the road yet", Truck, "#5d86ad"],
              ["revenue", "Revenue", money(stats.revenue), month ? `${month.label} · ${money(month.revenue)}` : "Nothing on the books yet", CircleDollarSign, "#b08a3e"],
              ["profit", "Profit", money(stats.profit), picture.margin == null ? "No profit yet" : `${picture.margin}% after cost`, TrendingUp, "#8d6aad"],
            ] as const).map(([id, label, value, hint, icon, tone]) => (
              <Summary
                key={id}
                label={label}
                value={value}
                hint={hint}
                icon={icon}
                tone={tone}
                pressed={lens === id}
                dimmed={lens !== null && lens !== id}
                onClick={() => {
                  setLens((current) => (current === id ? null : id));
                  setView("floor");
                }}
              />
            ))}
          </div>
          <ViewBar face={face} cols={cols} onFace={setFace} onCols={setCols} kinds={kinds} kind={kind} open={filterOpen} onToggle={() => setFilterOpen((open) => !open)} onKind={(id) => { setKind(id); setFilterOpen(false); }} />
          {lens === "revenue" || lens === "profit" ? (
            <div className="mt-4 space-y-3">
              <Performance pieces={pieces} focus={lens} />
              <LatestSales pieces={pieces} onOpen={(piece) => { setEditorFocus(null); setEditor({ ...piece }); }} />
            </div>
          ) : (
            <>
          {notice ? <p className="mt-3 text-sm text-accent">{notice}</p> : null}
          {phase === "loading" ? <p className="mt-8 text-muted">Opening the floor</p> : null}
          {phase === "error" ? (
            <div className="mt-6 rounded-3xl border border-line bg-panel p-6">
              <p className="font-display text-2xl">The floor did not open</p>
              <p className="mt-2 text-sm text-muted">{error}</p>
            </div>
          ) : null}
          {phase === "ready" && visible.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-line bg-panel px-6 py-8">
              <p className="font-display text-3xl">Nothing on this shelf</p>
              <p className="mt-2 max-w-sm text-sm text-muted">Incoming and available stay here. Sold and archive live in History.</p>
              <button
                type="button"
                className="press mt-5 h-11 rounded-full border border-line px-4 text-sm"
                onClick={loadSampleFloor}
              >
                Load a sample floor
              </button>
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {groups.map((group) => {
              const open = query.trim().length > 0 || openCats.includes(group.category);
              return (
                <section key={group.category}>
                  <button
                    type="button"
                    aria-expanded={open}
                    className="press fold-row flex w-full items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left"
                    onClick={() => setOpenCats((current) => (current.includes(group.category) ? current.filter((item) => item !== group.category) : [...current, group.category]))}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{group.category}</span>
                    <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs tabular-nums text-muted">{group.count}</span>
                    <ChevronDown className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
                  </button>
                  {open ? (
                    <div className={wideGrid ? `mt-3 space-y-4 lg:grid ${wideCols} ${layout === "g4" ? "lg:gap-1.5" : "lg:gap-2"} lg:space-y-0` : "mt-3 space-y-4"}>
                      {group.subs.map((sub) => {
                        const photo = marks.find((mark) => mark.category.toLowerCase() === group.category.toLowerCase() && mark.subcategory.toLowerCase() === sub.name.toLowerCase())?.photo ?? "";
                        return (
                        <div key={sub.name || "plain"} className={wideGrid ? "lg:contents" : undefined}>
                          {sub.name ? (
                            <div className={`fold-row flex items-center gap-3 rounded-2xl border border-line bg-panel p-2 pr-4${wideGrid ? " lg:self-start" : ""}`}>
                              <label className="press relative grid size-16 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-xl bg-canvas text-muted">
                                {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5" strokeWidth={1.75} />}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (!file) return;
                                    void compressPhoto(file).then((next) => {
                                      if (!next) return;
                                      void saveMark({ data: { category: group.category, subcategory: sub.name, photo: next } }).then(setMarks);
                                    });
                                  }}
                                />
                              </label>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{sub.name}</span>
                                <span className="block text-xs text-muted">{photo ? `${sub.items.length} inside` : "Add a photo"}</span>
                              </span>
                            </div>
                          ) : null}
                          <ul className={`${nestClass} ${sub.name ? "mt-2" : ""}${wideGrid ? " lg:contents" : ""}`}>
                            {sub.items.map((piece) => (
                              <PieceCard
                                key={piece.id}
                                piece={piece}
                                layout={layout}
                                iconic
                                onOpen={() => { setEditorFocus(null); setEditor({ ...piece }); }}
                                onStatus={(status) => requestStatus(piece, status)}
                                onDelete={() => setConfirmId(piece.id)}
                                onProblem={(problem) => requestProblem(piece, problem)}
                              />
                            ))}
                          </ul>
                        </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
            </>
          )}
        </section>

        <section className={`${panel("history")} bloom`}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pieces"
            className="surface fold-row h-12 w-full rounded-2xl border border-line bg-panel px-4 text-sm outline-none focus:border-accent"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <HistoryChip
              label="Sold"
              value={String(pieces.filter((piece) => piece.status === "sold").reduce((sum, piece) => sum + piece.qty, 0))}
              hint={money(pieces.filter((piece) => piece.status === "sold" && piece.saleCents != null).reduce((sum, piece) => sum + (piece.saleCents ?? 0) * piece.qty, 0))}
              icon={BadgeCheck}
              tone="#c47b4a"
              pressed={past === "sold"}
              onClick={() => setPast("sold")}
            />
            <HistoryChip
              label="Archive"
              value={String(pieces.filter((piece) => piece.status === "archived").reduce((sum, piece) => sum + piece.qty, 0))}
              hint="Still in the numbers"
              icon={Archive}
              tone="#4f7f8a"
              pressed={past === "archived"}
              onClick={() => setPast("archived")}
            />
          </div>
          {adsOn ? <AdsWidget ads={ads} pieces={pieces} onChange={setAds} /> : null}
          <ViewBar face={face} cols={cols} onFace={setFace} onCols={setCols} kinds={past === "sold" ? products : kinds} kind={past === "sold" ? product : kind} open={filterOpen} onToggle={() => setFilterOpen((open) => !open)} onKind={(id) => { if (past === "sold") setProduct(id); else setKind(id); setFilterOpen(false); }} />
          {/* Tablet landscape (1.1.4): the By product board stands beside the list instead of above it.
              The grid only exists when the board does, so an archive list (or an empty shelf) keeps the
              full width. Below lg the stacking is exactly as before. */}
          <div className={past === "sold" && soldLines.some((row) => product === "all" || row.name.toLowerCase() === product) ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4" : undefined}>
          {past === "sold" && soldLines.some((row) => product === "all" || row.name.toLowerCase() === product) ? <SalesBoard title="By product" rows={soldLines.filter((row) => product === "all" || row.name.toLowerCase() === product)} /> : null}
          {history.length === 0 ? (
            <div className="mt-6 rounded-3xl border border-line bg-panel px-6 py-8">
              <p className="font-display text-3xl">{past === "sold" ? (product === "all" ? "Nothing sold yet" : "Nothing under this product") : "Nothing archived"}</p>
              <p className="mt-2 max-w-sm text-sm text-muted">
                {past === "sold" ? "Mark a piece sold and it lands here, with its price and its dates." : "Retire a piece and it stays here. Its sale still counts in Statistics."}
              </p>
            </div>
          ) : (
            <ul key={`${past}-${layout}`} className={listClass}>
              {history.map((piece) => (
                <PieceCard
                  key={piece.id}
                  piece={piece}
                  layout={layout}
                  onOpen={() => { setEditorFocus(null); setEditor({ ...piece }); }}
                  onStatus={(status) => requestStatus(piece, status)}
                  onDelete={() => setConfirmId(piece.id)}
                  onProblem={(problem) => requestProblem(piece, problem)}
                />
              ))}
            </ul>
          )}
          </div>
        </section>

        <section className={`${panel("ledger")} bloom`}>
          {/* Tablet landscape (1.1.4): the desk switch steps aside and both desks stand side by side,
              chart and advice in two columns. Below lg the switch and the single desk are untouched. */}
          <div className="grid grid-cols-2 gap-2 lg:hidden">
            {([
              ["stats", "Statistics"],
              ["advisor", "Advisor"],
            ] as const).map(([id, label]) => (
              <RippleButton
                key={id}
                nav={id}
                aria-pressed={desk === id}
                onClick={() => setDesk(id)}
                className={`press h-11 rounded-2xl border text-sm font-medium ${desk === id ? "border-line bg-panel text-ink" : "border-line/70 text-muted"}`}
              >
                {label}
              </RippleButton>
            ))}
          </div>
          {exporting ? <ExportCenter pieces={pieces} ads={adsOn ? ads : []} advice={brief} onClose={() => setExporting(false)} onDone={setNotice} /> : null}
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
            <div className={desk === "stats" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <StatsDesk pieces={pieces} ads={ads} adsOn={adsOn} lines={brief.lines} openStats={openStats} pinnedStats={pinnedStats} foldStat={foldStat} pinStat={pinStat} />
            </div>
            <div className={desk === "advisor" ? "min-w-0" : "hidden min-w-0 lg:block"}>
              <AdvisorView
              advice={brief}
              pieces={pieces}
              onOpen={(piece, focus) => { setEditorFocus(focus ?? null); setEditor({ ...piece }); }}
              onPhoto={(piece, file) => {
                void compressPhoto(file).then((photo) => {
                  if (!photo) return;
                  void savePiece({ data: { ...piece, photo } }).then((saved) => {
                    if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                  });
                });
              }}
              onKeep={(piece) => {
                void savePiece({ data: { ...piece, status: "kept" } }).then((saved) => {
                  if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                });
              }}
              onReturn={(piece) => {
                void savePiece({ data: { ...piece, status: "available", saleCents: null, soldOn: null, wasSold: false } }).then((saved) => {
                  if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                });
              }}
              onRemove={(piece, reason) => {
                const note = piece.notes.includes(reason) ? piece.notes : `${piece.notes ? `${piece.notes} · ` : ""}Removed: ${reason}`;
                void savePiece({ data: { ...piece, status: "archived", wasSold: false, saleCents: null, soldOn: null, notes: note } }).then((saved) => {
                  if (saved) {
                    setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                    // A Remove gets the house's Reverse strip, like Sold and Delete (button audit V-5).
                    setUndo({ previous: piece, name: piece.name, what: "Remove" });
                    setUndoOpen(false);
                  }
                });
              }}
              onFlag={(piece) => {
                void savePiece({ data: { ...piece, problem: "late" } }).then((saved) => {
                  if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                });
              }}
              />
            </div>
          </div>
        </section>
      </div>

      {undo && !undoOpen && (undo.what === "Sold" || undo.what === "Delete" || undo.what === "Remove") ? (
        <div className="fixed inset-x-0 bottom-[4.75rem] z-20 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 lg:max-w-none lg:px-8">
          <p className="min-w-0 rounded-full border border-line bg-panel px-4 py-2 text-sm text-ink">{undo.name} · {undo.what}</p>
          <button type="button" className="press h-10 shrink-0 rounded-full border border-line bg-canvas px-4 text-sm text-ink" onClick={() => setUndoOpen(true)}>Reverse</button>
        </div>
      ) : null}

      <nav ref={dockRef} className="shelf-dock fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Swap
          fill
          value={view}
          onChange={setView}
          options={[
            { id: "floor", label: "Main" },
            { id: "history", label: "History" },
            { id: "ledger", label: "Stats" },
          ]}
        />
      </nav>

      {editor ? (
        <Editor
          initial={editor}
          focus={editorFocus}
          onClose={() => { setEditor(null); setEditorFocus(null); }}
          known={pieces}
          onSave={(input) => void onSave(input).catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not save"))}
          onImport={
            editor.id
              ? undefined
              : (rows) => {
                  void importPieces({ data: rows }).then((next) => {
                    setPieces(next);
                    setNotice(`Imported ${rows.length} rows`);
                    if (rows.every((row) => row.status === "archived")) setChip("archived");
                    setEditor(null);
                    setEditorFocus(null);
                    setView("floor");
                  });
                }
          }
          onTray={
            editor.id
              ? undefined
              : (payload) => {
                  void applyTrayImport({ data: { add: payload.add, update: payload.update } }).then((next) => {
                    setPieces(next);
                    setNotice(`Imported ${payload.add.length} ${payload.add.length === 1 ? "piece" : "pieces"}${payload.update.length ? ` · completed ${payload.update.length} already on the floor` : ""}`);
                    setView("floor");
                  });
                }
          }
        />
      ) : null}

      {confirmId ? (
        <Overlay onClose={() => setConfirmId(null)}>
          <p className="font-display text-2xl">Delete this piece?</p>
          <p className="mt-2 text-sm text-muted">It leaves the floor. Reverse stays up for a few seconds, then it is gone.</p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className="press h-11 rounded-full bg-danger px-4 text-sm text-white"
              onClick={() => {
                const id = confirmId;
                const previous = pieces.find((item) => item.id === id);
                setConfirmId(null);
                if (!id || !previous) return;
                void deletePiece({ data: id }).then((next) => {
                  setPieces(next);
                  setUndo({ previous, name: previous.name, what: "Delete" });
                  setUndoOpen(false);
                });
              }}
            >
              Delete
            </button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm" onClick={() => setConfirmId(null)}>
              Cancel
            </button>
          </div>
        </Overlay>
      ) : null}

      {ask ? (
        <Overlay onClose={() => setAsk(null)}>
          <p className="font-display text-2xl">{ask.title}</p>
          <p className="mt-2 text-sm text-muted">{ask.detail}</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" onClick={commitAsk}>Confirm</button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm" onClick={() => setAsk(null)}>Cancel</button>
          </div>
        </Overlay>
      ) : null}

      {undoOpen && undo ? (
        <Overlay onClose={() => setUndoOpen(false)}>
          <p className="font-display text-2xl">{undo.what === "Delete" ? `Add ${undo.name} back?` : undo.what === "Remove" ? `Put ${undo.name} back?` : `Put ${undo.name} back as Available?`}</p>
          <p className="mt-2 text-sm text-muted">{undo.what === "Delete" ? "It returns as it was before you deleted it." : undo.what === "Remove" ? "It returns as it was before you removed it." : "The sale comes off."}</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" onClick={commitUndo}>{undo.what === "Delete" ? "Add it back" : "Put it back"}</button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm" onClick={() => setUndoOpen(false)}>Cancel</button>
          </div>
        </Overlay>
      ) : null}

      {settings ? (
        <Overlay onClose={() => setSettings(false)}>
          <p className="font-display text-2xl">Settings</p>
          <button
            type="button"
            role="checkbox"
            aria-checked={SETTING_FOLDS.every((id) => openSettings.includes(id))}
            onClick={() => setOpenSettings(SETTING_FOLDS.every((id) => openSettings.includes(id)) ? [] : [...SETTING_FOLDS])}
            className="press mt-4 flex items-center gap-2 text-sm text-ink"
          >
            <span className={`grid size-4 place-items-center rounded border ${SETTING_FOLDS.every((id) => openSettings.includes(id)) ? "border-accent bg-accent text-accent-ink" : "border-line bg-canvas"}`}>
              {SETTING_FOLDS.every((id) => openSettings.includes(id)) ? <Check className="size-3" strokeWidth={2.75} /> : null}
            </span>
            {SETTING_FOLDS.every((id) => openSettings.includes(id)) ? "Fold" : "Unfold"}
          </button>
          <div className="mt-3 space-y-2">
            <SettingFold title="Theme" icon={<Palette className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("theme")} onToggle={() => setOpenSettings((current) => current.includes("theme") ? current.filter((id) => id !== "theme") : [...current, "theme"])}>
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((item) => (
                  <RippleButton
                    key={item.id}
                    ink={item.accent}
                    aria-pressed={theme === item.id}
                    onClick={() => {
                      setTheme(item.id);
                      applyTheme(item.id);
                      void saveTheme({ data: item.id });
                    }}
                    className={`press flex items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm ${theme === item.id ? "border-accent bg-accent-soft" : "border-line"}`}
                  >
                    <span className="size-7 shrink-0 rounded-full border border-line" style={{ background: item.color, boxShadow: `inset -8px 0 0 ${item.accent}` }} />
                    {item.label}
                  </RippleButton>
                ))}
              </div>
            </SettingFold>
            <SettingFold title="Facebook ads" icon={<Megaphone className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("ads")} onToggle={() => setOpenSettings((current) => current.includes("ads") ? current.filter((id) => id !== "ads") : [...current, "ads"])}>
              <button
                type="button"
                aria-pressed={adsOn}
                onClick={() => {
                  const next = !adsOn;
                  setAdsOn(next);
                  void saveAds({ data: next });
                }}
                className="press flex w-full items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 text-left"
              >
                <span>
                  <span className="block text-sm">Facebook ads</span>
                  <span className="mt-0.5 block text-xs text-muted">Tracking in History and Statistics. On until you turn it off.</span>
                </span>
                <span className={`grid h-7 w-12 place-items-center rounded-full text-xs ${adsOn ? "text-[#f6f3ec]" : "bg-canvas text-muted"}`} style={adsOn ? { background: litTone("#7d5a86") } : undefined}>{adsOn ? "On" : "Off"}</span>
              </button>
            </SettingFold>
            <SettingFold title="Backup" icon={<DatabaseBackup className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("backup")} onToggle={() => setOpenSettings((current) => current.includes("backup") ? current.filter((id) => id !== "backup") : [...current, "backup"])}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="press h-11 rounded-full border border-line px-4 text-sm"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({ app: "ventory", version: 2, exportedAt: new Date().toISOString(), pieces, ads, marks }, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `ventory-backup-${todayISO()}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export
                </button>
                <label className="press inline-flex h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm">
                  Restore
                  <input
                    type="file"
                    accept="application/json"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      void file.text().then(async (text) => {
                        // A file that is not JSON gets a human answer, not the parser's (button audit V-8).
                        let data: unknown;
                        try {
                          data = JSON.parse(text);
                        } catch {
                          throw new Error("That file is not a Ventory backup");
                        }
                        const next = await replaceFloor({ data });
                        setPieces(next);
                        setNotice("Backup restored");
                      }).catch((err: unknown) => setNotice(err instanceof Error ? err.message : "Could not import"));
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="press h-11 rounded-full border border-line px-4 text-sm"
                  onClick={() => {
                    void createCheckpoint({ data: `Manual ${todayISO()}` }).then((next) => {
                      setChecks(next);
                      setNotice("Backup saved");
                    });
                  }}
                >
                  Save backup
                </button>
              </div>
              {checks.length ? (
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {checks.map((check) => (
                    <li key={check.id}>{check.label}</li>
                  ))}
                </ul>
              ) : null}
            </SettingFold>
            <SettingFold title="Sample floor" icon={<LayoutGrid className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("sample")} onToggle={() => setOpenSettings((current) => current.includes("sample") ? current.filter((id) => id !== "sample") : [...current, "sample"])}>
              <p className="text-sm">
                {sampleComplete
                  ? "On — the complete sample floor is on your shelf."
                  : legacyPieces.length && !samplePieces.length
                    ? "An older sample is on your shelf."
                    : sampleOn
                      ? "On — part of the sample floor is on your shelf."
                      : "Off — no sample pieces on your shelf."}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {legacyPieces.length && !samplePieces.length
                  ? `${legacyPieces.length} pieces from the first, smaller sample floor (${legacyPieces.map((piece) => piece.name).join(", ")}). That sample was loaded before samples were tagged, so no button could find it again. Updating replaces those pieces with the complete set — your own pieces are never touched.`
                  : sampleOn
                    ? `${samplePieces.length + legacyPieces.length} example ${samplePieces.length + legacyPieces.length === 1 ? "piece" : "pieces"} and ${sampleAds.length} example ad ${sampleAds.length === 1 ? "record" : "records"} fill Main, History, Statistics and the Advisor so you can see how everything behaves. Only the examples ever change here — your own pieces and ads stay exactly as they are.`
                    : `Example pieces fill Main, History, Statistics and the Advisor so you can see how everything behaves — ${sampleSet.pieces} pieces and ${sampleSet.ads} ad records, with sales and dates spread across the year. Your own pieces are never touched, and you can turn the sample off here anytime.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!sampleComplete ? (
                  <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" onClick={loadSampleFloor}>
                    {sampleOn ? "Update to the complete sample floor" : "Load the sample floor"}
                  </button>
                ) : null}
                {sampleOn ? (
                  <button type="button" className="press h-11 rounded-full border border-danger px-4 text-sm text-danger" onClick={() => setSampleAsk(true)}>
                    Remove sample floor
                  </button>
                ) : null}
              </div>
            </SettingFold>
            <SettingFold title="Security" icon={<ShieldCheck className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("security")} onToggle={() => setOpenSettings((current) => current.includes("security") ? current.filter((id) => id !== "security") : [...current, "security"])}>
              <FingerprintControl />
            </SettingFold>
            <SettingFold title="Remove data" icon={<Trash2 className="size-[18px]" strokeWidth={1.75} />} open={openSettings.includes("remove")} onToggle={() => setOpenSettings((current) => current.includes("remove") ? current.filter((id) => id !== "remove") : [...current, "remove"])}>
              <p className="mb-3 text-xs leading-relaxed text-muted">Choose what to take off the shelf. Nothing is removed until you confirm.</p>
              <div className="space-y-1">
                {wipeRows.map((row) => {
                  const on = wipe.includes(row.id);
                  const empty = row.count === 0;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={empty}
                      onClick={() => setWipe((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))}
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm ${empty ? "text-faint" : "press text-ink"}`}
                    >
                      <span className={`grid size-4 shrink-0 place-items-center rounded border ${on && !empty ? "border-danger bg-danger-soft text-danger" : "border-line bg-canvas"}`}>
                        {on && !empty ? <Check className="size-3" strokeWidth={2.75} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">{row.label}</span>
                      <span className="tabular-nums text-muted">{row.count}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={!wipePicked.length}
                onClick={() => setWipeAsk(true)}
                className="press mt-3 h-11 rounded-full border border-danger px-4 text-sm text-danger disabled:opacity-40"
              >
                Remove selected
              </button>
            </SettingFold>
          </div>
          <div className="mt-2 space-y-2">
            <AccountCard />
            <SignOutCard />
          </div>
          <p className="mt-4 pb-1 text-center text-xs text-faint">Ventory · Version {APP_VERSION}</p>
        </Overlay>
      ) : null}

      {sampleAsk ? (
        <Overlay onClose={() => setSampleAsk(false)}>
          <p className="font-display text-2xl">Remove the sample floor?</p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {samplePieces.length + legacyPieces.length} example {samplePieces.length + legacyPieces.length === 1 ? "piece" : "pieces"} and {sampleAds.length} example ad {sampleAds.length === 1 ? "record" : "records"} go. Only the examples — your own pieces and ads stay exactly as they are, and you can load the sample floor again whenever you like, right here in Settings.
            {legacyPieces.length ? ` The older pieces it removes are: ${legacyPieces.map((piece) => piece.name).join(", ")}.` : ""}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className="press h-11 rounded-full border border-danger bg-danger-soft px-4 text-sm font-medium text-danger"
              onClick={() => {
                void removeSamples().then((next) => {
                  setPieces(next.pieces);
                  setAds(next.ads);
                  setSampleAsk(false);
                  setNotice(`Removed ${next.removedPieces} example ${next.removedPieces === 1 ? "piece" : "pieces"}`);
                }).catch((err: unknown) => {
                  setSampleAsk(false);
                  setNotice(err instanceof Error ? err.message : "Could not remove the sample floor");
                });
              }}
            >
              Remove
            </button>
            <button type="button" className="press h-11 rounded-full border border-line px-4 text-sm" onClick={() => setSampleAsk(false)}>Cancel</button>
          </div>
        </Overlay>
      ) : null}

      {wipeAsk ? (
        <Overlay onClose={() => { if (!wiping) setWipeAsk(false); }}>
          <p className="font-display text-2xl">Remove this?</p>
          <ul className="mt-3 space-y-1 text-sm">
            {wipePicked.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span>{row.label}</span>
                <span className="tabular-nums text-muted">{row.count}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-muted">Only what is listed. Theme, account, and everything unchecked stay. This cannot be undone here.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" disabled={wiping} className="press h-11 rounded-full border border-danger bg-danger-soft px-4 text-sm font-medium text-danger disabled:opacity-40" onClick={commitWipe}>{wiping ? "Removing…" : "Remove"}</button>
            <button type="button" disabled={wiping} className="press h-11 rounded-full border border-line px-4 text-sm" onClick={() => setWipeAsk(false)}>Cancel</button>
          </div>
        </Overlay>
      ) : null}
    </main>
  );
}

function readStatList(key: string) {
  try {
    if (typeof localStorage === "undefined") return [];
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function barsOf(pieces: Piece[], key: (piece: Piece) => string) {
  const map = new Map<string, number>();
  for (const piece of pieces) {
    const label = key(piece).trim() || "Unlabeled";
    map.set(label, (map.get(label) ?? 0) + piece.qty);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function shortMoney(cents: number) {
  const amount = Math.abs(cents) / 100;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${Math.round(amount)}`;
}

function SalesBoard({ title, rows, bare }: { title: string; rows: SaleLine[]; bare?: boolean }) {
  return (
    <div className={bare ? "" : "framed mt-4 rounded-3xl bg-panel p-4"}>
      {bare ? null : <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>}
      {rows.length === 0 ? <p className={`${bare ? "" : "mt-3 "}text-sm text-muted`}>No sales to compare yet.</p> : bare ? (
        <>
          <div className="mb-2 flex items-center gap-4 text-[11px] text-muted" aria-hidden>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full" style={{ background: `color-mix(in srgb, var(--v-muted) 42%, var(--v-panel-2))` }} />Came in</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full" style={{ background: litTone("#5f8f72") }} />Left after cost</span>
          </div>
          <ul className="border-t border-line">
            {rows.map((row, index) => {
              const peak = Math.max(1, ...rows.map((r) => r.revenue));
              const keptShare = row.costedRevenue ? row.costedProfit! / row.costedRevenue : null;
              const kept = keptShare == null ? 0 : Math.max(0, Math.min(1, keptShare));
              const green = litTone("#5f8f72");
              return (
                <li key={row.name} className="row-in border-b border-line py-2.5 last:border-b-0" style={{ animationDelay: `${Math.min(index * 35, 350)}ms` }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm text-ink">{row.name}</span>
                    <span className={`shrink-0 font-display text-lg leading-none tabular-nums ${row.profit < 0 ? "text-danger" : ""}`}>{cash(row.profit)}</span>
                  </div>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                    <span className="bar-fill flex h-full overflow-hidden rounded-full" style={{ width: `${Math.max(3, (row.revenue / peak) * 100)}%`, background: `color-mix(in srgb, var(--v-muted) 42%, var(--v-panel-2))`, animationDelay: `${Math.min(index * 35, 350)}ms` }}>
                      <span className="lit-bar block h-full rounded-full" style={{ width: `${kept * 100}%`, background: row.profit < 0 ? "var(--v-danger)" : green, ["--glow" as string]: green }} />
                    </span>
                  </span>
                  <span className="mt-1 block text-xs tabular-nums text-muted">{row.count} sold · {cash(row.revenue)} in{keptShare != null ? ` · ${Math.round(keptShare * 100)}% kept` : row.revenue > 0 ? " · cost not entered" : ""}{row.unpriced ? ` · ${row.unpriced} with no price` : ""}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <div className={`${bare ? "" : "mt-3 "}grid grid-cols-[1fr_2.75rem_4.75rem_4.75rem] gap-2 border-b border-line pb-2 text-[10px] font-medium tracking-widest text-faint uppercase`}>
            <span>Product</span>
            <span className="text-right">Sold</span>
            <span className="text-right">In</span>
            <span className="text-right">Left</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((row, index) => (
              <li key={row.name} className="row-in grid grid-cols-[1fr_2.75rem_4.75rem_4.75rem] items-baseline gap-2 py-2 text-sm" style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}>
                <span className="min-w-0">
                  <span className="block">{row.name}</span>
                  {row.unpriced ? <span className="block text-[10px] text-muted">{row.unpriced} no price</span> : null}
                </span>
                <span className="text-right tabular-nums">{row.count}</span>
                <span className="text-right tabular-nums">{money(row.revenue)}</span>
                <span className={`text-right tabular-nums ${row.profit < 0 ? "text-danger" : ""}`}>{money(row.profit)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Ring({ title, parts, bare }: { title: string; parts: { label: string; value: number; color: string }[]; bare?: boolean }) {
  const shown = parts.filter((part) => part.value > 0).map((part) => ({ ...part, color: litTone(part.color) }));
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  const radius = 42;
  const turn = 2 * Math.PI * radius;
  let walked = 0;
  return (
    <div className={bare ? "" : "rounded-3xl border border-line bg-panel p-4"}>
      {bare ? null : <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>}
      {total === 0 ? <p className={`${bare ? "" : "mt-3 "}text-sm text-muted`}>Nothing to measure yet.</p> : (
        <div className={`${bare ? "" : "mt-3 "}flex items-center gap-4`}>
          <div className="relative size-24 shrink-0">
            <svg viewBox="0 0 120 120" className="size-24 -rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--v-panel-2)" strokeWidth="12" />
              {shown.map((part) => {
                const gap = shown.length > 1 ? 3 : 0;
                const length = Math.max(1, (part.value / total) * turn - gap);
                // 1.0.6: the sweep is timed by arc position — each segment
                // starts when the sweep reaches it and grows for its share
                // of an 800ms turn, settling on the dash set below.
                const delay = Math.round((walked / turn) * 800);
                const duration = Math.max(60, Math.round((length / turn) * 800));
                const slice = (
                  <circle
                    key={part.label}
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={part.color}
                    strokeWidth="12"
                    strokeDasharray={`${length} ${turn - length}`}
                    strokeDashoffset={-walked}
                    className="ring-arc"
                    style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }}
                  />
                );
                walked += length + gap;
                return slice;
              })}
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <p className="font-display text-xl tabular-nums">{total}</p>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {shown.map((part) => (
              <li key={part.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: part.color }} />
                  <span>{part.label}</span>
                </span>
                <span className="tabular-nums text-muted">{part.value} · {Math.round((part.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Columns({ title, rows, empty }: { title: string; rows: { label: string; value: number }[]; empty?: string }) {
  const shown = rows.filter((row) => row.value > 0);
  const peak = Math.max(1, ...shown.map((row) => row.value));
  return (
    <div className="rounded-3xl border border-line bg-panel p-4">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>
      {shown.length === 0 ? <p className="mt-3 text-sm text-muted">{empty ?? "Nothing to measure yet."}</p> : (
        <ul className="mt-3 space-y-2.5">
          {shown.map((row, index) => (
            <li key={row.label} className="row-in flex items-center gap-3 text-sm" style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}>
              <span className="w-24 min-w-0 shrink-0 truncate text-muted">{row.label}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                <span className="bar-fill block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.round((row.value / peak) * 100))}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ViewBar({
  face,
  cols,
  onFace,
  onCols,
  kinds,
  kind,
  open,
  onToggle,
  onKind,
}: {
  face: Face;
  cols: 2 | 3 | 4;
  onFace: (face: Face) => void;
  onCols: (cols: 2 | 3 | 4) => void;
  kinds: { id: string; label: string }[];
  kind: string;
  open: boolean;
  onToggle: () => void;
  onKind: (id: string) => void;
}) {
  return (
    <div className="relative mt-3 flex items-center gap-4">
      <RippleButton
        aria-label="Filter products"
        aria-expanded={open}
        onClick={onToggle}
        className={`press grid size-10 shrink-0 place-items-center rounded-2xl border ${kind !== "all" ? "border-accent bg-accent text-accent-ink" : "border-line bg-canvas text-ink"}`}
      >
        <Funnel className="size-4" strokeWidth={1.75} />
      </RippleButton>
      <div className="grid h-10 min-w-0 flex-1 grid-cols-4 rounded-2xl border border-line bg-canvas p-0.5">
        {([
          ["large", "Large", Rows2],
          ["medium", "Medium", RectangleHorizontal],
          ["list", "List", List],
          ["grid", cols === 2 ? "Grid" : `Grid ×${cols}`, LayoutGrid],
        ] as const).map(([id, label, Icon]) => {
          const on = face === id;
          return (
            <RippleButton
              key={id}
              aria-pressed={on}
              className={`press flex min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-[11px] ${on ? "bg-panel text-accent" : "text-muted"}`}
              onClick={() => {
                if (id === "grid" && face === "grid") {
                  onCols(cols === 4 ? 2 : ((cols + 1) as 2 | 3 | 4));
                  return;
                }
                onFace(id);
              }}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{label}</span>
            </RippleButton>
          );
        })}
      </div>
      {open ? (
        <div className="absolute top-full left-0 z-30 mt-2 w-52 rounded-2xl border border-line bg-panel p-1.5">
          <RippleButton
            aria-pressed={kind === "all"}
            className={`press block h-10 w-full rounded-xl px-3 text-left text-sm ${kind === "all" ? "bg-accent-soft" : ""}`}
            onClick={() => onKind("all")}
          >
            All products
          </RippleButton>
          {kinds.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No product types yet.</p> : kinds.map((item) => (
            <RippleButton
              key={item.id}
              aria-pressed={kind === item.id}
              className={`press block h-10 w-full truncate rounded-xl px-3 text-left text-sm ${kind === item.id ? "bg-accent-soft" : ""}`}
              onClick={() => onKind(item.id)}
            >
              {item.label}
            </RippleButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HistoryChip({
  label,
  value,
  hint,
  icon: Icon,
  tone: rawTone,
  pressed,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Package;
  tone: string;
  pressed: boolean;
  onClick: () => void;
}) {
  const tone = litTone(rawTone);
  // The Summary tiles' material (1.2.4) comes to History (1.2.5, Oscar's word):
  // the light pools at the left where the disc sits, the border is an aura, the
  // disc is the same small jewel and the label wears the card's colour. Same
  // box, same press behaviour; only the material changed.
  return (
    <RippleButton
      ink={tone}
      aria-pressed={pressed}
      onClick={onClick}
      className="press flex items-center gap-3 rounded-2xl border px-3 py-3 text-left"
      style={{
        background: `linear-gradient(100deg, color-mix(in srgb, ${tone} ${pressed ? 40 : 30}%, var(--v-panel)) 0%, color-mix(in srgb, ${tone} ${pressed ? 22 : 13}%, var(--v-panel)) 55%, var(--v-panel) 135%)`,
        borderColor: pressed ? tone : `color-mix(in srgb, ${tone} 55%, transparent)`,
        boxShadow: `${pressed ? `inset 0 0 0 1.5px ${tone}, ` : ""}inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 12px 24px -14px ${tone}`,
        color: "var(--v-ink)",
      }}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{
          background: `linear-gradient(145deg, color-mix(in srgb, ${tone} 82%, #ffffff) 0%, ${tone} 55%, color-mix(in srgb, ${tone} 76%, #000000) 100%)`,
          color: toneInk("#f6f3ec"),
          boxShadow: `0 6px 14px -6px ${tone}, inset 0 1px 0 rgba(255, 255, 255, 0.35)`,
        }}
      >
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-[11px] font-semibold tracking-[0.14em] uppercase"
          style={{ color: `color-mix(in srgb, ${tone} 72%, var(--v-ink))` }}
        >
          {label}
        </span>
        <span className="block truncate font-display text-2xl leading-none tabular-nums">{value}</span>
        <span className="mt-1 block truncate text-[11px] text-muted">{hint}</span>
      </span>
    </RippleButton>
  );
}

function Summary({
  label,
  value,
  hint,
  icon: Icon,
  tone: rawTone,
  pressed,
  dimmed,
  onClick,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Package;
  tone: string;
  pressed: boolean;
  dimmed: boolean;
  onClick: () => void;
}) {
  // Faro's Central logic (its .lenses): with nothing picked, every chip wears
  // its colour at full beauty; picking one keeps it lit (deeper wash + ring)
  // and the rest humble themselves — opacity .62, saturate(.7).
  // Presentation polish (1.2.4, Oscar's word: colour, polished): the flat wash
  // became a gradient that pools its light at the top and settles into the
  // panel at the value; the border softens to an aura of the tone instead of a
  // hard outline; the icon disc is a small jewel — gradient, top highlight and
  // a coloured glow — and the label wears its tile's colour lifted toward ink.
  // Same box, same lens behaviour; only the material changed.
  const tone = litTone(rawTone);
  return (
    <RippleButton
      ink={tone}
      aria-pressed={pressed}
      onClick={onClick}
      className="press sum-chip flex min-h-32 flex-col rounded-3xl border px-4 py-3.5 text-left"
      style={{
        background: `linear-gradient(155deg, color-mix(in srgb, ${tone} ${pressed ? 40 : 30}%, var(--v-panel)) 0%, color-mix(in srgb, ${tone} ${pressed ? 22 : 13}%, var(--v-panel)) 55%, var(--v-panel) 135%)`,
        borderColor: pressed ? tone : `color-mix(in srgb, ${tone} 55%, transparent)`,
        boxShadow: `${pressed ? `inset 0 0 0 1.5px ${tone}, ` : ""}inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 12px 24px -14px ${tone}`,
        opacity: dimmed ? 0.62 : undefined,
        filter: dimmed ? "saturate(.7)" : undefined,
      }}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className="text-[11px] font-semibold tracking-[0.16em] uppercase"
          style={{ color: `color-mix(in srgb, ${tone} 72%, var(--v-ink))` }}
        >
          {label}
        </span>
        <span
          className="grid size-7 place-items-center rounded-full"
          style={{
            background: `linear-gradient(145deg, color-mix(in srgb, ${tone} 82%, #ffffff) 0%, ${tone} 55%, color-mix(in srgb, ${tone} 76%, #000000) 100%)`,
            color: toneInk("#f6f3ec"),
            boxShadow: `0 6px 14px -6px ${tone}, inset 0 1px 0 rgba(255, 255, 255, 0.35)`,
          }}
        >
          <Icon className="size-3.5" strokeWidth={1.75} />
        </span>
      </span>
      <span className="mt-auto pt-3 font-display text-3xl leading-none tabular-nums">{value}</span>
      <span className="mt-2 truncate text-xs text-muted">{hint}</span>
    </RippleButton>
  );
}

function SettingFold({ title, icon, open, onToggle, children }: { title: string; icon: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <button type="button" aria-expanded={open} onClick={onToggle} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</span>
        <span className="min-w-0 flex-1 text-[15px] font-medium">{title}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={1.75} />
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

/* Statistics desk, designer's pass (1.0.13): the desk read oversized, so its
   scale was refined in place — cards p-5 → p-4, the ring 112 → 96px with a
   slimmer 12-unit stroke (its dash geometry is untouched: radius 42, turn
   264, so ring-grow settles on the same arcs), lead figures 2.6rem → 4xl,
   Exact tiles 2xl → xl, the Performance stage h-40/h-24 → h-36/h-20, fold
   heads text-lg → text-base. Nothing moved house: same rounded-3xl cards,
   same tones, same words, same numbers — only quieter. Arrival completes
   Faro's register where it was missing: the desk itself rises like a card
   (.piece), an opened fold's body rises (.row-in), and the Columns and Ads
   rows rise with the same stagger SalesBoard rows already used; bars, columns
   and ring arcs kept their 1.0.6 grows and nothing new counts or fades. */
function StatFold({ title, open, pinned, onToggle, onPin, line, children, shot }: { title: string; open: boolean; pinned: boolean; onToggle: () => void; onPin: () => void; line?: string; children: ReactNode; shot?: string }) {
  return (
    <section data-shot={shot} className="rounded-3xl border border-line bg-panel">
      <div className="flex items-center gap-1 pr-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className="press flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left">
          <ChevronDown className={`size-4 shrink-0 self-center text-muted transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base leading-tight">{title}</span>
            {!open && line ? <span className="mt-0.5 block text-xs leading-snug text-muted">{line}</span> : null}
          </span>
        </button>
        <button type="button" aria-label={pinned ? "Unpin" : "Pin open"} aria-pressed={pinned} onClick={onPin} className={`press grid size-8 shrink-0 place-items-center self-center rounded-full ${pinned ? "text-accent" : "text-muted"}`}>
          <Pin className="size-4" strokeWidth={1.75} fill={pinned ? "currentColor" : "none"} />
        </button>
      </div>
      {open ? <div className="row-in px-4 pb-3">{line ? <p className="mb-3 text-sm leading-relaxed text-muted">{line}</p> : null}{children}</div> : null}
    </section>
  );
}

function Exact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-widest text-faint uppercase">{label}</p>
      <p className="mt-1 font-display text-xl leading-none tabular-nums">{value}</p>
    </div>
  );
}

/* The two lead figures settle (1.0.6): on first view the number climbs from
   zero to its exact cents over 700ms of the house ease, and the final frame
   hands back the caller's own string — so the settled text is byte-for-byte
   what the static figure always showed, never a re-format of it. Zero never
   climbs (an empty floor rests at $0.00, no pointless count-up), reduced
   motion never climbs, and a later data change snaps to the new value
   instead of replaying. Presentation only: the value itself is untouched. */
function useCountUp(cents: number | undefined, finalText: string) {
  const [text, setText] = useState(finalText);
  const first = useRef(true);
  useEffect(() => {
    if (!first.current) {
      setText(finalText);
      return;
    }
    first.current = false;
    if (cents == null || cents === 0) {
      setText(finalText);
      return;
    }
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(finalText);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 700);
      if (t >= 1) {
        setText(finalText);
        return;
      }
      const eased = 1 - Math.pow(1 - t, 3);
      setText(money(Math.round(cents * eased)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents, finalText]);
  return text;
}

/* Faro's figure treatment: the two numbers a fold turns on get the big serif,
   so the eye lands on them before the supporting grid. Same values, new rank. */
function Figure({ label, value, negative, cents }: { label: string; value: string; negative?: boolean; cents?: number }) {
  const shown = useCountUp(cents, value);
  return (
    <div className="col-span-2 rounded-2xl border border-line bg-canvas px-4 py-3">
      <p className="text-[10px] font-medium tracking-widest text-faint uppercase">{label}</p>
      <p className={`mt-1.5 font-display text-4xl leading-none tracking-tight tabular-nums ${negative ? "text-danger" : ""}`}>{shown}</p>
    </div>
  );
}

function Stat({ label, value, pressed, onClick }: { label: string; value: string; pressed?: boolean; onClick?: () => void }) {
  const className = `rounded-2xl border px-3 py-3 text-left ${pressed ? "border-accent bg-accent-soft" : "border-line bg-panel"} ${onClick ? "press w-full" : ""}`;
  const body = (
    <>
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 font-display text-xl tabular-nums">{value}</p>
    </>
  );
  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function Performance({ pieces, focus }: { pieces: Piece[]; focus?: "revenue" | "profit" }) {
  const [grain, setGrain] = useState<Grain>("month");
  const rows = periodsOf(pieces, grain);
  const peak = Math.max(1, ...rows.flatMap((row) => [Math.max(0, row.revenue), Math.max(0, row.profit)]));
  const shown = (row: { revenue: number; profit: number }) => (focus === "revenue" ? [["In", row.revenue]] : focus === "profit" ? [["Left", row.profit]] : [["In", row.revenue], ["Left", row.profit]]) as [string, number][];
  return (
    <div className="rounded-3xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-faint uppercase">{focus === "revenue" ? "Revenue" : focus === "profit" ? "Profit" : "Performance"}</p>
        <div className="grid w-44 grid-cols-3 gap-1">
          {(["week", "month", "year"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={grain === id}
              onClick={() => setGrain(id)}
              className={`press h-8 rounded-full text-xs capitalize ${grain === id ? "bg-accent text-accent-ink" : "text-muted"}`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className="mt-4 text-sm text-muted">No dated sales yet.</p> : (
        <>
          {focus ? null : (
            <div className="mt-3 flex gap-4 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: litTone("#b08a3e") }} /> In</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: litTone("#5f8f72") }} /> Left</span>
            </div>
          )}
          <div className="mt-3 overflow-x-auto">
            <div className="flex h-36 items-end gap-3" style={{ minWidth: rows.length > 5 ? rows.length * 56 : "100%" }}>
              {rows.map((row, index) => {
                const series = shown(row);
                const headline = series[series.length - 1]?.[1] ?? 0;
                return (
                  <div key={row.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    <span className={`text-[10px] tabular-nums ${headline < 0 ? "text-danger" : "text-muted"}`}>{headline < 0 ? "−" : ""}{shortMoney(headline)}</span>
                    <div className="mt-1 flex h-20 w-full items-end justify-center gap-1">
                      {series.map(([label, amount]) => (
                        <div key={label} className="flex h-full w-4 flex-col justify-end overflow-hidden rounded-md bg-panel-2">
                          <div
                            className="col-fill w-full rounded-md"
                            style={{
                              height: `${Math.max(amount > 0 ? 8 : 0, Math.round((Math.max(0, amount) / peak) * 100))}%`,
                              background: label === "Left" ? litTone("#5f8f72") : litTone("#b08a3e"),
                              animationDelay: `${Math.min(index * 35, 210)}ms`,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <span className="mt-1.5 w-full truncate text-center text-[10px] text-muted">{row.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LatestSales({ pieces, onOpen }: { pieces: Piece[]; onOpen: (piece: Piece) => void }) {
  const latest = pieces.filter(isSale).slice().sort((a, b) => (b.soldOn || "").localeCompare(a.soldOn || "")).slice(0, 6);
  if (!latest.length) return <p className="text-sm text-muted">No sales yet.</p>;
  return (
    <ul className="space-y-2">
      {latest.map((piece) => {
        const profit = profitOf(piece)?.profit ?? null;
        return (
          <li key={piece.id}>
            <button type="button" onClick={() => onOpen(piece)} className="press flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{piece.name}</span>
                <span className="block text-xs text-muted">{piece.soldOn ?? "No date"}{piece.usSize ? ` · US ${halfSize(piece.usSize)}` : ""}</span>
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                <span className="block">{piece.saleCents == null ? "No price" : money(piece.saleCents)}</span>
                <span className={`block text-xs ${profit != null && profit < 0 ? "text-danger" : "text-muted"}`}>{profit == null ? "—" : `${profit >= 0 ? "+" : "−"}${money(Math.abs(profit))}`}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Swap<T extends string>({
  value,
  onChange,
  options,
  className = "",
  fill = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { id: T; label: string }[];
  className?: string;
  fill?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ x: 0, w: 0, ready: false });

  useLayoutEffect(() => {
    const root = row.current;
    const button = root?.querySelector<HTMLButtonElement>(`[data-id="${value}"]`);
    if (!root || !button) return;
    setBox({ x: button.offsetLeft, w: button.offsetWidth, ready: true });
  }, [value, options]);

  return (
    <div ref={row} className={`relative flex gap-1 overflow-x-auto rounded-full bg-panel-2 p-1 ${className}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-full bg-panel"
        style={{
          width: box.w,
          transform: `translateX(${box.x}px)`,
          transition: box.ready ? "transform 250ms cubic-bezier(0.22, 1, 0.36, 1), width 250ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      />
      {options.map((option) => (
        <RippleButton
          key={option.id}
          data-id={option.id}
          nav={option.id}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`press z-10 h-9 rounded-full px-3 text-sm ${fill ? "flex-1" : "shrink-0"} ${value === option.id ? "text-ink" : "text-muted"}`}
        >
          {option.label}
        </RippleButton>
      ))}
    </div>
  );
}

function PieceCard({
  piece,
  layout,
  iconic = false,
  onOpen,
  onStatus,
  onDelete,
  onProblem,
}: {
  piece: Piece;
  layout: Layout;
  iconic?: boolean;
  onOpen: () => void;
  onStatus: (status: Status) => void;
  onDelete: () => void;
  onProblem: (problem: string) => void;
}) {
  const [flags, setFlags] = useState(false);
  const held = daysHeld(piece.receivedOn, piece.soldOn);
  const problem = PROBLEMS.find((item) => item.id === piece.problem);
  const Portrait = typeIcon(piece);
  const profit = unitProfitCents(piece);
  const actions: { key: string; label: string; icon: typeof Check; onClick: () => void; tone?: "accent" | "danger" }[] = [
    { key: "sold", label: "Sold", icon: BadgeCheck, onClick: () => onStatus("sold"), tone: piece.status === "sold" ? "accent" : undefined },
    { key: "incoming", label: "Coming", icon: Truck, onClick: () => onStatus("incoming"), tone: piece.status === "incoming" ? "accent" : undefined },
    { key: "problem", label: "Problem", icon: CircleAlert, onClick: () => setFlags((open) => !open), tone: piece.problem ? "danger" : undefined },
    { key: "delete", label: "Delete", icon: Trash2, onClick: onDelete, tone: "danger" },
  ];
  const sizeLine = [piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "", piece.usSize ? `US ${halfSize(piece.usSize)}` : ""].filter(Boolean).join(" · ");
  const frame = !iconic && piece.photo ? (
    <img src={piece.photo} alt="" className="size-full object-cover" />
  ) : (
    <Portrait className={layout === "g4" ? "size-4" : "size-6"} strokeWidth={1.5} />
  );

  if (layout === "medium") {
    return (
      <li>
        <button type="button" onClick={onOpen} className="framed press flex w-full items-center gap-3 rounded-3xl bg-panel p-3 text-left">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-canvas text-muted">{frame}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-lg leading-tight">{piece.name}</span>
            <span className="mt-0.5 block truncate text-xs text-muted">{sizeLine || piece.category || "Piece"}</span>
            <span className="mt-2 flex items-baseline justify-between gap-2 text-xs tabular-nums">
              <span>{money(piece.costCents)}</span>
              <span className="font-medium">{money(piece.askCents)}</span>
              <span className="text-muted">{held == null ? "—" : `${held}d`}</span>
            </span>
          </span>
        </button>
      </li>
    );
  }

  if (layout === "list") {
    return (
      <li>
        <button type="button" onClick={onOpen} className="framed press flex w-full items-center gap-3 rounded-2xl bg-panel px-3 py-2 text-left">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-canvas text-muted">{frame}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{piece.name}</span>
            <span className="block truncate text-xs text-muted">{sizeLine || piece.category || "Piece"}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-display text-base tabular-nums">{money(piece.askCents)}</span>
            <span className="block text-[11px] text-muted">{held == null ? STATUS_LABEL[piece.status] : `${held}d`}</span>
          </span>
        </button>
      </li>
    );
  }

  if (layout !== "card") {
    const dense = layout === "g4" || layout === "g3";
    return (
      <li>
        <button type="button" onClick={onOpen} className="framed press block w-full overflow-hidden rounded-2xl bg-panel text-left">
          <span className="grid aspect-square place-items-center overflow-hidden bg-canvas text-muted">{frame}</span>
          <span className={`block min-w-0 ${dense ? "p-1.5" : "p-2.5"}`}>
            <span className={`block truncate font-medium ${layout === "g4" ? "text-[11px] leading-tight" : "text-sm"}`}>{piece.name}</span>
            {layout === "g2" ? <span className="block truncate text-[11px] text-muted">{sizeLine || piece.category || "Piece"}</span> : null}
            <span className={`mt-0.5 block truncate font-display tabular-nums ${layout === "g4" ? "text-[11px]" : "text-sm"}`}>{money(piece.askCents)}</span>
          </span>
        </button>
      </li>
    );
  }

  return (
    <li className="piece framed overflow-hidden rounded-3xl bg-panel">
      <div className="flex items-start gap-3 p-3.5">
        <button type="button" onClick={onOpen} className="relative grid size-[4.75rem] shrink-0 place-items-center overflow-hidden rounded-[1.25rem] bg-canvas text-muted">
          {piece.photo ? <img src={piece.photo} alt="" className="size-full object-cover" /> : <Portrait className="size-6" strokeWidth={1.5} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button type="button" className="min-w-0 text-left" onClick={onOpen}>
              <p className="truncate font-display text-xl leading-tight">{piece.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                <span>{piece.category || "Piece"}</span>
                {piece.place === "home" ? <HomeIcon className="size-3.5" strokeWidth={1.75} /> : null}
                {piece.place === "car" ? <Car className="size-3.5" strokeWidth={1.75} /> : null}
              </p>
            </button>
            {piece.status === "available" ? (
              <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-accent px-3 text-sm font-medium text-accent-ink">
                <Check className="size-3.5" strokeWidth={2.25} />
                Available
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onStatus("available")}
                className="press inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-accent bg-accent px-3 text-sm font-medium text-accent-ink"
              >
                <Check className="size-3.5" strokeWidth={2.25} />
                Available
              </button>
            )}
          </div>
          <p className="mt-2 text-sm tabular-nums">
            {[piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "", piece.usSize ? `US ${halfSize(piece.usSize)}` : ""].filter(Boolean).join(" · ") || "No size"}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-3.5">
        <figure className="rounded-2xl bg-canvas px-3 py-2.5">
          <figcaption className="text-[10px] tracking-wide text-faint uppercase">Cost</figcaption>
          <p className="mt-0.5 font-display text-lg tabular-nums">{money(piece.costCents)}</p>
        </figure>
        <figure className="rounded-2xl bg-canvas px-3 py-2.5">
          <figcaption className="text-[10px] tracking-wide text-faint uppercase">Asking</figcaption>
          <p className="mt-0.5 font-display text-lg tabular-nums">{money(piece.askCents)}</p>
        </figure>
        <figure className="rounded-2xl bg-canvas px-3 py-2.5">
          <figcaption className="flex items-center gap-1 text-[10px] tracking-wide text-faint uppercase">
            <Clock className="size-3" strokeWidth={1.75} />
            Days
          </figcaption>
          <p className="mt-0.5 font-display text-lg tabular-nums">{held == null ? "—" : held}</p>
        </figure>
      </div>
      {profit != null || piece.notes || problem || (isSale(piece) && piece.saleCents == null) ? (
        <p className="mt-2 px-3.5 text-sm text-muted">
          {piece.saleCents != null ? `Sold ${money(piece.saleCents)} · ${profit != null && profit >= 0 ? "+" : "−"}${money(Math.abs(profit ?? 0))}` : ""}
          {isSale(piece) && piece.saleCents == null ? "No sale price" : ""}
          {problem ? <span className="text-danger">{piece.saleCents != null || (isSale(piece) && piece.saleCents == null) ? " · " : ""}{problem.label}</span> : null}
          {piece.notes ? ` · ${piece.notes}` : ""}
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-4 border-t border-line">
        {actions.map((action) => {
          const Icon = action.icon;
          const plate = action.tone === "accent" ? "bg-accent text-accent-ink" : action.tone === "danger" ? "border border-danger/40 text-danger" : "border border-line text-ink";
          const labelTone = action.tone === "danger" ? "text-danger" : "text-ink";
          return (
            <button key={action.key} type="button" onClick={action.onClick} className="press flex flex-col items-center gap-1.5 py-3">
              <span className={`grid size-9 place-items-center rounded-full ${plate}`}>
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className={`text-[11px] leading-none font-medium ${labelTone}`}>{action.label}</span>
            </button>
          );
        })}
      </div>
      {flags ? (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3.5">
          {PROBLEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={piece.problem === item.id}
              className={`press h-9 rounded-full border px-3 text-sm ${piece.problem === item.id ? "border-danger text-danger" : "border-line"}`}
              onClick={() => onProblem(piece.problem === item.id ? "" : item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function adSpan(ad: Ad) {
  if (!ad.startedOn) return null;
  return daysHeld(ad.startedOn, ad.endedOn || todayISO());
}

function soldInWindow(ad: Ad, pieces: Piece[]) {
  if (!ad.startedOn) return false;
  const end = ad.endedOn || "9999-12-31";
  return pieces.some((piece) => piece.name.trim().toLowerCase() === ad.product.trim().toLowerCase() && !!piece.soldOn && piece.soldOn >= (ad.startedOn ?? "") && piece.soldOn <= end && (piece.status === "sold" || piece.wasSold));
}

function AdBoard({ ads, pieces, bare }: { ads: Ad[]; pieces: Piece[]; bare?: boolean }) {
  const spent = ads.reduce((sum, ad) => sum + ad.spentCents, 0);
  const worked = ads.filter((ad) => ad.worked === "yes").length;
  const missed = ads.filter((ad) => ad.worked === "no").length;
  const days = ads.map(adSpan).filter((value): value is number => value != null);
  const average = days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null;
  return (
    <div className={bare ? "" : "rounded-3xl border border-line bg-panel p-4"}>
      {bare ? null : <p className="text-xs font-medium tracking-wide text-faint uppercase">Ads</p>}
      {ads.length === 0 ? <p className="text-sm text-muted">No promotion logged yet. Record it from History.</p> : (
        <>
          <p className={`${bare ? "" : "mt-2 "}font-display text-3xl tabular-nums`}>{money(spent)}</p>
          <p className="mt-1 text-sm text-muted">{worked} worked · {missed} did not · {average == null ? "no dates" : `${average}d average`}</p>
          <ul className="mt-3 space-y-2.5">
            {ads.map((ad, index) => {
              const span = adSpan(ad);
              return (
                <li key={ad.id} className="row-in flex items-baseline justify-between gap-3 text-sm" style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}>
                  <span className="min-w-0">
                    <span className="block">{ad.product}</span>
                    <span className="block text-xs text-muted">{span == null ? "No dates" : `${span}d`} · {ad.worked === "yes" ? "Worked" : ad.worked === "no" ? "Did not" : "Running"} · {soldInWindow(ad, pieces) ? "Sale landed" : "No sale"}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">{money(ad.spentCents)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function AdsWidget({ ads, pieces, onChange }: { ads: Ad[]; pieces: Piece[]; onChange: (ads: Ad[]) => void }) {
  const tone = litTone("#7d5a86");
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("new");
  const [product, setProduct] = useState("");
  const [amount, setAmount] = useState("");
  const [startedOn, setStartedOn] = useState(todayISO());
  const [endedOn, setEndedOn] = useState("");
  const [worked, setWorked] = useState<Ad["worked"]>("running");
  const spent = ads.reduce((sum, ad) => sum + ad.spentCents, 0);
  const running = ads.filter((ad) => ad.worked === "running");
  const available = [...new Set(pieces.filter((piece) => piece.status === "available").map((piece) => piece.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const choices = product && !available.includes(product) ? [product, ...available] : available;
  const draft: Ad = { id: pick, product, spentCents: dollarsToCents(amount), startedOn: startedOn || null, endedOn: endedOn || null, worked };
  const days = adSpan(draft);
  const landed = soldInWindow(draft, pieces);
  const hint = ads.length === 0 ? "Nothing promoted yet" : running.length === 1 ? `${running[0].product} · still running` : `${running.length} running · ${ads.length} logged`;
  const field = "h-10 w-full rounded-xl border border-line bg-canvas px-3 text-sm outline-none focus:border-accent";

  function load(ad: Ad | null) {
    setPick(ad?.id ?? "new");
    setProduct(ad?.product ?? "");
    setAmount(ad ? (ad.spentCents / 100).toFixed(2) : "");
    setStartedOn(ad?.startedOn ?? todayISO());
    setEndedOn(ad?.endedOn ?? "");
    setWorked(ad?.worked ?? "running");
  }

  return (
    <div className="mt-3">
      <RippleButton
        ink={tone}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="press flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left"
        style={{
          background: `linear-gradient(100deg, color-mix(in srgb, ${tone} ${open ? 40 : 30}%, var(--v-panel)) 0%, color-mix(in srgb, ${tone} ${open ? 22 : 13}%, var(--v-panel)) 55%, var(--v-panel) 135%)`,
          borderColor: open ? tone : `color-mix(in srgb, ${tone} 55%, transparent)`,
          boxShadow: `${open ? `inset 0 0 0 1.5px ${tone}, ` : ""}inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 12px 24px -14px ${tone}`,
        }}
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{
            background: `linear-gradient(145deg, color-mix(in srgb, ${tone} 82%, #ffffff) 0%, ${tone} 55%, color-mix(in srgb, ${tone} 76%, #000000) 100%)`,
            color: toneInk("#f6f3ec"),
            boxShadow: `0 6px 14px -6px ${tone}, inset 0 1px 0 rgba(255, 255, 255, 0.35)`,
          }}
        >
          <Megaphone className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-[11px] font-semibold tracking-[0.14em] uppercase"
            style={{ color: `color-mix(in srgb, ${tone} 72%, var(--v-ink))` }}
          >
            Ads
          </span>
          <span className="block truncate font-display text-2xl leading-none tabular-nums">{money(spent)}</span>
          <span className="mt-1 block truncate text-[11px] text-muted">{hint}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
      </RippleButton>
      {open ? (
        <div className="mt-2 rounded-2xl border border-line bg-panel p-3">
          {ads.length ? (
            <div className="mb-3 flex gap-1.5 overflow-x-auto">
              <RippleButton ink={tone} onClick={() => load(null)} className={`press h-8 shrink-0 rounded-full border px-3 text-xs ${pick === "new" ? "text-[#f6f3ec]" : "border-line text-muted"}`} style={pick === "new" ? { background: tone, borderColor: tone } : undefined}>New</RippleButton>
              {ads.map((ad) => (
                <RippleButton key={ad.id} ink={tone} onClick={() => load(ad)} className={`press h-8 max-w-40 shrink-0 truncate rounded-full border px-3 text-xs ${pick === ad.id ? "text-[#f6f3ec]" : "border-line"}`} style={pick === ad.id ? { background: tone, borderColor: tone } : undefined}>
                  {ad.product}
                </RippleButton>
              ))}
            </div>
          ) : null}
          {choices.length === 0 ? <p className="text-sm text-muted">Nothing available to promote yet.</p> : (
            <>
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] tracking-[0.14em] text-faint uppercase">Available</p>
                {choices.map((name) => {
                  const on = product === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setProduct(name)}
                      className={`press flex h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm ${on ? "" : "border-line"}`}
                      style={on ? { borderColor: tone, background: `color-mix(in srgb, ${tone} 16%, var(--v-panel))` } : undefined}
                    >
                      <span className="truncate">{name}</span>
                      {on ? <Check className="size-4 shrink-0" style={{ color: tone }} strokeWidth={1.75} /> : <span className="size-4 shrink-0 rounded-full border border-line" />}
                    </button>
                  );
                })}
              </div>
              <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Paid" className={`${field} mt-2`} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)} aria-label="Started" className={field} />
                <input type="date" value={endedOn} onChange={(event) => setEndedOn(event.target.value)} aria-label="Ended" className={field} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {([
                  ["running", "Running"],
                  ["yes", "Worked"],
                  ["no", "Did not"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={worked === id} onClick={() => setWorked(id)} className={`press h-9 rounded-full border text-xs ${worked === id ? "text-[#f6f3ec]" : "border-line text-muted"}`} style={worked === id ? { background: tone, borderColor: tone } : undefined}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">{days == null ? "Add a start date." : `${days} ${days === 1 ? "day" : "days"}`} · {product ? (landed ? "A sale landed while it ran." : "No sale in those days.") : "Choose a product."}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="press h-9 rounded-full px-4 text-sm font-medium text-[#f6f3ec] disabled:opacity-40"
                  style={{ background: tone }}
                  disabled={!product.trim()}
                  onClick={() => {
                    const known = new Set(ads.map((ad) => ad.id));
                    void saveAd({ data: { id: pick === "new" ? undefined : pick, product: product.trim(), spentCents: dollarsToCents(amount), startedOn: startedOn || null, endedOn: endedOn || null, worked } }).then((next) => {
                      onChange(next);
                      const made = pick === "new" ? next.find((ad) => !known.has(ad.id)) : next.find((ad) => ad.id === pick);
                      if (made) load(made);
                    });
                  }}
                >
                  {pick === "new" ? "Add" : "Save"}
                </button>
                {pick !== "new" ? (
                  <button type="button" className="press h-9 rounded-full border border-line px-4 text-sm text-muted" onClick={() => void deleteAd({ data: pick }).then((next) => { onChange(next); load(null); })}>
                    Remove
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="veil-in fixed inset-0 z-30 grid place-items-end bg-black/50 p-3 sm:place-items-center" onClick={onClose}>
      <div className="sheet-in max-h-[90dvh] w-full max-w-lg overflow-auto rounded-3xl border border-line bg-canvas p-5" onClick={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Editor({ initial, known = [], focus = null, onClose, onSave, onImport, onTray }: { initial: PieceInput; known?: Piece[]; focus?: AdviceFocus | null; onClose: () => void; onSave: (input: PieceInput) => void; onImport?: (rows: PieceInput[]) => void; onTray?: (payload: TrayPayload) => void }) {
  const [draft, setDraft] = useState(initial);
  const [batch, setBatch] = useState(false);
  const [convertNote, setConvertNote] = useState("");
  const [discardAsk, setDiscardAsk] = useState(false);
  const set = (patch: Partial<PieceInput>) => setDraft((current) => ({ ...current, ...patch }));
  // Closing with unsaved edits asks first; closing clean stays one tap (button audit V-3).
  // The batch tray keeps its own state and closes as before.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const tryClose = () => {
    if (!batch && dirty) setDiscardAsk(true);
    else onClose();
  };
  useEffect(() => {
    if (!focus) return;
    const node = document.getElementById(`editor-${focus}`);
    node?.scrollIntoView({ block: "center" });
    const input = node?.querySelector("input, select, textarea");
    if (input instanceof HTMLElement) input.focus();
  }, [focus]);
  const control = "h-11 w-full rounded-xl border border-line bg-panel px-3 outline-none focus:border-accent";
  return (
    <>
    <Overlay onClose={tryClose}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <p className="font-display text-3xl">{batch ? "Add a batch" : draft.id ? "Edit piece" : "Add a piece"}</p>
        </div>
        {onImport || onTray ? (
          <button
            type="button"
            aria-label={batch ? "Add one piece" : "Add a batch"}
            aria-pressed={batch}
            onClick={() => setBatch((open) => !open)}
            className={`press grid size-11 shrink-0 place-items-center rounded-full border ${batch ? "border-accent bg-accent text-accent-ink" : "border-line"}`}
          >
            <ClipboardPaste className="size-5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      {batch && onTray ? (
        <TrayImport pieces={known} onApply={onTray} onImportCsv={onImport} onClose={onClose} />
      ) : (
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <Field label="Name">
          <input required value={draft.name} onChange={(event) => set({ name: event.target.value })} className={control} />
        </Field>
        <div id="editor-photo">
          <Field label="Photo">
            <div className="flex items-center gap-3">
              {draft.photo ? <img src={draft.photo} alt="" className="size-16 rounded-xl object-cover" /> : <span className="grid size-16 place-items-center rounded-xl border border-dashed border-line"><ImagePlus className="size-5" strokeWidth={1.75} /></span>}
              <label className="press inline-flex h-11 cursor-pointer items-center rounded-full border border-line px-4 text-sm">
                {draft.photo ? "Change photo" : "Add photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    void compressPhoto(file).then((photo) => { if (photo) set({ photo }); });
                  }}
                />
              </label>
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input value={draft.category} onChange={(event) => set({ category: event.target.value })} list="ventory-categories" className={control} />
            <datalist id="ventory-categories">
              {[...new Set(known.map((piece) => piece.category.trim()).filter(Boolean))].map((item) => <option key={item} value={item} />)}
            </datalist>
          </Field>
          <Field label="Subcategory">
            <input value={draft.subcategory} onChange={(event) => set({ subcategory: event.target.value })} list="ventory-subs" placeholder="Chelsea, Combat" className={control} />
            <datalist id="ventory-subs">
              {[...new Set(known.filter((piece) => !draft.category || piece.category.trim().toLowerCase() === draft.category.trim().toLowerCase()).map((piece) => piece.subcategory.trim()).filter(Boolean))].map((item) => <option key={item} value={item} />)}
            </datalist>
          </Field>
        </div>
        <Field id="editor-brand" label="Brand">
          <input value={draft.brand} onChange={(event) => set({ brand: event.target.value })} className={control} />
        </Field>
        <Field label="Status">
          <select value={draft.status} onChange={(event) => set({ status: event.target.value as Status })} className={control}>
            {STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
            {draft.status === "kept" ? <option value="kept">Kept</option> : null}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="System">
            <input value={draft.sizeSystem} onChange={(event) => set({ sizeSystem: event.target.value })} className={control} />
          </Field>
          <Field id="editor-size" label="Size">
            <input value={draft.sizeLabel} onChange={(event) => set({ sizeLabel: event.target.value })} className={control} />
          </Field>
          <Field label="Fit">
            <select value={draft.fit} onChange={(event) => set({ fit: event.target.value })} className={control}>
              <option value="women">Women</option>
              <option value="men">Men</option>
              <option value="unisex">Unisex</option>
            </select>
          </Field>
        </div>
        <div>
          <button
            type="button"
            className="press h-11 w-full rounded-full border border-line text-sm"
            onClick={() => {
              const us = convertToUs(draft.sizeSystem, draft.sizeLabel, draft.fit);
              if (us) {
                set({ usSize: us });
                setConvertNote("");
              } else {
                // Say why, instead of silence (button audit V-2).
                setConvertNote(draft.sizeLabel.trim() ? `No US size for ${draft.sizeSystem} ${draft.sizeLabel} yet.` : "Add a size first, then convert.");
              }
            }}
          >
            Convert to US {draft.usSize ? `· ${draft.usSize}` : ""}
          </button>
          {convertNote ? <p className="mt-1.5 text-xs text-muted">{convertNote}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id="editor-cost" label="Cost">
            <input inputMode="decimal" defaultValue={(draft.costCents / 100).toFixed(2)} onChange={(event) => set({ costCents: dollarsToCents(event.target.value) })} className={control} />
          </Field>
          <Field id="editor-ask" label="Asking">
            <input inputMode="decimal" defaultValue={(draft.askCents / 100).toFixed(2)} onChange={(event) => set({ askCents: dollarsToCents(event.target.value) })} className={control} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rebate back (buying)">
            <input inputMode="decimal" defaultValue={(draft.buyRebateCents / 100).toFixed(2)} onChange={(event) => set({ buyRebateCents: dollarsToCents(event.target.value) })} className={control} />
          </Field>
          <Field label="Delivery charged">
            <input inputMode="decimal" defaultValue={(draft.deliveryCents / 100).toFixed(2)} onChange={(event) => set({ deliveryCents: dollarsToCents(event.target.value) })} className={control} />
          </Field>
        </div>
        <Field id="editor-source" label="Bought from">
          <input value={draft.source} onChange={(event) => set({ source: event.target.value })} placeholder="Shein, Temu, Amazon" className={control} />
        </Field>
        <div id="editor-place">
        <Field label="Where">
          <div className="flex gap-2">
            {([
              ["home", "Home", HomeIcon],
              ["car", "Car", Car],
            ] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={draft.place === id}
                onClick={() => set({ place: draft.place === id ? "" : id })}
                className={`press inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm ${draft.place === id ? "border-accent bg-accent-soft" : "border-line"}`}
              >
                <Icon className="size-4" strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>
        </Field>
        </div>
        <Field label="Problem">
          <div className="flex flex-wrap gap-2">
            {PROBLEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={draft.problem === item.id}
                onClick={() => set({ problem: draft.problem === item.id ? "" : item.id })}
                className={`press h-9 rounded-full border px-3 text-sm ${draft.problem === item.id ? "border-danger text-danger" : "border-line"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="editor-date" label="Arrived">
            <input type="date" value={draft.receivedOn ?? ""} onChange={(event) => set({ receivedOn: event.target.value || null })} className={control} />
          </Field>
          <Field label="Left">
            <input type="date" value={draft.soldOn ?? ""} onChange={(event) => set({ soldOn: event.target.value || null })} className={control} />
          </Field>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="press h-11 rounded-full bg-accent px-5 text-sm font-medium text-accent-ink">Save</button>
          <button type="button" className="press h-11 rounded-full border border-line px-5 text-sm" onClick={tryClose}>Cancel</button>
        </div>
      </form>
      )}
    </Overlay>
    {discardAsk ? (
      <div className="veil-in fixed inset-0 z-40 grid place-items-center bg-black/50 p-3" onClick={() => setDiscardAsk(false)}>
        <div className="sheet-in w-full max-w-sm rounded-3xl border border-line bg-canvas p-5" onClick={(event) => event.stopPropagation()}>
          <p className="font-display text-2xl">Discard changes?</p>
          <p className="mt-2 text-sm text-muted">This piece has edits that are not saved yet.</p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="press h-11 rounded-full border border-danger px-4 text-sm font-medium text-danger" onClick={onClose}>Discard</button>
            <button type="button" className="press h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink" onClick={() => setDiscardAsk(false)}>Keep editing</button>
          </div>
        </div>
      </div>
    ) : null}
    </>
  );
}

function Field({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <label id={id} className="block text-sm">
      <span className="text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function compressPhoto(file: File) {
  return new Promise<string>((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 480 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    image.src = url;
  });
}

/* ======================================================================
   Statistics desk (1.1.0) — the professional pass Oscar asked for: every
   fold now carries the chart its fact needs (a timeline for money over
   time, ranked bars for what earns, an age ramp for stock, a gauge for
   sell-through, a histogram for days to sell), read from one shared
   reading of the floor (lib/ventory/metrics.ts) that the PDF and the
   worksheet print too. The folds, pins and remembered open state are the
   1.0 desk's own; charts sit straight on their fold, never in a second
   frame; names are never cut. Motion: the house's from-only keyframes,
   nothing under reduced motion.
   ====================================================================== */
type FoldState = { openStats: string[]; pinnedStats: string[]; foldStat: (id: string) => void; pinStat: (id: string) => void };

function DeskFold({ s, id, title, line, children }: { s: FoldState; id: string; title: string; line?: string; children: ReactNode }) {
  return (
    <StatFold shot={`stat-${id}`} title={title} line={line ? commas(line) : line} open={s.openStats.includes(id) || s.pinnedStats.includes(id)} pinned={s.pinnedStats.includes(id)} onToggle={() => s.foldStat(id)} onPin={() => s.pinStat(id)}>
      {children}
    </StatFold>
  );
}

function StatsDesk({
  pieces,
  ads,
  adsOn,
  lines,
  openStats,
  pinnedStats,
  foldStat,
  pinStat,
}: {
  pieces: Piece[];
  ads: Ad[];
  adsOn: boolean;
  lines: Record<string, string>;
  openStats: string[];
  pinnedStats: string[];
  foldStat: (id: string) => void;
  pinStat: (id: string) => void;
}) {
  const m = useMemo(() => measure(pieces, adsOn ? ads : []), [pieces, ads, adsOn]);
  const months = useMemo(() => series(m.sales, "month", { limit: 12 }), [m.sales]);
  const week = useMemo(() => compare(m.sales, "week"), [m.sales]);
  const month = useMemo(() => compare(m.sales, "month"), [m.sales]);
  const [lens, setLens] = useState<"category" | "product" | "brand">("product");
  const stockUnits = m.units.onHand + m.units.incoming;
  const st = { openStats, pinnedStats, foldStat, pinStat };
  const earnRows = (lens === "category" ? m.byCategory : lens === "brand" ? m.byBrand : m.byProduct)
    .filter((row) => row.soldUnits > 0)
    .map((row) => ({ label: row.label, value: row.profit, text: cash(row.profit), negative: row.profit < 0, sub: `${row.soldUnits} sold${row.margin != null ? ` · ${pct(row.margin)}` : ""}` }));
  const brandsKnown = m.byBrand.some((row) => row.label !== "No brand");
  const quick = m.byProduct.filter((row) => row.soldUnits >= 2 && row.avgDays != null).sort((a, b) => (a.avgDays ?? 0) - (b.avgDays ?? 0));
  const channels = m.byChannel.filter((row) => row.label !== "Not recorded");
  const clients = m.byClient.filter((row) => row.label !== "Not recorded").sort((a, b) => b.revenue - a.revenue || b.soldUnits - a.soldUnits);
  const sources = m.bySource.filter((row) => row.label !== "Not recorded");
  const hue = [TONES.amber, TONES.green, TONES.blue, TONES.copper, TONES.teal, TONES.plum];
  const best = m.byProduct.filter((row) => row.soldUnits > 0)[0];
  const oldest = m.aging.oldest[0];
  const late = m.aging.buckets.filter((b) => b.min > 90).reduce((sum, b) => sum + b.units, 0);
  const lateCost = m.aging.buckets.filter((b) => b.min > 90).reduce((sum, b) => sum + b.cost, 0);
  const sizeRows = m.bySize
    .slice()
    .sort((a, b) => b.soldUnits - a.soldUnits || b.stockUnits - a.stockUnits || a.label.localeCompare(b.label))
    .map((row) => ({ label: row.label, a: row.soldUnits, b: row.stockUnits, extra: row.sellThrough != null ? pct(row.sellThrough) : undefined }));
  const topSize = m.bySize.filter((row) => row.label !== "No size").sort((a, b) => b.soldUnits - a.soldUnits)[0];

  return (
    <div className="piece mt-4 space-y-3">
      <section data-shot="stat-hero" className="advice-hero framed rounded-3xl bg-panel p-5">
        <Kicker>Statistics · {m.units.sold} {m.units.sold === 1 ? "sale" : "sales"} counted</Kicker>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-sm text-muted">Left after cost</p>
            <p className={`mt-1 font-display text-5xl leading-none tracking-tight tabular-nums ${m.profit < 0 ? "text-danger" : ""}`}>
              <Count value={m.profit} format={(n) => cash(Math.round(n))} final={cash(m.profit)} />
            </p>
          </div>
          <p className="pb-1 text-sm text-muted">
            <span className="tabular-nums text-ink">{cash(m.revenue)}</span> came in · <span className="tabular-nums text-ink">{pct(m.margin)}</span> margin
          </p>
        </div>
        {months.length > 1 ? (
          <div className="mt-4">
            <Spark values={months.map((row) => row.profit)} />
            <div className="mt-1 flex justify-between text-[11px] text-faint">
              <span>{months[0].label}</span>
              <span>Left after cost, month by month</span>
              <span>{months[months.length - 1].label}</span>
            </div>
          </div>
        ) : null}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-4 sm:grid-cols-4">
          {[
            { k: "Sell-through", v: pct(m.sellThrough), s: `${m.units.sold} of ${m.units.sold + stockUnits} pieces` },
            { k: "Days to sell", v: m.days.median == null ? "—" : `${m.days.median} d`, s: m.days.n ? `median of ${m.days.n} dated` : "no dated sale yet" },
            { k: "Stock at cost", v: cash(m.stockCost, true), s: `${stockUnits} ${stockUnits === 1 ? "piece" : "pieces"} waiting` },
            { k: "Average sale", v: m.avgSale == null ? "—" : cash(m.avgSale), s: m.avgProfit == null ? "no priced sale" : `${cash(m.avgProfit)} left each` },
          ].map((item, index) => (
            <div key={item.k} className="row-in min-w-0" style={{ animationDelay: `${120 + index * 60}ms` }}>
              <dt className="text-[11px] font-medium tracking-[0.12em] whitespace-nowrap text-faint uppercase">{item.k}</dt>
              <dd className="mt-1 font-display text-2xl leading-none tabular-nums">{item.v}</dd>
              <dd className="mt-1 text-xs text-muted">{item.s}</dd>
            </div>
          ))}
        </dl>
      </section>

      <DeskFold s={st} id="time" title="Over time" line={lines.time}>
        <Trend sales={m.sales} />
      </DeskFold>

      <DeskFold s={st} id="earns" title="What earns" line={best ? `${best.label} leads with ${cash(best.profit)} left after cost from ${best.soldUnits} ${best.soldUnits === 1 ? "sale" : "sales"}.` : "Nothing has sold yet, so nothing can be ranked."}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">Left after cost, with pieces sold and margin</p>
          <Segmented value={lens} onChange={setLens} label="Rank by" options={[{ id: "product", label: "Product" }, { id: "category", label: "Type" }, { id: "brand", label: "Brand" }]} />
        </div>
        {lens === "brand" && !brandsKnown ? <p className="text-sm text-muted">No piece carries a brand yet. Add brands on the cards and this ranks them.</p> : <Bars key={lens} rows={earnRows} empty="No sales to rank yet." />}
      </DeskFold>

      <DeskFold s={st} id="numbers" title="Numbers" line={lines.numbers}>
        <dl className="grid gap-x-6 sm:grid-cols-2">
          {[
            ["Taken in", cash(m.revenue)],
            ["Left after cost", cash(m.profit)],
            ["Cost of sales", cash(m.costOfSales)],
            ["Margin", pct(m.margin)],
            ["Average sale", m.avgSale == null ? "—" : cash(m.avgSale)],
            ["Given in price cuts", cash(m.priceCuts)],
            ["Pieces sold", String(m.units.sold)],
            ["Sales with no price", String(m.units.unpriced)],
            ["On hand", String(m.units.onHand)],
            ["On the way", String(m.units.incoming)],
            ["Still tied up", cash(m.stockCost)],
            ["In the archive", String(m.units.archived)],
            ["Average hold", m.days.avg == null ? "—" : `${m.days.avg} d`],
            ["Longest still here", oldest ? `${oldest.days} d` : "—"],
            ["Open problems", String(m.units.problems)],
            ["Kept for yourself", String(m.units.kept)],
          ].map(([label, value], index) => (
            <div key={label} className="row-in flex items-baseline justify-between gap-3 border-b border-line py-2" style={{ animationDelay: `${Math.min(index * 25, 300)}ms` }}>
              <dt className="min-w-0 text-sm text-muted">{label}</dt>
              <dd className={`shrink-0 font-display text-lg leading-none tabular-nums ${label === "Left after cost" && m.profit < 0 ? "text-danger" : ""}`}>{value}</dd>
            </div>
          ))}
        </dl>
      </DeskFold>

      <DeskFold s={st} id="stretch" title="This stretch against the last" line={lines.stretch}>
        {[{ name: "This week against the week before", c: week }, { name: "This month against the month before", c: month }].map(({ name, c }) => (
          <div key={name} className="mb-3 last:mb-0">
            <Kicker className="mb-1">{name}</Kicker>
            {c.now ? (
              <>
                <Delta label="Taken in" now={c.now.revenue} before={c.before?.revenue ?? null} format={(n) => cash(n, true)} />
                <Delta label="Left after cost" now={c.now.profit} before={c.before?.profit ?? null} format={(n) => cash(n, true)} />
                <Delta label="Sales" now={c.now.units} before={c.before?.units ?? null} format={(n) => String(n)} />
              </>
            ) : <p className="text-sm text-muted">No dated sale yet.</p>}
          </div>
        ))}
      </DeskFold>

      <DeskFold s={st} id="pace" title="How fast they sell" line={m.days.median == null ? "A sale needs both its arrival and its sale date to time it." : `Half your sales left within ${m.days.median} days of arriving. ${pct(m.sellThrough)} of what you bought has sold.`}>
        <Gauge value={m.sellThrough} label="Sell-through" caption={`${m.units.sold} sold of the ${m.units.sold + stockUnits} pieces bought and still counted. Kept and removed pieces stay out.`} />
        {m.days.n ? (
          <div className="mt-5">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
              <Kicker>Days from arrival to sale</Kicker>
              <span className="text-xs text-muted tabular-nums">median {m.days.median} d · fastest {m.days.fastest} d · slowest {m.days.slowest} d</span>
            </div>
            <Histogram rows={m.days.buckets} />
          </div>
        ) : null}
        {quick.length ? (
          <div className="mt-5">
            <Kicker className="mb-2">Quickest to sell, two sales or more</Kicker>
            <Bars rows={quick.map((row) => ({ label: row.label, value: row.avgDays ?? 0, text: `${row.avgDays} d`, sub: `${row.soldUnits} sold`, tone: TONES.teal }))} limit={5} />
          </div>
        ) : null}
      </DeskFold>

      <DeskFold s={st} id="aging" title="How old the stock is" line={m.units.onHand === 0 ? "Nothing on hand." : late ? `${late} on hand ${late === 1 ? "has" : "have"} sat past 90 days, ${cash(lateCost, true)} at cost.` : `Nothing on hand has sat past 90 days.${m.aging.avg != null ? ` The average piece has waited ${m.aging.avg} days.` : ""}`}>
        <AgeColumns buckets={m.aging.buckets} />
        <p className="mt-3 text-sm text-muted">Pieces on hand by days since they arrived, with their cost under each column.{m.aging.undated ? ` ${m.aging.undated} ${m.aging.undated === 1 ? "has" : "have"} no arrival date and stay out.` : ""}</p>
        {m.aging.oldest.length ? (
          <ul className="mt-3 border-t border-line">
            {m.aging.oldest.slice(0, 5).map(({ piece, days }, index) => (
              <li key={piece.id} className="row-in flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-b-0" style={{ animationDelay: `${index * 45}ms` }}>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{piece.name}</span>
                  <span className="block text-xs tabular-nums text-muted">{[sizeName(piece), `cost ${cash(piece.costCents)}`, piece.askCents ? `asking ${cash(piece.askCents)}` : "no ask yet"].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums" style={{ background: `color-mix(in srgb, ${litTone(ageTone(days))} 24%, transparent)`, color: "var(--v-ink)" }}>{days} d</span>
              </li>
            ))}
          </ul>
        ) : null}
      </DeskFold>

      <DeskFold s={st} id="stock" title="Stock in money" line={stockUnits ? `${cash(m.stockCost, true)} is waiting on the shelf and on the way.${m.stockAsk ? ` At their asks, the priced pieces would bring ${cash(m.stockAsk, true)}.` : ""}` : "No stock waiting."}>
        <Split parts={[
          { label: "On hand", value: m.onHandCost, tone: TONES.green, text: cash(m.onHandCost, true) },
          { label: "On the way", value: m.incomingCost, tone: TONES.blue, text: cash(m.incomingCost, true) },
        ]} />
        {m.stockAsk ? (
          <p className="mt-3 text-sm leading-relaxed text-muted">
            If every priced piece sells at its ask: <span className="tabular-nums text-ink">{cash(m.stockAsk, true)}</span> in, <span className="tabular-nums text-ink">{cash(m.stockAsk - m.stockAskCost, true)}</span> over its cost.{m.unaskedUnits ? ` ${m.unaskedUnits} ${m.unaskedUnits === 1 ? "piece has" : "pieces have"} no asking price yet.` : ""}
          </p>
        ) : null}
        <div className="mt-4">
          <Kicker className="mb-2">Where the money waits</Kicker>
          <Bars rows={m.byProduct.filter((row) => row.stockUnits > 0).sort((a, b) => b.stockCost - a.stockCost).map((row) => ({ label: row.label, value: row.stockCost, text: cash(row.stockCost, true), sub: `${row.stockUnits} ${row.stockUnits === 1 ? "piece" : "pieces"}`, tone: TONES.amber }))} empty="Nothing waiting." />
        </div>
      </DeskFold>

      <DeskFold s={st} id="product" title="By product" line={lines.product}>
        <SalesBoard title="Sales by product" rows={salesOf(m.sales)} bare />
      </DeskFold>

      <DeskFold s={st} id="sizes" title="Sizes" line={topSize && topSize.soldUnits > 1 ? `${topSize.label} sold most: ${topSize.soldUnits} times, ${topSize.stockUnits} still here.` : lines.sizes}>
        <PairBars rows={sizeRows} aLabel="Sold" bLabel="Still here" extraLabel="% is the share sold" aTone={TONES.blue} limit={8} empty="No sizes yet." />
      </DeskFold>

      <DeskFold s={st} id="channels" title="Channels and clients" line={channels.length ? `${channels[0].label} brought the most: ${cash(channels[0].revenue, true)}.` : "No sale names where it sold yet. Add the channel when you mark a sale and this shows where the money comes from."}>
        {channels.length ? (
          <div className="mb-4">
            <Kicker className="mb-2">Where they sold, by money in</Kicker>
            <Split parts={channels.slice(0, 6).map((row, i) => ({ label: row.label, value: row.revenue, tone: hue[i % hue.length], text: cash(row.revenue, true) }))} />
          </div>
        ) : null}
        <div>
          <Kicker className="mb-2">Clients</Kicker>
          {clients.length ? (
            <Bars rows={clients.map((row) => ({ label: row.label, value: row.revenue, text: cash(row.revenue, true), sub: `${row.soldUnits} ${row.soldUnits === 1 ? "buy" : "buys"}`, tone: TONES.copper }))} limit={5} />
          ) : <p className="text-sm text-muted">No sale names its buyer yet.</p>}
        </div>
      </DeskFold>

      <DeskFold s={st} id="sources" title="Bought from" line={sources.length ? (sources.some((row) => row.soldUnits) ? `${sources.slice().sort((a, b) => b.soldUnits - a.soldUnits)[0].label} has sold the most of what it supplied.` : lines.sources) : "No piece names where it was bought yet."}>
        <PairBars rows={sources.map((row) => ({ label: row.label, a: row.soldUnits, b: row.stockUnits, extra: row.margin != null ? `${pct(row.margin)} margin` : undefined }))} aLabel="Sold" bLabel="Still here" aTone={TONES.teal} empty="Add where you bought a piece and this compares your sources." />
      </DeskFold>

      <DeskFold s={st} id="where" title="Where they are" line={lines.where}>
        <Ring bare title="Where they are" parts={[
          { label: "On hand", value: m.units.onHand, color: "#5f8f72" },
          { label: "Incoming", value: m.units.incoming, color: "#5d86ad" },
          { label: "Sold", value: pieces.filter((piece) => piece.status === "sold").reduce((sum, piece) => sum + piece.qty, 0), color: "#c47b4a" },
          { label: "Archive", value: m.units.archived, color: "#4f7f8a" },
        ]} />
      </DeskFold>

      <DeskFold s={st} id="place" title="Home or car" line={lines.place}>
        <Ring bare title="Where the live pairs are" parts={[
          { label: "Home", value: m.stock.filter((piece) => piece.place === "home").reduce((sum, piece) => sum + piece.qty, 0), color: "#5f8f72" },
          { label: "Car", value: m.stock.filter((piece) => piece.place === "car").reduce((sum, piece) => sum + piece.qty, 0), color: "#5d86ad" },
          { label: "Not marked", value: m.stock.filter((piece) => !piece.place).reduce((sum, piece) => sum + piece.qty, 0), color: "#b08a3e" },
        ]} />
      </DeskFold>

      {adsOn ? (
        <DeskFold s={st} id="ads" title="Ads" line={lines.ads}>
          <AdBoard ads={ads} pieces={pieces} bare />
        </DeskFold>
      ) : null}
    </div>
  );
}
