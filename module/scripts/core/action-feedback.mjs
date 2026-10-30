/**
 * §252 — retour d'une action pour toute la table (règles DAS du 2026-10-27) : un texte flottant vu de tous et un son entendu de tous.
 * Ici, sans Foundry : le son par défaut de chaque action et de son issue, et ce qui voyage d'un client à l'autre. Les sons sont ceux
 * que le cœur de Foundry livre (public/sounds/…), présents sur toute installation ; un module voisin les remplace par le hook public
 * `dnd5e-combat.feedback` (runtime/shared.mjs, `notice`).
 */

/** Les sons du cœur de Foundry utilisés par le moteur. */
export const CORE_SOUNDS = Object.freeze({
  unlock: "sounds/doors/metal/unlock.ogg",
  locked: "sounds/doors/metal/lock.ogg",
  tools: "sounds/doors/metal/test.ogg",
  burst: "sounds/doors/wood/open-heavy.ogg",
  thud: "sounds/doors/wood/close-heavy.ogg",
  shut: "sounds/doors/shutter/close.ogg",
  rattle: "sounds/doors/jail/test.ogg",
  chime: "sounds/doors/magic/unlock.ogg",
  dull: "sounds/doors/wood/lock.ogg",
  fade: "sounds/doors/magic/lock.ogg",
  // §282 : l'Inspiration héroïque utilisée — un coup de tambour épique.
  heroicHit: "sounds/combat/epic-turn-1hit.ogg",
  // §290 : le MJ force la réponse d'un joueur.
  nextHorn: "sounds/combat/epic-next-horn.ogg"
});

/** Le son par défaut d'une action (`action`) selon son issue (`success`, `failure`), ou null. */
const DEFAULTS = Object.freeze({
  pick: { success: CORE_SOUNDS.unlock, failure: CORE_SOUNDS.locked },
  force: { success: CORE_SOUNDS.burst, failure: CORE_SOUNDS.thud },
  key: { success: CORE_SOUNDS.unlock, failure: CORE_SOUNDS.locked },
  hide: { success: CORE_SOUNDS.shut, failure: CORE_SOUNDS.dull },
  search: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  escape: { success: CORE_SOUNDS.rattle, failure: CORE_SOUNDS.dull },
  firstAid: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  land: { success: null, failure: CORE_SOUNDS.thud },
  // §282 : l'Inspiration héroïque dépensée (un dé relancé), puis reçue.
  heroic: { success: CORE_SOUNDS.heroicHit, failure: null },
  // §258 : un sort ou un effet qui prend fin (fins génériques, runtime/endings.mjs).
  spellEnds: { success: CORE_SOUNDS.fade, failure: null },
  // §283 : un sort qui échoue sous Lenteur.
  spellFails: { success: null, failure: CORE_SOUNDS.fade },
  // §285 : un comportement imposé (panique, Confusion, Couronne du dément) ; l'entretien d'un sort par l'action Magie.
  control: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.dull },
  upkeep: { success: CORE_SOUNDS.chime, failure: CORE_SOUNDS.fade },
  // §290 : la réponse d'un joueur forcée par le MJ (fenêtres du combat sans délai).
  forced: { success: CORE_SOUNDS.nextHorn, failure: null }
});

/** Le son par défaut de cette action et de cette issue (null : aucun). */
export function actionSound(action, outcome) {
  return DEFAULTS[action]?.[outcome] ?? null;
}

/**
 * Un texte d'avis : une chaîne déjà traduite, ou `{ key, data }`, traduit chez chaque client (sa langue peut différer de celle de qui
 * agit). `localize(key, data)` est la traduction du client.
 */
export function noticeText(text, localize) {
  if ( !text ) return "";
  if ( typeof text === "string" ) return text;
  return text.key ? localize(text.key, text.data) : "";
}
