/**
 * Le Guerrier (SPEC §21) : ce qui ne passe ni par le budget du tour (Fougue, Décalage tactique : runtime/turn.mjs) ni par les
 * marques (Attaques avisées : runtime/mastery.mjs).
 *
 *  - Héros du champ d'honneur : au début de son tour, en combat, le Champion reçoit l'Inspiration héroïque s'il ne l'a pas
 *    (`system.attributes.inspiration` de dnd5e). MJ actif.
 *  - Style Armes à deux mains : sur le client de l'auteur, au jet de dégâts d'une attaque de corps à corps avec une arme à deux
 *    mains (propriété Deux mains, ou Polyvalente maniée à deux mains) : chaque dé de la part de l'arme devient « min3 » (un 1 ou
 *    un 2 compte 3).
 *  - Style Armes de jet : +2 à la part de l'arme d'une attaque lancée qui touche.
 */

import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { log } from "./shared.mjs";

const hasRule = (actor, key) => Array.from(actor?.items ?? []).some(i => contentOf(i).entry?.[key]);
const ruleValue = (actor, key) => Array.from(actor?.items ?? []).map(i => contentOf(i).entry?.[key]).find(v => v !== undefined) ?? null;

function onTurnStart(combat, prior, current) {
  const actor = combat.combatants.get(current?.combatantId)?.actor;
  if ( !actor || !hasRule(actor, "heroicWarrior") || actor.system.attributes?.inspiration ) return;
  if ( (actor.system.attributes?.hp?.value ?? 0) <= 0 ) return;
  return enqueue(`heroic:${actor.uuid}`, async () => {
    await actor.update({ "system.attributes.inspiration": true });
    log(`${actor.name} : Inspiration héroïque (Héros du champ d'honneur)`);
  });
}

/** Une part d'arme : ses dés deviennent « min3 » (pas ceux qui ont déjà un modificateur de ce genre). */
const minThree = part => String(part).replace(/(\d*d\d+)(?![\dmrxk])/g, "$1min3");

function onPreRollDamage(config) {
  const activity = config.subject;
  const actor = activity?.actor;
  const weapon = activity?.item;
  if ( !actor || (activity.type !== "attack") || (weapon?.type !== "weapon") || !config.rolls?.length ) return true;
  const mode = config.attackMode ?? "";
  const base = config.rolls.find(r => r.base) ?? config.rolls[0];
  const props = weapon.system.properties;
  const melee = (activity.attack?.type?.value === "melee") && !mode.startsWith("thrown");
  if ( melee && hasRule(actor, "greatWeaponFighting") && (props?.has("two") || (props?.has("ver") && (mode === "twoHanded"))) ) {
    base.parts = (base.parts ?? []).map((p, i) => (i === 0 ? minThree(p) : p));
    log(`Armes à deux mains : ${base.parts[0]}`);
  }
  const thrown = ruleValue(actor, "thrownDamage");
  if ( thrown && mode.startsWith("thrown") && props?.has("thr") ) {
    base.parts = [...(base.parts ?? []), String(thrown)];
    log(`Armes de jet : +${thrown}`);
  }
  return true;
}

export function registerFighter() {
  route("combatTurnChange", onTurnStart, { executor: true, label: "Héros du champ d'honneur : inspiration non donnée" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "styles de combat du Guerrier" });
}
