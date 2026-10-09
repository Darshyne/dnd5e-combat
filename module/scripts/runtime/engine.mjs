/**
 * Le moteur : il traduit ce qui se passe dans Foundry en ÉVÈNEMENTS pour la machine d'action
 * (core/action.mjs), et exécute les COMMANDES qu'elle rend. Aucune règle ici : le cœur décide,
 * les adaptateurs lisent et écrivent, le répartiteur (runtime/dispatcher.mjs) tient l'ordre.
 *
 * Le PORTEUR d'une résolution est le message d'utilisation de l'activité. Un jet d'attaque lancé
 * hors carte (ou relancé depuis une carte déjà résolue) n'en a pas : le message d'attaque est
 * alors son propre porteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { current, undoPlan, wantsDamageRoll, isCriticalHit, pendingChoice, pendingAllocation, STEPS } from "../core/action.mjs";
import { selectAreaTargets, openArea, turnKeyOf, actsOnPose } from "../core/area.mjs";
import { isAutoCritical, autoFailSave } from "../core/conditions.mjs";
import { unaffectedBy } from "../adapter/eligibility.mjs";
import { retaliationsFor, retaliate, inflict, saveRetaliation } from "../adapter/retaliation.mjs";
import { readAttackMessage, readDamageMessage, applyDamageToToken, restoreHp, maximizedHealing, rollDamageFor } from "../adapter/messages.mjs";
import {
  readSaveMessage, readActivityRegion, requestSaves, applyEffectsToToken, applyStatusToToken, applyMarkToToken, splitPushes, removeEffects,
  repairSaveAbility, showTargetsTo, TARGETS_QUERY, handleTargetsQuery, SAVE_QUERY, handleSaveQuery
} from "../adapter/saves.mjs";
import { holds } from "../core/triggers.mjs";
import { resolveAttack } from "../core/attack.mjs";
import { offerInspiration, offerRollBonus } from "../adapter/inspiration.mjs";
import { factsFor } from "../adapter/facts.mjs";
import { readUsage } from "../adapter/usage.mjs";
import { canResistSave, askLegendary, resistSave, legendaryLeft } from "../adapter/legendary.mjs";
import { concentrationEffectOf, tieRegionToConcentration } from "../adapter/concentration.mjs";
import { areaRulesOf, isInstantaneous, writeAreaState, markTransient, shrinkToBolt, removeTransientRegions } from "../adapter/areas.mjs";
import { statusesOf, areAdjacent, evades } from "../adapter/conditions.mjs";
import { currentAc } from "../adapter/reactions.mjs";
import { askChoice, CHOICE_QUERY, handleChoiceQuery } from "../adapter/choices.mjs";
import { askAllocation, ALLOCATION_QUERY, handleAllocationQuery } from "../adapter/projectiles.mjs";
import { coverFor, canJudgeCover, isCoverAvailable } from "../adapter/cover.mjs";
import { ensureRegionElevation } from "../adapter/space.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { dodge as takeDodge } from "../core/turn.mjs";
import { tallyAfter } from "../core/tally.mjs";
import { createDispatcher } from "./dispatcher.mjs";
import { askHitReactions, canReactToHit, windowIsDamaged, windowIsMissed, askDamageGuardians } from "./reactions.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { stormOf, isBoltRegion } from "../adapter/storm.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { duplicatesAgainst, duplicateEffectsOf } from "../adapter/duplicates.mjs";
import { log, loc, isExecutor, waitForDice, whenCanvasReady, notice } from "./shared.mjs";
import { waitForAnimations } from "./animations.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";

/** Combien de messages récents on remonte quand un jet ne dit pas à quelle action il se rapporte. */
const LOOKBACK = 50;

/** La résolution d'un porteur, y compris celle pas encore écrite (écritures regroupées, runtime/dispatcher.mjs). */
const resolutionOn = message => message ? current(dispatcher.peek(message.id)) : null;

/** Réglage « journal de chat allégé » : écritures de la résolution regroupées (ici) et cartes hors écran non dessinées (ui/chat.mjs). */
export const CHAT_LIGHT_SETTING = "chatLight";

/** Le token qui parle dans un message, ou null. */
function speakerToken(message) {
  const { scene, token } = message?.speaker ?? {};
  return scene && token ? `Scene.${scene}.Token.${token}` : null;
}

/** Les propriétés de dégâts sont un Set côté système, un tableau dans un flag. */
const serializeDamages = damages => damages.map(d => ({ ...d, properties: Array.from(d.properties ?? []) }));
/** La créature porte-t-elle un effet d'un item `healMax` (Lueur d'espoir) — effet posé ou transféré ? */
function healsMax(actor) {
  for ( const effect of actor?.appliedEffects ?? [] ) {
    const item = originItemOf(effect);
    if ( item && (contentOf(item).entry?.healMax === true) ) return true;
  }
  return false;
}

/**
 * §19.9 : Retour à la vie (Domaine de la Tombe) — les dés de soin d'un sort ou d'une Conduit divin valent leur maximum quand la
 * créature soignée est à 0 PV. Le soigneur porte un item `healsDownedMax`, la cible est à 0 PV.
 */
function healsDownedToMax(healer, activity, target) {
  if ( !healer || !activity?.item ) return false;
  const kind = isSpellCast(activity.item) || identifierOf(activity.item).id?.startsWith("channel-divinity");
  if ( !kind ) return false;
  // §27 : Guérison suprême — le maximum de chaque dé, quelle que soit la créature soignée.
  if ( healer.items.some(i => contentOf(i).entry?.supremeHealing === true) ) return true;
  return ((target?.system?.attributes?.hp?.value ?? 1) <= 0) && healer.items.some(i => contentOf(i).entry?.healsDownedMax === true);
}

/**
 * §27 : Disciple de la Vie et Guérisseur béni — « un sort lancé par un emplacement qui restitue des points de vie » : 2 + le
 * niveau de l'emplacement (l'activité est celle du sort au niveau lancé). Rend { disciple, healer } (0 si le soigneur n'a pas
 * l'aptitude), ou null hors de ce cas.
 */
