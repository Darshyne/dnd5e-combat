/**
 * Lumière et ténèbres des sorts (SPEC §16.31, clé `light` de core/content.mjs). dnd5e 6 et le PHB 2.2.0 ne donnent aucune
 * source de lumière à ces sorts (Ténèbres et Lumière du jour : activité utilitaire à sphère ; Poussière d'étoile et Lueurs
 * féeriques : effet sans changement) ; le cœur V14 sait pourtant tout faire — lumière ambiante, source de ténèbres
 * (`config.negative`), et changements `token.light.*` portés par un effet actif (client/documents/actor.mjs:248).
 * Ici : les calculs, sans Foundry.
 *
 * Rayons dans la convention de Foundry : `bright` = rayon de la lumière vive, `dim` = rayon EXTÉRIEUR de la lumière
 * faible (Lumière du jour : vive sur 18 m et faible sur 18 m de plus → bright 60, dim 120).
 */

/** Les modes de `light.on`. */
export const LIGHT_ON = Object.freeze(["area", "effect", "summon", "wall", "caster"]);

/**
 * Les rayons de la source d'une zone : ceux de la règle, sinon (ténèbres) le rayon de la zone elle-même.
 * @param {{bright?: number, dim?: number, darkness?: boolean}} rule   Rayons déjà dans l'unité de la grille.
 * @param {number} areaRadius                                         Rayon de la zone, unité de la grille.
 * @returns {{bright: number, dim: number, negative: boolean}}
 */
export function areaLightRadii(rule, areaRadius) {
  if ( rule.darkness ) return { bright: areaRadius, dim: areaRadius, negative: true };
  const bright = rule.bright ?? 0;
  return { bright, dim: Math.max(rule.dim ?? bright, bright), negative: false };
}

/**
 * Les changements d'effet actif qui font briller le porteur (`token.light.*`, appliqués par le cœur V14). `upgrade` : une
 * lumière plus forte déjà portée (torche, autre sort) n'est pas diminuée.
 * @param {{bright?: number, dim?: number, color?: string|null, animation?: object|null}} light  Rayons, unité de la grille.
 */
export function tokenLightChanges({ bright=0, dim=0, color=null, animation=null, alpha=null, angle=null }) {
  const changes = [];
  const push = (key, value, type) => changes.push({ key: `token.light.${key}`, type, value: String(value), phase: "initial" });
  if ( bright > 0 ) push("bright", bright, "upgrade");
  push("dim", Math.max(dim, bright), "upgrade");
  if ( color ) push("color", color, "override");
  if ( Number.isFinite(alpha) ) push("alpha", alpha, "override");
  // §52 : un cône (lanterne sourde), orienté comme le token.
  if ( Number.isFinite(angle) && (angle > 0) && (angle < 360) ) push("angle", angle, "override");
  if ( animation?.type ) {
    push("animation.type", animation.type, "override");
    if ( Number.isFinite(animation.speed) ) push("animation.speed", animation.speed, "override");
    if ( Number.isFinite(animation.intensity) ) push("animation.intensity", animation.intensity, "override");
  }
  return changes;
}

/**
 * Les ténèbres que dissipe une lumière (Lumière du jour : « si une partie de la zone recouvre des Ténèbres créées par un sort
 * de niveau 3 ou inférieur, ce sort est dissipé »). Deux sphères se recouvrent quand leurs centres sont plus proches que la
 * somme des rayons.
 * @param {{x: number, y: number, radius: number}} light
 * @param {number} maxLevel
 * @param {Array<{id: string, x: number, y: number, radius: number, level: number|null}>} darkness
 * @returns {string[]}  Les ids dissipés.
 */
export function dispelledBy(light, maxLevel, darkness) {
  return darkness.filter(d => {
    if ( Number.isFinite(d.level) && (d.level > maxLevel) ) return false;
    return Math.hypot(d.x - light.x, d.y - light.y) < (d.radius + light.radius);
  }).map(d => d.id);
}

