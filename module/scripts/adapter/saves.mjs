/**
 * Activités à jet de sauvegarde de dnd5e 6.0 : lecture des messages, demandes de jet, effets.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - ce qu'un message d'utilisation demande au moteur se lit dans adapter/usage.mjs
 *  - le bouton « Sauvegarde » de la carte lance `actor.rollSavingThrow` avec
 *    `system.origin = id du message d'utilisation` (documents/activity/save.mjs:117-135)
 *  - le système sait demander un jet à un joueur : message `type: "request"`, `handler: "save"`,
 *    dont le résultat porte `flags.dnd5e.requestResult.requestId`
 *    (data/chat-message/request-message-data.mjs, documents/actor/actor.mjs:1272-1277).
 *    On le réutilise tel quel : un seul propriétaire de l'interface de demande de jet.
 *  - `SaveActivity#rollDamage` inscrit `system.onSave` sur le message de dégâts (save.mjs:86-91)
 */

import { isThinWall, touchesWallRegion } from "./wall-side.mjs";
import { MODULE_ID } from "../constants.mjs";
import { rollerFor } from "./concentration.mjs";
import { committedPosition, usageTokenOf } from "./turn.mjs";
import { areaOriginOf, reachesFromPoint, sphereOf, insideSphere, shapesReach } from "./space.mjs";
import { effectOfProfile } from "./usage.mjs";
import { timedWait, closeRollDialogAfter } from "./dialogs.mjs";
import { queryPlayer, waitLabel } from "./player-wait.mjs";
import { originItemOf, creatureTypeOf } from "./facts.mjs";
import { contentOf } from "./content.mjs";
import { grappleRulesOf } from "./grapple-rules.mjs";
import { fightingAdvantage } from "../core/conditions.mjs";
import { sizeAtLeast } from "../core/content/enums.mjs";
import { isObjectToken } from "./bodies.mjs";
import { usageMetamagic } from "./metamagic.mjs";
import { foretellFor } from "./portent.mjs";
import { foretoldRange } from "../core/portent.mjs";
import { isSpellCast } from "./scrolls.mjs";
import { normalizeTargetModes, saveModeFor } from "../core/target-modes.mjs";
import { areEnemies, sideOf, factionOf } from "./factions.mjs";
import { samePlane } from "./plane.mjs";
export { applyEffectsToToken, applyMarkToToken, applyStatusToToken, removeEffects, splitPushes } from "./apply-effects.mjs";
export { TARGETS_QUERY, handleTargetsQuery, showTargetsTo } from "./show-targets.mjs";

/**
 * L'activité d'un plan, telle que le message porteur la voit (mise à l'échelle du sort comprise).
 * `uuid` peut désigner une autre activité du même item : la sauvegarde imposée par une attaque.
 */
export function activityFor(carrier, uuid=null) {
  const primary = carrier.getAssociatedActivity?.({ scaled: true }) ?? null;
  if ( !uuid || !primary || (primary.uuid === uuid) ) return primary;
  return primary.item?.system.activities?.find(a => a.uuid === uuid) ?? fromUuidSync(uuid) ?? null;
}

/**
 * Ce qu'une région posée par une activité (template-placement.mjs:150-163) permet de savoir.
 * @param {RegionDocument} region
 * @returns {Promise<object|null>}  null si la région ne vient pas d'une activité.
 */
/** Qui une zone affecte : `ally`, `enemy`, ou "" (tout le monde) ; une zone « au choix » épargne les alliés. */
export function areaAffects(activity) {
  // §86 : ce que le contenu dit de la zone de l'item prime (Présence royale de Yolande : les alliés épargnés).
  const declared = activity?.item ? contentOf(activity.item).entry?.zoneAffects : null;
  if ( declared ) return declared;
  const affects = activity?.target?.affects ?? {};
  const type = affects.type ?? "";
  if ( ["ally", "enemy"].includes(type) ) return type;
  return affects.choice ? "enemy" : type;
}