function slotHealBonus(healer, activity) {
  const item = activity?.item;
  const level = Number(item?.system?.level) || 0;
  if ( !healer || (item?.type !== "spell") || (level < 1) || !["spell", "pact", undefined, ""].includes(item.system.method) ) return null;
  const has = key => healer.items.some(i => contentOf(i).entry?.[key] === true);
  const bonus = { disciple: has("discipleOfLife") ? 2 + level : 0, healer: has("blessedHealer") ? 2 + level : 0 };
  return (bonus.disciple || bonus.healer) ? bonus : null;
}

const deserializeDamages = damages => damages.map(d => ({ ...d, properties: new Set(d.properties ?? []) }));

/* -------------------------------------------- */
/*  Commandes de la machine d'action            */
/* -------------------------------------------- */

/**
 * §37 : la créature prend l'action Esquiver (Malédiction, « Cursed Actions » : « doit réussir un jet de sauvegarde de Sagesse au
 * début de chacun de ses tours, ou être forcée de prendre l'action Esquiver ») — son action du tour dépensée, l'état Esquive
 * posé (runtime/conditions.mjs le montre sur le token). Hors combat, rien.
 */
async function forceDodge(tokenUuid) {
  const token = await fromUuid(tokenUuid);
  const combatant = token?.actor ? combatantFor(token.actor) : null;
  if ( !combatant ) return;
  const before = readBudget(combatant);
  const after = takeDodge(before);
  if ( after === before ) { log(`${token.name}: Dodge forced, but the turn's action is already used`); return; }
  await writeBudget(combatant, after);
  log(`${token.name}: saving throw failed, Dodge action forced`);
}

/** L'outil de scénario `autoReact` de l'utilisation (« none » : personne ne réagit ; « first » : la première, sans fenêtre). */
const autoReactOf = (carrier, resolution) =>
  game.messages.get(resolution?.origin ?? carrier.id)?.getFlag(MODULE_ID, "autoReact") ?? carrier.getFlag(MODULE_ID, "autoReact") ?? null;

