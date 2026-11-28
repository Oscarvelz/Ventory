/**
 * ask-lexicon.ts — the Advisor's question vocabulary (1.13.0).
 *
 * The census of question families for Ventory's floor, coined from what
 * the app already measures (metrics.ts) — never from what it cannot see.
 * Every cue runs on folded text (lowercase, accents stripped), in both
 * languages at once: a family does not exist in one language only.
 * The judgment order lives in ask.ts; this file is only words.
 */

export type FamilyId =
  | "capacidades" | "frontera" | "pieza" | "faltantes" | "reposicion" | "precios"
  | "ganancia" | "ventas" | "envios" | "rotacion" | "nosemueve" | "anuncios" | "fuentes"
  | "canales" | "clientes" | "marcas" | "tallas" | "tramos" | "capital" | "existencias";

/** Frontier traps: questions whose honest answer is a boundary, not a number. */
export const FRONTIER_CUES: { re: RegExp; kind: "fees" | "listing" | "market" | "condition" | "returndate" }[] = [
  { re: /\b(tarifas?|fees?|comision|comisiones|commission|impuestos?|taxe?s)\b/, kind: "fees" },
  { re: /\b(neto final|final net|limpio(?:s)? (?:de|after)|after fees|descontadas? (?:las? )?tarifas?|menos (?:las? )?tarifas?)\b/, kind: "fees" },
  { re: /\b(publicad\w*|anunciad\w*|listed|listing|published)\b/, kind: "listing" },
  { re: /\b(precio de mercado|market price|cuanto cobran|what others charge|cuanto vale en el mercado)\b/, kind: "market" },
  { re: /\b(condicion|condition|estado fisico|mint|desgaste)\b/, kind: "condition" },
  { re: /\b(cuando (?:lo |la )?devolvieron|fecha de devolucion|return date|when was it returned)\b/, kind: "returndate" },
];

export const FAMILY_CUES: { id: FamilyId; re: RegExp }[] = [
  { id: "capacidades", re: /\b(que puedes hacer|que sabes hacer|capacidades|what can you do|can you do|help|ayuda|que preguntas (?:puedo|responde)|funciones)\b/ },
  { id: "envios", re: /\b(envios?|delivery|deliveries|shipping|flete)\b/ },
  { id: "pieza", re: /\b(cuanto costo|cuanto costaron|cuanto cuesta|cuestan?|cuando llego|cuando llego el|cuando vendi|costo (?:el|la|los|las|de)|when did|how much did .* cost|cuando entro)\b/ },
  { id: "faltantes", re: /\b(que le falta|que falta|le falta|incomplet|missing|que necesito (?:poner|agregar)|sin (?:foto|precio|talla|fecha|marca))\b/ },
  { id: "reposicion", re: /\b(vuelvo a comprar|volver a comprar|reponer|reposicion|restock|buy again|se (?:esta |esta )?acabando|running low|cuanto me queda de|cuantas me quedan de)\b/ },
  { id: "precios", re: /\b(precio|precios|price|prices|charge|cuanto cobrar|a cuanto|cuanto (?:puedo |debo )?(?:cobrar|pedir)|por debajo del costo|below cost|rebaj|price cut|descuento en (?:el |la )?precio)\b/ },
  { id: "ganancia", re: /\b(gane|ganancia|ganancias|margen|profit|margin|earnings|cuanto (?:me )?(?:quedo|dejo)|how much did i (?:make|earn))\b/ },
  { id: "ventas", re: /\b(vendi|vendido|ventas|vendidos|sales|sold|sell|cuanto entro|ingresos|revenue|cuanto se vendio|mejor venta|venta mas grande|best sale|biggest sale|largest sale)\b/ },
  { id: "fuentes", re: /\b(fuentes?|sources?|donde compro|donde comprar|proveedor|supplier|donde conviene comprar)\b/ },
  { id: "canales", re: /\b(canales|canal|channels?|por donde se vende|donde se vende mas)\b/ },
  { id: "clientes", re: /\b(clientes?|clients?|compradores|quien (?:compra|compro|es mi mejor))\b/ },
  { id: "marcas", re: /\b(marcas?|brands?|categorias?|category|categorias|tipos? de producto|que tipo)\b/ },
  { id: "tallas", re: /\b(tallas?|sizes?)\b/ },
  { id: "rotacion", re: /\b(rapid|fast|cuantos dias|dias en vender|days to sell|cuanto (?:tarda|demora)|rotacion|sell.?through|vende mas rapido|se vende mas rapido|velocidad)\b/ },
  { id: "nosemueve", re: /\b(no se mueve|not moving|sin moverse|no se ha vendido|no se venden|sin vender|frio|fria|cold|stuck|atascad|mas tiempo (?:esperando|sin)|oldest|mas antigua|mas viejo|que lleva mas)\b/ },
  { id: "anuncios", re: /\b(anuncios?|ads?|promocion|promocionar|publicidad|advertis)\b/ },
  { id: "tramos", re: /\b(contra|versus|vs\.?|compar|comparado|mejor que|peor que|how am i doing|como voy)\b/ },
  { id: "capital", re: /\b(inverti|invertido|invertida|comprometido|capital|cuanto tengo (?:en|invertido)|cuanto hay en|dinero (?:en|atado|dormido)|tied up|invested)\b/ },
  { id: "existencias", re: /\b(tengo|hay|cuanto hay|cuantas hay|cuantos hay|quedan|queda|stock|inventario|existencias|en camino|incoming|cuanto tengo|how many|how much do i have|en el carro|en casa|in the car|at home)\b/ },
];

/** Time-window words → a window kind the engine turns into dates. */
export const WINDOW_CUES: { re: RegExp; kind: "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" | "year" }[] = [
  { re: /\b(hoy|today)\b/, kind: "today" },
  { re: /\b(ayer|yesterday)\b/, kind: "yesterday" },
  { re: /\b(semana pasada|last week)\b/, kind: "lastweek" },
  { re: /\b(esta semana|this week)\b/, kind: "week" },
  { re: /\b(mes pasado|last month)\b/, kind: "lastmonth" },
  { re: /\b(este mes|this month)\b/, kind: "month" },
  { re: /\b(este ano|this year)\b/, kind: "year" },
];

export const NEGATED_SALE = /\b(no|nunca|never|not|sin)\b[^.?]{0,24}\b(vend|sell|sold)\w*\b|\b(vend\w+|sold|sell)\b[^.?]{0,16}\b(no|todavia no|not yet|never)\b|\btodavia no\b|\bhasn'?t sold\b|\bnot sold\b/;
export const ASK_CUE = /\b(cuanto|cuantos|cuantas|que|como|cual|cuales|donde|cuando|quien|quienes|how|what|which|where|when|who)\b/;
