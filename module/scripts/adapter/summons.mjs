/**
 * Créatures invoquées (SPEC §16.13, B12), lues et écrites dans Foundry. Vérifié dans dnd5e 6.0.3 :
 *  - l'activité « summon » pose les tokens (documents/activity/summon.mjs, `placeSummons`) ; l'acteur invoqué porte
 *    `flags.dnd5e.summon.origin` = uuid de l'item de l'invocateur (`fetchExisting`, option `origin`) ;
 *  - le système ne les met pas au combat, et ne les retire pas quand la concentration tombe : un token n'est pas un
 *    « dépendant » (`ActiveEffect5e#getDependents` : effets, items, activités).
 * Le moteur, sur le MJ actif, à la création du token : le rattache à la concentration de l'invocateur sur cet item
 * (`flags["dnd5e-combat"].summonedBy` = uuid de l'effet), et l'ajoute au combat selon le contenu (`summon.initiative`).
 */

import { MODULE_ID } from "../constants.mjs";
import { initiativeAfter } from "../core/turn.mjs";
import { contentOf } from "./content.mjs";
import { expiryTime } from "../core/area.mjs";
import { readTimeFactors } from "./areas.mjs";
import { summonChoices, profilesAtLevel, mmActorId, srdMonsterId } from "../core/summon.mjs";

/**
 * §383 : ce qu'une activité « summon » laisse choisir à la pose (profils disponibles à ce niveau — `availableProfiles`,
 * documents/activity/summon.mjs —, tailles, types de créature). Tout faux pour une autre activité.
 */
export function summonChoicesOf(activity) {
  if ( activity?.type !== "summon" ) return summonChoices();
  return summonChoices({ profiles: activity.availableProfiles?.length ?? 0, sizes: activity.creatureSizes?.size ?? 0,
    types: activity.creatureTypes?.size ?? 0 });
}

/**
 * §386 : où chercher la créature d'un profil du SRD 2014, dans l'ordre (décision de l'utilisateur) : le Monster Manual 2024 (module
 * premium), puis les créatures du SRD 2024 livrées par dnd5e (`dnd5e.actors24`) — mêmes identifiants `mm…` dans les deux.
 */
export const MM_ACTORS = "dnd-monster-manual.actors";
export const SRD24_ACTORS = "dnd5e.actors24";
const PREFERRED_PACKS = [MM_ACTORS, SRD24_ACTORS];

/**
 * §386 (demande de l'utilisateur) : la créature à invoquer pour un profil qui désigne une créature du SRD 2014 de dnd5e
 * (`dnd5e.monsters` : les goules, blêmes, nécrophages et momies de Création de morts-vivants) — la même (nom anglais → `mmActorId`)
 * dans le Monster Manual 2024, sinon dans le SRD 2024 de dnd5e, sinon l'uuid du profil. Les index des compendiums sont
 * chargés au démarrage du monde.
 */
export function preferredSummonUuid(uuid) {
  if ( !srdMonsterId(uuid) ) return uuid;
  const id = mmActorId(fromUuidSync(uuid, { strict: false })?.name);
  if ( !id ) return uuid;
  for ( const packId of PREFERRED_PACKS ) {
    if ( game.packs?.get(packId)?.index?.has(id) ) return `Compendium.${packId}.Actor.${id}`;
  }
  return uuid;
}

/**
 * §386 : les profils d'une activité « summon » qui désignent une créature du SRD 2014 pointés sur celle du Monster Manual, sur la
 * COPIE de l'item que dnd5e utilise (comme le nombre, §385 ; `placeSummons` relit `profile.uuid`). Rend l'activité à jour.
 */
