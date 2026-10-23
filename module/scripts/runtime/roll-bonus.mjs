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
 * actif lit le d20 sur la carte, demande au joueur (sinon au MJ) s'il relance — sans réponse, le jet est gardé —, relance, et corrige l'initiative de la différence. Le dé d'Embuscade s'ajoute lui aussi à la valeur
 * en vigueur au moment de l'écrire : les deux corrections se cumulent dans n'importe quel ordre.
 */

import { MODULE_ID } from "../constants.mjs";
import { offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { initiativeReroll, rerolledInitiative } from "../core/initiative.mjs";
import { swapPartners } from "../core/feats.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, say, locEsc } from "./shared.mjs";
import { sideOf } from "../adapter/factions.mjs";

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
  // §148 : le DD du test quand le jet le porte (carte de demande, DD donné au jet : `options.target` du D20Roll).
  const dc = Number.isFinite(rolls?.[0]?.options?.target) ? rolls[0].options.target : null;
  const added = await offerRollBonus(actor, { kind: "check", what, total, skill, d20: keptD20(rolls?.[0]) });
  if ( added ) log(`${actor.name}: die added to their check, ${total} + ${added} = ${total + added}`);
  // §113 : l'Inspiration bardique sur un test (« quand la créature rate un Test d20 ») — sans DD connu, au joueur de juger ; §148 : avec
  // le DD, la question le dit, et rien sur une réussite ni quand le dé ne pourrait pas suffire.
  const inspired = await offerInspiration(actor, { what, total: total + added, needed: dc, test: true });
  if ( inspired ) log(`${actor.name}: Bardic Inspiration on their check, ${total + added} + ${inspired} = ${total + added + inspired}`);
}

/** Sur le client qui écrit l'initiative : est-ce la première que reçoit ce combattant ? (lu au `updateCombatant`, partout) */
function onPreUpdateCombatant(combatant, changes, options) {
  if ( (combatant.initiative === null) && Number.isFinite(changes?.initiative) ) options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), firstInitiative: true };
}

/**
 * §236 : Inspiration supérieure — « quand vous jouez l'initiative, vous regagnez des utilisations d'Inspiration bardique jusqu'à en avoir
 * deux ». La règle `regainOnInitiative` : les utilisations de l'item nommé remontent à `upTo` au moins.
 */
async function regainOnInitiative(actor) {
  for ( const rule of actor.items.map(i => contentOf(i).entry?.regainOnInitiative).filter(Boolean) ) {
    const item = actor.items.find(i => identifierOf(i).id === rule.item);
    const uses = item?.system?.uses;
    const max = Number(uses?.max) || 0;
    if ( !max ) continue;
    const left = max - (Number(uses.spent) || 0);
    if ( left >= Math.min(rule.upTo, max) ) continue;
    await item.update({ "system.uses.spent": max - Math.min(rule.upTo, max) });
    log(`${actor.name}: ${item.name}, uses back to ${Math.min(rule.upTo, max)} (Initiative)`);
  }
}

/**
 * §236 : Réflexes du voleur — « vous pouvez jouer deux tours au premier round : le premier à votre initiative, le second à votre
 * initiative moins 10 ». Un second combattant pour le même token (drapeau `extraTurn`), retiré au round 2 ; pas si la créature est
 * Surprise (« vous ne pouvez pas utiliser cette aptitude si vous êtes Surpris » n'est pas dans le texte 2024, mais dnd5e retire Surpris au
 * jet d'initiative : on lit l'état au moment du jet). Chaque combattant a son budget de tour (adapter/turn.mjs, `combatantFor`).
 */
async function extraFirstTurn(combatant) {
  const rule = combatant.actor.items.map(i => contentOf(i).entry?.extraFirstTurn).find(Boolean);
  const combat = combatant.combat;
  if ( !rule || !combat || ((combat.round ?? 0) > 1) || combatant.getFlag(MODULE_ID, "extraTurn") ) return;
  if ( combat.combatants.some(c => (c.tokenId === combatant.tokenId) && c.getFlag(MODULE_ID, "extraTurn")) ) return;
  if ( combatant.actor.statuses?.has("surprised") ) return;
  await combat.createEmbeddedDocuments("Combatant", [{ tokenId: combatant.tokenId, sceneId: combatant.sceneId, actorId: combatant.actorId,
    initiative: combatant.initiative - rule.minus, hidden: combatant.hidden, flags: { [MODULE_ID]: { extraTurn: true } } }]);
  log(`${combatant.name}: second turn in round 1, Initiative ${combatant.initiative - rule.minus}`);
}

