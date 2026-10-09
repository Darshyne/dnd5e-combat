/**
 * §93 : « juste après avoir fait un Test d20 et obtenu un 1 sur le d20 » (Dons sombres de Ravenloft : Anatomie aberrante, Âme en
 * écho, Ombre vivante, Être symbiotique, Guetteurs) — clé `onNatural1: { activity }`. Un jet d'attaque, une sauvegarde (de mort
 * comprise), un test de caractéristique, de compétence ou d'outil dont le d20 gardé fait 1 : sur le client qui l'a lancé, la créature
 * utilise l'activité de chacun de ses items qui le déclarent (sa sauvegarde, sur elle-même : « DD 13 + votre bonus de maîtrise »), la
 * résolution de sauvegarde habituelle pose l'état sur un échec. L'initiative n'est pas lue (son jet ne passe pas par ces hooks).
 * Un 1 à cette sauvegarde-là est lui aussi un Test d20 : il relance la chaîne, comme le texte le veut.
 */

import { MODULE_ID } from "../constants.mjs";
import { rolledNaturalOne } from "../core/natural-one.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

async function afterRoll(rolls, actor, what) {
  if ( !actor?.isOwner || !rolledNaturalOne(rolls) ) return;
  await naturalOneFor(actor, what);
}

/** Ce que les items de la créature font d'un 1 naturel (exporté pour les outils de test, `api.mcp.naturalOne`). */
export async function naturalOneFor(actor, what) {
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.onNatural1;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity ) continue;
    log(`${actor.name}: natural 1 (${what}) — ${item.name}`);
    await activity.use({ [MODULE_ID]: { confirmed: true }, consume: false }, { configure: false })
      .catch(err => console.error(`${MODULE_ID} | natural 1: ${item.name}`, err));
  }
}

export function registerNaturalOne() {
  // dnd5e 6.0 : documents/activity/attack.mjs (`subject` = l'activité) ; documents/actor/actor.mjs (`subject` = l'acteur) ; le jet
  // contre la mort : `dnd5e.rollDeathSave` (Hooks.call, la valeur rendue n'est pas lue ici).
  route("dnd5e.rollAttack", (rolls, { subject }={}) => afterRoll(rolls, subject?.actor, "attack"), { label: "natural 1: attack not read" });
  for ( const [hook, what] of [["dnd5e.rollSavingThrow", "saving throw"], ["dnd5e.rollAbilityCheck", "check"], ["dnd5e.rollSkill", "check"],
    ["dnd5e.rollToolCheck", "check"], ["dnd5e.rollDeathSave", "death saving throw"]] ) {
    route(hook, (rolls, { subject }={}) => afterRoll(rolls, subject, what), { label: `natural 1: ${what} not read` });
  }
}
