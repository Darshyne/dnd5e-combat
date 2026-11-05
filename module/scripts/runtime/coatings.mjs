/**
 * §345 : un enchantement qu'un coup qui touche consomme (`onHit: { whileEnchanted, spends: true }`) — la Dague venimeuse : « le poison
 * reste 1 minute ou jusqu'à ce qu'une attaque avec cette arme touche une créature ». Sur le MJ actif, au hook de sortie du moteur
 * `dnd5e-combat.resolution` (runtime/engine.mjs), une fois l'attaque tranchée et touchée.
 *
 * O9h (§363) : un enduit posé par un consommable (`coats` : Poison standard) — sur le client de l'utilisateur :
 *  - après l'activité qui enduit (`dnd5e.postUseActivity`), l'arme (ou les munitions) choisie reçoit la marque
 *    `flags.dnd5e-combat.coating` : les dés de l'activité `damage`, les types qui le délivrent, l'heure du monde où il sèche, les
 *    charges (1 pour une arme, `ammunition` pour des munitions) ; choix imposé par `{ "dnd5e-combat": { coatItem } }`, sinon la seule
 *    arme possible, sinon la question ;
 *  - au jet de dégâts (`dnd5e.preRollDamageV2`, après un coup) d'une arme, ou avec une munition, enduite et encore fraîche, dont le jet
 *    porte l'un de ces types : les dés s'ajoutent au jet, une charge part. Sec, l'enduit est retiré.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { coatingCandidates, coatingApplies } from "../core/coating.mjs";
import { contentOf, identifierOf } from "../adapter/content.mjs";
import { enchantedBy } from "../adapter/usage.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { tokenOnViewedScene } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

async function onResolution(resolution) {
  if ( (resolution?.step !== STEPS.DONE) || !resolution.plan?.attack ) return;
  if ( !(resolution.targets ?? []).some(t => t.hit === true) ) return;
  const activity = fromUuidSync(resolution.activity ?? "", { strict: false });
  const rule = activity?.item ? contentOf(activity.item).entry?.onHit : null;
  if ( !rule?.spends || !rule.whileEnchanted ) return;
  const spent = enchantedBy(activity.item, rule.whileEnchanted);
  if ( !spent.length ) return;
  await activity.item.deleteEmbeddedDocuments("ActiveEffect", spent.map(e => e.id));
  log(`${activity.item.name}: the hit spends ${spent.map(e => e.name).join(", ")}`);
}

/* -------------------------------------------- */
/*  O9h : enduits (Poison standard)             */
/* -------------------------------------------- */

/** Ce que l'acteur peut enduire selon la règle (armes, munitions). */
function candidatesFor(actor, rule) {
  return coatingCandidates(Array.from(actor?.items ?? []).map(i => ({
    id: i.id, name: i.name, type: i.type, kind: i.system?.type?.value ?? null,
    damageTypes: [...Array.from(i.system?.damage?.base?.types ?? []),
      ...Array.from(i.system?.activities ?? []).flatMap(a => (a.damage?.parts ?? []).flatMap(p => Array.from(p.types ?? [])))],
    equipped: i.system?.equipped === true, quantity: i.system?.quantity ?? 1
  })), rule);
}

/** Les dés et le type de l'activité de dégâts de l'enduit, ou null. */
function diceOf(item, activityId) {
  const part = item.system?.activities?.get?.(activityId)?.damage?.parts?.[0];
  const formula = part?.formula || ((part?.number && part?.denomination) ? `${part.number}d${part.denomination}${part.bonus ? ` + ${part.bonus}` : ""}` : null);
  const damageType = Array.from(part?.types ?? [])[0] ?? null;
  return (formula && damageType) ? { formula, damageType } : null;
}

async function onCoatUsed(activity, usageConfig) {
  const item = activity?.item;
  const rule = item ? contentOf(item).entry?.coats : null;
  if ( !rule || (activity.id !== rule.activity) || !activity.actor?.isOwner ) return;
  const actor = activity.actor;
  const dice = diceOf(item, rule.damage);
  if ( !dice ) { log(`${item.name}: coating without damage dice`); return; }
  const options = candidatesFor(actor, rule);
  let chosen = options.find(o => o.id === usageConfig?.[MODULE_ID]?.coatItem) ?? ((options.length === 1) ? options[0] : null);
  if ( !chosen && options.length ) {
    const answer = await askChoice(actor, { actor: actor.uuid, item: item.name, prompt: loc("Enduit.Choix"),
      options: options.map(o => ({ id: o.id, label: o.name, icon: o.ammunition ? "fa-solid fa-bow-arrow" : "fa-solid fa-sword" })) });
    chosen = options.find(o => o.id === answer?.id) ?? null;
  }
  if ( !chosen ) { ui.notifications.warn(loc("Enduit.Aucun", { item: item.name })); return; }
  const target = actor.items.get(chosen.id);
  await target.setFlag(MODULE_ID, "coating", { name: item.name, identifier: identifierOf(item).id, ...dice, deliveredBy: [...rule.damageTypes],
    until: game.time.worldTime + rule.seconds, charges: chosen.ammunition ? (rule.ammunition ?? 1) : 1 });
  log(`${item.name}: ${target.name} coated (${dice.formula} ${dice.damageType}, ${rule.seconds} s)`);
  const token = tokenOnViewedScene(actor);
  if ( token ) notice(token, loc("Enduit.Pose", { item: item.name, weapon: target.name }), "gain", { all: true });
}

/** L'item enduit de ce jet (la munition d'abord, puis l'arme) et son enduit, ou null. */
function coatedOf(activity, config) {
  const ref = config?.ammunition ?? config?.rolls?.[0]?.options?.ammunition ?? null;
  const ammo = (typeof ref === "string") ? activity.actor?.items?.get(ref) : ref;
  for ( const holder of [ammo, activity.item].filter(Boolean) ) {
    const coating = holder.getFlag?.(MODULE_ID, "coating");
    if ( coating ) return { holder, coating };
  }
  return null;
}

function onPreRollDamage(config) {
  const activity = config?.subject;
  if ( (activity?.type !== "attack") || !config.rolls?.length || !activity.actor?.isOwner ) return true;
  const found = coatedOf(activity, config);
  if ( !found ) return true;
  const { holder, coating } = found;
  const types = config.rolls.flatMap(r => [r.options?.type, ...(r.options?.types ?? [])]).filter(Boolean);
  const verdict = coatingApplies(coating, { now: game.time.worldTime, types });
  if ( verdict === "dry" ) {
    holder.unsetFlag(MODULE_ID, "coating").then(() => log(`${holder.name}: the coating has dried`));
    return true;
  }
  if ( verdict !== "applies" ) return true;
  config.rolls.push({ data: activity.getRollData(), parts: [coating.formula], options: { type: coating.damageType, types: [coating.damageType], properties: [] } });
  log(`bonus damage: ${coating.name} +${coating.formula} ${coating.damageType} (${holder.name})`);
  const left = (coating.charges ?? 1) - 1;
  (left > 0 ? holder.setFlag(MODULE_ID, "coating.charges", left) : holder.unsetFlag(MODULE_ID, "coating"))
    .catch(err => console.warn(`${MODULE_ID} | ${holder.name}: coating not spent`, err));
  return true;
}

export function registerCoatings() {
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "coatings: enchantment spent by a hit" });
  route("dnd5e.postUseActivity", (activity, usageConfig) => { onCoatUsed(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | coating`, err)); },
    { label: "coating: weapon not coated" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "coating: poison damage not added" });
}