export function applyPreferredActors(activity) {
  const item = activity?.item;
  const source = item?._source?.system?.activities?.[activity.id]?.profiles;
  if ( !Array.isArray(source) ) return activity;
  let changed = false;
  const profiles = source.map(p => {
    const uuid = preferredSummonUuid(p.uuid);
    if ( uuid === p.uuid ) return p;
    changed = true;
    return { ...p, uuid };
  });
  if ( !changed ) return activity;
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.profiles`]: profiles });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  return item.system.activities.get(activity.id) ?? activity;
}

/**
 * §385 : combien de créatures un profil pose au niveau `level` (sa formule `count` avec `@item.level` à ce niveau, comme `getPlacement`,
 * documents/activity/summon.mjs). Null si la formule n'est pas fixe (des dés : pas de choix proposé).
 */
export function summonCountAt(activity, profile, level, formula=null) {
  try {
    const data = activity.getRollData?.() ?? {};
    const rollData = { ...data, item: { ...(data.item ?? {}), level } };
    // §387 : une formule du contenu (`summon.chooseCount`) passe avant celle du profil.
    const roll = new Roll(String(formula || profile?.count || "1"), rollData);
    if ( !roll.isDeterministic ) return null;
    return Math.max(0, Math.floor(Number(roll.evaluateSync().total) || 0));
  } catch(err) { return null; }
}

/** §385 : les profils d'une activité « summon » permis au niveau `level`. */
export function summonProfilesAt(activity, level) {
  return profilesAtLevel(Array.from(activity?.profiles ?? []), level);
}

/**
 * §385 : les niveaux auxquels lancer : chaque emplacement qui reste (pacte compris), au moins du niveau du sort ; sans aucun, le niveau
 * du sort seul (`slot` null : le MJ lancera sans emplacement, §77). `{ slot, level, label }`.
 */
export function castLevelsOf(activity) {
  const base = Number(activity?.item?.system?.level) || 0;
  const spells = activity?.actor?.system?.spells ?? {};
  const out = [];
  for ( const [key, slot] of Object.entries(spells) ) {
    if ( !/^(spell\d+|pact)$/.test(key) ) continue;
    const level = Number(slot?.level) || 0;
    if ( (level >= base) && ((Number(slot?.value) || 0) > 0) ) out.push({ slot: key, level, label: slot.label ?? key, left: Number(slot.value) });
  }
  out.sort((a, b) => (a.level - b.level) || (Number(a.slot === "pact") - Number(b.slot === "pact")));
  return out.length ? out : [{ slot: null, level: base, label: null, left: 0 }];
}

/**
 * §385 : le nombre choisi, écrit sur la COPIE de l'item que dnd5e utilise (`Activity#use` clone l'item ; la pose relit le profil :
 * `placeSummons` → `getPlacement`, `profile.count`) — vérifié en jeu : 1 goule posée au lieu de 3. Comme §77, `repairSelfUses`.
 * Rend l'activité à jour.
 */
export function applySummonCount(activity, profileId, count) {
  const item = activity?.item;
  const source = item?._source?.system?.activities?.[activity.id]?.profiles;
  if ( !Array.isArray(source) || !(count >= 1) ) return activity;
  const profiles = source.map(p => (p._id === profileId) ? { ...p, count: String(count) } : p);
  if ( item.actor ) item.actor._embeddedPreparation = true;
  item.updateSource({ [`system.activities.${activity.id}.profiles`]: profiles });
  if ( item.actor ) delete item.actor._embeddedPreparation;
  item.prepareFinalAttributes?.();
  return item.system.activities.get(activity.id) ?? activity;
}

/**
 * §198 : la durée propre d'une invocation sans concentration — celle de l'activité qui l'a posée (`flags.dnd5e.summon.activity`),
 * sinon celle du sort (Main du mage : 1 minute, issue #8). Null avec concentration (elle tombe avec elle, runtime/concentration.mjs) ;
 * une durée instantanée, permanente ou spéciale (Appel de destrier, Appel de familier) ne donne pas d'heure de fin (`expiryTime` ne
 * connaît que les unités de `CONFIG.DND5E.timeUnits`).
 */
function ownDurationOf(tokenDoc, item) {
  const activity = item.system?.activities?.get?.(tokenDoc?.actor?.getFlag?.("dnd5e", "summon.activity") ?? "") ?? null;
  const duration = activity?.duration?.units ? activity.duration : item.system?.duration;
  if ( !duration?.units ) return null;
  if ( activity?.duration?.concentration || item.requiresConcentration || item.system?.properties?.has?.("concentration") ) return null;
  return { value: duration.value, units: duration.units };
}

