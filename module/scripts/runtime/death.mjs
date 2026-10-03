/**
 * À 0 point de vie (SPEC §17) : dégâts à 0 PV, mort sur le coup, jet contre la mort au début du tour,
 * Stabilisé et Mort. La règle est dans core/death.mjs, la lecture et l'écriture dans adapter/death.mjs.
 */

import {
  DEATH_QUERY, handleDeathSaveQuery, planDamageAtZero, settleDamageAtZero, settleDeathSave, deathSaveDue,
  requestDeathSave, clearDeathMarks, ensureDowned
} from "../adapter/death.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { MODULE_ID } from "../constants.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Le tour d'une créature à 0 PV commence : elle lance son jet contre la mort. */
function onTurnChange(combat, prior, current) {
  const token = combat.combatants.get(current?.combatantId)?.token;
  const actor = token?.actor;
  if ( !actor ) return;
  // §17.1 : une créature restée à 0 PV sans son état (PV écrits avant le moteur, réglage du système) le reçoit.
  if ( (actor.system?.attributes?.hp?.value ?? 1) <= 0 ) ensureDowned(actor).catch(err => console.error(err));
  if ( !deathSaveDue(actor) ) return;
  // Même file que les déclencheurs du tour de cette créature (runtime/triggers.mjs).
  return enqueue(`turn:${token.uuid}`, async () => {
    if ( !deathSaveDue(actor) ) return;
    const who = await requestDeathSave(actor);
    log(`${actor.name} : jet de sauvegarde contre la mort (${who === "player" ? "le joueur" : "le moteur"})`);
  });
}

export function registerDeath() {
  CONFIG.queries[DEATH_QUERY] = handleDeathSaveQuery;
  // Sur le client qui applique les dégâts (il a le droit d'écrire l'acteur) : les échecs partent avec les dégâts.
  route("dnd5e.preApplyDamage", planDamageAtZero, { label: "0 PV : échecs non comptés" });
  route("dnd5e.applyDamage", async (actor, amount, options) => {
    // §31 : Acharnement — la créature reste à 1 PV (adapter/species.mjs, via planDamageAtZero).
    const endured = options?.[MODULE_ID]?.endured;
    if ( endured ) {
      log(`${actor.name} : ${endured}, reste à 1 PV`);
      const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
      if ( token ) notice(token, loc("Espece.Acharnement", { item: endured }), "gain");
    }
    const outcome = await settleDamageAtZero(actor, amount, options);
    if ( outcome ) log(`${actor.name} : dégâts à 0 PV → ${outcome.dead ? `mort (${outcome.reason})` : `${outcome.failures} échec(s)`}`);
  }, { label: "0 PV : mort ou échec non posé" });
  // Sur le client qui a lancé le jet (le joueur, ou le moteur).
  route("dnd5e.rollDeathSaveV2", (rolls, { outcome, subject }) => settleDeathSave(subject, outcome),
    { label: "jet contre la mort : Stabilisé ou Mort non posé" });
  route("combatTurnChange", onTurnChange, { executor: true, label: "jet contre la mort non demandé" });
  route("updateActor", async (actor, changed) => {
    const hp = foundry.utils.getProperty(changed, "system.attributes.hp.value");
    if ( hp > 0 ) return clearDeathMarks(actor);
    // §17.1 : à 0 PV, l'état est obligatoire (le système ne le pose qu'en combat, et selon un réglage).
    if ( (hp !== undefined) || (foundry.utils.getProperty(changed, "system.attributes.death.failure") !== undefined) ) {
      const status = await ensureDowned(actor, { afterUpdate: true });
      if ( status ) log(`${actor.name} : 0 PV → ${status === "dead" ? "Mort" : "Inconscient"}`);
    }
  }, { executor: true, label: "Mort / Inconscient / Stabilisé non posés ou non retirés" });
  // Un token non lié dont on écrit les PV dans le token lui-même (`delta.system…`) : le cœur ne publie pas
  // `updateActor` dans ce cas (client/documents/actor-delta.mjs:219 ne tourne que pour une mise à jour de l'ActorDelta).
  route("updateToken", async (token, changed) => {
    const hp = foundry.utils.getProperty(changed, "delta.system.attributes.hp.value");
    if ( (hp === undefined) || !token.actor ) return;
    if ( hp > 0 ) return clearDeathMarks(token.actor);
    const status = await ensureDowned(token.actor, { afterUpdate: true });
    if ( status ) log(`${token.actor.name} : 0 PV → ${status === "dead" ? "Mort" : "Inconscient"}`);
  }, { executor: true, label: "Mort / Inconscient non posés (token non lié)" });
}
