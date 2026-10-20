/**
 * Bottes d'arme (Weapon Mastery, Manuel des joueurs 2024 ; SPEC §21). dnd5e 6 note la botte employée sur le message d'attaque
 * (`system.mastery`) sans rien en faire ; le moteur en tire les conséquences. Fonctions pures.
 *
 *  - Enchaînement (cleave) : après un coup au corps à corps, une seconde attaque au corps à corps avec la même arme, contre une
 *    autre créature à l'allonge et à 1,50 m de la première ; ses dégâts n'ajoutent le modificateur de caractéristique que s'il
 *    est négatif. Une fois par tour.
 *  - Écorchure (graze) : une attaque ratée inflige quand même, du type de l'arme, autant de dégâts que le modificateur de
 *    caractéristique de l'attaque.
 *  - Coup double (nick) : tenu par le budget du tour (core/turn.mjs).
 *  - Poussée (push) : sur un coup, une cible de taille G au plus peut être éloignée de 3 m au plus en ligne droite.
 *  - Sape (sap) : sur un coup, Désavantage à la prochaine attaque de la cible, jusqu'au début du tour suivant de l'attaquant.
 *  - Ralentissement (slow) : sur un coup qui blesse, -3 m de Vitesse jusqu'au début du tour suivant de l'attaquant, sans cumul
 *    au-delà de 3 m.
 *  - Renversement (topple) : sur un coup, sauvegarde de Constitution (DD 8 + modificateur de l'attaque + bonus de maîtrise) ;
 *    ratée, la cible tombe À terre.
 *  - Ouverture (vex) : sur un coup qui blesse, Avantage à la prochaine attaque contre cette cible, jusqu'à la fin du tour
 *    suivant de l'attaquant.
 */

export const MASTERIES = Object.freeze(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]);

/** Rangs de taille de dnd5e, pour « de taille G ou moins ». */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/**
 * Ce que la botte fait après cette attaque, pour une cible.
 * @param {string|null} mastery
 * @param {object} outcome
 * @param {boolean} outcome.hit          La cible a été touchée.
 * @param {boolean} outcome.damaged      Elle a perdu des PV (ou des PV temporaires).
 * @param {boolean} outcome.melee        Attaque au corps à corps (pas lancée).
 * @param {string|null} outcome.size     Sa taille (clé de dnd5e).
 * @param {boolean} outcome.down         Elle est à 0 PV.
 * @param {boolean} [outcome.cleaveSpent] Enchaînement déjà employé ce tour.
 * @returns {"cleave"|"graze"|"push"|"sap"|"slow"|"topple"|"vex"|null}
 */
export function masteryEffect(mastery, { hit, damaged, melee, size, down, cleaveSpent=false }) {
  if ( !MASTERIES.includes(mastery) || (mastery === "nick") ) return null;
  if ( mastery === "graze" ) return hit ? null : "graze";
  if ( !hit ) return null;
  if ( mastery === "cleave" ) return (melee && !cleaveSpent) ? "cleave" : null;
  if ( down ) return null;   // une créature à 0 PV : ni poussée, ni marque, ni sauvegarde
  if ( mastery === "push" ) return ((SIZE_RANK[size] ?? 2) <= SIZE_RANK.lg) ? "push" : null;
  if ( ["slow", "vex"].includes(mastery) ) return damaged ? mastery : null;
  return mastery;
}

/** Écorchure : les dégâts, égaux au modificateur (rien s'il est nul ou négatif). */
export const grazeDamage = mod => Math.max(0, Number(mod) || 0);

/** Renversement : le DD de la sauvegarde de Constitution. */
export const toppleDC = (mod, prof) => 8 + (Number(mod) || 0) + (Number(prof) || 0);

/**
 * Enchaînement : les dégâts de la seconde attaque se lancent sans le modificateur de caractéristique, « sauf s'il est négatif ».
 * @param {number} mod
 */
export const cleaveModifier = mod => Math.min(0, Number(mod) || 0);

/**
 * Quand une marque de botte tombe, au tour de celui qui l'a posée (`source`). Sape et Ralentissement : au début de son prochain
 * tour. Ouverture (et Attaques avisées du Guerrier, « studied ») : à la fin de son prochain tour — pas à la fin du tour même où
 * elle a été posée.
 * Témérité du Barbare (« reckless », §22) : au début de son prochain tour, comme la Sape.
 * @param {"sap"|"slow"|"vex"|"studied"|"reckless"} kind
 * @param {{moment: "turnStart"|"turnEnd", sourceTurn: boolean, turnKey: string|null, placedOn: string|null}} event
 */
