/**
 * §50 : la trousse de soins (`stabilizes`) — une utilisation, au prix d'une action Utiliser, stabilise une créature Inconsciente à
 * 0 PV sans test de Médecine. Après l'utilisation (la dépense et l'action, dnd5e et
 * la légalité du moteur), la cible visée est stabilisée : par le MJ actif quand elle n'appartient pas à l'auteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { stabilize } from "../adapter/death.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

export const STABILIZE_QUERY = `${MODULE_ID}.stabilize`;

/** MJ actif (ou propriétaire) : la règle est relue — un client ne stabilise pas n'importe qui avec n'importe quoi. */
async function handleStabilize({ target, activity: activityUuid }) {
  const token = await fromUuid(target ?? "");
  const activity = await fromUuid(activityUuid ?? "");
  if ( !token?.actor || !contentOf(activity?.item).entry?.stabilizes ) return false;
  return stabilize(token.actor, { by: activity.actor?.name ?? "", with: activity.item.name });
}

/** `dnd5e.postUseActivity` sur le client de l'auteur : la première cible du message d'utilisation. */
async function onPostUse(activity, usageConfig, results) {
  if ( !contentOf(activity?.item).entry?.stabilizes || !activity.actor?.isOwner ) return;
  const first = results?.message?.system?.targets?.[0]?.token ?? Array.from(game.user.targets)[0]?.document?.uuid ?? null;
  const token = first ? await fromUuid(first) : null;
  if ( !token?.actor ) { log(`${activity.item.name}: no target to stabilize`); return; }
  const args = { target: token.uuid, activity: activity.uuid };
  const done = token.actor.isOwner ? await handleStabilize(args)
    : await game.users.activeGM?.query(STABILIZE_QUERY, args, { timeout: 10000 }).catch(() => false);
  if ( done ) log(`${activity.item.name}: ${token.name} stabilized by ${activity.actor.name}`);
  else notice(token, loc("Retour.PasAStabiliser", { name: token.name }));
}

export function registerStabilize() {
  CONFIG.queries[STABILIZE_QUERY] = handleStabilize;
  route("dnd5e.postUseActivity", onPostUse, { label: "healer's kit: stabilization" });
}
