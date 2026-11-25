import { priceCutCents, type Piece, type PieceInput } from "./model";
import type { DetailedRow, LooseLine } from "./paste";
import { tx, type Lang } from "./i18n";

/**
 * LA BANDEJA (1.0.16) — the batch tray. The parser reads lines; the tray is where a whole
 * pasted document becomes a decision: batch rules asked once, a preview that classifies
 * every line, a review queue grouped by kind of doubt (never line by line), duplicate
 * clusters that complete an existing record instead of duplicating it, and an apply step
 * that imports only what was approved. Everything here is pure: the UI holds the state,
 * these functions do the thinking, and the tests drive them directly.
 */

export type BatchRules = {
  /** Usual asking price per style (cents, keyed by styleKey) — lets the price cut derive on sales whose ask was never written. */
  usualAsk: Record<string, number>;
  /** What a bare size number (no EU/CN written) means in this batch. CN is the standing default. */
  bareSize: "CN" | "EU";
  /** The year the batch belongs to, when the written dates carry none. */
  year: number | null;
  /** Where the pieces are, when a line does not say. */
  place: "" | "home" | "car";
};

export function defaultRules(): BatchRules {
  return { usualAsk: {}, bareSize: "CN", year: null, place: "" };
}

export function styleKey(name: string) {
  return name
    .replace(/\p{Extended_Pictographic}/gu, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const CLASS_KEY: Record<DetailedRow["kind"], "tray.classSale" | "tray.classStock" | "tray.classGift" | "tray.classReturned" | "tray.classUsed" | "tray.classKept" | "tray.classFailed"> = {
  sale: "tray.classSale",
  stock: "tray.classStock",
  gift: "tray.classGift",
  returned: "tray.classReturned",
  used: "tray.classUsed",
  kept: "tray.classKept",
  "failed-sale": "tray.classFailed",
};

export type TrayRow = {
  index: number;
  row: DetailedRow;
  input: PieceInput;
  light: "green" | "amber" | "red";
  classLabel: string;
  priceCut: number;
};

export type ClusterMember = { source: "batch"; index: number } | { source: "floor"; id: string };

export type DupCluster = {
  id: string;
  styleName: string;
  costCents: number;
  members: ClusterMember[];
  crossSource: boolean;
  sizeDiffers: boolean;
  /**
   * 1.9.0: a cluster is WEAK when not every pair of members is tied directly by the
   * dated rule (same style + cost + arrival within 3 days) — it was formed by a
   * chain through a middle piece, or by the undated content fingerprint. Weak
   * clusters are still asked about, but their pre-answer is "different" (P-15, P-16).
   */
  weak: boolean;
};

export type ReviewGroup = {
  id: string;
  label: string;
  rowIndexes: number[];
  options: { id: string; label: string }[];
  defaultOption: string;
};

export type TrayBatch = {
  rows: TrayRow[];
  loose: LooseLine[];
  groups: ReviewGroup[];
  clusters: DupCluster[];
  batchNotes: string[];
  styles: string[];
  totals: {
    rows: number;
    sales: number;
    salesDated: number;
    salesNoPrice: number;
    revenue: number;
    stockCost: number;
    rebates: number;
    delivery: number;
  };
};

function withYear(isoDate: string | null, year: number) {
  if (!isoDate) return isoDate;
  return `${year}${isoDate.slice(4)}`;
}

function applyRules(row: DetailedRow, rules: BatchRules): PieceInput {
  const input: PieceInput = { ...row.input };
  if (row.sizeBare && input.sizeSystem === "CN" && rules.bareSize !== "CN") input.sizeSystem = rules.bareSize;
  if (rules.year) {
    if (input.receivedOn && !row.addedYearWritten) input.receivedOn = withYear(input.receivedOn, rules.year);
    if (input.soldOn && !row.soldYearWritten) input.soldOn = withYear(input.soldOn, rules.year);
    // 1.9.0: the chronology bump is a guess about UNWRITTEN years — a sold year he
    // actually wrote is a fact, and the bump used to rewrite it (2025 → 2027) (P-14).
    if (input.receivedOn && input.soldOn && input.soldOn < input.receivedOn && !row.soldYearWritten) input.soldOn = withYear(input.soldOn, rules.year + 1);
  }
  if (rules.place && !input.place) input.place = rules.place;
  if (row.kind === "sale" && input.askCents === 0) {
    const usual = rules.usualAsk[styleKey(row.section || input.name)];
    if (usual) input.askCents = usual;
  }
  return input;
}

function daysApart(a: string, b: string) {
  const diff = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isNaN(diff) ? Infinity : Math.round(diff / 86_400_000);
}

/**
 * Same style, written two ways: one document's heading carries more descriptor words than
 * the other's ("True Black" against a three-word version of the same boot). Token containment
 * decides — combined with the exact cost and the arrival date, which a coincidence would
 * also have to match before the pair is even shown.
 */
function sameStyle(a: string, b: string) {
  const ka = styleKey(a);
  const kb = styleKey(b);
  if (ka === kb) return true;
  const ta = new Set(ka.split(" ").filter(Boolean));
  const tb = new Set(kb.split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  const containment = shared / Math.min(ta.size, tb.size);
  const jaccard = shared / (ta.size + tb.size - shared);
  return (shared >= 1 && containment >= 0.8) || jaccard >= 0.6;
}

type Candidate = {
  member: ClusterMember;
  name: string;
  costCents: number;
  receivedOn: string | null;
  size: string;
  askCents: number;
  saleCents: number | null;
};

function findClusters(rows: TrayRow[], existing: Piece[]): DupCluster[] {
  const candidates: Candidate[] = [];
  for (const trayRow of rows) {
    candidates.push({
      member: { source: "batch", index: trayRow.index },
      name: trayRow.input.name,
      costCents: trayRow.input.costCents,
      receivedOn: trayRow.input.receivedOn,
      size: `${trayRow.input.sizeLabel}|${trayRow.input.usSize}`,
      askCents: trayRow.input.askCents,
      saleCents: trayRow.input.saleCents,
    });
  }
  for (const piece of existing) {
    candidates.push({
      member: { source: "floor", id: piece.id },
      name: piece.name,
      costCents: piece.costCents,
      receivedOn: piece.receivedOn,
      size: `${piece.sizeLabel}|${piece.usSize}`,
      askCents: piece.askCents,
      saleCents: piece.saleCents,
    });
  }
  // Union-find over "same style + same cost + arrival within 3 days". The size is only a soft
  // signal: Oscar's own documents show the same piece written 44 in one and 43 in the other.
  // 1.9.0: when either side carries no arrival date, the dated rule cannot speak at all —
  // the pair is tied instead by a content fingerprint (same style, cost, size, ask and
  // sale), so an undated document pasted twice is ASKED about instead of silently
  // duplicated (P-16). Fingerprint and chain-formed clusters are weak: see DupCluster.
  const datedPair = (a: Candidate, b: Candidate) =>
    !!a.receivedOn && !!b.receivedOn && daysApart(a.receivedOn, b.receivedOn) <= 3;
  const fingerPair = (a: Candidate, b: Candidate) =>
    a.size === b.size && a.askCents === b.askCents && a.saleCents === b.saleCents;
  const parent = candidates.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (!sameStyle(a.name, b.name) || a.costCents !== b.costCents) continue;
      // The fingerprint speaks only when a date is missing on some side — two dated
      // pieces far apart stay unclustered, exactly as before.
      if (!datedPair(a, b) && !((!a.receivedOn || !b.receivedOn) && fingerPair(a, b))) continue;
      parent[find(i)] = find(j);
    }
  }
  const byRoot = new Map<number, Candidate[]>();
  candidates.forEach((candidate, i) => {
    const root = find(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), candidate]);
  });
  const clusters: DupCluster[] = [];
  for (const members of byRoot.values()) {
    if (members.length < 2) continue;
    const sources = new Set(members.map((m) => m.member.source));
    // Weak when any pair inside is not tied directly by the dated rule: a chain
    // (A–B and B–C dated, A–C not) used to absorb a piece 4+ days from the floor
    // record on the strength of its neighbours alone (P-15).
    let weak = false;
    for (let i = 0; i < members.length && !weak; i++) {
      for (let j = i + 1; j < members.length; j++) {
        if (!datedPair(members[i], members[j])) {
          weak = true;
          break;
        }
      }
    }
    clusters.push({
      id: `dup-${clusters.length}`,
      styleName: members[0].name,
      costCents: members[0].costCents,
      members: members.map((m) => m.member),
      crossSource: sources.size > 1,
      sizeDiffers: new Set(members.map((m) => m.size)).size > 1,
      weak,
    });
  }
  return clusters;
}