export function markExpires(kind, { moment, sourceTurn, turnKey, placedOn }) {
  if ( !sourceTurn ) return false;
  if ( (kind === "vex") || (kind === "studied") ) return (moment === "turnEnd") && (turnKey !== placedOn);
  return moment === "turnStart";
}

/* -------------------------------------------- */
/*  Les bottes choisies (§222)                  */
/* -------------------------------------------- */

/**
 * Classes dont l'aptitude ne laisse changer qu'une botte après un Repos long (Guerrier : « change one of those weapon choices ») ;
 * les autres (Barbare, Paladin, Rôdeur, Roublard, don Maître d'armes) changent toutes les leurs.
 */
const ONE_CHANGE = Object.freeze(["fighter"]);
/** Classes dont les bottes vont aux seules armes de corps à corps (Barbare : « Simple or Martial Melee weapons »). */
const MELEE_ONLY = Object.freeze(["barbarian"]);

/**
 * Les sources de bottes d'un acteur, une par item : les avancements « Trait » en mode « mastery » de ses classes et sous-classes
 * (jusqu'à son niveau de classe) et de ses dons (toujours). Le nombre d'un avancement : ses choix et ses dons d'office.
 * @param {Array<{item: string, label: string, identifier: string, kind: string, classLevel: number|null,
 *   advancements: Array<{level: number, count: number}>}>} items
 * @returns {Array<{item: string, label: string, identifier: string, count: number, melee: boolean, changes: number}>}
 */
export function masterySources(items) {
  const out = [];
  for ( const it of items ?? [] ) {
    const counted = ["class", "subclass"].includes(it.kind) && Number.isFinite(it.classLevel);
    const count = (it.advancements ?? []).filter(a => !counted || ((Number(a.level) || 0) <= it.classLevel))
      .reduce((n, a) => n + Math.max(0, Number(a.count) || 0), 0);
    if ( count <= 0 ) continue;
    out.push({ item: it.item, label: it.label, identifier: it.identifier ?? "", count,
      melee: MELEE_ONLY.includes(it.identifier), changes: ONE_CHANGE.includes(it.identifier) ? 1 : count });
  }
  return out;
}

/** Le nombre de bottes que l'acteur peut choisir. */
export const masterySlots = sources => (sources ?? []).reduce((n, s) => n + s.count, 0);

/** Le nombre de bottes qu'un Repos long laisse changer. */
export const restChanges = sources => (sources ?? []).reduce((n, s) => n + s.changes, 0);

/** Combien de bottes d'avant ne sont plus choisies. */
export const removedCount = (before, after) => (before ?? []).filter(k => !(after ?? []).includes(k)).length;

/**
 * Le choix `after` respecte-t-il les règles ? Raisons, dans l'ordre :
 *  - `notProficient` : une arme que l'acteur ne maîtrise pas (« with which you have proficiency ») ;
 *  - `tooMany` : plus de bottes que ses sources n'en donnent ;
 *  - `melee` : trop d'armes à distance pour les places qui les acceptent (Barbare : corps à corps seulement) ;
 *  - `changes` : plus de bottes retirées que ce que le Repos long permet (`allowance` ; hors repos, 0).
 * Une botte déjà choisie n'est pas rejugée pour `notProficient` (maîtrise perdue depuis) ; une arme absente de `weapons` (index pas
 * encore lu, arme d'un autre module) n'est jugée que sur le nombre.
 * @param {{before: string[], after: string[], weapons: Record<string, {melee: boolean, proficient: boolean}>,
 *   sources: object[], allowance: number}} input
 * @returns {{ok: boolean, reason: string|null, slots: number, removed: number}}
 */
export function masteryVerdict({ before=[], after=[], weapons={}, sources=[], allowance=0 }) {
  const slots = masterySlots(sources);
  const removed = removedCount(before, after);
  const verdict = reason => ({ ok: !reason, reason, slots, removed });
  if ( after.some(k => !before.includes(k) && weapons[k] && !weapons[k].proficient) ) return verdict("notProficient");
  if ( after.length > slots ) return verdict("tooMany");
  const anywhere = sources.filter(s => !s.melee).reduce((n, s) => n + s.count, 0);
  if ( after.filter(k => weapons[k] && !weapons[k].melee).length > anywhere ) return verdict("melee");
  if ( removed > Math.max(0, Number(allowance) || 0) ) return verdict("changes");
  return verdict(null);
}
