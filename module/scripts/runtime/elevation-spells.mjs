/**
 * §164 : des sorts qui changent l'élévation d'une créature.
 *  - Lévitation (`levitate: { effect, height, units }`) : le porteur de l'effet s'élève de `height` à la pose ; tant qu'il lévite, son
 *    effet porte l'immunité à « En chute » de dnd5e (content/spell-rules.mjs, `effectChanges`). §195 : l'effet tombé, il « redescend
 *    doucement jusqu'au sol » — le sol sous lui (`groundUnder`), par un déplacement `fall` (sans coût, sans dégâts), puis dnd5e réévalue
 *    sa chute (`updateFalling`, qui retire « En chute » s'il l'avait posé entre-temps).
 *  - Inversion de la gravité (étape `lift` sur une sauvegarde ratée, runtime/engine.mjs) : la cible monte au sommet de la zone ; quand la
 *    zone tombe (concentration, durée), elle chute — §195 : la chute de dnd5e (`fallLikeDnd5e`, runtime/climb.mjs : `updateFalling` puis
 *    `plummet`, 1d6 contondants par 3 m, 20d6 au plus, À terre si elle subit des dégâts).
 * Le token monte par `displace` (ni chemin, ni coût, ni attaque d'opportunité, comme `move-token`). MJ actif.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "../adapter/content.mjs";
import { originItemOf, comesFromItemEffect } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { groundUnder } from "../adapter/altitude.mjs";
import { fallLikeDnd5e } from "./climb.mjs";

/** Une hauteur dans l'unité de la grille de la scène. */
const toGrid = (scene, value, units) => lengthIn(value, units, scene.grid.units);

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

/**
 * La Lévitation finie : le token se pose sur le sol sous lui (pas à l'élévation qu'il avait : il a pu passer au-dessus d'un fossé ou d'un
 * toit), en douceur — un déplacement `fall` (dnd5e : sans coût ; aucune carte de dégâts, celle-ci ne vient que de `plummet`) —, puis dnd5e
 * réévalue sa chute.
 */
async function onDeleteEffect(effect) {
  const actor = effect.parent;
  const from = effect.getFlag?.(MODULE_ID, "levitate");
  if ( (actor?.documentName !== "Actor") || !from ) return;
  for ( const token of actor.getActiveTokens(false, true) ) {
    if ( !(token.id in from) ) continue;
    const ground = groundUnder(token);
    const elevation = token._source.elevation ?? 0;
    if ( elevation > ground + 1e-6 ) {
      const { x, y, level } = token._source;
      await token.move([{ x, y, elevation: ground, level, action: "fall" }], { animate: false, [MODULE_ID]: { cleared: true } });
    }
    if ( typeof token.updateFalling === "function" ) await token.updateFalling();
    log(`${token.name}: Levitate ends, floats down to the ground (${elevation} → ${token._source.elevation})`);
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

/**
 * La zone tombée : chacun de ceux qu'elle a soulevés chute — la chute de dnd5e (§195), jusqu'à la surface sous lui ; la carte de dégâts
 * de dnd5e est appliquée par le moteur (runtime/climb.mjs, `onFallCard`), qui met À terre si la chute blesse.
 */
async function onDeleteRegion(region) {
  for ( const token of region.parent?.tokens ?? [] ) {
    const lifted = token.getFlag(MODULE_ID, "lifted");
    if ( !lifted || (lifted.region !== region.id) ) continue;
    await token.unsetFlag(MODULE_ID, "lifted");
    const from = token._source.elevation ?? 0;
    const fell = await fallLikeDnd5e(token);
    log(`${token.name}: ${region.name} ends, ${fell ? `falls ${from} → ${token._source.elevation}` : "does not fall (supported or flying)"}`);
  }
}

export function registerElevationSpells() {
  route("createActiveEffect", onCreateEffect, { executor: true, label: "Levitate: not lifted" });
  route("deleteActiveEffect", onDeleteEffect, { executor: true, label: "Levitate: not brought down" });
  route("deleteRegion", onDeleteRegion, { executor: true, label: "Reverse Gravity: fall not applied" });
}
