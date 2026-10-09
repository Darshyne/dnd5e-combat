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

import { MODULE_ID } from "../constants.mjs";
import { rollerFor } from "./concentration.mjs";
import { committedPosition } from "./turn.mjs";
import { areaOriginOf, reachesFromPoint, sphereOf, insideSphere } from "./space.mjs";
import { effectKey, poolEffectsOf } from "./usage.mjs";
import { timedWait, closeRollDialogAfter } from "./dialogs.mjs";
import { pushOf } from "./basics.mjs";
import { blockedFor } from "./eligibility.mjs";
import { conditionImmunitiesOf, originItemOf } from "./facts.mjs";
import { contentOf } from "./content.mjs";
import { usageTokenOf } from "./turn.mjs";
import { areHostile } from "../core/reaction.mjs";
import { fightingAdvantage } from "../core/conditions.mjs";
import { isObjectToken } from "./bodies.mjs";
import { usageMetamagic } from "./metamagic.mjs";
import { foretellFor } from "./portent.mjs";
import { foretoldRange } from "../core/portent.mjs";
import { isSpellCast } from "./scrolls.mjs";

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
  return {
    activity: uuid,
    origin,
    originDisposition: originToken?.disposition ?? null,
    excludeOrigin: activity?.range?.units === "self",
    // « Vous pouvez désigner des créatures qui ne sont pas affectées » (`affects.choice`, Esprits gardiens) : par défaut,
    // les alliés du lanceur sont épargnés — le moteur ne pose pas la question (§16.23).
    affects: areaAffects(activity),
    // Appartenance calculée par le cœur (TokenDocument#testInsideRegion, client/documents/token.mjs:3236).
    candidates: region.parent.tokens.filter(t => t.actor && !isObjectToken(t) && t.testInsideRegion(region, committedPosition(t))).map(t => ({
      token: t.uuid,
      actor: t.actor.uuid,
      name: t.name,
      disposition: t.disposition,
      defeated: t.actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED) === true,
      lineOfEffect: reachesFromPoint(areaOrigin, t),
      inVolume: insideSphere(sphere, t)
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
    total: roll.total
  };
}

export const SAVE_QUERY = `${MODULE_ID}.rollSave`;
const SAVE_TIMEOUT = 40000;   // deux fenêtres possibles (choix, jet), chacune bornée par adapter/dialogs.mjs

/** Paramètres du jet, les mêmes que le bouton « Sauvegarde » de la carte (save.mjs:122-134). */
function saveRollArguments(activity, actor, token, usageMessage, { ability, dc, disadvantage=false, foretold=null }) {
  const bonus = CONFIG.Dice.BasicRoll.constructParts({ activityBonus: activity.save.bonus }, activity.getRollData());
  const rollConfig = { ability, target: dc };
  // §16.25 : Ascendance féerique — l'avantage contre une activité qui pose un état que l'un de ses items désigne.
  if ( saveAdvantageAgainst(actor, activity) || fightingAdvantageFor(activity, token) ) rollConfig.advantage = true;
  // §32 : Sort intensifié (la cible choisie par requestSaves).
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
    if ( token && caster && areHostile(caster.disposition, token.disposition) ) return token.uuid;
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
  return fightingAdvantage({ targetInCombat, hostile: !!caster && areHostile(caster.disposition, token.disposition) });
}

/** Les états que posent les effets d'une activité (`activity.effects[].effect`, dnd5e 6). */
function statusesPosedBy(activity) {
  return new Set((activity?.effects ?? []).flatMap(ref => [...(ref.effect?.statuses ?? [])]));
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
export async function handleSaveQuery({ usage, token: tokenUuid, ability, abilities=null, ask=true, dc, item, activity: activityUuid=null, disadvantage=false, foretold=null }) {
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
  const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, disadvantage, foretold });
  let rolls = await actor.rollSavingThrow(rollConfig, { configure: true }, messageConfig);
  cancel();
  if ( !rolls?.length && timedOut ) {
    const [again, againMessage] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, disadvantage, foretold });
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
    const disadvantage = token.uuid === heightened;
    if ( disadvantage ) console.log(`${MODULE_ID} | Heightened Spell: ${token.name} has Disadvantage on its saving throw`);
    // §36 : Présage — « à décider avant le jet » : un devin qui voit la cible peut remplacer son d20 par un jet noté. La question
    // retient la demande (jusqu'à la réponse ou au délai de la fenêtre) : c'est le prix de « avant le jet ».
    const foretold = (await foretellFor(token, { kind: "save", item: activity.item.name, auto, declined }))?.value ?? null;
    if ( foretold !== null ) console.log(`${MODULE_ID} | Portent: ${token.name}'s saving throw will use ${foretold} on the d20`);
    const userId = rollerFor(actor);
    if ( userId ) {
      // Sans attendre : les joueurs lancent en parallèle, les PNJ n'attendent personne.
      asked.push(game.users.get(userId).query(SAVE_QUERY,
        { usage: usageMessage.id, token: token.uuid, ability, abilities, ask: askPlayers, dc, item: activity.item.name, activity: activity.uuid, disadvantage, foretold }, { timeout: SAVE_TIMEOUT })
        .catch(() => false)
        .then(rolled => { if ( !rolled ) requested.push({ actor: actor.uuid, user: userId }); }));
      continue;
    }
    if ( askGM && (abilities.length > 1) ) ability = await chooseSaveAbility(actor, abilities, { dc, item: activity.item.name });
    const [rollConfig, messageConfig] = saveRollArguments(activity, actor, token, usageMessage, { ability, dc, disadvantage, foretold });
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
 * §71 : l'effet qu'un profil de l'activité cite, absent de l'item du monde — la Dague des ombres d'un Familier de vampire importé le
 * 2026-10-04 l'avait perdu (l'activité gardait le profil `dsK5sPtkUMySmyvw`, l'item n'avait plus d'effet). On le prend sur la fiche
 * d'origine (compendium) : même acteur (`_stats.compendiumSource`, sinon un compendium d'acteurs qui a son id), même item, même effet.
 * L'effet du compendium s'applique tel quel (dnd5e note sa source, effect-application.mjs:237). Rien d'écrit sur la fiche.
 */