const COMMANDS = {
  askReactions: (command, carrier, resolution) => askHitReactions(resolution, command.tokens, id => dispatcher.drained(id), {
    auto: autoReactOf(carrier, resolution)
  }),

  /**
   * Image miroir (§16.25) : un d6 par réplique, lancé par le moteur, visible de tous ; une réplique touchée est détruite
   * (son effet retiré — la dernière retirée met fin au sort).
   */
  async rollDuplicates(command, carrier, resolution) {
    const events = [];
    for ( const tokenUuid of command.tokens ) {
      const token = await fromUuid(tokenUuid);
      const effects = duplicateEffectsOf(token?.actor);
      if ( !effects.length ) { events.push({ type: "duplicatesRolled", token: tokenUuid, dice: [] }); continue; }
      const roll = await new Roll(`${effects.length}d6`).evaluate();
      const dice = roll.dice.flatMap(d => d.results.map(r => r.result));
      const taken = dice.some(d => d >= 3);
      const message = await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ token }),
        flavor: loc(taken ? "Repliques.Touchee" : "Repliques.Ratee", { name: token.name, count: effects.length })
      });
      await waitForDice(message);
      if ( taken ) await effects.at(-1).delete();
      log(`${token.name}: duplicates ${dice.join(", ")} → ${taken ? `a duplicate takes the hit (${effects.length - 1} left)` : "the hit lands"}`);
      events.push({ type: "duplicatesRolled", token: tokenUuid, dice, messageId: message?.id ?? null });
    }
    return events;
  },

  /** §16.27 : l'auteur répartit ses projectiles (Projectile magique) ; sans réponse, le cœur répartit au mieux. */
  async askAllocation(command, carrier, resolution) {
    const actor = await fromUuid(resolution.source ?? "");
    const activity = carrier.getAssociatedActivity?.();
    log(`${activity?.item?.name ?? "projectiles"}: ${command.count} projectile(s) to split among ${command.targets.map(t => t.name).join(", ")}`);
    const answer = actor ? await askAllocation(actor, { item: activity?.item?.name ?? "", count: command.count, targets: command.targets }) : null;
    return [{ type: "allocated", counts: answer?.counts ?? {} }];
  },

  async requestSaves(command, carrier, resolution) {
    const { save } = resolution.plan;
    log(`${(save.abilities ?? [save.ability]).join("/")} saving throw DC ${save.dc} requested from`, command.targets.map(t => t.name).join(", "));
    // Plusieurs caractéristiques au choix de la cible : le joueur choisit ; pour le MJ, selon le réglage.
    // Une intention peut l'imposer (`saveChoice: "best"` sur la carte : scénarios, sans clic).
    const forced = game.messages.get(resolution.origin ?? carrier.id)?.getFlag(MODULE_ID, "saveChoice") ?? carrier.getFlag(MODULE_ID, "saveChoice");
    const ask = forced !== "best";
    await requestSaves(carrier, save, command.targets,
      { askPlayers: ask, askGM: ask && (game.settings.get(MODULE_ID, "npcSaveChoice") === "ask"), auto: autoReactOf(carrier, resolution) });
  },

  async apply(command, carrier, resolution) {
    const damageMessage = game.messages.get(resolution.damageRoll?.messageId);
    const activity = carrier.getAssociatedActivity?.({ scaled: true }) ?? null;
    const source = await fromUuid(speakerToken(carrier) ?? "");
    // §112 : les PV tombent quand l'animation (BLFX, par Sequencer) arrive, pas à son départ.
    await waitForAnimations([source?.uuid, ...command.entries.map(e => e.token)]);
    const resave = carrier.getFlag(MODULE_ID, "resave");
    const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? null;
    const entries = [];
    const extra = [];
    const slotHeal = resolution.plan.heal ? slotHealBonus(source?.actor ?? activity?.actor, activity) : null;
    let healedOther = false;
    for ( const entry of command.entries ) {
      // Riposte (§16.9) : jugée au moment du coup, avant ses dégâts (« tant que vous avez ces PV temporaires »).
      const struck = resolution.plan.attack ? await fromUuid(entry.token) : null;
      const retaliations = struck ? retaliationsFor({ bearerToken: struck, attackerToken: source, activity, attackMode }) : [];
      // §16.24 : une cible sous Lueur d'espoir (`healMax`) regagne le maximum du soin.
      const patient = (await fromUuid(entry.token))?.actor;
      const healed = (resolution.plan.heal && (entry.multiplier > 0)
        && (healsMax(patient) || healsDownedToMax(source?.actor ?? activity?.actor, activity, patient)))
        ? await maximizedHealing(damageMessage) : null;
      if ( healed ) log(`maximum healing for ${entry.token} (${healed.map(d => d.value).join(" + ")})`);
      // Rien à lire sans jet (sauvegarde ou effet seuls : `multiplier` 0, pas de `damageRoll`).
      let rolled = (entry.multiplier > 0) ? (healed ?? deserializeDamages(resolution.damageRoll?.damages ?? [])) : [];
      // §27 : Disciple de la Vie — des PV de plus au soin d'un sort lancé par un emplacement.
      if ( slotHeal?.disciple && (entry.multiplier > 0) && rolled.some(d => d.type === "healing") ) {
        rolled = [...rolled, { type: "healing", value: slotHeal.disciple, properties: new Set() }];
        log(`Disciple of Life: +${slotHeal.disciple} HP for ${entry.token}`);
      }
      if ( resolution.plan.heal && (entry.multiplier > 0) && patient && (patient !== (source?.actor ?? activity?.actor)) ) healedOther = true;
      // §38 : Égide projetée — avant l'application, un allié peut faire absorber ces dégâts par sa réserve.
      const hurting = (entry.multiplier > 0) && !resolution.plan.heal && rolled.some(d => !["healing", "temphp"].includes(d.type) && (d.value > 0));
      const ward = hurting ? await askDamageGuardians(entry.token, source?.uuid ?? null, activity, { auto: autoReactOf(carrier, resolution) }) : null;
      if ( ward?.item ) log(`${ward.reactor}: Projected Ward, their Arcane Ward takes ${entry.token}'s damage`);
      // §78 : Interposition — les dégâts passent sur le réacteur ; les effets restent à la cible.
      if ( ward?.interpose ) log(`${ward.reactor} interposes: takes ${entry.token}'s damage`);
      const hp = (entry.multiplier > 0)
        ? await applyDamageToToken(ward?.interpose ?? entry.token, rolled, damageMessage, { multiplier: entry.multiplier, reduction: entry.reduction ?? 0, absorbInto: ward?.item ?? null })
        : null;
      const target = await fromUuid(entry.token);
      // §16.46 : ce qu'une défense (Résistance) a retiré aux dégâts.
      for ( const s of hp?.shields ?? [] ) {
        log(`${target?.name ?? entry.token}: ${s.name} reduces the damage by ${s.reduced} (${s.formula ?? "1d4"} = ${s.rolled})`);
        if ( target ) notice(target, loc("Retour.Reduit", { item: s.name, n: s.reduced }), "gain");
      }
      // Un effet sous condition (M3, §18.4 : « si la cible est de taille G ou inférieure ») ne passe que si elle tient.
      const facts = factsFor({ source: source?.actor ?? null, target: target?.actor ?? null, activity, sourceToken: source, targetToken: target });
      const allowed = (entry.effects ?? []).filter(e => {
        if ( !e.if ) return true;
        const ok = holds((typeof e.if === "string") ? JSON.parse(e.if) : e.if, facts);
        if ( !ok ) log(`effect ${e.id}: condition not met for ${target?.name ?? entry.token}, not applied`);
        return ok;
      });
      // « Repoussé » (Bousculade) n'est pas un effet : c'est un déplacement subi, loin de l'auteur.
      const { effects: toApply, pushes } = await splitPushes(carrier, allowed);
      for ( const push of pushes ) await forcedMove(source, target, { mode: "push", ...push });
      const effects = await applyEffectsToToken(carrier, entry.token, toApply);
      if ( toApply.length > effects.length ) log(`${target?.name ?? entry.token}: ${toApply.length - effects.length} planned effect(s) not applied (${toApply.map(e => e.id).join(", ")})`);
      else if ( (entry.effects ?? []).length && !toApply.length && !pushes.length ) log(`${target?.name ?? entry.token}: no effect to apply (${(entry.effects ?? []).length} planned)`);
      // Étapes d'issue du contenu (SPEC §16) : poussée, traction, état — si leur condition tient pour cette cible.
      for ( const step of entry.steps ?? [] ) {
        const condition = (typeof step.if === "string") ? JSON.parse(step.if) : step.if;   // JSON dans le plan (adapter/usage.mjs)
        if ( !holds(condition, facts) ) {
          log(`${step.name ?? step.type}: condition not met for ${target?.name ?? entry.token}, step "${step.type}" skipped`);
          continue;
        }
        if ( step.type === "move" ) await forcedMove(source, target, step);
        else if ( step.type === "disarm" ) {
          // §19.6 : « l'ennemi lâche l'objet » — son arme de corps à corps équipée (la première), dés-équipée.
          const weapon = target?.actor?.items.find(i => (i.type === "weapon") && i.system.equipped
            && Array.from(i.system.activities ?? []).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
          if ( weapon ) {
            await weapon.update({ "system.equipped": false });
            notice(target, loc("Retour.Desarme", { item: weapon.name }), "ended");
            log(`${step.name ?? "disarm"}: ${target.name} drops ${weapon.name}`);
          }
        }
        else if ( step.type === "damage" ) {
          // §19 : dégâts d'issue (« si elle échoue au jet de sauvegarde, ou la moitié en cas de réussite »).
          const part = step.saved ? ((step.onSave === "half") ? 0.5 : 0) : 1;
          const logged = await inflict({
            step, item: activity?.item ?? null, multiplier: part, targetUuid: entry.token,
            speaker: ChatMessage.implementation.getSpeaker({ token: source ?? undefined }),
            flavor: loc("DegatsIssue", { item: step.name ?? activity?.item?.name ?? "", name: target?.name ?? "" }),
            flags: { outcomeDamage: { item: step.name ?? null, target: entry.token } }
          });
          if ( logged ) { extra.push({ ...logged, name: step.name }); log(`${step.name}: ${target?.name} takes ${step.formula} ${step.damageType}${part < 1 ? " (half)" : ""}`); }
        }
        else if ( step.type === "mark" ) {
          const uuid = await applyMarkToToken(carrier, entry.token, step, loc(step.label));
          if ( uuid ) { effects.push(uuid); log(`${step.name ?? "mark"}: ${target?.name} receives "${step.mark}"`); }
        }
        else if ( step.type === "breakConcentration" ) {
          // §91 : « sa Concentration est rompue » (Tremblement de terre).
          if ( target?.actor?.concentration?.effects?.size ) {
            await target.actor.endConcentration();
            log(`${step.name ?? "concentration"}: ${target.name}'s is broken`);
          }
        }
        else if ( step.type === "status" ) {
          const uuid = await applyStatusToToken(carrier, entry.token, step.status);
          if ( uuid ) { effects.push(uuid); log(`${step.name ?? "condition"}: ${target?.name} receives "${step.status}"`); }
        }
      }
      entries.push({ token: entry.token, actor: entry.actor, before: hp?.before ?? null, after: hp?.after ?? null, effects });
      for ( const r of retaliations ) {
        // §86 : une riposte par une sauvegarde de l'attaquant (Aura sacrée) — sa propre résolution, à part.
        if ( r.step.type === "save" ) {
          const asked = await saveRetaliation(r, { bearerToken: struck, attackerToken: source });
          if ( asked ) log(`${r.declaration.name}: ${source?.name} makes its saving throw for hitting ${struck.name}`);
          continue;
        }
        const logged = await retaliate(r, { bearerToken: struck, attackerToken: source });
        if ( logged ) { extra.push(logged); log(`${r.declaration.name}: ${source?.name} takes ${(logged.before.value + logged.before.temp) - (logged.after.value + logged.after.temp)} damage for hitting ${struck.name}`); }
      }
    }
    // §27 : Guérisseur béni — « aussitôt après avoir lancé par un emplacement un sort qui restitue des PV à une autre créature ».
    if ( slotHeal?.healer && healedOther && source?.uuid ) {
      const logged = await applyDamageToToken(source.uuid, [{ type: "healing", value: slotHeal.healer, properties: new Set() }], damageMessage);
      if ( logged ) { extra.push({ ...logged, name: "blessed-healer" }); log(`Blessed Healer: ${source.name} regains ${slotHeal.healer} HP`); }
    }
    // Sauvegarde répétée (brique « resave ») : réussie, l'effet tombe ; ratée, rien ne change — sauf les dégâts qu'elle
    // porte (§19.6, `onFail` : le saignement d'Épine).
    if ( resave?.effect ) {
      for ( const t of resolution.targets ) {
        // §43.1 : compteur — l'effet ne tombe qu'au seuil de réussites ; au seuil d'échecs, il reste et plus rien n'est rejoué.
        if ( resave.tally && t.save ) {
          const effect = await fromUuid(resave.effect);
          if ( !effect ) continue;
          const after = tallyAfter(effect.getFlag(MODULE_ID, "tally"), t.save.success === true, resave.tally);
          const said = loc("Compteur.Etat", { successes: after.successes, successesMax: resave.tally.successes, failures: after.failures, failuresMax: resave.tally.failures });
          if ( after.outcome === "ended" ) {
            log(`tally: ${t.name} reaches ${after.successes} success(es), "${effect.name}" removed`);
            notice(t.token, loc("Retour.FinEffet", { item: effect.name }), "ended");
            await effect.delete();
            continue;
          }
          const update = { [`flags.${MODULE_ID}.tally`]: { successes: after.successes, failures: after.failures, settled: after.settled } };
          if ( (after.outcome === "settled") && resave.tally.status ) update.statuses = [...new Set([...(effect.statuses ?? []), resave.tally.status])];
          await effect.update(update);
          log(`tally: ${t.name} — ${said}${after.settled ? `; settled, "${effect.name}" remains${resave.tally.status ? ` (${resave.tally.status})` : ""}` : ""}`);
          notice(t.token, after.settled ? loc("Compteur.Clos", { item: effect.name }) : said, after.settled ? "refused" : "prompt");
          continue;
        }
        if ( t.save?.success !== true ) {
          // §37 : Malédiction, « Cursed Actions » — ratée, la créature prend l'action Esquiver ce tour.
          if ( resave.dodge && t.save ) await forceDodge(t.token);
          if ( !resave.onFail || !t.save ) continue;
          const item = await fromUuid(resave.onFail.item ?? "");
          for ( const step of resave.onFail.steps ?? [] ) {
            const logged = await inflict({ step, item, scaling: resave.onFail.scaling ?? 0, targetUuid: t.token,
              speaker: ChatMessage.implementation.getSpeaker({ token: (await fromUuid(t.token)) ?? undefined }),
              flavor: loc("DegatsPorteur", { item: resave.onFail.name ?? item?.name ?? "", name: t.name }),
              flags: { bearerDamage: { item: resave.onFail.identifier ?? null, effect: resave.effect, moment: resave.moment } } });
            if ( logged ) { extra.push({ ...logged, name: resave.onFail.name }); log(`${resave.onFail.name}: saving throw failed, ${t.name} takes its damage`); }
          }
          continue;
        }
        if ( resave.keep ) { log(`repeated saving throw succeeded: ${t.name} keeps the effect (it does not end on a success)`); continue; }
        const effect = await fromUuid(resave.effect);
        if ( effect ) { await effect.delete(); log(`repeated saving throw succeeded: "${effect.name}" removed from ${t.name}`); }
      }
    }
    return [{ type: "applied", entries, extra }];
  },

  /** Effets exclusifs : l'auteur choisit (adapter/choices.mjs). Sans réponse, la résolution reste en attente et la question est reposée à `ready`. */
  async askChoice(command, carrier, resolution) {
    const actor = await fromUuid(resolution.source ?? "");
    const activity = await fromUuid(resolution.activity ?? "");
    const item = activity?.item?.name ?? "";
    if ( !actor ) return [];
    log(`${item}: ${actor.name} must choose an effect (${command.options.map(o => o.label).join(", ")})`);
    const answer = await askChoice(actor, { actor: actor.uuid, item, prompt: command.prompt, options: command.options });
    if ( !answer ) { log(`${item}: no effect chosen, waiting`); return []; }
    log(`${item}: ${actor.name} chooses ${command.options.find(o => o.id === answer.id)?.label ?? answer.id}`);
    return [{ type: "choiceMade", id: answer.id }];
  },

  /** L'essentiel redit là où on le lit : le verdict sous le jet d'attaque, les PV sous le jet de dégâts. */
  async echo(command, carrier, resolution) {
    if ( command.on === "attack" ) {
      log(`attack ${resolution.attack.roll.total} →`, resolution.targets.map(t =>
        `${t.name}: ${t.hit ? (t.critical ? "critical" : "hit") : "miss"}${t.reaction ? ` (${t.reaction})` : ""}`).join(", "));
      const attackMessage = game.messages.get(resolution.attack.messageId);
      if ( attackMessage && (attackMessage.id !== carrier.id) ) await attackMessage.setFlag(MODULE_ID, "verdict", { carrier: carrier.id });
      // §19.6 : fenêtre « raté » (Riposte, Désarmement) — pour chaque cible que l'attaque n'a pas touchée.
      const missed = resolution.targets.filter(t => (t.hit === false) && !t.unaffected).map(t => t.token);
      if ( missed.length ) windowIsMissed(missed, speakerToken(carrier), carrier.speaker?.alias ?? "",
        { activity: resolution.activity, auto: autoReactOf(carrier, resolution) });
      return;
    }
    const damageMessage = game.messages.get(resolution.damageRoll?.messageId);
    if ( !damageMessage || (damageMessage.id === carrier.id) ) return;
    await damageMessage.setFlag(MODULE_ID, "applied", {
      carrier: carrier.id,
      lines: resolution.targets.filter(t => t.damage).map(t => ({ name: t.name, applied: t.damage.applied })),
      undone: resolution.step === STEPS.UNDONE
    });
  },

  /** Fenêtre « blessé » : sans incidence sur cette résolution, donc sans attente. */
  window(command, carrier, resolution) {
    // §19 : ce qui a blessé — l'activité (Défenses : « une attaque de mêlée ») et les types de dégâts (Absorption des éléments).
    const damageTypes = [...new Set((resolution?.damageRoll?.damages ?? []).map(d => d.type).filter(Boolean))];
    if ( command.window === "isDamaged" ) windowIsDamaged(command.tokens, speakerToken(carrier), carrier.speaker?.alias ?? "",
      { activity: resolution?.activity ?? null, damageTypes, auto: autoReactOf(carrier, resolution) });
  },

  /**
   * Zone instantanée retirée un peu après la résolution, pas tout de suite : un module d'animation
   * (BLFX, `boss-loot-assets-premium`) joue son effet sur la région, y écrit, puis la supprime
   * lui-même (`BlfxMacroExecutor.deleteTemplate`, 1 s après l'animation). La retirer en même temps
   * faisait écrire ce module sur une région disparue (« id … does not exist », vu le 2026-09-23).
   * S'il l'a déjà fait, il n'y a plus rien à retirer.
   */
  cleanup(command, carrier) {
    setTimeout(() => removeTransientRegions(carrier.id)
      .then(removed => { if ( removed ) log(`${removed} instantaneous area(s) removed`); })
      .catch(err => log("instantaneous area: removal failed", err?.message)), TRANSIENT_LINGER_MS);
  }
};

