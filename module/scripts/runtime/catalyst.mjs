/**
 * §289 : Seconde peau (Ravenloft), Changement involontaire — « après avoir vécu le catalyseur, au début de votre prochain tour, faites un
 * jet de sauvegarde de Charisme (DD 13 + bonus de maîtrise). Raté : vous utilisez aussitôt Forme alternative pour lancer Modification
 * d'apparence sans emplacement. Si vous avez déjà dépensé ce bénéfice, vous avez l'état Étourdi jusqu'au début de votre prochain tour. »
 * Le catalyseur se juge à la table : le MJ le déclare par le menu du token (`armCatalyst`) ; au début du tour suivant du porteur (aussitôt
 * hors combat), le MJ actif joue la sauvegarde (`requestSave`), puis le lancement gratuit ou l'effet « Étourdi » de l'item (`effectEnds` le
 * fait tomber au début de son tour suivant). Carte et texte flottant pour tous.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { placeItemEffect } from "../adapter/effects.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { combatantFor } from "../adapter/turn.mjs";
import { requestSave } from "./neighbours.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, locEsc, notice, say, viaActiveGM } from "./shared.mjs";

const FLAG = "catalyst";
export const CATALYST_QUERY = `${MODULE_ID}.catalyst`;

/** L'item du porteur qui déclare un catalyseur, et sa règle — `{ item, rule }`, ou null. */
export function catalystOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.catalyst;
    if ( rule ) return { item, rule };
  }
  return null;
}

/** Le catalyseur est-il déjà déclaré, en attente du début du tour ? */
export const catalystArmed = actor => !!actor?.getFlag(MODULE_ID, FLAG);

/** MJ actif : la sauvegarde et ce qui suit. */
async function resolveCatalyst(actor) {
  const found = catalystOf(actor);
  if ( actor.getFlag(MODULE_ID, FLAG) ) await actor.unsetFlag(MODULE_ID, FLAG);
  if ( !found ) return null;
  const { item, rule } = found;
  const save = item.system.activities?.get(rule.save);
  const ability = Array.from(save?.save?.ability ?? [])[0] ?? "cha";
  const dc = Number(save?.save?.dc?.value) || null;
  const token = tokenOf(actor);
  const result = await requestSave(actor, { ability, dc, flavor: loc("Catalyseur.Sauvegarde", { item: item.name, name: actor.name }) });
  if ( !result ) return null;
  if ( result.success ) {
    if ( token ) notice(token, { key: "Catalyseur.Resiste" }, "gain", { all: true });
    await say({ actor }, locEsc("Catalyseur.Reussie", { name: actor.name, item: item.name, total: result.total, dc: dc ?? "?" }), { catalyst: { item: item.name, success: true } });
    log(`${item.name}: ${actor.name} resists the change (${result.total} vs DC ${dc})`);
    return { success: true };
  }
  // Le lancement gratuit, s'il reste : l'activité de Forme alternative (elle dépense l'utilisation de l'item).
  const cast = item.system.activities?.get(rule.cast);
  const uses = item.system.uses;
  const left = Number(uses?.max) ? (Number(uses.value) || 0) : 0;
  let outcome = "stunned";
  if ( cast && (left > 0) ) {
    const used = await cast.use({ [MODULE_ID]: { confirmed: true } }, { configure: false }).catch(err => { console.error(`${MODULE_ID} | ${item.name}`, err); return null; });
    if ( used ) outcome = "changes";
  }
  if ( outcome === "stunned" ) await placeItemEffect(item, rule.effect, actor);
  if ( token ) notice(token, { key: outcome === "changes" ? "Catalyseur.Change" : "Catalyseur.Etourdi" }, "refused", { all: true });
  await say({ actor }, locEsc(outcome === "changes" ? "Catalyseur.Transforme" : "Catalyseur.Assomme", { name: actor.name, item: item.name, total: result.total, dc: dc ?? "?" }),
    { catalyst: { item: item.name, success: false, outcome } });
  log(`${item.name}: ${actor.name} fails (${result.total} vs DC ${dc}) — ${outcome}`);
  return { success: false, outcome };
}

/** MJ actif : le catalyseur noté ; hors combat, la sauvegarde aussitôt. */
async function handleCatalyst({ actor: uuid }) {
  const actor = await fromUuid(uuid ?? "");
  if ( !actor || !catalystOf(actor) ) return null;
  if ( combatantFor(actor)?.parent?.started ) {
    await actor.setFlag(MODULE_ID, FLAG, true);
    const token = tokenOf(actor);
    if ( token ) notice(token, { key: "Catalyseur.Note" }, "refused", { all: true });
    log(`${actor.name}: change catalyst noted, saving throw at the start of their next turn`);
    return { armed: true };
  }
  return resolveCatalyst(actor);
}

/** Le MJ déclare le catalyseur vécu (menu du token). */
export function armCatalyst(actor) {
  return viaActiveGM(CATALYST_QUERY, handleCatalyst, { actor: actor.uuid }, { fallback: null });
}

export function registerCatalyst() {
  CONFIG.queries[CATALYST_QUERY] = handleCatalyst;
  route("combatTurnChange", (combat, prior, current) => {
    const actor = combat.combatants.get(current?.combatantId)?.actor;
    if ( catalystArmed(actor) ) return enqueue(`catalyst:${actor.uuid}`, () => resolveCatalyst(actor));
  }, { executor: true, label: "involuntary change: not played" });
}