/** Au round 2, les seconds tours du premier round s'en vont. */
async function onUpdateCombat(combat, changes) {
  if ( !((changes?.round ?? 0) >= 2) ) return;
  const extra = combat.combatants.filter(c => c.getFlag(MODULE_ID, "extraTurn")).map(c => c.id);
  if ( extra.length ) await combat.deleteEmbeddedDocuments("Combatant", extra);
}

async function onUpdateCombatant(combatant, changes, options) {
  if ( !options?.[MODULE_ID]?.firstInitiative || !Number.isFinite(combatant.initiative) || !combatant.actor ) return;
  if ( !combatant.getFlag(MODULE_ID, "extraTurn") ) {
    await regainOnInitiative(combatant.actor);
    await extraFirstTurn(combatant);
  }
  const total = combatant.initiative;
  const added = await offerRollBonus(combatant.actor, { kind: "initiative", what: game.i18n.localize("DND5E.Initiative"), total });
  if ( !added ) return;
  // La valeur en vigueur, pas celle d'avant la question : une Hypervigilance a pu la changer entre-temps.
  await combatant.update({ initiative: (combatant.initiative ?? total) + added });
  log(`${combatant.name}: die added to their Initiative, ${total} + ${added}`);
}

/**
 * Le combattant dont une carte d'initiative porte le jet : par le token qui parle (sinon par l'acteur), et dont l'initiative vaut le total
 * du jet — un même token peut être dans plusieurs combats (vu le 2026-10-10 : un autre combat du monde corrigé à la place).
 */
function combatantOfMessage(message) {
  const { token, actor } = message.speaker ?? {};
  const total = message.rolls?.[0]?.total;
  const matches = game.combats.contents.flatMap(combat => combat.combatants.filter(c => (token ? c.tokenId === token : c.actorId === actor)));
  return matches.find(c => Number.isFinite(total) && (Math.abs(c.initiative - total) < 1e-6)) ?? null;
}

async function hypervigilance(message, combatant) {
  const actor = combatant?.actor;
  const item = actor?.items.find(i => contentOf(i).entry?.rerollInitiative);
  if ( !item ) return;
  const die = message.rolls?.[0]?.dice?.find(d => d.faces === 20);
  const kept = die?.results?.find(r => r.active && !r.discarded)?.result;
  const keep = die?.modifiers?.find(m => /^k[hl]/.test(m))?.slice(0, 2) ?? null;
  const formula = initiativeReroll(contentOf(item).entry.rerollInitiative, { number: die?.number, kept, keep });
  if ( !formula ) return;
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.Hypervigilance.Question", { item: item.name, d20: kept, total: Math.floor(combatant.initiative) }),
    // « Garder » d'abord : sans réponse dans le délai, askChoice retient la première option.
    options: [{ id: "keep", label: game.i18n.localize("DND5ECOMBAT.Hypervigilance.Garder") }, { id: "reroll", label: game.i18n.localize("DND5ECOMBAT.Hypervigilance.Relancer") }]
  });
  if ( answer?.id !== "reroll" ) { log(`${combatant.name}: ${item.name} — Initiative d20 ${kept} kept`); return; }
  const roll = await new Roll(formula).evaluate();
  // La valeur en vigueur après la question : le dé d'Embuscade a pu s'y ajouter entre-temps.
  const total = rerolledInitiative(combatant.initiative, kept, roll.total);
  await combatant.update({ initiative: total });
  await roll.toMessage({ speaker: message.speaker,
    flavor: game.i18n.format("DND5ECOMBAT.Hypervigilance.Carte", { item: item.name, name: combatant.name, old: kept, new: roll.total, total: Math.floor(total) }),
    flags: { [MODULE_ID]: { rerollInitiative: { item: item.uuid, old: kept, new: roll.total } } } }, { messageMode: message.whisper?.length ? "gm" : undefined });
  log(`${combatant.name}: ${item.name} — Initiative d20 ${kept} rerolled → ${roll.total} (Initiative ${total})`);
}