/** Déplacement forcé d'une cible par rapport à l'auteur (étape `move`, et « repoussé » de la Bousculade). */
async function forcedMove(source, target, { mode, distance, units, follow=false }) {
  if ( !source || !target ) return;
  const towards = mode === "pull";
  // Une distance en formule se lit sur la source (Main puissante : « 5 + 5 * @flags.dnd5e.summon.mod », §16.15).
  let value = distance;
  if ( typeof distance === "string" ) {
    try { value = new Roll(distance, source.actor?.getRollData() ?? {}).evaluateSync({ strict: false }).total; }
    catch(err) { return log(`push: distance "${distance}" unreadable (${err.message})`); }
    if ( !(value > 0) ) return log(`push: distance "${distance}" = ${value}, nothing`);
  }
  const { cells, wanted } = await pushAway(source, target, { distance: value, units }, readUnitFactors(), { towards, follow });
  log(`${towards ? "pull" : "push"}: ${target.name} ${towards ? "pulled" : "pushed"} ${cells} square(s) out of ${wanted}${cells < wanted ? " (stopped)" : ""}`);
}

/** Le temps qu'une zone instantanée reste visible après sa résolution (animations d'autres modules comprises). */
const TRANSIENT_LINGER_MS = 4000;

const dispatcher = createDispatcher({
  read: id => game.messages.get(id)?.getFlag(MODULE_ID, "resolution") ?? null,
  write: (id, resolution) => game.messages.get(id)?.setFlag(MODULE_ID, "resolution", resolution),
  execute: (command, id, resolution) => COMMANDS[command.type]?.(command, game.messages.get(id), resolution),
  enqueue,
  coalesce: () => game.settings.get(MODULE_ID, CHAT_LIGHT_SETTING),
  publish: (resolution, event) => {
    if ( resolution.step === STEPS.DONE ) log("action resolved →", resolution.targets.map(t =>
      `${t.name}:${t.save ? ` save ${t.save.success ? "succeeded" : "failed"}${t.save.total === null ? " automatically" : ` (${t.save.total})`}` : ""}`
      + `${t.damage ? ` ${t.damage.applied} HP` : ""}${t.effects.length ? ` ${t.effects.length} effect(s)` : ""}`).join(" ; "));
    // SPEC §5.6 : sortie en lecture seule pour les animations, un journal de combat, le connecteur MCP.
    Hooks.callAll(`${MODULE_ID}.resolution`, resolution, event);
  }
});

