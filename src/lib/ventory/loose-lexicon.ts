/*
 * Vocabulary for the loose-text reader (loose.ts) — the Vela pattern carried
 * to merchandise. Every pattern is written for FOLDED text: lower case,
 * accents removed (é→e, ñ→n), curly quotes → '. Values are the house's own:
 * categories are the floor's English category names, channels and sources
 * are written the way the house writes them ("Ebay", "Temu").
 *
 * The law is the same one Vela's header carries: nothing is invented. A
 * field the text does not speak to stays empty, and words the reader could
 * not turn into a field stay in the piece's note.
 */

// ---------------------------------------------------------------- products
export type ProductRule = { category: string; fit: string; re: RegExp };

const p = (category: string, fit: string, source: string): ProductRule => ({
  category,
  fit,
  re: new RegExp(`\\b(?:${source})\\b`, "g"),
});

export const PRODUCT_RULES: ProductRule[] = [
  p("Boot", "men", "boots?|botas?|botines|botin"),
  p("Watch", "unisex", "watch(?:es)?|reloj(?:es)?"),
  p("Hat", "unisex", "hats?|sombreros?|gorras?|caps?"),
  p("Loafer", "men", "loafers?|mocasines|mocasin"),
  p("Piano", "unisex", "pianos?"),
  p("Jacket", "", "jackets?|chaquetas?|chamarras?"),
  p("Belt", "", "belts?|cinturones|cinturon|cintos?"),
  p("Wallet", "", "wallets?|carteras?|billeteras?"),
  p("Sunglasses", "", "sunglasses|gafas de sol|lentes de sol|shades"),
  p("Perfume", "", "perfumes?|fragancias?"),
  p("Bag", "", "bags?|bolsos?|mochilas?|backpacks?"),
  p("Sneaker", "", "sneakers?|tenis|trainers?"),
  p("Shoe", "", "shoes?|zapatos?|zapatillas?"),
  p("Shirt", "", "shirts?|camisas?|playeras?|t-?shirts?"),
  p("Pants", "", "pants|pantalones|pantalon"),
  p("Jeans", "", "jeans|vaqueros"),
  p("Dress", "women", "dress(?:es)?|vestidos?"),
  p("Ring", "", "rings?|anillos?"),
  p("Necklace", "", "necklaces?|collares|collar"),
  p("Bracelet", "", "bracelets?|pulseras?"),
  p("Earrings", "", "earrings?|aretes?"),
];

/** "Play tennis" is a sport, not a Sneaker: the span is claimed so the product rule cannot fire. */
export const PRODUCT_BLOCKS: RegExp[] = [
  /\b(?:play(?:ing|ed)?|jugar|jugando|jugo)\s+(?:tenis|tennis)\b/g,
  /\btennis\b/g,
];

/** Brands Oscar's floor actually carries — matched in any case, so a lowercase message still names them. */
export const KNOWN_BRANDS = [
  "justin", "ariat", "tony lama", "lucchese", "dan post", "durango", "wolverine", "timberland",
  "nike", "adidas", "puma", "reebok", "new balance", "vans", "converse",
  "casio", "seiko", "fossil", "timex", "citizen", "invicta", "bulova", "orient", "g-shock",
  "ray-ban", "oakley", "levi's", "levis", "wrangler", "carhartt", "columbia", "tommy hilfiger",
  "ralph lauren", "michael kors", "coach", "guess", "yamaha", "casio piano",
];

/** Words that can ride inside a name span (colours, materials, styles) — EN + ES, folded. */
export const DESCRIPTORS = new Set(
  (
    "black negro negra white blanco blanca brown cafe marron tan beige red rojo roja blue azul " +
    "green verde gray grey gris silver plata plateado plateada gold oro dorado dorada yellow amarillo amarilla " +
    "pink rosado rosada purple morado morada orange anaranjado leather cuero piel suede gamuza ante " +
    "cowboy vaquero vaquera western dress dressy casual vintage classic clasico clasica new nuevo nueva " +
    "used usado usada original genuine genuino real exotic exotico exotica ostrich avestruz snake serpiente " +
    "croc cocodrilo steel acero wooden madera plastic plastico digital analog analogico automatic automatico " +
    "quartz cuarzo solar long largo larga short corto corta round redondo redonda square cuadrado cuadrada " +
    "big grande small pequeno pequena medium mediano mediana"
  ).split(/\s+/),
);

/** Words that are never a brand and never a client name. */
export const NAME_STOP = new Set(
  (
    "the a an el la los las un una unos unas some any my mi mis his her su sus their this that este esta ese esa " +
    "new nuevo nueva used usado usada good bueno buena great barato barata cheap caro cara home casa car carro " +
    "today hoy yesterday ayer manana tomorrow week semana month mes friend amigo amiga brother hermano customer " +
    "cliente supplier proveedor seller vendedor buyer comprador man hombre woman mujer guy muchacho senor senora " +
    "buen bueno buena barata barato cara caro gran grande mejor peor precio tienda shop store semana mes ano dia"
  ).split(/\s+/),
);

