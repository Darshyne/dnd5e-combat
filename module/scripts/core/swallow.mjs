/**
 * M8 (SPEC §18.17) : Avaler / Engloutir (Béhir, Ver pourpre, Rémorhaz, Tarasque, Kraken, Crapaud et Grenouille géants ; Cube
 * gélatineux, Blob d'annihilation, Tertre errant). Ce que dit le texte anglais d'origine, et quand les dégâts tombent.
 * Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…")
  .replace(/&Reference\[([^\]]+)\](?:\{[^}]*\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ")
  .replace(/[’]/g, "'");

/** Quand l'avalé subit les dégâts : début / fin du tour de l'avaleur, début du tour de l'avalé, fin du tour suivant (une fois). */
export const SWALLOW_MOMENTS = Object.freeze(["ownerStart", "ownerEnd", "ownerEndOnce", "targetStart"]);

/**
 * - `damageAt` : « at the start of each of the behir's turns » (`ownerStart`), « at the start of each of its turns »
 *   (`targetStart` : Kraken, Blob, Tertre), « at the end of each of the toad's turns » (`ownerEnd`), « At the end of the
 *   frog's next turn » (`ownerEndOnce` : puis la grenouille le recrache) ; null si le texte n'en dit rien ;
 * - `threshold` : « If the behir takes 30 damage or more on a single turn from the swallowed creature » — régurgiter.
 * @param {string} html
 * @returns {{damageAt: string|null, threshold: number|null}}
 */
