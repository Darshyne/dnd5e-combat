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
  check: "floatChecks", checkSuccess: "floatChecks", checkFail: "floatChecks",
  initiative: "floatInitiative"   // §400, lot 2
});

/** Les réglages de catégorie, dans l'ordre de la fenêtre, avec leur valeur par défaut. */
export const FLOAT_CATEGORY_DEFAULTS = Object.freeze({
  floatAttacks: true, floatHits: false, floatAdvantage: true, floatSaves: true, floatChecks: true, floatCover: true, floatReactions: true, floatStrikes: true,
  floatEffects: true, floatResources: true, floatPrompts: true, floatInitiative: true
});

/** Le rythme par défaut : durée (s), écart entre deux textes d'un même token (s), course (cases), taille (%). */
export const FLOAT_DEFAULTS = Object.freeze({ duration: 4, spacing: 1, distance: 1.5, scale: 100, direction: "down" });

/** Les sortes dont le pictogramme est celui d'un dé (le résultat du jet, réglage `floatDice`). */
const ROLLED = new Set(["hit", "critical", "miss", "saveSuccess", "saveFail", "check", "checkSuccess", "checkFail", "initiative"]);

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

/* -------------------------------------------- */
/*  §400 : le thème des textes flottants         */
/* -------------------------------------------- */

/*
 * §400 : chaque sorte de texte a son allure (police, couleur, contour, halo, pictogramme et son cadre, apparition, trajet), réglée pour la
 * table par un JSON importé (l'« Atelier des textes flottants », format `das-float-theme`). Les PV (`damage`, `healing`, `temp`) et les
 * effets qui commencent ou cessent (`effectOn`, `effectOff`) sont dessinés par le moteur quand ses textes flottants remplacent ceux du
 * système (réglage `floatSystem`). Les `dmg-<type>` (dégâts par type) et l'hexagone qui tourne (`spin`) sont gardés à l'import pour les
 * lots suivants, sans effet pour l'instant.
 */

/** Les pictogrammes du thème : un nom de l'atelier → une icône du cœur (public/icons/svg). Un chemin d'image est aussi accepté. */
export const FLOAT_ICONS = Object.freeze({
  none: null, d20: "icons/svg/d20.svg", shield: "icons/svg/shield.svg", lightning: "icons/svg/lightning.svg", explosion: "icons/svg/explosion.svg",
  skull: "icons/svg/skull.svg", sun: "icons/svg/sun.svg", hand: "icons/svg/holy-shield.svg", sword: "icons/svg/sword.svg", heart: "icons/svg/heal.svg",
  moon: "icons/svg/sleep.svg", eye: "icons/svg/eye.svg", ban: "icons/svg/cancel.svg", hourglass: "icons/svg/clockwork.svg", plus: "icons/svg/upgrade.svg",
  minus: "icons/svg/downgrade.svg", star: "icons/svg/aura.svg", target: "icons/svg/target.svg"
});

/** L'allure de départ de chaque sorte : celle du moteur avant le thème (ui/feedback.mjs, STYLES et pictogrammes). */
const BASE = {
  critical: ["#ffd24a", 30, "explosion"], miss: ["#d0d0d0", 24, "none"], hit: ["#ffffff", 22, "none"], cover: ["#9ecbff", 20, "shield"],
  reaction: ["#c49bff", 22, "lightning"], saveSuccess: ["#8fd18f", 22, "none"], saveFail: ["#e07a6a", 22, "skull"],
  duplicate: ["#c49bff", 22, "none"], unaffected: ["#d0d0d0", 20, "none"], prompt: ["#ffb347", 24, "none"], refused: ["#ff7070", 22, "none"],
  ended: ["#9ecbff", 20, "none"], gain: ["#8fd18f", 22, "none"], spend: ["#ffb347", 20, "none"], strike: ["#e0453a", 26, "none"],
  heroic: ["#ffd24a", 28, "none"], atCost: ["#e0a050", 26, "none"], check: ["#f0e6c8", 22, "none"], checkSuccess: ["#8fd18f", 22, "none"],
  checkFail: ["#e07a6a", 22, "none"], initiative: ["#f0e6c8", 22, "none"],
  // §400 : ce que le système dessinait (dnd5e `tokenHPColors`, documents/actor/actor.mjs:3557 ; cœur, active-effect.mjs:1039).
  damage: ["#ff3030", 28, "none"], healing: ["#30ff50", 28, "none"], temp: ["#66ccff", 26, "none"],
  effectOn: ["#f0e6c8", 22, "none"], effectOff: ["#a8a29a", 20, "none"]
};
/** Les sortes que le thème connaît, dans l'ordre de la fenêtre. */
export const FLOAT_KINDS = Object.freeze(Object.keys(BASE));