/* -------------------------------------------- */
/*  Ce que le cœur ne peut pas lire lui-même    */
/* -------------------------------------------- */

/**
 * Complète des cibles avec ce qui dépend des états et de la situation (core/conditions.mjs) :
 * échec d'office à la sauvegarde du plan, coup critique d'office, réaction possible si touchée.
 */
async function enrich(targets, plan, originUuid, activityUuid=null) {
  const activity = activityUuid ? await fromUuid(activityUuid) : null;
  const origin = plan.attack && originUuid ? await fromUuid(originUuid) : null;
  const factors = origin ? readUnitFactors() : null;
  // L'abri se lit sur le canevas : on attend la fin d'un redessin (changement de niveau) plutôt que de
  // juger « sans abri » faute de canevas. S'il ne vient pas, ou s'il montre une autre scène, on le dit.
  if ( origin && isCoverAvailable() && targets.length ) {
    await whenCanvasReady();
    if ( !canJudgeCover(origin.parent) ) {
      log(`cover not evaluated: the GM's canvas ${canvas?.ready ? "shows another scene" : "is not ready"}`);
      ui.notifications.warn(loc("AbriNonEvalue", { scene: origin.parent?.name ?? "" }));
    }
  }
  const out = [];
  // §28 : Façonneur de sorts — les alliés du lanceur (même disposition, lui excepté), dans l'ordre, jusqu'à `plan.sculpt`.
  const caster = activity?.actor ?? null;
  const casterToken = caster?.getActiveTokens?.(false, true)?.[0] ?? null;
  let sculpts = plan.sculpt ?? 0;
  for ( const target of targets ) {
    const token = await fromUuid(target.token);
    const statuses = statusesOf(token);
    // P1 (b) : l'abri corrige la CA avant le verdict — rien n'est posé sur la cible (SPEC §14.1, tranché).
    const cover = (origin && token && (target.ac !== null) && (target.ac !== undefined)) ? coverFor(origin, token) : null;
    const ac = cover ? ((cover.bonus === null) ? null : target.ac + cover.bonus) : target.ac;
    // §16.8 : type de créature, règle du contenu, immunité à tous les effets — la cible reste lisible, hors d'atteinte.
    const unaffected = await unaffectedBy(activity, plan, token);
    if ( unaffected ) log(`${target.name}: unaffected by ${activity?.item?.name ?? "the action"} (${unaffected.reason}${unaffected.detail ? `: ${unaffected.detail}` : ""})`);
    out.push({
      ...target,
      ac,
      cover,
      autoFail: plan.save ? autoFailSave(statuses, plan.save.ability) : null,
      defenceless: !!origin && !!token && isAutoCritical(statuses, areAdjacent(origin, token, factors)),
      // §74 : l'attaque et son auteur sont connus ici — une réaction qui en dépend (Parade : « au corps à corps ») est comptée.
      canReact: plan.attack ? await canReactToHit(target.token, { activity, source: origin?.actor ?? null }) : false,
      duplicates: plan.attack ? duplicatesAgainst(token?.actor, origin?.actor) : 0,
      // §20 : Esquive totale (Roublard, Moine, monstres) — jugée à l'application (core/action.mjs, `applicationPlan`).
      evasion: !!plan.save && evades(token?.actor),
      sculpted: (sculpts > 0) && !!token && !!casterToken && (token.actor !== caster) && (token.disposition === casterToken.disposition)
        && (sculpts-- > 0),
      unaffected
    });
  }
  return out;
}

