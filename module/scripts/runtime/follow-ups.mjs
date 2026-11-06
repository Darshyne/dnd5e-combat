/**
 * §373 : après un coup qui touche, des activités proposées gratuitement contre la cible (contenu `hitFollowUp`) — Cogneur : Agripper ou
 * Pousser de l'Attaque à mains nues en plus des dégâts ; Coup bas : les deux. Sur le MJ actif, une fois l'attaque résolue : la question
 * chez le joueur de l'auteur (`askChoice`), puis chaque activité choisie jouée contre la cible encore debout (`strikeAgainst` : la
 * sauvegarde et ses effets, comme une Frappe malicieuse), l'une après l'autre. À part de la fenêtre des faveurs (une seule par coup) :
 * une faveur (École des coups durs) et une prise se cumulent.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { strikeAgainst } from "../adapter/areas.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { weaponKind } from "../adapter/facts.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log, loc } from "./shared.mjs";

const seen = new Set();

/**
 * Ce que l'auteur peut enchaîner après un coup de cette activité : la réunion des activités de ses items `hitFollowUp` qui valent pour ce
 * genre d'arme, et le plus grand nombre à prendre. `{ activities, choose }`, ou null.
 */
export function followUpsFor(actor, activity) {
  const kind = weaponKind(activity);
  const activities = new Map();
  let choose = 0;
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.hitFollowUp;
    if ( !rule || (rule.weapons && !rule.weapons.includes(kind)) ) continue;
    let found = 0;
    for ( const { item: id, activity: activityId } of rule.use ) {
      const owner = actor.items.find(i => identifierOf(i).id === id);
      const own = owner?.system.activities?.get(activityId);
      if ( own ) { activities.set(own.uuid, own); found++; }
    }
    if ( found ) choose = Math.max(choose, rule.choose ?? 1);
  }
  return activities.size ? { activities: [...activities.values()], choose: Math.min(choose, activities.size) } : null;
}

/** Les réponses possibles : chaque activité seule, puis les combinaisons jusqu'à `choose`, des plus courtes aux plus longues. */
export function followUpCombos(list, choose) {
  const out = [];
  const walk = (start, picked) => {
    if ( picked.length ) out.push(picked);
    if ( picked.length === choose ) return;
    for ( let i = start; i < list.length; i++ ) walk(i + 1, [...picked, list[i]]);
  };
  walk(0, []);
  return out.sort((a, b) => a.length - b.length);
}

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack || seen.has(resolution.id) ) return;
  const targets = resolution.targets ?? [];
  if ( (targets.length !== 1) || (targets[0].hit !== true) ) return;
  seen.add(resolution.id);
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const actor = activity?.actor;
  const target = fromUuidSync(targets[0].token ?? "", { strict: false });
  const standing = () => (target?.actor?.system.attributes?.hp?.value ?? 0) > 0;
  if ( !actor || !standing() ) return;
  const offer = followUpsFor(actor, activity);
  const source = offer ? (actor.getActiveTokens(false, true)[0] ?? null) : null;
  if ( !source ) return;
  const choices = followUpCombos(offer.activities, offer.choose);
  const label = list => list.map(a => a.name || a.item.name).join(loc("Suite.Et"));
  const answer = await askChoice(actor, { actor: actor.uuid, item: activity.item?.name ?? "", prompt: loc("Suite.Question", { name: target.name }),
    // « Rien de plus » d'abord : c'est la réponse par défaut d'une fenêtre restée sans réponse (askChoice prend la première).
    options: [{ id: "none", label: loc("Suite.Aucune") }, ...choices.map((list, i) => ({ id: `c${i}`, label: label(list) }))] });
  const picked = String(answer?.id ?? "").startsWith("c") ? choices[Number(answer.id.slice(1))] : null;
  if ( !picked ) return;
  for ( const own of picked ) {
    if ( !standing() ) break;
    log(`${actor.name}: ${own.name || own.item.name} after the hit on ${target.name}`);
    await strikeAgainst(own, source, target, { flavor: "DND5ECOMBAT.Suite.Carte" });
  }
}

export function registerFollowUps() {
  route(`${MODULE_ID}.resolution`, resolution => enqueue(`follow-up:${resolution?.id}`, () => onResolution(resolution)),
    { executor: true, label: "hit follow-up not offered" });
}
