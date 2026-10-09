/**
 * Ennemi tombé (SPEC §16.25, clé `onFell`) : Bénédiction du Ténébreux. Sur le MJ actif, au hook de sortie du moteur
 * `dnd5e-combat.resolution`, une fois la résolution close : chaque cible passée de plus de 0 à 0 PV. Chaque créature de la
 * scène qui porte un item `onFell` et lui est hostile en profite si c'est elle qui l'a fait tomber, ou si elle est à
 * `radius` de la victime : l'activité de l'item joue (PV temporaires, que dnd5e ne cumule pas).
 * Limite : des dégâts appliqués hors du moteur (plateau du système, barre du token) ne sont pas vus.
 */

import { STEPS } from "../core/action.mjs";
import { areHostile } from "../core/reaction.mjs";
import { convertLength } from "../core/units.mjs";
import { contentOf } from "../adapter/content.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";

const seen = new Set();

/** L'item `onFell` de l'acteur et sa règle — un seul par créature (une fiche peut en porter deux copies). */
function fellRuleOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.onFell;
    if ( rule ) return { item, rule };
  }
  return null;
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || seen.has(resolution.id) ) return;
  const fallen = (resolution.log ?? []).filter(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0));
  if ( !fallen.length ) return;
  seen.add(resolution.id);
  for ( const entry of fallen ) {
    const victim = fromUuidSync(entry.token, { strict: false });
    if ( !victim?.parent ) continue;
    for ( const token of victim.parent.tokens ) {
      if ( (token === victim) || !token.actor || isObjectToken(token) || ((token.actor.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
      const found = fellRuleOf(token.actor);
      if ( !found || !areHostile(token.disposition, victim.disposition) ) continue;
      const mine = !!resolution.source && (token.actor.uuid === resolution.source);
      let limit = found.rule.radius;
      try { limit = convertLength(found.rule.radius, found.rule.units, victim.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
      if ( !mine && !(distanceBetween(token, victim).value <= limit + 1e-6) ) continue;
      const activities = found.item.system.activities;
      const activity = activities?.get(found.rule.activity ?? "") ?? activities?.find(a => a.type === "heal");
      if ( !activity ) continue;
      log(`${found.item.name}: ${victim.name} falls ${mine ? "to the blows of" : "near"} ${token.name}`);
      // Le soin se lance ici, sans fenêtre : l'action enchaînée de dnd5e (heal.mjs:60) ouvrirait la fenêtre du jet chez le
      // MJ, faute d'évènement. Rattaché à sa carte (`system.origin`), il suit le chemin commun du moteur.
      const used = await activity.use({ subsequentActions: false, [MODULE_ID]: { confirmed: true } }, { configure: false },
        { data: { speaker: ChatMessage.getSpeaker({ token }) } });
      if ( used?.message ) await activity.rollDamage({}, { configure: false }, { data: { system: { origin: used.message.id } } });
    }
  }
}

export function registerFelled() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`felled:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "felled enemy: blessing not played" });
}