export async function readActivityRegion(region) {
  const uuid = region.getFlag("dnd5e", "activity");
  if ( !uuid ) return null;
  const activity = await fromUuid(uuid);
  const origin = region.getFlag("dnd5e", "origin") ?? null;
  const originToken = origin ? await fromUuid(origin) : null;
  // P2 : le point d'origine de la zone, pour la ligne d'effet (un plancher entre la zone et la créature).
  const areaOrigin = areaOriginOf(region, originToken);
  // P2 : une vraie sphère — la tranche de la région en fait un cylindre, ses coins sont hors de la sphère.
  const sphere = sphereOf(region, activity, originToken);
  const thinWall = isThinWall(region);
  // §286 : les `count` gabarits que dnd5e pose dans une seule région — pas les segments d'un mur (une forme par segment).
  const several = !thinWall && ((Number(activity?.target?.template?.count) || 1) > 1) && ((region.shapes?.length ?? 0) > 1);
  return {
    activity: uuid,
    origin,
    originDisposition: originToken?.disposition ?? null,
    originSide: originToken ? sideOf(originToken) : null,   // §181
    excludeOrigin: activity?.range?.units === "self",
    // « Vous pouvez désigner des créatures qui ne sont pas affectées » (`affects.choice`, Esprits gardiens) : par défaut,
    // les alliés du lanceur sont épargnés — le moteur ne pose pas la question (§16.23).
    affects: areaAffects(activity),
    // Appartenance calculée par le cœur (TokenDocument#testInsideRegion, client/documents/token.mjs:3236).
    // §169, §173 : un mur fin, posé entre les cases — « dans sa zone » à l'apparition : l'espace touche le mur.
    candidates: region.parent.tokens.filter(t => t.actor && !isObjectToken(t)
      && (thinWall ? touchesWallRegion(region, t) : t.testInsideRegion(region, committedPosition(t)))).map(t => ({
      token: t.uuid,
      actor: t.actor.uuid,
      name: t.name,
      disposition: t.disposition,
      faction: factionOf(t), stance: t.getFlag(MODULE_ID, "stance") ?? null,   // §181
      defeated: t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true,
      // §286 : plusieurs formes (Nuée de météores, Tempête de feu) — chacune son origine ; prise une seule fois.
      ...(several ? shapesReach(region, activity, originToken, t) : { lineOfEffect: reachesFromPoint(areaOrigin, t), inVolume: insideSphere(sphere, t) }),
      offPlane: originToken ? !samePlane(originToken, t) : false   // §225 : la zone est sur le plan de son lanceur
    }))
  };
}

/**
 * @param {ChatMessage} message  Message de type "save".
 * @returns {{origin: string|null, request: string|null, actor: string|null, total: number}|null}
 */
export function readSaveMessage(message) {
  const roll = message.rolls?.[0];
  if ( !roll || (message.system?.type && (message.system.type !== "ability")) ) return null;   // ni concentration ni mort
  return {
    origin: message._source.system?.origin ?? null,
    request: message.getFlag("dnd5e", "requestResult")?.requestId ?? null,
    actor: message.getAssociatedActor?.()?.uuid ?? null,
    total: roll.total,
    // §231 : le mode du d20, pour le retour visuel (Avantage / Désavantage).
    mode: (roll.hasAdvantage === true) ? "advantage" : (roll.hasDisadvantage === true) ? "disadvantage" : null
  };
}

export const SAVE_QUERY = `${MODULE_ID}.rollSave`;
const SAVE_TIMEOUT = 40000;   // deux fenêtres possibles (choix, jet), chacune bornée par adapter/dialogs.mjs

