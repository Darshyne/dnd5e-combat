/**
 * §90 : un dé que la créature ajoute à un test qu'elle vient de lancer, ou à son initiative (clé `rollBonus`, `on: ["check"]` /
 * `["initiative"]`) — Embuscade (Discrétion, initiative), Autorité naturelle (Intimidation, Représentation, Persuasion), Évaluation
 * tactique (Histoire, Investigation, Perspicacité) du Maître de guerre ; la Chance du ténébreux sur un test.
 *
 * Le moteur ne connaît pas le DD d'un test libre : la question est posée sitôt le jet lancé (« après l'avoir vu »), sur le client qui
 * l'a lancé, au joueur de la créature (adapter/inspiration.mjs, `offerRollBonus`) ; le dé part en clair, avec le nouveau total sur sa
 * carte — le jet d'origine n'est pas réécrit. L'initiative, elle, est corrigée : la première valeur que reçoit un combattant (sur le
 * MJ actif) ouvre la question, et le dé s'ajoute à sa valeur.
 */

import { MODULE_ID } from "../constants.mjs";
import { offerRollBonus } from "../adapter/inspiration.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Le nom du test : la compétence, l'outil ou la caractéristique. */
function checkName({ skill, tool, ability }) {
  if ( skill ) return CONFIG.DND5E.skills?.[skill]?.label ?? skill;
  if ( tool ) return CONFIG.DND5E.tools?.[tool]?.label ?? game.i18n.localize("DND5E.ToolCheck");
  return CONFIG.DND5E.abilities?.[ability]?.label ?? ability ?? "";
}

async function onCheckRolled(rolls, { skill=null, tool=null, ability=null, subject }={}) {
  const actor = subject;
  const total = rolls?.[0]?.total;
  if ( !actor?.isOwner || !Number.isFinite(total) ) return;
  const added = await offerRollBonus(actor, { kind: "check", what: checkName({ skill, tool, ability }), total, skill });
  if ( added ) log(`${actor.name} : dé ajouté à son test, ${total} + ${added} = ${total + added}`);
}

/** Sur le client qui écrit l'initiative : est-ce la première que reçoit ce combattant ? (lu au `updateCombatant`, partout) */
function onPreUpdateCombatant(combatant, changes, options) {
  if ( (combatant.initiative === null) && Number.isFinite(changes?.initiative) ) options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), firstInitiative: true };
}

async function onUpdateCombatant(combatant, changes, options) {
  if ( !options?.[MODULE_ID]?.firstInitiative || !Number.isFinite(combatant.initiative) || !combatant.actor ) return;
  const total = combatant.initiative;
  const added = await offerRollBonus(combatant.actor, { kind: "initiative", what: game.i18n.localize("DND5E.Initiative"), total });
  if ( !added ) return;
  await combatant.update({ initiative: total + added });
  log(`${combatant.name} : dé ajouté à son initiative, ${total} + ${added} = ${total + added}`);
}

export function registerRollBonus() {
  // dnd5e 6.0 : documents/actor/actor.mjs — `dnd5e.roll${name}` après un test de compétence, d'outil ou de caractéristique, sur le
  // client qui l'a lancé (`subject` = l'acteur).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "dé ajouté au test non proposé" });
  }
  route("preUpdateCombatant", onPreUpdateCombatant, { label: "première initiative non notée" });
  route("updateCombatant", onUpdateCombatant, { executor: true, label: "dé ajouté à l'initiative non proposé" });
}