const SEGMENTS = {
  weight: [400, 500, 600, 700], badge: ["none", "hex", "circle"], entrance: ["fade", "grow", "pop", "slide"], motion: ["float", "anchor", "arc"]
};
const RANGES = { size: [10, 64], tracking: [0, 0.4], strokeW: [0, 10], glow: [0, 30], spread: [0.2, 3], spinMs: [200, 3000] };
const COLORS = ["color", "stroke", "glowColor", "badgeColor", "badgeBorder", "okColor", "failColor"];
const FLAGS = ["show", "upper", "italic", "spin"];

/** L'allure par défaut d'une sorte (police du cœur, Signika). */
export function floatStyleDefault(kind) {
  const [color, size, icon] = BASE[kind] ?? ["#f0e6c8", 22, "none"];
  return { show: true, color, size, font: "Signika", weight: 600, upper: false, tracking: 0, italic: false, stroke: "#000000", strokeW: 4,
    glow: 0, glowColor: color, icon, badge: "none", badgeColor: "#1a1a1a", badgeBorder: color, entrance: "grow", motion: "float", spread: 1,
    spin: false, spinMs: 900, okColor: "#3f9cff", failColor: "#e0453a" };
}

/** Une couleur `#rrggbb`, ou null. */
function hexColor(value) {
  return ((typeof value === "string") && /^#[0-9a-f]{6}$/i.test(value)) ? value.toLowerCase() : null;
}

/**
 * Une allure lue d'un JSON : chaque champ vérifié, borné, ou ignoré ; ce qui manque garde la valeur par défaut. Les noms de police de
 * l'atelier (« Signika (Foundry) ») sont ramenés à la famille ; une police inconnue de ce monde (`fonts`) est refusée.
 * @param {object} raw
 * @param {string} kind
 * @param {{fonts?: string[]}} [options]
 * @returns {{style: object, problems: string[]}}
 */
export function floatStyleFrom(raw, kind, { fonts=null }={}) {
  const style = floatStyleDefault(kind);
  const problems = [];
  if ( !raw || (typeof raw !== "object") ) return { style, problems };
  for ( const key of COLORS ) if ( key in raw ) {
    const c = hexColor(raw[key]);
    if ( c ) style[key] = c; else problems.push(`${kind}.${key}`);
  }
  for ( const key of FLAGS ) if ( typeof raw[key] === "boolean" ) style[key] = raw[key];
  for ( const [key, [min, max]] of Object.entries(RANGES) ) if ( key in raw ) {
    const n = Number(raw[key]);
    if ( Number.isFinite(n) ) style[key] = Math.min(max, Math.max(min, n)); else problems.push(`${kind}.${key}`);
  }
  for ( const [key, values] of Object.entries(SEGMENTS) ) if ( key in raw ) {
    const v = (key === "weight") ? Number(raw[key]) : raw[key];
    if ( values.includes(v) ) style[key] = v; else problems.push(`${kind}.${key}`);
  }
  if ( "icon" in raw ) {
    const icon = raw.icon;
    if ( (icon in FLOAT_ICONS) || ((typeof icon === "string") && /\.(svg|webp|png|jpe?g)$/i.test(icon)) ) style.icon = icon;
    else problems.push(`${kind}.icon`);
  }
  if ( typeof raw.font === "string" ) {
    const font = raw.font.replace(/\s*\(.*\)\s*$/, "").trim();
    if ( !fonts || fonts.includes(font) ) style.font = font; else problems.push(`${kind}.font: ${font}`);
  }
  return { style, problems };
}

/** Les réglages de rythme qu'un thème peut porter, avec leurs bornes (celles des réglages du monde, ui/feedback.mjs). */
export const FLOAT_GLOBAL_RANGES = Object.freeze({
  floatDuration: [1, 10], floatSpacing: [0.2, 3], floatDistance: [0.5, 4], floatScale: [50, 250]
});

/**
 * Un thème importé : le JSON de l'atelier (`format: "das-float-theme"`) ou un objet `{ types }`. Rend les allures des sortes (une sorte que
 * le moteur ne dessine pas encore, comme `dmg-fire`, est gardée pour plus tard), les réglages de rythme bornés, et ce qui a été refusé.
 * @param {object|string} json
 * @param {{fonts?: string[]}} [options]
 * @returns {{theme: Record<string, object>, global: Record<string, number|string|boolean>, problems: string[]}}
 */
export function floatThemeFrom(json, { fonts=null }={}) {
  const data = (typeof json === "string") ? JSON.parse(json) : json;
  if ( !data || (typeof data !== "object") || !data.types || (typeof data.types !== "object") ) throw new Error("expected { types: { … } }");
  if ( data.format && (data.format !== "das-float-theme") ) throw new Error(`unknown format ${data.format}`);
  const theme = {};
  const problems = [];
  for ( const [kind, raw] of Object.entries(data.types) ) {
    if ( !/^[a-zA-Z][\w-]{0,40}$/.test(kind) ) { problems.push(kind); continue; }
    const result = floatStyleFrom(raw, kind, { fonts });
    theme[kind] = result.style;
    problems.push(...result.problems);
  }
  const global = {};
  const g = data.global ?? {};
  for ( const [key, [min, max]] of Object.entries(FLOAT_GLOBAL_RANGES) ) if ( key in g ) {
    const n = Number(g[key]);
    if ( Number.isFinite(n) ) global[key] = Math.min(max, Math.max(min, n));
  }
  if ( ["up", "down"].includes(g.floatDirection) ) global.floatDirection = g.floatDirection;
  for ( const key of ["floatDice", "floatIcons", "floatAdvantage"] ) if ( typeof g[key] === "boolean" ) global[key] = g[key];
  return { theme, global, problems };
}

/** Le thème d'export : toutes les sortes connues, avec leur allure courante. */
export function floatThemeExport(theme={}, global={}) {
  const types = {};
  for ( const kind of new Set([...FLOAT_KINDS, ...Object.keys(theme)]) ) types[kind] = { ...floatStyleDefault(kind), ...(theme[kind] ?? {}) };
  return { format: "das-float-theme", version: 1, global, types };
}

/** L'allure d'une sorte d'après le thème du monde (ce qui manque : la valeur par défaut). */
export function floatStyleOf(theme, kind) {
  return { ...floatStyleDefault(kind), ...(theme?.[kind] ?? {}) };
}

const easeInOut = x => 0.5 - (Math.cos(Math.PI * x) / 2);

/**
 * Le décalage d'un texte à l'avancement `p` (0 → 1), selon son trajet : `float` court `travel` (px, signé), `anchor` reste en place,
 * `arc` part sur le côté (`side` ±1, `spread` px), monte de `rise` px puis retombe de `drop` px.
 * @returns {{dx: number, dy: number}}
 */
export function floatOffset(p, motion, { travel=0, side=1, spread=0, rise=0, drop=0 }={}) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  if ( motion === "anchor" ) return { dx: 0, dy: 0 };
  if ( motion === "arc" ) return { dx: side * spread * easeInOut(Math.min(1, t * 1.25)), dy: (-rise * 4 * t * (1 - t)) + (t * drop) };
  return { dx: 0, dy: travel * easeInOut(t) };
}