/** Paramètres du jet, les mêmes que le bouton « Sauvegarde » de la carte (save.mjs:122-134). */
function saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage=false, disadvantage=false, foretold=null }) {
  const bonus = CONFIG.Dice.BasicRoll.constructParts({ activityBonus: activity.save.bonus }, activity.getRollData());
  const rollConfig = { ability, target: dc };
  // §16.25 : Ascendance féerique — l'avantage contre une activité qui pose un état que l'un de ses items désigne.
  if ( saveAdvantageAgainst(actor, activity) || fightingAdvantageFor(activity, token) || sizeAdvantageFor(actor, activity) ) rollConfig.advantage = true;
  // §32 : Sort intensifié (la cible choisie par requestSaves) ; §249 : le mode donné par cible dans le message d'utilisation.
  if ( advantage ) rollConfig.advantage = true;
  if ( disadvantage ) rollConfig.disadvantage = true;
  // §36 : Présage — le d20 remplacé par le jet noté (bornes du dé, adapter/portent.mjs).
  if ( Number.isInteger(foretold) ) rollConfig.rolls = [{ ...bonus, options: foretoldRange(foretold) }];
  else if ( bonus.parts.length ) rollConfig.rolls = [bonus];
  return [rollConfig, {
    data: {
      speaker: ChatMessage.getSpeaker({ actor, scene: token.parent, token }),
      system: { ...activity.messageSources, origin: usageMessage.id }
    }
  }];
}

/**
 * §32 : Sort intensifié — « le Désavantage à une cible du sort » : parmi les cibles dont on demande la sauvegarde, la première hostile
 * au lanceur (uuid de token), ou null si la carte ne porte pas l'option.
 */
function heightenedTarget(activity, usageMessage, targets) {
  if ( !usageMetamagic(usageMessage).includes("heightened") ) return null;
  const caster = usageTokenOf(activity);
  for ( const t of targets ) {
    const token = fromUuidSync(t.token ?? "", { strict: false });
    if ( token && caster && areEnemies(caster, token) ) return token.uuid;
  }
  return null;
}

/**
 * §16.47 : « avantage si vous ou vos alliés la combattez » (`advantageIfFighting` : Charme-personne) — la cible est dans un
 * combat commencé et hostile au lanceur.
 */
export function fightingAdvantageFor(activity, token) {
  if ( !token || (contentOf(activity?.item).entry?.advantageIfFighting !== true) ) return false;
  const caster = usageTokenOf(activity);
  const targetInCombat = game.combats.some(c => c.started && c.combatants.some(x => x.tokenId === token.id));
  return fightingAdvantage({ targetInCombat, hostile: !!caster && areEnemies(caster, token) });
}

/**
 * §206 : « une créature de taille G ou supérieure a l'Avantage à ce jet » (`saveAdvantageSize` sur l'item de l'activité : Frappe
 * piégeuse). La taille est celle de la fiche (`system.traits.size`).
 */
export function sizeAdvantageFor(actor, activity) {
  const min = contentOf(activity?.item).entry?.saveAdvantageSize;
  return !!min && !!actor && sizeAtLeast(actor.system?.traits?.size, min);
}

/** Les états que posent les effets d'une activité (profils `activity.effects[]`, lus par `effectOfProfile`, §126). */
function statusesPosedBy(activity) {
  return new Set((activity?.effects ?? []).flatMap(ref => [...(effectOfProfile(ref, activity.item)?.statuses ?? [])]));
}

/**
 * « Sorts et autres effets magiques » (Résistance à la magie, §18.9) : un sort — y compris la copie qu'Incantation crée
 * (`flags.dnd5e.cachedFor`, de type « spell ») —, ou un item à la propriété Magique (`mgc`) de dnd5e.
 */
export function isMagical(activity) {
  const item = activity?.item;
  if ( !item ) return false;
  return (item.type === "spell") || (item.system?.properties?.has?.("mgc") === true);
}

/**
 * L'acteur a-t-il l'avantage à la sauvegarde de cette activité (`saveAdvantage`) ? Ce qui le donne : un item qu'il porte
 * (Ascendance féerique, Résistance à la magie), ou, pour un sort, un effet de ce sort posé sur lui (Protection contre le
 * poison) — le lanceur, qui a le sort sur sa fiche, n'en profite pas pour autant.
 */
