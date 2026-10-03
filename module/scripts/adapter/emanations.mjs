/**
 * M7 (SPEC §18.11) : les émanations qu'un acteur porte (contenu `emanation`, par identifiant), vues depuis Foundry — activité,
 * rayon (gabarit, sinon portée de l'activité), ce que dit le texte anglais d'origine — et l'immunité qu'une sauvegarde
 * réussie laisse sur la cible (un effet à durée, expiration native du cœur : `duration.units: "hours"`).
 */

import { MODULE_ID } from "../constants.mjs";
import { readEmanationText } from "../core/emanation.mjs";
import { contentOf } from "./content.mjs";
import { englishDescription } from "./multiattack.mjs";

const ACTING = ["save", "damage", "attack"];

/** L'activité qui agit : celle que le contenu nomme, sinon la première sauvegarde, puis dégâts, puis attaque. */
function actingActivity(item, rule) {
  const activities = item.system.activities;
  if ( rule.activity ) return activities?.get(rule.activity) ?? null;
  for ( const type of ACTING ) {
    const found = activities?.find(a => a.type === type);
    if ( found ) return found;
  }
  return null;
}

/** Rayon de l'émanation : le contenu, le gabarit de l'activité, sa portée. */
function radiusOf(activity, rule) {
  if ( rule.radius ) return { radius: rule.radius, units: rule.units };
  const template = activity.target?.template;
  const size = Number(template?.size);
  if ( template?.type && (size > 0) ) return { radius: size, units: template.units || "ft" };
  const range = Number(activity.range?.value);
  if ( range > 0 ) return { radius: range, units: activity.range.units || "ft" };
  return null;
}

/**
 * Les émanations d'un acteur.
 * @returns {Array<{item: Item5e, activity: Activity, key: string, on: string, affects: string, sees: boolean,
 *   radius: number, units: string, active: boolean, kin: boolean, immunity: {hours: number, all: boolean}|null}>}
 */
export function emanationsOf(actor) {
  const out = [];
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.emanation;
    if ( !rule?.on ) continue;
    const activity = actingActivity(item, rule);
    const reach = activity ? radiusOf(activity, rule) : null;
    if ( !reach ) {
      console.warn(`${MODULE_ID} | émanation « ${item.name} » de ${actor.name} ignorée : ${activity ? "rayon inconnu" : "aucune activité qui agit"}`);
      continue;
    }
    out.push({ item, activity, key: item.system.identifier || item.id, on: rule.on, affects: rule.affects ?? "any",
      sees: rule.sees === true, ...reach, ...readEmanationText(englishDescription(item)) });
  }
  return out;
}

/** Cet acteur porte-t-il une émanation de ce nom (« autre qu'un Ghast ») ? */
export function carriesEmanation(actor, key) {
  return emanationsOf(actor).some(e => e.key === key);
}

/** Immunisé contre cette émanation (celle de ce porteur, ou toutes celles de ce nom) ? */
export function isImmuneTo(actor, key, sourceUuid) {
  return (actor?.effects ?? []).some(e => {
    const flag = e.active ? e.getFlag(MODULE_ID, "emanationImmune") : null;
    return !!flag && (flag.key === key) && (flag.all || (flag.source === sourceUuid));
  });
}

/**
 * Sauvegarde réussie : « immunisé contre l'aura de ce … pendant 24 heures ». Un effet à durée sur la cible, qui dit contre
 * quoi ; le cœur le suspend quand le temps du monde a passé la durée. MJ actif.
 * @param {Actor5e} actor
 * @param {{item: Item5e, key: string, immunity: {hours: number, all: boolean}}} emanation
 * @param {TokenDocument} source
 */
export async function grantImmunity(actor, emanation, source) {
  if ( !actor || !emanation.immunity || isImmuneTo(actor, emanation.key, source.uuid) ) return;
  const { hours, all } = emanation.immunity;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.format(all ? "DND5ECOMBAT.Emanation.ImmuniteToutes" : "DND5ECOMBAT.Emanation.Immunite",
      { item: emanation.item.name, source: source.name }),
    img: emanation.item.img,
    origin: emanation.item.uuid,
    duration: { value: hours, units: "hours" },
    flags: { [MODULE_ID]: { emanationImmune: { key: emanation.key, source: all ? null : source.uuid, all } } }
  }]);
}
