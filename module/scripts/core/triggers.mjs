/**
 * Le registre de déclencheurs (SPEC §13, S3) : UN mécanisme pour tout ce qui « s'accroche à un
 * moment » — réactions, zones qui durent, dégâts bonus, et demain les déclencheurs de tour.
 *
 * Une DÉCLARATION vient d'un item (contenu livré avec le module, ou flag de l'item) :
 *   { on: moment | moment[], if?: condition, do: étape[] }
 *
 * Un MOMENT est un nom (voir MOMENTS). Le runtime le publie en `Hooks.callAll("dnd5e-combat.<moment>")`
 * pour les consommateurs passifs, et demande au cœur quelles déclarations s'y accrochent.
 *
 * Une CONDITION est une structure, pas une expression : pas d'eval, rien à parser, et une
 * clé inconnue rend la condition fausse (jamais de silence heureux). Les FAITS sont fournis par
 * l'adaptateur : une valeur (comparée strictement) ou une fonction (appelée avec l'argument).
 *   { "activity.isAttack": true }                      fait = valeur
 *   { "target.hasEffectFrom": "hex" }                  fait = fonction, appelée avec "hex"
 *   { "target.hasStatus": ["prone", "restrained"] }    valeur dans une liste
 *   { all: [...] } · { any: [...] } · { not: ... }     combinaisons ; un objet à plusieurs clés = all
 *
 * Fonctions pures, aucune dépendance à Foundry.
 */

/** Les moments connus. Un moment de réaction ouvre une fenêtre ; les autres agissent d'eux-mêmes. */
export const MOMENTS = Object.freeze({
  isHit: "an attack just hit the creature (Shield: before damage; riposte, B9: on application)",
  isDamaged: "the creature just took damage (Hellish Rebuke; via an effect: Sleep ending, Dominate replaying its save)",
  leavesReach: "a hostile creature leaves reach (Opportunity Attack)",
  enter: "a creature enters the area, or the area moves onto it",
  turnStart: "the creature starts its turn in the area",
  turnEnd: "the creature ends its turn in the area",
  moves: "the creature moves within the area (per square traveled: Spike Growth; not on placement)",
  preDamageRoll: "the actor is about to roll an activity's damage (bonus damage: Hex)",
  // Issues d'une résolution (SPEC §16, brique « déplacement forcé », « état posé ») : à l'application,
  // sur chaque cible atteinte. `hit` : une attaque de l'item l'a touchée ; `failedSave` : elle a raté
  // la sauvegarde de l'item (ou celle qu'une attaque touchée impose).
  hit: "an attack from the item just hit the target (on application: push, condition)",
  failedSave: "the target just failed the item's saving throw (on application: push, condition)",
  // Le tour de la créature elle-même, où qu'elle soit (brique « sauvegarde répétée ») : une déclaration
  // `via: "effect"` s'y accroche pour toute créature portant un effet de l'item (Immobilisation de personne).
  startOfTurn: "the creature starts its turn (declaration carried by an effect)",
  endOfTurn: "the creature ends its turn (declaration carried by an effect)",
  // Brique « avantage conditionnel » (§16, B6) : sur le client de l'attaquant, avant le jet, pour chaque cible.
  // Consultées : les items de l'attaquant, et les effets portés par l'attaquant ET par la cible (`via: "effect"`).
  preAttackRoll: "the actor is about to make an attack roll against the target (advantage, disadvantage)",
  // Portes (§16, B5 bis) : une utilisation est suspendue avant d'avoir lieu.
  castsSpell: "a hostile creature casts a spell within range and in sight (Counterspell: reaction window)",
  // §19.6 : fenêtres sans attente, comme « blessé ».
  isMissed: "an attack just missed the creature (Riposte, Disarming Attack: reaction window)",
  enemyTurnEnd: "a hostile creature ends its turn (reaction window; it is the source)",
  isAttacked: "a creature is about to attack the bearer (Sanctuary: the attacker's saving throw, via an effect; §34: the target's reaction window, before the roll — Shadowy Dodge)",
  // §34 : une créature hostile au réacteur s'apprête à faire un jet d'attaque, contre lui ou un allié : fenêtre de réaction avant le
  // jet (Éclat protecteur). Les faits voient le réacteur en `self`, l'attaquant en `source`, la créature visée en `target`.
  enemyAttacks: "a hostile creature is about to make an attack roll (Warding Flare: reaction window, before the roll)",
  // Le pendant : une créature alliée du réacteur (autre que lui) s'apprête à attaquer une créature qui lui est hostile (Présage
  // cosmique, Fortune : un dé ajouté au jet). Mêmes faits : le réacteur en `self`, l'attaquant en `source`, la cible en `target`.
  allyAttacks: "an allied creature is about to make an attack roll against an enemy (Cosmic Omen, Weal: reaction window, before the roll)",
  // §19.8 : fenêtre sans attente, comme « blessé » ; le fait `condition.gained` dit quel état.
  gainsCondition: "the creature just gained a condition (reflexive shape-change: reaction window)",
  // Domaine de la Tombe : une AUTRE créature que celle qui réagit vient d'être touchée, avant les dégâts. Les faits voient
  // la réactrice en `self`, la créature touchée en `target`, l'attaquant en `source`.
  allyIsHit: "another creature was just hit (Sentinel at Death's Door: reaction window, before damage)",
  // §38 : une AUTRE créature que le réacteur va subir des dégâts, montant connu, avant leur application (Égide projetée : la réserve
  // du magicien les absorbe). Mêmes faits que `allyIsHit` : le réacteur en `self`, la créature en `target`, l'auteur en `source`.
  allyIsDamaged: "another creature is about to take damage (Projected Ward: reaction window, before application)"
});

