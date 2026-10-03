/**
 * Actions de base (SPEC §15.2) : le MJ actif pose sur TOUS les personnages (acteurs « character », qu'ils
 * aient un joueur ou non — un personnage joué par le MJ en a besoin aussi) les items qui leur manquent, en
 * permanence : au chargement du monde, à la création d'un personnage, au début d'un combat et quand un
 * personnage rejoint un combat en cours. Rien n'est retiré, rien n'est posé sur un PNJ. Réglage de monde.
 * (Première version, 0.23.0 : seulement les personnages des joueurs, seulement au début d'un combat —
 * introuvables hors combat, absents d'un personnage joué par le MJ ; corrigé le 2026-09-23.)
 *
 * Et l'attaque de la main secondaire côté dégâts : dnd5e retire déjà le modificateur positif en mode
 * `offhand` (data/activity/attack-data.mjs:426) ; le style Combat à deux armes le rend.
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionData, missingBasicActions } from "../adapter/basics.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const SETTING = "provideBasicActions";

async function provide(actors) {
  if ( !game.settings.get(MODULE_ID, SETTING) ) return;
  const seen = new Set();
  for ( const actor of actors ) {
    if ( !actor || (actor.type !== "character") || seen.has(actor.uuid) ) continue;
    seen.add(actor.uuid);
    const missing = missingBasicActions(actor);
    if ( !missing.length ) continue;
    await actor.createEmbeddedDocuments("Item", missing.map(basicActionData));
    log(`actions de base posées sur ${actor.name} : ${missing.join(", ")}`);
  }
}

/** Combat à deux armes : le modificateur revient aux dégâts de la main secondaire (sur le client de l'auteur). */
function onPreRollDamage(config) {
  const actor = config.subject?.actor;
  const roll = config.rolls?.[0];
  if ( !config.attackMode?.endsWith?.("offhand") || !roll || !actor ) return true;
  if ( !actor.items.some(i => i.system.identifier === "two-weapon-fighting") ) return true;
  if ( !((roll.data?.mod ?? 0) > 0) || roll.parts?.includes("@mod") ) return true;
  roll.parts = [...(roll.parts ?? []), "@mod"];
  log("main secondaire : Combat à deux armes, modificateur rendu aux dégâts");
  return true;
}

export function registerBasics() {
  // Fenêtres du combat (réaction, choix, sauvegarde) : résolues seules au bout de ce délai (adapter/dialogs.mjs).
  game.settings.register(MODULE_ID, "combatWindowSeconds", {
    name: "DND5ECOMBAT.Reglage.combatWindowSeconds.Nom", hint: "DND5ECOMBAT.Reglage.combatWindowSeconds.Aide",
    scope: "world", config: true, type: Number, default: 10, range: { min: 3, max: 60, step: 1 }
  });
  // Sauvegarde à plusieurs caractéristiques au choix de la cible (Lutte, Bousculade) : pour une cible jetée
  // par le MJ, demander (fenêtre chez le MJ) ou prendre la meilleure. Un joueur choisit toujours.
  game.settings.register(MODULE_ID, "npcSaveChoice", {
    name: "DND5ECOMBAT.Reglage.npcSaveChoice.Nom", hint: "DND5ECOMBAT.Reglage.npcSaveChoice.Aide",
    scope: "world", config: true, type: String, default: "ask",
    choices: { ask: "DND5ECOMBAT.Reglage.npcSaveChoice.ask", best: "DND5ECOMBAT.Reglage.npcSaveChoice.best" }
  });
  // §18.9 : Résistance légendaire d'un PNJ qui rate une sauvegarde — demander au MJ, toujours la dépenser, ou jamais.
  game.settings.register(MODULE_ID, "legendaryResistance", {
    name: "DND5ECOMBAT.Reglage.legendaryResistance.Nom", hint: "DND5ECOMBAT.Reglage.legendaryResistance.Aide",
    scope: "world", config: true, type: String, default: "ask",
    choices: { ask: "DND5ECOMBAT.Reglage.legendaryResistance.ask", always: "DND5ECOMBAT.Reglage.legendaryResistance.always",
      never: "DND5ECOMBAT.Reglage.legendaryResistance.never" }
  });
  game.settings.register(MODULE_ID, SETTING, {
    name: `DND5ECOMBAT.Reglage.${SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  const placed = { executor: true, label: "actions de base posées" };
  route("ready", () => provide(game.actors).catch(err => console.error(`${MODULE_ID} | actions de base`, err)), placed);
  route("createActor", actor => provide([actor]), placed);
  route("combatStart", combat => provide(combat.combatants.map(c => c.actor)), placed);
  route("createCombatant", combatant => provide([combatant.actor]), placed);
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "main secondaire : Combat à deux armes" });
}
