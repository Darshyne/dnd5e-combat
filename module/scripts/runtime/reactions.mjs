import { MODULE_ID } from "../constants.mjs";
import { opportunityAttackers, areHostile } from "../core/reaction.mjs";
import { convertLength } from "../core/units.mjs";
import {
  REACTION_QUERY, handleReactionQuery, setReactionApproach, reactionOptions, reactionState, meleeAttacksOf, reactiveSpellsOf, askReaction, currentAc, opportunityBlocked
} from "../adapter/reactions.mjs";
import { combatantFor, readBudget, distanceBetween, positionOf as position } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { canSee } from "../adapter/vision.mjs";
import { victimsOf } from "../adapter/grapple.mjs";
import { pilotOf } from "../adapter/pilot.mjs";
import { avoidsOpportunity } from "../adapter/opportunity.mjs";
import { current } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, tokenOf } from "../adapter/facts.mjs";
import { duplicatesAgainst } from "../adapter/duplicates.mjs";
import { announce, matching } from "./triggers.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { reactionApproach } from "./actions.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { poolsOf } from "../adapter/absorb.mjs";

/** Les réactions qu'un acteur peut proposer dans une fenêtre, d'après le registre. `publish` : le moment a vraiment lieu. */
function reactionsOf(actor, window, context={}, { publish=false }={}) {
  const full = { actor, ...context };
  if ( publish ) announce(window, full);
  return reactionOptions(actor, window, matching(window, full));
}

/** Cette créature a-t-elle de quoi réagir si elle est touchée ? Consulté avant d'ouvrir une fenêtre : sans candidat, aucune attente. */
export async function canReactToHit(tokenUuid) {
  const token = await fromUuid(tokenUuid);
  const actor = token?.actor;
  return !!actor && ((reactionsOf(actor, "isHit").length > 0) || (guardiansOf(token, null, null).length > 0));
}

/**
 * §19.9 : qui peut réagir pour une AUTRE créature touchée (Sentinelle au seuil de la mort : soi-même, ou une créature En sang
 * visible à 18 m au plus). Parmi les créatures de la scène, vivantes, qui ne lui sont pas hostiles, autres que l'attaquant.
 * @returns {Array<{token: TokenDocument, options: object[]}>}
 */
function guardiansOf(hitToken, attackerToken, activity, { publish=false, resolution=null }={}) {
  const target = hitToken?.actor;
  if ( !target || !hitToken.parent ) return [];
  const out = [];
  for ( const other of hitToken.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === hitToken) || (other === attackerToken) || isObjectToken(other) ) continue;
    if ( areHostile(other.disposition, hitToken.disposition) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const options = reactionsOf(actor, "allyIsHit", { source: attackerToken?.actor ?? null, target, activity, resolution,
      self: actor, selfToken: other, sourceToken: attackerToken, targetToken: hitToken }, { publish });
    if ( options.length ) out.push({ token: other, options });
  }
  return out;
}

/**
 * Commande `askReactions` de la machine d'action, fenêtre « touché » : chaque cible touchée qui a
 * de quoi réagir (Bouclier) est consultée, l'une après l'autre. La résolution est déjà écrite
 * (étape `awaitingReaction`) : on peut attendre. Si elle réagit, on laisse SA propre action se
 * résoudre (ses effets sur elle-même sont le plan de son message d'utilisation), puis on lit sa
 * nouvelle CA ; c'est le cœur qui rejuge.
 * @param {object} resolution
 * @param {string[]} tokens
 * @param {(carrierId: string) => Promise} drained  Attend la fin de la résolution d'un autre porteur.
 * @returns {Promise<object[]>}  Un évènement `reactionResolved` par cible consultée.
 */
