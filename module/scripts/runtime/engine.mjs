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
import { isAutoCritical, autoFailSave } from "../core/conditions.mjs";
import { unaffectedBy } from "../adapter/eligibility.mjs";
import { restoreHp, rollDamageFor } from "../adapter/messages.mjs";
import { removeEffects, TARGETS_QUERY, handleTargetsQuery, SAVE_QUERY, handleSaveQuery } from "../adapter/saves.mjs";
import { statusesOf, areAdjacent, evades, coverAgainst } from "../adapter/conditions.mjs";
import { currentAc } from "../adapter/reactions.mjs";
import { CHOICE_QUERY, handleChoiceQuery } from "../adapter/choices.mjs";
import { ALLOCATION_QUERY, handleAllocationQuery } from "../adapter/projectiles.mjs";
import { canJudgeCover, isCoverAvailable } from "../adapter/cover.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { createDispatcher } from "./dispatcher.mjs";
import { canReactToHit } from "./reactions.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { duplicatesAgainst } from "../adapter/duplicates.mjs";
import { log, loc, isExecutor, whenCanvasReady } from "./shared.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { areAllies } from "../adapter/factions.mjs";
import { COMMANDS } from "./engine-commands.mjs";
import { onAttackMessage, onDamageMessage, onSaveMessage, onUsageMessage } from "./engine-messages.mjs";
import { onRegionCreated } from "./engine-areas.mjs";

/** Combien de messages récents on remonte quand un jet ne dit pas à quelle action il se rapporte. */
export const LOOKBACK = 50;

/** La résolution d'un porteur, y compris celle pas encore écrite (écritures regroupées, runtime/dispatcher.mjs). */
export const resolutionOn = message => message ? current(dispatcher.peek(message.id)) : null;

/** Réglage « journal de chat allégé » : écritures de la résolution regroupées (ici) et cartes hors écran non dessinées (ui/chat.mjs). */
export const CHAT_LIGHT_SETTING = "chatLight";

/** Le token qui parle dans un message, ou null. */
export function speakerTokenUuid(message) {
  const { scene, token } = message?.speaker ?? {};
  return scene && token ? `Scene.${scene}.Token.${token}` : null;
}

/** Les propriétés de dégâts sont un Set côté système, un tableau dans un flag. */
export const serializeDamages = damages => damages.map(d => ({ ...d, properties: Array.from(d.properties ?? []) }));
/** La créature porte-t-elle un effet d'un item `healMax` (Lueur d'espoir) — effet posé ou transféré ? */
/**
 * §160 : le palier de PV (`hpTiers` du contenu) qui vaut pour cette cible, lu sur ses PV actuels (avant les dégâts) : l'entrée du plan
 * réécrite (dégâts retirés si `damage: false`, effets réduits à `effects`) et les états à poser. Null sans paliers.
 */
export function hpTierFor(item, actor, entry, plan=null) {
  const tiers = item ? contentOf(item).entry?.hpTiers : null;
  if ( !tiers?.length || !actor ) return null;
  const hp = Number(actor.system?.attributes?.hp?.value ?? 0);
  const tier = tiers.find(t => !("atMost" in t) || (hp <= t.atMost));
  if ( !tier ) return { hp, statuses: [], entry: { ...entry, multiplier: 0, effects: [], steps: [] } };
  // Un sort à sauvegarde (Parole divine) ne pose ses états que sur une sauvegarde ratée : la cible qui a réussi n'a reçu aucun effet.
  const failed = !plan?.save || ((entry.effects ?? []).length > 0);
  return { hp, statuses: failed ? (tier.statuses ?? []) : [], entry: {
    ...entry,
    multiplier: (tier.damage === false) ? 0 : entry.multiplier,
    effects: tier.effects ? (entry.effects ?? []).filter(e => tier.effects.includes(e.id)) : entry.effects
  } };
}

/** §161 : le niveau auquel le sort du message est lancé — celui de l'item, plus la montée d'emplacement que dnd5e note (`scaling`). */
export function castLevelOfMessage(message) {
  const item = message?.getAssociatedActivity?.()?.item ?? message?.getAssociatedItem?.() ?? null;
  if ( item?.type !== "spell" ) return null;
  return Number(item.system?.level ?? 0) + (Number(message.getFlag?.("dnd5e", "scaling")) || 0);
}

/** §164 : les couleurs d'Embruns prismatiques — 1 à 5, un type de dégâts ; 6, indigo ; 7, violet. */
const PRISM_TYPES = Object.freeze({ 1: "fire", 2: "acid", 3: "lightning", 4: "poison", 5: "cold" });