/**
 * Les sens qui percent une zone qui bloque la vue. Brume (`obscures`) : ceux qui ne voient pas (vision aveugle, et les modes du cœur sans
 * murs : `CORE_JUDGED`). Ténèbres magiques : ceux-là, plus la vision véritable (`seeAll` de dnd5e) et la Vision du diable — la vision
 * dans le noir, elle, n'y voit rien (PHB 2024, Ténèbres).
 * La Vision du diable se juge à part (portée, adapter/vision.mjs).
 * @param {{fog: boolean, darkness: boolean}} blocked
 */
export function sensesThrough({ fog, darkness }) {
  if ( fog ) return ["blindsight", ...CORE_JUDGED];
  if ( darkness ) return ["blindsight", ...CORE_JUDGED, "seeAll", DEVILS_SIGHT_MODE];
  return null;
}

/**
 * Les modes de détection du cœur sans murs ni lumière (`walls: false`, client/config.mjs:1312-1337) : la perception des vibrations, et
 * les modes génériques « Sense All » / « Sense Invisibility » qu'un MJ coche à la main. Ils percent brume et ténèbres, et le test du cœur
 * les juge tels quels (ni bords de ténèbres ni aveuglement : `DetectionMode#_canDetect`, detection-mode.mjs). Issue #42 : les deux
 * derniers étaient perçus à l'écran à travers des Ténèbres, mais pas par les règles.
 */
export const CORE_JUDGED = Object.freeze(["feelTremor", "senseAll", "senseInvisibility"]);

/**
 * Portée de la Vision du diable (« dans un rayon de 36 m »), en pieds. `mode` : l'id du mode de détection que le moteur enregistre
 * (issue #42, ui/perception.mjs) et donne en mémoire aux tokens dont l'acteur a l'invocation.
 */
export const DEVILS_SIGHT_MODE = "devilsSight";
export const DEVILS_SIGHT = Object.freeze({ identifier: "devils-sight", range: 120, units: "ft", mode: DEVILS_SIGHT_MODE });

/**
 * Issue #42, suite (0.281.1) : le filtre d'une créature vue par la Vision du diable (ui/perception.mjs) : token teinté de rouge, liseré rouge
 * sombre. Un mode spécial SANS filtre n'est dessiné que sous le voile de vision du cœur : dans des Ténèbres vues de l'extérieur,
 * le token « visible » restait une silhouette noire. Avec un filtre, le cœur le redessine au-dessus du voile (placeables/token.mjs,
 * `detectionFilterMesh`).
 */
export const DEVILS_SIGHT_OUTLINE = Object.freeze({ outlineColor: Object.freeze([0.6, 0.08, 0.08, 1]), thickness: 2, knockout: false, wave: false,
  // Choix de l'utilisateur (2026-11-11) : un token net doit vouloir dire « vue normale » — la Vision du diable teinte aussi le token en rouge.
  tintColor: Object.freeze([1, 0.22, 0.18]), tintStrength: 0.65 });

/** La ligne du shader de contour du cœur (rendering/filters/outline-overlay.mjs) où la couleur du token est composée. */
const OUTLINE_TEXCOLOR = "vec4 texColor = mix(baseColor, wColor, k) * texAlpha;";

/**
 * Issue #42, suite : le shader de contour du cœur, avec la teinte rouge de la Vision du diable sur le token (luminance × teinte, mêlée à la
 * couleur d'origine selon `tintStrength` ; couleurs prémultipliées, l'alpha n'est pas touché). Null si la ligne attendue n'y est plus
 * (cœur changé) : l'appelant garde alors le contour seul.
 * @param {string} source  Le fragment shader de `OutlineOverlayFilter`.
 * @returns {string|null}
 */
export function tintOutlineShader(source) {
  if ( (typeof source !== "string") || !source.includes(OUTLINE_TEXCOLOR) || !source.includes("void main(void)") ) return null;
  return source
    .replace("void main(void)", `uniform vec3 tintColor;
    uniform float tintStrength;

    void main(void)`)
    .replace(OUTLINE_TEXCOLOR, `${OUTLINE_TEXCOLOR}
      float tintLum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
      texColor.rgb = mix(texColor.rgb, tintLum * tintColor, tintStrength);`);
}

