/**
 * Ce que les états (règles 2024) changent à un jet, quand cela dépend de DEUX créatures ou de la
 * situation. Fonctions pures, aucune dépendance à Foundry.
 *
 * Un seul propriétaire par effet : tout ce qu'un état fait à celui qui le porte, dnd5e 6.0
 * l'applique déjà (CONFIG.DND5E.conditionEffects, config.mjs:3799-3819) et n'est PAS repris ici :
 * Empoisonné (désavantage aux attaques et aux tests), Entravé (désavantage aux sauvegardes de
 * Dextérité), Esquive (avantage aux sauvegardes de Dextérité), encombrement, épuisement,
 * initiative. Seule exception assumée : l'attaquant Entravé, À terre, Aveuglé ou Effrayé, que le
 * système ne traite pas.
 */

/** États de l'attaquant qui lui donnent un désavantage à l'attaque. */
const ATTACKER_DISADVANTAGE = ["blinded", "frightened", "prone", "restrained"];
/** États de l'attaquant qui lui donnent un avantage à l'attaque. */
const ATTACKER_ADVANTAGE = ["invisible"];
/** États de la cible qui donnent un avantage à qui l'attaque. */
const TARGET_ADVANTAGE = ["blinded", "paralyzed", "petrified", "restrained", "stunned", "unconscious"];
/** États de la cible qui donnent un désavantage à qui l'attaque. */
const TARGET_DISADVANTAGE = ["invisible", "dodging"];
/** États qui font échouer d'office les sauvegardes de Force et de Dextérité. */
const AUTO_FAIL_SAVE = ["paralyzed", "petrified", "stunned", "unconscious"];
/** États qui transforment en coup critique toute attaque qui touche à 5 ft ou moins. */
const AUTO_CRITICAL = ["paralyzed", "unconscious"];

/**
 * @typedef {object} Reason
 * @property {"attacker"|"target"|"situation"|"content"} who
 * @property {string} key  Identifiant d'état dnd5e, clé de situation ("longRange", "closeCombat", "proneFar"),
 *                         ou, pour "content", le nom de l'item qui le déclare (SPEC §16, B6).
 */

/**
 * États que la VISION subsume quand on sait qui voit qui (règles 2024, « attaquants et cibles non
 * vus ») : Aveuglé et Invisible ne valent que par ce qu'ils font voir ou non — et une vision
 * aveugle voit un invisible. Sans faits de vision, ces états gardent leur effet forfaitaire.
 */
const SUBSUMED_BY_VISION = ["blinded", "invisible"];

/**
 * Sources d'avantage et de désavantage d'une attaque contre UNE cible.
 * @param {object} context
 * @param {string[]} context.attacker       États de l'attaquant.
 * @param {string[]} context.target         États de la cible.
 * @param {boolean} context.adjacent        La cible est à 5 ft ou moins.
 * @param {boolean} context.ranged          Attaque à distance (arme à distance, arme lancée, sort à distance).
 * @param {boolean} [context.longRange]     Cible au-delà de la portée normale.
 * @param {boolean} [context.closeCombat]   Un ennemi valide se tient à 5 ft de l'attaquant.
 * @param {{attackerSees: boolean, targetSees: boolean}|null} [context.vision]
 *        Qui voit qui, si on le sait (P1) : attaquer sans voir = désavantage, attaquer sans être vu = avantage.
 * @param {boolean|null} [context.grappledElsewhere]
 *        Agrippé (règle 2024) : désavantage aux attaques contre toute cible autre que celui qui agrippe.
 *        true = l'attaquant est agrippé et la cible n'est pas son agrippeur ; null = inconnu (pas de désavantage).
 * @param {boolean} [context.helped]
 *        Soutien (2024) : un allié de l'attaquant a distrait la cible — avantage.
 * @param {boolean|null} [context.frightenedSourceSeen]
 *        Effrayé : « tant que la source de la peur est en vue ». false = aucune source connue n'est
 *        en vue, l'état ne gêne pas l'attaque ; null = source inconnue ou non jugée, l'état s'applique.
 * @param {{advantage?: string[], disadvantage?: string[]}} [context.declared]
 *        Ce que le contenu déclare (§16, B6 : Lueurs féeriques, Tactique de meute…), par nom d'item.
 * @returns {{advantage: Reason[], disadvantage: Reason[]}}
 */
