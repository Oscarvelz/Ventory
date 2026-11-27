// Ventory tray + parser tests. Every document here is INVENTED — Oscar's real notebooks
// stay outside the repo (acceptance over them runs locally, counts only). Run: npm test.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert";

const out = mkdtempSync(path.join(tmpdir(), "ventory-test-"));
execSync(
  `npx tsc src/lib/ventory/model.ts src/lib/ventory/paste.ts src/lib/ventory/tray.ts src/lib/ventory/loose.ts src/lib/ventory/loose-lexicon.ts src/lib/ventory/ask.ts src/lib/ventory/ask-lexicon.ts --outDir ${out} --module commonjs --target es2022 --moduleResolution node --skipLibCheck`,
  { stdio: "pipe" },
);
const require = createRequire(import.meta.url);
const { parseDetailedNotes } = require(path.join(out, "paste.js"));
const { parseLooseText, looksLoose } = require(path.join(out, "loose.js"));
const tray = require(path.join(out, "tray.js"));
const model = require(path.join(out, "model.js"));

const today = new Date(2026, 10, 7);
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
};
const rowsOf = (text) => parseDetailedNotes(text, today, false).rows;

test("for $X reads by context: charged on a sold line, ask on a stock line, never copied across", () => {
  const [sold] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $35 — AddedAug28 - SoldSep2");
  assert.equal(sold.kind, "sale");
  assert.equal(sold.input.saleCents, 3500);
  assert.equal(sold.input.askCents, 0);
  const [stock] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28");
  assert.equal(stock.kind, "stock");
  assert.equal(stock.input.askCents, 4000);
  assert.equal(stock.input.saleCents, null);
});

test("the arrow writes both sides: ask 40, charged 35, derived cut 5", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 → $35 — AddedAug28 - SoldSep2");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.askCents, 4000);
  assert.equal(row.input.saleCents, 3500);
  assert.equal(model.priceCutCents(row.input), 500);
});

test("the usual-ask batch rule fills a missing ask so the cut can derive", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $35 — AddedAug28 - SoldSep2", today, false);
  const batch = tray.buildTray(parsed, [], { ...tray.defaultRules(), usualAsk: { [tray.styleKey("Test Boots")]: 4000 } });
  assert.equal(batch.rows[0].input.askCents, 4000);
  assert.equal(batch.rows[0].priceCut, 500);
});

test("cost arithmetic in parentheses becomes cost + rebate, never a size", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20.00 − 5.00 = 15.00) *Home* for $40 — AddedAug28");
  assert.equal(row.input.costCents, 2000);
  assert.equal(row.input.buyRebateCents, 500);
  assert.equal(model.effectiveCostCents(row.input), 1500);
  assert.notEqual(row.input.usSize, "15.00");
  assert.equal(row.issues.includes("bad-arithmetic"), false);
});

test("arithmetic that does not square is flagged, and the written final number wins", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 $20.00 − $5.00 off = $14.00 *Home* for $40 — AddedAug28");
  assert.equal(row.issues.includes("bad-arithmetic"), true);
  assert.equal(model.effectiveCostCents(row.input), 1400);
});

test("an off bigger than the cost is recorded and flagged, not silently capped", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($19.06) *Home* ($20 off) for $45 — AddedAug28");
  assert.equal(row.input.buyRebateCents, 2000);
  assert.equal(row.issues.includes("uncertain-rebate"), true);
});

test("a credit with no amount is flagged and never invented", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($30) *Home* (RewardsBack) for $45 — AddedAug28");
  assert.equal(row.input.buyRebateCents, 0);
  assert.equal(row.issues.includes("rebate-no-amount"), true);
});

test("percent off: written amount wins; a bare percent is computed on the cost", () => {
  const [written] = rowsOf("# Test Boots\n_ 44 = 9.5 ($36) *Home* 60% off (−$21+) for $45 — AddedAug28");
  assert.equal(written.input.buyRebateCents, 2100);
  const [bare] = rowsOf("# Test Boots\n_ 44 = 9.5 ($50) *Home* 10% off for $45 — AddedAug28");
  assert.equal(bare.input.buyRebateCents, 500);
});

test("delivery is its own money in all three written forms, never inside the price", () => {
  const [plus] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 + $10 delivery — AddedAug28 - SoldSep2");
  assert.equal(plus.input.saleCents, 4000);
  assert.equal(plus.input.deliveryCents, 1000);
  const [dbl] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 for $50 (delivery $10) — AddedAug28");
  assert.equal(dbl.input.askCents, 4000);
  assert.equal(dbl.input.deliveryCents, 1000);
  const [bare] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 + 11.15 to Marta Prueba — AddedAug28 - SoldSep2");
  assert.equal(bare.input.saleCents, 4000);
  assert.equal(bare.input.deliveryCents, 1115);
});

test("a return is never a sale", () => {
  const [row] = rowsOf("# Test Watches\n_ Classic watch ($30) *Home* for $40 — AddedAug28 - RETURNED GIFT");
  assert.equal(row.kind, "returned");
  assert.equal(row.input.wasSold, false);
  assert.equal(row.input.saleCents, null);
});