export function readSwallow(html) {
  const text = plain(html);
  let damageAt = null;
  if ( /\bat the end of the [^.]{0,40}'s next turn\b/i.test(text) ) damageAt = "ownerEndOnce";
  else if ( /\bat the start of each of its turns\b/i.test(text) ) damageAt = "targetStart";
  else if ( /\bat the start of each of the [^.]{0,40}'s turns\b/i.test(text) ) damageAt = "ownerStart";
  else if ( /\bat the end of each of the [^.]{0,40}'s turns\b/i.test(text) ) damageAt = "ownerEnd";
  const threshold = Number(text.match(/\btakes (\d+) damage or more on a single turn from\b/i)?.[1]) || null;
  return { damageAt, threshold, ...readSwallowLimits(text) };
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const SIZE_WORDS = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

/**
 * §18.21 : ce que le texte limite ou ajoute.
 *  - `capacity` : « can have only one creature swallowed at a time » (1), « up to four creatures swallowed at a time » (4),
 *    « only one creature Grappled by this action at a time » (Tertre) ; null sans limite écrite ;
 *  - `grappling` : « swallows a Medium or smaller target it is grappling » (la cible doit être agrippée par l'avaleur ; ailleurs
 *    le MM le dit dans la cible de l'activité, lue par l'adaptateur) ;
 *  - `forbids` : « it can't use Bite while it has a swallowed target » → le nom anglais de l'item interdit ;
 *  - `repeatsSave` : « repeats the save at the end of each of its turns » (Blob d'annihilation) ;
 *  - `moving` : « each creature whose space the cube enters for the first time during this move » — engloutir en marchant,
 *    `maxSize` : « can move through the spaces of Large or smaller creatures » (clé de taille dnd5e) ;
 *  - `targetMaxSize` : « swallows a Medium or smaller target it is grappling » (Crapaud géant, §45) — la taille de ce qui
 *    s'avale, quand le texte la dit (ailleurs c'est la cible de l'activité : `sizeLimit`).
 */
function readSwallowLimits(text) {
  const count = text.match(/\b(?:only (one)|up to (\w+)) (?:creatures? |targets? )?(?:swallowed|engulfed|Grappled by this action) at a time\b/i);
  const word = (count?.[1] ?? count?.[2] ?? "").toLowerCase();
  const capacity = count ? (NUMBERS[word] ?? (Number(word) || null)) : null;
  const grappling = /\btarget it is grappling\b/i.test(text);
  const forbids = text.match(/\bcan't use ([A-Z][\w' ]*?)(?= while|,|\.| and\b)/)?.[1]?.trim() ?? null;
  const repeatsSave = /\brepeats the save at the end of each of its turns\b/i.test(text);
  const moving = /\bwhose space the [^.]{0,40} enters for the first time during this move\b/i.test(text);
  const size = text.match(/\bspaces of (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1]?.toLowerCase();
  return { capacity, grappling, forbids, repeatsSave, moving, maxSize: size ? SIZE_WORDS[size] : null, targetMaxSize: sizeLimit(text, /\bswallows an? /) };
}

/**
 * La taille maximale qu'écrit un texte : « Medium or smaller », ou sa traduction (« de taille M ou inférieure ») — clé de
 * taille dnd5e, ou null. `after` : ce qui doit précéder (rien : n'importe où dans le texte).
 */
export function sizeLimit(text, after=null) {
  const source = String(text ?? "");
  const lead = after ? after.source : "";
  const en = source.match(new RegExp(`${lead}(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\\b`, "i"))?.[1]?.toLowerCase();
  if ( en ) return SIZE_WORDS[en];
  const fr = source.match(new RegExp(`${lead}[^.]{0,30}?taille (TP|P|M|G|TG|Gig)\\b[^.]{0,12}inférieure`, "i"))?.[1]?.toUpperCase();
  return fr ? ({ TP: "tiny", P: "sm", M: "med", G: "lg", TG: "huge", GIG: "grg" })[fr] ?? null : null;
}

/** Une créature de cette taille tient-elle sous la limite (clés de taille dnd5e) ? Sans limite, oui. */
export function fitsSize(size, maxSize) {
  if ( !maxSize ) return true;
  const i = SIZES.indexOf(size);
  return (i >= 0) && (i <= SIZES.indexOf(maxSize));
}

/**
 * Pendant un déplacement, dans quels espaces l'avaleur entre-t-il ? Rectangles en pixels : l'avaleur à chaque position
 * échantillonnée du trajet (départ exclu), les autres à leur place. Chevaucher au départ ne compte pas (« enters »).
 * @param {Array<{x: number, y: number, w: number, h: number}>} path   Positions de l'avaleur, départ compris.
 * @param {Array<{id: string, x: number, y: number, w: number, h: number}>} others
 * @returns {string[]}
 */
export function enteredSpaces(path, others) {
  const overlap = (a, b) => (a.x < b.x + b.w - 1e-6) && (b.x < a.x + a.w - 1e-6) && (a.y < b.y + b.h - 1e-6) && (b.y < a.y + a.h - 1e-6);
  const [start, ...rest] = path;
  return others.filter(o => start && !overlap(start, o) && rest.some(p => overlap(p, o))).map(o => o.id);
}

/**
 * Qui subit les dégâts à ce changement de tour.
 * @param {string|null} damageAt
 * @param {{ended: boolean, started: boolean, targetStarted: boolean, sameTurn: boolean}} at
 *   `ended` : le tour de l'avaleur s'achève ; `started` : il commence ; `targetStarted` : le tour de l'avalé commence ;
 *   `sameTurn` : l'avalé l'a été pendant le tour qui s'achève (« son tour SUIVANT » : pas encore).
 */
export function swallowDamageNow(damageAt, { ended=false, started=false, targetStarted=false, sameTurn=false }) {
  if ( damageAt === "ownerStart" ) return started;
  if ( damageAt === "ownerEnd" ) return ended;
  if ( damageAt === "ownerEndOnce" ) return ended && !sameTurn;
  if ( damageAt === "targetStart" ) return targetStarted;
  return false;
}

/** Dégâts subis pendant un tour depuis l'intérieur : faut-il la sauvegarde pour ne pas régurgiter ? */
export function mustRegurgitateSave(threshold, damageThisTurn) {
  return (threshold > 0) && (damageThisTurn >= threshold);
}
