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
  `npx tsc src/lib/ventory/model.ts src/lib/ventory/paste.ts src/lib/ventory/tray.ts --outDir ${out} --module commonjs --target es2022 --moduleResolution node --skipLibCheck`,
  { stdio: "pipe" },
);
const require = createRequire(import.meta.url);
const { parseDetailedNotes } = require(path.join(out, "paste.js"));
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

console.log(`\n${passed} tests passed`);