export async function askHitReactions(resolution, tokens, drained, { auto=null }={}) {
  const events = [];
  const source = await fromUuid(resolution.source ?? "");
  const attacker = source?.name ?? "";
  const activity = await fromUuid(resolution.activity ?? "");
  for ( const tokenUuid of tokens ) {
    const target = resolution.targets.find(t => t.token === tokenUuid);
    const actor = (await fromUuid(tokenUuid))?.actor;
    // `auto` (scénarios : `autoReact` de l'attaque) : "none" = personne ne réagit ; "first" = la première réaction, sans fenêtre.
    const options = (actor && (auto !== "none")) ? reactionsOf(actor, "isHit", { source, target: actor, activity, resolution }, { publish: true }) : [];
    let answer = null;
    if ( options.length ) {
      log(`${target?.name} est touché : fenêtre de réaction (${options.map(o => o.name).join(", ")})`);
      answer = await askReaction(actor, {
        actor: actor.uuid,
        prompt: { key: "ReactionTouche", data: { attacker, total: resolution.attack.roll.total } },
        options,
        // §29 : une réaction qui vise l'attaquant (Défenses envoûtantes : sa sauvegarde de Sagesse).
        target: options.some(o => o.targetSource) ? (tokenOf(source)?.uuid ?? null) : null,
        auto: auto === "first"
      });
    }
    if ( answer?.message ) await drained(answer.message);
    // §19.9 : si elle n'a pas elle-même réduit les dégâts, un allié peut le faire pour elle (Sentinelle au seuil de la mort) —
    // le premier qui accepte ; sa réaction, ses utilisations.
    if ( !answer?.halve && !answer?.reduce && (auto !== "none") ) {
      const hitToken = await fromUuid(tokenUuid);
      const attackerToken = tokenOf(source);
      for ( const guardian of guardiansOf(hitToken, attackerToken, activity, { publish: true, resolution }) ) {
        log(`${target?.name} est touché : ${guardian.token.name} peut réagir pour lui (${guardian.options.map(o => o.name).join(", ")})`);
        const help = await askReaction(guardian.token.actor, {
          actor: guardian.token.actor.uuid,
          prompt: { key: "ReactionAllieTouche", data: { name: target?.name ?? "", attacker, total: resolution.attack.roll.total } },
          options: guardian.options,
          target: tokenUuid,
          auto: auto === "first"
        });
        if ( help?.message ) await drained(help.message);
        if ( !help?.halve && !help?.penalty ) continue;
        answer = help;
        break;
      }
    }
    // §33 : Mots cinglants — le dé retiré au jet vaut autant de CA pour ce rejugement.
    const ac = await currentAc(tokenUuid) + (target?.cover?.bonus ?? 0) + (Number(answer?.penalty) || 0);   // l'abri du verdict reste acquis
    if ( answer?.penalty ) log(`${target?.name} : ${answer.name}, -${answer.penalty} au jet d'attaque`);
    // §19.6 : Parade — +5 à la CA contre UNE seule attaque : la CA relue, les effets de l'item tombent (`forOneAttack`).
    if ( answer?.used ) await dropOneAttackEffects(actor, answer.used);
    if ( answer ) log(`${target?.name} réagit (${answer.name}) : CA ${target?.ac} → ${ac}`);
    if ( answer?.halve ) log(`${target?.name} : ${answer.name}, dégâts de l'attaque divisés par deux`);
    // §19 : les répliques que la réaction a pu créer (Ombres spectrales) comptent pour ce coup.
    const duplicates = answer ? duplicatesAgainst(actor, source) : null;
    if ( answer?.uncrit && target?.critical ) log(`${target?.name} : ${answer.name}, le coup critique n'est plus qu'un coup`);
    if ( answer?.reduce ) log(`${target?.name} : ${answer.name}, dégâts de l'attaque réduits de ${answer.reduce}`);
    if ( answer?.miss ) log(`${target?.name} : ${answer.name}, l'attaque rate d'office`);
    events.push({ type: "reactionResolved", token: tokenUuid, used: answer?.name ?? null, ac, halve: answer?.halve === true,
      miss: answer?.miss === true,
      reduce: Number(answer?.reduce) || 0,
      uncrit: answer?.uncrit === true, duplicates });
  }
  return events;
}

