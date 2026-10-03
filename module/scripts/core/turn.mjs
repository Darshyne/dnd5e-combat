/**
 * Économie d'actions d'un combattant (SPEC §6) : ce qu'il lui reste à dépenser ce tour-ci, ce
 * qu'une activité coûte, et ce qui cloche s'il la tente quand même. Le mode est souple : le
 * moteur signale, le joueur confirme, rien n'est jamais bloqué. Fonctions pures.
 */

import { fitMultiattack, attackCount } from "./multiattack.mjs";

/** Budget remis au début du tour du combattant (la réaction se récupère à ce moment-là). */
/**
 * Initiative d'une créature invoquée qui « partage votre initiative et joue juste après vous » (§16.13) : juste sous celle
 * de l'invocateur, et au-dessus de quiconque joue après lui — la moitié de l'écart avec le suivant, 0,01 au plus.
 * @param {number} summoner      Initiative de l'invocateur.
 * @param {number[]} others      Initiatives des autres combattants.
 * @returns {number}
 */
export function initiativeAfter(summoner, others) {
  const below = (others ?? []).filter(n => Number.isFinite(n) && (n < summoner));
  const next = below.length ? Math.max(...below) : -Infinity;
  const gap = Number.isFinite(next) ? (summoner - next) / 2 : 0.01;
  return Math.round((summoner - Math.min(0.01, gap)) * 10000) / 10000;
}

/**
 * @param {{reactions?: number}} [options]  §19.6 : réactions par round (« jusqu'à trois réactions par round, mais pas plus d'une
 *                                          par tour ») ; au-delà d'une, une seule par tour de jeu (`reactedAt`).
 */
export function freshBudget({ reactions=1 }={}) {
  return {
    action: 1, bonus: 1, reaction: reactions, attacks: { granted: 0, used: 0 },
    perTurnReaction: reactions > 1,   // plusieurs réactions par round : pas deux dans le même tour de jeu
    reactedAt: null,                  // le tour de jeu (combat.round.turn) de la dernière réaction
    dashed: false, disengaged: false, dodging: false, slotCast: false,
    lightAttack: false,   // §15.2 : une attaque d'arme Légère faite dans l'action Attaquer ouvre l'attaque de la main secondaire
    nickUsed: false,      // Coup double : l'attaque de la main secondaire, sans action Bonus, une fois par tour
    readied: false,       // Intention (Ready) : une action préparée, jouée plus tard par la réaction
    multi: null,  // M1 (§18.6) : Attaques multiples ouvertes ce tour — { plan, used: [clés de chaque utilisation] }
    climbed: 0,  // P2 : hauteur franchie par un escalier ou une échelle, en unités de la grille (le cœur ne la retient pas : « displace »)
    stood: 0,    // §17.2 : déplacement dépensé pour se relever (la moitié de la vitesse), en unités de la grille
    flurry: 0,      // §24 : frappes à mains nues gratuites ouvertes par le Déluge de coups
    flurryAny: false,   // §27 : … attaques d'arme comprises (Prêtre de guerre)
    bonusMove: 0,   // §20 : déplacement ouvert en plus ce tour (Repli du Roublard : la moitié de la Vitesse), unités de la grille
    stopped: false   // §16.59 : tour achevé par un ordre (Injonction) — plus de déplacement
  };
}

/** Une réaction est-elle disponible dans ce tour de jeu ? (Plusieurs par round : pas deux dans le même tour.) */
export function reactionAvailable(budget, turnKey=null) {
  if ( !budget ) return true;
  if ( budget.reaction < 1 ) return false;
  return !(budget.perTurnReaction && turnKey && (budget.reactedAt === turnKey));
}

/** Ce que coûte un type d'activation dnd5e. Tout le reste (minute, légendaire, spécial…) est hors budget. */
export function costOf(activationType) {
  return ["action", "bonus", "reaction"].includes(activationType) ? activationType : null;
}

/**
 * @typedef {object} UseRequest
 * @property {"action"|"bonus"|"reaction"|null} cost
 * @property {boolean} weaponAttack   Attaque d'arme ou à mains nues : relève de l'action Attaquer (attaques multiples).
 * @property {boolean} usesSpellSlot  Dépense un emplacement de sort (règle 2024 : un seul par tour).
 * @property {boolean} [lightWeapon]  Arme à la propriété Légère.
 * @property {boolean} [offhand]      Attaque de la main secondaire (mode `offhand` de dnd5e) : coûte l'action Bonus.
 * @property {boolean} [nick]         Le combattant maîtrise la botte Coup double de cette arme.
 * @property {object} [multiattack]    M1 : plan d'Attaques multiples du monstre (core/multiattack.mjs), s'il se lit.
 * @property {string[]} [keys]         M1 : clés de cette utilisation (id, nom anglais, activité, sort d'origine).
 * @property {boolean} [opensMultiattack]  M1 : c'est l'item Attaques multiples lui-même.
 */

