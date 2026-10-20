/**
 * §222 : les bottes choisies — combien, lesquelles, quand les changer (les effets des bottes : runtime/mastery.mjs).
 *
 *  - **Limite** (réglage de monde `masteryRules`, actif par défaut) : sur le client qui modifie la fiche (`preUpdateActor`), un choix
 *    de bottes qui dépasse ce que donnent les classes et les dons, prend une arme que le personnage ne maîtrise pas, met une arme à
 *    distance dans une botte de Barbare, ou retire une botte hors du Repos long est retiré de la mise à jour (le reste passe), avec un
 *    avertissement. Le MJ n'est jamais retenu : un avertissement seul. La montée de niveau de dnd5e (`isAdvancement`) passe toujours.
 *  - **Repos long** (`dnd5e.restCompleted`, sur le client du repos) : le drapeau `masteryRest` note combien de bottes peuvent changer
 *    (Guerrier : une ; Barbare, Paladin, Rôdeur, Roublard, Maître d'armes : toutes les leurs), puis `dnd5e-combat.masteryRest` est
 *    publié : l'interface ouvre la fenêtre des bottes chez le joueur (ui/mastery.mjs). Chaque botte retirée en dépense une.
 *  - **Entrée en combat** (`combatStart`, MJ actif) : le drapeau tombe — les changements se font au sortir du repos.
 */

import { MODULE_ID } from "../constants.mjs";
import { masteryVerdict, restChanges } from "../core/mastery.mjs";
import { MASTERY_REST_FLAG, chosenMasteries, masterySourcesOf, restAllowanceOf, weaponFacts, baseWeapons } from "../adapter/mastery.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const MASTERY_RULES_SETTING = "masteryRules";
const PATH = "system.traits.weaponProf.mastery.value";

export const masteryRulesOn = () => { try { return game.settings.get(MODULE_ID, MASTERY_RULES_SETTING) !== false; } catch { return true; } };

/** Le choix proposé par une mise à jour (`changes` développé ou à plat), ou undefined. */
function proposed(changes) {
  if ( PATH in changes ) return changes[PATH];
  return foundry.utils.getProperty(changes, PATH);
}

function dropProposal(changes) {
  if ( PATH in changes ) delete changes[PATH];
  const mastery = foundry.utils.getProperty(changes, "system.traits.weaponProf.mastery");
  if ( mastery && (typeof mastery === "object") ) delete mastery.value;
}

/**
 * Juge un choix de bottes pour cet acteur : le verdict de core/mastery.mjs, avec ses sources, ses armes et ce que le Repos long
 * laisse changer. Exposé à l'interface (la fenêtre des bottes juge avant d'enregistrer).
 */
export function judgeMasteries(actor, after) {
  return masteryVerdict({ before: chosenMasteries(actor), after: Array.from(after ?? []), weapons: weaponFacts(actor),
    sources: masterySourcesOf(actor), allowance: restAllowanceOf(actor) });
}

function onPreUpdateActor(actor, changes, options) {
  if ( options?.isAdvancement || options?.[MODULE_ID]?.masteryChecked || !masteryRulesOn() ) return true;
  const after = proposed(changes);
  if ( after === undefined ) return true;
  const verdict = judgeMasteries(actor, after);
  if ( !verdict.ok ) {
    const text = loc(`Bottes.Refus.${verdict.reason}`, { name: actor.name, slots: verdict.slots, allowance: restAllowanceOf(actor) });
    if ( game.user.isGM ) {
      ui.notifications.warn(loc("Bottes.Refus.MJ", { text }));
      return true;
    }
    ui.notifications.warn(text);
    log(`weapon mastery: ${actor.name}'s choice refused (${verdict.reason})`);
    dropProposal(changes);
    return true;
  }
  // Une botte retirée dépense ce que le Repos long laisse changer (le MJ aussi : il agit pour le joueur).
  if ( verdict.removed > 0 ) {
    const left = Math.max(0, restAllowanceOf(actor) - verdict.removed);
    foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${MASTERY_REST_FLAG}`, { allowance: left });
  }
  return true;
}

async function onRestCompleted(actor, result, config) {
  if ( (config?.type !== "long") || !actor?.isOwner || !masteryRulesOn() ) return;
  const sources = masterySourcesOf(actor);
  if ( !sources.length ) return;
  const allowance = restChanges(sources);
  await actor.setFlag(MODULE_ID, MASTERY_REST_FLAG, { allowance });
  log(`${actor.name}: Long Rest, ${allowance} weapon mastery choice(s) may change`);
  Hooks.callAll(`${MODULE_ID}.masteryRest`, actor);
}

async function onCombatStart(combat) {
  for ( const actor of new Set(combat.combatants.map(c => c.actor).filter(Boolean)) ) {
    if ( actor.getFlag(MODULE_ID, MASTERY_REST_FLAG) ) await actor.unsetFlag(MODULE_ID, MASTERY_REST_FLAG);
  }
}

export function registerMasteryChoices() {
  game.settings.register(MODULE_ID, MASTERY_RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${MASTERY_RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${MASTERY_RULES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  // L'index des armes de base, lu une fois : le contrôle de `preUpdateActor` est synchrone.
  route("ready", () => baseWeapons().catch(err => console.error(`${MODULE_ID} | weapon index`, err)), { label: "weapon index not read" });
  route("preUpdateActor", onPreUpdateActor, { cancellable: true, label: "weapon mastery choice not checked" });
  // Sur le client qui a lancé le repos (documents/actor/actor.mjs), propriétaire de l'acteur.
  route("dnd5e.restCompleted", onRestCompleted, { label: "weapon mastery: Long Rest change not offered" });
  route("combatStart", onCombatStart, { executor: true, label: "weapon mastery: Long Rest change not closed" });
}
