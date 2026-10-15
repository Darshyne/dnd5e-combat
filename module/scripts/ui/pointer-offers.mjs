/**
 * Après une action : cibles relâchées, et les offres qui rouvrent une visée (Enchaînement, Déluge de coups, attaque enchantée,
 * Rebond, attaque Bonus), fin de tour. Extrait d'ui/pointer.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { combatantFor, isOwnTurn, readBudget } from "../adapter/turn.mjs";
import { stormOf } from "../adapter/storm.mjs";
import { strike } from "../runtime/storm.mjs";
import { contentOf } from "../adapter/content.mjs";
import { leapOf, rolledDouble, evalRuleFormula } from "../adapter/projectiles.mjs";
import { teleportSelf, selfTeleportOf } from "../runtime/actions.mjs";
import { masteryOf, cleaveCandidates, cleaveSpent } from "../adapter/mastery.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { loc, log } from "../runtime/shared.mjs";
import { openTargeting, reticle, setting, stormAfterUse } from "./pointer.mjs";

/* -------------------------------------------- */
/*  Cibles relâchées                            */
/* -------------------------------------------- */

function releaseTargets() {
  inFlight = null;
  if ( !setting("releaseTargets") ) return;
  clearTargets();
}

export function clearTargets() {
  for ( const token of Array.from(game.user.targets) ) token.setTarget(false, { releaseOthers: false });
}

/**
 * §125 : les cibles qu'une action lancée par le moteur emporte (`{ activity, ids }`), jusqu'à leur relâchement à la fin de sa résolution.
 * Une autre activité lancée entre-temps sur exactement ces cibles les a héritées : ce sont des restes.
 */
let inFlight = null;
const targetIds = () => Array.from(game.user.targets).map(t => t.document.uuid).sort();
export function noteInFlight(activity) {
  const ids = targetIds();
  inFlight = ids.length ? { activity: activity?.uuid ?? null, ids } : null;
}
export function leftoverTargets(activity) {
  if ( !inFlight || !game.user.targets.size || (inFlight.activity === (activity?.uuid ?? null)) ) return false;
  const ids = targetIds();
  return (ids.length === inFlight.ids.length) && ids.every((id, i) => id === inFlight.ids[i]);
}

/** Une action jugée (attaque touchée et dégâts appliqués, ratée, sauvegardes réglées) : son auteur relâche ses cibles. */
export const released = new Set();
export function onResolutionSettled(message) {
  if ( !message.author?.isSelf || released.has(message.id) ) return;
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !["done", "missed"].includes(resolution?.step) ) return;
  released.add(message.id);
  releaseTargets();
  if ( resolution.step === "done" ) offerBonusAttack(message, resolution);
  if ( resolution.step === "done" ) offerCleave(message, resolution);
  if ( message.getFlag(MODULE_ID, "flurry") ) offerFlurry(message.getAssociatedActor?.());
  if ( resolution.step === "done" ) offerLeap(message, resolution);
}

/**
 * §21 : Enchaînement (botte d'arme) — l'attaque au corps à corps a touché et le jet portait la botte : la visée s'ouvre chez
 * l'auteur pour une seconde attaque avec la même arme, sans coût, contre une créature à 1,50 m de la première et à l'allonge.
 * Une fois par tour de combat. Clic droit pour y renoncer.
 */
function offerCleave(message, resolution) {
  if ( !resolution.plan?.attack || message.getFlag(MODULE_ID, "cleave") ) return;
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  if ( masteryOf(attackMessage) !== "cleave" ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || cleaveSpent(actor) ) return;
  const mode = attackMessage.rolls?.[0]?.options?.attackMode ?? "";
  if ( (activity.attack?.type?.value !== "melee") || mode.includes("thrown") || (mode === "ranged") ) return;
  const hit = resolution.targets.find(t => t.hit);
  const first = hit ? fromUuidSync(hit.token, { strict: false }) : null;
  const { scene, token: tokenId } = attackMessage.speaker ?? {};
  const token = game.scenes.get(scene)?.tokens.get(tokenId) ?? null;
  if ( !first || !token?.object || !cleaveCandidates(token, first, activity).length ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "free", cleave: first.uuid } }, { configure: false }, {}],
    { prompt: loc("Botte.Enchainement.Visee", { item: activity.item.name, name: first.name }),
      notice: loc("Botte.Retour.cleave"), reticle: loc("Botte.Retour.cleave") });
}

