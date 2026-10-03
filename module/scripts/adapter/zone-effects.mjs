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
  if ( !rule || region.behaviors.some(b => b.type === "dnd5e.difficultTerrain") ) return null;
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
  const effects = (activity.effects ?? []).map(e => e.effect ?? item.effects.get(e._id)).filter(Boolean);
  if ( !effects.length ) return null;
  const [behavior] = await region.createEmbeddedDocuments("RegionBehavior", [{
    type: "applyActiveEffect", name: item.name, system: { effects: effects.map(e => e.uuid) }
  }]);
  return { behavior, effects: effects.map(e => e.name) };
}