/** Les moments dont les déclarations sont portées par les EFFETS de la créature concernée (`via: "effect"`). */
/** §34 : les fenêtres de réaction avant un jet d'attaque (Désavantage, dé retiré). */
export const PRE_ATTACK_WINDOWS = Object.freeze(["isAttacked", "enemyAttacks", "allyAttacks"]);

export const BEARER_MOMENTS = Object.freeze(["startOfTurn", "endOfTurn", "isAttacked", "isDamaged", "isHit"]);

/** Les moments qui ne se publient qu'à l'application d'une résolution, par cible atteinte. */
export const OUTCOME_MOMENTS = Object.freeze(["hit", "failedSave"]);

/** Les moments du tour de la créature elle-même, sans zone. */
export const TURN_MOMENTS = Object.freeze(["startOfTurn", "endOfTurn"]);

/** Les moments où une créature rejoue la sauvegarde d'un effet qu'elle porte (§16, B4) : son tour, ou des dégâts subis. */
export const RESAVE_MOMENTS = Object.freeze([...TURN_MOMENTS, "isDamaged"]);

/**
 * Une déclaration sous forme canonique : `on` toujours en liste, `if` et `do` toujours présents,
 * `via` : null (les items de l'acteur) ou "effect" (les effets que l'item a posés sur la créature).
 */
/** Les déclarations `via: "effect"` qu'on peut restreindre à l'auteur des dégâts (`by`, §65 : Suggestion). */
export const DAMAGED_BY = Object.freeze(["originSide"]);

/**
 * §65 : des dégâts viennent-ils du lanceur de l'effet ou d'un de ses alliés ? Même acteur, ou tokens de même disposition
 * (amicale ou hostile ; une créature neutre n'est l'alliée de personne). Auteur inconnu : non.
 * @param {{damager: string|null, origin: string|null, damagerDisposition?: number|null, originDisposition?: number|null}} who
 */
export function damagedByOriginSide({ damager, origin, damagerDisposition=null, originDisposition=null }) {
  if ( !damager || !origin ) return false;
  if ( damager === origin ) return true;
  return (damagerDisposition !== null) && (damagerDisposition === originDisposition) && [1, -1].includes(damagerDisposition);
}

export function normalize(declaration, extra={}) {
  const on = Array.isArray(declaration.on) ? declaration.on : [declaration.on];
  return { ...extra, ...declaration, on: on.filter(Boolean), if: declaration.if ?? null, do: declaration.do ?? [], via: declaration.via ?? null };
}

/** La condition tient-elle, au vu des faits ? */
export function holds(condition, facts={}) {
  if ( (condition === null) || (condition === undefined) || (condition === true) ) return true;
  if ( condition === false ) return false;
  if ( Array.isArray(condition) ) return condition.every(c => holds(c, facts));
  if ( typeof condition !== "object" ) return false;
  return Object.entries(condition).every(([key, arg]) => {
    if ( key === "all" ) return (arg ?? []).every(c => holds(c, facts));
    if ( key === "any" ) return (arg ?? []).some(c => holds(c, facts));
    if ( key === "not" ) return !holds(arg, facts);
    if ( !(key in facts) ) return false;
    const fact = facts[key];
    if ( typeof fact === "function" ) return fact(arg) === true;
    return Array.isArray(arg) ? arg.includes(fact) : fact === arg;
  });
}

/** Les clés de faits qu'une condition utilise et que les faits ne fournissent pas (pour valider du contenu). */
export function unknownFacts(condition, facts={}) {
  const out = new Set();
  const walk = c => {
    if ( !c || (typeof c !== "object") ) return;
    if ( Array.isArray(c) ) return c.forEach(walk);
    for ( const [key, arg] of Object.entries(c) ) {
      if ( ["all", "any"].includes(key) ) (arg ?? []).forEach(walk);
      else if ( key === "not" ) walk(arg);
      else if ( !(key in facts) ) out.add(key);
    }
  };
  walk(condition);
  return Array.from(out);
}

/** Les déclarations (canoniques) qui s'accrochent à ce moment et dont la condition tient. */
export function select(declarations, moment, facts={}) {
  return declarations.filter(d => d.on.includes(moment) && holds(d.if, facts));
}

/** Les étapes d'un type donné d'une déclaration. */
export function stepsOf(declaration, type) {
  return declaration.do.filter(s => s.type === type);
}
