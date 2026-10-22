/**
 * §228 : les textes qui défilent au-dessus des tokens (retour visuel, ui/feedback.mjs) — leur rythme et ce qu'ils montrent, réglés par
 * le MJ pour la table (onglet « Textes flottants »). Retour de table du 2026-10-21 : trop rapides, trop serrés, souvent illisibles.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** La catégorie de réglage de chaque sorte de fait (core/feedback.mjs, ui/feedback.mjs). */
export const FLOAT_CATEGORIES = Object.freeze({
  hit: "floatHits",
  critical: "floatAttacks", miss: "floatAttacks",
  cover: "floatCover",
  saveSuccess: "floatSaves", saveFail: "floatSaves",
  reaction: "floatReactions",
  prompt: "floatPrompts", refused: "floatPrompts",
  ended: "floatEffects", unaffected: "floatEffects", duplicate: "floatEffects",
  gain: "floatResources", spend: "floatResources",
  strike: "floatStrikes"
});

/** Les réglages de catégorie, dans l'ordre de la fenêtre, avec leur valeur par défaut. */
export const FLOAT_CATEGORY_DEFAULTS = Object.freeze({
  floatAttacks: true, floatHits: false, floatSaves: true, floatCover: true, floatReactions: true, floatStrikes: true,
  floatEffects: true, floatResources: true, floatPrompts: true
});

/** Le rythme par défaut : durée (s), écart entre deux textes d'un même token (s), course (cases), taille (%). */
export const FLOAT_DEFAULTS = Object.freeze({ duration: 4, spacing: 1, distance: 1.5, scale: 100, direction: "down" });

/** Les sortes dont le pictogramme est celui d'un dé (le résultat du jet, réglage `floatDice`). */
const ROLLED = new Set(["hit", "critical", "miss", "saveSuccess", "saveFail"]);

/**
 * Ce qu'une ligne affiche : son texte, le nombre du jet et les pictogrammes — ou null si sa catégorie est coupée. Un coup qui touche
 * sans critique n'a pas de texte propre : il ne s'affiche que par son jet (`floatDice`) ou par « Touché » (`floatHits`).
 * @param {{kind: string, roll?: number|null}} fact
 * @param {string|null} text        Le texte localisé du fait (« Raté »), ou null.
 * @param {object} options          `show` (catégorie → booléen), `dice`, `icons`, `hitText` (« Touché »).
 * @returns {{text: string, roll: number|null, dieIcon: boolean, icon: string|null}|null}
 */
export function floatLine(fact, text, { show={}, dice=true, icons=true, hitText=null }={}) {
  const category = FLOAT_CATEGORIES[fact.kind];
  if ( !category ) return text ? { text, roll: null, dieIcon: false, icon: null } : null;
  const roll = (dice && ROLLED.has(fact.kind) && Number.isFinite(fact.roll)) ? fact.roll : null;
  const on = show[category] ?? FLOAT_CATEGORY_DEFAULTS[category];
  if ( fact.kind === "hit" ) {
    if ( !on && (roll === null) ) return null;
    return { text: on ? (hitText ?? "") : "", roll, dieIcon: (roll !== null) && icons, icon: null };
  }
  if ( !on || !text ) return null;
  return { text, roll, dieIcon: (roll !== null) && icons, icon: icons ? (ICONS[fact.kind] ?? null) : null };
}

/** Pictogrammes propres à une sorte (icônes du cœur : public/icons/svg). */
const ICONS = { cover: "icons/svg/shield.svg", reaction: "icons/svg/lightning.svg", critical: "icons/svg/explosion.svg", saveFail: "icons/svg/skull.svg" };

/**
 * Une image de l'animation, à l'avancement `p` (0 → 1) : le texte apparaît (15 % du temps, en grandissant), reste lisible, puis
 * s'efface sur le dernier tiers seulement — le cœur, lui, l'efface pendant toute sa course (interface.mjs, `createScrollingText`).
 * La course est lissée sur toute la durée.
 * @returns {{alpha: number, offset: number, scale: number}}  `offset` : part de la course faite (0 → 1).
 */
export function floatFrame(p) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  const ease = x => 0.5 - (Math.cos(Math.PI * x) / 2);
  const alpha = (t < 0.15) ? ease(t / 0.15) : (t > 0.67) ? 1 - ease((t - 0.67) / 0.33) : 1;
  const scale = (t < 0.15) ? 0.6 + (0.4 * ease(t / 0.15)) : 1;
  return { alpha, offset: ease(t), scale };
}

/**
 * Les délais d'apparition d'une salve de textes : chaque token a sa file, un texte attend que le précédent du même token ait pris
 * `spacing` secondes d'avance (y compris ceux encore en cours d'une salve précédente, `busyUntil`).
 * @param {string[]} tokens          Le token de chaque texte, dans l'ordre.
 * @param {number} spacing           Secondes.
 * @param {number} now               Horloge en ms.
 * @param {Map<string, number>} busyUntil  Par token, l'heure (ms) où le suivant peut partir ; mise à jour.
 * @returns {number[]}  Le délai (ms) de chaque texte.
 */
export function floatDelays(tokens, spacing, now, busyUntil) {
  const gap = Math.max(0, Number(spacing) || 0) * 1000;
  return tokens.map(token => {
    const start = Math.max(now, busyUntil.get(token) ?? 0);
    busyUntil.set(token, start + gap);
    return start - now;
  });
}