/**
 * Issue #42, suite : un token jugé visible par ce client, mais dessiné SOUS le voile de vision — affiché sans filtre de détection, hors de
 * sa propre vue, et hors de la zone que voit chaque source active (le polygone de vue). Ce que le joueur voit alors : rien, ou une
 * silhouette noire. Un défaut d'affichage (runtime/testing-vision.mjs, état « veiled »).
 * @param {{visible: boolean, filtered: boolean, ownVision?: boolean, inSight: boolean}} state
 */
export function drawnUnderVeil({ visible, filtered, ownVision=false, inSight }) {
  return !!visible && !filtered && !ownVision && !inSight;
}

/** Issue #42 : le mode spécial de l'ouïe d'un observateur Aveuglé (ui/perception.mjs), donné en mémoire comme la Vision du diable. */
export const HEARING_MODE = "dasHearing";

/**
 * Issue #42 : pose sur les modes de détection PRÉPARÉS d'un token (objet ordinaire, jamais la source) ceux que le moteur donne en mémoire —
 * la Vision du diable (portée, unité de la grille ; 0 = pas d'invocation : retirée) et l'ouïe d'un Aveuglé, posée en dernier (le cœur
 * essaie les modes spéciaux dans l'ordre : un vrai sens passe avant). Rend true si quelque chose manquait ou différait : la préparation
 * des données du token (`TokenDocument#reset`) les avait effacés, ou un effet `token.detectionModes.devilsSight.range` avait laissé un mode
 * sans `enabled` — la vue doit alors se refaire.
 * @param {Record<string, {enabled?: boolean, range?: number|null}>} modes
 * @param {{devilsSight?: number, hearing?: boolean}} wanted
 */
export function grantInMemoryModes(modes, { devilsSight=0, hearing=false }={}) {
  let changed = false;
  const had = modes[DEVILS_SIGHT_MODE];
  if ( devilsSight > 0 ) {
    changed ||= (had?.enabled !== true) || (had.range !== devilsSight);
    modes[DEVILS_SIGHT_MODE] = { enabled: true, range: devilsSight };
  }
  else if ( had ) { changed = true; delete modes[DEVILS_SIGHT_MODE]; }
  if ( hearing ) {
    const keys = Object.keys(modes);
    changed ||= (modes[HEARING_MODE]?.enabled !== true) || (keys.at(-1) !== HEARING_MODE);
    delete modes[HEARING_MODE];
    modes[HEARING_MODE] = { enabled: true, range: Infinity };
  }
  return changed;
}

/**
 * Issue #42 : la Vision du diable voit-elle la cible ? « Vous voyez normalement dans les ténèbres, magiques ou non, jusqu'à 36 m » :
 * à portée, ligne de vue (murs, planchers — pas les bords des ténèbres), observateur non Aveuglé, cible ni Invisible (sauf révélée) ni
 * dans une brume (la Vision du diable perce les ténèbres, pas la brume).
 * @param {object} state
 * @param {number} state.distance   Distance observateur → cible, unité de la grille.
 * @param {number} state.range      Portée de la Vision du diable, même unité ; 0 : pas d'invocation.
 * @param {boolean} [state.lineOfSight]  Ligne de vue sans les bords des sources de ténèbres.
 * @param {boolean} [state.invisible]    Cible Invisible, non révélée à l'observateur.
 * @param {boolean} [state.blind]        Observateur Aveuglé.
 * @param {boolean} [state.fog]          Une brume coupe la vue entre les deux.
 */
export function devilsSightSees({ distance, range, lineOfSight=true, invisible=false, blind=false, fog=false }) {
  if ( !(range > 0) || !Number.isFinite(distance) || (distance > range) ) return false;
  return !!lineOfSight && !invisible && !blind && !fog;
}

/** Les sens qui ne sont pas une vue : un observateur Aveuglé les garde (vision aveugle, et les modes du cœur sans murs). */
/**
 * Réglage `unconsciousSenses` : une créature Inconsciente est « inconsciente de ce qui l'entoure » (PHB 2024, glossaire) — avec le
 * réglage, elle ne voit ni n'entend plus rien. Sans lui (défaut), ses sens restent ceux d'une créature éveillée.
 * @param {{unconscious: boolean, rule: boolean}} state
 */
