/**
 * Les messages du système devenus évènements d'une résolution : carte d'utilisation, jet d'attaque, jet de dégâts, sauvegarde,
 * Résistance légendaire. Extrait de runtime/engine.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { readAttackMessage, readDamageMessage } from "../adapter/messages.mjs";
import { readSaveMessage, repairSaveAbility } from "../adapter/saves.mjs";
import { resolveAttack } from "../core/attack.mjs";
import { offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { readUsage } from "../adapter/usage.mjs";
import { canResistSave, askLegendary, resistSave, legendaryLeft } from "../adapter/legendary.mjs";
import { offerInterpose, offerPeerlessAim } from "./feats.mjs";
import { contentOf } from "../adapter/content.mjs";
import { critMargin } from "../adapter/criticals.mjs";
import { log, loc, waitForDice } from "./shared.mjs";
import { LOOKBACK, castLevelOfMessage, dispatcher, enrich, openingFor, resolutionOn, serializeDamages, speakerTokenUuid } from "./engine.mjs";

/* -------------------------------------------- */
/*  Messages du système → évènements            */
/* -------------------------------------------- */

export function onUsageMessage(message) {
  // L'ouverture entre dans la file du porteur AVANT toute attente : un jet que le système enchaîne
  // aussitôt (dégâts d'une activité `damage`, soin) arrive après elle, dans l'ordre.
  return dispatcher.open(message.id, async () => {
    await repairSaveAbility(message);
    const usage = readUsage(message);
    if ( !usage ) return null;
    if ( usage.plan.variant ) log(`attack variant: ${usage.plan.variant.name || usage.plan.variant.kind} (${usage.plan.variant.kind})`);
    // §104 : un module qui fournit lui-même les cibles d'une activité à zone (Darsh Loot : la zone d'effet d'un piège) le dit
    // par `flags.dnd5e-combat.givenTargets` sur le message d'utilisation : pas de gabarit à attendre, les cibles du message.
    if ( usage.area && !message.getFlag(MODULE_ID, "areaTick") && !message.getFlag(MODULE_ID, "givenTargets") ) {
      log("area of effect: waiting for the template to be placed");
      return null;
    }
    return openingFor(message, usage);
  });
}

/**
 * §33 : Inspiration bardique — un jet d'attaque qui rate une cible (ni 1 naturel, ni abri total) : l'attaquant inspiré peut ajouter
 * son dé au total, avant le verdict. Rend le jet, éventuellement augmenté.
 */
async function inspiredAttack(message, roll, targets) {
  if ( roll.isFumble || roll.isCritical ) return roll;
  const missed = resolveAttack(roll, targets.filter(t => !t.unaffected)).filter(t => t.reason === "miss");
  if ( !missed.length ) return roll;
  const actor = (await fromUuid(speakerTokenUuid(message) ?? ""))?.actor ?? message.getAssociatedActor?.() ?? null;
  if ( !actor ) return roll;
  const needed = Math.min(...missed.map(t => t.ac));
  const bonus = await offerInspiration(actor, { what: loc("Inspiration.Attaque"), total: roll.total, needed });
  if ( bonus ) log(`${actor.name}: Bardic Inspiration, attack ${roll.total} + ${bonus} = ${roll.total + bonus}`);
  // §90 : Attaque précise — encore ratée, l'attaquant peut ajouter son propre dé (`rollBonus` sur "attack").
  const total = roll.total + bonus;
  const rules = actor.items.some(i => contentOf(i).entry?.rollBonus?.on?.includes("attack"));
  const precise = (rules && (total < needed)) ? await offerRollBonus(actor, { kind: "attack", what: loc("Inspiration.Attaque"), total, needed, d20: keptD20(message.rolls?.[0]) }) : 0;
  if ( precise ) log(`${actor.name}: die added to their attack, ${total} + ${precise} = ${total + precise}`);
  // §135 : Faveur de prouesse martiale, Visée sans pareille — encore ratée : « vous pouvez toucher à la place ».
  const peerless = ((total + precise) < needed) && await offerPeerlessAim(actor, { total: total + precise, needed }) ? needed - (total + precise) : 0;
  if ( !bonus && !precise && !peerless ) return roll;
  return { ...roll, total: total + precise + peerless, inspired: bonus + precise + peerless };
}