export function attackModifiers({ attacker, target, adjacent, ranged, longRange=false, closeCombat=false, vision=null, frightenedSourceSeen=null, grappledElsewhere=null, helped=false, declared=null, elusive=false }) {
  const advantage = (declared?.advantage ?? []).map(key => ({ who: "content", key }));
  const disadvantage = (declared?.disadvantage ?? []).map(key => ({ who: "content", key }));
  const kept = key => !vision || !SUBSUMED_BY_VISION.includes(key);
  for ( const key of ATTACKER_ADVANTAGE ) if ( attacker.includes(key) && kept(key) ) advantage.push({ who: "attacker", key });
  for ( const key of ATTACKER_DISADVANTAGE ) {
    if ( !attacker.includes(key) || !kept(key) ) continue;
    if ( (key === "frightened") && (frightenedSourceSeen === false) ) continue;
    disadvantage.push({ who: "attacker", key });
  }
  for ( const key of TARGET_ADVANTAGE ) if ( target.includes(key) && kept(key) ) advantage.push({ who: "target", key });
  for ( const key of TARGET_DISADVANTAGE ) {
    if ( !target.includes(key) || !kept(key) ) continue;
    // Esquive (2024) : désavantage seulement si la cible voit l'attaquant.
    if ( (key === "dodging") && vision && !vision.targetSees ) continue;
    disadvantage.push({ who: "target", key });
  }
  if ( vision ) {
    if ( !vision.attackerSees ) disadvantage.push({ who: "target", key: "unseen" });
    if ( !vision.targetSees ) advantage.push({ who: "attacker", key: "unseen" });
  }
  if ( grappledElsewhere === true ) disadvantage.push({ who: "attacker", key: "grappled" });
  if ( helped === true ) advantage.push({ who: "situation", key: "helped" });
  // À terre : avantage pour qui est au contact, désavantage pour tous les autres.
  if ( target.includes("prone") ) (adjacent ? advantage : disadvantage).push({ who: "target", key: adjacent ? "prone" : "proneFar" });
  if ( ranged && longRange ) disadvantage.push({ who: "situation", key: "longRange" });
  if ( ranged && closeCombat ) disadvantage.push({ who: "situation", key: "closeCombat" });
  // §20 : Insaisissable — « aucun jet d'attaque ne peut avoir l'Avantage contre vous » : les raisons d'avantage ne comptent plus.
  if ( elusive ) return { advantage: [], disadvantage };
  return { advantage, disadvantage };
}

/**
 * Le mode du jet : dès qu'il y a au moins un avantage ET un désavantage, ils s'annulent tous,
 * quel que soit leur nombre.
 * @returns {1|0|-1}
 */
export function netMode({ advantage, disadvantage }) {
  if ( advantage.length && !disadvantage.length ) return 1;
  if ( disadvantage.length && !advantage.length ) return -1;
  return 0;
}

/**
 * Plusieurs cibles, un seul jet : on ne tranche que si toutes les cibles donnent le même mode.
 * @param {Array<{advantage: Reason[], disadvantage: Reason[]}>} perTarget
 * @returns {{mode: 1|0|-1, agreed: boolean}}
 */
export function combineTargets(perTarget) {
  const modes = new Set(perTarget.map(netMode));
  if ( modes.size <= 1 ) return { mode: perTarget.length ? netMode(perTarget[0]) : 0, agreed: true };
  return { mode: 0, agreed: false };
}

/** Une attaque qui touche cette cible est-elle d'office un coup critique ? */
export function isAutoCritical(targetStatuses, adjacent) {
  return adjacent && AUTO_CRITICAL.some(s => targetStatuses.includes(s));
}

/**
 * L'état qui fait échouer d'office cette sauvegarde, ou null.
 * @param {string[]} statuses
 * @param {string} ability  Caractéristique de la sauvegarde ("str", "dex"…).
 */
export function autoFailSave(statuses, ability) {
  if ( !["str", "dex"].includes(ability) ) return null;
  return AUTO_FAIL_SAVE.find(s => statuses.includes(s)) ?? null;
}

/** États qui rendent impossible un sort à composante verbale (Silence 2024 : lancer un tel sort y est impossible). */
const NO_VERBAL = ["silenced"];

/**
 * L'état qui empêche de lancer ce sort, ou null. Seule la composante verbale est en cause : un sort
 * lancé par un objet qui en dispense (activité « cast », dnd5e 6 `documents/activity/cast.mjs:171-174`) passe.
 * @param {string[]} statuses
 * @param {{spell: boolean, verbal: boolean}} use  L'item utilisé est-il un sort, et garde-t-il sa composante V ?
 */
export function verbalSpellBlocked(statuses, { spell, verbal }) {
  if ( !spell || !verbal ) return null;
  return NO_VERBAL.find(s => statuses.includes(s)) ?? null;
}

/** États qui neutralisent (règles 2024 : Neutralisé, et les états qui l'entraînent). */
export const INCAPACITATING = Object.freeze(["incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"]);

