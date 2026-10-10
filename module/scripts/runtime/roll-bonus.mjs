/**
 * §90 : un dé que la créature ajoute à un test qu'elle vient de lancer, ou à son initiative (clé `rollBonus`, `on: ["check"]` /
 * `["initiative"]`) — Embuscade (Discrétion, initiative), Autorité naturelle (Intimidation, Représentation, Persuasion), Évaluation
 * tactique (Histoire, Investigation, Perspicacité) du Maître de guerre ; la Chance du ténébreux sur un test. §113 : puis l'Inspiration
 * bardique que la créature porte (`offerInspiration`, sans seuil).
 *
 * Le moteur ne connaît pas le DD d'un test libre : la question est posée sitôt le jet lancé (« après l'avoir vu »), sur le client qui
 * l'a lancé, au joueur de la créature (adapter/inspiration.mjs, `offerRollBonus`) ; le dé part en clair, avec le nouveau total sur sa
 * carte — le jet d'origine n'est pas réécrit. L'initiative, elle, est corrigée : la première valeur que reçoit un combattant (sur le
 * MJ actif) ouvre la question, et le dé s'ajoute à sa valeur.
 *
 * §120 : Hypervigilance (Survivant, clé `rerollInitiative`) — le d20 d'un jet d'initiative de 9 ou moins est relancé, le nouveau gardé.
 * Le cœur écrit l'initiative PUIS crée la carte du jet (client/documents/combat.mjs:432-435, `flags.core.initiativeRoll`) : le MJ
 * actif lit le d20 sur la carte, relance, et corrige l'initiative de la différence. Le dé d'Embuscade s'ajoute lui aussi à la valeur
 * en vigueur au moment de l'écrire : les deux corrections se cumulent dans n'importe quel ordre.
 */

import { MODULE_ID } from "../constants.mjs";
import { offerInspiration, offerRollBonus } from "../adapter/inspiration.mjs";
import { contentOf } from "../adapter/content.mjs";
import { initiativeReroll, rerolledInitiative } from "../core/initiative.mjs";
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
  const what = checkName({ skill, tool, ability });
  const added = await offerRollBonus(actor, { kind: "check", what, total, skill });
  if ( added ) log(`${actor.name}: die added to their check, ${total} + ${added} = ${total + added}`);
  // §113 : l'Inspiration bardique sur un test (« quand la créature rate un Test d20 ») — le DD est inconnu : au joueur de juger.
  const inspired = await offerInspiration(actor, { what, total: total + added, needed: null });
  if ( inspired ) log(`${actor.name}: Bardic Inspiration on their check, ${total + added} + ${inspired} = ${total + added + inspired}`);
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
  // La valeur en vigueur, pas celle d'avant la question : une Hypervigilance a pu la changer entre-temps.
  await combatant.update({ initiative: (combatant.initiative ?? total) + added });
  log(`${combatant.name}: die added to their Initiative, ${total} + ${added}`);
}

/** Le combattant dont une carte d'initiative porte le jet : par le token qui parle, sinon par l'acteur. */
function combatantOfMessage(message) {
  const { token, actor } = message.speaker ?? {};
  for ( const combat of game.combats ) {
    const c = combat.combatants.find(c => (token ? c.tokenId === token : c.actorId === actor) && Number.isFinite(c.initiative));
    if ( c ) return c;
  }
  return null;
}

async function onInitiativeMessage(message) {
  if ( !message.getFlag?.("core", "initiativeRoll") ) return;
  const combatant = combatantOfMessage(message);
  const actor = combatant?.actor;
  const item = actor?.items.find(i => contentOf(i).entry?.rerollInitiative);
  if ( !item ) return;
  const die = message.rolls?.[0]?.dice?.find(d => d.faces === 20);
  const kept = die?.results?.find(r => r.active && !r.discarded)?.result;
  const keep = die?.modifiers?.find(m => /^k[hl]/.test(m))?.slice(0, 2) ?? null;
  const formula = initiativeReroll(contentOf(item).entry.rerollInitiative, { number: die?.number, kept, keep });
  if ( !formula ) return;
  const roll = await new Roll(formula).evaluate();
  const total = rerolledInitiative(combatant.initiative, kept, roll.total);
  await combatant.update({ initiative: total });
  await roll.toMessage({ speaker: message.speaker,
    flavor: game.i18n.format("DND5ECOMBAT.Hypervigilance.Carte", { item: item.name, name: combatant.name, old: kept, new: roll.total, total: Math.floor(total) }),
    flags: { [MODULE_ID]: { rerollInitiative: { item: item.uuid, old: kept, new: roll.total } } } }, { messageMode: message.whisper?.length ? "gm" : undefined });
  log(`${combatant.name}: ${item.name} — Initiative d20 ${kept} rerolled → ${roll.total} (Initiative ${total})`);
}

export function registerRollBonus() {
  // dnd5e 6.0 : documents/actor/actor.mjs — `dnd5e.roll${name}` après un test de compétence, d'outil ou de caractéristique, sur le
  // client qui l'a lancé (`subject` = l'acteur).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "check die not offered" });
  }
  route("preUpdateCombatant", onPreUpdateCombatant, { label: "first Initiative not recorded" });
  route("updateCombatant", onUpdateCombatant, { executor: true, label: "Initiative die not offered" });
  route("createChatMessage", onInitiativeMessage, { executor: true, label: "Initiative d20 not rerolled" });
}