test("names: client only on a sale; a gift keeps its recipient in the notes; stock keeps it out", () => {
  const [sale] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28 - SoldSep2 to Marta Prueba");
  assert.equal(sale.input.clientName, "Marta Prueba");
  const [gift] = rowsOf("# Test Watches\n_ Classic watch ($30) *Home* — Marta Prueba's present");
  assert.equal(gift.kind, "gift");
  assert.equal(gift.input.clientName, "");
  assert.match(gift.input.notes, /For Marta Prueba/);
  const [stock] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 for Marta Prueba — AddedAug28");
  assert.equal(stock.input.clientName, "");
  assert.equal(stock.person, "Marta Prueba");
});

test("vehicles are marks, not a place; marks are kept verbatim", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) 🚚✨ *Home* for $40 — AddedAug28");
  assert.equal(row.input.place, "home");
  assert.match(row.input.notes, /Marks: 🚚✨/);
  const [car] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) 🛻🛻 for $40 — AddedAug28");
  assert.equal(car.input.place, "");
  assert.match(car.input.notes, /Marks: 🛻🛻/);
});

test("size ranges keep both ends and BOX keeps its number", () => {
  const [range] = rowsOf("# Test Boots\n_ 44 = 8 a 8.5 ($20) *Home* for $40 — AddedAug28");
  assert.equal(range.input.usSize, "8");
  assert.match(range.input.notes, /or 8\.5/);
  const [zero] = rowsOf("# Test Boots\n_ 44 = 9.5 0 10 ($20) *Home* for $40 — AddedAug28");
  assert.equal(zero.input.usSize, "9.5");
  assert.match(zero.input.notes, /or 10/);
  const [box] = rowsOf("# Test Boots\n_ 44 = BOX 9 ($20) *Home* for $40 — AddedAug28");
  assert.equal(box.input.usSize, "BOX 9");
  assert.equal(box.input.sizeLabel, "44");
});

test("Coming and Sold at once is a question, not a silent answer; the tray can keep it incoming", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* Coming for $40 — AddedAug28 - SoldSep2 💙", today, false);
  assert.equal(parsed.rows[0].issues.includes("coming-sold"), true);
  const batch = tray.buildTray(parsed, [], tray.defaultRules());
  const decisions = tray.defaultDecisions(batch);
  decisions.groups["coming-sold"] = "as-incoming";
  const applied = tray.applyTray(batch, decisions, []);
  assert.equal(applied.add[0].status, "incoming");
  assert.equal(applied.add[0].saleCents, null);
  assert.equal(applied.add[0].askCents, 4000);
});

test("a personal note rides off the piece and into the batch notes", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28 - SoldDec26. Mi tía ha muerto", today, false);
  assert.equal(parsed.rows[0].kind, "sale");
  assert.match(parsed.rows[0].personalNote, /Mi tía ha muerto/);
  assert.doesNotMatch(parsed.rows[0].input.notes, /muerto/);
  const batch = tray.buildTray(parsed, [], tray.defaultRules());
  const applied = tray.applyTray(batch, tray.defaultDecisions(batch), []);
  assert.equal(applied.batchNotes.length, 1);
});

test("kept and failed-sale lines land in their own classes", () => {
  const [kept] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* — I added this to my wallet. Not sure if staying with them is the best");
  assert.equal(kept.kind, "kept");
  assert.equal(kept.input.status, "kept");
  const [failed] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 for Marta Prueba. No los quiso luego — AddedAug28");
  assert.equal(failed.kind, "failed-sale");
  assert.equal(failed.input.clientName, "");
  assert.equal(failed.input.wasSold, false);
});

test("the rejection and the return speak Spanish too, in every number", () => {
  const [singular] = rowsOf("# Test Watches\n_ Classic watch ($20) *Home* for $48 — AddedApr1. No lo quiso luego");
  assert.equal(singular.kind, "failed-sale");
  assert.equal(singular.input.clientName, "");
  const [devuelto] = rowsOf("# Test Boots\n_ 45 = 10 ($20) *Home* for $40 — AddedFeb13 - Fue devuelto");
  assert.equal(devuelto.kind, "returned");
  const [devuelta] = rowsOf("# Test Watches\n_ Classic watch ($20) *Home* for $40 — AddedFeb13 - Fue devuelta");
  assert.equal(devuelta.kind, "returned");
});

test("gift words are captured in the plural too, and a ($Gift) cost is a gift cost", () => {
  const [plural] = rowsOf("# Test Boots\n_ 44 = 9.5 ($28) *Home* for $40 — AddedAug28 - Sold GIFTS 🥬💚");
  assert.match(plural.input.notes, /Gift/);
  assert.match(plural.input.notes, /Marks: 🥬💚/);
  const [giftCost] = rowsOf("# Test Watches\n_ Classic watch ($Gift) *Home* for $40 — AddedAug28 - SoldSep2");
  assert.equal(giftCost.input.costCents, 0);
  assert.equal(giftCost.costState, "gift");
});

