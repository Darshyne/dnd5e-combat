/**
 * §89 : dés de manœuvre joués à l'action Bonus (Maître de guerre).
 *
 *  - `pendingDie` `{ activity, against }` : utiliser l'activité PROMET son dé (la première part de dégâts, lue avec les données de
 *    l'acteur : « 1d8 ») au prochain jet de dégâts d'une attaque de l'auteur, dans ce tour — au corps à corps (`"melee"`, Fente :
 *    « si vous touchez d'une attaque au corps à corps ce tour-ci ») ou contre la créature désignée à l'utilisation (`"target"`, Feinte :
 *    « si cette attaque touche »). Promesse portée par l'acteur (`flags.dnd5e-combat.pendingDie`) ; ajoutée au jet de dégâts sur le
 *    client de l'auteur (`dnd5e.preRollDamageV2`, du type du premier jet), puis effacée. Contre une cible : une attaque ratée contre
 *    elle l'efface aussi (« votre prochain jet d'attaque ») — sur le MJ actif, à la résolution. Hors du tour où elle est née : rien.
 *  - `rolledAc` `{ activity, effect }` : utiliser l'activité lance le dé de son `roll` (Jeu de jambes évasif : « lancez le dé et
 *    ajoutez-le à votre CA jusqu'au début de votre prochain tour ») et pose l'effet de l'item sur l'auteur, le bonus de CA écrit
 *    dedans (l'effet de la donnée est vide).
 * Le dé lui-même est payé par la consommation de l'activité (un dé de supériorité), comme dnd5e le fait.
 *
 * §90, sur le MJ actif (il déplace et écrit pour d'autres que l'auteur) :
 *  - `sweep` (Balayage) : après un coup au corps à corps (arme, mains nues), l'auteur peut infliger le dé de l'activité, du type des
 *    dégâts du coup, à une autre créature à 1,50 m de la cible touchée et à son allonge, que le jet aurait touchée ; l'activité paie
 *    sans être utilisée (sa carte de dégâts toucherait sa propre cible).
 *  - `swapPlaces` (Chassé-croisé) : l'auteur et la créature visée, à 1,50 m, échangent leurs places — elle par une téléportation,
 *    lui par un pas (1,50 m de son déplacement), tous deux sans attaque d'opportunité ; `rolledAc.to: "choose"` : le dé à la CA de
 *    l'un ou de l'autre, au choix de l'auteur.
 *  - `commandStrike` (Frappe commandée) : la créature visée reçoit l'ordre (`commanded` dans le budget de son tour : sa prochaine
 *    attaque d'arme ce tour-ci se paie par sa Réaction, runtime/turn.mjs) et le dé promis à ses dégâts (`pendingDie`, `against: "any"`).
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { currentTurnKey, combatantFor, readBudget, writeBudget, distanceBetween, historyCosts } from "../adapter/turn.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { usesLeftFor } from "../adapter/inspiration.mjs";
import { payWithoutUse } from "../adapter/reactions.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { movementCap } from "./actions.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

const FLAG = "pendingDie";

/** La formule de la première part de dégâts de l'activité, lue avec les données de l'acteur. */
function dieOf(activity) {
  const part = activity?.damage?.parts?.[0];
  const raw = part?.custom?.enabled ? part.custom.formula : ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}` : null);
  return raw ? Roll.replaceFormulaData(raw, activity.getRollData?.() ?? {}) : null;
}

async function onPostUse(activity, usageConfig, results) {
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  const actor = activity?.actor;
  if ( !entry || !actor || !results ) return;
  const pending = (entry.pendingDie?.activity === activity.id) ? entry.pendingDie : null;
  if ( pending ) {
    const formula = dieOf(activity);
    const target = (pending.against === "target") ? (results.message?.system?.targets?.[0]?.token ?? Array.from(game.user.targets)[0]?.document?.uuid ?? null) : null;
    if ( formula ) {
      await actor.setFlag(MODULE_ID, FLAG, { item: activity.item.uuid, name: activity.item.name, formula, against: pending.against, target, turn: currentTurnKey() });
      log(`${activity.item.name} : +${formula} promis au prochain coup ${pending.against === "target" ? "contre la cible" : "au corps à corps"} de ce tour`);
    }
  }
  const rolled = ((entry.rolledAc?.activity === activity.id) && (entry.rolledAc.to !== "choose")) ? entry.rolledAc : null;
  if ( rolled && activity.roll?.formula ) {
    const roll = await new Roll(activity.roll.formula, activity.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${activity.item.name} : ${activity.roll.name || "CA"}` });
    // Après la résolution de l'utilitaire, qui pose l'effet de la donnée (vide) : on le remplace par le nôtre, le bonus écrit dedans.
    await new Promise(r => setTimeout(r, 1500));
    const effect = await placeItemEffect(activity.item, rolled.effect, actor);
    if ( effect ) {
      await effect.update({ "system.changes": [{ key: "system.attributes.ac.bonus", type: "add", value: String(roll.total) }] });
      log(`${activity.item.name} : +${roll.total} à la CA de ${actor.name}`);
    }
  }
}

