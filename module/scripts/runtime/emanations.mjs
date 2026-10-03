/**
 * M7 (SPEC §18.11) : les émanations des monstres agissent au fil des tours du combat. MJ actif.
 *  - fin du tour du porteur (`ownTurnEnd`, Aura de feu) : une carte, toutes les créatures atteintes ;
 *  - début du tour d'une créature (`turnStart`, Puanteur) : une carte par émanation qui l'atteint.
 * Une sauvegarde réussie laisse l'immunité que le texte promet (« pendant 24 heures »), lue à la résolution.
 */

import { MODULE_ID } from "../constants.mjs";
import { STEPS } from "../core/action.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { emanationTargets } from "../core/emanation.mjs";
import { convertLength } from "../core/units.mjs";
import { emanationAgainst } from "../adapter/areas.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { emanationsOf, carriesEmanation, isImmuneTo, grantImmunity } from "../adapter/emanations.mjs";
import { regenerationOf } from "../adapter/regeneration.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { canSee } from "../adapter/vision.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";

const defeated = actor => actor.statuses.has("dead") || actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED);

/** Hors jeu pour une émanation : sans acteur, caché, mort, ou objet piloté (Arme spirituelle). */
const outOfPlay = token => !token.actor || token.hidden || defeated(token.actor) || isObjectToken(token);

