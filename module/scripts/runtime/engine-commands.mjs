/**
 * Les commandes de la machine d'action (SPEC §5) : ce que le répartiteur (runtime/dispatcher.mjs) fait exécuter pour une
 * résolution — demander les sauvegardes et les réactions, lancer les dégâts, appliquer, déplacer, poser les états. Extrait de
 * runtime/engine.mjs.
 */

import { deathWardOf } from "../adapter/ward.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { retaliationsFor, retaliate, inflict, saveRetaliation } from "../adapter/retaliation.mjs";
import { applyDamageToToken, maximizedHealing } from "../adapter/messages.mjs";
import { requestSaves, applyEffectsToToken, applyStatusToToken, applyMarkToToken, splitPushes } from "../adapter/saves.mjs";
import { holds } from "../core/triggers.mjs";
import { creatureTypeOf, factsFor, originItemOf } from "../adapter/facts.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { removeTransientRegions } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { askAllocation } from "../adapter/projectiles.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween } from "../adapter/turn.mjs";
import { rangeIssue } from "../core/range.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { dodge as takeDodge } from "../core/turn.mjs";
import { tallyAfter } from "../core/tally.mjs";
import { askHitReactions, windowIsDamaged, windowIsMissed, windowEnemyAttacked, askDamageGuardians } from "./reactions.mjs";
import { markConcentrationBreaker, resistanceIgnoredBy, fortifiedExtra } from "./feats.mjs";
import { liftToken } from "./elevation-spells.mjs";
import { requestSave } from "./neighbours.mjs";
import { duplicateEffectsOf } from "../adapter/duplicates.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { log, loc, waitForDice, notice } from "./shared.mjs";
import { holdForAtCost } from "./success-at-cost.mjs";
import { waitForAnimations } from "./animations.mjs";
import { isRangedWeaponAttack } from "../adapter/cover.mjs";
import { TRANSIENT_LINGER_MS, deserializeDamages, dispatcher, healsDownedToMax, healsMax, hpTierFor, prismaticFor, slotHealBonus, speakerTokenUuid } from "./engine.mjs";

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

/**
 * K2 (§323) : la règle `killsAtZero` vaut-elle ici ? `true` ; ou réservée à des types de créature (« un Humanoïde réduit à 0 PV… »),
 * à une taille au plus (« une créature de taille M ou inférieure »), à des activités de l'item (le rayon désintégrant).
 */
const SIZE_ORDER = ["tiny", "sm", "med", "lg", "huge", "grg"];
function killsHere(rule, activity, actor) {
  if ( !rule || !actor ) return false;
  if ( rule === true ) return true;
  if ( rule.activities && !(activity && rule.activities.includes(activity.id)) ) return false;
  if ( rule.types && !rule.types.includes(creatureTypeOf(actor)) ) return false;
  if ( rule.sizeAtMost && (SIZE_ORDER.indexOf(actor.system?.traits?.size ?? "med") > SIZE_ORDER.indexOf(rule.sizeAtMost)) ) return false;
  return true;
}