async function lostEffectOf(activity, effectId) {
  const item = activity?.item;
  const actor = item?.actor;
  if ( !item || !actor ) return null;
  const base = actor.isToken ? (actor.baseActor ?? actor) : actor;
  const sources = [base._stats?.compendiumSource, base.flags?.core?.sourceId].filter(u => typeof u === "string" && u.startsWith("Compendium."));
  for ( const uuid of sources ) {
    const source = await fromUuid(uuid).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from the source sheet (${uuid}): the world item lost it`); return effect; }
  }
  for ( const pack of game.packs.filter(p => p.documentName === "Actor") ) {
    if ( !pack.index.has(base.id) ) continue;
    const source = await pack.getDocument(base.id).catch(() => null);
    const effect = source?.items?.get(item.id)?.effects?.get(effectId);
    if ( effect ) { console.log(`${MODULE_ID} | "${effect.name}" taken from ${pack.collection}: the world item lost it`); return effect; }
  }
  return null;
}

export async function applyEffectsToToken(usageMessage, tokenUuid, refs) {
  if ( !refs.length ) return [];
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return [];
  const tray = document.createElement("effect-application");
  tray.chatMessage = usageMessage;
  const applied = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37 : un effet de la réserve (`choice.pool`) n'est pas un profil de l'activité.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const effect = (await profile?.getEffect()) ?? (profile ? await lostEffectOf(activity, ref.id) : null);
    if ( !effect ) {
      console.log(`${MODULE_ID} | effect ${ref.id} not found on ${activity?.item?.name ?? ref.activity}, nor on its source sheet`);
      continue;
    }
    // §16.8 : immunisée contre l'un de ses états, la créature ne reçoit pas l'effet (Motif hypnotique sans Charmé).
    if ( blockedFor(effect, actor).length ) continue;
    const result = await tray._applyEffectToActor(effect, actor);
    if ( result?.uuid ) applied.push(result.uuid);
  }
  return applied;
}

/**
 * Sépare des effets du plan ceux qui sont des poussées (« repoussé » de la Bousculade,
 * content/actions.mjs) : ils ne se posent pas, le moteur déplace la cible.
 * @returns {Promise<{effects: Array<{id: string, activity: string}>, pushes: object[]}>}
 */
export async function splitPushes(usageMessage, refs) {
  const effects = [];
  const pushes = [];
  for ( const ref of refs ) {
    const activity = activityFor(usageMessage, ref.activity);
    // §37 : un effet de la réserve (`choice.pool`) n'est pas un profil de l'activité.
    const profile = [...(activity?.effects ?? []), ...poolEffectsOf(activity)].find(e => effectKey(e) === ref.id);
    const push = pushOf(await profile?.getEffect());
    if ( push ) pushes.push(push);
    else effects.push(ref);
  }
  return { effects, pushes };
}

/**
 * Pose un état natif sur la cible (SPEC §16, étape `status` : À terre de Tempête de neige, Agrippé d'une
 * morsure…), avec l'activité pour origine — `hasEffectFrom` le retrouve, et l'annulation le retire comme
 * un effet de l'activité. `Actor#toggleStatusEffect` du cœur (client/documents/actor.mjs:547) ; un état
 * déjà porté n'est pas doublé. Rend l'UUID de l'effet créé, ou null.
 */
export async function applyStatusToToken(usageMessage, tokenUuid, status) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor || !CONFIG.statusEffects.some(s => s.id === status) ) return null;
  if ( actor.statuses.has(status) ) return null;
  if ( conditionImmunitiesOf(actor).includes(status) ) return null;   // §16.8 : immunisée, rien n'est posé
  const effect = await actor.toggleStatusEffect(status, { active: true });
  if ( !effect?.uuid ) return null;
  // Un état est un effet `condition`, dont le modèle de dnd5e retire `system.origin` (data/active-effect/
  // condition.mjs:12) : l'origine va dans le champ `origin` du cœur, que `originItemOf` lit en repli.
  const activity = usageMessage.getAssociatedActivity?.();
  if ( activity ) await effect.update({ origin: activity.uuid });
  return effect.uuid;
}

