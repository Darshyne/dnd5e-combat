/**
 * §356 : les armes maudites qui s'emparent de leur porteur quand on le blesse (contenu `wrath: { kind, save }`), MJ actif :
 *  - à `dnd5e.damageActor`, quand une autre créature vient de blesser le porteur d'une telle arme harmonisée (l'auteur noté des
 *    dégâts, runtime/triggers.mjs `recordDamager`) — et en combat pour la vengeance —, la sauvegarde est lancée ; ratée, une marque est
 *    posée sur le porteur (« Folie furieuse » / « Vengeance », contre l'auteur des dégâts), vue de toute la table ;
 *  - au début du tour du porteur, la marque tombe si la colère prend fin (`wrathEnds`).
 * Ce que la marque impose (attaquer la créature la plus proche, ou celle qui l'a blessé) reste au joueur et au MJ.
 */

import { MODULE_ID } from "../constants.mjs";
import { wrathSaveDue, wrathEnds } from "../core/defenses.mjs";
import { contentOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { lengthIn } from "../adapter/units.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { requestSave } from "./neighbours.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc, notice } from "./shared.mjs";

const FRESH_MS = 10000;
const markOf = actor => (actor?.effects ?? []).find(e => e.getFlag(MODULE_ID, "wrath")) ?? null;

/** L'arme maudite harmonisée de l'acteur et sa règle, ou null. */
function wrathOf(actor) {
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.wrath;
    if ( rule && ((item.system?.attunement !== "required") || item.system?.attuned) ) return { item, rule };
  }
  return null;
}

async function onDamaged(actor, changes) {
  if ( !(changes?.total < 0) || !actor ) return;
  const found = wrathOf(actor);
  if ( !found ) return;
  const noted = actor.getFlag(MODULE_ID, "damagedBy");
  const fresh = !!noted?.uuid && ((Date.now() - (noted.at ?? 0)) <= FRESH_MS);
  const damager = fresh ? fromUuidSync(noted.uuid, { strict: false }) : null;
  const token = tokenOf(actor);
  const inCombat = !!game.combat?.started && !!game.combat.combatants.find(c => c.actor === actor);
  if ( !wrathSaveDue({ kind: found.rule.kind, byOther: !!damager && (damager !== actor), inCombat, marked: !!markOf(actor) }) ) return;
  const saved = await requestSave(actor, { ability: found.rule.save.ability, dc: found.rule.save.dc, flavor: found.item.name });
  log(`${found.item.name}: ${actor.name} ${found.rule.save.ability} saving throw ${saved?.total ?? "?"} vs DC ${found.rule.save.dc}: ${saved?.success ? "succeeded" : "failed"}`);
  if ( saved?.success !== false ) return;
  const label = loc(found.rule.kind === "berserk" ? "Colere.Berserk" : "Colere.Vengeance", { name: damager.name });
  await actor.createEmbeddedDocuments("ActiveEffect", [{ name: label, img: found.item.img, origin: found.item.uuid,
    flags: { [MODULE_ID]: { wrath: { kind: found.rule.kind, against: damager.uuid, item: found.item.uuid } } } }]);
  log(`${found.item.name}: ${actor.name} — ${label}`);
  const shown = token?.document ?? token;
  if ( shown ) notice(shown, label, "refused", { all: true, action: "wrath" });
}

/** Au début du tour du porteur : la colère prend-elle fin ? */
async function onTurn(combat, prior, current) {
  const actor = combat.combatants.get(current?.combatantId)?.actor;
  const mark = markOf(actor);
  if ( !mark ) return;
  const rule = mark.getFlag(MODULE_ID, "wrath");
  const foe = fromUuidSync(rule.against ?? "", { strict: false });
  const down = a => !a || ((a.system?.attributes?.hp?.value ?? 0) <= 0);
  const token = tokenOf(actor);
  const doc = token?.document ?? token;
  const limit = doc ? lengthIn(60, "ft", doc.parent.grid.units) : 0;
  const othersNear = !!doc && doc.parent.tokens.some(t => (t !== doc) && t.actor && !t.hidden && !isObjectToken(t) && !down(t.actor)
    && (distanceBetween(doc, t).value <= limit + 1e-6));
  if ( !wrathEnds({ kind: rule.kind, othersNear, foeDown: down(foe), bearerDown: down(actor) }) ) return;
  await mark.delete();
  log(`${actor.name}: ${mark.name} ends`);
}

export function registerWrath() {
  route("dnd5e.damageActor", (actor, changes) => enqueue(`wrath:${actor?.uuid}`, () => onDamaged(actor, changes)),
    { executor: true, label: "cursed weapon: wrath save not rolled" });
  route("combatTurnChange", (combat, prior, current) => enqueue("wrath:turn", () => onTurn(combat, prior, current)),
    { executor: true, label: "cursed weapon: wrath not ended" });
}
