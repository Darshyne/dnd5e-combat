/**
 * Zones d'effet qui durent : ce qu'un sort déclare, ce qu'une région retient, et comment rejouer
 * l'activité contre une créature sans relancer le sort.
 *
 * Rien dans un item dnd5e ne dit « sauvegarde quand on entre ou qu'on finit son tour dedans » :
 * c'est dans le texte. D'où une déclaration au registre (content/triggers.mjs, ou
 * `flags["dnd5e-combat"].triggers` sur l'item) : `{ on: ["enter", "turnEnd"], do: [{ type: "replay" }] }`.
 *
 * Vérifié dans dnd5e 6.0.3 : l'activité de Rayon de lune porte `duration.units: "inst"` avec
 * `override: false` (packs/_source/spells24/2nd-level/moonbeam.yml) ; une fois préparée elle
 * hérite donc de la durée de l'item (1 minute). C'est la durée préparée qui dit si une zone dure.
 */

import { MODULE_ID } from "../constants.mjs";
import { contentOf } from "./content.mjs";
import { convertLength } from "../core/units.mjs";
import { readUnitFactors } from "./units.mjs";
import { translateShapes, shapeCenter, expiryTime } from "../core/area.mjs";
import { stepsOf } from "../core/triggers.mjs";
import { committedPosition } from "./turn.mjs";
import { declarationsOfItem } from "./triggers.mjs";

/**
 * Ce qu'une activité déclare pour sa zone (moments où elle rejoue son activité, core/area.mjs), ou
 * null si elle n'agit qu'à la pose : les déclarations de l'item à étape `replay` (registre).
 * `activity` : l'id d'une activité SŒUR à rejouer à la place de celle qui a posé la zone (Nuage
 * nauséabond : « Créer un nuage » pose, « Sauvegarde de début de tour » rejoue), ou null.
 */
export function areaRulesOf(activity) {
  if ( !activity?.item ) return null;
  const on = new Set();
  let sibling = null;
  for ( const d of declarationsOfItem(activity.item) ) {
    const replays = stepsOf(d, "replay");
    if ( !replays.length ) continue;
    d.on.forEach(m => on.add(m));
    for ( const step of replays ) if ( step.activity && activity.item.system.activities?.get(step.activity) ) sibling = step.activity;
  }
  return on.size ? { on: Array.from(on), activity: sibling } : null;
}

/** La zone d'une activité instantanée n'a plus de raison d'être une fois la résolution close. */
export function isInstantaneous(activity) {
  return (activity?.duration?.units ?? "inst") === "inst";
}

export function readAreaState(region) {
  return region.getFlag(MODULE_ID, "area") ?? null;
}

export async function writeAreaState(region, state) {
  await region.setFlag(MODULE_ID, "area", state);
}

/**
 * La zone qui dure qu'a posée cet item de ce lanceur sur la scène affichée, ou null (§16.14). Une région posée par une
 * activité de dnd5e 6 porte `flags.dnd5e.item` = l'uuid de l'item.
 */
export function activeZoneOf(item) {
  if ( !item || !canvas?.scene ) return null;
  return canvas.scene.regions.find(r => (r.getFlag("dnd5e", "item") === item.uuid) && readAreaState(r)?.usage) ?? null;
}

/** Le centre d'une zone, en pixels (sa première forme). */
export function zoneCenter(region) {
  return shapeCenter(region?.shapes?.[0]?.toObject?.() ?? region?._source?.shapes?.[0] ?? null);
}

/** Déplace une zone pour que son centre vienne sur ce point. MJ actif uniquement (un joueur ne peut pas modifier une région). */
export async function moveZoneTo(region, point) {
  const center = zoneCenter(region);
  if ( !center ) return false;
  const shapes = region.toObject().shapes;
  await region.update({ shapes: translateShapes(shapes, point.x - center.x, point.y - center.y) });
  return true;
}

/** Les régions de la scène tenues par le moteur comme zones qui durent. */
export function lastingRegions(scene) {
  return scene?.regions.filter(r => readAreaState(r)?.usage) ?? [];
}

/** Ce token est-il dans la région, à sa position actuelle ou à une position donnée ? */
export function isInside(token, region, position) {
  // Sans position donnée : la position validée, pas la position visuelle (voir committedPosition).
  return token.testInsideRegion(region, position ?? committedPosition(token));
}

/** Descripteur de cible tel que le système le stocke sur un message (targets-field.mjs:32-47). */
export function describeTarget(token) {
  const actor = token.actor;
  return {
    actor: actor.uuid, token: token.uuid, name: token.name, img: token.texture?.src,
    ac: actor.statuses.has("coverTotal") ? null : actor.system.attributes?.ac?.value ?? null
  };
}