/**
 * §16.39 : une créature invoquée par un item qui déclare `summon.lasts` reçoit son heure de fin (`flags["dnd5e-combat"].expiresAt`,
 * heure du monde en secondes). §198 : sans `summon.lasts`, la durée propre du sort quand il n'a pas de concentration. MJ actif. Rend
 * l'heure notée, ou null.
 */
export async function noteSummonExpiry(tokenDoc, now=game.time.worldTime) {
  const item = summonItemOf(tokenDoc);
  // §305 : une invocation qui part au Repos long (Compagnon sauvage) n'a pas d'heure de fin.
  if ( item && (contentOf(item).entry?.summon?.endsOnLongRest === true) ) return null;
  const lasts = item ? (contentOf(item).entry?.summon?.lasts ?? ownDurationOf(tokenDoc, item)) : null;
  if ( !lasts ) return null;
  // §107 : un familier rappelé de sa poche dimensionnelle garde l'heure de fin notée à son invocation.
  if ( Number.isFinite(tokenDoc.getFlag(MODULE_ID, "expiresAt")) ) return null;
  let value = Number(lasts.value);
  if ( !Number.isFinite(value) ) {
    try { value = Roll.safeEval(Roll.replaceFormulaData(String(lasts.value), item.getRollData?.() ?? {}, { missing: 0 })); }
    catch { return null; }
  }
  const at = expiryTime(now, { value, units: lasts.units }, readTimeFactors());
  if ( at === null ) return null;
  await tokenDoc.setFlag(MODULE_ID, "expiresAt", at);
  return at;
}

/** Les tokens invoqués dont l'heure de fin est passée, sur toutes les scènes. */
export function expiredSummons(now=game.time.worldTime) {
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      const at = token.getFlag(MODULE_ID, "expiresAt");
      if ( Number.isFinite(at) && (at <= now) ) out.push(token);
    }
  }
  return out;
}

/**
 * §230 : les invocations qu'une nouvelle remplace — celles du même item (`flags.dnd5e.summon.origin`, documents/activity/summon.mjs:264),
 * créées avant elle, sur toutes les scènes, quand le contenu de l'item dit `summon.replaces` (Appel de destrier). MJ actif.
 * @param {TokenDocument} tokenDoc  Le token qui vient d'être créé.
 * @returns {TokenDocument[]}
 */
export function replacedSummons(tokenDoc) {
  const origin = tokenDoc?.actor?.getFlag?.("dnd5e", "summon.origin");
  const item = origin ? fromUuidSync(origin, { strict: false }) : null;
  if ( !item || (contentOf(item).entry?.summon?.replaces !== true) ) return [];
  const born = tokenDoc._stats?.createdTime ?? Infinity;
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( (token === tokenDoc) || (token.id === tokenDoc.id) ) continue;
      if ( token.actor?.getFlag?.("dnd5e", "summon.origin") !== origin ) continue;
      if ( (token._stats?.createdTime ?? 0) < born ) out.push(token);
    }
  }
  return out;
}

/** L'item qui a invoqué ce token, ou null. */
export function summonItemOf(tokenDoc) {
  const uuid = tokenDoc?.actor?.getFlag?.("dnd5e", "summon.origin");
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
}

/**
 * O8f (§349) : une invocation `summon.hostile` (Le Crâne, Parchemin d'invocation de titan) — token Hostile, et l'acteur invoqué (celui du
 * monde, dont hérite un token non lié) n'appartient plus à aucun joueur : dnd5e le crée au nom de qui invoque. MJ actif. Rend vrai si fait.
 */