export function buildTray(parsed: { rows: DetailedRow[]; loose: LooseLine[] }, existing: Piece[], rules: BatchRules, lang: Lang = "en"): TrayBatch {
  const rows: TrayRow[] = parsed.rows.map((row, index) => {
    const input = applyRules(row, rules);
    const junk = (row.kind === "stock" || row.kind === "used") && input.costCents === 0 && input.askCents === 0 && !input.notes;
    const light: TrayRow["light"] = junk ? "red" : row.issues.length > 0 || row.costState !== "" || input.problem === "unsure" ? "amber" : "green";
    return {
      index,
      row,
      input,
      light,
      classLabel: row.kind === "sale" ? tx(lang, row.soldDated ? "tray.classSaleDated" : "tray.classSaleNoDate") : tx(lang, CLASS_KEY[row.kind]),
      priceCut: priceCutCents(input),
    };
  });
  const clusters = findClusters(rows, existing);
  const indexesWhere = (pick: (row: DetailedRow) => boolean) => parsed.rows.map((row, i) => (pick(row) ? i : -1)).filter((i) => i >= 0);
  const groups: ReviewGroup[] = [];
  const addGroup = (group: ReviewGroup) => {
    if (group.rowIndexes.length) groups.push(group);
  };
  addGroup({
    id: "returns",
    label: tx(lang, "tray.gReturns"),
    rowIndexes: indexesWhere((row) => row.kind === "returned"),
    options: [
      { id: "import-stock", label: tx(lang, "tray.gReturnsImport") },
      { id: "skip", label: tx(lang, "tray.gSkip") },
    ],
    defaultOption: "import-stock",
  });
  addGroup({
    id: "bad-arithmetic",
    label: tx(lang, "tray.gArith"),
    rowIndexes: indexesWhere((row) => row.issues.includes("bad-arithmetic")),
    options: [
      { id: "keep-written", label: tx(lang, "tray.gArithKeep") },
      { id: "skip", label: tx(lang, "tray.gSkipRows") },
    ],
    defaultOption: "keep-written",
  });
  addGroup({
    id: "uncertain-rebate",
    label: tx(lang, "tray.gRebate"),
    rowIndexes: indexesWhere((row) => row.issues.includes("uncertain-rebate") || row.issues.includes("rebate-no-amount")),
    options: [
      { id: "keep", label: tx(lang, "tray.gRebateKeep") },
      { id: "zero", label: tx(lang, "tray.gRebateZero") },
    ],
    defaultOption: "keep",
  });
  addGroup({
    id: "names",
    label: tx(lang, "tray.gNames"),
    rowIndexes: indexesWhere((row) => !!row.person && row.kind !== "sale"),
    options: [
      { id: "keep-out", label: tx(lang, "tray.gNamesOut") },
      { id: "as-client", label: tx(lang, "tray.gNamesClient") },
    ],
    defaultOption: "keep-out",
  });
  addGroup({
    id: "coming-sold",
    label: tx(lang, "tray.gComingSold"),
    rowIndexes: indexesWhere((row) => row.issues.includes("coming-sold")),
    options: [
      { id: "as-sold", label: tx(lang, "tray.gComingSoldCount") },
      { id: "as-incoming", label: tx(lang, "tray.gComingKeep") },
    ],
    defaultOption: "as-sold",
  });
  addGroup({
    id: "true-cost",
    label: tx(lang, "tray.gTrueCost"),
    rowIndexes: indexesWhere((row) => row.issues.includes("true-cost")),
    options: [{ id: "ok", label: tx(lang, "tray.gUnderstood") }],
    defaultOption: "ok",
  });
  // 1.9.0: the Wave 5 parser flags land as review questions, never silent guesses.
  addGroup({
    id: "bad-date",
    label: tx(lang, "tray.gBadDate"),
    rowIndexes: indexesWhere((row) => row.issues.includes("bad-date")),
    options: [
      { id: "keep", label: tx(lang, "tray.gBadDateKeep") },
      { id: "skip", label: tx(lang, "tray.gSkipRows") },
    ],
    defaultOption: "keep",
  });
  addGroup({
    id: "two-pieces",
    label: tx(lang, "tray.gTwoPieces"),
    rowIndexes: indexesWhere((row) => row.issues.includes("two-pieces")),
    options: [{ id: "ok", label: tx(lang, "tray.gUnderstood") }],
    defaultOption: "ok",
  });
  addGroup({
    id: "no-cost",
    label: tx(lang, "tray.gNoCost"),
    rowIndexes: indexesWhere((row) => row.issues.includes("no-cost")),
    options: [{ id: "ok", label: tx(lang, "tray.gUnderstood") }],
    defaultOption: "ok",
  });
  const personalIndexes = indexesWhere((row) => !!row.personalNote);
  const loosePersonal = parsed.loose.filter((line) => line.kind === "personal");
  if (personalIndexes.length || loosePersonal.length) {
    groups.push({
      id: "personal-notes",
      label: tx(lang, "tray.gNotes"),
      rowIndexes: personalIndexes,
      options: [
        { id: "keep-note", label: tx(lang, "tray.gNotesKeep") },
        { id: "discard", label: tx(lang, "tray.gNotesDiscard") },
      ],
      defaultOption: "keep-note",
    });
  }
  const batchNotes = [
    ...parsed.rows.filter((row) => row.personalNote).map((row) => row.personalNote),
    ...loosePersonal.map((line) => line.text),
  ];
  const styles: string[] = [];
  for (const row of parsed.rows) {
    const name = row.section || row.input.name;
    if (name && !styles.includes(name)) styles.push(name);
  }
  const sales = rows.filter((trayRow) => trayRow.row.kind === "sale");
  return {
    rows,
    loose: parsed.loose,
    groups,
    clusters,
    batchNotes,
    styles,
    totals: {
      rows: rows.length,
      sales: sales.length,
      salesDated: sales.filter((trayRow) => trayRow.row.soldDated).length,
      salesNoPrice: sales.filter((trayRow) => trayRow.input.saleCents == null).length,
      // Money on a row is per unit; the model's own arithmetic multiplies
      // by qty (profitOf). Ledger rows always carry qty 1 — the loose
      // reader's rows are the ones that can carry more.
      revenue: sales.reduce((sum, trayRow) => sum + (trayRow.input.saleCents ?? 0) * Math.max(1, trayRow.input.qty || 1), 0),
      stockCost: rows.filter((trayRow) => trayRow.row.kind === "stock" || trayRow.row.kind === "used").reduce((sum, trayRow) => sum + trayRow.input.costCents * Math.max(1, trayRow.input.qty || 1), 0),
      rebates: rows.reduce((sum, trayRow) => sum + trayRow.input.buyRebateCents * Math.max(1, trayRow.input.qty || 1), 0),
      delivery: rows.reduce((sum, trayRow) => sum + trayRow.input.deliveryCents * Math.max(1, trayRow.input.qty || 1), 0),
    },
  };
}

