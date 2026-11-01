/**
 * Éclats (SPEC §16.19, clé `burst`) : une fois l'attaque tranchée — touchée ou ratée —, l'activité sœur que l'item déclare
 * joue sur la cible et sur chaque créature à `radius` d'elle (l'explosion du Couteau de glace). Sur le MJ actif, au hook de
 * sortie du moteur `dnd5e-combat.resolution` (runtime/engine.mjs) ; une seule fois par attaque.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { distanceBetween, speakerTokenOf } from "../adapter/turn.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { burstAround } from "../adapter/areas.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { lengthIn } from "../adapter/units.mjs";

/**
 * Les créatures touchées par l'éclat : la cible, et toute créature à `radius` d'elle (ni cachée, ni objet piloté). C12-b : `affects:
 * "enemy"` — seulement les ennemis du lanceur, la cible exclue (Choc de vie : la foudre jaillit de la créature ranimée).
 */
function caughtAround(center, { radius, units, affects=null }, caster=null) {
  let limit = lengthIn(radius, units, center.parent.grid.units);
  const all = center.parent.tokens.filter(t => (t === center) || (t.actor && !t.hidden && !isObjectToken(t)
    && (t._source.level === center._source.level) && (distanceBetween(center, t).value <= limit + 1e-6)));
  return (affects === "enemy") ? all.filter(t => (t !== center) && caster && areEnemies(caster, t)) : all;
}

async function onResolution(resolution) {
  if ( ![STEPS.DONE, STEPS.MISSED].includes(resolution?.step) ) return;
  const usage = game.messages.get(resolution.origin);
  if ( !usage || usage.getFlag(MODULE_ID, "burst") || usage.getFlag(MODULE_ID, "areaTick") ) return;
  const activity = fromUuidSync(resolution.activity, { strict: false });
  const rule = activity?.item ? contentOf(activity.item).entry?.burst : null;
  if ( !rule ) return;
  // Sans `from` : après une attaque, touchée ou ratée. Avec : après ces activités, sur une cible qui a subi des dégâts.
  // C12-b : après un soin (Choc de vie), sans condition de dégâts.
  const afterHeal = activity.type === "heal";
  if ( rule.from ? !rule.from.includes(activity.id) || (!afterHeal && !((resolution.targets?.[0]?.damage?.applied ?? 0) > 0)) : !resolution.plan?.attack ) return;
  const sibling = rule ? activity.item.system.activities?.get(rule.activity) : null;
  const center = resolution.targets?.[0]?.token ? fromUuidSync(resolution.targets[0].token, { strict: false }) : null;
  if ( !sibling || !center ) return;
  await usage.setFlag(MODULE_ID, "burst", true);
  const caught = caughtAround(center, rule, speakerTokenOf(usage));
  if ( !caught.length ) { log(`${activity.item.name}: no creature caught by the burst`); return; }
  log(`${activity.item.name}: ${resolution.step === STEPS.MISSED ? "miss" : "hit"}, the burst explodes on ${caught.map(t => t.name).join(", ")}`);
  await burstAround(usage, caught, sibling, center);
}

export function registerBursts() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`burst:${resolution?.origin}`, () => onResolution(resolution)),
    { executor: true, label: "burst: explosion not played" });
}
