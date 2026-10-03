/**
 * Robustesse de la non-vie (Monster Manual 2024, §61) : Zombi, Zombi ogre, Zombi tyrannœil. Des dégâts qui font tomber la
 * créature à 0 PV — sauf radiants ou coup critique — lui font jeter une sauvegarde de Constitution de DD 5 + les dégâts subis ;
 * réussie, elle reste à 1 PV. La règle est dans core/fortitude.mjs ; la sauvegarde due est inscrite avec les PV
 * (adapter/death.mjs, `planDamageAtZero`), puis jouée ici par le MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { fortitudeOf, pendingFortitude, clearFortitude } from "../adapter/fortitude.mjs";
import { ensureDowned } from "../adapter/death.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Sur le client qui applique les dégâts : les types réellement subis, pour exclure les dégâts radiants. */
function onCalculateDamage(actor, damages, options) {
  if ( !fortitudeOf(actor) ) return;
  const types = damages.filter(d => (d.value > 0) && d.type).map(d => d.type);
  (options[MODULE_ID] ??= {}).takenTypes = types;
}

/** La créature est tombée à 0 PV avec une sauvegarde en attente : le MJ actif la joue. */
function onZero(actor) {
  if ( !actor || !pendingFortitude(actor) ) return;
  return enqueue(`fortitude:${actor.uuid}`, async () => {
    await new Promise(resolve => setTimeout(resolve, 400));   // dnd5e pose son état à 0 PV sur le client qui a écrit les PV
    const pending = pendingFortitude(actor);
    if ( !pending ) return;
    if ( (actor.system.attributes?.hp?.value ?? 1) > 0 ) return clearFortitude(actor);
    const { dc, item } = pending;
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc }, { configure: false },
      { data: { flavor: loc("Robustesse.Carte", { item, dc }), flags: { [MODULE_ID]: { fortitude: { actor: actor.uuid, dc } } } } });
    const total = rolls?.[0]?.total;
    await clearFortitude(actor);
    if ( Number.isFinite(total) && (total >= dc) ) {
      // PV > 0 : les états de 0 PV posés par dnd5e ou le moteur sont retirés (runtime/death.mjs, `clearDeathMarks`).
      await actor.update({ "system.attributes.hp.value": 1 });
      const downed = actor.effects.filter(e => e.getFlag("dnd5e", "autoDowned")).map(e => e.id);
      if ( downed.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", downed).catch(() => {});
      const token = tokenOf(actor);
      if ( token ) notice(token, loc("Robustesse.Reussite", { item }), "gain");
      log(`${item} : ${actor.name} réussit (${total} contre DD ${dc}) et reste à 1 PV`);
      return;
    }
    log(`${item} : ${actor.name} rate (${total} contre DD ${dc})`);
    await ensureDowned(actor);
  });
}

export function registerFortitude() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "Robustesse de la non-vie : types de dégâts non lus" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, `flags.${MODULE_ID}.fortitude`) ) return onZero(actor);
  }, { executor: true, label: "Robustesse de la non-vie : sauvegarde non jouée" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, `delta.flags.${MODULE_ID}.fortitude`) ) return onZero(token.actor);
  }, { executor: true, label: "Robustesse de la non-vie : sauvegarde non jouée (token non lié)" });
}
