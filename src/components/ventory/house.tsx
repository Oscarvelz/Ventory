import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, BadgeCheck, Car, Check, ChevronDown, CircleAlert, CircleDollarSign, ClipboardPaste, Clock, DatabaseBackup, Footprints, Funnel, Glasses, House as HomeIcon, ImagePlus, LayoutGrid, List, Megaphone, Moon, Package, Palette, Pin, Plus, RectangleHorizontal, Rows2, ShieldCheck, Shirt, ShoppingBag, SlidersHorizontal, Sun, Trash2, TrendingUp, Truck, Watch } from "lucide-react";
import { AccountCard, FingerprintControl, SignOutCard } from "@/lib/auth/gates";
import { daysHeld, dollarsToCents, emptyInput, money, PROBLEMS, STATUS_LABEL, STATUSES, todayISO, type Ad, type Piece, type PieceInput, type Status } from "@/lib/ventory/model";
import { buildAdvice } from "@/lib/ventory/advisor";
import { AdvisorView, type AdviceFocus } from "@/components/ventory/Advisor";
import { parseFloorNotes } from "@/lib/ventory/paste";
import { convertToUs } from "@/lib/ventory/sizes";
import { addSamples, clearSelected, createCheckpoint, deleteAd, deletePiece, importPieces, isLegacySample, loadFloor, removeSamples, replaceFloor, sampleSetSize, saveAd, saveAds, saveMark, savePiece, saveTheme } from "@/lib/ventory/server";
import { asTheme, isLightTheme, LIGHT_THEMES, THEMES, type ThemeId } from "@/lib/ventory/themes";
import { tone as litTone } from "@/lib/ventory/tones";
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

type SaleLine = { name: string; count: number; revenue: number; profit: number; unpriced: number };

function salesOf(pieces: Piece[]): SaleLine[] {
  const map = new Map<string, SaleLine>();
  for (const piece of pieces) {
    const name = piece.name.trim() || "Untitled";
    const row = map.get(name) ?? { name, count: 0, revenue: 0, profit: 0, unpriced: 0 };
    row.count += piece.qty;
    if (piece.saleCents == null) row.unpriced += piece.qty;
    else {
      const revenue = piece.saleCents * piece.qty;
      const cost = Math.max(0, piece.costCents - piece.discountCents) * piece.qty;
      row.revenue += revenue;
      row.profit += revenue - cost;
    }
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.count - a.count);
}