/** Neutralisé, ou plus de PV : ne peut pas échanger (Vigilant). */
const unable = actor => !!(actor?.statuses?.has("incapacitated") || actor?.statuses?.has("unconscious") || actor?.statuses?.has("dead")
  || ((actor?.system?.attributes?.hp?.value ?? 1) <= 0));

/**
 * §129 : Vigilant — « juste après votre jet d'initiative, vous pouvez échanger votre initiative avec celle d'un allié consentant du même
 * combat ; ni l'un ni l'autre ne doit être Neutralisé ». Au joueur de la créature (sinon au MJ) : garder, ou l'un des alliés qui ont déjà
 * leur initiative. L'allié n'est pas consulté : son accord est réputé donné à la table.
 */
async function alertSwap(combatant) {
  const actor = combatant?.actor;
  const item = actor?.items.find(i => contentOf(i).entry?.initiativeSwap === true);
  const combat = combatant?.parent;
  if ( !item || !combat ) return;
  const view = c => ({ ...(c.token ? sideOf(c.token) : {}), id: c.id, disposition: c.token?.disposition ?? null, initiative: c.initiative, incapacitated: unable(c.actor), down: false });
  const ids = swapPartners(view(combatant), combat.combatants.contents.filter(c => c.actor).map(view));
  if ( !ids.length ) return;
  const partners = ids.map(id => combat.combatants.get(id));
  const answer = await askChoice(actor, {
    actor: actor.uuid, item: item.name,
    prompt: game.i18n.format("DND5ECOMBAT.Vigilant.Question", { item: item.name, total: Math.floor(combatant.initiative) }),
    // « Garder » d'abord : sans réponse dans le délai, askChoice retient la première option.
    options: [{ id: "keep", label: game.i18n.localize("DND5ECOMBAT.Vigilant.Garder") },
      ...partners.map(c => ({ id: c.id, label: game.i18n.format("DND5ECOMBAT.Vigilant.Avec", { name: c.name, total: Math.floor(c.initiative) }) }))]
  });
  const other = (answer?.id && (answer.id !== "keep")) ? combat.combatants.get(answer.id) : null;
  if ( !other || !Number.isFinite(other.initiative) || !Number.isFinite(combatant.initiative) ) { log(`${combatant.name}: ${item.name} — Initiative kept`); return; }
  const mine = combatant.initiative;
  const theirs = other.initiative;
  await combat.updateEmbeddedDocuments("Combatant", [{ _id: combatant.id, initiative: theirs }, { _id: other.id, initiative: mine }]);
  await say({ actor }, locEsc("Vigilant.Carte", { item: item.name, name: combatant.name, other: other.name, mine: Math.floor(theirs), theirs: Math.floor(mine) }),
    { initiativeSwap: { item: item.uuid, with: other.id } });
  log(`${combatant.name}: ${item.name} — Initiative swapped with ${other.name} (${mine} <-> ${theirs})`);
}

/** Sans attente : les autres lecteurs de la carte suivent leur cours pendant que le joueur choisit. */
function onInitiativeMessage(message) {
  if ( !message.getFlag?.("core", "initiativeRoll") ) return;
  // Le combattant se reconnaît à l'initiative égale au total du jet : à lire avant qu'une relance ne la change.
  const combatant = combatantOfMessage(message);
  if ( !combatant ) return;
  enqueue(`hypervigilance:${message.id}`, async () => {
    await hypervigilance(message, combatant);
    await alertSwap(combatant);
  });
}

export function registerRollBonus() {
  // dnd5e 6.0 : documents/actor/actor.mjs — `dnd5e.roll${name}` après un test de compétence, d'outil ou de caractéristique, sur le
  // client qui l'a lancé (`subject` = l'acteur).
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, onCheckRolled, { label: "check die not offered" });
  }
  route("preUpdateCombatant", onPreUpdateCombatant, { label: "first Initiative not recorded" });
  route("updateCombatant", onUpdateCombatant, { executor: true, label: "Initiative die not offered" });
  route("updateCombat", onUpdateCombat, { executor: true, label: "second turn not removed" });
  route("createChatMessage", onInitiativeMessage, { executor: true, label: "Initiative d20 not rerolled" });
}