/**
 * §164 : Embruns prismatiques (`prismatic`) — un d8 par cible ; sur un 8, deux rayons (les 8 relancés). Rend les couleurs tirées,
 * l'entrée du plan réduite à leurs effets (sans dégâts s'il n'y a que de l'indigo ou du violet) et les types de dégâts. Null sans la règle.
 */
export async function prismaticFor(item, entry, activity=null, plan=null) {
  const rule = item ? contentOf(item).entry?.prismatic : null;
  if ( !rule ) return null;
  // L'activité qui a fait le jet : un rejeu de zone par une sœur garde, dans ses drapeaux, l'activité de la pose — celle de la
  // sauvegarde du plan dit la sœur (Mur prismatique : la « Traversal Save »).
  const ids = [activity?.id, String(plan?.save?.activity ?? "").split(".").pop()].filter(Boolean);
  if ( rule.activities && !rule.activities.some(id => ids.includes(id)) ) return null;
  const d8 = async () => (await new Roll("1d8").evaluate()).total;
  // §173 : le Mur prismatique traversé — toutes les couches à la fois (une sauvegarde pour toutes : simplification).
  let colors = rule.all ? [1, 2, 3, 4, 5, 6, 7] : [await d8()];
  if ( colors[0] === 8 ) {
    colors = [];
    while ( colors.length < 2 ) { const c = await d8(); if ( c !== 8 ) colors.push(c); }
  }
  const types = colors.filter(c => PRISM_TYPES[c]).map(c => PRISM_TYPES[c]);
  const keep = [colors.includes(6) ? rule.indigo : null, colors.includes(7) ? rule.violet : null].filter(Boolean);
  return { colors, types, entry: { ...entry, multiplier: types.length ? entry.multiplier : 0, effects: (entry.effects ?? []).filter(e => keep.includes(e.id)) } };
}

export function healsMax(actor) {
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
export function healsDownedToMax(healer, activity, target) {
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
export function slotHealBonus(healer, activity) {
  const item = activity?.item;
  const level = Number(item?.system?.level) || 0;
  if ( !healer || (item?.type !== "spell") || (level < 1) || !["spell", "pact", undefined, ""].includes(item.system.method) ) return null;
  const has = key => healer.items.some(i => contentOf(i).entry?.[key] === true);
  const bonus = { disciple: has("discipleOfLife") ? 2 + level : 0, healer: has("blessedHealer") ? 2 + level : 0 };
  return (bonus.disciple || bonus.healer) ? bonus : null;
}

export const deserializeDamages = damages => damages.map(d => ({ ...d, properties: new Set(d.properties ?? []) }));

/** Le temps qu'une zone instantanée reste visible après sa résolution (animations d'autres modules comprises). */
export const TRANSIENT_LINGER_MS = 4000;

export const dispatcher = createDispatcher({
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
export async function enrich(targets, plan, originUuid, activityUuid=null, attackMode=null, castLevel=null) {
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
    // §131 : un don de tir (Tireur d'élite, Sniper de sorts) ignore l'abri partiel ou aux trois quarts.
    const cover = (origin && token && (target.ac !== null) && (target.ac !== undefined)) ? coverAgainst(origin, token, activity, attackMode) : null;
    const ac = cover ? ((cover.bonus === null) ? null : target.ac + cover.bonus) : target.ac;
    // §16.8 : type de créature, règle du contenu, immunité à tous les effets — la cible reste lisible, hors d'atteinte.
    const unaffected = await unaffectedBy(activity, plan, token, { castLevel });
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
      sculpted: (sculpts > 0) && !!token && !!casterToken && (token.actor !== caster) && areAllies(token, casterToken)
        && (sculpts-- > 0),
      unaffected
    });
  }
  return out;
}

/** Données d'`open()` du cœur pour un message, ou null s'il n'y a rien à résoudre. */
export async function openingFor(message, usage, extra={}) {
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
  let targets = await enrich(usage.targets, usage.plan, speakerTokenUuid(message), usage.activity, null, castLevelOfMessage(message));
  // §169 : un rejeu sans sauvegarde (Mur de feu traversé, fin de tour du côté brûlant) — les dégâts pleins, d'office.
  if ( usage.plan.save && message.getFlag(MODULE_ID, "areaTick")?.noSave ) targets = targets.map(t => ({ ...t, autoFail: "noSave" }));
  return { id: foundry.utils.randomID(), ...data, choice, allocation, targets, ...extra };
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