/** Qui l'émanation `emanation` de `source` atteint parmi `tokens`. `dying` : le porteur vient de mourir (`death`). */
function reached(source, emanation, tokens, { dying=false }={}) {
  let radius = emanation.radius;
  try { radius = convertLength(radius, emanation.units, source.parent.grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const statuses = source.actor.statuses;
  const inactive = !dying && (outOfPlay(source) || (emanation.active && INCAPACITATING.some(s => statuses.has(s))));
  const candidates = tokens.filter(t => t.parent === source.parent).map(t => {
    const out = (t === source) || outOfPlay(t);
    const distance = out ? Infinity : distanceBetween(source, t).value;
    const near = distance <= radius + 1e-6;
    return {
      token: t.uuid, disposition: t.disposition, distance, out,
      kin: near && emanation.kin && carriesEmanation(t.actor, emanation.key),
      immune: near && isImmuneTo(t.actor, emanation.key, source.uuid),
      lineOfEffect: near ? hasLineOfEffect(source, t) : null,
      sees: (near && emanation.sees) ? canSee(t, source) : null
    };
  });
  const wanted = new Set(emanationTargets({ token: source.uuid, disposition: source.disposition, radius, affects: emanation.affects, inactive },
    candidates));
  return tokens.filter(t => wanted.has(t.uuid));
}

/** Une même émanation n'agit qu'une fois par moment et par tour (un tour rejoué en arrière ne la relance pas). */
const done = new Set();
function once(key) {
  if ( done.has(key) ) return false;
  done.add(key);
  if ( done.size > 500 ) done.delete(done.values().next().value);
  return true;
}

async function onTurnChange(combat, prior, current) {
  const ended = combat.combatants.get(prior?.combatantId)?.token;
  const started = combat.combatants.get(current?.combatantId)?.token;
  if ( ended?.actor ) {
    const turn = `${combat.id}.${prior.round}.${prior.turn}`;
    for ( const emanation of emanationsOf(ended.actor).filter(e => e.on === "ownTurnEnd") ) {
      const targets = reached(ended, emanation, ended.parent.tokens.contents);
      if ( !targets.length || !once(`${turn}|${ended.uuid}|${emanation.key}|end`) ) continue;
      log(`émanation ${emanation.item.name} (${ended.name}), fin de son tour : ${targets.map(t => t.name).join(", ")}`);
      await emanationAgainst(emanation.activity, ended, targets, "ownTurnEnd");
    }
  }
  if ( started?.actor && !outOfPlay(started) ) {
    const turn = `${combat.id}.${current.round}.${current.turn}`;
    for ( const source of started.parent.tokens ) {
      if ( (source === started) || !source.actor ) continue;
      for ( const emanation of emanationsOf(source.actor).filter(e => e.on === "turnStart") ) {
        if ( !reached(source, emanation, [started]).length || !once(`${turn}|${source.uuid}|${emanation.key}|start`) ) continue;
        log(`émanation ${emanation.item.name} (${source.name}) : ${started.name} commence son tour dedans`);
        await emanationAgainst(emanation.activity, source, [started], "turnStart");
      }
    }
  }
}

/**
 * §18.14 : l'état Mort vient d'être posé (par le moteur, §17.1, ou par dnd5e) — une émanation `death` part d'elle-même, une
 * fois par mort. La Mort d'office de dnd5e sur une créature qui régénère ne compte pas (§18.13, elle est retirée).
 */
const exploded = new Set();
async function onCreateEffect(effect) {
  const actor = actorOfEffect(effect);   // un token non lié : l'effet est dans son ActorDelta
  if ( !actor || !effect.statuses?.has("dead") ) return;
  if ( effect.getFlag("dnd5e", "autoDowned") && regenerationOf(actor)?.survivesZero ) return;
  const source = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !source?.parent ) return;
  for ( const emanation of emanationsOf(actor).filter(e => e.on === "death") ) {
    const key = `${source.uuid}|${emanation.key}|${effect.id}`;
    if ( exploded.has(key) ) continue;
    exploded.add(key);
    const targets = reached(source, emanation, source.parent.tokens.contents, { dying: true });
    log(`émanation ${emanation.item.name} (${source.name}), à sa mort : ${targets.map(t => t.name).join(", ") || "personne"}`);
    if ( targets.length ) await emanationAgainst(emanation.activity, source, targets, "death");
  }
}

/**
 * §19.6 : à 0 PV, une créature qui change de forme (seconde phase) ne reçoit pas l'état Mort — ses émanations « à la mort »
 * partent quand même, avant la bascule (explosion à 0 PV d'un boss).
 */
export async function burstAtZero(actor) {
  const source = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !source?.parent ) return;
  // Une fois par chute : l'appelant (runtime/coven.mjs, `onZero`) ne passe qu'une fois par créature et par chute.
  for ( const emanation of emanationsOf(actor).filter(e => e.on === "death") ) {
    const targets = reached(source, emanation, source.parent.tokens.contents, { dying: true });
    log(`émanation ${emanation.item.name} (${source.name}), à 0 PV : ${targets.map(t => t.name).join(", ") || "personne"}`);
    if ( targets.length ) await emanationAgainst(emanation.activity, source, targets, "death");
  }
}

/** Résolution tranchée d'une émanation : chaque cible qui a réussi sa sauvegarde reçoit l'immunité promise. */
async function onResolution(resolution) {
  if ( resolution.step !== STEPS.DONE ) return;
  const tick = game.messages.get(resolution.carrier)?.getFlag(MODULE_ID, "areaTick");
  if ( tick?.event !== "emanation" ) return;
  const source = fromUuidSync(tick.source, { strict: false });
  const emanation = source?.actor ? emanationsOf(source.actor).find(e => e.key === tick.key) : null;
  if ( !emanation?.immunity ) return;
  for ( const t of resolution.targets ) {
    if ( t.save?.success !== true ) continue;
    const token = fromUuidSync(t.token, { strict: false });
    await grantImmunity(token?.actor, emanation, source);
    log(`émanation ${emanation.item.name} (${source.name}) : ${token?.name} immunisé ${emanation.immunity.hours} h`);
  }
}

export function registerEmanations() {
  route("combatTurnChange", onTurnChange, { executor: true, label: "émanation de monstre" });
  route("createActiveEffect", onCreateEffect, { executor: true, label: "émanation à la mort" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "émanation : immunité après sauvegarde" });
}
