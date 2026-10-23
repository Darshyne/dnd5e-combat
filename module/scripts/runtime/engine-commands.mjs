/**
 * Les commandes de la machine d'action (SPEC §5) : ce que le répartiteur (runtime/dispatcher.mjs) fait exécuter pour une
 * résolution — demander les sauvegardes et les réactions, lancer les dégâts, appliquer, déplacer, poser les états. Extrait de
 * runtime/engine.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { retaliationsFor, retaliate, inflict, saveRetaliation } from "../adapter/retaliation.mjs";
import { applyDamageToToken, maximizedHealing } from "../adapter/messages.mjs";
import { requestSaves, applyEffectsToToken, applyStatusToToken, applyMarkToToken, splitPushes } from "../adapter/saves.mjs";
import { holds } from "../core/triggers.mjs";
import { factsFor } from "../adapter/facts.mjs";
import { removeTransientRegions } from "../adapter/areas.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { askAllocation } from "../adapter/projectiles.mjs";
import { pushAway } from "../adapter/movement.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { dodge as takeDodge } from "../core/turn.mjs";
import { tallyAfter } from "../core/tally.mjs";
import { askHitReactions, windowIsDamaged, windowIsMissed, windowEnemyAttacked, askDamageGuardians } from "./reactions.mjs";
import { markConcentrationBreaker, resistanceIgnoredBy, fortifiedExtra } from "./feats.mjs";
import { liftToken } from "./elevation-spells.mjs";
import { duplicateEffectsOf } from "../adapter/duplicates.mjs";
import { log, loc, waitForDice, notice } from "./shared.mjs";
import { waitForAnimations } from "./animations.mjs";
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

export const COMMANDS = {
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
      const tier = hpTierFor(activity?.item, patient, entry, resolution.plan);
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
      const hp = (entry.multiplier > 0)
        ? await applyDamageToToken(ward?.interpose ?? entry.token, rolled, damageMessage, { multiplier: entry.multiplier, reduction: entry.reduction ?? 0, absorbInto: ward?.item ?? null,
          ignoreResistance: resistanceIgnoredBy(source?.actor ?? activity?.actor, activity) })   // §134
        : null;
      // §133 : Tueur de mages — la créature concentrée que l'auteur vient de blesser aura le Désavantage à son jet de concentration.
      if ( hp && hurting ) await markConcentrationBreaker(source?.actor ?? activity?.actor, hp.actor);
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
        else if ( step.type === "lift" ) {
          // §164 : Inversion de la gravité — la zone de cette utilisation (la plus récente de l'activité) chute avec elle.
          const region = target?.parent?.regions?.filter(r => r.getFlag("dnd5e", "activity") === activity?.uuid).at(-1) ?? null;
          await liftToken(target, step, region);
        }
        else if ( step.type === "status" ) {
          const uuid = await applyStatusToToken(carrier, entry.token, step.status);
          if ( uuid ) { effects.push(uuid); log(`${step.name ?? "condition"}: ${target?.name} receives "${step.status}"`); }
        }
      }
      for ( const status of tier?.statuses ?? [] ) {
        // L'état d'abord, les PV ensuite : à 0 PV, dnd5e et le moteur posent eux-mêmes Mort (même id, `dnd5edead0000000`) — deux
        // créations croisées faisaient échouer la résolution (vu le 2026-10-12, Parole divine).
        const uuid = await applyStatusToToken(carrier, entry.token, status);
        if ( uuid ) { effects.push(uuid); log(`${activity?.item?.name}: ${target?.name} at ${tier.hp} HP receives "${status}"`); }
        if ( status === "dead" ) await target?.actor?.update({ "system.attributes.hp.value": 0 });
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
