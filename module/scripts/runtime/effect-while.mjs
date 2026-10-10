/**
 * §130 : les effets de don que le Manuel applique sans leur condition (Défense, Duel, Maître des armures lourdes et intermédiaires,
 * Brouillard de guerre du Rôdeur furtif). Clé `effectWhile: { <id d'effet de l'item>: { if, changes? } }` : sur le MJ actif, l'effet
 * de l'item du porteur est activé quand la condition tient, désactivé sinon (`disabled`, visible sur la fiche) — à chaque changement
 * d'équipement, de caractéristiques, au début et à la fin d'un combat, et au chargement. `changes` : les changements que l'effet doit
 * porter, écrits s'ils diffèrent (Maître des armures intermédiaires : sa clé de données est cassée). Aucun patch : dnd5e applique ou non
 * l'effet comme pour tout effet désactivé à la main.
 * Limite : Maître des armures lourdes réduit aussi les dégâts B/P/T qui ne viennent pas d'une attaque (règle : « touché par une attaque »).
 */

import { MODULE_ID } from "../constants.mjs";
import { effectHolds, sameChanges } from "../core/feats.mjs";
import { effectFacts } from "../adapter/effect-while.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

/** Les effets à tenir d'un acteur : `[{ item, effect, rule }]`. */
function watched(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rules = contentOf(item).entry?.effectWhile;
    if ( !rules ) continue;
    for ( const [id, rule] of Object.entries(rules) ) {
      const effect = item.effects.get(id);
      if ( effect ) out.push({ item, effect, rule });
    }
  }
  return out;
}

async function sync(actor) {
  const list = watched(actor);
  if ( !list.length ) return;
  const facts = effectFacts(actor);
  for ( const { item, effect, rule } of list ) {
    const update = {};
    const disabled = !effectHolds(rule.if ?? {}, facts);
    if ( effect.disabled !== disabled ) update.disabled = disabled;
    if ( rule.changes && !sameChanges(effect.system?.changes ?? effect.changes ?? [], rule.changes) ) update["system.changes"] = rule.changes;
    if ( !Object.keys(update).length ) continue;
    await item.updateEmbeddedDocuments("ActiveEffect", [{ _id: effect.id, ...update }], { [MODULE_ID]: { effectWhile: true } });
    log(`${actor.name}: "${effect.name}" (${item.name}) ${disabled ? "inactive" : "active"}${update["system.changes"] ? ", changes rewritten" : ""}`);
  }
}

const later = actor => (actor ? enqueue(`effectWhile:${actor.uuid}`, () => sync(actor)) : null);

/** Ce qui change les faits : l'équipement (armes, armure, bouclier), une caractéristique. Pas nos propres écritures. */
const RELEVANT = ["system.equipped", "system.type", "system.properties", "system.armor"];

export function registerEffectWhile() {
  const opts = { executor: true, label: "feat effect not synced" };
  route("ready", () => Promise.all([...game.actors, ...(canvas?.scene?.tokens ?? []).filter(t => !t.actorLink).map(t => t.actor)].map(later)), opts);
  route("updateItem", (item, changes, options) => {
    if ( options?.[MODULE_ID]?.effectWhile ) return;
    if ( item.parent?.documentName !== "Actor" ) return;
    if ( !RELEVANT.some(k => foundry.utils.hasProperty(changes, k)) ) return;
    return later(item.parent);
  }, opts);
  route("createItem", item => (item.parent?.documentName === "Actor" ? later(item.parent) : null), opts);
  route("deleteItem", item => (item.parent?.documentName === "Actor" ? later(item.parent) : null), opts);
  route("updateActor", (actor, changes) => (foundry.utils.hasProperty(changes, "system.abilities") ? later(actor) : null), opts);
  // Le combat commence quand son round passe à 1 : `combatStart` part AVANT cette écriture (le combat n'est pas encore `started`).
  route("updateCombat", (combat, changes) => (("round" in (changes ?? {})) ? Promise.all(combat.combatants.map(c => later(c.actor))) : null), opts);
  route("deleteCombat", combat => Promise.all(combat.combatants.map(c => later(c.actor))), opts);
  route("createCombatant", combatant => later(combatant.actor), opts);
  // §135 : un effet qui dépend de la lumière (Faveur de l'esprit nocturne) — recalculé quand le token bouge.
  route("updateToken", (token, changes) => ((["x", "y", "elevation"].some(k => k in (changes ?? {})) && watched(token.actor).some(w => w.rule.if?.light))
    ? later(token.actor) : null), opts);
}