export function senseless({ unconscious=false, rule=false }={}) {
  return !!(unconscious && rule);
}

export const WORKS_BLIND = Object.freeze(["blindsight", ...CORE_JUDGED]);

/**
 * Issue #42 : un sens qui perce une zone qui bloque la vue (vision aveugle, vision véritable) atteint-il la cible ? Sa portée et la ligne
 * de vue (sans les bords des ténèbres) ; `range` null ou absent = illimité. Un observateur Aveuglé (`blind`) ne voit plus par un sens qui
 * est une vue (`sense` hors de `WORKS_BLIND` : la vision véritable) — la vision aveugle, elle, le reste.
 */
export function senseReaches({ distance, range=null, lineOfSight=true, sense=null, blind=false }) {
  if ( blind && !WORKS_BLIND.includes(sense) ) return false;
  if ( !lineOfSight || !Number.isFinite(distance) ) return false;
  return (range === null) || (range === Infinity) || (distance <= range);
}

/* -------------------------------------------- */
/*  Durée et combustible des sources portées    */
/* -------------------------------------------- */

const BURN_SECONDS = { second: 1, minute: 60, hour: 3600 };

/**
 * §121 : la durée d'une source portée (`carriedLight.burn`), en secondes : « une torche brûle 1 heure », « une flasque d'huile
 * brûle 6 heures dans une lampe ou une lanterne ». null : pas de durée.
 * @param {{value: number, units: "second"|"minute"|"hour"}|undefined} burn
 */
export function burnSeconds(burn) {
  const n = Number(burn?.value);
  return (Number.isFinite(n) && (n > 0) && BURN_SECONDS[burn.units]) ? n * BURN_SECONDS[burn.units] : null;
}

/**
 * §121 : ce que demande l'allumage. `stored` : le temps qui restait quand on l'a éteinte (indéfini : jamais allumée — une torche
 * neuve, une lampe remplie) ; `full` : une torche entière, une flasque entière ; `fuel` : la source brûle un combustible (lampe,
 * lanterne) ; `hasFuel` : le porteur en a une flasque.
 * @returns {{ok: true, left: number|null, refill: boolean}|{ok: false, reason: "noFuel"}}
 */
export function lightPlan({ stored, full, fuel=false, hasFuel=false }) {
  if ( !Number.isFinite(full) ) return { ok: true, left: null, refill: false };
  if ( (stored === undefined) || (stored === null) ) return { ok: true, left: full, refill: false };
  if ( stored > 0 ) return { ok: true, left: Math.min(stored, full), refill: false };
  if ( !fuel ) return { ok: true, left: full, refill: false };   // une torche consumée a laissé place à la suivante
  return hasFuel ? { ok: true, left: full, refill: true } : { ok: false, reason: "noFuel" };
}

/**
 * §121 : la source s'est consumée. Une torche, une bougie : l'unité brûlée disparaît (quantité − 1, l'item retiré à la dernière),
 * la suivante sera neuve ; une lampe, une lanterne : elle reste, vide (il faudra une flasque pour la rallumer).
 * @returns {{consume: boolean, stored: number|undefined}}
 */
export function burnoutPlan({ fuel=false }) {
  return fuel ? { consume: false, stored: 0 } : { consume: true, stored: undefined };
}

/** Le temps restant en heures et minutes (arrondi à la minute supérieure). */
export function burnParts(seconds) {
  const minutes = Math.max(0, Math.ceil((Number(seconds) || 0) / 60));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * §121 : les mains qu'occupe ce que la créature tient — une arme équipée (deux si elle est « à deux mains »), un bouclier, une
 * source de lumière allumée. Une créature a deux mains.
 * @param {Array<{name: string, hands: number}>} held
 * @returns {{used: number, free: number}}
 */
export function handsOf(held) {
  const used = held.reduce((n, h) => n + Math.max(0, Number(h.hands) || 0), 0);
  return { used, free: Math.max(0, 2 - used) };
}