function onPreRollDamage(config, dialog, message) {
  const activity = config?.subject;
  const actor = activity?.actor;
  const pending = actor?.getFlag(MODULE_ID, FLAG);
  if ( !pending || !config.rolls?.length || (activity.type !== "attack") ) return true;
  if ( pending.turn !== currentTurnKey() ) { actor.unsetFlag(MODULE_ID, FLAG).catch(() => {}); return true; }
  if ( (pending.against === "melee") && (activity.attack?.type?.value !== "melee") ) return true;
  // §90 : l'ordre de la Frappe commandée vaut pour une attaque avec une arme ou à mains nues.
  if ( (pending.against === "any") && !["weapon", "unarmed"].includes(activity.attack?.type?.classification) ) return true;
  if ( pending.against === "target" ) {
    const targets = foundry.utils.getProperty(message ?? {}, "data.system.targets") ?? [];
    if ( !targets.some(t => t.token === pending.target) ) return true;
  }
  const type = config.rolls[0]?.options?.type ?? null;
  config.rolls.push({ data: activity.getRollData(), parts: [pending.formula], options: { type, types: type ? [type] : [], properties: [] } });
  actor.unsetFlag(MODULE_ID, FLAG).catch(() => {});
  log(`${pending.name} : +${pending.formula} ${type ?? ""}`);
  return true;
}

/** Feinte : une attaque RATÉE contre la cible désignée éteint la promesse (« votre prochain jet d'attaque contre elle »). §90 : Balayage. */
async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const actor = source?.actor ?? source;
  if ( actor?.items ) await sweep(resolution, actor, source?.actor ? source : tokenOf(actor));
  const pending = actor?.getFlag?.(MODULE_ID, FLAG);
  if ( !pending || (pending.against !== "target") ) return;
  const missed = (resolution.targets ?? []).some(t => (t.token === pending.target) && (t.hit === false));
  if ( missed ) {
    await actor.unsetFlag(MODULE_ID, FLAG);
    log(`${pending.name} : l'attaque contre la cible a raté, le dé est perdu`);
  }
}

/* -------------------------------------------- */
/*  §90 : Balayage, Chassé-croisé, Frappe commandée */
/* -------------------------------------------- */

const within = (a, b, value) => distanceBetween(a, b).value <= (value + 1e-6);

/** Balayage : le coup au corps à corps a touché ; une autre créature que le jet aurait touchée, à 1,50 m de la cible et à l'allonge. */
async function sweep(resolution, actor, attacker) {
  const attack = fromUuidSync(resolution.activity ?? "", { strict: false });
  if ( (attack?.type !== "attack") || (attack.attack?.type?.value !== "melee") || !["weapon", "unarmed"].includes(attack.attack?.type?.classification) ) return;
  const hit = (resolution.targets ?? []).find(t => t.hit === true);
  const total = resolution.attack?.roll?.total;
  const first = hit ? fromUuidSync(hit.token ?? "", { strict: false }) : null;
  if ( !first || !attacker || !Number.isFinite(total) ) return;
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.sweep;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    const grid = first.parent.grid;
    const reach = attack.range?.reach ?? attack.item?.system?.range?.reach ?? 5;
    const units = attack.range?.units ?? attack.item?.system?.range?.units ?? "ft";
    const reachValue = (units === grid.units) ? reach : (grid.distance * reach / 5);
    const struck = new Set((resolution.targets ?? []).map(t => t.token));
    const candidates = first.parent.tokens.filter(t => t.actor && (t !== first) && (t !== attacker) && !struck.has(t.uuid)
      && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && within(first, t, grid.distance) && within(attacker, t, reachValue)
      && (total >= (t.actor.system.attributes?.ac?.value ?? Infinity)));
    if ( !candidates.length ) return;
    const formula = dieOf(activity);
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Balayage.Question", { item: item.name, formula, name: first.name }),
      options: [{ id: "no", label: loc("Balayage.Non") }, ...candidates.map(t => ({ id: t.uuid, label: t.name }))]
    });
    const victim = candidates.find(t => t.uuid === answer?.id);
    if ( !victim || !formula ) return;
    await payWithoutUse(activity);
    const type = resolution.damageRoll?.damages?.[0]?.type ?? Array.from(attack.item?.system?.damage?.base?.types ?? [])[0] ?? null;
    const roll = await new Roll(formula).evaluate();
    await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
      flavor: loc("Balayage.Carte", { item: item.name, name: victim.name, type: CONFIG.DND5E.damageTypes?.[type]?.label ?? type ?? "" }),
      flags: { [MODULE_ID]: { sweep: { item: item.uuid, target: victim.uuid, amount: roll.total, type } } } });
    await victim.actor.applyDamage([{ value: roll.total, type }]);
    log(`${item.name} : ${roll.total} dégâts (${type}) à ${victim.name}`);
    return;
  }
}

