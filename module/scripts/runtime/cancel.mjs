/**
 * Annuler l'action en cours tant qu'aucun dé n'est lancé (SPEC §15.1, « clic droit annule ») :
 * l'utilisation est effacée comme si elle n'avait pas eu lieu. Ensuite, c'est « Annuler » du MJ.
 *
 * Sur le client de l'auteur : le dialogue de jet encore ouvert (attaque ou dégâts, rien de lancé)
 * est fermé, dnd5e rend ce qu'il avait consommé (`Activity#refund` sur `system.deltas` du message,
 * documents/activity/mixin.mjs:385 — le bouton « Rembourser » de la carte fait la même chose,
 * mixin.mjs:1100), la concentration ouverte par ce sort tombe, puis la carte est supprimée,
 * marquée `cancelled`. Le MJ actif rend alors la dépense du budget (runtime/turn.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { concentrationEffectOf } from "../adapter/concentration.mjs";
import { log, loc } from "./shared.mjs";

/** Au-delà, une carte n'est plus « l'action en cours ». */
const PENDING_MS = 300000;

/** Aucun dé encore jeté pour cette utilisation (attaque, dégâts, sauvegarde) ? */
function noDiceYet(message) {
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !resolution ) return true;
  return !resolution.attack && !resolution.damageRoll && !resolution.targets?.some(t => t.save && (t.save.total !== null));
}

/** La dernière carte d'utilisation de cette activité, de ce client, récente et sans dé. */
function pendingUsageOf(activity) {
  const recent = game.messages.contents.slice(-30).reverse();
  return recent.find(m => m.isAuthor && (m.type === "usage") && (m.getAssociatedActivity?.()?.uuid === activity.uuid)
    && ((Date.now() - (m.timestamp ?? 0)) < PENDING_MS) && noDiceYet(m)) ?? null;
}

/** Efface une utilisation : ressources rendues, concentration retirée, carte supprimée (le MJ rend le budget). */
export async function cancelUsage(message) {
  const activity = message.getAssociatedActivity?.();
  if ( activity && message.system?.deltas ) await activity.refund(message.system.deltas);
  const effect = concentrationEffectOf(message);
  if ( effect ) await effect.parent?.endConcentration?.(effect);
  await message.setFlag(MODULE_ID, "cancelled", true);
  await message.delete();
  log(`action cancelled before any roll: ${activity?.item?.name ?? message.id}`);
  ui.notifications.info(loc("Annulation.Faite", { name: activity?.item?.name ?? "" }));
}

/**
 * Le dialogue de jet ouvert d'une action de ce client dont la carte n'a encore aucun dé, avec cette
 * carte ; null sinon (un dialogue de dégâts après un touché n'est plus annulable : c'est « Annuler »
 * du MJ). Synchrone : lu au clic.
 * @returns {{app: object, message: ChatMessage}|null}
 */
export function pendingRoll() {
  const Dialog = globalThis.dnd5e?.applications?.dice?.RollConfigurationDialog;
  if ( !Dialog ) return null;
  for ( const app of foundry.applications.instances.values() ) {
    if ( !(app instanceof Dialog) || !app.rendered ) continue;
    const activity = app.config?.subject;
    if ( !activity?.uuid || !activity.item ) continue;   // un jet de caractéristique, pas une action
    const message = pendingUsageOf(activity);
    if ( message ) return { app, message };
  }
  return null;
}

/** Ferme le dialogue de jet d'une action sans dé et efface son utilisation. true si quelque chose a été annulé. */
export async function cancelPendingRoll() {
  const pending = pendingRoll();
  if ( !pending ) return false;
  await pending.app.close();
  await cancelUsage(pending.message);
  return true;
}
