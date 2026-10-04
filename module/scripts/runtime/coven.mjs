/**
 * Cercles (SPEC §19.5) : PV partagés et seconde phase, sur le MJ actif. La lecture et l'écriture sont dans adapter/coven.mjs,
 * le report des PV dans core/coven.mjs.
 */

import { sharedHpItemOf, shareHp, isSharedWrite, transformsAtZero, enterSecondPhase, covenMembers, standsAtZero, standAtOne,
  purgeEffects, formChangeOf, changeForm } from "../adapter/coven.mjs";
import { contentOf } from "../adapter/content.mjs";
import { log, loc } from "./shared.mjs";
import { burstAtZero } from "./emanations.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";

/** Une file pour tous les cercles : deux écarts reportés l'un après l'autre ne s'écrasent pas. */
const QUEUE = "coven";

/** Les créatures dont la seconde phase est en cours : un seul passage par créature. */
const shifting = new Set();

/** Un membre a perdu ou regagné des PV (dégâts, soins, barre du token) : les autres suivent. */
function onHpChanged(actor, changes, changed) {
  if ( !changes?.hp || isSharedWrite(changed) || !sharedHpItemOf(actor) ) return;
  const members = covenMembers(actor);   // maintenant : à 0 PV, la seconde phase va rendre ce token à une autre forme
  return enqueue(QUEUE, async () => {
    const done = await shareHp(actor, changes.hp, members);
    for ( const d of done ) log(`cercle : ${d.name} suit ${actor.name} (${changes.hp > 0 ? "+" : ""}${changes.hp} PV : ${d.before} → ${d.after})`);
  });
}

/** Un acteur vient de tomber à 0 PV : s'il a une seconde phase, il change de forme au lieu de tomber (§17.1 laisse faire). */
function onZero(actor) {
  if ( !actor || shifting.has(actor.uuid) || !(transformsAtZero(actor) || standsAtZero(actor)) ) return;
  shifting.add(actor.uuid);
  return enqueue(QUEUE, async () => {
    try {
      // dnd5e pose Mort sur le client qui a écrit les PV (`updateDowned`) : on lui laisse le temps, la phase le retire.
      await new Promise(resolve => setTimeout(resolve, 400));
      if ( (actor.system?.attributes?.hp?.value ?? 1) > 0 ) return;
      // §19.6 : le dernier carré passe avant tout — il ne tombe pas.
      const stood = await standAtOne(actor);
      if ( stood ) return log(`${stood} : ${actor.name} reste debout à 1 PV`);
      await burstAtZero(actor);   // §19.6 : explosion à 0 PV, avant la bascule
      const done = await enterSecondPhase(actor);
      if ( done ) log(`seconde phase : ${done.from} → ${done.to}`);
    } finally { shifting.delete(actor.uuid); }
  });
}

/** §19.6 : l'activité d'un dernier rempart vient d'être utilisée (réaction à 50 PV ou moins) : tout ce qui l'affectait prend fin. */
async function onLastStandUsed(activity) {
  const actor = activity?.actor;
  if ( !actor || !contentOf(activity.item).entry?.lastStand ) return;
  const n = await purgeEffects(actor);
  log(`${activity.item.name} : ${n} effet(s) retiré(s) de ${actor.name}`);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("EffetsPurges", { item: activity.item.name, name: actor.name })}</p>`
  });
}

/** §76 : une forme révélée à volonté (`changesForm`) — l'échange de token de la seconde phase, après l'utilisation. */
function onFormChange(activity) {
  const actor = activity?.actor;
  if ( !actor || !formChangeOf(activity) || shifting.has(actor.uuid) ) return;
  shifting.add(actor.uuid);
  return enqueue(QUEUE, async () => {
    try {
      const done = await changeForm(activity);
      if ( done ) log(`changement de forme : ${done.from} → ${done.to}`);
    } finally { shifting.delete(actor.uuid); }
  });
}

export function registerCoven() {
  route("dnd5e.postUseActivity", onFormChange, { executor: true, label: "changement de forme non joué" });
  route("dnd5e.postUseActivity", onLastStandUsed, { executor: true, label: "dernier rempart : effets non retirés" });
  route("dnd5e.damageActor", onHpChanged, { executor: true, label: "cercle : PV non partagés" });
  route("dnd5e.healActor", onHpChanged, { executor: true, label: "cercle : soins non partagés" });
  route("updateActor", (actor, changed) => {
    if ( foundry.utils.getProperty(changed, "system.attributes.hp.value") === 0 ) return onZero(actor);
  }, { executor: true, label: "seconde phase non jouée" });
  route("updateToken", (token, changed) => {
    if ( foundry.utils.getProperty(changed, "delta.system.attributes.hp.value") === 0 ) return onZero(token.actor);
  }, { executor: true, label: "seconde phase non jouée (token non lié)" });
}