export async function onAttackMessage(message) {
  const attack = readAttackMessage(message);
  if ( !attack?.targets.length ) {   // sans cible désignée, le jet reste un jet simple
    log("attack without a designated target: plain roll, nothing to resolve");
    return;
  }
  await waitForDice(message);
  const rolled = async plan => {
    const targets = await enrich(attack.targets, plan, speakerTokenUuid(message), attack.activity, message.rolls?.[0]?.options?.attackMode ?? message.system?.mode ?? null,
      castLevelOfMessage(game.messages.get(message.system?.origin ?? "") ?? message));
    return { type: "attackRolled", roll: await inspiredAttack(message, attack.roll, targets), messageId: message.id, targets, critMargin: critMargin() };
  };
  // Le message d'utilisation attend ce jet : c'est lui le porteur.
  const awaited = attack.origin && await dispatcher.send(attack.origin, resolution =>
    ((resolution.step === STEPS.AWAITING_ATTACK) && (resolution.activity === attack.activity)) ? rolled(resolution.plan) : null);
  if ( awaited ) return;
  // Jet lancé hors carte, ou relancé depuis une carte déjà résolue : il se porte lui-même.
  await dispatcher.open(message.id, async () => {
    const usage = readUsage(message);
    if ( !usage?.plan.attack ) return null;
    return openingFor(message, { ...usage, origin: attack.origin, targets: [] }, { attack: await rolled(usage.plan) });
  });
}

/** Ces dégâts sont-ils ceux de la résolution : son activité, ou une variante que son plan admet (M5, §18.8) ? */
const damageFits = (resolution, damage) => (resolution.activity === damage.activity)
  || (resolution.plan?.damageFrom ?? []).includes(damage.activity);

/** Le porteur le plus récent qui attend encore les dégâts de cette activité. */
function findAwaitingDamage(damage) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - LOOKBACK); i-- ) {
    const resolution = resolutionOn(messages[i]);
    if ( (resolution?.step !== STEPS.AWAITING_ROLLS) || !resolution.plan.damage || resolution.damageRoll ) continue;
    if ( !damageFits(resolution, damage) ) continue;
    if ( resolution.origin && damage.origin && (resolution.origin !== damage.origin) ) continue;
    return messages[i];
  }
  return null;
}

/** Jet de dégâts ou de soin (même forme). */
export async function onDamageMessage(message) {
  const damage = readDamageMessage(message);
  if ( !damage ) return;
  await waitForDice(message);
  const event = { type: "damageRolled", messageId: message.id, damages: serializeDamages(damage.damages) };
  const accepts = resolution => damageFits(resolution, damage) ? event : null;
  if ( damage.origin && await dispatcher.send(damage.origin, accepts) ) return;
  const carrier = findAwaitingDamage(damage);
  if ( carrier && await dispatcher.send(carrier.id, accepts) ) return;
  log("damage with no pending resolution: left to the system's tray");
}

/** Le porteur auquel se rapporte un jet de sauvegarde. */
function carrierOfSave(save) {
  if ( save.request ) return game.messages.get(save.request)?.getFlag(MODULE_ID, "requestFor") ?? null;
  return save.origin;
}

