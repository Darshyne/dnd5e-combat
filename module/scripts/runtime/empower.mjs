/**
 * §19.9 : Morsure vampirique (Dhampir, contenu `empower`). Quand la morsure inflige des dégâts perforants à une créature qui
 * n'est ni une Créature artificielle ni un Mort-vivant, et qu'il reste une utilisation à l'item, l'auteur choisit :
 *  - Drain : il regagne autant de PV que les dégâts perforants infligés ;
 *  - Renforcement : un bonus égal à ces dégâts à son prochain jet d'attaque ou test de caractéristique, dans la minute
 *    (l'effet de l'item, posé avec ce montant, retiré au premier jet qui en profite).
 * Même circuit que le drain des monstres (runtime/drain.mjs) : le montant se lit au calcul des dégâts (résistances comprises),
 * la question se pose une fois les PV écrits. La question passe par `askChoice` (le joueur, sinon le MJ) ; sans réponse, rien.
 */

import { MODULE_ID } from "../constants.mjs";
import { drainedAmount } from "../core/drain.mjs";
import { damageSourceItem } from "../adapter/drain.mjs";
import { askChoice } from "../adapter/choices.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { empowerOf, feedsOn, usesLeft, spendUse, boostsOf, boostData } from "../adapter/empower.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

/** Sur le client qui applique les dégâts : le montant de la morsure, gardé pour après l'écriture des PV. */
function onCalculateDamage(actor, damages, options) {
  const item = damageSourceItem(options);
  const rule = empowerOf(item);
  if ( !rule || !item.actor || (item.actor === actor) || !feedsOn(rule, actor) ) return;
  const n = drainedAmount(damages, rule.damageType);
  if ( n > 0 ) (options[MODULE_ID] ??= {}).empower = { n, item: item.uuid };
}

async function empower(victim, { n, item: itemUuid }) {
  const item = await fromUuid(itemUuid);
  const biter = item?.actor;
  const rule = empowerOf(item);
  if ( !biter || !rule || ((biter.system.attributes?.hp?.value ?? 0) <= 0) ) return;
  if ( !game.user.isGM && !biter.isOwner ) return;
  if ( usesLeft(item) <= 0 ) { log(`${item.name}: ${n} damage, no uses left to empower`); return; }
  const answer = await askChoice(biter, {
    actor: biter.uuid,
    item: item.name,
    prompt: loc("Morsure.Question", { n, name: victim.name, uses: usesLeft(item) }),
    options: [
      { id: "none", label: loc("Morsure.Rien") },
      { id: "heal", label: loc("Morsure.Drain", { n }) },
      { id: "boost", label: loc("Morsure.Renfort", { n }) }
    ]
  });
  if ( !["heal", "boost"].includes(answer?.id) ) { log(`${item.name}: ${biter.name} does not empower`); return; }
  const token = tokenOf(biter);
  if ( answer.id === "heal" ) {
    await spendUse(item);
    await biter.applyDamage([{ value: n, type: "healing" }]);
    if ( token ) notice(token, loc("Morsure.RetourDrain", { n }), "gain");
    log(`${item.name}: ${biter.name} drains ${victim.name} and regains ${n} HP`);
  }
  else {
    const data = boostData(item, rule, n);
    if ( !data ) { log(`${item.name}: empowerment effect ${rule.effect} not found`); return; }
    await spendUse(item);
    // Un seul renforcement à la fois : le nouveau remplace celui qui n'a pas encore servi.
    const old = boostsOf(biter).filter(e => e.getFlag(MODULE_ID, "boost")?.item === item.uuid).map(e => e.id);
    if ( old.length ) await biter.deleteEmbeddedDocuments("ActiveEffect", old);
    await biter.createEmbeddedDocuments("ActiveEffect", [data]);
    if ( token ) notice(token, loc("Morsure.RetourRenfort", { n }), "gain");
    log(`${item.name}: ${biter.name} is empowered (+${n} to the next attack roll or ability check)`);
  }
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor: biter }),
    content: `<p>${loc(answer.id === "heal" ? "Morsure.CarteDrain" : "Morsure.CarteRenfort", { item: item.name, name: biter.name, n, victim: victim.name })}</p>`,
    flags: { [MODULE_ID]: { empower: { item: item.uuid, mode: answer.id, amount: n, victim: victim.uuid } } }
  });
}

function onApplyDamage(actor, amount, options) {
  const e = options?.[MODULE_ID]?.empower;
  if ( !e ) return;
  // Sans attente : la résolution de l'attaque suit son cours pendant que l'auteur choisit.
  enqueue(`empower:${e.item}`, () => empower(actor, e));
}

/** Le renforcement sert au prochain jet d'attaque ou test de caractéristique : retiré sitôt ce jet lancé, sur ce client. */
const consuming = new Set();
async function consumeBoosts(actor, kind) {
  if ( !actor?.isOwner ) return;
  const ids = boostsOf(actor).filter(e => (e.getFlag(MODULE_ID, "consumeOn") ?? []).includes(kind) && !consuming.has(e.uuid)).map(e => e.id);
  if ( !ids.length ) return;
  ids.forEach(id => consuming.add(`${actor.uuid}.ActiveEffect.${id}`));
  try { await actor.deleteEmbeddedDocuments("ActiveEffect", ids); }
  finally { ids.forEach(id => consuming.delete(`${actor.uuid}.ActiveEffect.${id}`)); }
  log(`${actor.name}: empowerment consumed (${kind === "attack" ? "attack roll" : "ability check"})`);
}

export function registerEmpower() {
  route("dnd5e.calculateDamage", onCalculateDamage, { label: "bite: amount not read" });
  route("dnd5e.applyDamage", onApplyDamage, { label: "bite: empowerment not offered" });
  // dnd5e 6.0.3 : documents/activity/attack.mjs:212 (`subject` = l'activité) ; documents/actor/actor.mjs:1448 (compétence,
  // outil : `dnd5e.roll${name}`) et 1657 (test de caractéristique) — `subject` = l'acteur.
  route("dnd5e.rollAttack", (rolls, { subject }={}) => consumeBoosts(subject?.actor, "attack"), { label: "empowerment not consumed" });
  for ( const hook of ["dnd5e.rollAbilityCheck", "dnd5e.rollSkill", "dnd5e.rollToolCheck"] ) {
    route(hook, (rolls, { subject }={}) => consumeBoosts(subject, "check"), { label: "empowerment not consumed" });
  }
}