/** Données d'`open()` du cœur pour un message, ou null s'il n'y a rien à résoudre. */
async function openingFor(message, usage, extra={}) {
  if ( !usage.plan.attack && !usage.targets.length ) {
    log(usage.area ? "area placed on nobody: nothing to resolve" : "no target designated: left to the card buttons");
    return null;
  }
  const { area, ...data } = usage;
  // Un effet exclusif choisi d'avance par le clic (menu : « Lutte », « Bousculade : à terre »…) : pas de question.
  const choice = game.messages.get(usage.origin ?? message.id)?.getFlag(MODULE_ID, "choice") ?? message.getFlag(MODULE_ID, "choice") ?? null;
  // §16.27 : la répartition des projectiles faite à la visée multiple (Projectile magique).
  const pairs = game.messages.get(usage.origin ?? message.id)?.getFlag(MODULE_ID, "allocation");   // [[token, nombre], …]
  const allocation = Array.isArray(pairs) ? Object.fromEntries(pairs) : null;
  return { id: foundry.utils.randomID(), ...data, choice, allocation, targets: await enrich(usage.targets, usage.plan, speakerToken(message), usage.activity), ...extra };
}

/* -------------------------------------------- */
/*  Messages du système → évènements            */
/* -------------------------------------------- */

function onUsageMessage(message) {
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
  const actor = (await fromUuid(speakerToken(message) ?? ""))?.actor ?? message.getAssociatedActor?.() ?? null;
  if ( !actor ) return roll;
  const needed = Math.min(...missed.map(t => t.ac));
  const bonus = await offerInspiration(actor, { what: loc("Inspiration.Attaque"), total: roll.total, needed });
  if ( bonus ) log(`${actor.name}: Bardic Inspiration, attack ${roll.total} + ${bonus} = ${roll.total + bonus}`);
  // §90 : Attaque précise — encore ratée, l'attaquant peut ajouter son propre dé (`rollBonus` sur "attack").
  const total = roll.total + bonus;
  const rules = actor.items.some(i => contentOf(i).entry?.rollBonus?.on?.includes("attack"));
  const precise = (rules && (total < needed)) ? await offerRollBonus(actor, { kind: "attack", what: loc("Inspiration.Attaque"), total, needed }) : 0;
  if ( precise ) log(`${actor.name}: die added to their attack, ${total} + ${precise} = ${total + precise}`);
  if ( !bonus && !precise ) return roll;
  return { ...roll, total: total + precise, inspired: bonus + precise };
}

