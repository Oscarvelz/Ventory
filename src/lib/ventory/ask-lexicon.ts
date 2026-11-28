/**
 * ask-lexicon.ts — the Advisor's question vocabulary (1.13.0; widened by
 * the 50 Rule construction bank, 1.15.0).
 *
 * The census of question families for Ventory's floor, coined from what
 * the app already measures (metrics.ts) — never from what it cannot see.
 * Every cue runs on folded text (lowercase, accents stripped), in both
 * languages at once: a family does not exist in one language only.
 * Cues are stems and frames, never whole phrases: a cue that only
 * matches one exact wording is a patch, not a rule (the ear clause of
 * the 50 Rule). The judgment order lives in ask.ts; this file is words.
 */

export type FamilyId =
  | "capacidades" | "frontera" | "pieza" | "faltantes" | "reposicion" | "precios"
  | "ganancia" | "ventas" | "envios" | "rotacion" | "nosemueve" | "anuncios" | "fuentes"
  | "canales" | "clientes" | "marcas" | "tallas" | "tramos" | "capital" | "existencias";

/** Frontier traps: questions whose honest answer is a boundary, not a number.
 *  The listing trap needs a time word or a participle: the bare noun
 *  "publicidad/anuncio" is advertising (anuncios family), not a date. */
export const FRONTIER_CUES: { re: RegExp; kind: "fees" | "listing" | "market" | "condition" | "returndate" | "appearance" | "notowned" }[] = [
  { re: /\b(tarifas?|fees?|comision\w*|commission\w*|impuest\w*|tax\w*|me quita\w*|me cobr\w*|does (?:the platform|ebay|it|facebook marketplace|temu|nike|marketplace|amazon|walmart) (?:take|charge)|does (?:the )?[a-z]+ charge|cobr\w+ (?:facebook|ebay|temu|amazon|paypal|nike|la plataforma|la competencia|el correo)|charge me|post office|cobra la plataforma|does the platform charge|platform charge|neto final|final net|after fees|takes? its cut|menos (?:las? )?tarifas?|descontadas? (?:las? )?tarifas?)\b/, kind: "fees" },
  { re: /\b(?:(?:cuando|desde cuando|que dia|fecha|when|since when|how long|what day)\b[^.?]{0,30}\b(?:public\w*|anunci\w*|listed|listing|published|advertis\w*)\b|publicad\w*|anunciad\w*|advertised|published|posted|did i post|publiqu\w*|fecha de publicacion|listing date|did i list|been (?:listed|advertised|published))\b/, kind: "listing" },
  { re: /\b(precio de mercado|market price|cuanto cobran otros|do others charge|others charge|en el mercado|on the market|vale en el mercado|worth (?:on|in) the market|en otras tiendas|in other stores|otras tiendas|other stores|other shops|across the street|tienda de enfrente|precios (?:de|del) (?:mi )?proveedor|supplier(?:'s)? prices?|supplier have|maneja mi proveedor|would [a-z]+ charge me|me venderia)\b/, kind: "market" },
  { re: /\b(condicion|condition|buen estado|good condition|nuev\w* o (?:lo |la |los |las )?usad\w*|new or (?:the )?used|estado fisico|mint|desgast\w*|what wear|wear and tear|en que estado|que estado|what state|what shape|usad\w*|used|worn)\b/, kind: "condition" },
  { re: /\b(devolucion\w*|devolv\w*|fecha de devolucion|return date|when was [^.]{0,30}return(?:ed)?|when were [^.]{0,24}returned|cuando (?:lo |la )?devolvieron|fue devuelt\w*|can i return)\b/, kind: "returndate" },
  { re: /\b(como se ve|look like|looks like)\b/, kind: "appearance" },
  { re: /\b(?:aun no|todavia no) (?:compro|tengo|compre)\b|\bi haven'?t (?:bought|got)\b|\bno he comprado\b/, kind: "notowned" },
];

export const FAMILY_CUES: { id: FamilyId; re: RegExp }[] = [
  { id: "capacidades", re: /\b(que (?:puedes|preguntas|respuestas|consultas|temas|informacion|haces|sabes|funciones)|puedo (?:preguntarte|pedirte)|que (?:te )?puedo (?:preguntar|pedir)|puedes (?:hacer|responder|decir)|preguntas (?:aceptas|respondes|entiendes)|tipo de preguntas|para que sirves|tus? (?:funcion|funciones|capacidades)|capacidades|de que eres capaz|eres capaz|capaz de responder|en que me ayudas|que me puedes decir|que sabes (?:hacer|de)|ayud\w*|help|what (?:can you|you can|do you (?:do|know|answer|cover|take)|are you|questions|answers|topics|queries|functions|information)|can i ask you|what can i ask|can you (?:do|answer|tell) (?:me )?(?:what|about|anything|something)|you can do|everything you can|what you'?re for|what you are for|para que (?:sirves|eres)|your (?:function|functions|capabilities)|capabilit\w*|show me what you can|how do you help|able to answer|do you (?:answer|understand|take)|kind of questions|what do you know)\b/ },
  { id: "envios", re: /\b(envios?|delivery|deliveries|shipping|flete|enviar|mandar|to ship|sending|delivery charge)\b/ },
  { id: "anuncios", re: /\b(anuncios?|ads?|advertis\w*|publicidad|promocion\w*|promoting|anunciar|anuncie|spent on ads|spend on ads|gaste en anunciar)\b/ },
  { id: "pieza", re: /\b(cuanto costo|cuanto costaron|cuanto cuesta|cuestan?|cuando llego|cuando llegaron|cuando vendi|cuando entro|cuando entraron|costo (?:el|la|los|las|de|del)|cost me|me costo|(?:bota|botas|boot|boots|reloj|watch|gorra|sombrero|hat|cap|cartera|wallet|cinturon|belt|tenis|sneaker|zapato|shoe|camisa|shirt|pantalon|pants|chaqueta|jacket|vestido|dress) cost|llegada (?:de|del)|stock arrival|when did|how much (?:did|does) [^.]{0,40}cost)\b/ },
  { id: "faltantes", re: /\b(que le falta\w*|que falta\w*|le faltan|les faltan?\w*|incomplet\w*|missing|que necesito (?:poner|agregar)|necesito agregar|sin (?:foto|precio|talla|fecha|marca|costo|fuente|lugar)|no tienen|no tiene|have no|has no|datos (?:le )?faltan|que datos|data is missing|need to (?:put|add)|sin completar|unfilled|left to fill|falta por llenar|most incomplete|mas incomplet\w*|to be complete|para estar completo|estar completo)\b/ },
  { id: "reposicion", re: /\b(reponer|repongo|reposicion|restock\w*|volver a (?:comprar|pedir)|vuelvo a comprar|vuelve a comprar|comprar (?:de nuevo|otra vez)|buy again|order again|buy (?:it |them )?again|second buy|segunda compra|se (?:me )?acaba|se esta acabando|acabarse|acaba pronto|esta por acabarse|about to run out|running (?:low|out)|runs out|run out|low in stock|bajo en inventario|quedando sin|out of stock|surtir|stock up|se (?:ha |han )?vendid\w* (?:dos veces|mas de una vez)|se vendio (?:dos veces|mas de una vez)|sold (?:twice|more than once)|se repite\w*|repeat in sales|keep selling|keeps selling|siguen vendiendo|me queda poco|queda poco|volvio a vender|se volvio a|vendio otra vez|sold again|vale (?:la pena|otra) comprar|vale otra compra|worth (?:buying|another)|earned a second|que compro (?:de nuevo|otra vez)|buy new|once more|que repongo|debo (?:comprar|pedir) de nuevo|should i (?:buy|order|stock)|cuanto (?:me )?queda(?:n)? de(?:l|la|los|las)?|cuantas me quedan de|how much is left of|how (?:many|much) [^.]{0,30}have left)\b/ },
  { id: "precios", re: /\b(precios?|prices?|price|cuanto (?:puedo |debo |deberia )?(?:cobrar|pedir)|cuanto pido|que pido|how much (?:do|can) i ask|what do i ask|how much to ask|should i charge|a cuanto|sell for|sold for|se ha pagado por|has been paid for|descuent\w*|discount|rebaj\w*|what cut|cuanto rebaje|how much did i cut|piden menos|ask\w* less|asking less|por debajo del costo|por debajo de su costo|below cost|asking worth|ask in total|cuanto vale lo que tengo pedido|cuanto pedir|que precio|what price|pagaron por|paid for|pagado por|what am i asking|am i asking|asking for|cuanto piden|piden por)\b/ },
  { id: "ganancia", re: /\b(gane|gano|ganancia\w*|margen|margin|profit|earnings|cuanto (?:me )?(?:quedo|dejo)|me dejo|was left|left from|leave me|leaves me|how much did i (?:make|earn)|how much i made|how much i earned)\b/ },
  { id: "ventas", re: /\b(vendi|vendido|vendida|vendidos|ventas|sales|sold|sell|se vendio|se vendieron|were sold|unidades vendidas|units sold|cuanto entro|came in|brought in|ingresos|revenue|mejor venta|venta mas grande|best sale|biggest sale|largest sale|llevo vendido)\b/ },
  { id: "fuentes", re: /\b(fuentes?|sources?|proveedor\w*|supplier|de donde|where (?:do|should) i buy|donde (?:compro|comprar|deberia comprar)|por fuente|by source|de cada fuente|from each source|que fuente|which source|cada fuente)\b/ },
  { id: "canales", re: /\b(canales|canal|channels?|por donde|where do i sell|donde vendo|que canal|which channel|por canal|by channel|de cada canal|through each channel|where do i earn|leave through|left through|salio por)\b/ },
  { id: "clientes", re: /\b(clientes?|clients?|compradores|buyers?|quien\w*[^.?]{0,12}(?:compro|compra\w*)|quien se llevo|who (?:bought|buys|has bought|spends|took|is my best)|best (?:client|buyer)|mejor (?:cliente|comprador)|top (?:customer|client|buyer)|what did [a-z]+(?: [a-z]+)? buy|cuanto compro|how much did [a-z]+(?: [a-z]+)? buy|cuantas veces compro|how many times did|quien es el que mas gasta|who spends|who bought|compraron|ha comprado|has bought|se llevo|took home|ha gastado|gastad\w*|spent)\b/ },
  { id: "marcas", re: /\b(marcas?|brands?|categorias?|categories|category|tipos? de producto|type of product|que tipo|what type|which type|que marca|which brand)\b/ },
  { id: "tallas", re: /\b(tallas?|sizes?|de la talla|in size|por talla|by size|que talla|which size)\b/ },
  { id: "rotacion", re: /\b(rotacion|rotation|turnover|median\w*|mediano|tiempo mediano|tard\w* mas|took (?:the )?longest|promedio de dias|sell.?through|porcentaje|percentage|tiempo usual|usual (?:selling|sale)|cuanto (?:tarda|demora|se tarda|tardo)|how long (?:does|did|do)|how fast|tan rapido|take to sell|takes to sell|in how many days|en cuantos dias|dias (?:en vender|de venta)|days to sell|selling speed|velocidad|se vende mas (?:rapido|lento)|sells? (?:fastest|slowest)|moves? (?:faster|fastest)|rota mas rapido|rotates fastest|venta mas rapida|fastest sale|en cuanto (?:tiempo|se vende)|in how much time|tarda en venderse|tardo en venderse|demora|on average|en promedio|does a piece sell|cuantos dias (?:tarda\w*|pasan|se vende\w*)|how many days (?:do|does|pass)|days pass|se mueve mas rapido)\b/ },
  { id: "nosemueve", re: /\b(no se mueve|not moving|sin moverse|sin vender\w*|no se venden?|does not sell|do not sell|no ha salido|han salido|has not left|have not left|never left|nunca ha salido|atascad\w*|stuck|estancad\w*|parad[oa]s?|dormid\w*|asleep|stagnant|standing still|sitting still|esperando|waited|waiting|has waited|lleva\w* esperando|mas tiempo|longest|oldest|mas antigu\w*|viejo|frio|cold|is old|past its|paso su tiempo|mas de \d+ dias|over \d+ days|without selling|since (?:january|february|march|april|may|june|july|august|september|october|november|december)|desde (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|antiguedad|how old is|no rota|does not rotate|quedo sin vender|left unsold|still unsold|sigue sin vender|no se ha movido|has not moved|not moved|on the shelf the longest|pasaron su tiempo|su tiempo normal|tiempo normal de venta)\b/ },
  { id: "tramos", re: /\b(compar\w*|versus|vs\b|contra|against|mejor que|peor que|better than|worse than|better or worse|mejor o peor|how am i doing|como voy|que tal voy|mejor mes|best month|mas que|more than|diferencia|difference|voy mejor|voy peor|subieron|went up|go up|que mes|cual mes|which month)\b/ },
  { id: "capital", re: /\b(inverti\w*|invest\w*|comprometid\w*|committed|capital|dinero|money|atado|tied up|dormid\w*|asleep|inversion|investment|a(?:l)? costo|at cost|cuanto tengo invertido|metid\w*|sunk|put into|unsold merchandise)\b/ },
  { id: "existencias", re: /\b(tengo|hay|cuanto hay|cuantas hay|cuantos hay|cuantas|cuantos|quedan|queda|stock|inventario|existencias|en camino|on the way|incoming|cuanto tengo|how many|how much do i have|do i have|still have|en el carro|en casa|in the car|at home|on the shelf|en el estante|on the floor|en el piso|coming in|on its way|on their way|en existencia|in stock|que viene|vienen|available|disponible|que tengo en|what do i have|left of)\b/ },
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
