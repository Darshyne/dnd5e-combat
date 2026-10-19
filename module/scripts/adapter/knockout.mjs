/**
 * §210 : assommer une créature (règles 2024, glossaire « Knocking Out a Creature ») — « quand vous feriez tomber une créature à 0 PV avec
 * une attaque au corps à corps, vous pouvez la laisser à 1 PV à la place ; elle est Inconsciente […] jusqu'à ce qu'elle regagne des PV
 * ou qu'on lui donne les premiers soins (Sagesse (Médecine) DD 10) ». Le choix se fait d'avance, comme dans Baldur's Gate 3 : un
 * interrupteur « coups non létaux » par acteur (`flags.dnd5e-combat.nonLethal`, la Barre de DAS UI et le menu du token).
 */
import { MODULE_ID } from "../constants.mjs";

export const NON_LETHAL_FLAG = "nonLethal";
export const KNOCKED_OUT_FLAG = "knockedOut";
export const FIRST_AID_DC = 10;

/** Les coups de cet acteur sont-ils non létaux ? */
export const isNonLethal = actor => actor?.getFlag?.(MODULE_ID, NON_LETHAL_FLAG) === true;

/** La créature est-elle assommée (Inconsciente à 1 PV par un coup non létal) ? */
export const isKnockedOut = actor => !!actor?.getFlag?.(MODULE_ID, KNOCKED_OUT_FLAG);

/** Active ou coupe les coups non létaux de cet acteur. */
export async function setNonLethal(actor, on) {
  if ( !actor?.isOwner ) return false;
  await actor.setFlag(MODULE_ID, NON_LETHAL_FLAG, !!on);
  return !!on;
}

/**
 * Le coup de ce message de dégâts est-il une attaque au corps à corps non létale ? Rend son auteur (l'acteur), ou null. Une arme de mêlée
 * lancée ne compte pas (attaque à distance), une Attaque à mains nues si.
 */
export function nonLethalAttackerOf(options) {
  const message = options?.originatingMessage ?? options?.origin;
  const activity = message?.getAssociatedActivity?.() ?? null;
  const actor = activity?.actor ?? null;
  if ( !actor || !isNonLethal(actor) || (activity?.type !== "attack") ) return null;
  if ( activity.attack?.type?.value !== "melee" ) return null;
  const mode = String(message?.rolls?.[0]?.options?.attackMode ?? "");
  if ( mode.startsWith("thrown") || mode.startsWith("ranged") ) return null;
  return actor;
}

/**
 * `dnd5e.preApplyDamage` : des dégâts non létaux qui feraient tomber la créature à 0 PV la laissent à 1 PV. Rend le nom de l'auteur, ou
 * null. `through` : les dégâts qui passent les PV temporaires.
 */
export function knockOutAtZero(actor, through, updates, options) {
  const hp = actor?.system?.attributes?.hp;
  if ( !hp || !(hp.value > 0) || (through < hp.value) ) return null;
  const attacker = nonLethalAttackerOf(options);
  if ( !attacker ) return null;
  updates["system.attributes.hp.value"] = 1;
  return attacker.name;
}
