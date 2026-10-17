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

/**
 * §191 : les effets portés par la zone, remis en accord avec la position du token. Le comportement du cœur ne les retire qu'à une
 * sortie qu'il voit : un token téléporté (`blink`, Pas brumeux) ou déplacé de force (`displace`) hors de la Tempête radieuse de
 * Jallarzi restait Aveuglé, et en y revenant en recevait une seconde copie (vu le 2026-10-18). Pour chaque zone `zoneEffects` du
 * moteur : hors de la zone, ses copies (origine = le comportement) partent ; dedans, il en faut une par effet — les doublons partent,
 * les manquantes sont recréées comme le cœur les crée (apply-active-effect.mjs, `#getEffectsToCreate`). MJ actif.
 * @param {TokenDocument} token
 * @returns {Promise<number>}  Le nombre de zones corrigées.
 */
export async function syncZoneEffects(token) {
  const actor = token?.actor;
  if ( !actor || !token.parent ) return 0;
  let fixed = 0;
  for ( const region of token.parent.regions ) {
    if ( contentOf(activityOf(region)?.item).entry?.zoneEffects !== true ) continue;
    for ( const behavior of region.behaviors ) {
      if ( (behavior.type !== "applyActiveEffect") || behavior.disabled ) continue;
      const mine = actor.effects.filter(e => e.origin === behavior.uuid);
      const inside = token.testInsideRegion(region, { x: token._source.x, y: token._source.y, elevation: token._source.elevation,
        width: token._source.width, height: token._source.height, shape: token._source.shape, level: token._source.level });
      const sources = (await Promise.all(Array.from(behavior.system.effects ?? []).map(uuid => fromUuid(uuid)))).filter(Boolean);
      if ( !inside ) {
        if ( !mine.length ) continue;
        await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map(e => e.id));
        fixed++;
        continue;
      }
      const extra = [];
      const missing = [];
      for ( const source of sources ) {
        const copies = mine.filter(e => (e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid) || (e.name === source.name));
        extra.push(...copies.slice(1).map(e => e.id));
        if ( !copies.length ) missing.push(source);
      }
      if ( extra.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", extra);
      if ( missing.length ) {
        await actor.createEmbeddedDocuments("ActiveEffect", missing.map(effect => {
          const data = effect.toObject();
          delete data._id;
          data._stats = { ...(data._stats ?? {}), duplicateSource: effect.compendium ? null : effect.uuid,
            compendiumSource: effect.compendium ? effect.uuid : null, exportSource: null };
          data.origin = behavior.uuid;
          return data;
        }));
      }
      if ( extra.length || missing.length ) fixed++;
    }
  }
  return fixed;
}