export function saveAdvantageAgainst(actor, activity) {
  const posed = statusesPosedBy(activity);
  const magical = isMagical(activity);
  if ( !posed.size && !magical ) return false;
  // §48 : ni un sort de sa fiche, ni un parchemin qu'il porte — c'est l'effet posé qui compte.
  const owned = (actor?.items ?? []).filter(item => !isSpellCast(item));
  const borne = (actor?.effects ?? []).filter(e => !e.disabled && !e.isSuppressed).map(originItemOf)
    .filter(item => isSpellCast(item));
  return [...owned, ...borne].some(item => (contentOf(item).entry?.saveAdvantage ?? [])
    .some(s => posed.has(s) || ((s === "magic") && magical)));
}

/**
 * Plusieurs caractéristiques au choix de la cible (Lutte / Bousculade : Force ou Dextérité) : la
 * meilleure sauvegarde pour elle — le choix de n'importe quel joueur. Le système, lui, met un bouton
 * par caractéristique sur la carte (documents/activity/save.mjs:55-71) ; la fenêtre du jet ne permet pas
 * d'en changer.
 */
export function bestSaveAbility(actor, abilities) {
  const bonus = a => actor.system.abilities?.[a]?.save?.value ?? actor.system.abilities?.[a]?.mod ?? -Infinity;
  return abilities.reduce((best, a) => (bonus(a) > bonus(best) ? a : best), abilities[0]);
}

/**
 * La cible choisit sa caractéristique (Lutte / Bousculade : « c'est elle qui choisit », glossaire du PHB) :
 * une fenêtre « Force (+x) / Dextérité (+y) » chez celui qui la contrôle — le joueur, ou le MJ pour un PNJ.
 * Fermée sans choix : la meilleure.
 * @returns {Promise<string>}
 */
export async function chooseSaveAbility(actor, abilities, { dc, item }) {
  const best = bestSaveAbility(actor, abilities);
  const signed = n => (n >= 0 ? `+${n}` : `${n}`);
  const buttons = abilities.map(a => ({
    action: a,
    label: `${game.i18n.localize(CONFIG.DND5E.abilities[a]?.label ?? a)} (${signed(actor.system.abilities?.[a]?.save?.value ?? 0)})`,
    default: a === best
  }));
  // Sans réponse dans le délai : la meilleure.
  const choice = await timedWait({
    window: { title: game.i18n.format("DND5ECOMBAT.ChoixSauvegarde.Titre", { name: actor.name }) },
    content: `<p>${game.i18n.format("DND5ECOMBAT.ChoixSauvegarde.Texte", { item, dc })}</p>`,
    buttons
  }, { fallback: best });
  return abilities.includes(choice) ? choice : best;
}

/**
 * Côté joueur : la fenêtre du jet de sauvegarde s'ouvre sur SON écran, ce sont ses dés. Le jet
 * n'est jamais lancé à sa place ; fenêtre fermée → false, et le MJ actif lui laisse la carte de
 * demande du système pour qu'il lance quand il veut. Plusieurs caractéristiques au choix : il choisit d'abord.
 */
export async function handleSaveQuery({ usage, token: tokenUuid, ability, abilities=null, ask=true, dc, item, activity: activityUuid=null, advantage=false, disadvantage=false, foretold=null }) {
  const usageMessage = game.messages.get(usage);
  const token = await fromUuid(tokenUuid);
  const actor = token?.actor;
  const activity = usageMessage ? activityFor(usageMessage, activityUuid) : null;
  if ( !actor || !activity ) return false;
  ui.notifications.info(game.i18n.format("DND5ECOMBAT.DemandeSauvegardeJoueur", { name: actor.name, item }));
  if ( ask && (abilities?.length > 1) ) ability = await chooseSaveAbility(actor, abilities, { dc, item });
  // La fenêtre du jet se ferme au bout du délai ; le jet part alors seul (ses dés, sans dialogue).
  let timedOut = false;
  const cancel = closeRollDialogAfter(actor, () => { timedOut = true; });
  const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
  let rolls = await actor.rollSavingThrow(rollConfig, { configure: true }, messageConfig);
  cancel();
  if ( !rolls?.length && timedOut ) {
    const [again, againMessage] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
    rolls = await actor.rollSavingThrow(again, { configure: false }, againMessage);
  }
  return !!rolls?.length;
}