/**
 * §24 : Déluge de coups — tant qu'il reste des frappes gratuites au budget du tour, la visée de la frappe à mains nues s'ouvre chez
 * l'auteur : après l'activation du Déluge, puis après chaque frappe résolue. Clic droit pour y renoncer.
 */
function offerFlurry(actor) {
  const combatant = actor ? combatantFor(actor) : null;
  if ( !combatant || !isOwnTurn(combatant) || !((readBudget(combatant)?.flurry ?? 0) > 0) ) return;
  // §27 : Prêtre de guerre — l'attaque ouverte se fait avec l'arme de corps à corps équipée, sinon à mains nues.
  const weapon = readBudget(combatant).flurryAny
    ? actor.items.find(i => (i.type === "weapon") && i.system.equipped && (i.system.identifier !== "unarmed-strike")) : null;
  const strike = weapon ?? actor.items.find(i => i.system?.identifier === "unarmed-strike");
  const activity = strike?.system.activities?.find(a => a.type === "attack");
  const token = combatant.token;
  if ( !activity || !token?.object ) return;
  const label = weapon ? "Clerc.PretreGuerre" : "Moine.Deluge";
  openTargeting(token, activity, [{}, { configure: false }, {}],
    { prompt: loc(`${label}.Visee`, { n: readBudget(combatant).flurry }), notice: loc(`${label}.Retour`), reticle: loc(`${label}.Retour`) });
}

/** §24 : l'activation du Déluge de coups (carte d'utilisation de l'auteur) : la première frappe se vise aussitôt, budget écrit. */
export function onFlurryUsed(message) {
  if ( (message.type !== "usage") || !message.author?.isSelf ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = activity?.item ? contentOf(activity.item).entry?.flurry : null;
  if ( !rule || (rule.activity !== activity.id) ) return;
  // Le budget est écrit par le MJ actif juste après la carte : on lui laisse un instant.
  setTimeout(() => offerFlurry(activity.actor), 800);
}

/**
 * §23 : Frappe assurée — « vous faites une attaque avec l'arme utilisée pour lancer le sort » : dès que l'enchantement (contenu
 * `oneAttack`) est posé sur l'arme, la visée de son attaque s'ouvre chez celui qui joue la créature (le joueur connecté, sinon le
 * MJ actif), sans coût — le sort a payé l'action. L'enchantement tombe après l'attaque (runtime/cantrips.mjs).
 */
export function offerEnchantedAttack(effect) {
  const weapon = effect.parent;
  const actor = weapon?.actor;
  if ( (weapon?.documentName !== "Item") || (weapon.type !== "weapon") || !actor ) return;
  if ( contentOf(originItemOf(effect)).entry?.oneAttack !== true ) return;
  if ( (rollerFor(actor) ?? game.users.activeGM?.id) !== game.user.id ) return;
  const activity = weapon.system.activities?.find(a => a.type === "attack");
  const token = actor.getActiveTokens(true, true)?.[0] ?? null;
  if ( !activity || !token?.object ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "free" } }, { configure: false }, {}],
    { prompt: loc("Visee.AttaqueEnchantee", { item: weapon.name }), notice: weapon.name, reticle: weapon.name });
}

/**
 * §16.27 : Orbe chromatique — l'attaque a touché et les dés de dégâts montrent un double : la visée s'ouvre chez l'auteur pour
 * faire bondir l'orbe (même activité, sans emplacement ni action, même type de dégâts, au niveau du lancement). La cible est
 * validée à l'utilisation (runtime/projectiles.mjs) : à 9 m de la dernière, jamais visée. Clic droit pour y renoncer.
 */
function offerLeap(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const hit = resolution.targets.find(t => t.hit);
  if ( !hit ) return;
  const usage = game.messages.get(resolution.origin ?? message.id) ?? message;
  const activity = usage.getAssociatedActivity?.();
  const rule = leapOf(activity?.item);
  if ( !rule || !rolledDouble(game.messages.get(resolution.damageRoll?.messageId ?? "")) ) return;
  const prior = usage.getFlag(MODULE_ID, "leap");
  const first = prior?.of ? (game.messages.get(prior.of) ?? usage) : usage;
  const left = prior ? prior.left : evalRuleFormula(rule.max, first.getAssociatedActivity?.({ scaled: true }), 1);
  if ( !(left > 0) ) return;
  const token = activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token?.object ) return;
  const level = activity.item.system.level ?? 0;
  const scaling = Number(first.system?.scaling) || 0;
  const leap = { of: first.id, from: hit.token, chain: [...(prior?.chain ?? []), ...resolution.targets.map(t => t.token)], left: left - 1 };
  const config = {
    consume: { spellSlot: false }, concentration: { begin: false },
    ...(level > 0 ? { scaling, spell: { slot: `spell${level + scaling}` } } : {}),
    [MODULE_ID]: { cost: "free", leap }
  };
  const damageType = usage.getFlag(MODULE_ID, "damageType");
  const flags = { leap, ...(damageType ? { damageType } : {}) };
  log(`${activity.item.name}: doubles on the dice, leap offered (${left} left)`);
  openTargeting(token, activity, [config, { configure: false }, { data: { flags: { [MODULE_ID]: flags } } }],
    { prompt: loc("Rebond.Visee", { item: activity.item.name, left }), notice: loc("Retour.Rebond"), noticeOn: hit.token,
      reticle: loc("Retour.Rebond") });
}