/**
 * §38 : fenêtre « un allié va subir des dégâts » (Égide projetée) — avant l'application, pour une créature qui va perdre des PV : les
 * créatures de la scène qui ne lui sont pas hostiles, autres qu'elle et que l'auteur, vivantes, dont la réserve (`absorb`) est créée et
 * non vide, et dont une réaction absorbe. Le premier qui accepte l'emporte : l'uuid de l'item de sa réserve, que l'application passe à
 * dnd5e (adapter/absorb.mjs). MJ actif ; `auto` : l'outil de scénario `autoReact`.
 * @returns {Promise<{item: string, reactor: string}|null>}
 */
export async function askDamageGuardians(targetUuid, sourceUuid, activity, { auto=null }={}) {
  if ( auto === "none" ) return null;
  const hurtToken = await fromUuid(targetUuid ?? "");
  const target = hurtToken?.actor;
  if ( !target || !hurtToken.parent ) return null;
  const attacker = sourceUuid ? await fromUuid(sourceUuid) : null;
  for ( const other of hurtToken.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === hurtToken) || (other === attacker) || isObjectToken(other) ) continue;
    if ( areHostile(other.disposition, hurtToken.disposition) || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const pool = poolsOf(actor).find(p => p.pool > 0);   // d'abord le moins cher : sans égide pleine, rien à proposer
    if ( !pool ) continue;
    const options = reactionsOf(actor, "allyIsDamaged", { source: attacker?.actor ?? null, target, activity, self: actor, selfToken: other,
      sourceToken: attacker, targetToken: hurtToken }, { publish: true }).filter(o => o.absorb);
    if ( !options.length ) continue;
    log(`${hurtToken.name} va subir des dégâts : ${other.name} peut réagir (${options.map(o => o.name).join(", ")}, réserve ${pool.pool})`);
    const answer = await askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionAllieBlesse", data: { name: hurtToken.name, attacker: attacker?.name ?? "" } },
      options,
      target: targetUuid,
      auto: auto === "first"
    });
    if ( answer?.absorb ) return { item: pool.item.uuid, reactor: other.name };
  }
  return null;
}

/**
 * Fenêtre « blessé » : sans incidence sur la résolution en cours, donc sans attente. La réaction
 * choisie (Représailles infernales) vise l'auteur des dégâts et suit son propre cours.
 * @param {string[]} tokenUuids  Cibles qui viennent de perdre des PV.
 * @param {string|null} sourceToken
 * @param {string} sourceName
 * @param {{activity?: string|null, damageTypes?: string[], auto?: string|null}} [hurt]  Ce qui a blessé : uuid de l'activité,
 *   types de dégâts ; `auto` : l'outil de scénario `autoReact` de l'utilisation, comme pour la fenêtre « touché ».
 */
export function windowIsDamaged(tokenUuids, sourceToken, sourceName, { activity=null, damageTypes=[], auto=null }={}) {
  if ( auto === "none" ) return;
  for ( const uuid of tokenUuids ) (async () => {
    const tokenDocument = await fromUuid(uuid);
    const actor = tokenDocument?.actor;
    if ( !actor || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const attackerToken = await fromUuid(sourceToken ?? "");
    const source = attackerToken?.actor ?? null;
    const used = activity ? await fromUuid(activity) : null;
    const options = reactionsOf(actor, "isDamaged",
      { source, target: actor, activity: used, sourceToken: attackerToken, targetToken: tokenDocument, damageTypes }, { publish: true });
    if ( !options.length ) return;
    log(`${actor.name} est blessé : fenêtre de réaction (${options.map(o => o.name).join(", ")})`);
    await askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionBlesse", data: { attacker: sourceName } },
      options,
      target: options.some(o => o.targetSource) ? sourceToken : null,
      auto: auto === "first"
    });
  })().catch(err => console.error(`${MODULE_ID} | fenêtre « blessé » interrompue`, err));
}

/**
 * §19.8 : fenêtre « subit un état » (frappée par l'un de ces états, la créature se change en
 * bête et l'état cesse). Sans attente, comme « blessé ». La réaction prise, l'état cesse (étape
 * `endCondition`) : les effets qui le portent sont retirés. MJ actif.
 */