test("duplicates: same piece completes the floor record; different pieces both land", () => {
  const floorPiece = {
    id: "floor-1", sort: 1, name: "Test Boots", category: "Boot", subcategory: "", brand: "", status: "available",
    qty: 1, sizeSystem: "CN", sizeLabel: "44", usSize: "9.5", fit: "men", costCents: 2228, askCents: 3500,
    saleCents: null, buyRebateCents: 0, deliveryCents: 0, source: "", channel: "", clientName: "",
    receivedOn: "2026-04-18", soldOn: null, notes: "", place: "home", photo: "", problem: "", wasSold: false,
  };
  const parsed = parseDetailedNotes("# Test Boots\n_ 42 = 8.5 ($22.28) *Home* for $35 — AddedApr18 - SoldJun3", today, false);
  const batch = tray.buildTray(parsed, [floorPiece], tray.defaultRules());
  assert.equal(batch.clusters.length, 1);
  assert.equal(batch.clusters[0].crossSource, true);
  assert.equal(batch.clusters[0].sizeDiffers, true);
  const same = tray.applyTray(batch, tray.defaultDecisions(batch), [floorPiece]);
  assert.equal(same.add.length, 0);
  assert.equal(same.update.length, 1);
  assert.equal(same.update[0].saleCents, 3500);
  assert.equal(same.update[0].soldOn, "2026-06-03");
  const decisions = tray.defaultDecisions(batch);
  decisions.clusters[batch.clusters[0].id] = "different";
  const different = tray.applyTray(batch, decisions, [floorPiece]);
  assert.equal(different.add.length, 1);
  assert.equal(different.update.length, 0);
});

test("profitOf: one definition — rebate lowers cost, delivery is collected but never profit", () => {
  const piece = { costCents: 2000, buyRebateCents: 500, deliveryCents: 1000, saleCents: 3500, askCents: 4000, qty: 1 };
  const result = model.profitOf(piece);
  assert.equal(result.revenue, 3500);
  assert.equal(result.cost, 1500);
  assert.equal(result.profit, 2000);
  assert.equal(result.collected, 4500);
  assert.equal(model.priceCutCents(piece), 500);
  assert.equal(model.profitOf({ ...piece, saleCents: null }), null);
  assert.equal(model.effectiveCostCents({ costCents: 100, buyRebateCents: 250 }), 0);
});

test("a bare '- Sold' follows the batch's answer: on hand it lands on the floor, already sold it lands in the archive", () => {
  // The notebook writes "- Sold" at the end of nearly every line — it is the slot where a
  // sold date will go, not a report that the piece left. Only a sold DATE is proof (next test).
  const doc = "Classic Leather Riding Boots\n_ 43 = 9 ($22) *Home* for $55 — AddedSep03 - Sold\n_ 41 = 8 ($21) *Home* for $55 — AddedSep04";
  const forSale = parseDetailedNotes(doc, today, false).rows;
  assert.equal(forSale[0].kind, "stock");
  assert.equal(forSale[0].input.status, "available");
  assert.equal(forSale[0].input.saleCents, null);
  assert.equal(forSale[0].input.soldOn, null);
  assert.equal(forSale[0].input.askCents, 5500); // on an unsold line "for $55" is the ask
  assert.equal(forSale[1].kind, "stock");
  assert.equal(forSale[1].input.status, "available");
  const sold = parseDetailedNotes(doc, today, true).rows;
  assert.equal(sold.length, 2);
  for (const row of sold) {
    assert.equal(row.kind, "sale");
    assert.equal(row.input.wasSold, true);
    assert.equal(row.input.status, "archived");
    assert.equal(row.input.saleCents, 5500);
  }
  assert.equal(sold[1].input.receivedOn, "2026-09-04");
  const batch = tray.buildTray(parseDetailedNotes(doc, today, true), [], tray.defaultRules());
  assert.equal(batch.totals.sales, 2);
  assert.equal(batch.totals.revenue, 11000);
});

test("a sold DATE is proof in any batch: it outranks the On hand answer", () => {
  const doc = "Classic Leather Riding Boots\n_ 43 = 9 ($22) *Home* for $55 — AddedSep03 - SoldSep10\n_ 42 = 8.5 ($20) *Home* for $55 — AddedSep04 - Sold";
  const rows = parseDetailedNotes(doc, today, false).rows;
  assert.equal(rows[0].kind, "sale");
  assert.equal(rows[0].input.status, "sold");
  assert.equal(rows[0].input.soldOn, "2026-09-10");
  assert.equal(rows[0].input.saleCents, 5500);
  assert.equal(rows[1].kind, "stock"); // the bare word alone proves nothing
  const phrased = parseDetailedNotes("Work Boots\n_ 41 = 8 ($18) *Home* for $40 — AddedJan05 - Sold on Aug27", today, false).rows;
  assert.equal(phrased[0].kind, "sale");
  assert.equal(phrased[0].input.soldOn, "2026-08-27");
  const spanish = parseDetailedNotes("# Dress Watches\n_ = ($19) *Home* for $40 — AddedDec10 - SoldDic18", today, false).rows;
  assert.equal(spanish[0].kind, "sale");
  assert.equal(spanish[0].input.soldOn, "2025-12-18"); // his Dic is December
});

