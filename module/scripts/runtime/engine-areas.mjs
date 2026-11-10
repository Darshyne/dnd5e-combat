/**
 * Les zones d'effet posées par une utilisation (régions de dnd5e) : la résolution qui s'ouvre sur la zone, nuages et zones
 * instantanées. Extrait de runtime/engine.mjs.
 */

import { MODULE_ID } from "../constants.mjs";
import { selectAreaTargets, eligibleAreaTargets, zoneChoiceNeeded, openArea, turnKeyOf, actsOnPose } from "../core/area.mjs";
import { isChoiceZone, zoneChoiceMode, askZoneChoice } from "../adapter/zone-choice.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { readActivityRegion, repairSaveAbility, showTargetsTo } from "../adapter/saves.mjs";
import { readUsage } from "../adapter/usage.mjs";
import { concentrationEffectOf, tieRegionToConcentration } from "../adapter/concentration.mjs";
import { areaRulesOf, isInstantaneous, writeAreaState, markTransient, shrinkToBolt, removeTransientRegions, hideRegion, zoneCenter } from "../adapter/areas.mjs";
import { ensureRegionElevation } from "../adapter/space.mjs";
import { stormOf, isBoltRegion } from "../adapter/storm.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { contentOf } from "../adapter/content.mjs";
import { leaveDifficultTerrain } from "../adapter/zone-effects.mjs";
import { scatterOf, scatterState } from "./scatter.mjs";
import { flammableOf, groundFlammableState, igniteUnder } from "./flammable.mjs";
import { log } from "./shared.mjs";
import { enterAllInside } from "./areas.mjs";
import { LOOKBACK, TRANSIENT_LINGER_MS, dispatcher, openingFor } from "./engine.mjs";

/* -------------------------------------------- */
/*  Zones d'effet                               */
/* -------------------------------------------- */

/** Le dernier message d'utilisation de cette activité ; `unresolved` : qui n'a pas encore de résolution. */
function findUsage(activityUuid, { unresolved=false }={}) {
  const messages = game.messages.contents;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - LOOKBACK); i-- ) {
    const message = messages[i];
    if ( (message.type !== "usage") || (unresolved && dispatcher.peek(message.id)) ) continue;
    if ( message.getAssociatedActivity?.()?.uuid === activityUuid ) return message;
  }
  return null;
}

/** §70 : la région posée par un sort à orage qui n'est pas un éclair — le nuage. */
function isCloudRegion(region) {
  const item = fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false });
  return !!stormOf(item) && !isBoltRegion(region);
}

