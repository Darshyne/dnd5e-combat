/**
 * Un effet qui porte un état se voit TOUJOURS sur le token (règle de table, demandée par l'utilisateur le
 * 2026-09-23). En V14, l'icône d'un effet sur le token dépend de son champ `showIcon`
 * (client/canvas/placeables/token.mjs:1870) : par défaut CONDITIONAL, montrée seulement si l'effet a une
 * durée. Un état coché dans le menu reçoit ALWAYS (`ActiveEffect.fromStatusEffect`,
 * client/documents/active-effect.mjs:136) ; un effet posé par une activité (Lutte, Bousculade, Furtivité,
 * la plupart des sorts de dnd5e) n'a pas de durée : son icône restait cachée alors que l'état était là.
 *
 *  - à la création et à la mise à jour, sur le client qui écrit : un effet avec des états reçoit ALWAYS ;
 *  - au chargement, le MJ actif corrige les effets existants (acteurs du monde, tokens des scènes).
 * Un effet explicitement réglé sur NEVER par son auteur n'est pas touché.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

const SHOW = () => CONST.ACTIVE_EFFECT_SHOW_ICON;
const hasStatuses = statuses => (statuses instanceof Set ? statuses.size : (statuses?.length ?? 0)) > 0;

function onPreCreate(effect, data) {
  if ( !hasStatuses(effect.statuses) ) return;
  if ( (data.showIcon === SHOW().NEVER) || (effect.showIcon === SHOW().ALWAYS) ) return;
  effect.updateSource({ showIcon: SHOW().ALWAYS });
}

function onPreUpdate(effect, changes) {
  if ( !("statuses" in changes) || !hasStatuses(changes.statuses) ) return;
  if ( ("showIcon" in changes) || (effect.showIcon === SHOW().ALWAYS) || (effect.showIcon === SHOW().NEVER) ) return;
  changes.showIcon = SHOW().ALWAYS;
}

/** Les effets à corriger d'un acteur : des états, une icône conditionnelle. */
const hiddenConditionEffects = actor => (actor?.effects ?? [])
  .filter(e => hasStatuses(e.statuses) && (e.showIcon === SHOW().CONDITIONAL));

async function fixExisting() {
  let fixed = 0;
  const fix = async actor => {
    const list = hiddenConditionEffects(actor);
    if ( !list.length ) return;
    await actor.updateEmbeddedDocuments("ActiveEffect", list.map(e => ({ _id: e.id, showIcon: SHOW().ALWAYS })));
    fixed += list.length;
  };
  for ( const actor of game.actors ) await fix(actor);
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) if ( !token.actorLink ) await fix(token.actor);
  }
  if ( fixed ) log(`status icons: ${fixed} effect(s) made visible on tokens`);
}

export function registerIcons() {
  route("preCreateActiveEffect", onPreCreate, { label: "status icon always visible" });
  route("preUpdateActiveEffect", onPreUpdate, { label: "status icon always visible" });
  route("ready", () => fixExisting().catch(err => console.error(`${MODULE_ID} | status icons`, err)),
    { executor: true, label: "status icons: existing effects" });
}