test("a bare '- Sold' on a Coming line in an on-hand batch is plain incoming — no false alarm", () => {
  const doc = "Trail Boots\n_ 44 = 9.5 ($26) *Coming* for — AddedAug09 - Sold";
  const rows = parseDetailedNotes(doc, today, false).rows;
  assert.equal(rows[0].kind, "stock");
  assert.equal(rows[0].input.status, "incoming");
  assert.equal(rows[0].issues.includes("coming-sold"), false);
  const dated = parseDetailedNotes("Trail Boots\n_ 44 = 9.5 ($26) *Coming* for $40 — AddedAug09 - SoldSep02", today, true).rows;
  assert.equal(dated[0].kind, "sale");
  assert.equal(dated[0].issues.includes("coming-sold"), true);
});

test("an explicit gift marker with no recipient named is a gift, not a sale, in an on-hand batch", () => {
  const doc = "Classic Leather Riding Boots\n_ 43 = 9 ($28) *Home* for — AddedJun29 - Sold GIFT\n_ 42 = 8.5 ($24) *Home* for — AddedJun30 - Sold GIFFTS";
  const rows = parseDetailedNotes(doc, today, false).rows;
  assert.equal(rows[0].kind, "gift");
  assert.equal(rows[0].input.status, "archived");
  assert.equal(rows[0].input.saleCents, null);
  assert.equal(rows[1].kind, "gift"); // his wobbling spelling still reads as a gift
});

test("a watch line with no size at all follows the batch like any other line", () => {
  const doc = "# Silver Dress Watches\n_ = ($20) *Home* for — AddedJan05 - Sold";
  const onHand = parseDetailedNotes(doc, today, false).rows;
  assert.equal(onHand[0].kind, "stock");
  assert.equal(onHand[0].input.status, "available");
  const sold = parseDetailedNotes(doc, today, true).rows;
  assert.equal(sold[0].kind, "sale");
  assert.equal(sold[0].input.status, "archived");
});

test("an index written before a word is an index; a CN size wearing a dot is a size", () => {
  const doc = "# Silver Dress Watches\n+ 2. Dressy open-heart watch for $40 Dec6\n# Plain Boots\n_ 44. = 9.5 ($25) *Home* for — AddedApr02 - Sold";
  const rows = parseDetailedNotes(doc, today, true).rows;
  assert.equal(rows[0].input.name, "Dressy open-heart watch");
  assert.equal(rows[1].input.sizeSystem, "CN");
  assert.equal(rows[1].input.sizeLabel, "44");
  assert.equal(rows[1].input.usSize, "9.5");
});

test("a bare size number keeps CN by default and takes the batch's word when the batch says EU", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28", today, false);
  assert.equal(parsed.rows[0].sizeBare, true);
  assert.equal(parsed.rows[0].input.sizeSystem, "CN");
  const batch = tray.buildTray(parsed, [], { ...tray.defaultRules(), bareSize: "EU" });
  assert.equal(batch.rows[0].input.sizeSystem, "EU");
});


test("cluster pre-answers: a repeated line inside one list is another pair; a match on the floor completes the record", () => {
  const doc = "# Test Boots\n_ 44 = 9.5 ($19) *Home* for $40 — AddedAug28 - Sold\n_ 44 = 9.5 ($19) *Home* for $40 — AddedAug28 - Sold";
  const parsed = parseDetailedNotes(doc, today, true);
  const batch = tray.buildTray(parsed, [], tray.defaultRules());
  assert.equal(batch.clusters.length, 1);
  assert.equal(batch.clusters[0].crossSource, false);
  const applied = tray.applyTray(batch, tray.defaultDecisions(batch), []);
  assert.equal(applied.add.length, 2); // each numbered line is a pair of its own
  assert.equal(applied.update.length, 0);
});

// ── Wave 5 (1.9.0): the prejudice specimens P-1…P-17, pinned ─────────────────────
const { parseAddedDate } = require(path.join(out, "paste.js"));

test("P-17: a CR-only document parses line by line — nothing vanishes into one heading", () => {
  const rows = rowsOf("# Trail Boots\r_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28\r_ 45 = 10 ($22) *Home* for $45 — AddedAug29");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].input.costCents, 2200);
});

test("P-1: bare dates read in written order — first is the arrival, second may be the sale", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — Aug28 Sep10 - Sold");
  assert.equal(row.input.receivedOn, "2026-08-28");
  assert.equal(row.input.soldOn, "2026-09-10");
  assert.equal(row.kind, "sale");
  const [single] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — Sep10 - Sold");
  assert.equal(single.input.receivedOn, "2026-09-10");
  assert.equal(single.input.soldOn, null);
  assert.equal(single.kind, "stock");
});

test("P-2/P-3: count and price-range headings set the section — they never land as pieces", () => {
  const hats = rowsOf("SOLD: 48 Hats\n_ 44 = 9.5 ($10) *Home* for $20 — AddedAug28");
  assert.equal(hats.length, 1);
  assert.equal(hats[0].input.category, "Hat");
  const boots = rowsOf("Boots under $50\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28");
  assert.equal(boots.length, 1);
  assert.equal(boots[0].input.category, "Boot");
  assert.equal(boots[0].input.name, "Boots");
});

