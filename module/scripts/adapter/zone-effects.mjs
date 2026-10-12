/**
 * §37.4 : effets portés tant qu'on est dans la zone d'un sort (clé de contenu `zoneEffects`, Silence : Assourdi, `silenced`, immunité
 * au tonnerre). Le cœur V14 le fait seul, une fois son comportement de région `applyActiveEffect` posé : copie des effets sur l'acteur
 * d'un token qui entre, retrait à sa sortie (client/data/region-behaviors/apply-active-effect.mjs, `origin` = uuid du comportement).
 * Vu en jeu le 2026-09-29 : les créatures déjà dans la zone à sa naissance « entrent » aussi, et la zone supprimée retire ses copies —
 * le moteur n'ajoute que le comportement. MJ actif.
 */

import { contentOf } from "./content.mjs";

/** L'activité qui a posé la région (`flags.dnd5e.activity`), ou null. */
const activityOf = region => {
  const uuid = region.getFlag?.("dnd5e", "activity");
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
};

/**
 * §69 : la zone d'un sort `difficultTerrain` vient de naître sans comportement de terrain difficile (les données du Manuel des
 * joueurs premium l'ont perdu ; celles du SRD de dnd5e l'ont : spells24/1st-level/entangle.yml, `behaviors`) — on le pose, magique
 * (c'est un sort), avec ses types (data/region-behavior/difficult-terrain.mjs : `magical`, `types`). Rien si la région en a un.
 * @returns {Promise<RegionBehavior|null>}
 */
export async function holdDifficultTerrain(region) {
  const activity = activityOf(region);
  const rule = contentOf(activity?.item).entry?.difficultTerrain;
  if ( !rule || region.behaviors.some(b => ["dnd5e.difficultTerrain", "modifyMovementCost"].includes(b.type)) ) return null;
  // §172 : un autre multiplicateur que ×2 (Mur d'épines : ×4) — le comportement « coût de déplacement » du cœur V14
  // (client/data/region-behaviors/increase-movement-cost.mjs, `difficulties`). Tous les modes : le schéma ne garde que les siens (il
  // est bâti avant que dnd5e retouche `CONFIG.Token.movement.actions` — filtrer comme lui n'en laissait aucun).
  if ( rule.cost ) {
    const difficulties = Object.fromEntries(Object.keys(CONFIG.Token.movement.actions).map(action => [action, rule.cost]));
    const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{ type: "modifyMovementCost", name: activity.item.name, system: { difficulties } }]);
    return behavior;
  }
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{
    type: "dnd5e.difficultTerrain", name: activity.item.name, system: { magical: true, types: rule.types ?? [] }
  }]);
  return behavior;
}

/**
 * La zone d'un sort `zoneEffects` vient de naître : le comportement du cœur, avec les effets de l'activité.
 * @returns {Promise<{behavior: RegionBehavior, effects: string[]}|null>}
 */
export async function holdZoneEffects(region) {
  const activity = activityOf(region);
  const item = activity?.item;
  if ( contentOf(item).entry?.zoneEffects !== true ) return null;
  if ( region.behaviors.some(b => b.type === "applyActiveEffect") ) return null;
  // §126 : `getEffect()` de dnd5e 6 (le getter `effect` est déprécié) ; asynchrone pour un profil qui porte un `uuid`.
  const effects = (await Promise.all((activity.effects ?? []).map(e => e.getEffect?.() ?? item.effects.get(e._id)))).filter(Boolean);
  if ( !effects.length ) return null;
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{
    type: "applyActiveEffect", name: item.name, system: { effects: effects.map(e => e.uuid) }
  }]);
  return { behavior, effects: effects.map(e => e.name) };
}