/**
 * Ce que coûte vraiment cette utilisation, compte tenu du tour : l'attaque de la main secondaire
 * avec Coup double se fait dans l'action Attaquer (gratuite), une fois par tour ; sinon l'action Bonus.
 */
export function effectiveCost(budget, request) {
  if ( request.offhand ) return (request.nick && !budget.nickUsed) ? null : "bonus";
  return request.cost;
}

/** Cette attaque d'arme est-elle couverte par une action Attaquer déjà payée ? */
function coveredByAttackAction(budget, request) {
  return request.weaponAttack && (request.cost === "action") && (budget.attacks.used < budget.attacks.granted);
}

/**
 * M1 : cette utilisation tient-elle dans des Attaques multiples déjà ouvertes ? Rend le nombre d'attaques comptées.
 * @returns {{attacks: number}|null}
 */
function coveredByMultiattack(budget, request) {
  if ( !budget.multi || !request.keys || (request.cost !== "action") ) return null;
  return fitMultiattack(budget.multi.plan, [...budget.multi.used, request.keys]);
}

/**
 * Ce qui cloche si le combattant tente cette utilisation. Liste vide = tout va bien.
 * @param {object} budget
 * @param {UseRequest} request
 * @param {{isOwnTurn: boolean}} context
 * @returns {Array<"notYourTurn"|"noAction"|"noBonus"|"noReaction"|"slotAlreadyCast">}
 */
export function checkUse(budget, request, { isOwnTurn, turnKey=null }) {
  const issues = [];
  // Règle 2024 (propriété Légère) : il faut avoir attaqué avec une arme Légère dans l'action Attaquer ce tour-ci.
  if ( request.offhand && !budget.lightAttack ) issues.push("noLightAttack");
  // Un geste que l'intention déclare gratuit (§16.27 : un rayon enchaîné, un rebond) ne demande rien — ni action, ni tour, ni emplacement.
  if ( request.cost === "free" ) return issues;
  const cost = effectiveCost(budget, request);
  if ( !cost ) return (request.offhand && !isOwnTurn) ? ["notYourTurn", ...issues] : issues;
  if ( (cost !== "reaction") && !isOwnTurn ) issues.push("notYourTurn");
  if ( (cost === "action") && (budget.action < 1) && !coveredByAttackAction(budget, request) && !coveredByMultiattack(budget, request) ) issues.push("noAction");
  if ( (cost === "bonus") && (budget.bonus < 1) ) issues.push("noBonus");
  if ( (cost === "reaction") && !reactionAvailable(budget, turnKey) ) issues.push("noReaction");
  if ( request.usesSpellSlot && isOwnTurn && budget.slotCast ) issues.push("slotAlreadyCast");
  return issues;
}

/**
 * Débite une utilisation. Une dépense au-delà du budget (confirmée par le joueur) ne descend pas
 * sous zéro : le budget dit ce qui reste, pas ce qui a été dû.
 * @param {object} budget
 * @param {UseRequest} request
 * @param {{isOwnTurn: boolean, attacksPerAction: number}} context
 */
export function spendUse(budget, request, { isOwnTurn, attacksPerAction, turnKey=null }) {
  if ( request.offhand ) {
    const cost = effectiveCost(budget, request);
    return cost ? { ...budget, bonus: Math.max(0, budget.bonus - 1) } : { ...budget, nickUsed: true };
  }
  if ( !request.cost ) return budget;
  const next = { ...budget, attacks: { ...budget.attacks } };
  if ( request.lightWeapon && request.weaponAttack && (request.cost === "action") ) next.lightAttack = true;
  // M1 : Attaques multiples. Ouvertes par leur item (l'action payée, rien d'utilisé) ou par la première utilisation qui
  // tient dans le plan ; les suivantes passent sans action tant qu'elles y tiennent.
  const plan = request.multiattack ?? null;
  const covered = coveredByMultiattack(budget, request);
  const opening = !covered && plan && (request.cost === "action") && (budget.action >= 1)
    && (request.opensMultiattack ? { attacks: 0 } : (request.keys ? fitMultiattack(plan, [request.keys]) : null));
  if ( covered ) {
    next.multi = { ...budget.multi, used: [...budget.multi.used, request.keys] };
    next.attacks = { granted: budget.attacks.granted, used: covered.attacks };
  }
  else if ( opening ) {
    next.action = budget.action - 1;
    next.multi = { plan, used: request.opensMultiattack ? [] : [request.keys] };
    next.attacks = { granted: attackCount(plan), used: opening.attacks };
  }
  else if ( coveredByAttackAction(budget, request) ) next.attacks.used += 1;
  else {
    next[request.cost] = Math.max(0, budget[request.cost] - 1);
    if ( request.cost === "reaction" ) next.reactedAt = turnKey;
    // Au-delà d'Attaques multiples ouvertes (confirmé malgré tout), leur compteur reste celui du plan.
    if ( request.weaponAttack && (request.cost === "action") && !budget.multi ) next.attacks = { granted: Math.max(1, attacksPerAction), used: 1 };
  }
  if ( request.usesSpellSlot && isOwnTurn ) next.slotCast = true;
  return next;
}

