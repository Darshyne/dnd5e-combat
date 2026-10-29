/**
 * §258 : fins génériques d'un sort ou d'un effet (`endsWhen`, audit CAT / CPR du 2026-10-28) — ce qui décide, sans Foundry :
 *  - `armor` : le porteur enfile une armure (« any » : Armure du mage) ou une armure lourde (« heavy » : Rage) ;
 *  - `apart` : le porteur et le lanceur sont séparés de plus de la distance (Lien de garde : 18 m ; Duel forcé : 9 m à la fin du tour
 *    du lanceur) ;
 *  - `zeroHp` : le porteur ou le lanceur tombe à 0 PV (Lien de garde) ;
 *  - `unaffected` : l'utilisation n'a affecté personne (toutes les sauvegardes réussies, aucun coup au but) — la concentration tombe,
 *    le sort n'a plus rien à tenir (Immobilisation de personne, Bannissement…). Confort de table, réglage de monde.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les poids d'armure de dnd5e (`system.type.value` d'un équipement), du plus léger au plus lourd. */
export const ARMOR_WEIGHTS = Object.freeze(["light", "medium", "heavy"]);

/** Une armure de ce poids, qu'on vient d'enfiler, met-elle fin à l'effet ? `rule` : "any" ou "heavy". */
export function armorEnds(rule, weight) {
  if ( !ARMOR_WEIGHTS.includes(weight) ) return false;
  if ( rule === "any" ) return true;
  return (rule === "heavy") && (weight === "heavy");
}

/** Deux créatures séparées de `distance` (dans l'unité de la limite) le sont-elles de plus que `limit` ? Inconnue : non. */
export function tooFarApart(distance, limit) {
  return Number.isFinite(distance) && Number.isFinite(limit) && (distance > limit + 1e-6);
}

/**
 * L'utilisation résolue n'a-t-elle affecté personne ? Les cibles que l'action ne pouvait pas affecter (`unaffected` : type, immunité)
 * ne comptent pas.
 *  - "failedSave" : aucune cible n'a raté sa sauvegarde (une sauvegarde ratée d'office compte comme ratée) ;
 *  - "noHits" : aucune attaque n'a touché ;
 *  - "noTargets" : aucune cible affectable.
 * Une résolution sans sauvegarde jugée (en attente) n'a rien décidé : non.
 * @param {{targets: object[], plan?: object}} resolution
 * @param {"failedSave"|"noHits"|"noTargets"} condition
 */
export function nobodyAffected(resolution, condition) {
  const targets = (resolution?.targets ?? []).filter(t => !t.unaffected);
  if ( condition === "noTargets" ) return !targets.length;
  if ( !targets.length ) return true;
  if ( condition === "noHits" ) return targets.every(t => t.hit === false);
  if ( condition === "failedSave" ) {
    if ( targets.some(t => !t.save) ) return false;
    return targets.every(t => t.save.success === true);
  }
  return false;
}

/**
 * §275 : seule l'utilisation d'origine dit si le sort a « affecté » quelqu'un. Une sauvegarde répétée (`resave` : Malédiction, début de
 * tour), le rejeu d'une zone (`areaTick`) ou une relance sous concentration (`recast`) n'en décide rien — sinon une sauvegarde réussie
 * au rejeu ferait tomber la concentration de tout le sort (Malédiction réussie : la malédiction disparaissait ; Immobilisation sur deux
 * cibles : la seconde libérée avec la première). `flags` : les drapeaux du moteur sur le message d'utilisation.
 */
export function isReplayUsage(flags) {
  return !!(flags?.resave || flags?.areaTick || flags?.recast);
}
