/**
 * §265 : le Bannissement réel (`banishes`, audit CAT / CPR) — « la cible est transportée dans un demi-plan inoffensif » (Bannissement,
 * Châtiment bannissant). La donnée ne pose que l'état Neutralisé : la cible restait sur la carte, ciblable. Quand l'effet déclaré se pose,
 * le token et son combattant sont cachés (rien ne le vise, ne le voit, ne l'entend) ; quand il tombe (sort terminé, concentration rompue),
 * il réapparaît dans l'espace quitté, ou, s'il est occupé, dans l'espace libre le plus proche (« la cible réapparaît dans l'espace
 * qu'elle a quitté ou, si celui-ci est occupé, dans l'espace inoccupé le plus proche »). Le bannissement définitif d'une créature
 * d'un autre plan au bout d'une minute reste au MJ. MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { nearestFreeCell } from "../core/plane.mjs";
import { contentOf } from "../adapter/content.mjs";
import { comesFromItemEffect, originItemOf } from "../adapter/facts.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { occupiedAt } from "./actions.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, notice } from "./shared.mjs";

const FLAG = "banished";

/** L'effet vient-il d'un item qui bannit, par l'un de ses effets déclarés ? */
function banishing(effect) {
  if ( effect.parent?.documentName !== "Actor" ) return false;
  const ids = contentOf(originItemOf(effect)).entry?.banishes ?? [];
  return ids.some(id => comesFromItemEffect(effect, id));
}

const tokensOf = actor => actor.isToken ? [actor.token].filter(Boolean) : (actor.getActiveTokens?.(false, true) ?? []);

async function hideCombatant(token, hidden) {
  for ( const combat of game.combats ) {
    const c = combat.combatants.find(x => (x.sceneId === token.parent?.id) && (x.tokenId === token.id));
    if ( c && (c.hidden !== hidden) ) await c.update({ hidden });
  }
}

async function onCreateEffect(effect) {
  if ( !banishing(effect) ) return;
  for ( const token of tokensOf(effect.parent) ) {
    if ( token.getFlag(MODULE_ID, FLAG) ) continue;
    notice(token, { key: "Retour.Banni" }, "ended", { all: true, action: "spellEnds", outcome: "success" });
    await token.update({ hidden: true, [`flags.${MODULE_ID}.${FLAG}`]: { wasHidden: token.hidden === true } });
    await hideCombatant(token, true);
    log(`${token.name}: banished to a harmless demiplane`);
  }
}

async function onDeleteEffect(effect) {
  if ( !banishing(effect) ) return;
  const actor = effect.parent;
  // Un autre bannissement tient encore : elle reste là-bas.
  if ( actor.effects.some(e => (e.id !== effect.id) && banishing(e)) ) return;
  for ( const token of tokensOf(actor) ) {
    const state = token.getFlag(MODULE_ID, FLAG);
    if ( !state ) continue;
    await token.update({ hidden: state.wasHidden === true, [`flags.${MODULE_ID}.-=${FLAG}`]: null });
    await hideCombatant(token, state.wasHidden === true);
    if ( occupiedAt(token, token._source) ) {
      const grid = token.parent.grid;
      const cell = nearestFreeCell(cellOf(token), c => !occupiedAt(token, grid.getTopLeftPoint(c)), 12);
      if ( cell ) {
        const to = grid.getTopLeftPoint(cell);
        await token.move([{ x: to.x, y: to.y, elevation: token._source.elevation, level: token._source.level, snapped: true, action: "displace" }],
          { [MODULE_ID]: { cleared: true } });
      }
    }
    notice(token, { key: "Retour.Revenu" }, "gain", { all: true });
    log(`${token.name}: back from the demiplane`);
  }
}

export function registerBanish() {
  route("createActiveEffect", effect => enqueue(`banish:${effect.parent?.uuid}`, () => onCreateEffect(effect)),
    { executor: true, label: "banishment: target not removed from the scene" });
  route("deleteActiveEffect", effect => enqueue(`banish:${effect.parent?.uuid}`, () => onDeleteEffect(effect)),
    { executor: true, label: "banishment: target not returned" });
}