/**
 * Fait lancer les sauvegardes attendues : le moteur lance pour les PNJ (et les PJ sans joueur
 * connecté) ; chaque joueur voit s'ouvrir chez lui la fenêtre de son jet (requête), et ne reçoit
 * la carte de demande du système que s'il l'a fermée ou n'a pas répondu. MJ actif uniquement.
 * @param {ChatMessage} usageMessage              Le porteur de la résolution.
 * @param {{ability: string, dc: number, activity: string}} save  La sauvegarde du plan.
 * @param {Array<{token: string, actor: string}>} targets  Cibles dont on attend le jet.
 * @param {object} [options]
 * @param {boolean} [options.askPlayers]  Plusieurs caractéristiques : le joueur choisit (sinon la meilleure).
 * @param {boolean} [options.askGM]       Idem pour une cible jetée par le MJ (PNJ, PJ sans joueur connecté).
 * @param {string|null} [options.auto]    L'outil de scénario `autoReact` (§36 : Présage — "none" : personne ; "first" : sans fenêtre).
 */
export async function requestSaves(usageMessage, save, targets, { askPlayers=true, askGM=false, auto=null }={}) {
  const activity = activityFor(usageMessage, save.activity);
  if ( !activity ) return;
  const { dc } = save;
  const heightened = heightenedTarget(activity, usageMessage, targets);
  // §249 : l'Avantage ou le Désavantage donné par cible par celui qui a utilisé l'activité (le MJ devant un piège).
  const given = normalizeTargetModes(usageMessage.getFlag(MODULE_ID, "targetModes"));
  const requested = [];
  const asked = [];
  // §36 : un devin qui décline le Présage pour une cible n'est plus consulté pour les autres (Boule de feu : une question, pas cinq).
  const declined = new Set();
  let ability = save.ability;

  for ( const target of targets ) {
    const token = await fromUuid(target.token);
    const actor = token?.actor;
    if ( !actor ) continue;
    const abilities = save.abilities ?? [save.ability];
    ability = bestSaveAbility(actor, abilities);
    // §157 : « une Créature artificielle a le Désavantage au jet de sauvegarde » (Fracassement) — `saveDisadvantageFor` du contenu.
    const byType = (contentOf(activity.item).entry?.saveDisadvantageFor ?? []).includes(creatureTypeOf(actor));
    // §281 : Inexorable — les sauvegardes contre la Lutte et la Bousculade d'un agrippeur qui l'a (Frappe à mains nues) ont le Désavantage.
    const inescapable = unarmedSave(activity) && grappleRulesOf(activity.actor).inescapable;
    if ( inescapable ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} has Disadvantage against the grapple or shove`);
    const mode = saveModeFor(given, token.uuid);
    const disadvantage = (token.uuid === heightened) || byType || inescapable || mode.disadvantage;
    const advantage = mode.advantage;
    if ( given?.[token.uuid] ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} has ${given[token.uuid]} on its saving throw (given by the user)`);
    if ( token.uuid === heightened ) console.log(`${MODULE_ID} | Heightened Spell: ${token.name} has Disadvantage on its saving throw`);
    else if ( byType ) console.log(`${MODULE_ID} | ${activity.item.name}: ${token.name} (${creatureTypeOf(actor)}) has Disadvantage on its saving throw`);
    // §36 : Présage — « à décider avant le jet » : un devin qui voit la cible peut remplacer son d20 par un jet noté. La question
    // retient la demande (jusqu'à la réponse ou au délai de la fenêtre) : c'est le prix de « avant le jet ».
    const foretold = (await foretellFor(token, { kind: "save", item: activity.item.name, auto, declined }))?.value ?? null;
    if ( foretold !== null ) console.log(`${MODULE_ID} | Portent: ${token.name}'s saving throw will use ${foretold} on the d20`);
    const userId = rollerFor(actor);
    if ( userId ) {
      // Sans attendre : les joueurs lancent en parallèle, les PNJ n'attendent personne.
      asked.push(queryPlayer(game.users.get(userId), SAVE_QUERY,
        { usage: usageMessage.id, token: token.uuid, ability, abilities, ask: askPlayers, dc, item: activity.item.name, activity: activity.uuid, advantage, disadvantage, foretold },
        { timeout: SAVE_TIMEOUT, actor, label: waitLabel("Sauvegarde", { item: activity.item.name }) })
        .catch(() => false)
        .then(rolled => { if ( !rolled ) requested.push({ actor: actor.uuid, user: userId }); }));
      continue;
    }
    if ( askGM && (abilities.length > 1) ) ability = await chooseSaveAbility(actor, abilities, { dc, item: activity.item.name });
    const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, advantage, disadvantage, foretold });
    await actor.rollSavingThrow(rollConfig, { configure: false }, messageConfig);
  }

  // Sans bloquer la file du moteur : un joueur peut prendre son temps devant sa fenêtre.
  Promise.all(asked).then(() => {
    if ( !requested.length ) return null;
    return ChatMessage.implementation.create({
      type: "request",
      content: `<p>${game.i18n.format("DND5ECOMBAT.DemandeSauvegarde", { item: activity.item.name })}</p>`,
      speaker: usageMessage.speaker,
      system: { handler: "save", data: { ability, target: dc }, targets: requested },
      flags: { [MODULE_ID]: { requestFor: usageMessage.id } }
    });
  }).catch(err => console.error(`${MODULE_ID} | saving throw request card not created`, err));
}