test("P-4: the sale formula after 'for' belongs to the sale — ask 40, charged 35, cost intact", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 − $5 off = $35 — AddedAug28 - SoldSep2");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.costCents, 2000);
  assert.equal(row.input.buyRebateCents, 0);
  assert.equal(row.input.askCents, 4000);
  assert.equal(row.input.saleCents, 3500);
});

test("P-5: a percent after a 'for $' price discounts the charged price, never the cost", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 10% off — AddedAug28 - SoldSep2");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.saleCents, 3600);
  assert.equal(row.input.buyRebateCents, 0);
  assert.ok(row.input.notes.includes("10% off"));
});

test("P-6: '($20) = 9.5' is a size equivalence — no invented rebate, the US size survives", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 ($20) = 9.5 *Home* for $40 — AddedAug28");
  assert.equal(row.input.costCents, 2000);
  assert.equal(row.input.buyRebateCents, 0);
  assert.equal(row.input.sizeLabel, "44");
  assert.equal(row.input.usSize, "9.5");
});

test("P-7: a US size after '=' is not a cost — the row lands costless and flagged", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.50 *Home* for $40 — AddedAug28");
  assert.equal(row.input.costCents, 0);
  assert.ok(row.issues.includes("no-cost"));
  const batch = tray.buildTray(parseDetailedNotes("# Test Boots\n_ 44 = 9.50 *Home* for $40 — AddedAug28", today, false), [], tray.defaultRules());
  assert.equal(batch.rows[0].light, "amber");
});

test("P-8: thousands commas are read whole — $1,200 is a cost, $1,500 is an ask", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($1,200) *Home* for $1,500 — AddedAug28");
  assert.equal(row.input.costCents, 120000);
  assert.equal(row.input.askCents, 150000);
});

test("P-9: impossible dates are dropped and flagged, never stored as facts", () => {
  const [added] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedFeb30");
  assert.equal(added.input.receivedOn, null);
  assert.ok(added.issues.includes("bad-date"));
  const [sold] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28 - SoldApr31");
  assert.equal(sold.input.soldOn, null);
  assert.ok(sold.issues.includes("bad-date"));
  assert.equal(sold.kind, "stock");
  assert.equal(parseAddedDate("Feb29", new Date(2026, 10, 7)), null);
  assert.equal(parseAddedDate("Feb29", new Date(2024, 5, 1)), "2024-02-29");
});

test("P-10: a half size is one label — CN 44.5 = US 9.5 reads whole", () => {
  const [row] = rowsOf("# Test Boots\n_ 44.5 = 9.5 ($20) *Home* for $40 — AddedAug28");
  assert.equal(row.input.sizeLabel, "44.5");
  assert.equal(row.input.usSize, "9.5");
  assert.equal(row.input.costCents, 2000);
});

test("P-11: the written word GIFT outranks an 'Already sold' batch answer", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) GIFT *Home* for $40 — AddedAug28", today, true);
  assert.equal(parsed.rows[0].kind, "gift");
  assert.equal(parsed.rows[0].input.saleCents, null);
});

test("P-12: plain 'delivery $10' is delivery money, in neither price nor cost", () => {
  const [row] = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 delivery $10 — AddedAug28 - SoldSep2");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.saleCents, 4000);
  assert.equal(row.input.deliveryCents, 1000);
});

test("P-13: two pieces on one line — the first is read whole, the row is flagged", () => {
  const rows = rowsOf("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40; 45 = 10 ($22) *Home* for $45 — AddedAug28");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input.costCents, 2000);
  assert.equal(rows[0].input.askCents, 4000);
  assert.equal(rows[0].input.sizeLabel, "44");
  assert.ok(rows[0].issues.includes("two-pieces"));
});

test("P-14: the tray never rewrites a year he actually wrote, even to fix chronology", () => {
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedDec28/2026 - SoldJan5/2025", today, false);
  assert.equal(parsed.rows[0].input.soldOn, "2025-01-05");
  const batch = tray.buildTray(parsed, [], { ...tray.defaultRules(), year: 2026 });
  assert.equal(batch.rows[0].input.soldOn, "2025-01-05");
});

test("P-15: a chain-formed cluster is asked about with 'different' pre-answered", () => {
  const floorPiece = {
    id: "floor-chain", sort: 1, name: "Test Boots", category: "Boot", subcategory: "", brand: "", status: "available",
    qty: 1, sizeSystem: "CN", sizeLabel: "44", usSize: "9.5", fit: "men", costCents: 2000, askCents: 4000,
    saleCents: null, buyRebateCents: 0, deliveryCents: 0, source: "", channel: "", clientName: "",
    receivedOn: "2026-08-01", soldOn: null, notes: "", place: "home", photo: "", problem: "", wasSold: false,
  };
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug3\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug5", today, false);
  const batch = tray.buildTray(parsed, [floorPiece], tray.defaultRules());
  assert.equal(batch.clusters.length, 1);
  assert.equal(batch.clusters[0].weak, true);
  const applied = tray.applyTray(batch, tray.defaultDecisions(batch), [floorPiece]);
  assert.equal(applied.add.length, 2);
  assert.equal(applied.update.length, 0);
});