async function onAttackMessage(message) {
  const attack = readAttackMessage(message);
  if ( !attack?.targets.length ) {   // sans cible désignée, le jet reste un jet simple
    log("attack without a designated target: plain roll, nothing to resolve");
    return;
  }
  await waitForDice(message);
  const rolled = async plan => {
    const targets = await enrich(attack.targets, plan, speakerToken(message), attack.activity);
    return { type: "attackRolled", roll: await inspiredAttack(message, attack.roll, targets), messageId: message.id, targets };
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
async function onDamageMessage(message) {
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

async function onSaveMessage(message) {
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
    const luck = (actor && (total < dc)) ? await offerRollBonus(actor, { kind: "save", what: loc("Inspiration.Sauvegarde"), total, needed: dc, statuses: saveStatuses(carrier, resolution) }) : 0;
    if ( luck ) { log(`${actor.name}: die added to their saving throw, ${total} + ${luck} = ${total + luck}`); total += luck; }
  }
  await dispatcher.send(carrierId, { type: "saveRolled", actor: save.actor, total, messageId: message.id, ...(resisted ? { resisted: true } : {}) });
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

/* -------------------------------------------- */
/*  Zones d'effet                               */
/* -------------------------------------------- */

/** Le dernier message d'utilisation de cette activité ; `unresolved` : qui n'a pas encore de résolution. */
function findUsage(activityUuid, { unresolved=false }={}) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - LOOKBACK); i-- ) {
    const message = messages[i];
    if ( (message.type !== "usage") || (unresolved && dispatcher.peek(message.id)) ) continue;
    if ( message.getAssociatedActivity?.()?.uuid === activityUuid ) return message;
  }
  return null;
}

/** §70 : la région posée par un sort à orage qui n'est pas un éclair — le nuage. */
function isCloudRegion(region) {
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  return !!stormOf(item) && !isBoltRegion(region);
}

/** Une zone vient d'être posée : ceux qu'elle recouvre sont les cibles de l'activité. */
async function onRegionCreated(region) {
  // P2 : une région créée sans tranche d'élévation (connecteur, macro) la reçoit avant qu'on lise qui est dedans.
  const slice = await ensureRegionElevation(region);
  if ( slice ) log(`area: elevation slice ${slice.bottom} → ${slice.top} ${region.parent.grid.units}`);
  // §16.21 : Appel de la foudre — la zone posée est le nuage de l'item ; la foudre frappe à 5 ft du point choisi.
  const bolt = await shrinkToBolt(region);
  if ( bolt ) log("area moved to the struck point (lightning)");
  const area = await readActivityRegion(region);
  if ( !area ) return;

  // Zone d'un sort à concentration : elle tombera avec elle (runtime/concentration.mjs).
  // §70 : le nuage — à défaut du message, la concentration en cours de son sort.
  const effect = concentrationEffectOf(findUsage(area.activity))
    ?? (isCloudRegion(region) ? concentrationOn(fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false })) : null);
  if ( effect ) {
    await tieRegionToConcentration(region, effect);
    log(`area attached to concentration "${effect.name}"`);
  }

  // §70 : le nuage d'un sort à orage ne résout rien — c'est l'éclair, visé dessous, qui le fera.
  if ( isCloudRegion(region) ) { log("storm: cloud placed, waiting for the lightning"); return; }

  const message = findUsage(area.activity, { unresolved: true });
  if ( !message ) return;
  await dispatcher.open(message.id, async () => {
    await repairSaveAbility(message);
    const usage = readUsage(message);
    const activity = message.getAssociatedActivity?.({ scaled: true });
    const rules = areaRulesOf(activity);
    // Une activité qui ne fait que POSER la zone (utilitaire sans effet) n'a rien à résoudre elle-même ;
    // si une sœur doit rejouer (Nuage nauséabond), la zone est quand même retenue comme zone qui dure.
    if ( !usage?.area && !rules?.activity && !rules?.casterPulse ) return null;
    const targets = selectAreaTargets(area.candidates, area).map(({ token, actor, name }) => ({ token, actor, name }));
    log(`area placed: ${area.candidates.length} token(s) covered, ${targets.length} affected`);
    if ( usage?.area ) showTargetsTo(message.author, targets.map(t => t.token));

    if ( rules && !isInstantaneous(activity) ) {
      // Zone qui dure : elle rejouera son activité (runtime/areas.mjs). Ceux qu'elle touche à la
      // pose l'ont été pour ce tour de jeu — sauf si c'est une sœur qui agit et que la pose ne fait rien.
      const key = turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);
      await writeAreaState(region, {
        ...openArea(rules.on, key, (usage?.area && actsOnPose(rules.on)) ? targets.map(t => t.token) : []),
        usage: message.id,
        activity: rules.activity ?? null,
        ...(rules.activities ? { activities: rules.activities } : {}),
        exclude: area.excludeOrigin ? area.origin : null,
        // §91 : le lanceur, dont le tour fait agir la zone (`casterPulse`).
        source: area.origin ?? null,
        // §16.23 : les rejeux de la zone respectent qui elle affecte (Esprits gardiens épargnent les alliés).
        affects: area.affects ?? "", originDisposition: area.originDisposition ?? null
      });
      log(`lasting area: acts on ${rules.on.join(", ")}, once per turn${rules.activity ? ` (replays activity ${rules.activity})` : ""}`);
      // Une zone qui n'agit qu'au déplacement (Croissance d'épines) ne fait rien à sa pose.
      // §91 : une zone qui n'agit qu'au tour de son lanceur (`casterPulse`, aucun moment) résout sa pose comme une autre.
      if ( !usage?.area || (rules.on.length && !actsOnPose(rules.on)) ) return null;
    } else if ( isInstantaneous(activity) || bolt ) {
      await markTransient(region, message.id);
      // Personne dedans : aucune résolution ne viendra la retirer. On la laisse voir un instant.
      if ( !targets.length ) setTimeout(() => removeTransientRegions(message.id).catch(() => {}), TRANSIENT_LINGER_MS);
    }
    return openingFor(message, { ...usage, targets });
  });
}

/* -------------------------------------------- */
/*  Annulation, dégâts de l'auteur, reprise     */
/* -------------------------------------------- */

