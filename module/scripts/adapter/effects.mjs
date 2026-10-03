/**
 * Les effets qu'un item pose, complétés à leur création selon son contenu (SPEC §16.38). `effectsExpire` : l'effet prend fin
 * au repos du porteur — l'expiration native de dnd5e (`duration.expiry` = « longRest » / « shortRest », retirée au repos par
 * documents/actor/actor.mjs:2378-2395), que le PHB ne règle pas sur « Guéris par prière ».
 */

import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { englishDescription } from "./multiattack.mjs";
import { expiryFromText, namesStatus } from "../core/durations.mjs";

/** À la création d'un effet (`preCreateActiveEffect`, sur le client qui l'écrit). Rend l'expiration posée, ou null. */
export function setRestExpiry(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return null;
  const item = originItemOf(effect);
  const rest = item ? contentOf(item).entry?.effectsExpire : null;
  if ( !rest || effect.duration?.expiry ) return null;
  effect.updateSource({ "duration.expiry": rest });
  return rest;
}

/**
 * M4 (SPEC §18.7) : un effet posé sans durée prend celle que son texte écrit (« until the end of its next turn »), en
 * expiration native de dnd5e 6 (`targetEnd`…, core/durations.mjs). Lue dans la description de l'effet, sinon dans celle
 * de l'item d'origine (texte anglais d'origine sous Babele, sinon la description telle quelle). Rend l'expiration posée.
 */
export function setTextExpiry(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return null;
  // La source, pas `effect.duration` : préparée par le cœur V14, une durée vide y vaut `value: Infinity`
  // (client/documents/active-effect.mjs:292, `updateDuration`).
  const d = effect._source?.duration ?? {};
  if ( d.expiry || (Number.isFinite(d.value) && (d.value > 0)) ) return null;
  const item = originItemOf(effect);
  if ( !item || effect.transfer ) return null;   // un effet passif d'un item de l'acteur n'est pas « posé »
  const statuses = Array.from(effect.statuses ?? []);
  // La description de l'effet qui nomme son état fait foi, même sans durée ; sinon l'item.
  const expiry = namesStatus(effect.description, statuses)
    ? expiryFromText(effect.description, statuses, { alone: true })
    : (expiryFromText(effect.description, statuses, { alone: true })
      ?? expiryFromText(englishDescription(item), statuses)
      ?? expiryFromText(item.system?.description?.value, statuses));
  if ( !expiry ) return null;
  effect.updateSource({ "duration.expiry": expiry });
  return expiry;
}

/**
 * §42.2 : pose sur un acteur un effet d'un item, hors de la carte de dnd5e (effet qu'un châtiment pose en touchant, léthargie qui
 * suit la Hâte) — dans la forme que le plateau d'effets du système lui aurait donnée (applications/components/
 * effect-application.mjs:232-289) : origine, niveau de lancement, `_stats.duplicateSource` (ce que lit `comesFromItemEffect`).
 * Un effet déjà porté venant du même effet d'item est remplacé. MJ actif.
 * @returns {Promise<ActiveEffect|null>}
 */
export async function placeItemEffect(item, effectId, actor, { scaling=0 }={}) {
  const source = item?.effects?.get(effectId);
  if ( !source || !actor ) return null;
  const old = actor.effects.filter(e => (e._stats?.duplicateSource === source.uuid) || (e._stats?.compendiumSource === source.uuid)).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const sourceKey = source.inCompendium ? "compendiumSource" : "duplicateSource";
  const data = foundry.utils.mergeObject(source.toObject(), {
    disabled: false,
    transfer: false,
    origin: item.uuid,
    flags: { dnd5e: { scaling, spellLevel: (Number(item.system?.level) || 0) + scaling } },
    system: { origin: { item: item.uuid } },
    _stats: { [sourceKey]: source.uuid }
  }, { inplace: false });
  delete data._id;
  const forApplication = ActiveEffect.implementation.forApplication;
  if ( forApplication && data.system?.changes ) data.system.changes = await forApplication.call(ActiveEffect.implementation, data.system.changes, item, actor);
  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [data]);
  return created ?? null;
}
