/**
 * Sorts de châtiment du Paladin (SPEC §25).
 *
 *  - Sur le client de l'auteur, au jet de dégâts d'un coup au corps à corps (adapter/messages.mjs, `rollDamageForAttack`) : la
 *    question (un bouton par sort et niveau possibles), l'emplacement ou l'utilisation gratuite dépensés (adapter/smite.mjs) ; puis
 *    ici (`dnd5e.preRollDamageV2`), les dés du sort ajoutés au jet, de son type — le critique les double comme les autres. Le jet
 *    porte `flags["dnd5e-combat"].smite`.
 *  - Sur le MJ actif, une fois l'attaque résolue (`dnd5e-combat.resolution`) : l'action Bonus dépensée, et la sauvegarde du sort
 *    (Tonitruant, Courroucé, Aveuglant, Étourdissant, Bannisseur) jouée sur la cible encore debout (adapter/areas.mjs,
 *    `strikeAgainst`).
 *    §42.2 : l'effet du sort posé sans sauvegarde sur la cible touchée (`smite.effect` : brûlure du Châtiment de fournaise,
 *    aveuglement du Châtiment de cécité), dont le contenu déclare la suite (dégâts au début du tour, sauvegarde répétée).
 * Limite : la concentration des châtiments qui en demandent une et la lueur du Châtiment lumineux restent au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween } from "../adapter/turn.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, waitForDice } from "./shared.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { rangedWeaponHit, smiteOptions, spendSmite } from "../adapter/smite.mjs";
import { requestSave } from "./neighbours.mjs";

function onPreRollDamage(config, dialog, message) {
  const smite = config[MODULE_ID]?.smite;
  const activity = config.subject;
  if ( !smite || !activity || !config.rolls?.length ) return true;
  const type = smite.type;
  if ( !smite.formula ) {   // §31 : une faveur sans dés (Renversement des coteaux) — seulement notée sur le jet
    foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
    return true;
  }
  // §288 : « au lieu de subir les dégâts et les autres effets de l'attaque » (Flèche de foudre) — les dés de l'arme partent.
  if ( smite.replaces ) config.rolls.splice(0, config.rolls.length);
  config.rolls.push({ data: activity.getRollData(), parts: [smite.formula], options: { type, types: type ? [type] : [], properties: [] } });
  foundry.utils.setProperty(message, `data.flags.${MODULE_ID}.smite`, smite);
  log(`${smite.name}${smite.level ? ` (level ${smite.level})` : ""}: +${smite.formula} ${type ?? ""}`);
  return true;
}

const seen = new Set();

/**
 * §273 : ce qu'un châtiment déclenche chez son auteur (`afterSmite`) — un item de la fiche pose l'un de ses effets sur lui quand l'un des
 * châtiments nommés touche (Châtiment de protection : « chaque fois que vous lancez Châtiment divin », l'effet qui allume son aura).
 */
async function afterSmite(actor, smiteItem) {
  const smiteId = identifierOf(smiteItem).id;
  for ( const own of actor.items ) {
    const rule = contentOf(own).entry?.afterSmite;
    if ( !rule || (rule.smites && !rule.smites.includes(smiteId)) ) continue;
    const placed = await placeItemEffect(own, rule.effect, actor);
    if ( placed ) log(`${own.name}: after ${smiteItem.name}, "${placed.name}" on ${actor.name}`);
  }
}

/**
 * §288 : les dés d'une activité de l'item au niveau lancé, lancés dans le chat (Dice So Nice attendu). `{ total, type }`, ou null.
 */
async function rollActivityDice(item, activityId, level, flavor, speaker) {
  const part = item.system.activities?.get(activityId)?.damage?.parts?.[0];
  if ( !part?.number || !part.denomination ) return null;
  const n = part.number + (Math.max(0, level - (Number(item.system.level) || 1)) * (Number(part.scaling?.number) || 0));
  const type = Array.from(part.types ?? [])[0] ?? null;
  const roll = await new CONFIG.Dice.DamageRoll(`${n}d${part.denomination}`, item.getRollData?.() ?? {}, { type, types: type ? [type] : [] }).evaluate();
  const message = await roll.toMessage({ speaker, flavor });
  await waitForDice(message);
  return { total: roll.total, type };
}

/**
 * §288 : Flèche de foudre — « chaque créature située dans un rayon de 3 m de la cible effectue ensuite un jet de sauvegarde de
 * Dextérité et subit 2d8 dégâts de foudre en cas d'échec, la moitié en cas de réussite » : un jet de dégâts pour toutes, la sauvegarde
 * de chacune (`requestSave`, DD du sort), les dégâts appliqués (résistances de dnd5e), un texte flottant et une carte. MJ actif.
 */
