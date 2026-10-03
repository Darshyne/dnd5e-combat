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
  isHit: "une attaque vient de toucher la créature (Bouclier : avant les dégâts ; riposte, B9 : à l'application)",
  isDamaged: "la créature vient de subir des dégâts (Représailles infernales ; via un effet : Sommeil qui cesse, Domination qui se rejoue)",
  leavesReach: "une créature hostile quitte l'allonge (attaque d'opportunité)",
  enter: "une créature entre dans la zone, ou la zone vient sur elle",
  turnStart: "la créature commence son tour dans la zone",
  turnEnd: "la créature termine son tour dans la zone",
  moves: "la créature se déplace dans la zone (par tranche de case parcourue : Croissance d'épines ; pas à la pose)",
  preDamageRoll: "l'auteur s'apprête à lancer les dégâts d'une activité (dégâts bonus : Maléfice)",
  // Issues d'une résolution (SPEC §16, brique « déplacement forcé », « état posé ») : à l'application,
  // sur chaque cible atteinte. `hit` : une attaque de l'item l'a touchée ; `failedSave` : elle a raté
  // la sauvegarde de l'item (ou celle qu'une attaque touchée impose).
  hit: "une attaque de l'item vient de toucher la cible (à l'application : poussée, état)",
  failedSave: "la cible vient de rater la sauvegarde de l'item (à l'application : poussée, état)",
  // Le tour de la créature elle-même, où qu'elle soit (brique « sauvegarde répétée ») : une déclaration
  // `via: "effect"` s'y accroche pour toute créature portant un effet de l'item (Immobilisation de personne).
  startOfTurn: "la créature commence son tour (déclaration portée par un effet)",
  endOfTurn: "la créature termine son tour (déclaration portée par un effet)",
  // Brique « avantage conditionnel » (§16, B6) : sur le client de l'attaquant, avant le jet, pour chaque cible.
  // Consultées : les items de l'attaquant, et les effets portés par l'attaquant ET par la cible (`via: "effect"`).
  preAttackRoll: "l'auteur s'apprête à lancer une attaque contre la cible (avantage, désavantage)",
  // Portes (§16, B5 bis) : une utilisation est suspendue avant d'avoir lieu.
  castsSpell: "une créature hostile lance un sort à portée et en vue (Contresort : fenêtre de réaction)",
  // §19.6 : fenêtres sans attente, comme « blessé ».
  isMissed: "une attaque vient de rater la créature (Riposte, Désarmement : fenêtre de réaction)",
  enemyTurnEnd: "une créature hostile termine son tour (fenêtre de réaction ; la source est elle)",
  isAttacked: "une créature s'apprête à attaquer le porteur (Sanctuaire : sauvegarde de l'attaquant, via un effet ; §34 : fenêtre de réaction de la cible, avant le jet — Esquive des ombres)",
  // §34 : une créature hostile au réacteur s'apprête à faire un jet d'attaque, contre lui ou un allié : fenêtre de réaction avant le
  // jet (Éclat protecteur). Les faits voient le réacteur en `self`, l'attaquant en `source`, la créature visée en `target`.
  enemyAttacks: "une créature hostile s'apprête à faire un jet d'attaque (Éclat protecteur : fenêtre de réaction, avant le jet)",
  // Le pendant : une créature alliée du réacteur (autre que lui) s'apprête à attaquer une créature qui lui est hostile (Présage
  // cosmique, Fortune : un dé ajouté au jet). Mêmes faits : le réacteur en `self`, l'attaquant en `source`, la cible en `target`.
  allyAttacks: "une créature alliée s'apprête à faire un jet d'attaque contre un ennemi (Présage cosmique, Fortune : fenêtre de réaction, avant le jet)",
  // §19.8 : fenêtre sans attente, comme « blessé » ; le fait `condition.gained` dit quel état.
  gainsCondition: "la créature vient de subir un état (Métamorphose réflexe : fenêtre de réaction)",
  // Domaine de la Tombe : une AUTRE créature que celle qui réagit vient d'être touchée, avant les dégâts. Les faits voient
  // la réactrice en `self`, la créature touchée en `target`, l'attaquant en `source`.
  allyIsHit: "une autre créature vient d'être touchée (Sentinelle au seuil de la mort : fenêtre de réaction, avant les dégâts)",
  // §38 : une AUTRE créature que le réacteur va subir des dégâts, montant connu, avant leur application (Égide projetée : la réserve
  // du magicien les absorbe). Mêmes faits que `allyIsHit` : le réacteur en `self`, la créature en `target`, l'auteur en `source`.
  allyIsDamaged: "une autre créature va subir des dégâts (Égide projetée : fenêtre de réaction, avant l'application)"
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