export type TrayDecisions = {
  groups: Record<string, string>;
  clusters: Record<string, "same" | "different">;
  include: Record<number, boolean>;
};

export function defaultDecisions(batch: TrayBatch): TrayDecisions {
  const groups: Record<string, string> = {};
  for (const group of batch.groups) groups[group.id] = group.defaultOption;
  const clusters: Record<string, "same" | "different"> = {};
  // The pre-answer follows how his notebook actually works (1.4.0). A cluster that reaches a
  // piece ALREADY on the floor is the same piece written twice — complete its record. But a
  // line repeated inside ONE list is another pair: he counts pairs by lines and numbers
  // identical pairs separately in his own ledgers, so the default lands each line as its own
  // piece. The card asks either way; only the pre-answer changed. The old blanket "same"
  // silently merged 7 of his 46 on-hand lines into their twins.
  // 1.9.0: only a DIRECT dated match earns the "same" pre-answer. A chain-formed or
  // fingerprint cluster (weak) is asked about with "different" pre-answered, so
  // nothing is absorbed on a neighbour's say-so or on content alone (P-15, P-16).
  for (const cluster of batch.clusters) clusters[cluster.id] = cluster.crossSource && !cluster.weak ? "same" : "different";
  const include: Record<number, boolean> = {};
  for (const trayRow of batch.rows) include[trayRow.index] = trayRow.light !== "red";
  return { groups, clusters, include };
}