function take(piece: Piece) {
  if (piece.saleCents == null) return null;
  const cost = Math.max(0, piece.costCents - piece.discountCents) * piece.qty;
  const revenue = piece.saleCents * piece.qty;
  return { revenue, profit: revenue - cost };
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
  const cost = priced.reduce((sum, piece) => sum + Math.max(0, piece.costCents - piece.discountCents) * piece.qty, 0);
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

  const discount = sold.reduce((sum, piece) => sum + piece.discountCents * piece.qty, 0);
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
  const [chip, setChip] = useState<Shelf>("live");
  const [lens, setLens] = useState<Lens | null>(null);
  const [past, setPast] = useState<"sold" | "archived">("sold");
  const [face, setFace] = useState<Face>("large");
  const [cols, setCols] = useState<2 | 3 | 4>(2);
  const layout: Layout = face === "large" ? "card" : face === "medium" ? "medium" : face === "list" ? "list" : cols === 2 ? "g2" : cols === 3 ? "g3" : "g4";
  const listClass = layout === "card" ? "mt-4 space-y-3" : layout === "g2" ? "mt-4 grid grid-cols-2 gap-2" : layout === "g3" ? "mt-4 grid grid-cols-3 gap-2" : layout === "g4" ? "mt-4 grid grid-cols-4 gap-1.5" : "mt-4 space-y-2";
  const nestClass = listClass.replace("mt-4 ", "");
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
  const touchX = useRef(0);
  const topRef = useRef<HTMLElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const [bars, setBars] = useState<{ top: HTMLElement | null; dock: HTMLElement | null }>({ top: null, dock: null });

  useEffect(() => {
    if (!undo || undoOpen) return;
    if (undo.what !== "Sold" && undo.what !== "Delete") {
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
    const cost = priced.reduce((sum, piece) => sum + Math.max(0, piece.costCents - piece.discountCents) * piece.qty, 0);
    const tied = pieces.filter((piece) => piece.status === "available" || piece.status === "incoming").reduce((sum, piece) => sum + piece.costCents * piece.qty, 0);
    return { available, incoming, sold: sold.reduce((sum, piece) => sum + piece.qty, 0), revenue, profit: revenue - cost, tied, unpriced: sold.length - priced.length, cost };
  }, [pieces]);

  const picture = useMemo(() => {
    const held = pieces.filter((piece) => piece.status === "available" || piece.status === "incoming");
    const sold = pieces.filter(isSale);
    const sizeOf = (piece: Piece) => (piece.usSize ? `US ${piece.usSize}` : piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "No size");
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
      margin: stats.revenue > 0 ? Math.round((stats.profit / stats.revenue) * 100) : null,
    };
  }, [pieces, stats.profit, stats.revenue]);

  const month = periodsOf(pieces, "month").filter((row) => row.stamp > 0).at(-1) ?? null;
  const datedMonths = periodsOf(pieces, "month").filter((row) => row.stamp > 0);
  const datedWeeks = periodsOf(pieces, "week").filter((row) => row.stamp > 0);
  const pricedQty = pieces.filter((piece) => isSale(piece) && piece.saleCents != null).reduce((sum, piece) => sum + piece.qty, 0);
  const givenAway = pieces.filter(isSale).reduce((sum, piece) => sum + piece.discountCents * piece.qty, 0);
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
        ? "It moves to Sold in History. Reverse stays up for a few seconds."
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
      className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-28"
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
      <header ref={topRef} className="shelf-top sticky top-0 z-30 -mx-4 flex items-center justify-between gap-3 bg-canvas px-4 pt-[max(0.25rem,env(safe-area-inset-top))] pb-3">
        <Wordmark className="text-[2.156rem]" />
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Add" className="press grid size-9 place-items-center rounded-full bg-accent text-accent-ink" onClick={() => { setFilterOpen(false); setEditorFocus(null); setEditor(emptyInput()); }}>
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" aria-label={isLightTheme(theme) ? "Night" : "Day"} className="press grid size-9 place-items-center rounded-full border border-line" onClick={flipTheme}>
            {isLightTheme(theme) ? <Moon className="size-4" strokeWidth={1.75} /> : <Sun className="size-4" strokeWidth={1.75} />}
          </button>
          <button type="button" aria-label="Settings" className="press grid size-9 place-items-center rounded-full border border-line" onClick={() => { setFilterOpen(false); setOpenSettings([]); setWipe([]); setWipeAsk(false); setSettings(true); }}>
            <SlidersHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="relative mt-5">
        <section className={panel("floor")}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pieces"
            className="surface h-12 w-full rounded-2xl border border-line bg-panel px-4 text-sm outline-none focus:border-accent"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ["hand", "On hand", String(stats.available), stats.available ? `${money(sitting("available"))} ready` : "Nothing ready", Package, "#5f8f72"],
              ["incoming", "Incoming", String(stats.incoming), stats.incoming ? `${money(sitting("incoming"))} on the way` : "Nothing coming", Truck, "#5d86ad"],
              ["revenue", "Revenue", money(stats.revenue), month ? `${month.label} · ${money(month.revenue)}` : "No dated sales", CircleDollarSign, "#b08a3e"],
              ["profit", "Profit", money(stats.profit), picture.margin == null ? "No margin yet" : `${picture.margin}% after cost`, TrendingUp, "#8d6aad"],
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
                    className="press flex w-full items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left"
                    onClick={() => setOpenCats((current) => (current.includes(group.category) ? current.filter((item) => item !== group.category) : [...current, group.category]))}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{group.category}</span>
                    <span className="text-sm tabular-nums text-muted">{group.count}</span>
                    <ChevronDown className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={1.75} />
                  </button>
                  {open ? (
                    <div className="mt-3 space-y-4">
                      {group.subs.map((sub) => {
                        const photo = marks.find((mark) => mark.category.toLowerCase() === group.category.toLowerCase() && mark.subcategory.toLowerCase() === sub.name.toLowerCase())?.photo ?? "";
                        return (
                        <div key={sub.name || "plain"}>
                          {sub.name ? (
                            <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel p-2 pr-4">
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
                          <ul className={`${nestClass} ${sub.name ? "mt-2" : ""}`}>
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

        <section className={panel("history")}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pieces"
            className="surface h-12 w-full rounded-2xl border border-line bg-panel px-4 text-sm outline-none focus:border-accent"
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
        </section>

        <section className={panel("ledger")}>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["stats", "Statistics"],
              ["advisor", "Advisor"],
            ] as const).map(([id, label]) => (
              <RippleButton
                key={id}
                nav={id}
                aria-pressed={desk === id}
                onClick={() => setDesk(id)}
                className={`press h-12 rounded-2xl border text-sm font-medium ${desk === id ? "border-line bg-panel text-ink" : "border-line/70 text-muted"}`}
              >
                {label}
              </RippleButton>
            ))}
          </div>
          {desk === "stats" ? (
            <div className="mt-4 space-y-3">
              <StatFold
                title="Numbers"
                line={brief.lines.numbers}
                open={openStats.includes("numbers") || pinnedStats.includes("numbers")}
                pinned={pinnedStats.includes("numbers")}
                onToggle={() => {
                  if (pinnedStats.includes("numbers")) return;
                  setOpenStats((current) => current.includes("numbers") ? current.filter((item) => item !== "numbers") : [...current, "numbers"]);
                }}
                onPin={() => {
                  setPinnedStats((current) => current.includes("numbers") ? current.filter((item) => item !== "numbers") : [...current, "numbers"]);
                  setOpenStats((current) => current.includes("numbers") ? current : [...current, "numbers"]);
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Figure label="Taken in" value={money(stats.revenue)} cents={stats.revenue} />
                  <Figure label="Left after cost" value={money(stats.profit)} negative={stats.profit < 0} cents={stats.profit} />
                  <Exact label="Cost of sales" value={money(stats.cost)} />
                  <Exact label="Margin" value={picture.margin == null ? "—" : `${picture.margin}%`} />
                  <Exact label="Average sale" value={pricedQty ? money(Math.round(stats.revenue / pricedQty)) : "—"} />
                  <Exact label="Given in discounts" value={money(givenAway)} />
                  <Exact label="Pieces sold" value={String(stats.sold)} />
                  <Exact label="Sales with no price" value={String(stats.unpriced)} />
                  <Exact label="On hand" value={String(stats.available)} />
                  <Exact label="On the way" value={String(stats.incoming)} />
                  <Exact label="Still tied up" value={money(stats.tied)} />
                  <Exact label="In the archive" value={String(picture.archived)} />
                  <Exact label="Average hold" value={picture.avgHold == null ? "—" : `${picture.avgHold}d`} />
                  <Exact label="Longest still here" value={picture.oldest == null ? "—" : `${picture.oldest}d`} />
                  <Exact label="Open problems" value={String(picture.problems)} />
                  <Exact label="Home / car" value={`${picture.home} / ${picture.car}`} />
                </div>
              </StatFold>
              <StatFold
                title="This stretch against the last"
                line={brief.lines.stretch}
                open={openStats.includes("stretch") || pinnedStats.includes("stretch")}
                pinned={pinnedStats.includes("stretch")}
                onToggle={() => {
                  if (pinnedStats.includes("stretch")) return;
                  setOpenStats((current) => current.includes("stretch") ? current.filter((item) => item !== "stretch") : [...current, "stretch"]);
                }}
                onPin={() => {
                  setPinnedStats((current) => current.includes("stretch") ? current.filter((item) => item !== "stretch") : [...current, "stretch"]);
                  setOpenStats((current) => current.includes("stretch") ? current : [...current, "stretch"]);
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Exact label={datedWeeks.at(-1) ? `${datedWeeks.at(-1)?.label} in` : "This week in"} value={datedWeeks.at(-1) ? money(datedWeeks.at(-1)?.revenue ?? 0) : "—"} />
                  <Exact label={datedWeeks.at(-2) ? `${datedWeeks.at(-2)?.label} in` : "Week before"} value={datedWeeks.at(-2) ? money(datedWeeks.at(-2)?.revenue ?? 0) : "—"} />
                  <Exact label="This week left" value={datedWeeks.at(-1) ? money(datedWeeks.at(-1)?.profit ?? 0) : "—"} />
                  <Exact label="Week before left" value={datedWeeks.at(-2) ? money(datedWeeks.at(-2)?.profit ?? 0) : "—"} />
                  <Exact label={datedMonths.at(-1) ? `${datedMonths.at(-1)?.label} in` : "This month in"} value={datedMonths.at(-1) ? money(datedMonths.at(-1)?.revenue ?? 0) : "—"} />
                  <Exact label={datedMonths.at(-2) ? `${datedMonths.at(-2)?.label} in` : "Month before"} value={datedMonths.at(-2) ? money(datedMonths.at(-2)?.revenue ?? 0) : "—"} />
                  <Exact label="This month left" value={datedMonths.at(-1) ? money(datedMonths.at(-1)?.profit ?? 0) : "—"} />
                  <Exact label="Month before left" value={datedMonths.at(-2) ? money(datedMonths.at(-2)?.profit ?? 0) : "—"} />
                  <Exact label="Sales this week" value={String(datedWeeks.at(-1)?.count ?? 0)} />
                  <Exact label="Sales this month" value={String(datedMonths.at(-1)?.count ?? 0)} />
                </div>
              </StatFold>
              <StatFold title="Over time" line={brief.lines.time} open={openStats.includes("time") || pinnedStats.includes("time")} pinned={pinnedStats.includes("time")} onToggle={() => foldStat("time")} onPin={() => pinStat("time")}>
                <Performance pieces={pieces} />
              </StatFold>
              <StatFold title="By product" line={brief.lines.product} open={openStats.includes("product") || pinnedStats.includes("product")} pinned={pinnedStats.includes("product")} onToggle={() => foldStat("product")} onPin={() => pinStat("product")}>
                <SalesBoard title="Sales by product" rows={countedLines} />
              </StatFold>
              <StatFold title="Where they are" line={brief.lines.where} open={openStats.includes("where") || pinnedStats.includes("where")} pinned={pinnedStats.includes("where")} onToggle={() => foldStat("where")} onPin={() => pinStat("where")}>
                <Ring title="Where they are" parts={[
                  { label: "On hand", value: stats.available, color: "#5f8f72" },
                  { label: "Incoming", value: stats.incoming, color: "#5d86ad" },
                  { label: "Sold", value: picture.soldNow, color: "#c47b4a" },
                  { label: "Archive", value: picture.archived, color: "#4f7f8a" },
                ]} />
              </StatFold>
              <StatFold title="Sizes" line={brief.lines.sizes} open={openStats.includes("sizes") || pinnedStats.includes("sizes")} pinned={pinnedStats.includes("sizes")} onToggle={() => foldStat("sizes")} onPin={() => pinStat("sizes")}>
                <div className="space-y-2">
                  <Columns title="Sizes still here" rows={picture.sizesHere} empty="No pairs on the floor yet." />
                  <Columns title="Sizes that already sold" rows={picture.sizesSold} empty="No sales to measure yet." />
                </div>
              </StatFold>
              <StatFold title="Bought from" line={brief.lines.sources} open={openStats.includes("sources") || pinnedStats.includes("sources")} pinned={pinnedStats.includes("sources")} onToggle={() => foldStat("sources")} onPin={() => pinStat("sources")}>
                <Columns title="Bought from" rows={picture.sources} empty="No sources yet." />
              </StatFold>
              <StatFold title="Home or car" line={brief.lines.place} open={openStats.includes("place") || pinnedStats.includes("place")} pinned={pinnedStats.includes("place")} onToggle={() => foldStat("place")} onPin={() => pinStat("place")}>
                <Ring title="Where the live pairs are" parts={[
                  { label: "Home", value: picture.home, color: "#5f8f72" },
                  { label: "Car", value: picture.car, color: "#5d86ad" },
                  { label: "Not marked", value: picture.loose, color: "#b08a3e" },
                ]} />
              </StatFold>
              {adsOn ? (
                <StatFold title="Ads" line={brief.lines.ads} open={openStats.includes("ads") || pinnedStats.includes("ads")} pinned={pinnedStats.includes("ads")} onToggle={() => foldStat("ads")} onPin={() => pinStat("ads")}>
                  <AdBoard ads={ads} pieces={pieces} />
                </StatFold>
              ) : null}
            </div>
          ) : (
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
                  if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                });
              }}
              onFlag={(piece) => {
                void savePiece({ data: { ...piece, problem: "late" } }).then((saved) => {
                  if (saved) setPieces((current) => current.map((item) => (item.id === saved.id ? saved : item)));
                });
              }}
            />
          )}
        </section>
      </div>

      {undo && !undoOpen && (undo.what === "Sold" || undo.what === "Delete") ? (
        <div className="fixed inset-x-0 bottom-[4.75rem] z-20 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4">
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
          <p className="font-display text-2xl">{undo.what === "Delete" ? `Add ${undo.name} back?` : `Put ${undo.name} back as Available?`}</p>
          <p className="mt-2 text-sm text-muted">{undo.what === "Delete" ? "It returns as it was before you deleted it." : "The sale comes off."}</p>
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
                        const next = await replaceFloor({ data: JSON.parse(text) });
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

function SalesBoard({ title, rows }: { title: string; rows: SaleLine[] }) {
  return (
    <div className="framed mt-4 rounded-3xl bg-panel p-5">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>
      {rows.length === 0 ? <p className="mt-3 text-sm text-muted">No sales to compare yet.</p> : (
        <>
          <div className="mt-4 grid grid-cols-[1fr_2.75rem_4.75rem_4.75rem] gap-2 border-b border-line pb-2 text-[10px] font-medium tracking-widest text-faint uppercase">
            <span>Product</span>
            <span className="text-right">Sold</span>
            <span className="text-right">In</span>
            <span className="text-right">Left</span>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((row, index) => (
              <li key={row.name} className="row-in grid grid-cols-[1fr_2.75rem_4.75rem_4.75rem] items-baseline gap-2 py-2.5 text-sm" style={{ animationDelay: `${Math.min(index * 45, 270)}ms` }}>
                <span className="min-w-0">
                  <span className="block truncate">{row.name}</span>
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

function Ring({ title, parts }: { title: string; parts: { label: string; value: number; color: string }[] }) {
  const shown = parts.filter((part) => part.value > 0).map((part) => ({ ...part, color: litTone(part.color) }));
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  const radius = 42;
  const turn = 2 * Math.PI * radius;
  let walked = 0;
  return (
    <div className="rounded-3xl border border-line bg-panel p-5">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>
      {total === 0 ? <p className="mt-3 text-sm text-muted">Nothing to measure yet.</p> : (
        <div className="mt-4 flex items-center gap-5">
          <div className="relative size-28 shrink-0">
            <svg viewBox="0 0 120 120" className="size-28 -rotate-90">
              <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--v-panel-2)" strokeWidth="14" />
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
                    strokeWidth="14"
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
              <p className="font-display text-2xl tabular-nums">{total}</p>
            </div>
          </div>
          <ul className="min-w-0 flex-1 space-y-2">
            {shown.map((part) => (
              <li key={part.label} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: part.color }} />
                  <span className="truncate">{part.label}</span>
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
    <div className="rounded-3xl border border-line bg-panel p-5">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">{title}</p>
      {shown.length === 0 ? <p className="mt-3 text-sm text-muted">{empty ?? "Nothing to measure yet."}</p> : (
        <ul className="mt-4 space-y-3">
          {shown.map((row) => (
            <li key={row.label} className="flex items-center gap-3 text-sm">
              <span className="w-28 min-w-0 shrink-0 truncate text-muted">{row.label}</span>
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
  return (
    <RippleButton
      ink={tone}
      aria-pressed={pressed}
      onClick={onClick}
      className="press flex items-center gap-3 rounded-2xl border px-3 py-3 text-left"
      style={{
        background: `color-mix(in srgb, ${tone} ${pressed ? 24 : 14}%, var(--v-panel))`,
        borderColor: pressed ? tone : `color-mix(in srgb, ${tone} 35%, var(--v-line))`,
        color: "var(--v-ink)",
      }}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full text-[#f6f3ec]" style={{ background: tone }}>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] tracking-[0.14em] text-faint uppercase">{label}</span>
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
  const tone = litTone(rawTone);
  return (
    <RippleButton
      ink={tone}
      aria-pressed={pressed}
      onClick={onClick}
      className="press sum-chip flex min-h-32 flex-col rounded-3xl border px-4 py-3.5 text-left"
      style={{
        background: `color-mix(in srgb, ${tone} ${pressed ? 28 : 16}%, var(--v-panel))`,
        borderColor: tone,
        boxShadow: pressed ? `inset 0 0 0 1.5px ${tone}` : undefined,
        opacity: dimmed ? 0.62 : undefined,
        filter: dimmed ? "saturate(.7)" : undefined,
      }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-[0.16em] text-faint uppercase">{label}</span>
        <span
          className="grid size-7 place-items-center rounded-full"
          style={{ background: tone, color: "#f6f3ec" }}
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

function StatFold({ title, open, pinned, onToggle, onPin, line, children }: { title: string; open: boolean; pinned: boolean; onToggle: () => void; onPin: () => void; line?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-panel">
      <div className="flex items-center gap-1 pr-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className="press flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left">
          <ChevronDown className={`size-4 shrink-0 self-center text-muted transition-transform ${open ? "" : "-rotate-90"}`} strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-lg leading-tight">{title}</span>
            {!open && line ? <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-muted">{line}</span> : null}
          </span>
        </button>
        <button type="button" aria-label={pinned ? "Unpin" : "Pin open"} aria-pressed={pinned} onClick={onPin} className={`press grid size-8 shrink-0 place-items-center self-center rounded-full ${pinned ? "text-accent" : "text-muted"}`}>
          <Pin className="size-4" strokeWidth={1.75} fill={pinned ? "currentColor" : "none"} />
        </button>
      </div>
      {open ? <div className="px-4 pb-4">{line ? <p className="mb-3 text-sm leading-relaxed text-muted">{line}</p> : null}{children}</div> : null}
    </section>
  );
}

function Exact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-canvas px-3 py-3">
      <p className="text-[10px] font-medium tracking-widest text-faint uppercase">{label}</p>
      <p className="mt-1.5 font-display text-2xl leading-none tabular-nums">{value}</p>
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
    <div className="col-span-2 rounded-2xl border border-line bg-canvas px-4 py-4">
      <p className="text-[10px] font-medium tracking-widest text-faint uppercase">{label}</p>
      <p className={`mt-2 font-display text-[2.6rem] leading-none tracking-tight tabular-nums ${negative ? "text-danger" : ""}`}>{shown}</p>
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
    <div className="rounded-3xl border border-line bg-panel p-5">
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
            <div className="flex h-40 items-end gap-3" style={{ minWidth: rows.length > 5 ? rows.length * 56 : "100%" }}>
              {rows.map((row, index) => {
                const series = shown(row);
                const headline = series[series.length - 1]?.[1] ?? 0;
                return (
                  <div key={row.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    <span className={`text-[10px] tabular-nums ${headline < 0 ? "text-danger" : "text-muted"}`}>{headline < 0 ? "−" : ""}{shortMoney(headline)}</span>
                    <div className="mt-1 flex h-24 w-full items-end justify-center gap-1">
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
        const profit = piece.saleCents == null ? null : piece.saleCents * piece.qty - Math.max(0, piece.costCents - piece.discountCents) * piece.qty;
        return (
          <li key={piece.id}>
            <button type="button" onClick={() => onOpen(piece)} className="press flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-left">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{piece.name}</span>
                <span className="block text-xs text-muted">{piece.soldOn ?? "No date"}{piece.usSize ? ` · US ${piece.usSize}` : ""}</span>
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
  const profit = piece.saleCents == null ? null : piece.saleCents - Math.max(0, piece.costCents - piece.discountCents);
  const actions: { key: string; label: string; icon: typeof Check; onClick: () => void; tone?: "accent" | "danger" }[] = [
    { key: "sold", label: "Sold", icon: BadgeCheck, onClick: () => onStatus("sold"), tone: piece.status === "sold" ? "accent" : undefined },
    { key: "incoming", label: "Coming", icon: Truck, onClick: () => onStatus("incoming"), tone: piece.status === "incoming" ? "accent" : undefined },
    { key: "problem", label: "Problem", icon: CircleAlert, onClick: () => setFlags((open) => !open), tone: piece.problem ? "danger" : undefined },
    { key: "delete", label: "Delete", icon: Trash2, onClick: onDelete, tone: "danger" },
  ];
  const sizeLine = [piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "", piece.usSize ? `US ${piece.usSize}` : ""].filter(Boolean).join(" · ");
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
            {[piece.sizeLabel ? `${piece.sizeSystem} ${piece.sizeLabel}` : "", piece.usSize ? `US ${piece.usSize}` : ""].filter(Boolean).join(" · ") || "No size"}
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

function AdBoard({ ads, pieces }: { ads: Ad[]; pieces: Piece[] }) {
  const spent = ads.reduce((sum, ad) => sum + ad.spentCents, 0);
  const worked = ads.filter((ad) => ad.worked === "yes").length;
  const missed = ads.filter((ad) => ad.worked === "no").length;
  const days = ads.map(adSpan).filter((value): value is number => value != null);
  const average = days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null;
  return (
    <div className="rounded-3xl border border-line bg-panel p-5">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">Ads</p>
      {ads.length === 0 ? <p className="mt-3 text-sm text-muted">No promotion logged yet. Record it from History.</p> : (
        <>
          <p className="mt-2 font-display text-4xl tabular-nums">{money(spent)}</p>
          <p className="mt-1 text-sm text-muted">{worked} worked · {missed} did not · {average == null ? "no dates" : `${average}d average`}</p>
          <ul className="mt-4 space-y-3">
            {ads.map((ad) => {
              const span = adSpan(ad);
              return (
                <li key={ad.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{ad.product}</span>
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
          background: `color-mix(in srgb, ${tone} ${open ? 24 : 14}%, var(--v-panel))`,
          borderColor: open ? tone : `color-mix(in srgb, ${tone} 35%, var(--v-line))`,
        }}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-[#f6f3ec]" style={{ background: tone }}>
          <Megaphone className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] tracking-[0.14em] text-faint uppercase">Ads</span>
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

function Editor({ initial, known = [], focus = null, onClose, onSave, onImport }: { initial: PieceInput; known?: Piece[]; focus?: AdviceFocus | null; onClose: () => void; onSave: (input: PieceInput) => void; onImport?: (rows: PieceInput[]) => void }) {
  const [draft, setDraft] = useState(initial);
  const [batch, setBatch] = useState(false);
  const set = (patch: Partial<PieceInput>) => setDraft((current) => ({ ...current, ...patch }));
  useEffect(() => {
    if (!focus) return;
    const node = document.getElementById(`editor-${focus}`);
    node?.scrollIntoView({ block: "center" });
    const input = node?.querySelector("input, select, textarea");
    if (input instanceof HTMLElement) input.focus();
  }, [focus]);
  const control = "h-11 w-full rounded-xl border border-line bg-panel px-3 outline-none focus:border-accent";
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <p className="font-display text-3xl">{batch ? "Add a batch" : draft.id ? "Edit piece" : "Add a piece"}</p>
        </div>
        {onImport ? (
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
      {batch && onImport ? (
        <PasteImport onImport={onImport} />
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
        <button
          type="button"
          className="press h-11 rounded-full border border-line text-sm"
          onClick={() => {
            const us = convertToUs(draft.sizeSystem, draft.sizeLabel, draft.fit);
            if (us) set({ usSize: us });
          }}
        >
          Convert to US {draft.usSize ? `· ${draft.usSize}` : ""}
        </button>
        <div className="grid grid-cols-2 gap-3">
          <Field id="editor-cost" label="Cost">
            <input inputMode="decimal" defaultValue={(draft.costCents / 100).toFixed(2)} onChange={(event) => set({ costCents: dollarsToCents(event.target.value) })} className={control} />
          </Field>
          <Field id="editor-ask" label="Asking">
            <input inputMode="decimal" defaultValue={(draft.askCents / 100).toFixed(2)} onChange={(event) => set({ askCents: dollarsToCents(event.target.value) })} className={control} />
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
          <button type="button" className="press h-11 rounded-full border border-line px-5 text-sm" onClick={onClose}>Cancel</button>
        </div>
      </form>
      )}
    </Overlay>
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

function PasteImport({ onImport }: { onImport: (rows: PieceInput[]) => void }) {
  const [text, setText] = useState("");
  const [soldBatch, setSoldBatch] = useState(false);
  return (
    <div className="mt-4">
      <div className="flex gap-2">
        {([
          [false, "Available"],
          [true, "Already sold"],
        ] as const).map(([sold, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={soldBatch === sold}
            onClick={() => setSoldBatch(sold)}
            className={`press h-9 rounded-full border px-3 text-sm ${soldBatch === sold ? "border-accent bg-accent-soft" : "border-line"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        {soldBatch
          ? "Paste sold pairs. They go to the archive. The sale date, the final price, and the difference still count."
          : "Paste the note as you write it. A title, then one line per piece. Lines that say Sold go to Sold. The rest stay Available."}
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-3 h-40 w-full rounded-2xl border border-line bg-canvas p-3 text-sm outline-none focus:border-accent"
        placeholder={"Yellow Detail Classic Cowboy Design - Ramón\n_ 44 = 9.5 ($19) *Home* for — AddedAug28 - Sold\n_ 42 = 8.5 ($18) *Home* for — AddedAug29 - Sold"}
      />
      <button
        type="button"
        className="press mt-3 h-11 rounded-full bg-accent px-4 text-sm font-medium text-accent-ink"
        onClick={() => {
          const ledger = parseFloorNotes(text, new Date(), soldBatch);
          if (ledger.length) {
            onImport(ledger);
            return;
          }
          const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
          if (!lines.length) return;
          const headers = lines[0].split(/,|\t/).map((cell) => cell.trim().toLowerCase());
          const start = headers.some((cell) => cell.includes("name")) ? 1 : 0;
          const rows = lines.slice(start).map((line) => {
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
          if (rows.length) onImport(rows);
        }}
      >
        Import rows
      </button>
    </div>
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
