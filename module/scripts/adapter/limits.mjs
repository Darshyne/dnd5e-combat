/**
 * Limites d'utilisation d'une activité (SPEC §16.40, `usageLimits`), lues dans Foundry. « Déjà utilisée ce tour » : une marque
 * sur l'acteur (`flags["dnd5e-combat"].usedOnTurn.<id d'activité>` = clé du tour), posée après l'utilisation.
 */

import { MODULE_ID } from "../constants.mjs";
import { usageLimitIssues, lowestSlotLevel } from "../core/limits.mjs";
import { resourceFeedback } from "../core/feedback.mjs";
import { turnKeyOf } from "../core/area.mjs";
import { contentOf, identifierOf } from "./content.mjs";
import { combatantFor, movementOf } from "./turn.mjs";
import { readUnitFactors } from "./units.mjs";

/** La règle de limite de cette activité, ou null. */
export function usageLimitOf(activity) {
  return activity?.item ? (contentOf(activity.item).entry?.usageLimits?.[activity.id] ?? null) : null;
}

const currentTurnKey = () => (game.combat?.started ? turnKeyOf(game.combat.round, game.combat.turn) : null);

/** Les utilisations restantes de l'item de cet identifiant chez l'acteur, ou null s'il n'en a pas. */
function remainingUses(actor, identifier) {
  const item = actor?.items?.find(i => identifierOf(i).id === identifier);
  const value = Number(item?.system?.uses?.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Ce qui cloche pour cette utilisation (`notOwnTurn`, `oncePerTurn`, `notEmpty`), et l'item vide attendu.
 * @param {Activity} activity
 * @param {{inCombat: boolean, ownTurn: boolean}} turn
 */
export function usageLimitProblems(activity, { inCombat, ownTurn }) {
  const rule = usageLimitOf(activity);
  if ( !rule ) return { issues: [], item: null };
  const key = currentTurnKey();
  const usedThisTurn = !!key && (activity.actor?.getFlag(MODULE_ID, `usedOnTurn.${activity.id}`) === key);
  const remaining = rule.whenEmpty ? remainingUses(activity.actor, rule.whenEmpty) : null;
  const item = rule.whenEmpty ? activity.actor?.items?.find(i => identifierOf(i).id === rule.whenEmpty)?.name ?? rule.whenEmpty : null;
  // §20 : « si vous ne vous êtes pas déplacé pendant ce tour » (Visée stable) — le déplacement dépensé ce tour, hors téléportation.
  const combatant = (rule.unmoved && inCombat) ? combatantFor(activity.actor) : null;
  const moved = !!combatant && ((movementOf(combatant, readUnitFactors())?.spent ?? 0) > 0);
  return { issues: usageLimitIssues(rule, { inCombat, ownTurn, usedThisTurn, remaining, moved }), item };
}

/**
 * §16.40 : `lowestSlot` — l'activité dépense un emplacement dont le niveau se règle par `scaling` (consommation « spellSlots »,
 * cible niveau 1, mise à l'échelle par niveau) ; on le fixe sur le plus bas disponible et la fenêtre de dnd5e ne s'ouvre pas.
 * Rend false s'il ne reste aucun emplacement (l'utilisation est alors annulée), true sinon (ou sans objet).
 */
export function applyLowestSlot(activity, usageConfig, dialogConfig) {
  const rule = usageLimitOf(activity);
  // `cost` : le coût de la règle 2024 (Flammes, Crosse des druides : action Bonus ; les données disent « action »), sauf si
  // l'intention en a fixé un (Taille, commande d'objet piloté).
  if ( rule?.cost && !usageConfig[MODULE_ID]?.cost ) usageConfig[MODULE_ID] = { ...(usageConfig[MODULE_ID] ?? {}), cost: rule.cost };
  // `noDialog` : rien à choisir (Regain d'emplacement de sort : tout se consomme tel que déclaré).
  if ( rule?.noDialog && dialogConfig ) dialogConfig.configure = false;
  if ( !rule?.lowestSlot ) return true;
  const spells = activity.actor?.system?.spells ?? {};
  const available = {};
  for ( let level = 1; level <= 9; level++ ) available[level] = Number(spells[`spell${level}`]?.value) || 0;
  const level = lowestSlotLevel(available);
  if ( level === null ) return false;
  const base = Number(activity.consumption?.targets?.find(t => t.type === "spellSlots")?.target) || 1;
  usageConfig.scaling = Math.max(0, level - base);
  if ( dialogConfig ) dialogConfig.configure = false;
  return true;
}

/**
 * §16.40 : ce qu'une carte d'utilisation a rendu ou dépensé (consommations de son activité, au niveau lancé), pour le retour
 * au-dessus du token (ui/feedback.mjs). Vide pour une activité qui ne rend rien.
 * @param {ChatMessage} message
 */
export function resourceChangesOf(message) {
  const activity = message?.getAssociatedActivity?.();
  if ( !activity?.consumption?.targets?.length ) return [];
  const actor = activity.actor;
  const scaling = Number(message.system?.scaling) || 0;
  const itemFor = target => {
    if ( !target ) return activity.item;
    return actor?.items?.get(target) ?? actor?.items?.find(i => (i._stats?.compendiumSource === target) || (identifierOf(i).id === target)) ?? null;
  };
  const targets = activity.consumption.targets.map(t => {
    const value = Number(t.value);
    if ( t.type === "itemUses" ) return { type: t.type, value, name: itemFor(t.target)?.name ?? "" };
    if ( t.type === "spellSlots" ) {
      const base = Number(t.target) || 1;
      return { type: t.type, value, level: base + ((t.scaling?.mode === "level") ? scaling : 0) };
    }
    return { type: t.type, value };
  });
  return resourceFeedback(targets);
}

/** Après l'utilisation : la marque « utilisée ce tour » (sur le client de l'utilisateur, qui possède l'acteur). */
export async function markUsedThisTurn(activity) {
  const rule = usageLimitOf(activity);
  const key = currentTurnKey();
  if ( !rule?.oncePerTurn || !key || !activity.actor?.isOwner ) return false;
  await activity.actor.setFlag(MODULE_ID, `usedOnTurn.${activity.id}`, key);
  return true;
}