/** Complete a record with what another record knows; never overwrite a fact with an empty. */
function completeInto(target: PieceInput, source: PieceInput) {
  const next: PieceInput = { ...target };
  if (next.saleCents == null && source.saleCents != null) next.saleCents = source.saleCents;
  if (!next.soldOn && source.soldOn) next.soldOn = source.soldOn;
  if (!next.receivedOn && source.receivedOn) next.receivedOn = source.receivedOn;
  if (!next.clientName && source.clientName) next.clientName = source.clientName;
  if (!next.channel && source.channel) next.channel = source.channel;
  if (!next.source && source.source) next.source = source.source;
  if (!next.brand && source.brand) next.brand = source.brand;
  if (!next.sizeLabel && source.sizeLabel) next.sizeLabel = source.sizeLabel;
  if (!next.usSize && source.usSize) next.usSize = source.usSize;
  if (!next.place && source.place) next.place = source.place;
  if (!next.photo && source.photo) next.photo = source.photo;
  if (next.askCents === 0 && source.askCents > 0) next.askCents = source.askCents;
  next.buyRebateCents = Math.max(next.buyRebateCents, source.buyRebateCents);
  next.deliveryCents = Math.max(next.deliveryCents, source.deliveryCents);
  if (source.wasSold && !next.wasSold) {
    next.wasSold = true;
    next.status = source.status === "sold" || source.status === "archived" ? source.status : "sold";
    if (next.saleCents == null) next.saleCents = source.saleCents;
    if (!next.soldOn) next.soldOn = source.soldOn;
  }
  const bits = [next.notes, source.notes].filter(Boolean).join(" · ").split(" · ").map((bit) => bit.trim()).filter(Boolean);
  next.notes = [...new Set(bits)].join(" · ");
  return next;
}