test("P-16: an undated re-paste is asked about by fingerprint — never silently duplicated", () => {
  const floorPiece = {
    id: "floor-undated", sort: 1, name: "Test Boots", category: "Boot", subcategory: "", brand: "", status: "available",
    qty: 1, sizeSystem: "CN", sizeLabel: "44", usSize: "9.5", fit: "men", costCents: 2000, askCents: 4000,
    saleCents: null, buyRebateCents: 0, deliveryCents: 0, source: "", channel: "", clientName: "",
    receivedOn: null, soldOn: null, notes: "", place: "home", photo: "", problem: "", wasSold: false,
  };
  const parsed = parseDetailedNotes("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40", today, false);
  const batch = tray.buildTray(parsed, [floorPiece], tray.defaultRules());
  assert.equal(batch.clusters.length, 1);
  assert.equal(batch.clusters[0].crossSource, true);
  assert.equal(batch.clusters[0].weak, true);
  const applied = tray.applyTray(batch, tray.defaultDecisions(batch), [floorPiece]);
  assert.equal(applied.add.length, 1);
  assert.equal(applied.update.length, 0);
  const decisions = tray.defaultDecisions(batch);
  decisions.clusters[batch.clusters[0].id] = "same";
  const merged = tray.applyTray(batch, decisions, [floorPiece]);
  assert.equal(merged.add.length, 0);
  assert.equal(merged.update.length, 1);
});

// ------------------------------------------------------------------
// The loose-text reader (1.12.0): Vela's pattern carried to merchandise.
// Every text here is invented, like the rest of the suite.
const looseRows = (text, ctx = {}) => parseLooseText(text, today, ctx).rows;

test("L-1: a supplier message in Spanish settles as stock with qty, per-unit cost, size and arrival", () => {
  const [row] = looseRows("Hola amigo, buenas tardes. Ya me llegaron las botas Justin que pedí, son 3 pares talla 44, me costaron $38 cada uno. Llegaron ayer, se ven muy bien, el cuero es original.");
  assert.equal(row.kind, "stock");
  assert.equal(row.input.name, "botas Justin");
  assert.equal(row.input.brand, "Justin");
  assert.equal(row.input.qty, 3);
  assert.equal(row.input.costCents, 3800);
  assert.equal(row.input.sizeLabel, "44");
  assert.equal(row.input.receivedOn, "2026-11-06");
});

test("L-2: a two-sentence English purchase is ONE entry, named by its branded mention", () => {
  const rows = looseRows("Hi friend, the watches arrived yesterday. I bought 4 Casio watches at $22 each from Temu, they look great.");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input.name, "Casio watches");
  assert.equal(rows[0].input.qty, 4);
  assert.equal(rows[0].input.costCents, 2200);
  assert.equal(rows[0].input.source, "Temu");
  assert.equal(rows[0].input.receivedOn, "2026-11-06");
});

test("L-3: a sale note reads both sides of the deal — price, earlier cost, client, sale date", () => {
  const [row] = looseRows("Vendí las botas Justin a Juan Pérez por $55 el martes pasado. Me las había comprado en Temu a $38.");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.saleCents, 5500);
  assert.equal(row.input.costCents, 3800);
  assert.equal(row.input.clientName, "Juan Pérez");
  assert.equal(row.input.source, "Temu");
  assert.equal(row.input.soldOn, "2026-11-03");
});

test("L-4: an English sale note carries channel and a written date", () => {
  const [row] = looseRows("Sold the black leather boots to Maria Lopez for $60 on Nov 20, through Facebook Marketplace.");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.saleCents, 6000);
  assert.equal(row.input.clientName, "Maria Lopez");
  assert.equal(row.input.channel, "Facebook Marketplace");
  assert.equal(row.input.soldOn, "2026-11-20");
});

test("L-5: an ad's text is stock with an ask; its name keeps the text's own words", () => {
  const [row] = looseRows("Botas vaqueras de cuero, talla 44 (US 10), nuevas. Precio $65, se entrega en persona.");
  assert.equal(row.kind, "stock");
  assert.equal(row.input.name, "Botas vaqueras de cuero");
  assert.equal(row.input.askCents, 6500);
  assert.equal(row.input.sizeLabel, "44");
  assert.equal(row.input.usSize, "10");
  assert.equal(row.input.saleCents, null);
});

test("L-6: 'todavía no se ha vendido' is not a sale — the negation kills the verb, the ask survives", () => {
  const [row] = looseRows("Todavía no se ha vendido el reloj Casio, lo tengo en $45 por si alguien pregunta.");
  assert.equal(row.kind, "stock");
  assert.equal(row.input.saleCents, null);
  assert.equal(row.input.askCents, 4500);
  assert.ok(row.input.notes.includes("Todavía no se ha vendido"));
});

