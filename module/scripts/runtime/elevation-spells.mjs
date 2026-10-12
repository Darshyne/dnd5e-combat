/**
 * §164 : des sorts qui changent l'élévation d'une créature.
 *  - Lévitation (`levitate: { effect, height, units }`) : le porteur de l'effet s'élève de `height` à la pose ; l'effet tombé, il
 *    redescend à l'élévation qu'il avait.
 *  - Inversion de la gravité (étape `lift` sur une sauvegarde ratée, runtime/engine.mjs) : la cible monte au sommet de la zone ; quand la
 *    zone tombe (concentration, durée), elle chute — 1d6 contondants par 3 m (20d6 au plus) et À terre.
 * Le token est déplacé par `displace` (ni chemin, ni coût, ni attaque d'opportunité, comme `move-token`). MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

/** Une hauteur dans l'unité de la grille de la scène. */
const toGrid = (scene, value, units) => { try { return convertLength(value, units, scene.grid.units, readUnitFactors()); } catch { return value; } };

/** Déplace le token à cette élévation, sur place. */
async function setElevation(token, elevation) {
  const { x, y, level } = token._source;
  await token.move([{ x, y, elevation, level, action: "displace" }], { [MODULE_ID]: { cleared: true } });
}

/** La règle `levitate` de l'item d'où vient cet effet, s'il en est l'effet. */
function levitationOf(effect) {
  const rule = contentOf(originItemOf(effect)).entry?.levitate;
  return (rule && comesFromItemEffect(effect, rule.effect)) ? rule : null;
}

async function onCreateEffect(effect) {
  const actor = effect.parent;
  if ( actor?.documentName !== "Actor" ) return;
  const rule = levitationOf(effect);
  if ( !rule ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    const from = token._source.elevation ?? 0;
    await setElevation(token, from + toGrid(token.parent, rule.height, rule.units));
    await effect.setFlag(MODULE_ID, "levitate", { [token.id]: from });
    log(`${token.name}: levitates (${from} → ${token._source.elevation})`);
  }
}

async function onDeleteEffect(effect) {
  const actor = effect.parent;
  const from = effect.getFlag?.(MODULE_ID, "levitate");
  if ( (actor?.documentName !== "Actor") || !from ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    if ( !(token.id in from) ) continue;
    await setElevation(token, from[token.id]);
    log(`${token.name}: Levitate ends, back to ${from[token.id]}`);
  }
}

/** Étape `lift` (runtime/engine.mjs) : la cible monte ; la zone qui l'a soulevée est notée sur son token. */
export async function liftToken(token, step, region) {
  if ( !token ) return;
  const from = token._source.elevation ?? 0;
  const to = toGrid(token.parent, step.height, step.units);
  if ( to <= from ) return;
  await setElevation(token, to);
  await token.setFlag(MODULE_ID, "lifted", { region: region?.id ?? null, from });
  log(`${token.name}: lifted to ${to} (${region?.name ?? "area"})`);
}

/** La zone tombée : chacun de ceux qu'elle a soulevés chute. */
async function onDeleteRegion(region) {
  for ( const token of region.parent?.tokens ?? [] ) {
    const lifted = token.getFlag(MODULE_ID, "lifted");
    if ( !lifted || (lifted.region !== region.id) ) continue;
    const height = (token._source.elevation ?? 0) - (lifted.from ?? 0);
    await token.unsetFlag(MODULE_ID, "lifted");
    await setElevation(token, lifted.from ?? 0);
    if ( !(height > 0) ) continue;
    const feet = toGrid({ grid: { units: "ft" } }, height, region.parent.grid.units);
    const dice = Math.min(20, Math.floor(feet / 10));
    if ( dice > 0 && token.actor ) {
      const roll = await new Roll(`${dice}d6`).evaluate();
      await roll.toMessage({ speaker: ChatMessage.implementation.getSpeaker({ token }), flavor: `${region.name}` });
      await token.actor.applyDamage([{ value: roll.total, type: "bludgeoning" }]);
    }
    await token.actor?.toggleStatusEffect("prone", { active: true });
    log(`${token.name}: falls ${feet} ft (${dice}d6), Prone`);
  }
}

export function registerElevationSpells() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "Levitate: not lifted" });
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "Levitate: not brought down" });
  route("deleteRegion", onDeleteRegion, { executor: true, label: "Reverse Gravity: fall not applied" });
}