export const COMMANDS = {
  /**
   * Issue #32 : succès à un prix — l'attaque rate de 1 ou 2 une cible au moins (CA finale) : la pause du MJ. Accepté : ces cibles sont
   * touchées ; sinon l'échec reste. Rien n'a encore été appliqué.
   */
  async atCostPause(command, carrier, resolution) {
    const tokenDoc = await fromUuid(speakerTokenUuid(carrier) ?? "");
    const actor = tokenDoc?.actor ?? await fromUuid(resolution.source ?? "");
    const by = Math.min(...command.targets.map(t => t.by));
    const answer = await holdForAtCost({ actor, token: tokenDoc ?? null, what: loc("Inspiration.Attaque"), total: command.total, needed: command.total + by, kind: "attack" });
    return [{ type: "atCostDecided", accepted: !!answer?.accepted, cost: answer?.cost ?? null }];
  },

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
    const source = await fromUuid(speakerTokenUuid(carrier) ?? "");
    // §112 : les PV tombent quand l'animation (BLFX, par Sequencer) arrive, pas à son départ.
    await waitForAnimations([source?.uuid, ...command.entries.map(e => e.token)]);
    const resave = carrier.getFlag(MODULE_ID, "resave");
    const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? null;
    const entries = [];
    const extra = [];
    const slotHeal = resolution.plan.heal ? slotHealBonus(source?.actor ?? activity?.actor, activity) : null;
    let healedOther = false;
    for ( let entry of command.entries ) {
      // Riposte (§16.9) : jugée au moment du coup, avant ses dégâts (« tant que vous avez ces PV temporaires »).
      const struck = resolution.plan.attack ? await fromUuid(entry.token) : null;
      const retaliations = struck ? retaliationsFor({ bearerToken: struck, attackerToken: source, activity, attackMode }) : [];
      // §16.24 : une cible sous Lueur d'espoir (`healMax`) regagne le maximum du soin.
      const patient = (await fromUuid(entry.token))?.actor;
      // §160 : paliers de PV (`hpTiers`) — l'issue se choisit d'après les PV de la cible AVANT les dégâts (Mot de pouvoir mortel, Mot de
      // pouvoir étourdissant, Parole divine) : le premier palier qui tient ; aucun, aucun effet.
      const tier = hpTierFor(activity?.item, patient, entry, resolution.plan, activity,
        (resolution.targets ?? []).find(t => t.token === entry.token)?.save?.success === false);
      if ( tier ) entry = tier.entry;
      const prism = await prismaticFor(activity?.item, entry, activity, resolution.plan);
      if ( prism ) {
        entry = prism.entry;
        const names = prism.colors.map(c => loc(`Prisme.${c}`)).join(", ");
        log(`${activity.item.name}: ${(await fromUuid(entry.token))?.name} — ${prism.colors.join(" + ")} (${names})`);
        const struckToken = await fromUuid(entry.token);
        if ( struckToken ) notice(struckToken, loc("Prisme.Rayons", { colors: names }), "gain");
      }
      const healed = (resolution.plan.heal && (entry.multiplier > 0)
        && (healsMax(patient) || healsDownedToMax(source?.actor ?? activity?.actor, activity, patient)))
        ? await maximizedHealing(damageMessage) : null;
      if ( healed ) log(`maximum healing for ${entry.token} (${healed.map(d => d.value).join(" + ")})`);
      // Rien à lire sans jet (sauvegarde ou effet seuls : `multiplier` 0, pas de `damageRoll`).
      let rolled = (entry.multiplier > 0) ? (healed ?? deserializeDamages(resolution.damageRoll?.damages ?? [])) : [];
      // §355 : Demonomicon d'Iggwilv — les dégâts d'un sort du porteur contre un Fiélon sont maximisés.
      if ( rolled.length && !resolution.plan.heal && spellDamageMaxed(source?.actor ?? activity?.actor, activity, patient) ) {
        rolled = (await maximizedHealing(damageMessage)) ?? rolled;
        log(`${activity.item.name}: maximum damage against ${patient?.name}`);
      }
      // §164 : le type de chaque rayon d'Embruns prismatiques ; deux rayons de dégâts, deux fois les dégâts.
      if ( prism?.types.length ) rolled = prism.types.flatMap(type => rolled.map(d => ({ ...d, type })));
      // §27 : Disciple de la Vie — des PV de plus au soin d'un sort lancé par un emplacement.
      if ( slotHeal?.disciple && (entry.multiplier > 0) && rolled.some(d => d.type === "healing") ) {
        rolled = [...rolled, { type: "healing", value: slotHeal.disciple, properties: new Set() }];
        log(`Disciple of Life: +${slotHeal.disciple} HP for ${entry.token}`);
      }
      // §135 : Faveur de vigueur — « quand vous regagnez des PV, vous pouvez en regagner autant que votre modificateur de Constitution en
      // plus », une fois par tour.
      if ( (entry.multiplier > 0) && rolled.some(d => d.type === "healing") ) {
        const extra = await fortifiedExtra(patient);
        if ( extra ) rolled = [...rolled, { type: "healing", value: extra, properties: new Set() }];
      }
      if ( resolution.plan.heal && (entry.multiplier > 0) && patient && (patient !== (source?.actor ?? activity?.actor)) ) healedOther = true;
      // §38 : Égide projetée — avant l'application, un allié peut faire absorber ces dégâts par sa réserve.
      const hurting = (entry.multiplier > 0) && !resolution.plan.heal && rolled.some(d => !["healing", "temphp"].includes(d.type) && (d.value > 0));
      const ward = hurting ? await askDamageGuardians(entry.token, source?.uuid ?? null, activity, { auto: autoReactOf(carrier, resolution) }) : null;
      if ( ward?.item ) log(`${ward.reactor}: Projected Ward, their Arcane Ward takes ${entry.token}'s damage`);
      // §78 : Interposition — les dégâts passent sur le réacteur ; les effets restent à la cible.
      if ( ward?.interpose ) log(`${ward.reactor} interposes: takes ${entry.token}'s damage`);
      // §303 (repasse C8) : Aide — l'effet (PV maximum relevés) passe avant le soin, sinon dnd5e plafonne le soin aux PV maximum d'avant
      // et une cible à pleins PV ne gagnait rien (`effectsFirst`). Les effets sans condition seulement.
      const first = (entry.multiplier > 0) && (contentOf(activity?.item).entry?.effectsFirst === true) && (entry.effects ?? []).some(e => !e.if);
      const early = first ? await applyEffectsToToken(carrier, entry.token, entry.effects.filter(e => !e.if)) : [];
      const hp = (entry.multiplier > 0)
        ? await applyDamageToToken(ward?.interpose ?? entry.token, rolled, damageMessage, { multiplier: entry.multiplier, reduction: entry.reduction ?? 0, absorbInto: ward?.item ?? null,
          ignoreResistance: resistanceIgnoredBy(source?.actor ?? activity?.actor, activity),   // §134
          rangedWeapon: !!resolution.plan.attack && isRangedWeaponAttack(activity, attackMode) })   // O8d (§347)
        : null;
      // §133 : Tueur de mages — la créature concentrée que l'auteur vient de blesser aura le Désavantage à son jet de concentration.
      if ( hp && hurting ) await markConcentrationBreaker(source?.actor ?? activity?.actor, hp.actor);
      // C12-f : Défenses envoûtantes — l'attaquant qui a raté la sauvegarde subit les dégâts que le porteur vient de subir.
      const retort = hp ? patient?.getFlag?.(MODULE_ID, "retort") : null;
      if ( retort && (retort.resolution === resolution.id) ) {
        await patient.unsetFlag(MODULE_ID, "retort");
        const dealt = (hp.before.value + (hp.before.temp ?? 0)) - (hp.after.value + (hp.after.temp ?? 0));
        if ( (dealt > 0) && retort.source ) {
          const logged = await inflict({ step: { formula: String(dealt), damageType: retort.type }, targetUuid: retort.source,
            speaker: ChatMessage.implementation.getSpeaker({ actor: patient }),
            flavor: loc("DegatsRenvoyes", { item: retort.item, name: patient.name }), flags: { retort: { item: retort.item } } });
          if ( logged ) { extra.push({ ...logged, name: retort.item }); log(`${retort.item}: ${dealt} ${retort.type} damage back to the attacker`); }
        }
      }
      // C12-f : Désintégration — « une créature réduite à 0 PV par ce sort est désintégrée » : morte, sans jets contre la mort (`killsAtZero`).
      if ( hp && hurting && (hp.after.value <= 0) && killsHere(contentOf(activity?.item).entry?.killsAtZero, activity, patient) && patient && !patient.statuses?.has("dead") ) {
        await applyStatusToToken(carrier, entry.token, "dead");
        log(`${activity.item.name}: ${patient.name} reduced to 0 HP — disintegrated`);
      }
      const target = await fromUuid(entry.token);
      // §16.46 : ce qu'une défense (Résistance) a retiré aux dégâts.
      for ( const s of hp?.shields ?? [] ) {
        log(`${target?.name ?? entry.token}: ${s.name} reduces the damage by ${s.reduced} (${s.formula ?? "1d4"} = ${s.rolled})`);
        if ( target ) notice(target, loc("Retour.Reduit", { item: s.name, n: s.reduced }), "gain");
      }
      // Un effet sous condition (M3, §18.4 : « si la cible est de taille G ou inférieure ») ne passe que si elle tient.
      const facts = factsFor({ source: source?.actor ?? null, target: target?.actor ?? null, activity, sourceToken: source, targetToken: target });
      const allowed = (entry.effects ?? []).filter(e => {
        if ( !e.if ) return !first;
        const ok = holds((typeof e.if === "string") ? JSON.parse(e.if) : e.if, facts);
        if ( !ok ) log(`effect ${e.id}: condition not met for ${target?.name ?? entry.token}, not applied`);
        return ok;
      });
      // « Repoussé » (Bousculade) n'est pas un effet : c'est un déplacement subi, loin de l'auteur.
      const { effects: toApply, pushes } = await splitPushes(carrier, allowed);
      for ( const push of pushes ) await forcedMove(source, target, { mode: "push", ...push });
      const effects = [...early, ...await applyEffectsToToken(carrier, entry.token, toApply)];
      if ( toApply.length > effects.length - early.length ) log(`${target?.name ?? entry.token}: ${toApply.length - effects.length} planned effect(s) not applied (${toApply.map(e => e.id).join(", ")})`);
      else if ( (entry.effects ?? []).length && !toApply.length && !pushes.length && !early.length ) log(`${target?.name ?? entry.token}: no effect to apply (${(entry.effects ?? []).length} planned)`);
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
          // §304 : Lien occulte — « on ne peut vous désarmer de l'arme liée tant que vous n'êtes pas Neutralisé ».
          const incapacitated = target?.actor?.statuses?.has("incapacitated");
          const bonded = i => !incapacitated && i.effects.some(e => !e.disabled && (identifierOf(originItemOf(e) ?? {}).id === "war-bond"));
          const weapon = target?.actor?.items.find(i => (i.type === "weapon") && i.system.equipped && !bonded(i)
            && Array.from(i.system.activities ?? []).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")));
          if ( weapon ) {
            await weapon.update({ "system.equipped": false });
            notice(target, loc("Retour.Desarme", { item: weapon.name }), "ended");
            log(`${step.name ?? "disarm"}: ${target.name} drops ${weapon.name}`);
          } else if ( step.elseEffect && target?.actor && activity?.item ) {
            // C12-b : rien à lâcher (Métal brûlant sur une armure portée) — l'effet de l'item à la place (Désavantage).
            await placeItemEffect(activity.item, step.elseEffect, target.actor);
            log(`${step.name ?? "disarm"}: ${target.name} has nothing to drop, "${step.elseEffect}" placed`);
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
        else if ( step.type === "lift" ) {
          // §164 : Inversion de la gravité — la zone de cette utilisation (la plus récente de l'activité) chute avec elle.
          const region = target?.parent?.regions?.filter(r => r.getFlag("dnd5e", "activity") === activity?.uuid).at(-1) ?? null;
          await liftToken(target, step, region);
        }
        else if ( step.type === "status" ) {
          // §352 : `around` — la cible et chaque créature à cette distance d'elle, l'auteur excepté (Marteau de tonnerre : « la cible et
          // chaque créature à 9 m d'elle autre que vous »), chacune sa sauvegarde.
          const struck = target ? [target, ...(step.around ? creaturesAround(target, step.around, source) : [])] : [];
          for ( const victim of struck ) {
            // §345 : l'état seulement sur une sauvegarde ratée (Tueuse de géants), lancée ici, sans fenêtre.
            if ( step.save && victim.actor ) {
              const saved = await requestSave(victim.actor, { ability: step.save.ability, dc: step.save.dc, flavor: step.name ?? null });
              log(`${step.name ?? "condition"}: ${victim.name} ${step.save.ability} saving throw ${saved?.total ?? "?"} vs DC ${step.save.dc}: ${saved?.success ? "succeeded" : "failed"}`);
              if ( saved?.success !== false ) continue;
            }
            const uuid = await applyStatusToToken(carrier, victim.uuid, step.status);
            if ( uuid ) { effects.push(uuid); log(`${step.name ?? "condition"}: ${victim.name} receives "${step.status}"`); }
            // O9a (§354) : « détruite », « tuée sur le coup » — Morte, et ses PV à 0 (comme les paliers de PV, plus bas).
            if ( uuid && (step.status === "dead") ) await victim.actor?.update({ "system.attributes.hp.value": 0 });
          }
        }
      }
      for ( const status of tier?.statuses ?? [] ) {
        // §303 (repasse C8) : Protection contre la mort — « un effet qui la tuerait sur le coup sans infliger de dégâts est annulé » : la
        // garde tombe à la place de la mort (Mot de pouvoir mortel, Parole divine).
        const ward = (status === "dead") ? deathWardOf(target?.actor) : null;
        if ( ward ) { await ward.delete(); log(`${activity?.item?.name}: ${target?.name} is not killed, ${ward.name} ends instead`); continue; }
        // L'état d'abord, les PV ensuite : à 0 PV, dnd5e et le moteur posent eux-mêmes Mort (même id, `dnd5edead0000000`) — deux
        // créations croisées faisaient échouer la résolution (vu le 2026-10-12, Parole divine).
        const uuid = await applyStatusToToken(carrier, entry.token, status);
        if ( uuid ) { effects.push(uuid); log(`${activity?.item?.name}: ${target?.name} at ${tier.hp} HP receives "${status}"`); }
        if ( status === "dead" ) await target?.actor?.update({ "system.attributes.hp.value": 0 });
      }
      // K2 (§323) : « elle tombe à 0 PV » (Regard mortel, Plainte funeste) — des dégâts égaux à ses PV, par dnd5e : la Protection contre la
      // mort et la règle des 0 PV du moteur (Mort pour un PNJ, Inconscient pour un personnage) décident comme pour tout coup.
      if ( tier?.zero && target?.actor ) {
        const hpNow = target.actor.system?.attributes?.hp ?? {};
        const total = Number(hpNow.value ?? 0) + Number(hpNow.temp ?? 0);
        if ( total > 0 ) { await target.actor.applyDamage(total); log(`${activity?.item?.name}: ${target.name} at ${tier.hp} HP drops to 0 HP`); }
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
      /** §19.6 : les dégâts du porteur qui ne valent que si la sauvegarde est ratée (saignement d'Épine, Fumées d'othur). */
      const failDamage = async t => {
        if ( !resave.onFail || !t.save || (t.save.success === true) ) return;
        const item = await fromUuid(resave.onFail.item ?? "");
        for ( const step of resave.onFail.steps ?? [] ) {
          const logged = await inflict({ step, item, scaling: resave.onFail.scaling ?? 0, targetUuid: t.token,
            speaker: ChatMessage.implementation.getSpeaker({ token: (await fromUuid(t.token)) ?? undefined }),
            flavor: loc("DegatsPorteur", { item: resave.onFail.name ?? item?.name ?? "", name: t.name }),
            flags: { bearerDamage: { item: resave.onFail.identifier ?? null, effect: resave.effect, moment: resave.moment } } });
          if ( logged ) { extra.push({ ...logged, name: resave.onFail.name }); log(`${resave.onFail.name}: saving throw failed, ${t.name} takes its damage`); }
        }
      };
      for ( const t of resolution.targets ) {
        // §43.1 : compteur — l'effet ne tombe qu'au seuil de réussites ; au seuil d'échecs, il reste et plus rien n'est rejoué.
        if ( resave.tally && t.save ) {
          const effect = await fromUuid(resave.effect);
          if ( !effect ) continue;
          const after = tallyAfter(effect.getFlag(MODULE_ID, "tally"), t.save.success === true, resave.tally);
          const said = loc("Compteur.Etat", { successes: after.successes, successesMax: resave.tally.successes, failures: after.failures, failuresMax: resave.tally.failures });
          if ( after.outcome === "ended" ) {
            log(`tally: ${t.name} reaches ${after.successes} success(es), "${effect.name}" removed`);
            notice(t.token, effect.name, "effectOff");
            await effect.delete();
            continue;
          }
          const update = { [`flags.${MODULE_ID}.tally`]: { successes: after.successes, failures: after.failures, settled: after.settled } };
          if ( (after.outcome === "settled") && resave.tally.status ) update.statuses = [...new Set([...(effect.statuses ?? []), resave.tally.status])];
          await effect.update(update);
          log(`tally: ${t.name} — ${said}${after.settled ? `; settled, "${effect.name}" remains${resave.tally.status ? ` (${resave.tally.status})` : ""}` : ""}`);
          notice(t.token, after.settled ? loc("Compteur.Clos", { item: effect.name }) : said, after.settled ? "refused" : "prompt");
          // O9h (§363) : un compteur avec des dégâts d'échec (Fumées d'othur : « à chaque nouvel échec, 1d6 dégâts de poison »).
          await failDamage(t);
          continue;
        }
        if ( t.save?.success !== true ) {
          // §37 : Malédiction, « Cursed Actions » — ratée, la créature prend l'action Esquiver ce tour.
          if ( resave.dodge && t.save ) await forceDodge(t.token);
          await failDamage(t);
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
    // K3 (§324) : un effet tiré au dé (Lame du chaos : 1d4) — un jet visible de tous, une face par option, sans question.
    if ( command.roll ) {
      const roll = await new Roll(`1d${command.options.length}`).evaluate();
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ actor }), flavor: loc("EffetTire", { item }) });
      const picked = command.options[roll.total - 1];
      log(`${item}: d${command.options.length} = ${roll.total} → ${picked?.label ?? "?"}`);
      return picked ? [{ type: "choiceMade", id: picked.id }] : [];
    }
    // §401 : un choix par cible — une question par créature, nommée.
    if ( command.perTarget?.length ) {
      const choices = {};
      for ( const t of command.perTarget ) {
        const prompt = loc("ChoixParCible", { name: t.name });
        const answer = await askChoice(actor, { actor: actor.uuid, item, prompt, options: command.options });
        if ( answer ) choices[t.token] = answer.id;
        log(`${item}: ${actor.name} chooses ${command.options.find(o => o.id === answer?.id)?.label ?? "(first option)"} for ${t.name}`);
      }
      return [{ type: "choiceMade", choices }];
    }
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
      if ( missed.length ) windowIsMissed(missed, speakerTokenUuid(carrier), carrier.speaker?.alias ?? "",
        { activity: resolution.activity, auto: autoReactOf(carrier, resolution) });
      // §236 : « une créature hostile vient d'attaquer » (Âme de la vengeance), touché ou raté.
      windowEnemyAttacked(speakerTokenUuid(carrier), carrier.speaker?.alias ?? "", { activity: resolution.activity, auto: autoReactOf(carrier, resolution) });
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
    if ( command.window === "isDamaged" ) windowIsDamaged(command.tokens, speakerTokenUuid(carrier), carrier.speaker?.alias ?? "",
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
async function forcedMove(source, target, { mode, distance, units, follow=false, upTo=false }) {
  if ( !source || !target ) return;
  // §401 : « jusqu'à » — l'auteur choisit, par cases, de 0 à la distance permise.
  if ( upTo && Number.isFinite(distance) ) {
    const chosen = await askDistance(source, target, { mode, distance, units });
    if ( chosen === null ) return;
    distance = chosen;
    if ( !(distance > 0) ) return log(`${mode}: ${target.name} not moved (the author's choice)`);
  }
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

/**
 * §401 : la distance d'un déplacement forcé « jusqu'à » — demandée à l'auteur (son joueur, sinon le MJ), par cases de la scène. Rend la
 * distance en `units`, ou null si l'auteur n'a pas d'acteur.
 */
async function askDistance(source, target, { mode, distance, units }) {
  const actor = source.actor;
  if ( !actor ) return null;
  const scene = source.parent;
  const sceneUnits = scene?.grid?.units || units;
  const step = Number(scene?.grid?.distance) || 5;
  const max = lengthIn(distance, units, sceneUnits);
  const options = [];
  for ( let n = 0; (n * step) <= max + 1e-6; n++ ) {
    const value = Math.round(n * step * 100) / 100;
    options.push({ id: String(n), label: n ? `${value} ${sceneUnits}` : loc("DistanceAucune"), value: n ? lengthIn(value, sceneUnits, units) : 0 });
  }
  options.reverse();   // le plus loin d'abord : la règle par défaut
  const answer = await askChoice(actor, { actor: actor.uuid, item: loc(mode === "pull" ? "Tirer" : "Repousser"),
    prompt: loc("DistanceQuestion", { name: target.name }), options: options.map(({ id, label }) => ({ id, label })) });
  const picked = options.find(o => o.id === answer?.id) ?? options[0];
  return picked.value;
}

/**
 * §352 : les créatures vivantes à `around.radius` (en `around.units`) d'un token, sur la même scène, lui et l'auteur exceptés (ni
 * objet, ni token caché).
 */
function creaturesAround(center, around, source) {
  const factors = readUnitFactors();
  return (center.parent?.tokens ?? []).filter(t => (t !== center) && (t !== source) && t.actor && !t.hidden && !isObjectToken(t)
    && !t.actor.statuses?.has?.("dead") && (rangeIssue(distanceBetween(center, t), { value: around.radius, units: around.units }, factors) === null));
}

/** §355 : l'auteur porte-t-il un objet qui maximise les dégâts de ses sorts contre le type de cette créature (`maxSpellDamageVs`) ? */
function spellDamageMaxed(actor, activity, target) {
  if ( !actor || !target || !isSpellCast(activity?.item) ) return false;
  const type = creatureTypeOf(target);
  return !!type && Array.from(actor.items ?? []).some(i => (contentOf(i).entry?.maxSpellDamageVs ?? []).includes(type));
}