test("L-7: an apartado names its person for the tray's names question, never as client", () => {
  const [row] = looseRows("El sombrero quedó apartado para Pedro, me lo paga el viernes.");
  assert.equal(row.kind, "stock");
  assert.equal(row.person, "Pedro");
  assert.equal(row.input.clientName, "");
  assert.equal(row.input.soldOn, null);
  assert.equal(row.input.receivedOn, null);
  assert.ok(row.input.notes.includes("Apartado"));
});

test("L-8: two products in one message are two entries with their own money", () => {
  const rows = looseRows("Compré 2 relojes Casio a $20 cada uno y también vendí una chaqueta por $35 a Luis.");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].input.costCents, 2000);
  assert.equal(rows[0].input.qty, 2);
  assert.equal(rows[1].kind, "sale");
  assert.equal(rows[1].input.saleCents, 3500);
  assert.equal(rows[1].input.clientName, "Luis");
});

test("L-9: a lot total that divides exactly settles per unit, with the total kept in the note", () => {
  const [row] = looseRows("Me traje 3 pares de botas por $90 de la paca, están en buen estado.");
  assert.equal(row.input.qty, 3);
  assert.equal(row.input.costCents, 3000);
  assert.equal(row.input.source, "La paca");
  assert.ok(row.input.notes.includes("Total $90.00"));
});

test("L-10: a lot total that does not divide is flagged, never rounded into a cost", () => {
  const [row] = looseRows("Compré 3 relojes por $100, dos negros y uno blanco.");
  assert.equal(row.input.costCents, 0);
  assert.equal(row.input.problem, "unsure");
  assert.ok(row.issues.includes("true-cost"));
  assert.ok(row.input.notes.includes("Total written: $100.00 for 3"));
});

test("L-11: kept and returned ride their own verbs in one message", () => {
  const rows = looseRows("El reloj Seiko me lo quedé para mí. Y las botas marrones las devolvieron ayer, quedaron en la casa.");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "kept");
  assert.equal(rows[1].kind, "returned");
  assert.equal(rows[1].input.receivedOn, "2026-11-06");
});

test("L-12: a gift to family files as gift; 'mi hermana' is a relation, not a client name", () => {
  const [row] = looseRows("La cartera Coach se la regalé a mi hermana para su cumpleaños.");
  assert.equal(row.kind, "gift");
  assert.equal(row.input.clientName, "");
  assert.equal(row.input.status, "archived");
});

test("L-13: a failed sale keeps the ask he was asking, as ask — never as cost", () => {
  const [row] = looseRows("El cliente no quiso las botas al final, pedía $50 por ellas.");
  assert.equal(row.kind, "failed-sale");
  assert.equal(row.input.askCents, 5000);
  assert.equal(row.input.costCents, 0);
  assert.equal(row.input.saleCents, null);
});

test("L-14: an order in transit is incoming stock with its per-unit cost", () => {
  const [row] = looseRows("Pedí 5 sombreros en AliExpress, vienen en camino, costaron $12 cada uno.");
  assert.equal(row.kind, "stock");
  assert.equal(row.input.status, "incoming");
  assert.equal(row.input.qty, 5);
  assert.equal(row.input.costCents, 1200);
  assert.equal(row.input.source, "AliExpress");
});

test("L-15: one typo still names the product and the sale ('relos', 'vendio')", () => {
  const [row] = looseRows("Se vendio el relos por $40 ayer.");
  assert.equal(row.kind, "sale");
  assert.equal(row.input.category, "Watch");
  assert.equal(row.input.saleCents, 4000);
  assert.equal(row.input.soldOn, "2026-11-06");
});

test("L-16: pure greeting is a loose line the tray still shows — never a phantom piece", () => {
  const { rows, loose } = parseLooseText("Hola amigo, buenas tardes, bendiciones para tu familia.", today, {});
  assert.equal(rows.length, 0);
  assert.equal(loose.length, 1);
});

test("L-17: a Spanish numeric date reads day-first; an impossible date is flagged, not filed", () => {
  const [row] = looseRows("Compré las botas el 20/11, me costaron $40.");
  assert.equal(row.input.receivedOn, "2026-11-20");
  const [bad] = looseRows("Vendí el reloj el 30 de febrero por $50.");
  assert.equal(bad.input.soldOn, null);
  assert.ok(bad.issues.includes("bad-date"));
  assert.ok(bad.input.notes.includes("30 de febrero"));
});

test("L-18: delivery charged on a sale is delivery money, never price or cost", () => {
  const [row] = looseRows("Vendí las botas por $50 y cobré $8 de envío, se fue el lunes.");
  assert.equal(row.input.saleCents, 5000);
  assert.equal(row.input.deliveryCents, 800);
  assert.equal(row.input.costCents, 0);
});

test("L-19: a heading line gives the batch its source; the entries under it inherit it", () => {
  const { rows } = parseLooseText("Pedido de Temu:\nLlegaron 2 pares de botas Durango talla 43, costaron $35 cada uno. También llegó un reloj Invicta, ese costó $48. Todo se ve bien.", today, {});
  assert.equal(rows.length, 2);
  assert.equal(rows[0].input.source, "Temu");
  assert.equal(rows[1].input.source, "Temu");
  assert.equal(rows[0].input.costCents, 3500);
  assert.equal(rows[1].input.costCents, 4800);
});

