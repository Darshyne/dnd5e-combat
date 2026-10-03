/**
 * §16.47 : un sort qui fait cesser un état (`cures` : Restauration partielle — « un état parmi Aveuglé, Assourdi,
 * Paralysé ou Empoisonné »). L'interface choisit l'état (ui/cure.mjs) ; les effets qui le portent sont retirés — par le MJ
 * actif quand la cible n'appartient pas à l'auteur.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { contentOf } from "../adapter/content.mjs";
import { usageTokenOf } from "../adapter/turn.mjs";
import { log, loc, notice } from "./shared.mjs";

export const CURE_QUERY = `${MODULE_ID}.cure`;

async function removeStatus(targetUuid, status) {
  const token = await fromUuid(targetUuid);
  const actor = token?.actor;
  if ( !actor ) return 0;
  const ids = actor.effects.filter(e => e.statuses?.has(status)).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return ids.length;
}

async function handleCure({ target, status }) {
  if ( status === "exhaustion" ) {
    const actor = (await fromUuid(target))?.actor;
    if ( actor ) await actor.update({ "system.attributes.exhaustion": 0 });
    return actor ? 1 : 0;
  }
  return removeStatus(target, status);
}

/** Fait cesser `status` sur le token `target` (TokenDocument). */
export async function cureStatus(target, status) {
  const n = target.actor?.isOwner ? await removeStatus(target.uuid, status)
    : await game.users.activeGM?.query(CURE_QUERY, { target: target.uuid, status }, { timeout: 10000 }).catch(() => 0);
  const label = game.i18n.localize(CONFIG.DND5E.conditionTypes[status]?.name ?? status);
  log(`${target.name} : ${label} cesse (${n} effet(s))`);
  notice(target, loc("Retour.FinEffet", { item: label }), "ended");
  return n;
}

/**
 * §53 : `curesAll` — tous les états listés cessent sur la cible (Élixir de santé : Aveuglé, Assourdi, Paralysé, Empoisonné ;
 * Potion de vitalité : Épuisement et Empoisonné). La cible : la première du message, sinon l'utilisateur (une potion bue).
 */
async function onPostUseAll(activity, usageConfig, results) {
  const list = contentOf(activity?.item).entry?.curesAll;
  if ( !list?.length || !activity.actor?.isOwner ) return;
  const first = results?.message?.system?.targets?.[0]?.token;
  const target = (first ? await fromUuid(first) : null) ?? usageTokenOf(activity);
  if ( !target?.actor ) return;
  for ( const status of list ) {
    if ( status === "exhaustion" ) {
      const level = target.actor.system?.attributes?.exhaustion ?? 0;
      if ( level > 0 ) {
        await (target.actor.isOwner ? target.actor.update({ "system.attributes.exhaustion": 0 })
          : game.users.activeGM?.query(CURE_QUERY, { target: target.uuid, status }, { timeout: 10000 }).catch(() => 0));
        log(`${target.name} : Épuisement ${level} → 0`);
      }
      continue;
    }
    if ( target.actor.statuses?.has(status) ) await cureStatus(target, status);
  }
}

export function registerCure() {
  CONFIG.queries[CURE_QUERY] = handleCure;
  route("dnd5e.postUseActivity", onPostUseAll, { label: "potion : états non retirés" });
}