/** Une zone vient d'être posée : ceux qu'elle recouvre sont les cibles de l'activité. */
export async function onRegionCreated(region) {
  // P2 : une région créée sans tranche d'élévation (connecteur, macro) la reçoit avant qu'on lise qui est dedans.
  const slice = await ensureRegionElevation(region);
  if ( slice ) log(`area: elevation slice ${slice.bottom} → ${slice.top} ${region.parent.grid.units}`);
  // §16.21 : Appel de la foudre — la zone posée est le nuage de l'item ; la foudre frappe à 5 ft du point choisi.
  const bolt = await shrinkToBolt(region);
  if ( bolt ) log("area moved to the struck point (lightning)");
  const area = await readActivityRegion(region);
  if ( !area ) return;
  // §188 b : une zone de feu posée sur une zone inflammable (flaque d'huile, toile) l'embrase.
  const lit = await igniteUnder(region, fromUuidSync(area.activity ?? "", { strict: false }));
  if ( lit ) log(`area: ${lit} flammable area(s) ignited`);

  // Zone d'un sort à concentration : elle tombera avec elle (runtime/concentration.mjs).
  // §70 : le nuage — à défaut du message, la concentration en cours de son sort.
  const effect = concentrationEffectOf(findUsage(area.activity))
    ?? (isCloudRegion(region) ? concentrationOn(fromUuidSync(region.getFlag("dnd5e", "item") ?? "", { strict: false })) : null);
  if ( effect ) {
    await tieRegionToConcentration(region, effect);
    log(`area attached to concentration "${effect.name}"`);
  }

  // §70 : le nuage d'un sort à orage ne résout rien — c'est l'éclair, visé dessous, qui le fera.
  if ( isCloudRegion(region) ) { log("storm: cloud placed, waiting for the lightning"); return; }

  const message = findUsage(area.activity, { unresolved: true });
  if ( !message ) return;
  await dispatcher.open(message.id, async () => {
    await repairSaveAbility(message);
    const usage = readUsage(message);
    const activity = message.getAssociatedActivity?.({ scaled: true });
    const rules = areaRulesOf(activity);
    // Une activité qui ne fait que POSER la zone (utilitaire sans effet) n'a rien à résoudre elle-même ;
    // si une sœur doit rejouer (Nuage nauséabond), la zone est quand même retenue comme zone qui dure.
    if ( !usage?.area && !rules?.activity && !rules?.casterPulse ) return null;
    let targets = selectAreaTargets(area.candidates, area).map(({ token, actor, name }) => ({ token, actor, name }));
    // §401 : « créatures de votre choix » — le lanceur choisit parmi ceux que la zone peut affecter (cochés d'avance : le choix d'office).
    const picked = usage?.area ? await askAreaChoice(area, activity, targets) : null;
    if ( picked ) targets = picked.targets;
    log(`area placed: ${area.candidates.length} token(s) covered, ${targets.length} affected`);
    if ( usage?.area ) showTargetsTo(message.author, targets.map(t => t.token));

    // §187 : un objet répandu au sol (chausse-trapes, billes) n'a pas de durée, mais sa zone reste — jusqu'à ce qu'on le ramasse.
    const scatter = scatterOf(activity);
    // §188 : l'huile étalée au sol reste aussi (sans rejeu : elle n'agit qu'une fois embrasée, runtime/flammable.mjs).
    const ground = flammableOf(activity)?.ground === true;
    const lasting = rules ?? (ground ? { on: [], activity: null } : null);
    if ( lasting && (!isInstantaneous(activity) || scatter || ground) ) {
      const rules = lasting;
      // Zone qui dure : elle rejouera son activité (runtime/areas.mjs). Ceux qu'elle touche à la
      // pose l'ont été pour ce tour de jeu — sauf si c'est une sœur qui agit et que la pose ne fait rien.
      const key = turnKeyOf(game.combat?.started ? game.combat.round : null, game.combat?.turn);
      // §300 (repasse C5) : une zone dont le texte ne prévoit rien à l'incantation (`quietPose` : Tempête de neige, Nuage nauséabond)
      // n'agit qu'aux moments déclarés — ceux qui sont déjà dedans sauvegardent en commençant leur tour.
      // §396 : une zone remise par la correction du MJ n'agit pas à la pose non plus (carte marquée `quietPose`).
      const quiet = (contentOf(activity.item).entry?.quietPose === true) || (message.getFlag(MODULE_ID, "quietPose") === true);
      await writeAreaState(region, {
        ...openArea(rules.on, key, (usage?.area && actsOnPose(rules.on) && !scatter && !quiet) ? targets.map(t => t.token) : []),
        usage: message.id,
        // §300 : son centre à la pose — un déplacement de la zone ne fait « entrer » que ceux qu'elle recouvre en plus (runtime/areas.mjs).
        at: zoneCenter(region),
        activity: rules.activity ?? null,
        ...(rules.activities ? { activities: rules.activities } : {}),
        exclude: area.excludeOrigin ? area.origin : null,
        // §91 : le lanceur, dont le tour fait agir la zone (`casterPulse`).
        source: area.origin ?? null,
        // §16.23 : les rejeux de la zone respectent qui elle affecte (Esprits gardiens épargnent les alliés).
        affects: area.affects ?? "", originDisposition: area.originDisposition ?? null, originSide: area.originSide ?? null,
        // §401 : le choix du lanceur à la pose — ceux qu'il a retenus et ceux qu'il a épargnés ; les autres suivent la règle d'office.
        ...(picked ? { picked: picked.targets.map(t => t.token), spared: picked.spared } : {}),
        ...(scatter ? { scatter: await scatterState(region, message, activity) } : {}),
        ...(ground ? await groundFlammableState(region, activity) : {})
      });
      log(`lasting area: acts on ${rules.on.join(", ")}, once per turn${rules.activity ? ` (replays activity ${rules.activity})` : ""}`);
      // C12-b : ceux qu'elle recouvre en apparaissant y entrent (`enterOnPose` : Invocation de céleste).
      if ( contentOf(activity.item).entry?.enterOnPose === true ) {
        enterAllInside(region);
        log(`${activity.item.name}: the creatures already inside enter the area`);
        return null;
      }
      // Une zone qui n'agit qu'au déplacement (Croissance d'épines) ne fait rien à sa pose.
      // §91 : une zone qui n'agit qu'au tour de son lanceur (`casterPulse`, aucun moment) résout sa pose comme une autre.
      // §187 : un objet répandu n'agit pas sur ceux qui sont déjà là — seulement sur qui y entre.
      if ( !usage?.area || scatter || ground || quiet || (rules.on.length && !actsOnPose(rules.on)) ) return null;
    } else if ( isInstantaneous(activity) || bolt ) {
      await markTransient(region, message.id);
      // §261 : Tempête de grêle — le terrain difficile reste quand la zone part.
      const caster = fromUuidSync(area.origin ?? "", { strict: false })?.actor ?? null;
      const left = await leaveDifficultTerrain(region, activity, { caster, combat: game.combat });
      if ( left ) log(`${activity.item.name}: difficult terrain left until the end of ${caster.name}'s next turn`);
      // §201 : la résolution commence — la zone ne recouvre plus l'animation du sort.
      await hideRegion(region);
      // Personne dedans : aucune résolution ne viendra la retirer. On la laisse voir un instant.
      if ( !targets.length ) setTimeout(() => removeTransientRegions(message.id).catch(() => {}), TRANSIENT_LINGER_MS);
    }
    return openingFor(message, { ...usage, targets });
  });
}