export async function onSaveMessage(message) {
  const save = readSaveMessage(message);
  const carrierId = save?.actor ? carrierOfSave(save) : null;
  const carrier = game.messages.get(carrierId);
  const resolution = resolutionOn(carrier);
  if ( !resolution ) return;   // sauvegarde libre, hors de toute résolution
  await waitForDice(message);
  const dc = resolution.plan?.save?.dc;
  const failed = Number.isFinite(dc) && (save.total < dc);
  // Une intention peut imposer le choix (`legendary: "always" | "never"` sur l'utilisation : scénarios, macros), comme `saveChoice`.
  const forced = game.messages.get(resolution.origin ?? carrierId)?.getFlag(MODULE_ID, "legendary") ?? carrier.getFlag(MODULE_ID, "legendary");
  const resisted = failed ? await legendaryResistance(message, { dc, item: carrier.getAssociatedActivity?.()?.item?.name, forced }) : false;
  // §33 : Inspiration bardique — une sauvegarde ratée : la créature inspirée peut ajouter son dé.
  let total = save.total;
  if ( failed && !resisted ) {
    const actor = await fromUuid(save.actor);
    const bonus = actor ? await offerInspiration(actor, { what: loc("Inspiration.Sauvegarde"), total, needed: dc }) : 0;
    if ( bonus ) { log(`${actor.name}: Bardic Inspiration, saving throw ${total} + ${bonus} = ${total + bonus}`); total += bonus; }
    // §38 : Chance du ténébreux — encore ratée, la créature peut ajouter son propre dé (`rollBonus`).
    const luck = (actor && (total < dc)) ? await offerRollBonus(actor, { kind: "save", what: loc("Inspiration.Sauvegarde"), total, needed: dc, statuses: saveStatuses(carrier, resolution), d20: keptD20(message.rolls?.[0]), ability: resolution.plan?.save?.ability ?? null }) : 0;
    if ( luck ) { log(`${actor.name}: die added to their saving throw, ${total} + ${luck} = ${total + luck}`); total += luck; }
  }
  // §133 : Maître des boucliers, Interposer le bouclier — une sauvegarde de Dextérité réussie contre des dégâts réduits de moitié : la
  // Réaction pour n'en subir aucun.
  const plan = resolution.plan ?? {};
  const halfDex = !!plan.damage && !!plan.save && !plan.save.chained && (plan.save.ability === "dex") && ((plan.save.onSave ?? "half") === "half");
  const interposed = (halfDex && Number.isFinite(dc) && (total >= dc)) ? await offerInterpose(await fromUuid(save.actor)) : false;
  await dispatcher.send(carrierId, { type: "saveRolled", actor: save.actor, total, messageId: message.id, ...(save.mode ? { mode: save.mode } : {}), ...(resisted ? { resisted: true } : {}),
    ...(interposed ? { interposed: true } : {}) });
}

/**
 * §94 : les états qu'une sauvegarde évite (ceux des effets de l'activité) ou fait finir (l'effet d'une sauvegarde répétée) — Survivant,
 * « pour éviter ou mettre fin à l'état Charmé ou Effrayé ».
 */
function saveStatuses(carrier, resolution) {
  const out = new Set();
  const item = carrier?.getAssociatedActivity?.()?.item;
  for ( const e of resolution?.plan?.effects ?? [] ) for ( const s of item?.effects?.get(e?.id ?? e)?.statuses ?? [] ) out.add(s);
  const resave = carrier?.getFlag?.(MODULE_ID, "resave")?.effect;
  for ( const s of (resave ? fromUuidSync(resave, { strict: false })?.statuses : null) ?? [] ) out.add(s);
  return Array.from(out);
}

/**
 * §18.9 : un PNJ qui rate une sauvegarde peut dépenser une Résistance légendaire (réglage : demander, toujours, jamais).
 * La dépense passe par le système (`resistSave`) ; la résolution compte la sauvegarde réussie.
 */
async function legendaryResistance(message, { dc, item, forced=null }) {
  const mode = forced ?? game.settings.get(MODULE_ID, "legendaryResistance");
  if ( (mode === "never") || !canResistSave(message) ) return false;
  const actor = message.getAssociatedActor();
  const total = message.rolls?.[0]?.total;
  if ( (mode !== "always") && !(await askLegendary(actor, { total, dc, item })) ) {
    log(`${actor.name}: Legendary Resistance not used (${total} vs DC ${dc})`);
    return false;
  }
  await resistSave(message);
  log(`${actor.name}: Legendary Resistance — failed saving throw (${total} vs DC ${dc}) turned into a success, ${legendaryLeft(actor)} left`);
  return true;
}