/**
 * Cette créature, à 5 ft de l'attaquant, lui donne-t-elle le désavantage à une attaque à distance ? (PHB 2024 « Attaques à
 * distance en combat rapproché » : « un ennemi qui vous voit et qui ne subit pas l'état Neutralisé ».) Un mort ne gêne
 * personne ; `seesAttacker` null (vision hors service) : on ne sait pas, elle gêne.
 * @param {{hostile: boolean, statuses: string[], dead?: boolean, seesAttacker?: boolean|null}} other
 */
export function hampersRangedAttack({ hostile, statuses, dead=false, seesAttacker=null }) {
  if ( !hostile || dead ) return false;
  if ( INCAPACITATING.some(s => statuses.includes(s)) ) return false;
  return seesAttacker !== false;
}

/**
 * Une empoignade tient-elle encore ? (règle 2024) Elle cesse si l'agrippeur est neutralisé ou si la
 * distance entre lui et la cible dépasse la portée de l'empoignade.
 * @param {object} context
 * @param {string[]} context.grapplerStatuses  États de l'agrippeur.
 * @param {boolean} context.withinReach        La cible est-elle encore à portée de l'empoignade ?
 */
export function grappleHolds({ grapplerStatuses, withinReach }) {
  if ( INCAPACITATING.some(s => grapplerStatuses.includes(s)) ) return false;
  return withinReach;
}

/* -------------------------------------------- */
/*  §17.3 : ce que les états interdisent        */
/* -------------------------------------------- */

/**
 * Neutralisé (2024) : « vous ne pouvez effectuer aucune action, action Bonus ni Réaction ». Aussi pour les états qui
 * l'entraînent (Étourdi, Paralysé, Pétrifié, Inconscient) et Mort.
 * @param {{statuses: string[], cost: string|null}} use  États de l'utilisateur, coût de l'utilisation.
 * @returns {string[]}  ["incapacitated"] ou [].
 */
export function conditionUseIssues({ statuses, cost, noReactions=false }) {
  if ( !["action", "bonus", "reaction"].includes(cost) ) return [];
  if ( INCAPACITATING.some(s => statuses.includes(s)) ) return ["incapacitated"];
  // §16.47 : « ne peut pas prendre de Réaction » (Tentacules de Hadar).
  return ((cost === "reaction") && noReactions) ? ["noReactions"] : [];
}

/**
 * Charmé (2024) : « vous ne pouvez pas attaquer celui qui vous a charmé ni le cibler avec une capacité infligeant des
 * dégâts ou un effet magique ».
 * @param {{attack: boolean, damage: boolean, magical: boolean}} use
 */
export function forbiddenAgainstCharmer({ attack, damage, magical }) {
  return !!(attack || damage || magical);
}

/**
 * « Une créature que vous pouvez voir » dans la description (anglais, ou français du PHB-fr : « une créature que vous
 * voyez », « parmi celles que vous voyez »). Un point ou un espace que l'on voit ne compte pas : seule la cible compte.
 */
const SIGHT_PATTERN = /\b(?:creatures?|targets?|one|ones)\b[^.<]{0,40}\b(?:that )?you can see\b|\b(?:cr[ée]atures?|cibles?|celles|ceux)\b[^.<]{0,40}\bque vous (?:voyez|pouvez voir)\b/i;
export function requiresSight(text) {
  return SIGHT_PATTERN.test(String(text ?? ""));
}

/**
 * Effrayé (2024) : « vous ne pouvez pas vous rapprocher volontairement de la source de votre peur ». Un point du chemin
 * plus proche de la source que le départ suffit.
 * @param {number} start      Distance à la source au départ.
 * @param {number[]} steps    Distance à la source à chaque point du chemin.
 */
export function movesCloser(start, steps) {
  return steps.some(d => d < start - 1e-6);
}

/* -------------------------------------------- */
/*  §16.47 : règles de sorts                    */
/* -------------------------------------------- */

/**
 * Ce qu'une utilisation fait cesser parmi les effets `breaksOn` de son auteur : un jet d'attaque (au jet), une utilisation
 * à dégâts, un sort. Une attaque ne compte qu'au jet (l'invisibilité profite au jet lui-même).
 * @param {{attack: boolean, damage: boolean, spell: boolean}} use
 * @returns {string[]}  Les moments atteints.
 */
export function breakMoments({ attack, damage, spell }) {
  const out = [];
  if ( attack ) out.push("attack");
  if ( damage ) out.push("damage");
  if ( spell ) out.push("spell");
  return out;
}

/** Les états de `cures` que la cible porte vraiment. */
export function curable(statuses, cures) {
  return (cures ?? []).filter(s => statuses.includes(s));
}

/** « Si vous ou vos alliés la combattez » : la cible est en combat, hostile au lanceur. */
export function fightingAdvantage({ targetInCombat, hostile }) {
  return !!(targetInCombat && hostile);
}