/**
 * §16.26 : Taille (Maître d'armes lourdes) — après un coup critique, ou une créature tombée à 0 PV, d'une arme (de corps à
 * corps si la règle le dit), sur le client de l'auteur : la visée s'ouvre pour attaquer de nouveau avec la même arme, pour
 * l'action Bonus (`cost: "bonus"`, que la légalité et le budget lisent). À son tour, en combat, l'action Bonus encore là ;
 * clic droit pour y renoncer.
 */
function offerBonusAttack(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.item?.type !== "weapon") || (activity.type !== "attack") ) return;
  const critical = resolution.targets.some(t => t.hit && t.critical);
  const felled = (resolution.log ?? []).some(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0));
  const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? "";
  const melee = (activity.attack?.type?.value === "melee") && !attackMode.includes("thrown") && (attackMode !== "ranged");
  const rule = actor.items.map(i => contentOf(i).entry?.bonusAttack).find(r => r
    && ((critical && r.after.includes("critical")) || (felled && r.after.includes("felled"))) && (!r.melee || melee));
  if ( !rule ) return;
  const combatant = combatantFor(actor);
  if ( !combatant || !isOwnTurn(combatant) || !(readBudget(combatant)?.bonus > 0) ) return;
  const token = combatant.token;
  if ( !token?.object ) return;
  openTargeting(token, activity, [{ [MODULE_ID]: { cost: "bonus" } }, { configure: false }, {}],
    { prompt: loc("Visee.AttaqueBonus", { item: activity.item.name, why: loc(critical ? "Visee.Critique" : "Visee.Abattu") }),
      notice: loc("Retour.Taille"), reticle: loc("Retour.Taille") });
}

/** Fin de tour : celui qui jouait ce combattant relâche ses cibles. */
export function onTurnChange(combat, prior) {
  const combatant = combat.combatants.get(prior?.combatantId);
  if ( !combatant?.isOwner || (game.user.isGM && combatant.hasPlayerOwner) ) return;
  releaseTargets();
}

/* -------------------------------------------- */

/**
 * §16.10 : une téléportation de soi (activité native « teleport » à portée « soi », ou item qui la déclare : Foulée
 * brumeuse, Porte dimensionnelle) ouvre la visée de la destination dès l'utilisation, sur le client de celui qui l'a
 * utilisée — le TODO de dnd5e 6 (`_triggerSubsequentActions`, teleport.mjs).
 */
export function onPostUseActivity(activity, usageConfig, results) {
  if ( results && stormOf(activity?.item) ) return void stormAfterUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | storm`, err));
  if ( !results || !setting("teleportPlanning") || !selfTeleportOf(activity) ) return;
  if ( usageConfig?.subsequentActions === false ) return;   // un appelant qui enchaîne lui-même (connecteur, scénarios)
  teleportSelf(activity).catch(err => console.error(`${MODULE_ID} | teleportation`, err));
}

/**
 * §16.34 : les jets d'attaque, de dégâts et de soins partent sans la fenêtre de configuration de dnd5e (réglage par joueur,
 * activé par défaut) — ceux que dnd5e enchaîne après l'utilisation (activity/attack.mjs:69, heal.mjs:61, damage.mjs:52), depuis
 * la fiche, le HUD ou le bouton de la carte. Avantage et désavantage viennent du moteur ; le mode d'attaque (« lancer ») est
 * présélectionné par runtime/turn.mjs. Les jets que le moteur lance lui-même sont déjà sans fenêtre (adapter/messages.mjs).
 */
export function onPreRollDamage(config, dialog) {
  if ( dialog && setting("quickRolls") ) dialog.configure = false;
}
