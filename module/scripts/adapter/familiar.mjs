/**
 * Familiers (SPEC §107), lus et écrits dans Foundry. Un familier est une créature invoquée (dnd5e : `flags.dnd5e.summon.origin`
 * de son acteur = uuid de l'item qui l'a invoqué : summon.mjs:261-267, dans le delta d'un token non lié, :543) dont l'item déclare `summon.familiar`
 * (content/summons.mjs). Son maître est l'acteur de cet item.
 *
 * La poche dimensionnelle est un flag du maître : `flags["dnd5e-combat"].pocket = { token, name, img, scene, at }`, `token`
 * étant `TokenDocument#toObject()` au moment du congé (le delta d'un token non lié compris : PV, effets, items). Un seul
 * familier à la fois (« Un seul familier »).
 */

import { MODULE_ID } from "../constants.mjs";
import { RECALL_RANGE, recallProblem } from "../core/familiar.mjs";
import { convertLength } from "../core/units.mjs";
import { contentOf } from "./content.mjs";
import { summonItemOf } from "./summons.mjs";
import { distanceBetween } from "./turn.mjs";
import { cellUnder, footprintOf } from "./movement.mjs";
import { readUnitFactors } from "./units.mjs";
import { isIntangible } from "./pilot.mjs";
import { sharesSpaceWith } from "./space-sharing.mjs";
import { footprintGap } from "../core/movement.mjs";

const POCKET = "pocket";

/** Cet item invoque-t-il un familier (`summon.familiar`) ? */
export const isFamiliarItem = item => !!item && (contentOf(item).entry?.summon?.familiar === true);

/** L'item d'origine d'un acteur invoqué, s'il déclare un familier. */
function familiarItemOfActor(actor) {
  const uuid = actor?.getFlag?.("dnd5e", "summon.origin");
  const item = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  return isFamiliarItem(item) ? item : null;
}

/** Cet acteur (celui d'un token, synthétique ou non) est-il un familier ? */
export const isFamiliarActor = actor => !!familiarItemOfActor(actor);

/** Ce token est-il un familier ? */
export const isFamiliarToken = tokenDoc => isFamiliarItem(summonItemOf(tokenDoc));

/** Le maître d'un familier (l'acteur de l'item d'invocation), ou null. */
export function masterOf(tokenDoc) {
  return isFamiliarToken(tokenDoc) ? (summonItemOf(tokenDoc)?.actor ?? null) : null;
}

/** Le familier que ce maître garde dans sa poche dimensionnelle, ou null. */
export function pocketOf(actor) {
  const pocket = actor?.getFlag?.(MODULE_ID, POCKET);
  return pocket?.token ? pocket : null;
}

/** Écrit (MJ actif) le familier congédié dans la poche de son maître. */
export async function storeInPocket(master, tokenDoc) {
  const data = tokenDoc.toObject();
  await master.unsetFlag(MODULE_ID, POCKET);
  await master.setFlag(MODULE_ID, POCKET, { token: data, name: tokenDoc.name, img: tokenDoc.texture?.src ?? null,
    scene: tokenDoc.parent?.id ?? null, at: game.time.worldTime });
  return data;
}

/** Vide (MJ actif) la poche dimensionnelle du maître. */
export function emptyPocket(master) {
  return pocketOf(master) ? master.unsetFlag(MODULE_ID, POCKET) : null;
}

/** Les tokens familiers de ce maître, sur toutes les scènes. */
export function familiarTokensOf(master) {
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) if ( masterOf(token) === master ) out.push(token);
  }
  return out;
}

/**
 * Un token provisoire (jamais créé) du familier gardé, à une position de la scène du maître : pour mesurer la distance et
 * l'occupation avec les fonctions du moteur. Lié à l'acteur de base : un delta ne sert à rien ici.
 */
function probeToken(pocket, scene, at={}) {
  const s = pocket.token;
  const data = { name: s.name, actorId: s.actorId, actorLink: true, width: s.width ?? 1, height: s.height ?? 1,
    x: at.x ?? 0, y: at.y ?? 0, elevation: at.elevation ?? 0, flags: s.flags ?? {}, ...(at.level ? { level: at.level } : {}) };
  return new CONFIG.Token.documentClass(data, { parent: scene });
}

/**
 * La case (coin haut-gauche, pixels) où le familier gardé réapparaîtrait sous ce point, au niveau et à l'élévation du maître,
 * et ce qui la refuse (« far », « occupied », ou null).
 * @param {TokenDocument} masterToken
 * @param {{x: number, y: number}} point
 */
export function recallSpot(masterToken, point) {
  const pocket = pocketOf(masterToken?.actor);
  const scene = masterToken?.parent;
  if ( !pocket || !scene ) return null;
  const level = masterToken._source.level ?? null;
  const elevation = masterToken._source.elevation ?? 0;
  const probe = probeToken(pocket, scene, { level, elevation });
  const at = scene.grid.getTopLeftPoint(cellUnder(probe, point));
  probe.updateSource({ x: at.x, y: at.y });
  let limit = RECALL_RANGE.value;
  try { limit = convertLength(RECALL_RANGE.value, RECALL_RANGE.units, scene.grid.units, readUnitFactors()); } catch {}
  const distance = distanceBetween(masterToken, probe).value;
  const mine = footprintOf(probe);
  const defeated = CONFIG.specialStatusEffects.DEFEATED;
  const occupied = scene.tokens.some(other => !other.hidden && !other.actor?.statuses?.has(defeated)
    && !isIntangible(other) && !sharesSpaceWith(probe, other) && (footprintGap(mine, footprintOf(other)) === 0));
  return { x: at.x, y: at.y, level, elevation, problem: recallProblem({ distance, limit, occupied }) };
}
