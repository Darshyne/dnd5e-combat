/**
 * Sorts de châtiment du Paladin (SPEC §25).
 *
 *  - Sur le client de l'auteur, au jet de dégâts d'un coup au corps à corps (adapter/messages.mjs, `rollDamageForAttack`) : la
 *    question (un bouton par sort et niveau possibles), l'emplacement ou l'utilisation gratuite dépensés (adapter/smite.mjs) ; puis
 *    ici (`dnd5e.preRollDamageV2`), les dés du sort ajoutés au jet, de son type — le critique les double comme les autres. Le jet
 *    porte `flags["dnd5e-combat"].smite`.
 *  - Sur le MJ actif, une fois l'attaque résolue (`dnd5e-combat.resolution`) : l'action Bonus dépensée, et la sauvegarde du sort
 *    (Tonitruant, Courroucé, Aveuglant, Étourdissant, Bannisseur) jouée sur la cible encore debout (adapter/areas.mjs,
 *    `strikeAgainst`).
 *    §42.2 : l'effet du sort posé sans sauvegarde sur la cible touchée (`smite.effect` : brûlure du Châtiment de fournaise,
 *    aveuglement du Châtiment de cécité), dont le contenu déclare la suite (dégâts au début du tour, sauvegarde répétée).
 * Limite : la concentration des châtiments qui en demandent une et la lueur du Châtiment lumineux restent au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

function onPreRollDamage(config, dialog, message) {
  const smite = config[MODULE_ID]?.smite;
  const activity = config.subject;
  if ( !smite || !activity || !config.rolls?.length ) return true;
  const type = smite.type;
  if ( !smite.formula ) {   // §31 : une faveur sans dés (Renversement des coteaux) — seulement notée sur le jet
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
    return true;
  }
  config.rolls.push({ data: activity.getRollData(), parts: [smite.formula], options: { type, types: type ? [type] : [], properties: [] } });
  foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
  log(`${smite.name}${smite.level ? ` (niveau ${smite.level})` : ""} : +${smite.formula} ${type ?? ""}`);
  return true;
}

const seen = new Set();

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const damage = game.messages.get(resolution.damageRoll?.messageId ?? "");
  const smite = damage?.getFlag(MODULE_ID, "smite");
  if ( !smite ) return;
  seen.add(resolution.id);
  const item = fromUuidSync(smite.item, { strict: false });
  const actor = item?.actor;
  if ( !actor ) return;
  if ( smite.kind === "rider" ) return applyRider(smite, item, resolution);
  // « Action Bonus, que vous prenez immédiatement après avoir touché ».
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget ) await writeBudget(combatant, { ...budget, bonus: Math.max(0, (budget.bonus ?? 1) - 1) });
  if ( !smite.save && !smite.effect ) return;
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit ) return;
  if ( (target.actor.system.attributes?.hp?.value ?? 0) <= 0 ) return log(`${smite.name} : ${target.name} est à 0 PV, ni effet ni sauvegarde`);
  // §42.2 : l'effet que le sort pose en touchant, sans sauvegarde (« Seared », « Blinded »), au niveau lancé.
  if ( smite.effect ) await placeItemEffect(item, smite.effect, target.actor, { scaling: smite.scaling ?? 0 });
  if ( !smite.save ) return;
  const save = item.system.activities?.get(smite.save);
  if ( !save ) return;
  const source = actor.getActiveTokens(false, true)[0] ?? null;
  if ( !source ) return;
  log(`${smite.name} : ${target.name} fait sa sauvegarde`);
  await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte" });
}

/**
 * §31 : après le coup, ce que la faveur pose sur la cible encore debout : l'effet de l'item (Froid mordant : Vitesse −3 m jusqu'au
 * début du prochain tour du goliath — contenu `effectEnds`), ou un état (Renversement des coteaux : À terre).
 */
async function applyRider(smite, item, resolution) {
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit || ((target.actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  if ( smite.effect ) {
    const source = item.effects.get(smite.effect);
    if ( source ) {
      const data = foundry.utils.mergeObject(source.toObject(), { origin: item.uuid, transfer: false, disabled: false }, { inplace: false });
      delete data._id;
      await target.actor.createEmbeddedDocuments("ActiveEffect", [data]);
      log(`${smite.name} : « ${source.name} » posé sur ${target.name}`);
    }
  }
  if ( smite.status ) {
    await target.actor.toggleStatusEffect(smite.status, { active: true });
    log(`${smite.name} : ${target.name} reçoit « ${smite.status} »`);
  }
  // §78 : la sauvegarde de la faveur (Piqué : Force ou À terre), jouée sur la cible encore debout.
  const save = smite.save ? item.system.activities?.get(smite.save) : null;
  const source = save ? (item.actor?.getActiveTokens(false, true)[0] ?? null) : null;
  if ( save && source && ((target.actor.system.attributes?.hp?.value ?? 0) > 0) ) {
    log(`${smite.name} : ${target.name} fait sa sauvegarde`);
    await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte" });
  }
}

export function registerSmite() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "châtiment" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`smite:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "châtiment : sauvegarde non jouée" });
}