// ---------------------------------------------------------------- status verbs (folded)
export const BUY_RE = /\b(?:compre|comprado|comprando|comprar|bought|buying|purchased?|ordered|ordene|pedi|pedido|recibi|recibido|received|arrived|llego|llegaron|llega|agarr(?:e|o|ado)|consegui|conseguido|me traje|trajeron|me llegaron|me llego)\b/g;
export const SELL_RE = /\b(?:vendi|vendido|vendio|vendieron|se vendio|se fue|sold|salio|se lo llevo|lo vendi|la vendi|los vendi|las vendi)\b/g;
export const INCOMING_RE = /\b(?:en camino|on (?:its|the) way|coming|por llegar|viene|vienen|en transito|in transit|shipped|enviado|enviada)\b/g;
export const KEPT_RE = /\b(?:me (?:lo|la|los|las) qued(?:e|o)|me qued(?:e|o) con|keeping (?:it|this|them)|kept (?:it|this|them)|for myself|para mi(?:\s|$)|quedandomelo|quedandomela)\b/g;
export const RETURNED_RE = /\b(?:devolvi|devolvio|devolvieron|devuelto|devuelta|devueltos|devueltas|returned|me (?:lo|la) regreso|me (?:lo|la) regresaron|regresado)\b/g;
export const FAILED_RE = /\b(?:no (?:lo|la|los|las)? ?quiso|no quiso|did ?n[o']?t want|did not want|rejected|rechazo|rechazado|no le gusto|didn'?t like)\b/g;
export const GIFT_RE = /\b(?:regale|regalo|regalado|regalada|gift|gifted|gave (?:it|them|this)|se (?:lo|la|los|las) (?:di|regale)|le (?:di|regale)|de regalo|para regalo|birthday present|present)\b/g;
export const RESERVED_RE = /\b(?:apartado|apartada|apartados|apartadas|apartalo|apartala|reservado|reservada|reserved|on hold)\b/g;
export const STILL_HAVE_RE = /\b(?:todavia (?:lo|la|los|las)? ?tengo|still (?:have|got)|sigue (?:disponible|aqui)|aun (?:lo|la|los|las) tengo|lo tengo disponible)\b/g;

/** Negators that can kill a sale verb inside their own clause (Vela's clause scope, simplified). */
export const NEGATORS = new Set([
  "no", "not", "never", "nunca", "sin", "didnt", "didn't", "dont", "don't", "todavia", "aun",
  "not yet", "sin vender", "no se", "no lo", "no la", "no los", "no las",
]);
export const NOT_YET_AFTER = /^\s*(?:todavia|aun|no)\b|^\s*(?:not\s+yet|yet)\b/;

// ---------------------------------------------------------------- money frames (folded; the amount is group 1)
/** What a piece cost the house, per unit when an each-marker rides along. */
export const COST_FRAME = /(?:me costo|me costaron|costo|cuesta|pague|pagado|pagando|me salio en|me salieron en|sali(?:o|eron) en|bought (?:it |them |this )?(?:for|at)|paid|precio de compra|cost me|i paid)\s*(?:de\s*)?$/;
export const ASK_FRAME = /(?:vendo (?:a|en)|lo vendo|la vendo|los vendo|las vendo|lo doy en|la doy en|pido|pedia|pidio|pidiendo|pide|asking|ask|precio|price|lo tengo en|sale por|salen por|a la venta (?:a|en)|for sale (?:at|for)|selling (?:at|for))\s*(?:de\s*)?$/;
export const SALE_FRAME = /(?:vendi (?:a|en|por)|se vendio (?:a|en|por)|se fue (?:a|en|por)|sold (?:it |them |this )?(?:for|at)|lo vendi|la vendi)\s*(?:de\s*)?$/;
export const EACH_MARK = /^\s*(?:cada (?:uno|una|par|pieza)|each|per (?:pair|piece|unit)|apiece|por (?:par|pieza|unidad)|\/ ?(?:par|pieza|ea))\b/;
export const TOTAL_MARK = /^\s*(?:en total|total|por (?:los|las|el|la|todos|todas)|for (?:the|all of them|all))\b/;
// ---------------------------------------------------------------- channels & sources
/** Sale channels, as the house writes them. Bare "marketplace" stays "Marketplace" — the text did not say Facebook. */
export const CHANNEL_RULES: { value: string; re: RegExp }[] = [
  { value: "Facebook Marketplace", re: /\bfacebook marketplace\b|\bmp\b/g },
  { value: "Facebook", re: /\bfacebook\b|\bfb\b/g },
  { value: "Marketplace", re: /\bmarketplace\b/g },
  { value: "Ebay", re: /\bebay\b/g },
  { value: "OfferUp", re: /\bofferup\b/g },
  { value: "Mercari", re: /\bmercari\b/g },
  { value: "Poshmark", re: /\bposhmark\b/g },
  { value: "Whatnot", re: /\bwhatnot\b/g },
  { value: "WhatsApp", re: /\bwhatsapp\b/g },
  { value: "Instagram", re: /\binstagram\b/g },
  { value: "Craigslist", re: /\bcraigslist\b/g },
  { value: "In person", re: /\ben persona\b|\bin person\b/g },
];

/** Where pieces are bought. A person named after a buy verb is read by the engine, not here. */
export const SOURCE_RULES: { value: string; re: RegExp }[] = [
  { value: "Temu", re: /\btemu\b/g },
  { value: "AliExpress", re: /\baliexpress\b/g },
  { value: "Shein", re: /\bshein\b/g },
  { value: "Amazon", re: /\bamazon\b/g },
  { value: "Ebay", re: /\bebay\b/g },
  { value: "DHgate", re: /\bdhgate\b/g },
  { value: "Alibaba", re: /\balibaba\b/g },
  { value: "Walmart", re: /\bwalmart\b/g },
  { value: "Target", re: /\btarget\b/g },
  { value: "Costco", re: /\bcostco\b/g },
  { value: "La paca", re: /\b(?:la )?paca\b/g },
];

// ---------------------------------------------------------------- numbers, dates
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  pair: 2, par: 2, couple: 2,
};

