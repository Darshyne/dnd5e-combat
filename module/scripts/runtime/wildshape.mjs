/**
 * Forme sauvage en marche (SPEC §16.39) : le druide choisit une forme connue (ui/wildshape.mjs), l'activité est utilisée
 * (utilisation de Forme sauvage, action Bonus, carte), puis le MJ actif le transforme ; la forme prend fin par l'action Bonus
 * « Reprendre sa forme », à la fin de sa durée, ou quand le druide est Neutralisé ou tombe à 0 PV.
 */

import { MODULE_ID } from "../constants.mjs";
import { isWildShape, transformActor, revertForm, isWildShaped, formShouldEnd, expiredForms } from "../adapter/wildshape.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const TRANSFORM_QUERY = `${MODULE_ID}.transform`;
export const REVERT_QUERY = `${MODULE_ID}.revertForm`;

/** Côté MJ actif : transformer l'acteur, pour un joueur qui le possède. */
async function handleTransform({ actor: actorUuid, source: sourceUuid, activity: activityUuid }, { user }={}) {
  const actor = await fromUuid(actorUuid);
  const source = await fromUuid(sourceUuid);
  const activity = await fromUuid(activityUuid);
  if ( !actor || !source || !activity || (user && !actor.testUserPermission(user, "OWNER")) ) return false;
  const shaped = await transformActor(actor, source, activity);
  if ( shaped ) log(`${actor.name} takes the form of ${source.name}`);
  return !!shaped;
}

/** Les retours en cours : à 0 PV, l'état Inconscient arrive aussitôt — deux déclencheurs, un seul retour. */
const reverting = new Set();

/** Côté MJ actif : revenir à la forme d'origine. */
async function handleRevert({ actor: actorUuid, reason=null }, { user }={}) {
  if ( reverting.has(actorUuid) ) return false;
  const actor = await fromUuid(actorUuid);
  if ( !actor?.isPolymorphed || (user && !actor.testUserPermission(user, "OWNER")) ) return false;
  reverting.add(actorUuid);
  try {
    const original = await revertForm(actor);
    if ( original ) log(`${original.name} returns to their true form${reason ? ` (${reason})` : ""}`);
    return !!original;
  } finally { reverting.delete(actorUuid); }
}

/** Par le MJ actif, ou ici si l'on est lui. */
async function asGM(query, handler, payload) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Forme.SansMJ")); return false; }
  if ( gm.isSelf ) return handler(payload);
  return gm.query(query, payload, { timeout: 20000 }).catch(err => { console.warn(`${MODULE_ID} | Wild Shape`, err); return false; });
}

/**
 * §16.39 : intention « prendre cette forme » (fenêtre des formes connues, ui/wildshape.mjs) — l'utilisation suspendue repart,
 * sans que dnd5e demande une créature (un profil qu'il ne connaît pas : `_finalizeUsage` n'ouvre alors pas le compendium,
 * documents/activity/transform.mjs:113-124), la forme choisie notée ; la transformation suit l'utilisation (ci-dessous).
 * @param {Activity} activity
 * @param {[object, object, object]} usage
 * @param {string} formUuid
 */
export function takeForm(activity, [config, dialog, message], formUuid) {
  const use = { ...config, transform: { ...(config?.transform ?? {}), profile: MODULE_ID },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), wildForm: formUuid } };
  return activity.use(use, { ...(dialog ?? {}), configure: false }, message);
}

/** Intention « reprendre sa forme » (menu du clic droit) : l'action Bonus de la fiche transformée, légalité comprise. */
export function leaveForm(activity, event=null) {
  return activity.use(event ? { event } : {});
}

async function onPostUse(activity, usageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  // Transformation : après l'utilisation (dépense, action Bonus, carte), sur la forme choisie.
  if ( ours.wildForm && isWildShape(activity) ) {
    await asGM(TRANSFORM_QUERY, handleTransform, { actor: activity.actor.uuid, source: ours.wildForm, activity: activity.uuid });
    return;
  }
  // « Reprendre sa forme » : l'item posé sur la fiche transformée.
  if ( activity.item?.getFlag(MODULE_ID, "revertForm") ) {
    await asGM(REVERT_QUERY, handleRevert, { actor: activity.actor.uuid, reason: "Bonus Action" });
  }
}

/** Neutralisé ou 0 PV : la forme cesse. MJ actif. */
async function endIfNeeded(actor, reason) {
  if ( !formShouldEnd(actor) ) return;
  await handleRevert({ actor: actor.uuid, reason });
}

export function registerWildShape() {
  route("dnd5e.postUseActivity", onPostUse, { label: "Wild Shape: transformation not done" });
  route("updateActor", (actor, changes) => {
    if ( !isWildShaped(actor) || !foundry.utils.hasProperty(changes, "system.attributes.hp") ) return null;
    return endIfNeeded(actor, "0 Hit Points");
  }, { executor: true, label: "Wild Shape: end at 0 Hit Points" });
  route("createActiveEffect", effect => {
    const actor = effect.parent;
    return (actor?.documentName === "Actor") && isWildShaped(actor) ? endIfNeeded(actor, "Incapacitated") : null;
  }, { executor: true, label: "Wild Shape: end if Incapacitated" });
  route("updateWorldTime", async worldTime => {
    for ( const actor of expiredForms(worldTime) ) await handleRevert({ actor: actor.uuid, reason: "duration elapsed" });
  }, { executor: true, label: "Wild Shape: end of duration" });
  CONFIG.queries[TRANSFORM_QUERY] = handleTransform;
  CONFIG.queries[REVERT_QUERY] = handleRevert;
}