export function applyTray(batch: TrayBatch, decisions: TrayDecisions, existing: Piece[]): { add: PieceInput[]; update: PieceInput[]; batchNotes: string[] } {
  const group = (id: string) => decisions.groups[id];
  const inputs = new Map<number, PieceInput>();
  for (const trayRow of batch.rows) {
    if (decisions.include[trayRow.index] === false) continue;
    const row = trayRow.row;
    if (row.kind === "returned" && group("returns") === "skip") continue;
    if (row.issues.includes("bad-arithmetic") && group("bad-arithmetic") === "skip") continue;
    if (row.issues.includes("bad-date") && group("bad-date") === "skip") continue;
    let input: PieceInput = { ...trayRow.input };
    if ((row.issues.includes("uncertain-rebate") || row.issues.includes("rebate-no-amount")) && group("uncertain-rebate") === "zero") {
      input = { ...input, buyRebateCents: 0 };
    }
    if (row.kind !== "sale" && row.person && group("names") === "as-client") {
      input = { ...input, clientName: row.person };
    }
    if (row.issues.includes("coming-sold") && group("coming-sold") === "as-incoming") {
      input = {
        ...input,
        status: "incoming",
        wasSold: false,
        askCents: input.askCents === 0 && input.saleCents != null ? input.saleCents : input.askCents,
        saleCents: null,
        soldOn: null,
      };
    }
    inputs.set(trayRow.index, input);
  }

  const add: PieceInput[] = [];
  const update: PieceInput[] = [];
  const absorbed = new Set<number>();
  for (const cluster of batch.clusters) {
    if (decisions.clusters[cluster.id] !== "same") continue;
    const batchMembers = cluster.members.filter((m): m is { source: "batch"; index: number } => m.source === "batch" && inputs.has(m.index));
    if (!batchMembers.length) continue;
    const floorMember = cluster.members.find((m): m is { source: "floor"; id: string } => m.source === "floor");
    if (floorMember) {
      const floorPiece = existing.find((piece) => piece.id === floorMember.id);
      if (!floorPiece) continue;
      let merged: PieceInput = { ...floorPiece };
      for (const member of batchMembers) {
        merged = completeInto(merged, inputs.get(member.index)!);
        absorbed.add(member.index);
      }
      update.push(merged);
    } else if (batchMembers.length > 1) {
      let merged = inputs.get(batchMembers[0].index)!;
      for (const member of batchMembers.slice(1)) {
        merged = completeInto(merged, inputs.get(member.index)!);
        absorbed.add(member.index);
      }
      inputs.set(batchMembers[0].index, merged);
    }
  }
  for (const [index, input] of inputs) {
    if (!absorbed.has(index)) add.push(input);
  }
  return {
    add,
    update,
    batchNotes: group("personal-notes") === "discard" ? [] : [...batch.batchNotes],
  };
}
