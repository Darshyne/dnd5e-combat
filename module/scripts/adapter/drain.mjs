/**
 * M8 (SPEC §18.16, §105) : le drain vu depuis Foundry — l'item (son texte anglais d'origine, ou le texte d'une fiche sans
 * original, dit le drain : « bite » et « slam » sont des identifiants partagés, et une fiche faite à la main n'a pas
 * d'identifiant), et l'EFFET qui le porte sur la cible.
 *
 * L'effet (§105, demande du 2026-10-07) : un effet actif par source et par grandeur, visible sur le token, dont le total
 * grossit à chaque drain — `hp.tempmax` ajouté au maximum par dnd5e (data/actor/templates/attributes.mjs:468), ou la valeur
 * de caractéristique. Il expire au repos par l'expiration native de dnd5e (`duration.expiry` « longRest »,
 * config.mjs:4750, retirés par `Actor5e#rest`, documents/actor/actor.mjs:2378). Avant le §105, le maximum baissait par le type
 * de dégâts `maximum` (actor.mjs:877, 940-950), invisible sur la fiche hors du champ « PV max temporaires ».
 */

import { MODULE_ID } from "../constants.mjs";
import { readDrain, drains, drainEffectShape } from "../core/drain.mjs";
import { englishDescription } from "./multiattack.mjs";

/** @returns {ReturnType<typeof readDrain>|null} */
export function drainOf(item) {
  if ( !item ) return null;
  const rule = readDrain(englishDescription(item));
  return drains(rule) ? rule : null;
}

/** L'item d'où viennent des dégâts : le message d'origine (`originatingMessage` des boutons de carte, `origin` du moteur). */
export function damageSourceItem(options) {
  return damageSourceMessage(options)?.getAssociatedActivity?.()?.item ?? damageSourceMessage(options)?.getAssociatedItem?.() ?? null;
}

/** Le message d'origine de dégâts. */
export function damageSourceMessage(options) {
  return options?.originatingMessage ?? options?.origin ?? null;
}

/** Le maximum de PV en vigueur : `hp.effectiveMax` = `max` + `tempmax` (attributes.mjs:468) — `hp.max` reste celui de base. */
export function effectiveMax(actor) {
  const hp = actor.system.attributes.hp;
  return hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
}

/**
 * Pose (ou grossit) l'effet de drain sur l'acteur. `kind` : "hp", ou la clé d'une caractéristique.
 * Les PV suivent le maximum : dnd5e les borne à l'affichage (attributes.mjs:469) mais garde la valeur écrite, qui
 * reviendrait à l'expiration de l'effet ; on écrit donc la valeur bornée.
 * @param {Actor5e} actor
 * @param {{kind: string, n: number, item: Item5e|{name: string, img?: string, uuid?: string}, name: (total: number) => string}} drain
 * @returns {Promise<number>}   Ce qui reste de la grandeur drainée (maximum de PV en vigueur, ou valeur de caractéristique).
 */
export async function applyDrainEffect(actor, { kind, n, item, name }) {
  if ( n > 0 ) {
    const source = item?.uuid ?? item?.name ?? "";
    const existing = actor.effects.find(e => (e.flags?.[MODULE_ID]?.drain?.kind === kind) && (e.flags[MODULE_ID].drain.source === source));
    const total = (existing?.flags[MODULE_ID].drain.total ?? 0) + n;
    const shape = drainEffectShape({ kind, total });
    const data = {
      name: name(total),
      img: item?.img ?? "icons/magic/unholy/hand-claw-glow-orange.webp",
      origin: item?.uuid ?? null,
      showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
      duration: { expiry: shape.expiry },
      system: { changes: [{ key: shape.key, type: "add", value: shape.change, phase: "initial" }] },
      flags: { [MODULE_ID]: { drain: { kind, source, total } } }
    };
    if ( existing ) await existing.update(data);
    else await ActiveEffect.implementation.create(data, { parent: actor });
  }
  if ( kind !== "hp" ) return actor.system.abilities?.[kind]?.value ?? 0;
  const max = effectiveMax(actor);
  const value = actor._source.system?.attributes?.hp?.value ?? actor.system.attributes.hp.value;
  if ( value > max ) await actor.update({ "system.attributes.hp.value": Math.max(0, max) });
  return max;
}