export async function makeSummonHostile(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  if ( contentOf(item).entry?.summon?.hostile !== true ) return false;
  const hostile = CONST.TOKEN_DISPOSITIONS.HOSTILE;
  if ( tokenDoc.disposition !== hostile ) await tokenDoc.update({ disposition: hostile });
  const actor = (tokenDoc.actorLink === false) ? (tokenDoc.baseActor ?? game.actors.get(tokenDoc.actorId)) : tokenDoc.actor;
  if ( actor && !actor.pack ) {
    const ownership = Object.fromEntries(Object.entries(actor.ownership ?? {})
      .map(([id, level]) => [id, ((id === "default") || !game.users.get(id)?.isGM) ? CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE : level]));
    if ( Object.entries(ownership).some(([id, level]) => actor.ownership[id] !== level) ) await actor.update({ ownership });
  }
  return true;
}

/** L'effet de concentration de l'invocateur sur cet item, ou null. */
export function concentrationOn(item) {
  const actor = item?.actor;
  for ( const effect of actor?.effects ?? [] ) {
    if ( !effect.statuses?.has?.("concentrating") ) continue;
    const data = effect.getFlag("dnd5e", "item") ?? {};
    if ( (data.id === item.id) || (data.data?._id === item.id) ) return effect;
  }
  return null;
}

/**
 * Rattache une créature invoquée à la concentration de son invocateur. Rend l'effet, ou null (pas de concentration).
 * @param {TokenDocument} tokenDoc
 */
export async function tieSummonToConcentration(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const effect = concentrationOn(item);
  if ( !effect ) return null;
  // §16.15 : `endsSpell` — retirer cet objet mettra fin à la concentration (runtime/pilot.mjs). Noté sur le token : à sa
  // suppression, l'acteur synthétique d'un token non lié n'est plus sûr.
  const summon = contentOf(item).entry?.summon ?? {};
  await tokenDoc.update({ [`flags.${MODULE_ID}`]: { summonedBy: effect.uuid,
    ...(summon.endsSpell ? { endsSpell: true } : {}), ...(summon.endsAtZero ? { endsAtZero: true } : {}) } });
  return effect;
}

/** Retire les créatures invoquées que maintenait un effet de concentration qui vient de tomber (et leurs combattants). */
export async function removeSummonsOf(effectUuid) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const tokens = scene.tokens.filter(t => t.getFlag(MODULE_ID, "summonedBy") === effectUuid);
    if ( !tokens.length ) continue;
    const ids = new Set(tokens.map(t => t.id));
    for ( const combat of game.combats ) {
      const gone = combat.combatants.filter(c => (c.sceneId === scene.id) && ids.has(c.tokenId)).map(c => c.id);
      if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
    }
    await scene.deleteEmbeddedDocuments("Token", [...ids]);
    removed += ids.size;
  }
  return removed;
}

/**
 * Met une créature invoquée au combat où se trouve son invocateur, selon le contenu de l'item (`summon.initiative`) :
 * `after` = juste après lui ; `own` = elle lance sa propre initiative. Rend le combattant, ou null.
 * @param {TokenDocument} tokenDoc
 */
export async function joinSummonerCombat(tokenDoc) {
  const item = summonItemOf(tokenDoc);
  const rule = item ? contentOf(item).entry?.summon : null;
  if ( !rule || (rule.initiative === "none") ) return null;
  const summoner = item.actor;
  const combat = game.combats.find(c => c.started && c.combatants.some(x => x.actor === summoner)
    && ((c.scene === tokenDoc.parent) || !c.scene));
  if ( !combat || combat.combatants.some(c => c.tokenId === tokenDoc.id) ) return null;
  const mine = combat.combatants.find(c => c.actor === summoner);
  const data = { tokenId: tokenDoc.id, sceneId: tokenDoc.parent.id, actorId: tokenDoc.actorId, hidden: tokenDoc.hidden };
  if ( (rule.initiative === "after") && Number.isFinite(mine?.initiative) ) {
    const others = combat.combatants.filter(c => c !== mine).map(c => c.initiative);
    data.initiative = initiativeAfter(mine.initiative, others);
  }
  const [combatant] = await combat.createEmbeddedDocuments("Combatant", [data]);
  if ( combatant && (rule.initiative === "own") ) await combat.rollInitiative([combatant.id]);
  return combatant ?? null;
}