/**
 * Applique des effets de l'activité à une cible, exactement comme le plateau d'effets du système
 * (mise à l'échelle, dépendance à la concentration, origine). On passe par son élément
 * `<effect-application>`, dont `_applyEffectToActor` est protégée et non privée
 * (applications/components/effect-application.mjs:216) : pas de patch, mais une méthode non
 * documentée — à revérifier à chaque version du système. MJ actif uniquement.
 * @param {ChatMessage} usageMessage  Le porteur de la résolution.
 * @param {string} tokenUuid
 * @param {Array<{id: string, activity: string}>} refs  Effets du plan (core/action.mjs).
 * @returns {Promise<string[]>}  UUID des effets posés sur la cible.
 */
/**
 * Répare une activité de sauvegarde dont la caractéristique est vide, en la relisant dans le
 * compendium d'où vient l'item. Vu en jeu le 2026-09-20 : les personnages prétirés du module
 * premium PHB embarquent un *Mains brûlantes* dont `save.ability` vaut `[""]`, alors que le sort
 * du compendium porte `["dex"]`. Sans caractéristique, ni le moteur ni le bouton « Sauvegarde »
 * du système ne savent quoi lancer. La correction est écrite sur l'item : elle ne se refait pas.
 * MJ actif uniquement.
 * @returns {Promise<boolean>}  true si l'item a été réparé.
 */
export async function repairSaveAbility(message) {
  const activity = message.getAssociatedActivity?.();
  if ( (activity?.type !== "save") || activity.save?.ability?.first?.() ) return false;
  const item = activity.item;
  const sourceUuid = item?._stats?.compendiumSource;
  const source = sourceUuid ? await fromUuid(sourceUuid) : null;
  const twin = source?.system?.activities?.get(activity.id)
    ?? source?.system?.activities?.find(a => a.type === "save");
  const abilities = Array.from(twin?.save?.ability ?? []).filter(a => a in CONFIG.DND5E.abilities);
  if ( !abilities.length || !item.isOwner || item.inCompendium ) return false;
  await item.update({ [`system.activities.${activity.id}.save.ability`]: abilities });
  console.log(`${MODULE_ID} | ${item.name} (${item.actor?.name}): saving throw ability repaired from the compendium -> ${abilities.join(", ")}`);
  return true;
}

/** §281 : une sauvegarde de Lutte ou de Bousculade — celle d'un item dont une attaque est une frappe à mains nues (Frappe à mains nues). */
function unarmedSave(activity) {
  return (activity?.type === "save") && !!activity.item?.system?.activities?.some?.(a => a.attack?.type?.classification === "unarmed");
}
