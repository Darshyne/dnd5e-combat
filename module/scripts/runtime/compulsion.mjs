/**
 * §403 : Compulsion (Injonction, PHB 2024) — « tant que le sort dure, vous pouvez prendre une action Bonus pour désigner une direction
 * horizontale. Chaque cible charmée doit utiliser autant de déplacement que possible pour aller dans cette direction à son prochain
 * tour… Après s'être déplacée ainsi, elle refait le JS de Sagesse ». MJ actif, en combat.
 *  - Au début du tour du lanceur qui se concentre sur le sort, s'il a encore son action Bonus et qu'au moins une créature porte l'effet
 *    du sort : la question « quelle direction ? » (aucune, ou l'une des huit de la grille ; adapter/choices.mjs, `askChoice` : son
 *    joueur, puis le MJ ; sans réponse, aucune). Une direction dépense l'action Bonus et se note sur l'effet de chaque cible
 *    (`flags.dnd5e-combat.compelled.dir`). Simplification : la question vient au début du tour, pas à n'importe quel moment.
 *  - Au début du tour d'une cible ainsi désignée : elle marche aussi loin que son déplacement le permet dans cette direction, par
 *    l'A* du moteur (murs contournés, attaques d'opportunité, bord de la scène), puis l'effet note `moved`.
 *  - La sauvegarde de fin de tour (`resave` avec `ifCompelled`, runtime/triggers.mjs) n'est rejouée qu'après cette marche.
 * Ce qui reste au MJ : « elle peut prendre son action avant de se déplacer », un déplacement qui la mettrait en danger évident.
 */

import { MODULE_ID } from "../constants.mjs";
import { DIRECTIONS, directionTarget } from "../core/orders.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { readBudget, writeBudget } from "../adapter/turn.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { approach, movementCap } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice, sleep } from "./shared.mjs";

/** Les effets du sort `item` portés par les créatures de la scène — pas la concentration du lanceur, ni rien sur le lanceur. */
function compelledEffects(item, scene) {
  const out = [];
  for ( const token of scene?.tokens ?? [] ) {
    if ( token.actor === item.actor ) continue;
    for ( const effect of token.actor?.effects ?? [] ) {
      if ( effect.disabled || effect.statuses?.has?.("concentrating") ) continue;
      if ( originItemOf(effect) === item ) out.push({ token, effect });
    }
  }
  return out;
}

/** Au début du tour du lanceur : désigner une direction (action Bonus). */
async function direct(combatant) {
  const actor = combatant?.actor;
  const scene = combatant?.token?.parent;
  if ( !actor || !scene ) return;
  for ( const item of actor.items ) {
    if ( !contentOf(item).entry?.compels || !concentrationOn(item) ) continue;
    const held = compelledEffects(item, scene);
    if ( !held.length ) continue;
    // La remise à neuf du budget part au même changement de tour (runtime/turn.mjs) : on la laisse arriver.
    await sleep(600);
    const budget = readBudget(combatant);
    if ( !((budget?.bonus ?? 0) >= 1) ) { log(`${item.name}: ${actor.name} has no Bonus Action left to direct its targets`); return; }
    const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Injonction.Direction"),
      options: [{ id: "none", label: loc("Injonction.Aucune") }, ...Object.keys(DIRECTIONS).map(d => ({ id: d, label: loc(`Injonction.Dir.${d}`) }))] });
    const dir = DIRECTIONS[answer?.id] ? answer.id : null;
    if ( !dir ) { log(`${item.name}: no direction this turn`); return; }
    await writeBudget(combatant, { ...readBudget(combatant), bonus: Math.max(0, (readBudget(combatant).bonus ?? 1) - 1) });
    for ( const { token, effect } of held ) {
      await effect.setFlag(MODULE_ID, "compelled", { dir });
      notice(token, loc(`Injonction.Dir.${dir}`), "reaction");
    }
    log(`${item.name}: ${actor.name} directs ${held.map(h => h.token.name).join(", ")} — ${dir}`);
    return;
  }
}

/** Au début du tour d'une cible désignée : autant de déplacement que possible dans la direction. */
async function obey(combatant) {
  const token = combatant?.token;
  const effect = (token?.actor?.effects ?? []).find(e => e.getFlag?.(MODULE_ID, "compelled")?.dir && !e.disabled);
  if ( !effect ) return;
  const { dir } = effect.getFlag(MODULE_ID, "compelled");
  await sleep(600);
  const scene = token.parent;
  const { sceneX, sceneY, sceneWidth, sceneHeight, size } = scene.dimensions;
  const origin = scene.grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const here = cellOf(token);
  const cells = Math.floor(movementCap(token) / (scene.grid.distance || 5));
  const rel = directionTarget({ i: here.i - origin.i, j: here.j - origin.j }, dir, cells,
    { rows: Math.floor(sceneHeight / size), columns: Math.floor(sceneWidth / size) });
  let result = { arrived: false, reason: "noRoom" };
  if ( rel ) result = await approach(token, { cells: [{ i: rel.i + origin.i, j: rel.j + origin.j }] });
  await effect.setFlag(MODULE_ID, "compelled", { moved: true });
  const after = cellOf(token);
  log(`${effect.name}: ${token.name} moves ${dir} (${here.i},${here.j} → ${after.i},${after.j}, ${result.arrived ? "all the way" : result.reason})`);
  notice(token, loc(`Injonction.Dir.${dir}`), "reaction");
}

export function registerCompulsion() {
  route("combatTurnChange", (combat, prior, current) => {
    const combatant = combat.combatants.get(current?.combatantId);
    if ( !combatant?.token ) return;
    return enqueue(`compulsion:${combatant.token.uuid}`, async () => { await obey(combatant); await direct(combatant); });
  }, { executor: true, label: "Compulsion: direction not played" });
}
