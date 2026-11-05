/**
 * §364 : alerte MJ — ce qu'une capacité ou un effet laisse au MJ lui est signalé, au moment où cela arrive : une carte de chat chuchotée
 * aux MJ, aux couleurs de DAS (ui/gm-alert.mjs la met aussi en bandeau en haut de l'écran du MJ).
 *  - contenu `gmAlert: { key | text, activities? }` (ou une liste) : à l'utilisation de l'item (toutes ses activités, ou celles-là), le
 *    texte `DND5ECOMBAT.AlerteMJ.<key>` (ou `text`, pour une surcouche du monde ou un module voisin) ;
 *  - `alertGM({ text, item, actor })` pour le reste du moteur (une marque de colère posée…), publié aussi en `api.gm.alert` ;
 *  - hook public `dnd5e-combat.gmAlert` `({ text, item, actor })`, appelé avant la carte : un voisin qui rend `false` la remplace.
 * Le texte reçoit `{actor}` (le nom de l'utilisateur) et `{item}`. MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, viaActiveGM } from "./shared.mjs";

export const GM_ALERT_HOOK = `${MODULE_ID}.gmAlert`;
const GM_ALERT_QUERY = `${MODULE_ID}.gmAlert`;

/** Le texte d'une règle `gmAlert`, ses variables remplies. */
function textOf(rule, { actor, item }) {
  const data = { actor: actor?.name ?? "", item: item?.name ?? "" };
  if ( rule.text ) return String(rule.text).replace(/\{(actor|item)\}/g, (m, k) => data[k]);
  return loc(`AlerteMJ.${rule.key}`, data);
}

/** Sur le MJ actif : la carte chuchotée aux MJ. */
async function postAlert({ text, item=null, actor=null }) {
  const actorDoc = actor ? await fromUuid(actor) : null;
  const itemName = item ?? "";
  if ( Hooks.call(GM_ALERT_HOOK, { text, item: itemName, actor: actorDoc }) === false ) return null;
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const message = await ChatMessage.implementation.create({
    whisper: gms,
    speaker: actorDoc ? ChatMessage.implementation.getSpeaker({ actor: actorDoc }) : { alias: "DAS" },
    content: `<div class="das-gm-alert"><header><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(loc("AlerteMJ.Titre"))}</span></header>`
      + (itemName ? `<p class="das-gm-alert__item">${esc(itemName)}${actorDoc ? ` · ${esc(actorDoc.name)}` : ""}</p>` : "")
      + `<p class="das-gm-alert__text">${esc(text)}</p></div>`,
    flags: { [MODULE_ID]: { gmAlert: { text, item: itemName, actor: actorDoc?.name ?? null } } }
  });
  log(`GM alert: ${itemName ? `${itemName} — ` : ""}${text}`);
  return message?.id ?? null;
}

/**
 * Signale au MJ ce qui lui revient. Depuis n'importe quel client : la carte est créée par le MJ actif.
 * @param {{ text: string, item?: Item|string|null, actor?: Actor|null }} alert
 */
export async function alertGM({ text, item=null, actor=null }) {
  if ( !text ) return null;
  const payload = { text: String(text), item: (typeof item === "string") ? item : (item?.name ?? null), actor: actor?.uuid ?? null };
  if ( !game.users.activeGM ) return null;
  return viaActiveGM(GM_ALERT_QUERY, postAlert, payload);
}

/** Les règles `gmAlert` de l'item qui valent pour cette activité. */
export function alertsFor(item, activityId) {
  const rule = item ? contentOf(item).entry?.gmAlert : null;
  return [rule].flat().filter(Boolean).filter(r => !r.activities || r.activities.includes(activityId));
}

async function onUsage(message) {
  if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
  const activity = message.getAssociatedActivity?.();
  const item = activity?.item ?? message.getAssociatedItem?.();
  const rules = alertsFor(item, activity?.id);
  if ( !rules.length ) return;
  const actor = message.getAssociatedActor?.() ?? item?.actor ?? null;
  for ( const rule of rules ) await postAlert({ text: textOf(rule, { actor, item }), item: item?.name ?? null, actor: actor?.uuid ?? null });
}

export function registerGmAlert() {
  CONFIG.queries[GM_ALERT_QUERY] = postAlert;
  route("createChatMessage", onUsage, { executor: true, label: "GM alert: not posted" });
}