/**
 * Rejoue l'activité d'une zone contre un token : une copie du message d'utilisation d'origine,
 * avec cette seule cible. Tout le reste suit — même niveau de sort, même DD, même concentration —
 * et la résolution de sauvegarde habituelle s'applique telle quelle. Aucune ressource n'est
 * dépensée : on ne repasse pas par `activity.use()`. MJ actif uniquement.
 * `activity` : l'id d'une activité sœur à rejouer à la place (areaRulesOf) — le message garde le
 * niveau de sort et la concentration de la pose, seule l'activité change (`system.activity`, c'est
 * ce que lit `getAssociatedActivity`, documents/chat-message.mjs:690-691).
 * @param {ChatMessage} usageMessage  Message d'utilisation qui a posé la zone.
 * @param {TokenDocument} token
 * @param {{region: string, event: string}} tick
 * @param {{activity?: string|null}} [options]
 */
export async function replayAgainst(usageMessage, token, tick, { activity: siblingId=null }={}) {
  const activity = usageMessage.getAssociatedActivity?.();
  const sibling = siblingId ? activity?.item?.system.activities?.get(siblingId) : null;
  const system = { ...usageMessage.system.toObject(), targets: [describeTarget(token)] };
  if ( sibling ) system.activity = { ...(system.activity ?? {}), ...sibling.messageSources.activity };
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: usageMessage.speaker,
    flavor: game.i18n.format(`DND5ECOMBAT.Zone.${tick.event}`, { name: token.name, item: activity?.item?.name ?? "" }),
    system,
    flags: {
      dnd5e: foundry.utils.deepClone(usageMessage.flags?.dnd5e ?? {}),
      [MODULE_ID]: { areaTick: { ...tick, token: token.uuid } }
    }
  });
}

/**
 * Éclat (§16.19, `burst`) : l'activité sœur de l'item joue sur plusieurs créatures à la fois — une copie du message
 * d'utilisation de l'attaque (même niveau de sort), activité remplacée par la sœur, ces cibles-là, marquée `areaTick`
 * (rien de dépensé, pas de zone à attendre). MJ actif uniquement.
 * @param {ChatMessage} usageMessage   Message d'utilisation de l'attaque.
 * @param {TokenDocument[]} tokens
 * @param {Activity} sibling
 * @param {TokenDocument} center       La cible de l'attaque.
 */
export async function burstAround(usageMessage, tokens, sibling, center) {
  const system = { ...usageMessage.system.toObject(), targets: tokens.map(describeTarget) };
  system.activity = { ...(system.activity ?? {}), ...sibling.messageSources.activity };
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: usageMessage.speaker,
    flavor: game.i18n.format(tokens.length > 1 ? "DND5ECOMBAT.Eclat" : "DND5ECOMBAT.EclatCible", { item: sibling.item.name, name: center.name }),
    system,
    flags: {
      dnd5e: foundry.utils.deepClone(usageMessage.flags?.dnd5e ?? {}),
      [MODULE_ID]: { areaTick: { event: "burst", origin: usageMessage.id, token: center.uuid } }
    }
  });
}

/**
 * Sauvegarde répétée (SPEC §16, brique « resave ») : la créature qui porte un effet rejoue la
 * sauvegarde de l'activité qui l'a posé — un message d'utilisation neuf, même forme que celui du
 * système (`getCardData`, activity/mixin.mjs:769-778), cette seule cible, et le drapeau `resave` :
 * l'adaptateur d'utilisation n'en tire qu'une sauvegarde, sans dégâts ni effets ; réussie, le moteur
 * retire l'effet (runtime/engine.mjs). Le DD est celui de l'activité aujourd'hui (DD de sort du lanceur).
 * MJ actif uniquement.
 * @param {ActiveEffect} effect      L'effet porté par la créature.
 * @param {Activity} activity        L'activité de sauvegarde qui l'a posé.
 * @param {TokenDocument} token      La créature.
 * @param {string} moment            "startOfTurn" | "endOfTurn" | "isDamaged"
 */