/** L'échelle et le glissement d'apparition à l'avancement `p`, selon l'entrée choisie (`grow` : celle de `floatFrame`). */
export function floatEntrance(p, entrance) {
  const t = Math.min(1, Math.max(0, Number(p) || 0));
  if ( entrance === "pop" ) return { scale: (t < 0.1) ? 0.4 + easeInOut(t / 0.1) : (t < 0.2) ? 1.4 - (0.4 * easeInOut((t - 0.1) / 0.1)) : 1, dx: 0 };
  if ( entrance === "slide" ) return { scale: 1, dx: (t < 0.15) ? -30 * (1 - easeInOut(t / 0.15)) : 0 };
  if ( entrance === "fade" ) return { scale: 1, dx: 0 };
  return { scale: (t < 0.15) ? 0.6 + (0.4 * easeInOut(t / 0.15)) : 1, dx: 0 };
}

/**
 * §400 : le texte d'un changement de PV, comme dnd5e le choisit (documents/actor/actor.mjs:3532, `_displayTokenEffect`) : dégâts si les
 * PV baissent, soins s'ils montent, PV temporaires sinon ; la taille suit la part des PV max (dnd5e : 16 → 48 px, ici × 0,6 → 1,8).
 * @param {{hp: number, temp: number, total: number}} changes
 * @param {number} max   PV max.
 * @returns {{kind: "damage"|"healing"|"temp", value: number, factor: number}|null}
 */
