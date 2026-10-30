/**
 * À terre (SPEC §17.2) : PHB 2024, « vos seules options de déplacement sont de ramper ou de dépenser un déplacement égal à
 * la moitié de votre Vitesse pour vous relever ».
 *  - Ramper : dnd5e 6 a l'action de déplacement `crawl` (coût + distance, documents/token.mjs:233) et réduit à 0 toute
 *    vitesse autre que la marche d'une créature À terre (`CONFIG.DND5E.conditionEffects.crawl`, data/actor/templates/
 *    attributes.mjs:534), mais ne met jamais le token en mode ramper : il marche au prix normal. Le moteur met les tokens
 *    d'une créature qui gagne l'effet `crawl` en mode `crawl` (`movementAction`, champ du token, lu par défaut par chaque
 *    point de passage : client/documents/token.mjs:1100) et rend le mode d'avant quand l'effet tombe. Terrain difficile en
 *    plus : 3 pour 1, comme le veut la règle (le terrain et l'action se cumulent dans le cœur).
 *  - Se relever : entrée du menu de son token (ui/pointer.mjs) ; en combat, la moitié de la vitesse est retirée du
 *    déplacement du tour (budget `stood`), refusé s'il n'en reste pas assez ou si la vitesse est nulle (Inconscient…).
 */

import { MODULE_ID } from "../constants.mjs";
import { standUpCost, movementAllowance } from "../core/turn.mjs";
import { placementOf } from "../core/altitude.mjs";
import { combatantFor, readBudget, writeBudget, movementOf } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { convertLength } from "../core/units.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";

const crawls = actor => actor?.hasConditionEffect?.("crawl") ?? actor?.statuses?.has("prone") ?? false;

function tokensOf(actor) {
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  // `concreteOnly` (cœur V14, client/documents/actor.mjs:595) : pas les tokens supprimés que l'acteur garde en dépendants —
  // un token lié posé puis retiré (scénario) restait dans la liste, sans id, et sa mise à jour échouait (2026-09-27).
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

/** Met les tokens de l'acteur en mode ramper, ou leur rend leur mode d'avant. MJ actif. */
async function syncCrawl(actor) {
  if ( !actor ) return;
  const on = crawls(actor);
  for ( const token of tokensOf(actor) ) {
    const saved = token.getFlag(MODULE_ID, "crawl");
    if ( on && (token.movementAction !== "crawl") ) {
      // `forced` : pas un choix de mode (§17.4) — une créature À terre en l'air tombe (dnd5e), elle n'atterrit pas.
      await token.update({ movementAction: "crawl", [`flags.${MODULE_ID}.crawl`]: { from: token._source.movementAction ?? null } }, { [MODULE_ID]: { forced: true } });
      log(`${token.name}: Prone -> crawl`);
    }
    else if ( !on && saved ) {
      // Un volant mis À terre est tombé (dnd5e) : il se relève au sol, en marchant (§17.4).
      const from = ["air", "under"].includes(placementOf(saved.from)) ? "walk" : (saved.from ?? null);
      await token.update({ movementAction: (token.movementAction === "crawl") ? from : token._source.movementAction, [`flags.${MODULE_ID}.crawl`]: null }, { [MODULE_ID]: { forced: true } });
      log(`${token.name}: standing -> ${from ?? "default mode"}`);
    }
  }
}

/** Les effets qui mettent À terre et qu'on peut quitter en se relevant (pas Inconscient, qui l'impose). */
function proneEffectsOf(actor) {
  return actor.effects.filter(e => e.statuses.has("prone") && !e.statuses.has("unconscious") && !holdsProne(e));
}

/** §285 : un effet qui tient la créature À terre (Fou rire de Tasha : « elle ne peut pas mettre fin à l'état À terre »). */
const holdsProne = effect => !effect.disabled && (contentOf(originItemOf(effect)).entry?.keepsProne === true);
export const heldProne = actor => Array.from(actor?.effects ?? []).find(e => e.statuses?.has?.("prone") && holdsProne(e)) ?? null;

export const canStandUp = token => (token?.actor?.statuses?.has("prone") === true) && !heldProne(token.actor);

/** Se relever : la moitié de la vitesse en combat, puis les effets À terre retirés. Sur le client de celui qui se relève. */
export async function standUp(token) {
  const actor = token?.actor;
  const held = heldProne(actor);
  if ( held ) { notice(token, loc("Relever.Tenu", { item: originItemOf(held)?.name ?? held.name })); return false; }
  if ( !canStandUp(token) ) return false;
  const combatant = combatantFor(actor);
  if ( combatant ) {
    const movement = movementOf(combatant, readUnitFactors());
    const budget0 = readBudget(combatant);
    const remaining = movement ? movementAllowance(budget0, movement.speed) - movement.spent : 0;
    // §134 : Athlète — se relever pour un déplacement fixe (`quickStand`), converti dans l'unité de la vitesse.
    const rule = Array.from(actor.items ?? []).map(i => contentOf(i).entry?.quickStand).find(Boolean);
    let fixed = null;
    if ( rule && movement?.units ) { try { fixed = convertLength(rule.value, rule.units, movement.units, readUnitFactors()); } catch { fixed = null; } }
    const { cost, issue } = standUpCost({ speed: movement?.speed ?? 0, remaining, fixed });
    if ( issue ) { notice(token, loc(`Relever.${issue}`)); return false; }
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, stood: (Number(budget.stood) || 0) + cost });
  }
  else if ( !((actor.system?.attributes?.movement?.walk ?? 1) > 0) ) { notice(token, loc("Relever.noSpeed")); return false; }
  const ids = proneEffectsOf(actor).map(e => e.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if ( actor.statuses.has("prone") ) { notice(token, loc("Relever.noSpeed")); return false; }   // À terre imposé (Inconscient)
  notice(token, loc("Relever.Fait"), "gain");
  log(`${actor.name} stands up`);
  return true;
}

export function registerProne() {
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => syncCrawl(actorOfEffect(effect)), { executor: true, label: "Prone: crawl mode not set or not removed" });
  }
}