/**
 * Rend une utilisation annulée avant tout jet (§15.1) : on rend l'ÉCART entre le budget d'avant et
 * celui d'après la dépense, appliqué au budget courant — ce qui a été dépensé depuis reste dépensé.
 * @param {object} current  Budget du moment.
 * @param {object} before   Budget juste avant la dépense.
 * @param {object} after    Budget juste après.
 */
export function refundUse(current, before, after) {
  const next = { ...current, attacks: { ...current.attacks } };
  for ( const key of ["action", "bonus", "reaction"] ) {
    next[key] = Math.max(0, (current[key] ?? 0) + ((before[key] ?? 0) - (after[key] ?? 0)));
  }
  const usedDelta = (after.attacks?.used ?? 0) - (before.attacks?.used ?? 0);
  next.attacks.used = Math.max(0, next.attacks.used - usedDelta);
  // La première attaque avait ouvert l'action Attaquer : si plus rien n'en est utilisé, on la referme.
  if ( (after.attacks?.granted !== before.attacks?.granted) && (next.attacks.used === 0) ) next.attacks.granted = before.attacks?.granted ?? 0;
  for ( const flag of ["slotCast", "nickUsed", "lightAttack"] ) if ( !before[flag] && after[flag] ) next[flag] = false;
  // M1 : l'utilisation rendue sort des Attaques multiples ; si c'est elle qui les avait ouvertes et qu'il n'en reste rien, on les referme.
  if ( after.multi && (JSON.stringify(after.multi) !== JSON.stringify(before.multi)) && current.multi ) {
    const added = after.multi.used.at(-1);
    const used = [...current.multi.used];
    const at = (after.multi.used.length > (before.multi?.used.length ?? 0)) ? used.findIndex(u => JSON.stringify(u) === JSON.stringify(added)) : -1;
    if ( at >= 0 ) used.splice(at, 1);
    next.multi = (!before.multi && !used.length) ? null : { ...current.multi, used };
    if ( !next.multi ) next.attacks = { ...(before.attacks ?? { granted: 0, used: 0 }) };
    else next.attacks.used = fitMultiattack(next.multi.plan, used)?.attacks ?? used.length;
  }
  return next;
}

/** L'état du tour que pose chaque action de base qui en pose un. */
export const BASIC_ACTION_FLAGS = Object.freeze({ dash: "dashed", disengage: "disengaged", dodge: "dodging", ready: "readied" });

/**
 * Une action de base prise par son item (§15.2 : Pointe, Désengagement, Esquive) : l'action est
 * dépensée et l'état du tour posé. Contrairement aux boutons du tracker, une utilisation confirmée
 * malgré un budget épuisé (mode souple) pose l'état quand même : le joueur a choisi.
 * @param {"dash"|"disengage"|"dodge"} kind
 */
export function basicAction(budget, kind) {
  const flag = BASIC_ACTION_FLAGS[kind];
  if ( !flag ) return budget;
  return { ...budget, action: Math.max(0, budget.action - 1), [flag]: true };
}

/** Foncer : une action contre un déplacement doublé. Sans action disponible, rien ne change. */
export function dash(budget) {
  if ( budget.dashed || (budget.action < 1) ) return budget;
  return { ...budget, action: budget.action - 1, dashed: true };
}

/** Se désengager : une action, et le déplacement du tour ne provoque plus d'attaque d'opportunité. */
export function disengage(budget) {
  if ( budget.disengaged || (budget.action < 1) ) return budget;
  return { ...budget, action: budget.action - 1, disengaged: true };
}

/** Esquiver : une action ; l'état natif « Esquive » du système tient jusqu'au début du prochain tour. */
export function dodge(budget) {
  if ( budget.dodging || (budget.action < 1) ) return budget;
  return { ...budget, action: budget.action - 1, dodging: true };
}

/** Correction manuelle (clic sur une pastille) : dépensé ↔ disponible. */
export function toggleResource(budget, key) {
  if ( !["action", "bonus", "reaction"].includes(key) ) return budget;
  return { ...budget, [key]: budget[key] > 0 ? 0 : 1 };
}

/**
 * Se relever (PHB 2024, À terre : « dépenser un déplacement égal à la moitié de votre Vitesse pour vous relever »).
 * @param {{speed: number, remaining: number}} state  Vitesse et déplacement restant ce tour (Infinity hors combat).
 * @returns {{cost: number, issue: "noSpeed"|"noMovement"|null}}
 */
export function standUpCost({ speed, remaining }) {
  if ( !(speed > 0) ) return { cost: 0, issue: "noSpeed" };
  const cost = speed / 2;
  return { cost, issue: remaining + 1e-6 < cost ? "noMovement" : null };
}

/** Déplacement autorisé ce tour, dans l'unité de la vitesse : doublé par Foncer, plus ce qu'un effet ouvre (Repli, §20). */
export function movementAllowance(budget, speed) {
  return speed * (budget.dashed ? 2 : 1) + (Number(budget.bonusMove) || 0);
}