export async function resaveAgainst(effect, activity, token, moment, { onFail=null, keep=false, dodge=false, tally=null }={}) {
  const caster = activity.item?.actor ?? null;
  const card = await activity.item.system.getCardData({ activity });
  // §43.1 : le compteur d'avant ce jet, dit sur la carte.
  const count = effect.getFlag?.(MODULE_ID, "tally") ?? {};
  const counted = tally ? ` — ${game.i18n.format("DND5ECOMBAT.Resave.tally", { successes: count.successes ?? 0, successesMax: tally.successes, failures: count.failures ?? 0, failuresMax: tally.failures })}` : "";
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ actor: caster }),
    flavor: game.i18n.format(`DND5ECOMBAT.Resave.${moment}`, { name: token.name, item: activity.item.name }) + counted,
    system: { ...card, targets: [describeTarget(token)] },
    flags: {
      core: { canPopout: true },
      // §19.6 : `onFail` — des dégâts du porteur qui ne valent que si la sauvegarde est ratée (saignement d'Épine).
      // §37 : `keep` — réussie, l'effet reste ; `dodge` — ratée, la créature prend l'action Esquiver (Malédiction).
      [MODULE_ID]: { resave: { effect: effect.uuid, token: token.uuid, moment, ...(onFail ? { onFail } : {}), ...(keep ? { keep } : {}), ...(dodge ? { dodge } : {}), ...(tally ? { tally } : {}) } }
    }
  });
}

/**
 * Un objet invoqué qui agit sur une créature proche (§16.15, `summon.pulse` : les flammes de la Sphère de feu sur qui
 * finit son tour à 1,50 m) : un message d'utilisation neuf de l'activité de l'objet, cette seule cible, marqué
 * `areaTick` — rien n'est dépensé, la résolution de sauvegarde habituelle s'applique. Les dégâts sont ceux que dnd5e a
 * donnés à l'objet en l'invoquant (`bonuses.saveDamage` du sort, activity/summon.mjs). MJ actif uniquement.
 * @param {Activity} activity       Activité de l'objet invoqué.
 * @param {TokenDocument} source    L'objet.
 * @param {TokenDocument} token     La créature.
 */
export async function pulseAgainst(activity, source, token, moment="turnEnd") {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format({ enter: "DND5ECOMBAT.Pilote.PulseEnter", moves: "DND5ECOMBAT.Pilote.PulseMoves" }[moment] ?? "DND5ECOMBAT.Pilote.Pulse",
      { item: activity.item.name, name: token.name, source: source.name }),
    system: { ...card, targets: [describeTarget(token)] },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "pulse", source: source.uuid, token: token.uuid } } }
  });
}

/**
 * Frappe rusée (§20) : la sauvegarde de l'item de Frappes rusées joue sur la créature que l'Attaque sournoise vient de toucher.
 * Même forme que `pulseAgainst` : message d'utilisation neuf, cette seule cible, marqué `areaTick` (`event: "cunningStrike"`) —
 * rien n'est dépensé, la résolution de sauvegarde habituelle pose l'effet sur un échec. MJ actif uniquement.
 * @param {Activity} activity       Sauvegarde de l'item (Poison, Croc-en-jambe…).
 * @param {TokenDocument} source    Le roublard.
 * @param {TokenDocument} token     La créature touchée.
 */
export async function strikeAgainst(activity, source, token, { flavor="DND5ECOMBAT.Sournoise.Carte" }={}) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(flavor, { strike: activity.name || activity.item.name, name: token.name }),
    system: { ...card, targets: [describeTarget(token)] },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event: "cunningStrike", source: source.uuid, token: token.uuid } } }
  });
}

/**
 * Éclair (§16.21, `bolt`) : la zone que dnd5e fait poser est celle de l'ITEM (Appel de la foudre : le nuage, un cylindre de
 * 60 ft) ; la règle frappe « chaque créature à 1,50 m » du point choisi. La région est ramenée à un cercle de ce rayon
 * autour de son centre, avant qu'on lise qui est dedans. Rend true si elle a été ramenée.
 * @param {RegionDocument} region
 */
export async function shrinkToBolt(region) {
  const activity = await fromUuid(region.getFlag("dnd5e", "activity") ?? "");
  const rule = activity?.item ? contentOf(activity.item).entry?.bolt : null;
  const center = rule ? shapeCenter(region.shapes?.[0]?.toObject?.() ?? region._source.shapes?.[0]) : null;
  if ( !center ) return false;
  const grid = region.parent.grid;
  let radius = rule.radius;
  try { radius = convertLength(radius, rule.units, grid.units, readUnitFactors()); } catch { /* unité de la grille */ }
  const px = (radius / grid.distance) * grid.size;
  // Le cœur V14 cale un cercle sur la grille comme à la pose (gridBased) : un vrai cercle suffit ici.
  await region.update({ shapes: [{ type: "circle", x: center.x, y: center.y, radius: px + (grid.size / 2) }] });
  return true;
}

/** Minutes par unité de durée, lues dans la configuration du système (CONFIG.DND5E.timeUnits.<unité>.conversion). */
export function readTimeFactors() {
  const factors = {};
  for ( const [unit, config] of Object.entries(CONFIG.DND5E.timeUnits ?? {}) ) {
    if ( Number.isFinite(config?.conversion) ) factors[unit] = config.conversion;
  }
  return factors;
}