test("L-20: the tray's reader detection tells prose from ledger lines", () => {
  assert.equal(looksLoose("Hola amigo, ya me llegaron las botas, costaron $38 cada uno."), true);
  assert.equal(looksLoose("# Test Boots\n_ 44 = 9.5 ($20) *Home* for $40 — AddedAug28"), false);
});

// ---- The Advisor's question door (1.13.0). Every figure below was
// computed by hand from this invented floor; the sealed exam with the
// full census lives outside the repo (ventory-accept/ask-exam.mjs).
const { askInventory } = require(path.join(out, "ask.js"));
const askPiece = (over) => ({
  id: `a${Math.random().toString(36).slice(2, 8)}`, sort: 0, name: "", category: "", subcategory: "", brand: "", status: "available",
  qty: 1, sizeSystem: "CN", sizeLabel: "", usSize: "", fit: "unisex", costCents: 0, askCents: 0, saleCents: null,
  buyRebateCents: 0, deliveryCents: 0, source: "", channel: "", clientName: "", receivedOn: null, soldOn: null,
  notes: "", place: "", photo: "ph", problem: "", wasSold: false, ...over,
});
const askFloor = [
  askPiece({ name: "Test Boots", category: "Boot", brand: "Testbrand", status: "sold", sizeLabel: "44", usSize: "10", costCents: 2000, askCents: 4000, saleCents: 3500, source: "Test Source", channel: "Test Channel", clientName: "Test Client", receivedOn: "2026-10-01", soldOn: "2026-10-21" }),
  askPiece({ name: "Test Boots", category: "Boot", brand: "Testbrand", status: "sold", sizeLabel: "44", usSize: "10", costCents: 2000, askCents: 4000, saleCents: 3800, source: "Test Source", receivedOn: "2026-10-01", soldOn: "2026-11-02" }),
  askPiece({ name: "Test Boots", category: "Boot", brand: "Testbrand", status: "available", qty: 2, sizeLabel: "43", usSize: "9.5", costCents: 2000, askCents: 4000, source: "Test Source", receivedOn: "2026-11-01" }),
  askPiece({ name: "Test Watch", category: "Watch", status: "sold", costCents: 0, askCents: 5500, saleCents: 5000, receivedOn: "2026-09-01", soldOn: "2026-11-05" }),
  askPiece({ name: "Test Watch", category: "Watch", status: "available", costCents: 3000, askCents: 6000, receivedOn: "2026-08-01" }),
];
const askAds = [{ id: "ad1", product: "Test Boots", spentCents: 300, startedOn: "2026-10-15", endedOn: null, worked: "running" }];
const ask = (question, lang = "en") => askInventory(askFloor, askAds, question, { lang, today });

test("A-1: sales answer from the single reading, revenue by hand", () => {
  const answer = ask("how much did I sell");
  assert.equal(answer.family, "ventas");
  assert.ok(answer.text.includes("$123.00"));
});

test("A-2: profit names its base; a costless sale stays out of the margin and is named", () => {
  const answer = ask("what is my profit");
  assert.equal(answer.family, "ganancia");
  assert.ok(answer.text.includes("$83.00"));
  assert.ok(answer.text.includes("45%"));
  assert.ok(answer.text.includes("Test Watch"));
});

test("A-3: stock by the floor's own product name", () => {
  const answer = ask("how many Test Boots do I have");
  assert.equal(answer.family, "existencias");
  assert.ok(answer.text.includes("2 on hand"));
});

test("A-4: what is not moving names the oldest with its days", () => {
  const answer = ask("what is not moving");
  assert.equal(answer.family, "nosemueve");
  assert.ok(answer.text.includes("Test Watch"));
  assert.ok(answer.text.includes("98"));
});

test("A-5: speed for one product averages its dated sales only", () => {
  const answer = ask("how fast do Test Boots sell");
  assert.equal(answer.family, "rotacion");
  assert.ok(answer.text.includes("26"));
});

test("A-6: fees are a frontier, never a number", () => {
  const answer = ask("what is my final net after fees");
  assert.equal(answer.family, "frontera");
});

test("A-7: the same door in Spanish", () => {
  const answer = ask("¿cuánto gané?", "es");
  assert.equal(answer.family, "ganancia");
  assert.ok(answer.text.includes("$83.00"));
});

test("A-8: a source question lands in the sources family", () => {
  const answer = ask("¿qué fuente vende mejor?", "es");
  assert.equal(answer.family, "fuentes");
  assert.ok(answer.text.includes("Test Source"));
});

test("A-9: capabilities declare the live families", () => {
  assert.equal(ask("what can you do").family, "capacidades");
  assert.equal(ask("¿qué puedes hacer?", "es").family, "capacidades");
});

test("A-10: a question with no family gets the honest unknown, never a bent answer", () => {
  assert.equal(ask("what is the weather today").family, "unknown");
});

console.log(`\n${passed} tests passed`);