/**
 * §401 : la question « créatures de votre choix » d'une zone posée, si le réglage la veut. Rend `{ targets, spared }`, ou null (pas de
 * question : le choix d'office tient).
 */
async function askAreaChoice(area, activity, targets) {
  if ( !isChoiceZone(activity) ) return null;
  const eligible = eligibleAreaTargets(area.candidates, area);
  if ( !zoneChoiceNeeded(zoneChoiceMode(), eligible, targets) ) return null;
  const casterToken = area.origin ? fromUuidSync(area.origin, { strict: false }) : null;
  const caster = casterToken?.actor ?? activity?.actor ?? null;
  if ( !caster ) return null;
  const chosen = new Set(targets.map(t => t.token));
  const candidates = eligible.map(c => {
    const token = fromUuidSync(c.token, { strict: false });
    return { token: c.token, name: c.name, img: token?.texture?.src ?? "", checked: chosen.has(c.token),
      enemy: !!(casterToken && token && areEnemies(casterToken, token)) };
  });
  const answer = await askZoneChoice(caster, { item: activity.item?.name ?? activity.name, max: area.max ?? null, candidates });
  if ( !answer ) return null;
  const keep = new Set(answer.tokens);
  const out = eligible.filter(c => keep.has(c.token)).map(({ token, actor, name }) => ({ token, actor, name }));
  log(`${activity.item?.name}: the caster chose ${out.length} of ${eligible.length} creature(s) in the area`);
  return { targets: out, spared: eligible.filter(c => !keep.has(c.token)).map(c => c.token) };
}