/**
 * §54 : une marque (étape d'issue `mark`) — un effet nommé, à l'image de l'item, rattaché à l'activité et au message
 * d'utilisation (l'item peut être détruit : une fiole d'huile lancée), d'une durée en secondes. Une marque déjà là est remplacée.
 */
export async function applyMarkToToken(usageMessage, tokenUuid, step, label) {
  const actor = (await fromUuid(tokenUuid))?.actor;
  if ( !actor ) return null;
  const old = actor.effects.filter(e => e.getFlag(MODULE_ID, "mark") === step.mark).map(e => e.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", old);
  const activity = usageMessage.getAssociatedActivity?.();
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label, img: activity?.item?.img ?? "icons/svg/aura.svg", type: "base", origin: activity?.uuid ?? null,
    system: { origin: { activity: activity?.uuid ?? null, message: usageMessage.uuid } },
    duration: step.seconds ? { seconds: step.seconds } : {},
    flags: { [MODULE_ID]: { mark: step.mark } }
  }]);
  return effect?.uuid ?? null;
}

/** Retire des effets posés par une résolution (annulation). */
export async function removeEffects(uuids) {
  for ( const uuid of uuids ) await (await fromUuid(uuid))?.delete();
}

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

export const TARGETS_QUERY = `${MODULE_ID}.setTargets`;

/** Côté de celui qui a lancé le sort : ses cibles deviennent celles que la zone recouvre. */
export function handleTargetsQuery({ tokens }) {
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  for ( const uuid of tokens ) fromUuidSync(uuid)?.object?.setTarget(true, { releaseOthers: false });
  return true;
}

/**
 * Montre à l'auteur d'une action qui sa zone a pris : les tokens sont désignés comme cibles chez
 * lui. Purement visuel — la résolution ne dépend pas des cibles de l'interface — donc jamais bloquant.
 */
export async function showTargetsTo(user, tokenUuids) {
  try {
    if ( !user || user.isSelf ) handleTargetsQuery({ tokens: tokenUuids });
    else if ( user.active ) await user.query(TARGETS_QUERY, { tokens: tokenUuids }, { timeout: 5000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | targets not shown for ${user?.name}`, err);
  }
}