/**
 * Annule ce qu'une résolution a appliqué. `message` est le message qui affiche le bouton : le
 * porteur, ou le message de dégâts qui en redit le résultat. MJ actif uniquement.
 */
export async function undo(message) {
  if ( !isExecutor() ) return;
  const carrier = game.messages.get(message.getFlag(MODULE_ID, "applied")?.carrier) ?? message;
  const resolution = resolutionOn(carrier);
  if ( resolution?.step !== STEPS.DONE ) return;
  const plan = undoPlan(resolution);
  for ( const { actor, restore } of plan.hp ) await restoreHp(actor, restore);
  await removeEffects(plan.effects);
  await dispatcher.send(carrier.id, { type: "undone" });
  log("resolution cancelled");
}

/**
 * Sur le client de l'AUTEUR de l'action : dès que la résolution passe à une étape qui attend ses
 * dégâts, il les lance. On réagit à un signal, pas à un délai, et chacun lance ses propres dés
 * (SPEC, principe 2). `step` n'est dans le diff que lorsqu'il change : une étape ne relance rien.
 */
function onResolutionFlag(message, changes) {
  const diff = changes.flags?.[MODULE_ID]?.resolution;
  if ( !diff || !("step" in diff) || !message.isAuthor ) return;
  const resolution = resolutionOn(message);
  if ( !resolution || !wantsDamageRoll(resolution) ) return;
  // §90 : une résolution que traverse une fenêtre de réaction repasse par « jets attendus » avant que le premier jet ne soit
  // enregistré — et la question des faveurs au jet (adapter/smite.mjs) le retarde : sans ce garde, un second jet partait (Parade : laissé
  // au plateau ; Riposte : appliqué, sans le dé de la manœuvre). Un jet par résolution ; un échec le libère.
  if ( damageRolling.has(resolution.id) ) return;
  damageRolling.add(resolution.id);
  log("chained damage roll");
  rollDamageFor(message, resolution, isCriticalHit(resolution)).catch(err => {
    damageRolling.delete(resolution.id);
    console.error(`${MODULE_ID} | automatic damage roll failed`, err);
    ui.notifications.warn("DND5ECOMBAT.DegatsManuels", { localize: true });
  });
}
/** Les résolutions dont le jet de dégâts enchaîné est parti, sur ce client. */
const damageRolling = new Set();

/**
 * Après un F5 du MJ : une fenêtre de réaction ouverte n'a plus personne pour l'écouter. La
 * résolution, elle, est écrite : on la referme en rejugeant chaque cible contre sa CA du moment
 * (si le Bouclier a été lancé entre-temps, il compte).
 */
async function resume() {
  for ( const message of game.messages.contents.slice(-LOOKBACK) ) {
    const resolution = resolutionOn(message);
    if ( resolution && pendingAllocation(resolution) ) {
      log("resume: projectile split pending, question asked again");
      const targets = resolution.targets.filter(t => !t.unaffected).map(({ token, name }) => ({ token, name }));
      const [event] = await COMMANDS.askAllocation({ type: "askAllocation", count: resolution.plan.darts, targets }, message, resolution);
      if ( event ) await dispatcher.send(message.id, event);
      continue;
    }
    if ( resolution && pendingChoice(resolution) ) {
      // Un choix d'effet resté sans réponse (F5, joueur parti) : la question est reposée.
      log("resume: effect choice pending, question asked again");
      const command = { type: "askChoice", prompt: resolution.plan.choice.prompt ?? null, options: resolution.plan.choice.options };
      const [event] = await COMMANDS.askChoice(command, message, resolution);
      if ( event ) await dispatcher.send(message.id, event);
      continue;
    }
    if ( resolution?.step !== STEPS.AWAITING_REACTION ) continue;
    log(`resume: reaction window closed (${resolution.pending.length} pending)`);
    // Des répliques dont les dés n'ont pas été lancés : on les lance.
    const duplicates = resolution.pending.filter(p => p.kind === "duplicates").map(p => p.token);
    if ( duplicates.length ) {
      for ( const event of await COMMANDS.rollDuplicates({ tokens: duplicates }, message, resolution) ) await dispatcher.send(message.id, event);
      continue;
    }
    for ( const { token } of resolution.pending ) {
      const target = resolution.targets.find(t => t.token === token);
      const ac = await currentAc(token) + (target?.cover?.bonus ?? 0);   // l'abri du verdict reste acquis
      const before = target?.ac;
      await dispatcher.send(message.id, { type: "reactionResolved", token, ac, used: (ac !== before) ? game.i18n.localize("DND5ECOMBAT.ReactionReprise") : null });
    }
  }
}

/* -------------------------------------------- */

/** Les messages de jet du système qui font avancer une résolution. */
const MESSAGE_HANDLERS = Object.freeze({
  usage: onUsageMessage, attack: onAttackMessage, damage: onDamageMessage, healing: onDamageMessage, save: onSaveMessage
});

export function registerEngine() {
  game.settings.register(MODULE_ID, CHAT_LIGHT_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CHAT_LIGHT_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CHAT_LIGHT_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  CONFIG.queries[TARGETS_QUERY] = handleTargetsQuery;
  CONFIG.queries[SAVE_QUERY] = handleSaveQuery;
  CONFIG.queries[CHOICE_QUERY] = handleChoiceQuery;   // sur tous les clients : c'est l'auteur qui répond
  CONFIG.queries[ALLOCATION_QUERY] = handleAllocationQuery;
  route("updateChatMessage", onResolutionFlag, { label: "chained damage roll" });
  // Une résolution qui échoue ne doit jamais bloquer le jeu : les boutons et plateaux du système restent utilisables.
  const failure = { executor: true, notify: "DND5ECOMBAT.ResolutionInterrompue" };
  route("createRegion", onRegionCreated, { ...failure, label: "area resolution interrupted" });
  route("createChatMessage", message => MESSAGE_HANDLERS[message.type]?.(message), { ...failure, label: "resolution interrupted" });
  route("ready", resume, { executor: true, label: "resuming pending resolutions" });
}