async function windowGainsCondition(effect) {
  const actor = effect.parent;
  if ( (actor?.documentName !== "Actor") || effect.disabled || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  const token = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  for ( const condition of Array.from(effect.statuses ?? []) ) {
    const options = reactionsOf(actor, "gainsCondition", { target: actor, targetToken: token, condition }, { publish: true });
    if ( !options.length ) continue;
    const label = game.i18n.localize(CONFIG.DND5E.conditionTypes[condition]?.name ?? condition);
    log(`${actor.name} subit ${label} : fenêtre de réaction (${options.map(o => o.name).join(", ")})`);
    const answer = await askReaction(actor, { actor: actor.uuid, prompt: { key: "ReactionEtat", data: { condition: label } }, options });
    if ( !answer?.endCondition ) continue;
    const ids = actor.effects.filter(e => e.statuses?.has(condition)).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${actor.name} : ${answer.name}, ${label} cesse (${ids.length} effet(s))`);
  }
}

/** Les effets qu'une réaction `forOneAttack` a posés sur son porteur : retirés, l'attaque jugée. */
async function dropOneAttackEffects(actor, activityUuid) {
  const item = (await fromUuid(activityUuid))?.item;
  if ( !actor || !item || (contentOf(item).entry?.forOneAttack !== true) ) return;
  const ids = actor.effects.filter(e => originItemOf(e) === item).map(e => e.id);
  if ( ids.length ) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    log(`${item.name} : effet retiré, il ne valait que pour cette attaque`);
  }
}

/**
 * §19.6 : fenêtre « raté » — l'attaque vient de rater ces créatures (riposte, désarmement, pas brumeux). Sans
 * attente, comme « blessé » : la réaction vise l'attaquant et suit son propre cours.
 */
/* -------------------------------------------- */
/*  §34 : avant le jet d'attaque                */
/* -------------------------------------------- */

/**
 * Ce que les réactions d'avant le jet (et le Présage, §36) ont décidé pour la prochaine attaque de cette activité (client de
 * l'attaquant). Chaque passage à la porte remplace ce qui restait (`mods` null : plus rien) ; un jet qui n'a pas suivi (fenêtre du jet
 * fermée) ne lègue rien à une attaque bien plus tard : au-delà de `ATTACK_MODS_TTL`, c'est oublié.
 */
const attackMods = new Map();
const ATTACK_MODS_TTL = 120000;
export function rememberAttackMods(activityUuid, mods) {
  if ( mods ) attackMods.set(activityUuid, { mods, at: Date.now() });
  else attackMods.delete(activityUuid);
}
export function takeAttackMods(activityUuid) {
  const kept = attackMods.get(activityUuid) ?? null;
  attackMods.delete(activityUuid);
  return (kept && ((Date.now() - kept.at) <= ATTACK_MODS_TTL)) ? kept.mods : null;
}

/**
 * Qui peut réagir avant ce jet d'attaque, et avec quoi : la cible elle-même (`isAttacked` : Esquive des ombres), et toute créature
 * de la scène alliée de la cible et hostile à l'attaquant, la cible comprise (`enemyAttacks` : Éclat protecteur). Vivantes.
 * @returns {Array<{token: TokenDocument, target: TokenDocument, options: object[]}>}
 */
export function attackReactors(activity, origin, targets) {
  const out = [];
  const alive = t => t?.actor && !isObjectToken(t) && ((t.actor.system.attributes?.hp?.value ?? 1) > 0);
  for ( const target of targets ) {
    if ( !alive(target) ) continue;
    const own = reactionsOf(target.actor, "isAttacked", { source: origin.actor, target: target.actor, activity, sourceToken: origin, targetToken: target }, { publish: true });
    if ( own.length ) out.push({ token: target, target, options: own });
    for ( const other of target.parent?.tokens ?? [] ) {
      if ( (other === origin) || !alive(other) || other.hidden ) continue;
      if ( areHostile(other.disposition, target.disposition) || !areHostile(other.disposition, origin.disposition) ) continue;
      const options = reactionsOf(other.actor, "enemyAttacks", { source: origin.actor, target: target.actor, activity, self: other.actor,
        selfToken: other, sourceToken: origin, targetToken: target }, { publish: true });
      if ( options.length && !out.some(o => o.token === other) ) out.push({ token: other, target, options });
    }
  }
  // §36 : le pendant — toute créature de la scène du même camp que l'attaquant (autre que lui) et hostile à une cible (`allyAttacks` :
  // Présage cosmique, Fortune). Une fenêtre par réacteur, contre la première cible qui lui est hostile. Un neutre n'a pas d'alliés.
  for ( const other of origin.parent?.tokens ?? [] ) {
    if ( (other === origin) || !alive(other) || other.hidden || out.some(o => o.token === other) ) continue;
    if ( ![1, -1].includes(origin.disposition) || (other.disposition !== origin.disposition) ) continue;
    const target = targets.find(t => alive(t) && areHostile(other.disposition, t.disposition));
    if ( !target ) continue;
    const options = reactionsOf(other.actor, "allyAttacks", { source: origin.actor, target: target.actor, activity, self: other.actor,
      selfToken: other, sourceToken: origin, targetToken: target }, { publish: true });
    if ( options.length ) out.push({ token: other, target, options });
  }
  return out;
}

/**
 * La fenêtre, réacteur après réacteur (chacun sa réaction, ses ressources) : rend ce qui vaut pour le jet — Désavantage, dés
 * retirés (`penalty`), dés ajoutés (`bonus`, §36) et les noms —, ou null si personne n'a réagi.
 */
export async function askAttackReactions(activity, origin, reactors, { auto=null }={}) {
  const mods = { disadvantage: false, penalty: 0, bonus: 0, names: [] };
  for ( const { token, target, options } of reactors ) {
    const answer = await askReaction(token.actor, {
      actor: token.actor.uuid,
      prompt: { key: (token === target) ? "ReactionAvantAttaque" : "ReactionAvantAttaqueAllie", data: { attacker: origin.name, name: target.name } },
      options,
      target: options.some(o => o.targetSource) ? origin.uuid : null,
      auto: auto === "first"
    });
    if ( !answer ) continue;
    if ( answer.disadvantage ) mods.disadvantage = true;
    mods.penalty += Number(answer.penalty) || 0;
    mods.bonus += Number(answer.bonus) || 0;
    mods.names.push(answer.name);
    log(`${token.name} réagit avant l'attaque de ${origin.name} : ${answer.name}${answer.disadvantage ? " (Désavantage)" : ""}${answer.penalty ? ` (-${answer.penalty})` : ""}${answer.bonus ? ` (+${answer.bonus})` : ""}`);
  }
  return mods.names.length ? mods : null;
}

export function windowIsMissed(tokenUuids, sourceToken, sourceName, { activity=null, auto=null }={}) {
  if ( auto === "none" ) return;
  for ( const uuid of tokenUuids ) (async () => {
    const tokenDocument = await fromUuid(uuid);
    const actor = tokenDocument?.actor;
    if ( !actor || ((actor.system.attributes?.hp?.value ?? 0) <= 0) ) return;
    const attackerToken = await fromUuid(sourceToken ?? "");
    const used = activity ? await fromUuid(activity) : null;
    const options = reactionsOf(actor, "isMissed",
      { source: attackerToken?.actor ?? null, target: actor, activity: used, sourceToken: attackerToken, targetToken: tokenDocument }, { publish: true });
    if ( !options.length ) return;
    log(`${actor.name} est raté : fenêtre de réaction (${options.map(o => o.name).join(", ")})`);
    await askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionRate", data: { attacker: sourceName } },
      options,
      target: options.some(o => o.targetSource) ? sourceToken : null,
      auto: auto === "first"
    });
  })().catch(err => console.error(`${MODULE_ID} | fenêtre « raté » interrompue`, err));
}

