/**
 * §95 : Lamentations d'outre-tombe (Fantôme, clé `afterSneak: { activity, radius, units }`) — « juste après avoir infligé les dégâts
 * de votre Attaque sournoise à une créature à votre tour, vous pouvez viser une seconde créature visible à 9 m de la première ;
 * lancez la moitié des dés de l'Attaque sournoise (arrondi au supérieur), dégâts nécrotiques ». Sur le MJ actif, à la résolution du
 * coup dont le jet de dégâts porte la marque d'Attaque sournoise (runtime/sneak.mjs) : la question à l'auteur (« Personne » d'abord),
 * puis l'activité de l'item (ses dés : `ceil(@scale.rogue.sneak-attack.number / 2)` de la donnée) utilisée sur la créature choisie
 * — une utilisation de l'item dépensée par dnd5e.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { contentOf } from "../adapter/content.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { usesLeftFor } from "../adapter/inspiration.mjs";
import { combatantFor, distanceBetween, isOwnTurn } from "../adapter/turn.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.damageRoll?.messageId ) return;
  const sneak = game.messages.get(resolution.damageRoll.messageId)?.getFlag(MODULE_ID, "sneak");
  if ( !sneak ) return;
  const source = fromUuidSync(sneak.source ?? "", { strict: false });
  const first = fromUuidSync(sneak.target ?? "", { strict: false });
  const actor = source?.actor;
  if ( !actor || !first?.parent ) return;
  const combatant = combatantFor(actor);
  if ( combatant && !isOwnTurn(combatant) ) return;   // « à votre tour »
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.afterSneak;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !(usesLeftFor(activity) > 0) ) continue;
    let reach = rule.radius;
    try { reach = convertLength(rule.radius, rule.units, first.parent.grid.units, readUnitFactors()); } catch { /* grille */ }
    const candidates = first.parent.tokens.filter(t => t.actor && (t !== first) && (t !== source) && !t.hidden
      && ((t.actor.system.attributes?.hp?.value ?? 0) > 0) && (distanceBetween(first, t).value <= (reach + 1e-6)));
    if ( !candidates.length ) return;
    const answer = await askChoice(actor, {
      actor: actor.uuid, item: item.name, prompt: loc("Lamentations.Question", { item: item.name, name: first.name }),
      options: [{ id: "no", label: loc("Balayage.Non") }, ...candidates.map(t => ({ id: t.uuid, label: t.name }))]
    });
    const victim = candidates.find(t => t.uuid === answer?.id);
    if ( !victim ) return;
    if ( victim.object ) canvas.tokens.setTargets([victim.id]);
    log(`${item.name}: ${victim.name}, ${Math.round(distanceBetween(first, victim).value)} from ${first.name}`);
    await activity.use({ [MODULE_ID]: { confirmed: true } }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | ${item.name}`, err));
    return;
  }
}

export function registerAfterSneak() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "Wails from the Grave not offered" });
}
