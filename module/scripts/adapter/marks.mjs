/**
 * Marques locales au client qui joue une réaction (SPEC §19.6) : ce que la réaction choisie promet au jet qui la suit, le temps
 * de ce jet. Par exemple une riposte : une attaque contre cet ennemi, avec l'avantage. L'activité de la
 * réaction est utilisée juste après (adapter/reactions.mjs, `handleReactionQuery`) et son jet d'attaque s'enchaîne sur ce même
 * client ; l'avantage y est déclaré (adapter/triggers.mjs, `declaredAttackModifiers`). La marque tombe au jet, ou d'elle-même.
 */

/** Durée de vie d'une marque sans jet (réaction annulée, fenêtre fermée). */
const LIFETIME_MS = 30000;

const advantaged = new Map();

/** L'activité `uuid`, utilisée en réaction, attaque avec l'avantage (au nom de `name`). */
export function markReactionAdvantage(uuid, name) {
  advantaged.set(uuid, name);
  setTimeout(() => advantaged.delete(uuid), LIFETIME_MS);
}

/** Le nom de la réaction qui donne l'avantage à ce jet de l'activité `uuid`, ou null ; la marque est consommée. */
export function takeReactionAdvantage(uuid) {
  const name = advantaged.get(uuid) ?? null;
  advantaged.delete(uuid);
  return name;
}

/** Sans la consommer : l'activité a-t-elle une marque d'avantage ? */
export const hasReactionAdvantage = uuid => advantaged.has(uuid);
