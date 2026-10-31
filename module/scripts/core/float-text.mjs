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
  strike: "floatStrikes",
  check: "floatChecks", checkSuccess: "floatChecks", checkFail: "floatChecks"
});

/** Les réglages de catégorie, dans l'ordre de la fenêtre, avec leur valeur par défaut. */
export const FLOAT_CATEGORY_DEFAULTS = Object.freeze({
  floatAttacks: true, floatHits: false, floatAdvantage: true, floatSaves: true, floatChecks: true, floatCover: true, floatReactions: true, floatStrikes: true,
  floatEffects: true, floatResources: true, floatPrompts: true
});

/** Le rythme par défaut : durée (s), écart entre deux textes d'un même token (s), course (cases), taille (%). */
export const FLOAT_DEFAULTS = Object.freeze({ duration: 4, spacing: 1, distance: 1.5, scale: 100, direction: "down" });

/** Les sortes dont le pictogramme est celui d'un dé (le résultat du jet, réglage `floatDice`). */
const ROLLED = new Set(["hit", "critical", "miss", "saveSuccess", "saveFail", "check", "checkSuccess", "checkFail"]);

/**
 * §292 : la sorte du texte d'un test de caractéristique, de compétence ou d'outil lancé par dnd5e, d'après son d20 — réussi ou raté
 * quand le jet porte un DD (`options.target`, dice/d20-roll.mjs `isSuccess` / `isFailure`), sinon le seul total.
 * @param {{total: number, target?: number|null, isSuccess?: boolean, isFailure?: boolean}} roll
 * @returns {"check"|"checkSuccess"|"checkFail"}
 */
export function checkKind(roll) {
  const target = roll?.target;
  if ( (target === null) || (target === undefined) || (target === "") || !Number.isFinite(Number(target)) ) return "check";
  if ( roll.isSuccess === true ) return "checkSuccess";
  if ( roll.isFailure === true ) return "checkFail";
  return (Number(roll.total) >= Number(roll.target)) ? "checkSuccess" : "checkFail";
}

/**
 * Ce qu'une ligne affiche : son texte, le nombre du jet et les pictogrammes — ou null si sa catégorie est coupée. Un coup qui touche
 * sans critique n'a pas de texte propre : il ne s'affiche que par son jet (`floatDice`) ou par « Touché » (`floatHits`).
 * @param {{kind: string, roll?: number|null}} fact
 * @param {string|null} text        Le texte localisé du fait (« Raté »), ou null.
 * §231 : le mode du d20 (`fact.mode`), « Avantage » / « Désavantage » (`modeText`), s'ajoute au jet quand `floatAdvantage` le veut —
 * sans le total (`floatDice` coupé), il précède le verdict. `mode` dans la ligne : pour la couleur du mot.
 * @param {object} options          `show` (catégorie → booléen), `dice`, `icons`, `hitText` (« Touché »), `modeText` (mode → mot).
 * @returns {{text: string, roll: number|null, dieIcon: boolean, icon: string|null, mode: string|null}|null}
 */
export function floatLine(fact, text, { show={}, dice=true, icons=true, hitText=null, modeText={} }={}) {
  const category = FLOAT_CATEGORIES[fact.kind];
  if ( !category ) return text ? { text, roll: null, dieIcon: false, icon: null, mode: null } : null;
  const roll = (dice && ROLLED.has(fact.kind) && Number.isFinite(fact.roll)) ? fact.roll : null;
  const showMode = show.floatAdvantage ?? FLOAT_CATEGORY_DEFAULTS.floatAdvantage;
  const mode = (showMode && ROLLED.has(fact.kind) && modeText[fact.mode]) ? fact.mode : null;
  const on = show[category] ?? FLOAT_CATEGORY_DEFAULTS[category];
  if ( fact.kind === "hit" ) {
    if ( !on && (roll === null) && !mode ) return null;
    return { text: on ? (hitText ?? "") : "", roll, dieIcon: ((roll !== null) || !!mode) && icons, icon: null, mode };
  }
  if ( !on || !text ) return null;
  return { text, roll, dieIcon: ((roll !== null) || !!mode) && icons, icon: icons ? (ICONS[fact.kind] ?? null) : null, mode };
}

/**
 * §231 : le libellé d'une ligne — total du jet et mode (« 17 avec Avantage »), puis le texte : « 17 avec Avantage · Raté ».
 * @param {{text: string, roll: number|null, mode: string|null}} line
 * @param {Record<string, string>} modeText  mode → « Avantage » / « Désavantage ».
 * @param {string} [joiner]  Le mot entre le total et le mode (« avec »).
 */
export function floatLabel(line, modeText={}, joiner="") {
  const mode = line.mode ? modeText[line.mode] : null;
  const head = Number.isFinite(line.roll) ? (mode ? `${line.roll} ${joiner ? `${joiner} ` : ""}${mode}` : String(line.roll)) : mode;
  return [head || null, line.text || null].filter(Boolean).join(" · ");
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
