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

/**
 * §16.39 : une créature invoquée par un item qui déclare `summon.lasts` reçoit son heure de fin (`flags["dnd5e-combat"].expiresAt`,
 * heure du monde en secondes). MJ actif. Rend l'heure notée, ou null.
 */
export async function noteSummonExpiry(tokenDoc, now=game.time.worldTime) {
  const item = summonItemOf(tokenDoc);
  const lasts = item ? contentOf(item).entry?.summon?.lasts : null;
  if ( !lasts ) return null;
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

/** L'item qui a invoqué ce token, ou null. */
export function summonItemOf(tokenDoc) {
  const uuid = tokenDoc?.actor?.getFlag?.("dnd5e", "summon.origin");
  return uuid ? fromUuidSync(uuid, { strict: false }) : null;
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
