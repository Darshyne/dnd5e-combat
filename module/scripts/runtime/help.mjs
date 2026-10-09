/**
 * Soutien (Help, SPEC §15.2, règles 2024), partie attaque, sur le MJ actif :
 *  - l'item Soutien utilisé sur un ennemi : une marque est posée sur lui ;
 *  - une attaque d'un allié de l'aidant contre lui : l'avantage est donné au jet (adapter/conditions.mjs),
 *    puis la marque est consommée ;
 *  - au début du prochain tour de l'aidant, ou à la fin du combat, les marques restantes tombent.
 * La partie « test de caractéristique » du Soutien : runtime/skill-aid.mjs (§113, hors combat).
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOfActivity } from "../adapter/basics.mjs";
import { helpMarksOn, helpMarksUsedBy, markHelped } from "../adapter/help.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const speakerTokenOf = message => {
  const { scene, token } = message.speaker ?? {};
  return (scene && token) ? game.scenes.get(scene)?.tokens.get(token) ?? null : null;
};

async function onUsage(message) {
  const activity = message.getAssociatedActivity?.();
  // §72 : l'item Soutien, ou une activité qui le déclare (`basicActions` : Maître des tactiques, à 9 m).
  if ( basicActionOfActivity(activity) !== "help" ) return;
  const helper = speakerTokenOf(message);
  if ( !helper ) return;
  const targets = (message.system?.targets ?? []).map(t => fromUuidSync(t.token)).filter(t => t && (t !== helper));
  const target = targets[0];
  if ( !target ) return ui.notifications.info(loc("Soutien.SansCible", { name: helper.name }));
  await markHelped(target, helper, { name: loc("Soutien.Marque", { name: helper.name }), img: "icons/svg/aura.svg" });
  log(`help: ${helper.name} distracts ${target.name}`);
}

async function onAttack(message) {
  const attacker = speakerTokenOf(message);
  if ( !attacker ) return;
  for ( const t of message.system?.targets ?? [] ) {
    const target = fromUuidSync(t.token);
    const used = helpMarksUsedBy(attacker, target);
    if ( !used.length ) continue;
    await target.actor.deleteEmbeddedDocuments("ActiveEffect", used.map(e => e.id));
    log(`help used: ${attacker.name} against ${target.name}`);
  }
}

/** Retire les marques posées par cet aidant (tous les tokens du combat), ou toutes si `helper` est null. */
async function dropMarks(combat, helper=null) {
  for ( const combatant of combat.combatants ) {
    const actor = combatant.token?.actor;
    const marks = helpMarksOn(actor).filter(e => !helper || (e.getFlag(MODULE_ID, "help").helper === helper.uuid));
    if ( marks.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(e => e.id));
  }
}

export function registerHelp() {
  const executor = { executor: true, label: "help" };
  route("createChatMessage", message => (message.type === "usage") ? onUsage(message)
    : (message.type === "attack") ? onAttack(message) : null, executor);
  // « Avant le début de votre prochain tour » : au tour de l'aidant, ses marques tombent.
  route("combatTurnChange", (combat, prior, current) => dropMarks(combat, combat.combatants.get(current.combatantId)?.token ?? null),
    { executor: true, label: "help: ends on the helper's turn" });
  route("deleteCombat", combat => dropMarks(combat), { executor: true, label: "help: end of combat" });
}