export const MONTHS: Record<string, number> = {
  jan: 1, january: 1, ene: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abr: 4, abril: 4,
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, ago: 8, agosto: 8,
  sep: 9, sept: 9, set: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, dic: 12, diciembre: 12,
};

export const WEEKDAYS: Record<string, number> = {
  sunday: 0, domingo: 0,
  monday: 1, lunes: 1,
  tuesday: 2, martes: 2,
  wednesday: 3, miercoles: 3,
  thursday: 4, jueves: 4,
  friday: 5, viernes: 5,
  saturday: 6, sabado: 6,
};

const ES_HINT = /\b(?:con|ayer|anoche|hoy|veces|noche|semana|pero|muy|vendido|vendida|compre|comprado|llego|tengo|quiero|gracias|hola|buenas|para|porque|tambien|entonces|despues|salio|todavia|cuesta|costaron)\b/g;
const EN_HINT = /\b(?:with|yesterday|today|was|were|the|and|for|sold|bought|arrived|still|have|want|thanks|hello|because|also|then|after|each|price|cost)\b/g;

/** Whether a piece of folded text reads as Spanish (more Spanish function words than English ones). */
export function looksSpanish(folded: string) {
  const es = folded.match(ES_HINT)?.length ?? 0;
  const en = folded.match(EN_HINT)?.length ?? 0;
  return es > en;
}

// ---------------------------------------------------------------- residue
/** Words that carry no story on their own: a clause made only of these is dropped from the note. */
export const FILLER = new Set(
  (
    "and y e then luego despues tambien also with con without sin the a an el la los las un una unos unas de del en in at on " +
    "por para que se me lo la los las le les mi mis su sus este esta ese esa esto eso ya si no muy bien mas como cuando donde " +
    "hola buenas gracias amigo amiga friend friends hello hi thanks thank saludos bendiciones ok okay va sale pues bueno through via " +
    "hoy ayer manana today yesterday tomorrow aqui ahi alli here there esto fue era es son esta estan estaba " +
    "i yo we nosotros he she el ella it they ellos ellas you tu usted me te nos him her them"
  ).split(/\s+/),
);

// ---------------------------------------------------------------- fuzzy vocabulary
/** Single folded words that may be matched with one typo. Real words one letter away live in FUZZY_STOP. */
export const FUZZY_WORDS: { word: string; kind: "product" | "sell" | "buy"; value: string }[] = [
  { word: "botas", kind: "product", value: "Boot" },
  { word: "reloj", kind: "product", value: "Watch" },
  { word: "sombrero", kind: "product", value: "Hat" },
  { word: "chaqueta", kind: "product", value: "Jacket" },
  { word: "cartera", kind: "product", value: "Wallet" },
  { word: "vendido", kind: "sell", value: "sold" },
  { word: "vendida", kind: "sell", value: "sold" },
  { word: "comprado", kind: "buy", value: "bought" },
  { word: "llegaron", kind: "buy", value: "arrived" },
];
export const FUZZY_STOP = new Set([
  "botar", "votar", "batas", "botan", "relajo", "relojes", "sombreros", "carteras", "vendidos", "vendidas",
]);