/**
 * §16.37 : une zone posée par un sort qui dure **sans concentration** (Lumière du jour, 1 heure) reçoit son heure de fin
 * (`flags["dnd5e-combat"].expiresAt`, heure du monde en secondes). Une zone à concentration tombe avec elle
 * (runtime/concentration.mjs) ; une zone instantanée, avec sa résolution. Rend l'heure notée, ou null.
 */
export async function noteExpiry(region, now=game.time.worldTime) {
  const activity = fromUuidSync(region.getFlag("dnd5e", "activity") ?? "", { strict: false });
  const item = activity?.item;
  if ( !item || isInstantaneous(activity) ) return null;
  if ( activity.duration?.concentration || item.requiresConcentration || item.system?.properties?.has?.("concentration") ) return null;
  const at = expiryTime(now, activity.duration ?? {}, readTimeFactors());
  if ( at === null ) return null;
  await region.setFlag(MODULE_ID, "expiresAt", at);
  return at;
}

/** Les zones dont l'heure de fin est passée, sur toutes les scènes. */
export function expiredRegions(now=game.time.worldTime) {
  const out = [];
  for ( const scene of game.scenes ) {
    for ( const region of scene.regions ) {
      const at = region.getFlag(MODULE_ID, "expiresAt");
      if ( Number.isFinite(at) && (at <= now) ) out.push(region);
    }
  }
  return out;
}

/** Marque une région comme passagère : elle disparaîtra avec la résolution du message donné. */
export async function markTransient(region, usageMessageId) {
  await region.setFlag(MODULE_ID, "transient", usageMessageId);
}

/** Retire les régions passagères d'un message d'utilisation dont la résolution est close. */
export async function removeTransientRegions(usageMessageId) {
  let removed = 0;
  for ( const scene of game.scenes ) {
    const ids = scene.regions.filter(r => r.getFlag(MODULE_ID, "transient") === usageMessageId).map(r => r.id);
    if ( !ids.length ) continue;
    await scene.deleteEmbeddedDocuments("Region", ids);
    removed += ids.length;
  }
  return removed;
}

/**
 * M7 (§18.11) : l'émanation d'un monstre agit — son activité joue sur ces créatures (Aura de feu à la fin de son tour : toutes
 * celles qui sont dedans, une carte ; Puanteur au début du tour d'une créature : elle seule). Même forme que `pulseAgainst` :
 * un message d'utilisation neuf, marqué `areaTick` (rien de dépensé, le moteur lance les dés). MJ actif uniquement.
 * @param {Activity} activity
 * @param {TokenDocument} source      Le porteur de l'émanation.
 * @param {TokenDocument[]} tokens
 * @param {"ownTurnEnd"|"turnStart"} moment
 */
export async function emanationAgainst(activity, source, tokens, moment) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(`DND5ECOMBAT.Emanation.${moment}`, { item: activity.item.name, source: source.name, name: tokens[0]?.name ?? "" }),
    system: { ...card, targets: tokens.map(describeTarget) },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: {
      event: "emanation", moment, source: source.uuid, key: activity.item.system.identifier ?? activity.item.id, token: tokens[0]?.uuid ?? null
    } } }
  });
}

/**
 * M8 (§18.17) : les dégâts qu'un avalé subit à chaque tour — l'activité de dégâts de l'item d'avalement, ces créatures-là.
 * Même forme que `emanationAgainst` : message d'utilisation neuf, marqué `areaTick` (`event: "swallow"`). MJ actif.
 * @param {Activity} activity
 * @param {TokenDocument} source      L'avaleur.
 * @param {TokenDocument[]} tokens    Les avalés.
 * @param {string} moment             core/swallow.mjs, SWALLOW_MOMENTS.
 * @param {{event?: string, flavor?: string}} [options]  §18.21 : `engulf` — l'activité d'entrée sur qui le cube traverse.
 */
export async function swallowAgainst(activity, source, tokens, moment, { event="swallow", flavor="DND5ECOMBAT.Avale.Degats" }={}) {
  const card = await activity.item.system.getCardData({ activity });
  return ChatMessage.implementation.create({
    type: "usage",
    speaker: ChatMessage.implementation.getSpeaker({ token: source }),
    flavor: game.i18n.format(flavor, { item: activity.item.name, source: source.name, names: tokens.map(t => t.name).join(", ") }),
    system: { ...card, targets: tokens.map(describeTarget) },
    flags: { core: { canPopout: true }, [MODULE_ID]: { areaTick: { event, moment, source: source.uuid, token: tokens[0]?.uuid ?? null } } }
  });
}