/** Chassé-croisé : les places échangées ; true si c'est fait. */
async function swapPlaces(item, self, other) {
  const grid = self.parent.grid;
  if ( !other || (other === self) || !within(self, other, grid.distance) ) { notice(self, loc("ChasseCroise.Loin", { item: item.name })); return false; }
  if ( combatantFor(self.actor) ) {
    const { spent, excluded } = historyCosts(self);
    if ( (movementCap(self) - spent - excluded) < (grid.distance - 1e-6) ) { notice(self, loc("ChasseCroise.Mouvement", { item: item.name })); return false; }
  }
  const at = t => { const p = t._source; return { x: p.x, y: p.y, elevation: p.elevation ?? 0, level: p.level ?? null }; };
  const from = at(self), to = at(other);
  const options = { constrainOptions: { ignoreWalls: true, ignoreTokens: true }, [MODULE_ID]: { cleared: true } };
  await other.move([{ ...from, snapped: true, action: "blink" }], options);
  await self.move([{ ...to, snapped: true }], options);
  log(`${item.name} : ${self.name} et ${other.name} échangent leurs places`);
  return true;
}

/** Chassé-croisé : le dé de l'activité, ajouté à la CA de l'auteur ou de l'autre. */
async function chosenAc(activity, rule, self, other) {
  const actor = activity.actor;
  if ( !activity.roll?.formula ) return;
  const roll = await new Roll(activity.roll.formula, activity.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: `${activity.item.name} : ${activity.roll.name || "CA"}` });
  const answer = (other?.actor && (other !== self)) ? await askChoice(actor, {
    actor: actor.uuid, item: activity.item.name, prompt: loc("ChasseCroise.Qui", { item: activity.item.name, n: roll.total }),
    options: [{ id: "self", label: self.name }, { id: "other", label: other.name }]
  }) : null;
  const recipient = (answer?.id === "other") ? other.actor : actor;
  const effect = await placeItemEffect(activity.item, rule.effect, recipient);
  if ( !effect ) return;
  await effect.update({ name: `${activity.item.name} (+${roll.total})`, "system.changes": [{ key: "system.attributes.ac.bonus", type: "add", value: String(roll.total) }] });
  log(`${activity.item.name} : +${roll.total} à la CA de ${recipient.name}`);
}

/** Frappe commandée : l'ordre noté dans le budget de la créature visée, le dé promis à ses dégâts. */
async function commandStrike(activity, actor, ally) {
  if ( !ally?.actor || (ally.actor === actor) ) return;
  const formula = dieOf(activity);
  const turn = currentTurnKey();
  const combatant = combatantFor(ally.actor);
  if ( combatant ) await writeBudget(combatant, { ...readBudget(combatant), commanded: { turn, by: actor.uuid } });
  if ( formula ) await ally.actor.setFlag(MODULE_ID, FLAG, { item: activity.item.uuid, name: activity.item.name, formula, against: "any", target: null, turn });
  await ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("FrappeCommandee.Carte", { item: activity.item.name, name: ally.name, formula: formula ?? "" })}</p>`,
    flags: { [MODULE_ID]: { commandStrike: { item: activity.item.uuid, ally: ally.uuid } } } });
  notice(ally, loc("FrappeCommandee.Ordre", { item: activity.item.name }), "gain");
  log(`${activity.item.name} : ${ally.name} peut attaquer par sa Réaction (+${formula})`);
}

/** Sur le MJ actif : la carte d'utilisation d'une activité de Chassé-croisé ou de Frappe commandée. */
async function onUsageCard(message) {
  if ( message.type !== "usage" ) return;
  const activity = message.getAssociatedActivity?.();
  const entry = activity?.item ? contentOf(activity.item).entry : null;
  if ( !entry || !activity.actor ) return;
  const { scene, token } = message.speaker ?? {};
  const self = game.scenes.get(scene)?.tokens.get(token) ?? tokenOf(activity.actor);
  const other = fromUuidSync(message.system?.targets?.[0]?.token ?? "", { strict: false });
  if ( entry.commandStrike?.activity === activity.id ) await commandStrike(activity, activity.actor, other);
  const swapped = (entry.swapPlaces?.activity === activity.id) && self ? await swapPlaces(activity.item, self, other) : true;
  if ( swapped && (entry.rolledAc?.activity === activity.id) && (entry.rolledAc.to === "choose") && self ) await chosenAc(activity, entry.rolledAc, self, other);
}

export function registerManeuverDice() {
  route("createChatMessage", onUsageCard, { executor: true, label: "manœuvre : Chassé-croisé ou Frappe commandée non joués" });
  route("dnd5e.postUseActivity", onPostUse, { label: "manœuvre : dé promis ou CA non posés" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "manœuvre : dé promis" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "manœuvre : dé promis non éteint" });
}
