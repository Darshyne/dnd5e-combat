/**
 * §72 : le test en opposition (clé `contest`) — ce qui touche à dnd5e : la règle de l'item, les jets de compétence, l'effet posé.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { bestSkill } from "../core/contest.mjs";
import { applyEffectsToToken } from "./saves.mjs";

/** La règle `contest` qui vaut pour cette activité, ou null. */
export function contestOf(activity) {
  const rule = activity?.item ? contentOf(activity.item).entry?.contest : null;
  if ( !rule || (rule.activity && (rule.activity !== activity.id)) ) return null;
  return rule;
}

/** Les bonus totaux de compétence d'un acteur, par clé (`system.skills.<clé>.total`). */
const skillBonuses = actor => Object.fromEntries(Object.entries(actor?.system?.skills ?? {}).map(([k, s]) => [k, Number(s?.total) || 0]));

/**
 * Le jet de compétence d'un acteur, sans fenêtre (le meilleur parmi `skills`). Rend `{ skill, total }`, ou null.
 * @param {Actor5e} actor
 * @param {string[]} skills
 */
export async function rollContestSkill(actor, skills) {
  const skill = bestSkill(skillBonuses(actor), skills);
  if ( !actor || !skill ) return null;
  const rolls = await actor.rollSkill({ skill }, { configure: false });
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? { skill, total } : null;
}

/** Le joueur actif qui possède cet acteur (pas un MJ), ou null. */
export function playerOwnerOf(actor) {
  return game.users.find(u => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? null;
}

/**
 * Pose l'effet gagné sur la cible ; `exclusive` : retire d'abord ceux que le même item du même auteur a posés sur d'autres acteurs
 * de la scène (« jusqu'à ce qu'il utilise avec succès cette aptitude contre une cible différente »). Rend le nombre d'effets posés.
 */
export async function applyContestWin(usageMessage, activity, targetToken, rule) {
  if ( rule.exclusive ) {
    const scene = targetToken.parent;
    for ( const token of scene?.tokens ?? [] ) {
      if ( token === targetToken ) continue;
      const ids = (token.actor?.effects ?? []).filter(e => fromUuidSync(e.origin ?? "", { strict: false })?.item === activity.item
        || (fromUuidSync(e.origin ?? "", { strict: false }) === activity.item)).map(e => e.id);
      if ( ids.length ) await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
  }
  const applied = await applyEffectsToToken(usageMessage, targetToken.uuid, [{ id: rule.effect, activity: activity.uuid }]);
  return applied.length;
}

/** Annonce au chat : les deux jets et l'issue. */
export function announceContest({ actor, target, mine, theirs, outcome, item }) {
  const label = k => CONFIG.DND5E.skills?.[k]?.label ?? k;
  const verdict = game.i18n.localize(`DND5ECOMBAT.Opposition.${outcome === "win" ? "Gagne" : (outcome === "tie" ? "Egalite" : "Perdu")}`);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p><strong>${item.name}</strong> — ${game.i18n.format("DND5ECOMBAT.Opposition.Resume", {
      name: actor.name, skill: label(mine.skill), total: mine.total, target: target.name, against: label(theirs.skill), theirs: theirs.total })}</p><p>${verdict}</p>`,
    flags: { [MODULE_ID]: { contest: { item: item.uuid, target: target.uuid, mine: mine.total, theirs: theirs.total, outcome } } }
  });
}
