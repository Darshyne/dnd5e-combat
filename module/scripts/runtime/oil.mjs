/**
 * §54 : l'Huile — la cible qui rate sa sauvegarde de Dextérité est huilée ; si elle prend des dégâts de feu dans la minute, avant
 * que l'huile sèche, l'huile s'enflamme et lui inflige 5 dégâts de feu de plus.
 * La marque « oiled » est posée à la sauvegarde ratée (étape d'issue `mark`, content/gear.mjs). Ici : les dégâts de feu.
 *
 * Les types de dégâts ne sont connus qu'au calcul (`dnd5e.calculateDamage`, actor.mjs:967, après résistances) — crochet aussi
 * appelé pour les aperçus du plateau de dégâts : on y RETIENT seulement. On agit à l'application réelle (`dnd5e.applyDamage`,
 * actor.mjs:841), sur le client qui applique (il a le droit d'écrire l'acteur) : la marque tombe d'abord (pas de boucle), puis
 * les 5 dégâts de feu.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

const OILED = "oiled";
const lastFire = new WeakMap();   // acteur → des dégâts de feu viennent d'être calculés pour lui

function onCalculate(actor, damages) {
  const fire = Array.from(damages ?? []).some(d => (d.type === "fire") && (Number(d.value) > 0));
  lastFire.set(actor, fire);
}

async function onApplied(actor, amount) {
  const fire = lastFire.get(actor);
  lastFire.delete(actor);
  if ( !fire || !(amount > 0) ) return;
  const marks = actor.effects.filter(e => e.getFlag(MODULE_ID, "mark") === OILED);
  if ( !marks.length || !actor.isOwner ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", marks.map(e => e.id));
  log(`${actor.name} : l'huile s'enflamme (5 dégâts de feu)`);
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc("Huile.Enflammee", { name: actor.name })}</p>`,
    flags: { [MODULE_ID]: { oilBurns: { actor: actor.uuid } } }
  });
  await actor.applyDamage([{ value: 5, type: "fire" }]);
}

export function registerOil() {
  route("dnd5e.calculateDamage", onCalculate, { label: "huile : dégâts de feu non relevés" });
  route("dnd5e.applyDamage", (actor, amount) => { onApplied(actor, amount).catch(err => console.error(`${MODULE_ID} | huile`, err)); },
    { label: "huile : non enflammée" });
}