/**
 * §19.6 : fenêtre « un ennemi finit son tour » — chaque créature hostile à celle dont le tour s'achève peut réagir contre elle
 * (un ennemi qui finit son tour à 1,50 m de la créature). MJ actif, sans attente.
 */
function onEnemyTurnEnd(combat, prior) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  if ( !ended?.actor || !ended.parent ) return;
  for ( const other of ended.parent.tokens ) {
    const actor = other.actor;
    if ( !actor || (other === ended) || isObjectToken(other) || !areHostile(other.disposition, ended.disposition) ) continue;
    if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) continue;
    const options = reactionsOf(actor, "enemyTurnEnd",
      { source: ended.actor, target: actor, sourceToken: ended, targetToken: other }, { publish: true });
    if ( !options.length ) continue;
    log(`${ended.name} termine son tour : ${actor.name} peut réagir (${options.map(o => o.name).join(", ")})`);
    askReaction(actor, {
      actor: actor.uuid,
      prompt: { key: "ReactionFinDeTour", data: { attacker: ended.name } },
      options,
      target: options.some(o => o.targetSource) ? ended.uuid : null
    }).catch(err => console.error(`${MODULE_ID} | fenêtre « fin de tour d'un ennemi » interrompue`, err));
  }
}

/* -------------------------------------------- */
/*  Attaque d'opportunité                       */
/* -------------------------------------------- */