async function blastAround(item, level, target) {
  const rule = contentOf(item).entry?.smite;
  const blast = rule?.blast;
  if ( !blast || !target?.parent ) return 0;
  const radius = lengthIn(blast.radius, blast.units, target.parent.grid.units);
  const caught = target.parent.tokens.filter(o => (o !== target) && o.actor && !o.hidden && ((o.actor.system.attributes?.hp?.value ?? 0) > 0)
    && (o._source.level === target._source.level) && (distanceBetween(target, o).value <= radius + 1e-6));
  if ( !caught.length ) { log(`${item.name}: nobody within ${blast.radius} ${blast.units} of ${target.name}`); return 0; }
  const speaker = ChatMessage.implementation.getSpeaker({ actor: item.actor });
  const dice = await rollActivityDice(item, blast.activity, level, loc("FlecheFoudre.Eclat", { item: item.name, name: target.name }), speaker);
  if ( !dice ) return 0;
  const dc = Number(item.system.activities?.get(rule.damage)?.save?.dc?.value ?? item.actor?.system.attributes?.spell?.dc) || null;
  const lines = [];
  for ( const other of caught ) {
    const save = await requestSave(other.actor, { ability: blast.ability, dc, flavor: loc("FlecheFoudre.Sauvegarde", { item: item.name, name: other.name }) });
    const amount = save?.success ? Math.floor(dice.total / 2) : dice.total;
    await other.actor.applyDamage([{ value: amount, type: dice.type }]);
    notice(other, { key: "FlecheFoudre.Touche", data: { amount } }, "refused", { all: true });
    lines.push(locEsc(save?.success ? "FlecheFoudre.Reussie" : "FlecheFoudre.Ratee", { name: other.name, total: save?.total ?? "?", dc: dc ?? "?", amount }));
    log(`${item.name}: ${other.name} ${save?.success ? "saves" : "fails"} (${save?.total} vs DC ${dc}), ${amount} ${dice.type}`);
  }
  await say(speaker, [locEsc("FlecheFoudre.Carte", { item: item.name, name: target.name }), ...lines], { lightningBlast: { item: item.name, target: target.uuid, caught: caught.map(t => t.uuid) } });
  return caught.length;
}

/**
 * §288 : Flèche de foudre sur un tir RATÉ — « au moment où votre attaque touche ou rate la cible » : la question à l'auteur (chez son
 * joueur), l'emplacement et l'action Bonus dépensés, la moitié des 4d8 sur la cible, puis l'éclat. Un tir touché passe par la question
 * des châtiments, au jet de dégâts (adapter/smite.mjs). MJ actif.
 */
async function onMissed(resolution) {
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const actor = activity?.actor;
  const attack = game.messages.get(resolution.attack?.messageId ?? "");
  if ( !actor || !rangedWeaponHit(activity, attack?.system?.mode) || ((resolution.targets ?? []).length !== 1) ) return;
  const target = fromUuidSync(resolution.targets[0].token ?? "", { strict: false });
  if ( !target?.actor ) return;
  const options = smiteOptions(actor, { ranged: true }).filter(o => o.rule.onMiss === "half");
  if ( !options.length ) return;
  const answer = await askChoice(actor, { actor: actor.uuid, item: options[0].item.name, prompt: loc("FlecheFoudre.Question", { name: target.name }),
    options: [...options.map((o, i) => ({ id: `o${i}`, label: o.label })), { id: "none", label: loc("Chatiment.Aucun") }] });
  const option = options[Number(String(answer?.id ?? "").replace("o", ""))];
  if ( !answer?.id?.startsWith?.("o") || !option ) return;
  await spendSmite(actor, option);
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget ) await writeBudget(combatant, { ...budget, bonus: Math.max(0, (budget.bonus ?? 1) - 1) });
  const speaker = ChatMessage.implementation.getSpeaker({ actor });
  const dice = await rollActivityDice(option.item, option.rule.damage, option.level, loc("FlecheFoudre.Rate", { item: option.item.name, name: target.name }), speaker);
  if ( dice ) {
    const amount = Math.floor(dice.total / 2);
    await target.actor.applyDamage([{ value: amount, type: dice.type }]);
    notice(target, { key: "FlecheFoudre.Touche", data: { amount } }, "refused", { all: true });
    log(`${option.item.name}: missed, ${target.name} takes half (${amount} ${dice.type})`);
  }
  await blastAround(option.item, option.level, target);
}

