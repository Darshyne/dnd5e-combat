/**
 * §214 : Formation au port d'armure — ce que dnd5e ne fait pas (adapter/armor-training.mjs).
 *  - Armure sans formation : Désavantage aux tests de caractéristique (compétences, initiative comprises) et aux sauvegardes de Force et
 *    de Dextérité (`dnd5e.preRollAbilityCheckV2`, `dnd5e.preRollSavingThrowV2`, sur le client qui lance) ; aux attaques de Force ou de
 *    Dextérité, c'est une raison de Désavantage du moteur (core/conditions.mjs, « Armure sans formation ») ; lancer un sort est un souci
 *    de légalité (runtime/turn.mjs).
 *  - Bouclier sans formation : pas de bonus de CA — le MJ actif pose sur le personnage un effet marqué qui retire le bonus du bouclier
 *    (`system.attributes.ac.bonus`), et le retire dès que la formation ou le bouclier change.
 */

import { MODULE_ID } from "../constants.mjs";
import { armorHampers, untrainedShield } from "../adapter/armor-training.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const SHIELD_FLAG = "untrainedShield";

/** Sur le client qui lance : Désavantage au test ou à la sauvegarde de Force ou de Dextérité en armure sans formation. */
function onPreRoll(config) {
  const actor = config?.subject;
  const roll = config?.rolls?.[0];
  const armor = (actor?.documentName === "Actor") ? armorHampers(actor, config.ability) : null;
  if ( !armor || !roll ) return true;
  roll.options ??= {};
  roll.options.disadvantage = true;
  log(`${actor.name}: ${config.ability} roll with Disadvantage (${armor.name} worn without armor training)`);
  return true;
}

/** MJ actif : l'effet « bouclier sans formation » suit le bouclier porté et la formation du personnage. */
async function syncShield(actor) {
  if ( actor?.type !== "character" ) return;
  const shield = untrainedShield(actor);
  const value = Number(shield?.system?.armor?.value) || 0;
  const current = actor.effects.find(e => e.getFlag(MODULE_ID, SHIELD_FLAG));
  if ( !shield || !value ) {
    if ( current ) { await current.delete(); log(`${actor.name}: shield penalty removed`); }
    return;
  }
  const changes = [{ key: "system.attributes.ac.bonus", type: "add", value: `-${value}` }];
  if ( current ) {
    if ( current.changes?.[0]?.value === `-${value}` ) return;
    await current.update({ changes, name: loc("Armure.Bouclier", { item: shield.name }) });
    return;
  }
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: loc("Armure.Bouclier", { item: shield.name }), img: shield.img, transfer: false, disabled: false,
    description: `<p>${loc("Armure.BouclierTexte")}</p>`, changes, flags: { [MODULE_ID]: { [SHIELD_FLAG]: true } }
  }]);
  log(`${actor.name}: ${shield.name} carried without armor training, no AC bonus (-${value})`);
}

const queued = new Set();
/** Une seule mise à jour à la fois par acteur (plusieurs hooks peuvent tomber ensemble). */
function resync(actor) {
  if ( !actor || queued.has(actor.uuid) ) return;
  queued.add(actor.uuid);
  setTimeout(() => {
    queued.delete(actor.uuid);
    syncShield(actor).catch(err => console.error(`${MODULE_ID} | armor training`, err));
  }, 200);
}

const itemChanged = item => { if ( item?.type === "equipment" ) resync(item.parent); };

export function registerArmorTraining() {
  route("dnd5e.preRollAbilityCheckV2", onPreRoll, { label: "armor training: ability check Disadvantage" });
  route("dnd5e.preRollSavingThrowV2", onPreRoll, { label: "armor training: saving throw Disadvantage" });
  const executor = { executor: true, label: "armor training: shield AC not updated" };
  route("createItem", itemChanged, executor);
  route("updateItem", itemChanged, executor);
  route("deleteItem", itemChanged, executor);
  route("updateActor", (actor, changes) => { if ( foundry.utils.hasProperty(changes, "system.traits.armorProf") ) resync(actor); }, executor);
  route("ready", () => { for ( const actor of game.actors ) if ( actor.type === "character" ) resync(actor); }, executor);
}