/**
 * Qui menace d'une attaque d'opportunité un déplacement PRÉVU. Synchrone : appelé depuis
 * `preMoveToken`, sur le client de celui qui bouge. On suit le chemin case par case : quitter une
 * allonge en cours de route compte, pas seulement entre le départ et l'arrivée.
 * @param {TokenDocument} token
 * @param {object[]} waypoints  Le chemin prévu, départ exclu.
 * @returns {string[]}  UUID des tokens qui peuvent réagir.
 */
export function opportunityThreats(token, waypoints) {
  if ( !game.combat?.started || !token.actor || !waypoints.length ) return [];
  const mover = combatantFor(token.actor);
  if ( !mover ) return [];
  // §16.15 : un objet piloté (Arme spirituelle) n'est pas une créature qui quitte une allonge.
  if ( pilotOf(token) ) return [];
  const teleported = waypoints.some(w => CONFIG.Token.movement.actions[w.action]?.teleport || (w.action === "displace"));
  const factors = readUnitFactors();
  const gridUnits = token.parent.grid.units;
  const origin = position(token._source);
  const path = token.getCompleteMovementPath([origin, ...waypoints]).map(position);

  const others = [];
  const dragged = victimsOf(token);
  for ( const combatant of game.combat.combatants ) {
    const other = combatant.token;
    if ( !other?.actor || (other === token) || combatant.isDefeated || (other.parent !== token.parent) ) continue;
    // Une victime traînée par cet agrippeur le suit : elle ne voit pas « partir » celui qui l'emporte.
    if ( dragged.includes(other) ) continue;
    if ( pilotOf(other) ) continue;   // ni ne menace d'attaque d'opportunité
    if ( opportunityBlocked(other.actor) ) continue;   // §23 : Poigne électrique
    const melee = meleeAttacksOf(other.actor);
    let reach = melee.reach;
    try { reach = convertLength(melee.reach, melee.units, gridUnits, factors); } catch { /* unité inconnue : valeur brute */ }
    const distances = path.map(pos => distanceBetween(other, token, { posB: pos }).value);
    let leaves = -1;
    for ( let n = 0; n < distances.length - 1; n++ ) {
      if ( (distances[n] <= reach + 1e-6) && (distances[n + 1] > reach + 1e-6) ) { leaves = n; break; }
    }
    others.push({
      token: other.uuid, disposition: other.disposition, reach,
      before: leaves >= 0 ? distances[leaves] : distances[0],
      after: leaves >= 0 ? distances[leaves + 1] : distances.at(-1),
      hasMeleeAttack: melee.options.length > 0,
      // P2 : peut-elle frapper celui qui bouge, là où il quitte son allonge (plancher, trappe, mur plein) ?
      hasLineOfEffect: ((leaves >= 0) || (distances[0] <= reach + 1e-6)) ? hasLineOfEffect(other, token, { posB: path[Math.max(leaves, 0)] }) : null,
      seesMover: canSee(other, token) ?? true,   // P1 : « une créature que vous pouvez voir » (position d'avant le déplacement)
      ...reactionState(other.actor)
    });
  }
  return opportunityAttackers({
    // §18.15 : Agile, Vol rasant — comme un Désengagement, pour ce déplacement.
    disposition: token.disposition, teleported,
    disengaged: (readBudget(mover).disengaged === true) || avoidsOpportunity(token.actor, token, waypoints)
  }, others);
}