export function hpFloat(changes, max) {
  let kind = null;
  let value = 0;
  if ( changes?.hp < 0 ) { kind = "damage"; value = changes.total; }
  else if ( changes?.hp > 0 ) { kind = "healing"; value = changes.total; }
  else if ( changes?.temp ) { kind = "temp"; value = changes.temp; }
  if ( !kind || !value ) return null;
  const pct = Math.min(1, Math.max(0, Math.abs(value) / (Number(max) || Math.abs(value))));
  return { kind, value, factor: 0.6 + (1.2 * pct) };
}

/**
 * §400, lot 2 : l’issue d’un jet, pour la bordure de l’hexagone qui tourne — « ok » (bleu par défaut), « fail » (rouge), ou null (neutre :
 * test sans DD, initiative), la bordure gardant alors sa couleur.
 * @param {string} kind
 * @returns {"ok"|"fail"|null}
 */
export function floatOutcome(kind) {
  if ( ["saveSuccess", "checkSuccess", "critical", "hit"].includes(kind) ) return "ok";
  if ( ["saveFail", "checkFail", "miss"].includes(kind) ) return "fail";
  return null;
}

/** §400, lot 2 : la sorte porte-t-elle un jet (son total va dans l’hexagone) ? */
export function floatRolled(kind) {
  return ROLLED.has(kind);
}

/**
 * §400, lot 2 : la phase de l’hexagone à `ms` millisecondes : il tourne pendant `spinMs` (`angle` en radians, un tour par seconde environ),
 * puis se révèle — `pulse` (1,4 → 1 sur 240 ms) et `text` (opacité du texte, 0 → 1 sur 260 ms).
 * @returns {{spinning: boolean, angle: number, pulse: number, text: number}}
 */
export function spinPhase(ms, spinMs) {
  const t = Math.max(0, Number(ms) || 0);
  if ( t < spinMs ) return { spinning: true, angle: t * 0.0157, pulse: 1, text: 0 };
  const after = t - spinMs;
  return { spinning: false, angle: 0, pulse: 1 + (0.4 * Math.max(0, 1 - (after / 240))), text: Math.min(1, after / 260) };
}
