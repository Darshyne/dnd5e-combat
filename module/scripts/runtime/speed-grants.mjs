/**
 * §195 : les vitesses qu'un item donne sans effet dans ses données (`grantsSpeeds`, content/ — Athlète : « une vitesse d'escalade égale à
 * votre Vitesse »). Le MJ actif tient sur l'acteur un effet par item (drapeau `flags.dnd5e-combat.speedGrant` = l'id de l'item, origine =
 * l'item), de la même forme que les capacités de dnd5e qui donnent une vitesse (`system.attributes.movement.<vitesse>`, `upgrade`,
 * phase `initial` : Ailes draconiques, adapter/altitude.mjs) : créé quand l'item arrive, réécrit quand la Vitesse de base change, retiré
 * avec l'item. Un équipement ne la donne que porté (et harmonisé s'il le demande : Pantoufles d'araignée, Cape d'arachnide). La vitesse
 * d'escalade devient ainsi une vraie vitesse pour dnd5e (coût ×1, `walkFallback`) et pour le moteur
 * (`climbingOf(token).native`). Rien n'est écrit sur l'item.
 * Limite : « égale à votre Vitesse » est lue sur la Vitesse de base (fiche, sinon espèce), pas sur la Vitesse du moment (Rapidité, Grande
 * foulée ne s'y reportent pas).
 */

import { MODULE_ID } from "../constants.mjs";
import { grantedSpeedChanges, sameSpeedChanges } from "../core/climb.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { loc, log } from "./shared.mjs";

export const SPEED_GRANT_FLAG = "speedGrant";

/** La Vitesse de base de l'acteur : celle de sa fiche, sinon celle de son espèce, sinon la Vitesse préparée. */
export function baseWalkOf(actor) {
  const movement = actor?.system?.attributes?.movement ?? {};
  const source = actor?._source?.system?.attributes?.movement ?? {};
  return Number(source.speeds?.walk ?? source.walk) || Number(movement.fromSpecies?.walk) || Number(movement.speeds?.walk ?? movement.walk) || 0;
}

/** Un équipement donne sa vitesse porté, et harmonisé s'il le demande ; un sort connu, jamais (son effet seul compte) ; une aptitude, toujours. */
function worn(item) {
  if ( item.type === "spell" ) return false;
  if ( !["equipment", "weapon"].includes(item.type) ) return true;
  return !!item.system?.equipped && ((item.system?.attunement !== "required") || !!item.system?.attuned);
}

/** Les items de l'acteur qui donnent une vitesse, avec les changements voulus. */
function wantedOf(actor) {
  const walk = baseWalkOf(actor);
  const out = new Map();
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.grantsSpeeds;
    if ( !rule || !worn(item) ) continue;
    const changes = grantedSpeedChanges(rule, walk);
    if ( changes.length ) out.set(item.id, { item, changes });
  }
  return out;
}

/** Les effets que le moteur a posés pour ces items. */
export const speedGrantEffects = actor => (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, SPEED_GRANT_FLAG));

async function sync(actor) {
  if ( !actor || (actor.system?.isCreature === false) ) return;
  const wanted = wantedOf(actor);
  const have = speedGrantEffects(actor);
  const remove = have.filter(e => !wanted.has(e.getFlag(MODULE_ID, SPEED_GRANT_FLAG))).map(e => e.id);
  if ( remove.length ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", remove, { [MODULE_ID]: { speedGrant: true } });
    log(`${actor.name}: ${remove.length} granted speed effect(s) removed`);
  }
  for ( const [itemId, { item, changes }] of wanted ) {
    const withPhase = changes.map(c => ({ ...c, phase: "initial" }));
    const effect = have.find(e => e.getFlag(MODULE_ID, SPEED_GRANT_FLAG) === itemId);
    if ( effect ) {
      if ( sameSpeedChanges(effect.system?.changes ?? effect.changes ?? [], changes) ) continue;
      await actor.updateEmbeddedDocuments("ActiveEffect", [{ _id: effect.id, "system.changes": withPhase }], { [MODULE_ID]: { speedGrant: true } });
      log(`${actor.name}: ${item.name} speed rewritten (${changes.map(c => `${c.key.split(".").at(-1)} ${c.value}`).join(", ")})`);
      continue;
    }
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      name: loc("Escalade.VitesseAccordee", { item: item.name }), img: item.img, origin: item.uuid, transfer: false, disabled: false,
      system: { changes: withPhase },
      flags: { [MODULE_ID]: { [SPEED_GRANT_FLAG]: itemId } }
    }], { [MODULE_ID]: { speedGrant: true } });
    log(`${actor.name}: ${item.name} grants ${changes.map(c => `${c.key.split(".").at(-1)} ${c.value}`).join(", ")}`);
  }
}

const later = actor => (actor ? enqueue(`speedGrant:${actor.uuid}`, () => sync(actor)).catch(err => console.error(`${MODULE_ID} | speed grant`, err)) : null);

export function registerSpeedGrants() {
  const opts = { executor: true, label: "granted speed not synced" };
  route("ready", () => Promise.all([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].map(later)), opts);
  route("canvasReady", () => Promise.all((canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => later(t.actor))), opts);
  for ( const hook of ["createItem", "deleteItem"] ) {
    route(hook, item => { if ( item.parent?.documentName === "Actor" ) return later(item.parent); }, opts);
  }
  route("updateItem", (item, changes) => {
    if ( (item.parent?.documentName === "Actor") && ["system.equipped", "system.attuned"].some(k => foundry.utils.hasProperty(changes, k)) ) return later(item.parent);
  }, opts);
  route("updateActor", (actor, changes) => {
    if ( foundry.utils.hasProperty(changes, "system.attributes.movement") ) return later(actor);
  }, opts);
}