async function onResolution(resolution) {
  if ( (resolution?.step === STEPS.MISSED) && resolution.plan?.attack && !seen.has(resolution.id) ) {
    seen.add(resolution.id);
    return onMissed(resolution);
  }
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const damage = game.messages.get(resolution.damageRoll?.messageId ?? "");
  const smite = damage?.getFlag(MODULE_ID, "smite");
  if ( !smite ) return;
  seen.add(resolution.id);
  const item = fromUuidSync(smite.item, { strict: false });
  const actor = item?.actor;
  if ( !actor ) return;
  if ( smite.kind === "rider" ) return applyRider(smite, item, resolution);
  // « Action Bonus, que vous prenez immédiatement après avoir touché ».
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  if ( budget ) await writeBudget(combatant, { ...budget, bonus: Math.max(0, (budget.bonus ?? 1) - 1) });
  if ( (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true)) ) await afterSmite(actor, item);
  // §288 : l'éclat de Flèche de foudre, la cible touchée (même tombée).
  if ( smite.blast ) {
    const struck = fromUuidSync(smite.target, { strict: false });
    if ( struck ) await blastAround(item, smite.level ?? Number(item.system.level), struck);
  }
  if ( !smite.save && !smite.effect ) return;
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit ) return;
  // §176 : une cible tombée à 0 PV sous le coup ne subit ni l'effet ni la sauvegarde ; l'éclat (Grêle d'épines) touche pourtant
  // ses voisines — « la cible et chaque créature à 1,50 m d'elle ».
  const burst = contentOf(item).entry?.smite?.burst;
  const down = (target.actor.system.attributes?.hp?.value ?? 0) <= 0;
  if ( down ) log(`${smite.name}: ${target.name} is at 0 Hit Points, no effect and no saving throw`);
  if ( down && !burst ) return;
  // §42.2 : l'effet que le sort pose en touchant, sans sauvegarde (« Seared », « Blinded »), au niveau lancé.
  if ( smite.effect && !down ) await placeItemEffect(item, smite.effect, target.actor, { scaling: smite.scaling ?? 0 });
  if ( !smite.save ) return;
  const save = item.system.activities?.get(smite.save);
  if ( !save ) return;
  const source = actor.getActiveTokens(false, true)[0] ?? null;
  if ( !source ) return;
  // §262 : « si l'attaque réduit la cible à 50 points de vie ou moins » (Châtiment bannissant).
  const ceiling = contentOf(item).entry?.smite?.saveAtMostHp;
  const hp = target.actor.system.attributes?.hp?.value ?? 0;
  if ( !down && ceiling && (hp > ceiling) ) { log(`${smite.name}: ${target.name} still has ${hp} HP (> ${ceiling}), no saving throw`); return; }
  if ( !down ) {
    log(`${smite.name}: ${target.name} makes their saving throw`);
    await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte" });
  }
  // §164 : « la cible et chaque créature à 1,50 m d'elle » (Grêle d'épines).
  if ( !burst ) return;
  let radius = lengthIn(burst.radius, burst.units, target.parent.grid.units);
  for ( const other of target.parent.tokens ) {
    if ( (other === target) || !other.actor || other.hidden || ((other.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    if ( distanceBetween(target, other).value > radius + 1e-6 ) continue;
    log(`${smite.name}: ${other.name}, within ${burst.radius} ${burst.units} of ${target.name}, makes their saving throw`);
    await strikeAgainst(save, source, other, { flavor: "DND5ECOMBAT.Chatiment.Carte" });
  }
}

/**
 * §31 : après le coup, ce que la faveur pose sur la cible encore debout : l'effet de l'item (Froid mordant : Vitesse −3 m jusqu'au
 * début du prochain tour du goliath — contenu `effectEnds`), ou un état (Renversement des coteaux : À terre).
 */
async function applyRider(smite, item, resolution) {
  const target = fromUuidSync(smite.target, { strict: false });
  const hit = (resolution.targets ?? []).some(t => (t.token === smite.target) && (t.hit === true));
  if ( !target?.actor || !hit || ((target.actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  if ( smite.effect ) {
    const source = item.effects.get(smite.effect);
    if ( source ) {
      const data = foundry.utils.mergeObject(source.toObject(), { origin: item.uuid, transfer: false, disabled: false }, { inplace: false });
      delete data._id;
      await target.actor.createEmbeddedDocuments("ActiveEffect", [data]);
      log(`${smite.name}: "${source.name}" placed on ${target.name}`);
    }
  }
  if ( smite.status ) {
    await target.actor.toggleStatusEffect(smite.status, { active: true });
    log(`${smite.name}: ${target.name} receives "${smite.status}"`);
  }
  // §129 : la poussée de la faveur (Bagarreur de tavernes : 1,50 m), depuis l'auteur.
  if ( smite.push ) {
    const source = item.actor?.getActiveTokens(false, true)[0] ?? null;
    if ( source ) {
      const { cells, wanted } = await pushAway(source, target, smite.push, readUnitFactors());
      log(`${smite.name}: ${target.name} pushed ${cells} square(s) out of ${wanted}`);
    }
  }
  // §78 : la sauvegarde de la faveur (Piqué : Force ou À terre), jouée sur la cible encore debout.
  const save = smite.save ? item.system.activities?.get(smite.save) : null;
  const source = save ? (item.actor?.getActiveTokens(false, true)[0] ?? null) : null;
  if ( save && source && ((target.actor.system.attributes?.hp?.value ?? 0) > 0) ) {
    log(`${smite.name}: ${target.name} makes their saving throw`);
    await strikeAgainst(save, source, target, { flavor: "DND5ECOMBAT.Chatiment.Carte" });
  }
}

export function registerSmite() {
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "smite" });
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`smite:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "smite: saving throw not played" });
}