export const OPPORTUNITY_QUERY = `${MODULE_ID}.opportunity`;
const RESOLUTION_WAIT = 20000;

/** Attend que l'attaque née d'un message d'utilisation soit jugée, dégâts appliqués compris. */
async function attackSettled(usageId) {
  const over = () => game.messages.contents.some(m => {
    const r = current(m.getFlag(MODULE_ID, "resolution"));
    return ((r?.carrier === usageId) || (r?.origin === usageId)) && ["done", "missed", "undone"].includes(r.step);
  });
  const until = Date.now() + RESOLUTION_WAIT;
  while ( !over() && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 250));
}

/** Côté MJ actif : propose chaque attaque d'opportunité, l'une après l'autre, et attend son issue. */
async function handleOpportunityQuery({ token: tokenUuid, attackers }) {
  const token = await fromUuid(tokenUuid);
  for ( const uuid of attackers ) {
    const attacker = await fromUuid(uuid);
    if ( !attacker?.actor || !token ) continue;
    log(`${token.name} va quitter l'allonge de ${attacker.name} : attaque d'opportunité proposée avant le déplacement`);
    announce("leavesReach", { actor: attacker.actor, source: token.actor, target: attacker.actor, mover: token.uuid });
    const answer = await askReaction(attacker.actor, {
      actor: attacker.actor.uuid,
      prompt: { key: "ReactionOpportunite", data: { mover: token.name } },
      // §16.26 : Mage de guerre — un sort visant la seule créature qui s'en va, au lieu de l'attaque.
      options: [...meleeAttacksOf(attacker.actor).options, ...reactiveSpellsOf(attacker.actor)],
      target: token.uuid
    });
    if ( answer?.message ) await attackSettled(answer.message);
  }
  return true;
}

/**
 * Règle les attaques d'opportunité AVANT le déplacement. Rend false si celui qui bouge n'est
 * plus en état de le faire (tombé à 0 PV).
 */
export async function resolveOpportunity(token, attackers) {
  if ( !attackers.length ) return true;
  const gm = game.users.activeGM;
  try {
    if ( gm?.isSelf ) await handleOpportunityQuery({ token: token.uuid, attackers });
    else if ( gm ) await gm.query(OPPORTUNITY_QUERY, { token: token.uuid, attackers }, { timeout: 120000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | attaques d'opportunité : pas de réponse du MJ`, err);
  }
  return (token.actor?.system.attributes?.hp?.value ?? 1) > 0;
}

/* -------------------------------------------- */

export function registerReactions() {
  route("combatTurnChange", (combat, prior) => onEnemyTurnEnd(combat, prior), { executor: true, label: "fenêtre « fin de tour d'un ennemi » non ouverte" });
  // Sur tous les clients : c'est celui qui réagit qui répond à la requête.
  CONFIG.queries[REACTION_QUERY] = handleReactionQuery;
  setReactionApproach(reactionApproach);   // §67 : la réaction qui rejoint d'abord sa source

  // Les attaques d'opportunité se règlent avant le déplacement (runtime/actions.mjs, preMoveToken).
  CONFIG.queries[OPPORTUNITY_QUERY] = handleOpportunityQuery;
  // §19.8 : « subit un état » — un effet porteur d'état vient d'être posé sur une créature.
  route("createActiveEffect", effect => (effect.statuses?.size ? windowGainsCondition(effect) : null),
    { executor: true, label: "fenêtre « subit un état » non ouverte" });
}
