/**
 * La souris, dans l'esprit de BG3 (SPEC §11, étape 6 bis ; §13.3 : `ui/` lit l'état, émet des
 * intentions, ne décide rien) :
 *
 *  - clic gauche au sol : se déplacer (aperçu du chemin en combat)
 *  - clic gauche sur un ennemi, en combat : attaque de base
 *  - clic droit : menu contextuel (au sol : se déplacer, sauter ; sur un token : attaques, observer)
 *  - mode visée : une attaque ou un sort choisi sans cible attend un clic sur sa cible
 *
 * Chaque clic devient un appel de `runtime/actions.mjs` (`moveTo`, `jumpTo`, `engage`), qui
 * porte le plafond du tour et les attaques d'opportunité. Rien n'est patché : la souris est
 * écoutée sur le document (phase de capture, donc avant PIXI), et un clic n'est « avalé » que
 * lorsque le moteur le prend à son compte.
 */

import { MODULE_ID } from "../constants.mjs";
import { footprintGap } from "../core/movement.mjs";
import { canBeThrown, positionOf, combatantFor, isOwnTurn, readBudget } from "../adapter/turn.mjs";
import { planPath, previewPath, cellUnder, footprintOf, stairsEntry, stairsDestinations, stopWalking } from "../adapter/movement.mjs";
import { stormOf, cloudOf, cloudCircle, boltRadiusPx } from "../adapter/storm.mjs";
import { dressStorm, strike, setBoltAim, freshCloudOf, castStorm } from "../runtime/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { askStorm } from "./storm.mjs";
import { grappleShoveOf, unarmedAttackOf, helpActivityOf } from "../adapter/basics.mjs";
import { pilotOf, commandActivities, commandLabel, transposeOf } from "../adapter/pilot.mjs";
import { grappleEffectsOf, grapplerOf } from "../adapter/grapple.mjs";
import { contentOf } from "../adapter/content.mjs";
import { leapOf, rolledDouble, evalRuleFormula, projectilesOf, projectileCount, targetCount } from "../adapter/projectiles.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { movementCap, reachCells, weaponAttacks, basicAttack, hostileTo, moveTo, jumpTo, engage, teleportSelf, selfTeleportOf,
  approaches, contactAction, contactRefusal, rangeStatus, currentTeleport, teleportClick, castOnTargets, transpose, takeStairs, lineDashOf, dashStrike, dashRefusal, dashPreview } from "../runtime/actions.mjs";
import { leaderOf, canFollow, follow, unfollow } from "../runtime/follow.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { movableZoneOf, moveZone, tooFarForZone } from "../runtime/zones.mjs";
import { canDismiss, dismissPilot, useCommand } from "../runtime/pilot.mjs";
import { canPocket, canRecall, pocketedFamiliar, dismissFamiliar, recallFamiliar, recallRefusal } from "../runtime/familiar.mjs";
import { castWithPicks, leapProblem } from "../runtime/projectiles.mjs";
import { castLight, putOutLight } from "../runtime/lights.mjs";
import { lightChoiceOf } from "../adapter/lights.mjs";
import { askLightChoice } from "./light.mjs";
import { askWildForm } from "./wildshape.mjs";
import { isWildShape, revertActivityOf } from "../adapter/wildshape.mjs";
import { traceAttacks } from "../adapter/traces.mjs";
import { enchantTargetOf } from "../adapter/enchant.mjs";
import { tetherOfActivity, tetheredToken, tetherItems, tetherRuleOf } from "../adapter/tether.mjs";
import { enchantWith, pactWith } from "../runtime/enchant.mjs";
import { askPact } from "./pact.mjs";
import { askEnchantWeapon } from "./enchant.mjs";
import { takeForm, leaveForm } from "../runtime/wildshape.mjs";
import { canStandUp, standUp } from "../runtime/prone.mjs";
import { shapeCenter } from "../core/area.mjs";
import { targetRule, targetRefusal, relationOf } from "../core/targeting.mjs";
import { closeLegalityDialogs, openLegalityDialogs } from "../runtime/turn.mjs";
import { escapableRestraintsOf } from "../adapter/escape.mjs";
import { escapeGrapple, holdsOf, releaseGrapple } from "../runtime/grapple.mjs";
import { ownEndingsOf, endingsOn, endFor } from "../runtime/action-end.mjs";
import { doorState, setDoorOpen, setDoorLocked, pickLock, forceDoor } from "../runtime/doors.mjs";
import { swallowerOf } from "../adapter/swallow.mjs";
import { masteryOf, cleaveCandidates, cleaveSpent } from "../adapter/mastery.mjs";
import { originItemOf } from "../adapter/facts.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { cancelPendingRoll, pendingRoll } from "../runtime/cancel.mjs";
import { route } from "../runtime/router.mjs";
import { loc, log } from "../runtime/shared.mjs";
import { registerHitChance, showHitChance, showSaveChance, hideHitChance, placeHitChance, showBadge } from "./hitchance.mjs";
import { floatNotice } from "./feedback.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { potionCastsOnDrinker } from "../adapter/usage.mjs";
import { isPotion } from "../adapter/potions.mjs";
import { aimedAreaOf, aimedShapeData, aimedRegionData } from "../adapter/self-area.mjs";
import { castAimed, placeAimed } from "../runtime/self-area.mjs";

const setting = key => game.settings.get(MODULE_ID, key);
const inCombat = () => game.combat?.started === true;

/** Le token qui agit : le seul token contrôlé, s'il est à soi. */
function actingToken() {
  const controlled = canvas.tokens?.controlled ?? [];
  return ((controlled.length === 1) && controlled[0].document.isOwner) ? controlled[0].document : null;
}

/** Une intention à la fois : un second clic pendant qu'une action se joue est ignoré. */
let busy = false;
let running = null;
function exclusive(fn) {
  if ( busy ) return Promise.resolve();
  busy = true;
  running = (async () => {
    try { await fn(); }
    catch(err) { console.error(`${MODULE_ID} | souris`, err); }
    finally { busy = false; running = null; }
  })();
  return running;
}

/**
 * §99 : un clic pendant que le token marche (déplacement, approche d'une attaque, d'une porte) l'arrête à la prochaine case
 * libre — l'intention en cours s'arrête là (pas d'attaque au bout) — puis `then`, s'il y en a un, part comme un nouveau clic.
 * Rend faux si le token ne marchait pas : le clic est alors ignoré, comme tout clic pendant une action.
 */
function interruptWalk(token, then=null) {
  if ( !busy || !stopWalking(token) ) return false;
  const current = running;
  current.then(() => (then ? exclusive(then) : null));
  return true;
}

const engageWith = (token, target, activity, options={}) => engage(token, target, activity, { fast: setting("fastAttack"), ...options });

function observe(target) {
  const actor = target.actor;
  if ( actor?.testUserPermission(game.user, "LIMITED") ) return actor.sheet.render(true);
  ui.notifications.info(target.name);
}

/* -------------------------------------------- */
/*  Mode visée                                  */
/* -------------------------------------------- */

let targeting = null;
/**
 * §16.27 : visée multiple d'un sort à projectiles (Projectile magique, Rayon ardent, Décharge occulte) — après le choix du
 * niveau, chaque clic sur une créature lui envoie un projectile (la même peut être cliquée plusieurs fois) ; un compteur
 * suit le curseur ; au dernier, le sort part. `{ token, activity, count, picks, usage }`.
 */
let picking = null;
/** §16.14 : une zone à déplacer attend la case où la poser (`{ activity }`), par la pose du cœur (placeZone). */
let placing = null;
/** §57 : une ruée en ligne droite (Frappe du vent) attend le clic sur sa case d'arrivée (`{ token, activity, usage }`). */
let dashing = null;
/** §107 : le rappel d'un familier attend le clic sur la case où il réapparaît (`{ token }` : le token du maître). */
let recalling = null;
/** Teinte de l'aperçu quand la case est hors de portée du déplacement. */
const TOO_FAR_COLOR = "#d03030";

/** Qui l'activité vise d'un clic (core/targeting.mjs), ou null si elle ne se vise pas ainsi. */
function ruleOf(activity) {
  // §16.41 : l'arme d'une créature, soi compris (Arme élémentaire : dnd5e vise un « objet »).
  if ( enchantTargetOf(activity) === "weapon" ) return { self: true, side: null };
  // §53 : le sort qu'une potion fait lancer est pour le buveur (adapter/usage.mjs) — rien à viser.
  if ( potionCastsOnDrinker(activity?.item) ) return null;
  // §101 : une potion « au toucher » se boit sans cible (le buveur), ou va à la créature déjà désignée — pas de visée.
  if ( isPotion(activity?.item) && (activity.range?.units === "touch") ) return null;
  return activity ? targetRule({ type: activity.type, affects: activity.target?.affects?.type, rangeUnits: activity.range?.units,
    template: activity.target?.template?.type }) : null;
}

function needsTarget(activity) {
  return !!ruleOf(activity);
}

const TARGET_REFUSALS = { self: "Retour.PasSoi", notAlly: "Retour.PasAllie", notEnemy: "Retour.PasEnnemi" };

/** Le type de cible de l'activité refuse-t-il cette créature (soi-même, mauvais camp) ? Le texte du refus, ou null. */
function targetTypeRefusal(me, hover, activity) {
  const why = targetRefusal(ruleOf(activity), { isSelf: hover === me, relation: relationOf(me.disposition, hover.disposition) });
  return why ? loc(TARGET_REFUSALS[why]) : null;
}

/**
 * `dnd5e.preUseActivity`, AVANT le contrôle de légalité (ordre des `register…()`) : une activité
 * qui vise quelqu'un, lancée sans cible, passe en mode visée ; l'utilisation est suspendue et
 * repartira, mêmes configurations, au clic sur la cible.
 */
function onPreUseActivity(activity, usageConfig, dialogConfig, messageConfig) {
  // §16.27 : un sort à projectiles se vise projectile par projectile, après le choix du niveau. Pas pour un appelant qui
  // confirme d'office (connecteur, scénarios : cibles données), ni pour un projectile enchaîné ou un rebond.
  const ours = usageConfig[MODULE_ID] ?? {};
  if ( projectilesOf(activity?.item) && !ours.confirmed && !ours.picks && !ours.projectileOf && !ours.leap && canvas.ready ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( token?.object && token.isOwner ) {
      closeSheetFor(activity);
      stopTargeting();
      startPicking(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | visée multiple`, err));
      return false;
    }
  }
  // §70 : Appel de la foudre — « dehors, par temps d'orage ? » avant l'incantation (pas à la relance : le nuage est là).
  const storm = stormOf(activity?.item);
  if ( storm && !ours.recast && !("stormy" in ours) && !ours.confirmed && canvas.ready && activity.actor?.isOwner && !cloudOf(activity.item) ) {
    closeSheetFor(activity);
    stopTargeting();
    askStorm(activity, storm.bonus ?? "").then(stormy => (stormy === null) ? null
      : exclusive(() => castStorm(activity, [usageConfig, dialogConfig, messageConfig], stormy)))
      .catch(err => console.error(`${MODULE_ID} | orage`, err));
    return false;
  }
  // §16.35 : un sort de lumière qui invoque un objet (Lumière) — au sol ou sur soi, et la couleur, avant de lancer.
  if ( lightChoiceOf(activity) && !ours.lightChoice && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askLightChoice(activity).then(choice => !choice ? null
      : exclusive(() => (choice.where === "off") ? putOutLight(activity) : castLight(activity, usage, choice)))
      .catch(err => console.error(`${MODULE_ID} | choix de la lumière`, err));
    return false;
  }
  // §16.41 : Arme élémentaire — le niveau et l'élément (fenêtre de dnd5e), puis la créature (visée), puis son arme.
  // §16.45 : Pacte de la lame — ses armes ou une arme invoquée, et le type de dégâts ; pas de créature à viser.
  if ( (enchantTargetOf(activity) === "ownWeapon") && !ours.enchantItem && !ours.confirmed && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askPact(activity).then(choice => choice ? exclusive(() => pactWith(activity, usage, choice)) : null)
      .catch(err => console.error(`${MODULE_ID} | arme de pacte`, err));
    return false;
  }
  if ( (enchantTargetOf(activity) === "weapon") && !ours.enchantItem && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const target = [...game.user.targets][0]?.document ?? null;
    if ( ours.engaged || target ) {
      const usage = [usageConfig, dialogConfig, messageConfig];
      askEnchantWeapon(activity, target?.actor).then(uuid => uuid ? exclusive(() => enchantWith(activity, usage, uuid)) : null)
        .catch(err => console.error(`${MODULE_ID} | enchantement`, err));
      return false;
    }
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( !token?.object ) return true;
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      targeting = { token, activity, usage: [chosen.config, { ...(dialogConfig ?? {}), configure: false }, messageConfig] };
      document.body.classList.add("dnd5e-combat-targeting");
      ui.notifications.info(loc("Enchant.ChoisirCreature", { name: activity.item.name }));
    }).catch(err => console.error(`${MODULE_ID} | enchantement`, err));
    return false;
  }
  // §16.39 : Forme sauvage, Formes du cercle — la forme se choisit parmi les formes connues, avant de lancer.
  if ( isWildShape(activity) && !ours.wildForm && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askWildForm(activity).then(uuid => uuid ? exclusive(() => takeForm(activity, usage, uuid)) : null)
      .catch(err => console.error(`${MODULE_ID} | forme sauvage`, err));
    return false;
  }
  // §57 : une ruée en ligne droite (Frappe du vent) — la case d'arrivée se vise au lieu de poser le gabarit de ligne.
  if ( lineDashOf(activity) && !ours.dash && !ours.confirmed && canvas.ready ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( token?.object && token.isOwner ) {
      closeSheetFor(activity);
      stopTargeting();
      ui.notifications.info(loc("Ruee.Choisir", { item: activity.item.name }));
      dashing = { token, activity, usage: [usageConfig, dialogConfig, messageConfig] };
      document.body.classList.add("dnd5e-combat-targeting");
      return false;
    }
  }
  // §59 : un cône, une ligne ou un cube de portée personnelle (souffle, Mains brûlantes, Éclair, Vague tonnante) — le niveau
  // d'abord, puis la zone suit la souris autour du lanceur ; le clic la pose et lance l'activité.
  const aim = (ours.aimed || ours.confirmed || !canvas.ready || (usageConfig.create?.measuredTemplate !== true) || lineDashOf(activity))
    ? null : aimedAreaOf(activity);
  if ( aim && aim.token.object && aim.token.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    usageConfig.create.measuredTemplate = false;
    if ( dialogConfig ) {
      dialogConfig.options ??= {};
      dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
    }
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      return aimArea(activity, aim, shape => exclusive(() => castAimed(activity,
        [chosen.config, { ...(dialogConfig ?? {}), configure: false }, messageConfig], shape)));
    }).catch(err => console.error(`${MODULE_ID} | visée de zone`, err));
    return false;
  }
  // §16.14 : relancer un sort dont la zone déplaçable est déjà là (Rayon de lune) la déplace : on vise la case, rien n'est
  // lancé. Pas pour un appelant qui confirme d'office (connecteur, relance après la légalité) : lui lance vraiment.
  const zone = usageConfig[MODULE_ID]?.confirmed ? null : movableZoneOf(activity);
  if ( zone ) {
    stopTargeting();
    placeZone(activity, zone);
    return false;
  }
  if ( !usageConfig[MODULE_ID]?.engaged && !usageConfig[MODULE_ID]?.confirmed ) closeSheetFor(activity);
  if ( !setting("targetingMode") || usageConfig[MODULE_ID]?.engaged || usageConfig[MODULE_ID]?.confirmed ) return true;
  if ( !canvas.ready || game.user.targets.size || !needsTarget(activity) ) return true;
  const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
  if ( !token?.object || !token.isOwner ) return true;
  stopTargeting();
  // §16.33 : un sort à plusieurs cibles (Bénédiction, Prière de guérison…) — le niveau d'abord, puis un clic par créature.
  if ( maySeveral(activity) ) {
    startGroup(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | visée de groupe`, err));
    return false;
  }
  targeting = { token, activity, usage: [usageConfig, dialogConfig, messageConfig] };
  document.body.classList.add("dnd5e-combat-targeting");
  ui.notifications.info(loc("Visee.Choisir", { name: activity.item.name }));
  return false;
}

/**
 * §15.1 : choisir une attaque ou un sort ferme la fiche de personnage, pour dégager la vue (visée
 * comprise). Réglage par client. Les autres activités (soin d'une potion, utilitaire) la laissent.
 */
function closeSheetFor(activity) {
  if ( !setting("closeSheetOnUse") || ((activity.type !== "attack") && !isSpellCast(activity.item)) ) return;
  const sheet = activity.actor?.sheet;
  if ( sheet?.rendered ) sheet.close();
}

/**
 * §16.14 : la nouvelle position d'une zone se choisit par la pose interactive du cœur V14
 * (`RegionLayer#placeRegion`, client/canvas/layers/regions.mjs:688, `create: false` : rien n'est créé, la forme placée
 * est rendue) — celle que dnd5e emploie pour poser le sort (canvas/template-placement.mjs:24). L'aperçu est donc la zone
 * elle-même sous la souris, calée sur la grille comme à la pose ; rouge au-delà de la distance permise, où le clic est
 * refusé. Clic droit ou Échap : le cœur annule. La souris du moteur s'efface pendant la pose.
 */
async function placeZone(activity, zone) {
  const source = zone.region.toObject();
  const shape = source.shapes?.[0];
  if ( !shape || !canvas.ready ) return;
  placing = { activity };
  ui.notifications.info(loc("Zone.Choisir", { item: activity.item.name }));
  const far = s => tooFarForZone(zone, shapeCenter(s.toObject()));
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), name: source.name, color: source.color, shapes: [shape], levels: source.levels,
      elevation: source.elevation, restriction: source.restriction, visibility: source.visibility,
      highlightMode: source.highlightMode, hidden: source.hidden, displayMeasurements: true
    }, {
      create: false, allowRotation: false,
      onChange: ({ preview, document: doc, shape: s }) => {
        doc.updateSource({ color: far(s) ? TOO_FAR_COLOR : source.color });
        preview.renderFlags.set({ refreshState: true });
      },
      preConfirm: ({ shape: s }) => {
        if ( !far(s) ) return true;
        ui.notifications.warn(loc("Zone.TropLoin", { item: activity.item.name, max: zone.rule.distance, units: zone.rule.units }));
        return false;
      }
    });
    const point = placed?.shapes?.length ? shapeCenter(placed.shapes[0].toObject()) : null;
    if ( !point ) return ui.notifications.info(loc("Visee.Annulee"));
    await exclusive(() => moveZone(activity, point));
  } catch(err) { console.error(`${MODULE_ID} | déplacement de zone`, err); }
  finally { placing = null; }
}

/**
 * §59 : la visée d'un cône, d'une ligne ou d'un cube autour du lanceur, par la pose de région du cœur (`RegionLayer#placeRegion`,
 * client/canvas/layers/regions.mjs:688) : `onMove` remplace le déplacement par défaut (regions.mjs:1037-1043) — le sommet
 * reste sur le bord du lanceur, seule la direction suit la souris ; un cube reste accolé au lanceur (`aimedShapeData`) ; la molette ne tourne rien
 * (`onRotate` rend false, regions.mjs:991). Clic gauche : `then(shape)` ; clic droit ou Échap : rien.
 * @param {Activity} activity
 * @param {{shape: "cone"|"line", token: TokenDocument}} area
 * @param {(shape: object) => any} then  Ce qui suit le clic, avec la forme visée.
 */
async function aimArea(activity, area, then) {
  if ( !canvas.ready ) return;
  stopTargeting();
  placing = { activity };
  ui.notifications.info(loc("Zone.Viser", { item: activity.item.name, name: area.token.name }));
  let last = null;
  const center = area.token.object.center;
  const initial = aimedShapeData(activity, area, { x: center.x + 1, y: center.y });
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), ...aimedRegionData(activity, area, initial), displayMeasurements: true
    }, {
      create: false, allowRotation: true,
      onMove: ({ position, shape }) => {
        const data = aimedShapeData(activity, area, position, last);
        const c = area.token.object.center;
        if ( Math.hypot(position.x - c.x, position.y - c.y) > 1 ) last = { x: position.x - c.x, y: position.y - c.y };
        shape.updateSource({ x: data.x, y: data.y, rotation: data.rotation });
        return false;
      },
      onRotate: () => false
    });
    const shape = placed?.shapes?.length ? placed.shapes[0].toObject() : null;
    if ( !shape ) return ui.notifications.info(loc("Visee.Annulee"));
    placing = null;
    await then(shape);
  } catch(err) { console.error(`${MODULE_ID} | visée de zone`, err); }
  finally { placing = null; }
}

/**
 * §70 : après une utilisation d'Appel de la foudre — à l'incantation, le nuage que dnd5e vient de poser est habillé en orage ;
 * puis (incantation comme relance) l'éclair se vise sous le nuage : un cercle de 1,50 m suit la souris sans sortir du nuage,
 * le clic le pose (la résolution le lit), clic droit ou Échap : pas d'éclair (la carte reste sans résolution).
 */
async function stormAfterUse(activity, usageConfig) {
  const ours = usageConfig?.[MODULE_ID] ?? {};
  let cloud = ours.recast ? cloudOf(activity.item) : null;
  if ( !cloud ) {
    cloud = freshCloudOf(activity.item);
    if ( !cloud ) return;
    await dressStorm(activity, cloud, { stormy: ours.stormy === true });
  }
  await aimBolt(activity, cloud);
}

async function aimBolt(activity, cloud) {
  if ( !canvas.ready ) return;
  const circle = cloudCircle(cloud);
  if ( !circle ) return;
  stopTargeting();
  placing = { activity };
  setBoltAim({ activity, cloud });
  ui.notifications.info(loc("Orage.Viser", { item: activity.item.name }));
  const radius = boltRadiusPx(activity.item, cloud.parent);
  try {
    const placed = await canvas.regions.placeRegion({
      _id: foundry.utils.randomID(), name: activity.item.name, color: "#e8f4ff",
      shapes: [{ type: "circle", x: circle.center.x, y: circle.center.y, radius }], displayMeasurements: false
    }, {
      create: false, allowRotation: false,
      onMove: ({ position, shape }) => {
        const at = clampToCircle(position, circle.center, circle.radius);
        shape.updateSource({ x: at.x, y: at.y });
        return false;
      },
      onRotate: () => false
    });
    const shape = placed?.shapes?.length ? placed.shapes[0].toObject() : null;
    if ( !shape ) return;
    placing = null;
    setBoltAim(null);
    await exclusive(() => strike(activity, cloud, { x: shape.x, y: shape.y }));
  } catch(err) { console.error(`${MODULE_ID} | visée de l'éclair`, err); }
  finally { placing = null; setBoltAim(null); }
}

/** §59 : le bouton « Placer la zone » de la carte d'un cône ou d'une ligne de portée personnelle — la même visée. */
function onPreTemplate(activity) {
  if ( lineDashOf(activity) ) return;
  const aim = aimedAreaOf(activity);
  if ( !aim?.token.object || !aim.token.isOwner ) return;
  aimArea(activity, aim, shape => placeAimed(activity, shape)).catch(err => console.error(`${MODULE_ID} | visée de zone`, err));
  return false;
}

/**
 * La fenêtre d'utilisation de dnd5e (niveau d'emplacement…), sans lancer : rend la configuration choisie et le niveau, ou
 * null si la fenêtre a été fermée.
 */
async function configureFirst(activity, usageConfig, dialogConfig) {
  let config = usageConfig;
  if ( (dialogConfig?.configure !== false) && activity._requiresConfigurationDialog?.(usageConfig) && dialogConfig?.applicationClass ) {
    try { config = (await dialogConfig.applicationClass.create(activity, usageConfig, dialogConfig.options ?? {})) ?? usageConfig; }
    catch { return null; }   // fenêtre fermée : rien n'est lancé
  }
  const slot = config.spell?.slot;
  const level = slot ? (activity.actor?.system.spells?.[slot]?.level ?? activity.item.system.level ?? 0) : (activity.item.system.level ?? 0);
  return { config, level };
}

/** §16.33 : l'activité peut-elle viser plusieurs créatures (nombre de cibles > 1, ou qui dépend du niveau) ? Pas une attaque. */
function maySeveral(activity) {
  if ( activity.type === "attack" ) return false;
  const formula = activity.target?.override ? activity._source?.target?.affects?.count : activity.item?._source?.system?.target?.affects?.count;
  return (targetCount(activity) > 1) || /@/.test(String(formula ?? ""));
}

/**
 * §16.33 : visée de groupe — le niveau d'abord (il fixe le nombre de cibles : Invisibilité surclassée), puis un clic par
 * créature, un second clic la retire ; au dernier, ou sur Entrée, le sort part sur toutes. Une seule cible possible à ce
 * niveau : la visée ordinaire.
 */
async function startGroup(token, activity, usageConfig, dialogConfig, messageConfig) {
  const chosen = await configureFirst(activity, usageConfig, dialogConfig);
  if ( !chosen ) return;
  const usage = [chosen.config, { ...(dialogConfig ?? {}), configure: false }, messageConfig];
  const count = targetCount(activity, { level: chosen.level });
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  document.body.classList.add("dnd5e-combat-targeting");
  if ( count <= 1 ) {
    targeting = { token, activity, usage };
    return ui.notifications.info(loc("Visee.Choisir", { name: activity.item.name }));
  }
  picking = { token, activity, count, picks: [], group: true, usage };
  showReticle(counterText());
  ui.notifications.info(loc("Cibles.Choisir", { item: activity.item.name, count }));
}

/** §16.33 : la visée de groupe est close (complète, ou Entrée) — le sort part sur les créatures choisies. */
function finishGroup() {
  if ( !picking?.group || !picking.picks.length ) return;
  const { activity, usage, picks } = picking;
  stopTargeting();
  exclusive(() => castOnTargets(activity, usage, picks));
}

/** Le niveau d'emplacement d'abord (la fenêtre de dnd5e, sans lancer), puis la visée multiple. */
async function startPicking(token, activity, usageConfig, dialogConfig, messageConfig) {
  const chosen = await configureFirst(activity, usageConfig, dialogConfig);
  if ( !chosen ) return;
  const { config, level } = chosen;
  const count = projectileCount(activity, { level });
  for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false });
  picking = { token, activity, count, picks: [], usage: [config, { ...(dialogConfig ?? {}), configure: false }, messageConfig] };
  document.body.classList.add("dnd5e-combat-targeting");
  showReticle(counterText());
  ui.notifications.info(loc("Projectiles.Choisir", { item: activity.item.name, count }));
}

function counterText() {
  if ( picking.group ) return loc("Cibles.Compteur", { item: picking.activity.item.name, done: picking.picks.length, count: picking.count });
  return loc("Projectiles.Compteur", { item: picking.activity.item.name, done: picking.picks.length, count: picking.count });
}

/**
 * Réticule d'invite (demande de l'utilisateur, 2026-09-25 : « grossir le curseur cible et le faire pulser ») : quand le moteur
 * ouvre lui-même une visée (rebond, Taille, sort de début de tour, visée multiple), un grand anneau qui pulse suit la souris,
 * le motif en dessous ; rouge sur une cible refusée. Un curseur ne s'anime pas : c'est un élément, le curseur du cœur est
 * masqué sur le canevas le temps de l'invite (styles, `dnd5e-combat-prompt`).
 */
let reticle = null;

function showReticle(label) {
  if ( !reticle ) {
    reticle = document.createElement("div");
    reticle.className = "dnd5e-combat-reticle";
    reticle.innerHTML = `<div class="ring"></div><div class="cross"></div><div class="label"></div>`;
  }
  reticle.querySelector(".label").textContent = label ?? "";
  reticle.classList.remove("refused");
  reticle.hidden = false;
  if ( !reticle.isConnected ) document.body.append(reticle);
  document.body.classList.add("dnd5e-combat-prompt");
  if ( lastPointer ) placeReticle(lastPointer);
}

function setReticleLabel(label) {
  if ( reticle && !reticle.hidden ) reticle.querySelector(".label").textContent = label ?? "";
}

function setReticleRefused(refused) {
  if ( reticle && !reticle.hidden ) reticle.classList.toggle("refused", !!refused);
}

function placeReticle(event) {
  if ( !reticle || reticle.hidden ) return;
  reticle.style.left = `${event.clientX}px`;
  reticle.style.top = `${event.clientY}px`;
}

function hideReticle() {
  if ( reticle ) reticle.hidden = true;
  document.body.classList.remove("dnd5e-combat-prompt");
}

function stopPicking() {
  picking = null;
}

/** Un clic sur une créature pendant la visée multiple : un projectile de plus pour elle ; au dernier, le sort part. */
function pickTarget(hover) {
  if ( !picking || !hover?.object ) return;
  // §16.33 : en visée de groupe, une créature ne compte qu'une fois — la recliquer la retire.
  if ( picking.group && picking.picks.includes(hover.uuid) ) {
    picking.picks.splice(picking.picks.indexOf(hover.uuid), 1);
    hover.object.setTarget(false, { releaseOthers: false, groupSelection: true });
    return setReticleLabel(counterText());
  }
  const refusal = refusalFor(picking.token, hover, picking.activity);
  if ( refusal ) return floatNotice(hover, refusal, "refused");
  picking.picks.push(hover.uuid);
  hover.object.setTarget(true, { releaseOthers: false, groupSelection: true });
  setReticleLabel(counterText());
  floatNotice(hover, `${picking.picks.length}/${picking.count}`);
  if ( picking.picks.length < picking.count ) return;
  if ( picking.group ) return finishGroup();
  const { token, activity, usage: [config, dialog, message], picks } = picking;
  stopTargeting();
  // Rayons : le premier part comme une attaque cliquée (jet enchaîné, attaque rapide), les autres seront enchaînés par le moteur.
  if ( projectilesOf(activity.item)?.attack ) {
    const first = fromUuidSync(picks[0], { strict: false });
    const usage = [{ ...config, [MODULE_ID]: { ...(config[MODULE_ID] ?? {}), picks } }, dialog, message];
    if ( first ) return exclusive(() => engageWith(token, first, activity, { usage }));
  }
  exclusive(() => castWithPicks(activity, [config, dialog, message], picks));
}

function stopTargeting() {
  stopPicking();
  dashing = null;
  recalling = null;
  hideReticle();
  targeting = null;
  if ( placing ) canvas.regions?._cancelPlacement?.();
  placing = null;
  hideHitChance();
  setCursor(null);
  document.body.classList.remove("dnd5e-combat-targeting");
}

/**
 * §16.21 : au début du tour d'un lanceur, une activité à proposer (`atTurnStart`, Aura de vitalité) tant que la
 * concentration du sort tient — la visée s'ouvre sur le client de celui qui joue ce combattant ; clic droit pour passer.
 */
let offeredTurn = null;
function offerTurnStart(combat, prior, current) {
  // Le cœur peut appeler `combatTurnChange` deux fois pour un même passage (changement de round) : une offre par tour.
  const key = `${combat.id}.${current?.round}.${current?.turn}`;
  if ( key === offeredTurn ) return;
  offeredTurn = key;
  const combatant = combat.combatants.get(current?.combatantId);
  const actor = combatant?.actor;
  const token = combatant?.token;
  if ( !actor?.isOwner || !token?.object ) return;
  if ( game.user.isGM && combatant.players?.some(u => u.active && !u.isGM) ) return;   // le joueur est là : c'est à lui
  for ( const item of actor.items ) {
    const rule = contentOf(item).entry?.atTurnStart;
    const activity = rule ? item.system.activities?.get(rule.activity) : null;
    if ( !activity || !concentrationOn(item) ) continue;
    // §16.43 : l'action suivante d'un lien n'a de sens que tant qu'une créature est liée ; on la montre.
    const bound = (tetherOfActivity(activity)?.role === "follow") ? tetheredToken(item) : undefined;
    if ( bound === null ) continue;
    if ( bound ) floatNotice(bound, item.name, "prompt");
    stopTargeting();
    targeting = { token, activity, usage: [{}, { configure: false }, {}] };
    document.body.classList.add("dnd5e-combat-targeting");
    ui.notifications.info(loc("Visee.DebutTour", { item: item.name }));
    showReticle(item.name);
    return;
  }
}

/* -------------------------------------------- */
/*  Menu contextuel                             */
/* -------------------------------------------- */

let menu = null;
/**
 * §16.44 : le menu d'un token neutre ou amical cache ses actions offensives ; **une fois le menu ouvert**, Maj tenue les montre
 * (relâchée, elles se cachent). `{ point, build(aggressive), hidden, shown }`, ou null.
 */
let menuSource = null;
function closeMenu() {
  menu?.remove();
  menu = null;
  menuSource = null;
}

/** La ligne d'aide d'un menu dont les actions offensives sont cachées. */
const shiftHint = () => ({ hint: true, icon: "fa-solid fa-keyboard", label: loc("Menu.MajOffensives") });

function openMenu(event, entries, source=null) {
  closeMenu();
  if ( !entries.length ) return;
  renderMenu({ clientX: event.clientX, clientY: event.clientY }, entries);
  menuSource = source;
}

function renderMenu(point, entries) {
  menu = document.createElement("nav");
  menu.classList.add("dnd5e-combat-menu");
  for ( const entry of entries ) {
    if ( entry.hint ) {
      const hint = document.createElement("div");
      hint.classList.add("hint");
      hint.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
      hint.querySelector("span").textContent = entry.label;
      menu.append(hint);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `<i class="${entry.icon}"></i> <span></span>`;
    button.querySelector("span").textContent = entry.label;
    button.addEventListener("click", event => { closeMenu(); exclusive(() => entry.run(event)); });
    menu.append(button);
  }
  document.body.append(menu);
  const { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${Math.min(point.clientX, window.innerWidth - w - 4)}px`;
  menu.style.top = `${Math.min(point.clientY, window.innerHeight - h - 4)}px`;
}

/**
 * §16.44 : le menu d'une autre créature. Les actions offensives (attaques, mains nues, sorts d'attaque) n'y sont d'emblée que
 * contre une créature hostile ; sur une créature neutre ou amicale, Maj tenue une fois le menu ouvert les montre.
 */
function openTokenMenu(event, me, target) {
  const hostile = hostileTo(me, target);
  const build = aggressive => withNeighbourEntries(tokenEntries(me, target, { aggressive: hostile || aggressive }), me, target,
    hostile || aggressive);
  const calm = build(false);
  const hidden = !hostile && (build(true).length > calm.length);
  const point = { clientX: event.clientX, clientY: event.clientY };
  openMenu(event, hidden ? [...calm, shiftHint()] : calm, hidden ? { point, build, hidden, shown: false } : null);
}

/**
 * §41.4 : les entrées du menu contextuel d'un token, pour une interface qui veut les offrir ailleurs que sur le canevas
 * (le portrait du Groupe de Darsh UI DnD5) : ce que le token en main (le seul contrôlé, à soi) peut faire de celui-là —
 * les mêmes que le clic droit, entrées des modules voisins comprises, sans les actions offensives sur une créature qui
 * n'est pas hostile. Vide sans token en main, ou sur une autre scène. `run(event)` joue l'entrée (une à la fois).
 * @param {Token|TokenDocument} target
 * @returns {{icon: string, label: string, run: (event?: Event) => void}[]}
 */
export function menuEntriesFor(target) {
  const me = actingToken();
  const doc = target?.document ?? target;
  if ( !me || !doc?.parent || (doc.parent !== me.parent) ) return [];
  const hostile = (doc !== me) && hostileTo(me, doc);
  const raw = (doc === me) ? selfEntries(me) : withNeighbourEntries(tokenEntries(me, doc, { aggressive: hostile }), me, doc, hostile);
  return raw.filter(e => !e.hint).map(e => ({ icon: e.icon, label: e.label, run: event => exclusive(() => e.run(event)) }));
}

/**
 * §39.4 : les modules voisins ajoutent leurs entrées au menu d'un token (Darsh Loot : « Échanger » sur un autre PJ) par le
 * hook `dnd5e-combat.tokenMenu` — `(entries, { token, target, aggressive })`, chaque entrée `{ icon, label, run(event) }`
 * poussée dans `entries`. Le moteur n'en connaît aucun ; sans inscrit, le menu est le sien.
 */
function withNeighbourEntries(entries, token, target, aggressive) {
  Hooks.callAll(`${MODULE_ID}.tokenMenu`, entries, { token, target, aggressive });
  return entries.filter(e => e && (typeof e.run === "function") && e.label);
}

/** Maj enfoncée ou relâchée, menu ouvert : les actions offensives paraissent ou se cachent. */
function onMenuShift(event) {
  if ( (event.key !== "Shift") || !menu || !menuSource?.hidden ) return;
  const shown = event.type === "keydown";
  if ( shown === menuSource.shown ) return;
  const source = menuSource;
  menu.remove();
  renderMenu(source.point, shown ? source.build(true) : [...source.build(false), shiftHint()]);
  source.shown = shown;
  menuSource = source;
}

/**
 * §18.24 : la porte sous la souris — le cœur note dans `canvas.walls.hover` le mur dont on survole l'icône de porte
 * (door-control.mjs, `_onMouseOver`, seulement pour qui a le droit « WALL_DOORS »).
 */
function hoveredDoor() {
  const wall = canvas.walls?.hover;
  return (wall?.isDoor && wall.doorControl?.visible !== false) ? wall : null;
}

/** Ouvrir / fermer ; devant une porte verrouillée, crocheter et forcer ; pour le MJ, verrouiller / déverrouiller. */
function doorEntries(token, wall) {
  const state = doorState(wall);
  const entries = [];
  if ( state === "open" ) entries.push({ icon: "fa-solid fa-door-closed", label: loc("Menu.Fermer"), run: () => setDoorOpen(token, wall, false) });
  else entries.push({ icon: "fa-solid fa-door-open", label: loc("Menu.Ouvrir"), run: () => setDoorOpen(token, wall, true) });
  if ( state === "locked" ) {
    entries.push({ icon: "fa-solid fa-key", label: loc("Menu.Crocheter"), run: event => pickLock(token, wall, { event }) });
    entries.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.Forcer"), run: event => forceDoor(token, wall, { event }) });
  }
  if ( game.user.isGM && (state !== "open") ) {
    const locked = state === "locked";
    entries.push({ icon: locked ? "fa-solid fa-lock-open" : "fa-solid fa-lock", label: loc(locked ? "Menu.Deverrouiller" : "Menu.Verrouiller"),
      run: () => setDoorLocked(wall, !locked) });
  }
  return entries;
}

/**
 * §41.2 : sur un escalier, une échelle ou un ascenseur — une entrée par niveau où il mène (« Monter », « Descendre »).
 */
const STAIRS_ICONS = { up: "fa-solid fa-arrow-up-right-dots", down: "fa-solid fa-arrow-down-wide-short", level: "fa-solid fa-right-left" };
const STAIRS_LABELS = { up: "Menu.Monter", down: "Menu.Descendre", level: "Menu.Rejoindre" };
function stairsEntries(token, point) {
  return stairsDestinations(token, point).map(d => ({ icon: STAIRS_ICONS[d.direction], label: loc(STAIRS_LABELS[d.direction], { level: d.name }),
    run: () => takeStairs(token, point, d.id) }));
}

function groundEntries(token, point) {
  return [
    ...stairsEntries(token, point),
    { icon: "fa-solid fa-person-walking", label: loc("Menu.SeDeplacer"), run: () => moveTo(token, point) },
    { icon: "fa-solid fa-person-running", label: loc("Menu.Sauter"), run: () => jumpTo(token, point) }
  ];
}

/**
 * Sur son propre token : S'échapper, s'il est agrippé (toute créature, PNJ compris) ; Renvoyer, si c'est un objet piloté
 * qui met fin au sort (§16.15 : un joueur n'a pas le droit de supprimer un token, même le sien).
 */
const grappledSelf = token => (token?.actor?.statuses?.has("grappled") === true) || !!swallowerOf(token)?.rule.escape   // §18.21
  || (escapableRestraintsOf(token?.actor).length > 0)   // §16.54 : entravé, avec un test pour se libérer
  || (ownEndingsOf(token?.actor).length > 0);   // §43.2 : un effet auquel son action met fin (Danse irrésistible d'Otto)
/** §43.2 : le libellé de « S'échapper » quand il n'y a ni empoignade ni entrave — « Mettre fin : Forme gazeuse ». */
function escapeLabel(token) {
  const actor = token?.actor;
  if ( actor?.statuses?.has("grappled") || swallowerOf(token)?.rule.escape || escapableRestraintsOf(actor).length ) return loc("Menu.Echapper");
  const endings = ownEndingsOf(actor);
  return (endings.length === 1) ? loc("Menu.MettreFin", { item: endings[0].item.name }) : loc("Menu.Echapper");
}
/** §102 : le menu de son propre token s'ouvre dès qu'il a une entrée — du moteur ou d'un module voisin. */
const hasSelfMenu = token => selfEntries(token).length > 0;
function selfEntries(token) {
  const entries = [];
  if ( canStandUp(token) ) entries.push({ icon: "fa-solid fa-person-arrow-up-from-line", label: loc("Menu.SeRelever"), run: () => standUp(token) });
  if ( grappledSelf(token) ) entries.push({ icon: "fa-solid fa-person-running", label: escapeLabel(token), run: event => escapeGrapple(token, { event }) });
  // §16.39 : quitter la Forme sauvage (action Bonus).
  const revert = revertActivityOf(token.actor);
  if ( revert ) entries.push({ icon: "fa-solid fa-paw", label: loc("Forme.Reprendre"), run: event => leaveForm(revert, event) });
  // §16.15 : les commandes qui ne visent que l'objet (Main interposée).
  const pilot = pilotOf(token);
  for ( const activity of pilot ? commandActivities(pilot, { self: true }) : [] ) {
    entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.Utiliser", { name: commandLabel(activity) }), run: event => useCommand(token, activity, event) });
  }
  // §38.2 : Troc du filou — depuis l'illusion ou depuis son lanceur.
  const swap = transposeOf(token);
  if ( swap ) entries.push({ icon: "fa-solid fa-arrows-rotate", label: loc("Menu.Echanger", { name: (swap.illusion === token ? swap.caster : swap.illusion).name }), run: () => transpose(token) });
  if ( canDismiss(token) ) entries.push({ icon: "fa-solid fa-xmark", label: loc("Menu.Renvoyer", { name: token.name }), run: () => dismissPilot(token) });
  // §107 : le familier part dans sa poche dimensionnelle (depuis son token) ; son maître l'en rappelle (depuis le sien).
  entries.push(...familiarEntries(token, token));
  // §41.3 : ce token suit quelqu'un.
  const leader = leaderOf(token);
  if ( leader ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: leader.name }), run: () => unfollow(token) });
  // §102 : les modules voisins ajoutent aussi leurs entrées sur son propre token (hook `tokenMenu`, `target === token`).
  const all = withNeighbourEntries(entries, token, token, false);
  // Le menu remplace le HUD du cœur au clic droit : son propriétaire (pas seulement le MJ) le retrouve par cette entrée.
  if ( all.length && token.isOwner ) all.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(token.object) });
  return all;
}

/**
 * §107 : sur un familier, « Renvoyer dans sa poche dimensionnelle » (pour qui possède son maître) ; sur le token d'un maître
 * dont la poche garde un familier, « Rappeler X » (son propre token seulement : la case se choisit autour de lui).
 */
function familiarEntries(token, target) {
  const entries = [];
  if ( canPocket(target) ) {
    entries.push({ icon: "fa-solid fa-box-archive", label: loc("Familier.Renvoyer", { name: target.name }), run: () => dismissFamiliar(target) });
  }
  if ( (token === target) && canRecall(token) ) {
    entries.push({ icon: "fa-solid fa-dove", label: loc("Familier.Rappeler", { name: pocketedFamiliar(token).name }), run: () => startRecall(token) });
  }
  return entries;
}

/**
 * §41.3 : suivre cette créature, ou — si elle est à soi (familier, invocation, autre personnage) — lui dire de suivre.
 * Rien sur une créature hostile.
 */
function followEntries(token, target) {
  const entries = [];
  if ( hostileTo(token, target) ) return entries;
  if ( leaderOf(token) === target ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.NePlusSuivre", { name: target.name }), run: () => unfollow(token) });
  else if ( canFollow(token, target) ) entries.push({ icon: "fa-solid fa-person-walking-arrow-right", label: loc("Menu.Suivre", { name: target.name }), run: () => follow(token, target) });
  if ( target.isOwner ) {
    if ( leaderOf(target) === token ) entries.push({ icon: "fa-solid fa-hand", label: loc("Menu.ResteIci", { name: target.name }), run: () => unfollow(target) });
    else if ( canFollow(target, token) ) entries.push({ icon: "fa-solid fa-paw", label: loc("Menu.SuisMoi", { name: target.name }), run: () => follow(target, token) });
  }
  return entries;
}

/**
 * §43.2 : mettre fin, par son action, à un effet que porte une autre créature (contenu `actionEnds`, `by: "other"`) —
 * secouer un dormeur (Sommeil, Motif hypnotique), libérer par un test (Frappe piégeuse). Le token vient au contact d'abord.
 */
function endingEntries(token, target) {
  return endingsOn(target).map(ending => ({
    icon: (ending.rule.verb === "wake") ? "fa-solid fa-bell" : "fa-solid fa-hand-holding-hand",
    label: (ending.rule.verb === "wake") ? loc("Menu.Reveiller", { name: target.name }) : loc("Menu.Liberer", { name: target.name, item: ending.item.name }),
    run: () => endFor(token, target, ending)
  }));
}

function tokenEntries(token, target, { aggressive=true }={}) {
  const entries = [];
  // §16.15 : un objet piloté propose les activités de ses commandes (attaque de l'Arme spirituelle, effets de la Main).
  const pilot = pilotOf(token);
  // Des dégâts sans jet (« Écraser » de la Main agrippante) ne valent que contre la créature que l'objet agrippe.
  const heldByPilot = pilot && grappleEffectsOf(target.actor).some(e => grapplerOf(e)?.uuid === token.actor?.uuid);
  for ( const activity of pilot ? commandActivities(pilot) : [] ) {
    if ( (activity.type === "damage") && !heldByPilot ) continue;
    if ( !aggressive && ["attack", "damage", "save"].includes(activity.type) ) continue;
    const attack = activity.type === "attack";
    entries.push({ icon: attack ? "fa-solid fa-sword" : "fa-solid fa-wand-sparkles",
      label: loc(attack ? "Menu.Attaquer" : "Menu.Utiliser", { name: commandLabel(activity) }),
      run: event => engageWith(token, target, activity, { event }) });
  }
  if ( pilot ) {   // ni arme, ni mains nues, ni Lutte : un objet n'a que ses commandes
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    return entries;
  }
  // §16.44 : sur une créature neutre ou amicale, rien d'offensif (Maj, menu ouvert, pour le montrer).
  if ( !aggressive ) {
    // Relâcher n'a rien d'offensif : il reste sous la main, même sur une créature amicale.
    if ( holdsOf(token, target).length ) entries.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
    entries.push(...endingEntries(token, target));
    entries.push(...followEntries(token, target));
    entries.push(...familiarEntries(token, target));
    entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
    if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
    return entries;
  }
  for ( const { activity, melee } of weaponAttacks(token.actor) ) {
    entries.push({ icon: melee ? "fa-solid fa-sword" : "fa-solid fa-bow-arrow",
      label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }) });
    // §15.2 : une arme Légère offre le mode « main secondaire » de dnd5e (action Bonus, ou Coup double).
    if ( activity.item.system.attackModes?.some(m => m.value === "offhand") ) {
      entries.push({ icon: "fa-solid fa-hand-back-fist",
        label: loc("Menu.MainSecondaire", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "offhand", event }) });
    }
    if ( canBeThrown(activity) ) {
      entries.push({ icon: "fa-solid fa-hand-point-right",
        label: loc("Menu.Lancer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { mode: "thrown", event }) });
    }
  }
  // §16.43 : l'action suivante d'un lien (Trait ensorcelé : 1d12, action Bonus), sur la créature liée.
  for ( const item of tetherItems(token.actor) ) {
    const activity = item.system.activities?.get(tetherRuleOf(item)?.activity ?? "");
    if ( activity && (tetheredToken(item) === target) ) {
      entries.push({ icon: "fa-solid fa-bolt", label: loc("Menu.Utiliser", { name: item.name }), run: event => engageWith(token, target, activity, { event }) });
    }
  }
  // §16.41 : une arme de sort invoquée (Lame de feu), tant que sa trace est là.
  for ( const activity of traceAttacks(token.actor) ) {
    entries.push({ icon: "fa-solid fa-fire", label: loc("Menu.Attaquer", { name: activity.item.name }), run: event => engageWith(token, target, activity, { event }) });
  }
  // §15.2 : l'attaque à mains nues et sa Lutte / Bousculade (la nôtre, ou celle d'une classe), sur une autre créature.
  // §16.44 : un seul bouton, qui ouvre le choix (attaque à mains nues, Lutte, Bousculade : à terre, Bousculade : repoussé).
  const unarmed = unarmedAttackOf(token.actor);
  const grapple = grappleShoveOf(token.actor);
  const bare = [];
  if ( unarmed ) bare.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNues"), run: event => engageWith(token, target, unarmed, { event }) });
  // §18.23 : une créature qu'on agrippe déjà ne se ré-agrippe pas — la Lutte laisse place à « Relâcher ».
  const holding = holdsOf(token, target).length > 0;
  if ( holding ) bare.push({ icon: "fa-solid fa-hand-holding", label: loc("Menu.Relacher"), run: () => releaseGrapple(token, target) });
  for ( const profile of grapple?.effects ?? [] ) {
    const name = profile.effect?.name;
    if ( !name ) continue;
    if ( holding && profile.effect.statuses?.has("grappled") ) continue;
    bare.push({ icon: "fa-solid fa-hands", label: name, run: event => engageWith(token, target, grapple, { event, choice: profile._id }) });
  }
  if ( bare.length === 1 ) entries.push(bare[0]);
  else if ( bare.length ) entries.push({ icon: "fa-solid fa-hand-fist", label: loc("Menu.MainsNuesChoix"), run: event => openMenu(event, bare) });
  // §18.22 : Soutien (partie attaque), en combat, sur un ennemi — s'avancer jusqu'à lui s'il est atteignable ce tour-ci.
  const help = helpActivityOf(token.actor);
  if ( help && inCombat() && hostileTo(token, target) ) {
    entries.push({ icon: "fa-solid fa-handshake-angle", label: loc("Menu.Soutien"), run: event => engageWith(token, target, help, { event }) });
  }
  entries.push(...endingEntries(token, target));
  entries.push(...followEntries(token, target));
  entries.push(...familiarEntries(token, target));
  entries.push({ icon: "fa-solid fa-eye", label: loc("Menu.Observer"), run: () => observe(target) });
  if ( game.user.isGM ) entries.push({ icon: "fa-solid fa-gear", label: loc("Menu.Hud"), run: () => canvas.hud.token.bind(target.object) });
  return entries;
}

/* -------------------------------------------- */
/*  Souris                                      */
/* -------------------------------------------- */

const onBoard = event => !!canvas.ready && (event.target === canvas.app?.view);
const plain = event => !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
/** Un clic d'attaque accepte Alt et Ctrl : ce sont les touches d'avantage et de désavantage de dnd5e (§15.1). */
const attackClick = event => !event.shiftKey && !event.metaKey;

/** Une touche d'avantage ou de désavantage de dnd5e (réglable dans ses raccourcis) est-elle tenue ? */
function keyHeld(event, action) {
  try { return !!event && dnd5e.utils.areKeysPressed(event, action); }
  catch { return false; }
}

/**
 * Les touches que le jet lira : celles tenues maintenant (dnd5e consulte aussi le clavier au moment du
 * jet) et, en mode visée, celles du clic qui a choisi l'action (fiche, barre d'actions), que l'utilisation
 * suspendue emporte jusqu'au jet.
 */
function heldKeys(event) {
  const origin = targeting?.usage?.[0]?.event;
  return {
    advantage: keyHeld(event, "skipDialogAdvantage") || keyHeld(origin, "skipDialogAdvantage"),
    disadvantage: keyHeld(event, "skipDialogDisadvantage") || keyHeld(origin, "skipDialogDisadvantage")
  };
}
const selecting = () => canvas.tokens?.active && (ui.controls?.tool?.name ?? game.activeTool ?? "select") === "select";
const scenePoint = event => canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });

function clickMoveAllowed() {
  const mode = setting("clickToMove");
  return (mode === "always") || ((mode === "combat") && inCombat());
}

/**
 * Le clic d'attaque vaut-il maintenant ? Réglage « always » / « combat » / « off » (§100) ; une valeur booléenne enregistrée
 * avant (case à cocher, vraie = en combat seulement) est relue comme telle.
 */
function clickAttackAllowed() {
  let mode = setting("clickToAttack");
  // Relue en texte par un réglage devenu String (« true » / « false », vu le 2026-10-06), ou en booléen.
  if ( (mode === true) || (mode === "true") ) mode = "combat";
  else if ( (mode === false) || (mode === "false") ) mode = "off";
  return (mode === "always") || ((mode === "combat") && inCombat());
}

function clickAttackApplies(me, other) {
  // §110 : chez le MJ, le clic gauche sur un token reste celui du cœur (sélection) ; ses actions passent par le clic droit.
  if ( game.user.isGM ) return false;
  return clickAttackAllowed() && hostileTo(me, other) && !!basicAttack(me.actor);
}

let down = null;
const LONG_PRESS_MS = 350;

function swallow(event) {
  event.stopImmediatePropagation();
  event.preventDefault();
}

/** Une action en cours qu'un clic droit annulerait (hors mode visée) : dialogue de légalité, jet pas encore lancé. */
const cancellable = () => (openLegalityDialogs().length > 0) || !!pendingRoll();

/** Clic droit (§15.1) : le dialogue de légalité se ferme (« Renoncer »), ou le jet pas encore lancé est annulé. */
async function cancelInProgress() {
  if ( await closeLegalityDialogs() ) return ui.notifications.info(loc("Visee.Annulee"));
  await cancelPendingRoll();
}

/**
 * Le cœur planifie un déplacement (téléportation native de dnd5e, §16.10 : Token#planMovement pose
 * `canvas.tokens._movementPlanningContext`) : ses clics valident la destination, la souris du moteur s'efface.
 */
const corePlanning = () => !!canvas?.tokens?._movementPlanningContext;

function onPointerDown(event) {
  // §67 ter : pendant la visée d'une téléportation, un clic gauche au sol choisit la destination (le cœur n'accepte qu'un glisser
  // du token, qui reste possible : un clic sur le token lui-même est laissé au cœur).
  const tp = currentTeleport();
  if ( tp && corePlanning() && (event.button === 0) && onBoard(event) && (hoveredToken()?.id !== tp.token.id) ) {
    down = null;
    teleportClick(scenePoint(event));
    return;
  }
  if ( corePlanning() || placing ) { down = null; return; }
  if ( menu && !menu.contains(event.target) ) closeMenu();
  hideHitChance();
  lastHoverKey = null;
  down = null;
  if ( !onBoard(event) || ![0, 2].includes(event.button) ) return;
  down = { x: event.clientX, y: event.clientY, button: event.button, at: Date.now() };
  if ( targeting || picking || dashing || recalling || ((event.button === 2) && cancellable()) ) return swallow(event);
  // §39.3 : un module voisin peut réclamer un clic gauche (fouiller un coffre, un cadavre, un tas au sol — Darsh Loot) en
  // répondant `false` au hook `dnd5e-combat.claimClick` (appelé par Hooks.call) : le moteur l'ignore alors entièrement (ni
  // déplacement, ni attaque). Le moteur ne connaît aucun de ces modules ; sans eux, rien ne change.
  if ( (event.button === 0) && (Hooks.call(`${MODULE_ID}.claimClick`, event) === false) ) { down = null; return; }
  const me = actingToken();
  const hover = hoveredToken();
  // Clic droit sur son propre token agrippé ou objet piloté : le menu (S'échapper, Renvoyer) au lieu du HUD du cœur.
  if ( me && (hover === me) && (event.button === 2) && plain(event) && selecting() && hasSelfMenu(me) ) return swallow(event);
  // §18.24 : clic droit sur une porte, un token en main — le menu de porte au lieu du verrou du cœur (MJ).
  if ( me && !hover && (event.button === 2) && plain(event) && selecting() && hoveredDoor() ) return swallow(event);
  // §18.25 : clic gauche sur une porte, quand un clic déplace — s'avancer puis l'ouvrir ou la fermer, pas l'ouvrir de loin.
  if ( me && !hover && (event.button === 0) && plain(event) && selecting() && hoveredDoor() && clickMoveAllowed() ) return swallow(event);
  if ( !me || !hover || (hover === me) || !selecting() ) return;
  // Le moteur prend ce clic : ni sélection du token visé (MJ), ni HUD de token.
  if ( ((event.button === 2) && plain(event)) || ((event.button === 0) && attackClick(event) && clickAttackApplies(me, hover)) ) swallow(event);
}

function onPointerUp(event) {
  const start = down;
  down = null;
  if ( corePlanning() || placing ) return;
  if ( !start || (start.button !== event.button) || !onBoard(event) ) return;
  if ( Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ) return;   // c'était un glisser
  // Un appui long est le ping du cœur (500 ms) : ce n'est pas un ordre de déplacement.
  if ( !targeting && !picking && !dashing && !recalling && ((Date.now() - start.at) > LONG_PRESS_MS) ) return;
  if ( !targeting && !picking && (event.button === 2) && cancellable() ) return exclusive(cancelInProgress);
  const hover = hoveredToken();
  const left = event.button === 0;

  if ( dashing ) {
    if ( !left ) { stopTargeting(); return ui.notifications.info(loc("Visee.Annulee")); }
    return dashTo(scenePoint(event));
  }
  if ( recalling ) {
    if ( !left ) { stopTargeting(); return ui.notifications.info(loc("Visee.Annulee")); }
    return recallTo(scenePoint(event));
  }
  if ( picking ) {
    if ( !left ) { for ( const t of Array.from(game.user.targets) ) t.setTarget(false, { releaseOthers: false }); stopTargeting(); return ui.notifications.info(loc("Visee.Annulee")); }
    return pickTarget(hover);
  }
  if ( targeting ) {
    if ( !left ) { stopTargeting(); return ui.notifications.info(loc("Visee.Annulee")); }
    if ( !hover ) return;
    // §16.29 : un refus (hors de portée, rebond impossible) laisse la visée ouverte.
    const refusal = refusalFor(targeting.token, hover, targeting.activity, targeting.usage?.[0]);
    if ( refusal ) return floatNotice(hover, refusal, "refused");
    const { token, activity, usage } = targeting;
    stopTargeting();
    return exclusive(() => engageWith(token, hover, activity, { usage, event }));
  }

  const me = actingToken();
  if ( !me || !selecting() ) return;
  // §99 : le token marche encore — un clic gauche au sol l'envoie ailleurs, sur un ennemi l'y fait attaquer, tout autre clic
  // l'arrête sur place.
  if ( busy ) {
    const point = scenePoint(event);
    if ( left && hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      if ( interruptWalk(me, () => engageWith(me, hover, basicAttack(me.actor).activity, { event })) ) return;
    }
    else if ( left && !hover && plain(event) && clickMoveAllowed() ) {
      if ( interruptWalk(me, () => moveTo(me, point)) ) { lastHoverKey = null; return; }
    }
    else if ( interruptWalk(me) ) return;
  }
  if ( left ) {
    if ( hover && (hover !== me) && attackClick(event) && clickAttackApplies(me, hover) ) {
      return exclusive(() => engageWith(me, hover, basicAttack(me.actor).activity, { event }));
    }
    const door = (!hover && plain(event) && clickMoveAllowed()) ? hoveredDoor() : null;
    if ( door ) return exclusive(() => setDoorOpen(me, door, doorState(door) !== "open"));
    // §41.2 : un escalier — on le prend d'un clic (un seul niveau au bout), ou l'on choisit le niveau (ascenseur).
    const steps = (!hover && plain(event)) ? stairsEntries(me, scenePoint(event)) : [];
    if ( steps.length === 1 ) { lastHoverKey = null; return exclusive(() => steps[0].run(event)); }
    if ( steps.length > 1 ) return openMenu(event, steps);
    if ( !hover && plain(event) && clickMoveAllowed() ) { lastHoverKey = null; return exclusive(() => moveTo(me, scenePoint(event))); }
    return;
  }
  if ( !plain(event) ) return;
  if ( hover && (hover === me) && hasSelfMenu(me) ) return openMenu(event, selfEntries(me));
  if ( hover && (hover !== me) ) return openTokenMenu(event, me, hover);
  const door = hover ? null : hoveredDoor();
  if ( door ) return openMenu(event, doorEntries(me, door));
  if ( !hover ) openMenu(event, groundEntries(me, scenePoint(event)));
}

/* ---- aperçu du chemin, en combat ---- */

let lastHoverKey = null;
let previewed = null;

function clearPreview() {
  if ( previewed ) previewPath(previewed, null);
  previewed = null;
  lastHoverKey = null;
  hideHitChance();
  setCursor(null);
}

/**
 * Curseur selon ce qu'un clic ferait (§15.3) : se déplacer, attaquer au contact ou à distance, lancer
 * un sort, hors de portée, impossible. Un attribut sur `body`, que la feuille de style traduit en
 * curseur SVG du module sur le canevas (`#board`). null : le curseur de Foundry (ou la mire de la visée).
 */
function setCursor(kind) {
  const wanted = (kind && setting("situationalCursor")) ? kind : null;
  if ( (document.body.dataset.dnd5eCombatCursor ?? null) === wanted ) return;
  if ( wanted ) document.body.dataset.dnd5eCombatCursor = wanted;
  else delete document.body.dataset.dnd5eCombatCursor;
}

/**
 * Survol : aperçu du chemin (en combat) et chance de toucher (§15.3) quand un clic sur ce token
 * lancerait une attaque — attaque de base en combat, ou activité en attente en mode visée. Si le
 * clic ferait d'abord approcher, la chance est calculée depuis la case d'arrivée, comme `engage`.
 */
/**
 * §16.29 : ce qu'un clic sur cette créature donnerait, hors du corps à corps (qui s'approche) — null si rien ne s'y oppose,
 * sinon le texte du refus (« Hors de portée », « Hors de vue », ou celui du rebond : « Déjà visé… », « … à plus de 30 ft »).
 */
/** Le token sous la souris. */
function hoveredToken() {
  return canvas.tokens.hover?.document ?? null;
}

function refusalFor(me, hover, activity, usageConfig=null) {
  const wrongTarget = targetTypeRefusal(me, hover, activity);
  if ( wrongTarget ) return wrongTarget;
  // §16.43 : l'action suivante d'un lien (Trait ensorcelé) ne vise que la créature liée.
  if ( tetherOfActivity(activity)?.role === "follow" ) {
    const bound = tetheredToken(activity.item);
    if ( !bound || (bound !== hover) ) return loc("Retour.PasLiee");
  }
  // §21 : Enchaînement — seulement une créature à 1,50 m de la première et à l'allonge (adapter/mastery.mjs).
  const cleave = usageConfig?.[MODULE_ID]?.cleave;
  if ( cleave ) {
    const first = fromUuidSync(cleave, { strict: false });
    if ( !first || !cleaveCandidates(me, first, activity).includes(hover) ) return loc("Botte.Enchainement.Refus");
  }
  const leap = usageConfig?.[MODULE_ID]?.leap;
  if ( leap ) {
    const problem = leapProblem(activity, leap, hover);
    if ( problem ) return problem.replace(/^[^:]*:\s*/, "");
  }
  const contact = contactRefusal(me, hover, activity);
  if ( contact ) return contact;
  if ( approaches(activity) ) return null;
  const status = rangeStatus(me, hover, activity);
  if ( status?.out ) return loc("Retour.HorsDePortee");
  if ( status?.blind ) return loc("Retour.NonVue");
  return null;
}

/** La case d'arrivée d'une ruée sous ce point : le coin haut-gauche d'un token de sa taille, centré sur le point. */
function dashCell(point) {
  const grid = dashing.token.parent.grid;
  return grid.getTopLeftPoint(cellUnder(dashing.token, point));
}

/** §57 : au survol, ce qui refuse la case, ou les créatures que la ruée toucherait. */
function dashHover(event) {
  const at = dashCell(scenePoint(event));
  const key = `dash|${at.x},${at.y}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal ) {
    setCursor("outOfRange");
    return showBadge(event, refusal.short);
  }
  setCursor(null);
  const names = dashPreview(dashing.activity, at).map(t => t.name);
  showBadge(event, names.length ? names.join(", ") : loc("Ruee.Personne"));
}

/** §57 : un clic sur la case d'arrivée — refusée, la visée reste ouverte ; acceptée, la ruée part. */
function dashTo(point) {
  const at = dashCell(point);
  const refusal = dashRefusal(dashing.activity, at);
  if ( refusal ) { ui.notifications.warn(refusal.text); return floatNotice(dashing.token, refusal.short, "refused"); }
  const { activity, usage } = dashing;
  stopTargeting();
  return exclusive(() => dashStrike(activity, usage, at)).catch(err => console.error(`${MODULE_ID} | ruée`, err));
}

/** §107 : au survol, ce qui refuse la case de réapparition du familier, ou son nom. */
function recallHover(event) {
  const point = scenePoint(event);
  const cell = recalling.token.parent.grid.getOffset(point);
  const key = `recall|${cell.i},${cell.j}`;
  if ( key === lastHoverKey ) return;
  lastHoverKey = key;
  const refusal = recallRefusal(recalling.token, point);
  setCursor(refusal ? "outOfRange" : null);
  showBadge(event, refusal ?? pocketedFamiliar(recalling.token)?.name ?? "");
}

/** §107 : la case du familier qui revient — refusée, la visée reste ouverte ; acceptée, il réapparaît. */
function recallTo(point) {
  const { token } = recalling;
  const refusal = recallRefusal(token, point);
  if ( refusal ) return floatNotice(token, refusal, "refused");
  stopTargeting();
  return exclusive(() => recallFamiliar(token, point));
}

/** §107 : « Rappeler » — la case se choisit d'un clic (9 m autour du maître), clic droit ou Échap pour renoncer. */
function startRecall(token) {
  if ( !canvas.ready || !token?.object ) return;
  stopTargeting();
  const familiar = pocketedFamiliar(token);
  ui.notifications.info(loc("Familier.Choisir", { name: familiar?.name ?? "" }));
  recalling = { token };
  document.body.classList.add("dnd5e-combat-targeting");
}

/** §16.29 : pendant le choix de la destination d'une téléportation (cœur), la portée se lit au curseur. */
function teleportHover(event) {
  const tp = currentTeleport();
  if ( !tp || !corePlanning() || !tp.token?.parent || (tp.limit === null) ) return false;
  const grid = tp.token.parent.grid;
  const cell = cellUnder(tp.token, scenePoint(event));
  const at = grid.getTopLeftPoint(cell);
  const far = distanceBetween(tp.token, tp.token, { posB: { x: at.x, y: at.y } }).value > tp.limit + 1e-6;
  setCursor(far ? "outOfRange" : null);
  if ( far ) showBadge(event, loc("Retour.HorsDePortee"));
  else hideHitChance();
  return true;
}

const onPointerMove = foundry.utils.throttle(event => {
  if ( onBoard(event) && teleportHover(event) ) return;
  if ( dashing ) return onBoard(event) ? dashHover(event) : undefined;
  if ( recalling ) return onBoard(event) ? recallHover(event) : undefined;
  if ( busy || !onBoard(event) || event.buttons || !selecting() ) return clearPreview();
  // §16.14 : la pose du cœur montre la zone sous la souris — ni chemin ni chance de toucher.
  if ( placing ) return clearPreview();
  const me = picking?.token ?? targeting?.token ?? actingToken();
  if ( !me?.object || me.object.animationContexts?.has(me.object.movementAnimationName) ) return clearPreview();
  const hover = hoveredToken();
  const point = scenePoint(event);
  const cell = cellUnder(me, point);
  const keys = heldKeys(event);
  // §41.2 : le bord d'un escalier peut couper une case — le curseur suit le point, pas la case.
  const onStairs = !hover && !targeting && !picking && (stairsDestinations(me, point).length > 0);
  const id = `${me.id}|${hover?.id ?? ""}|${cell.i},${cell.j}|${(picking ?? targeting)?.activity.uuid ?? ""}|${picking?.picks.length ?? ""}|${keys.advantage}${keys.disadvantage}|${onStairs}`;
  if ( id === lastHoverKey ) return;
  lastHoverKey = id;

  const preview = inCombat() && setting("pathPreview");
  let plan = null;
  let cursor = null;
  hideHitChance();
  if ( !hover || (hover === me) ) setReticleRefused(false);
  // En mode visée, le lanceur est une cible comme une autre (Invisibilité sur soi) : son type de cible en décide.
  if ( hover && ((hover !== me) || targeting || picking) ) {
    const activity = (picking ?? targeting)?.activity ?? (clickAttackApplies(me, hover) ? basicAttack(me.actor).activity : null);
    // §16.29 : hors du corps à corps, pas d'approche — la portée se lit telle quelle, et un refus s'annonce au curseur.
    const refusal = activity ? refusalFor(me, hover, activity, targeting?.usage?.[0]) : null;
    setReticleRefused(!!refusal);
    if ( refusal ) {
      setCursor(refusal === loc("Retour.HorsDePortee") ? "outOfRange" : "invalid");
      showBadge(event, refusal);
      if ( previewed ) previewPath(previewed, null);
      previewed = null;
      return;
    }
    const reach = activity ? reachCells(activity) : null;
    const gap = reach ? footprintGap(footprintOf(me), footprintOf(hover)) : 0;
    const far = !!reach && (gap > reach.normal) && approaches(activity);
    if ( far ) plan = planPath(me, { target: hover, reachCells: reach.normal }, { maxCost: movementCap(me) });
    // Comme `engage` : hors de portée si l'approche n'arrive pas et que la cible est au-delà de la portée longue.
    // §18.22 : un geste de contact (mains nues, Lutte, Soutien) n'avance que s'il arrive.
    const outOfReach = far && !plan?.arrives && (contactAction(activity) || (gap > reach.long));
    if ( activity?.type === "attack" ) {
      const end = (far && plan?.arrives) ? plan.waypoints.at(-1) : null;
      showHitChance(event, me, hover, activity, { posA: end ? positionOf(end) : undefined, outOfReach, keys });
    }
    // §15.3 : une sauvegarde — la chance que la cible la rate (le mode visée ne vise qu'avec une activité choisie).
    else if ( activity?.type === "save" ) showSaveChance(event, me, hover, activity, { outOfReach });
    if ( activity ) {
      cursor = outOfReach ? "outOfRange"
        : (activity.type !== "attack") ? "spell"
        : (activity.attack?.type?.value === "ranged") ? "ranged" : "melee";
    }
  }
  else if ( hover && (targeting || picking) ) cursor = "invalid";   // soi-même, en mode visée
  else if ( !hover && !targeting && hoveredDoor() ) cursor = null;   // §18.25 : l'icône de porte garde le curseur du cœur
  // §41.2 : un escalier que le token peut prendre — le clic l'y mène, que le clic-déplacement soit actif ou non.
  else if ( onStairs ) {
    cursor = "stairs";
    if ( preview ) {
      const stairs = stairsEntry(me, cell);
      plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    }
  }
  else if ( !hover && !targeting && clickMoveAllowed() ) {
    // §18.26 : sur un escalier, l'aperçu va jusqu'à la case voisine (le dernier pas y entre en marchant).
    const stairs = preview ? stairsEntry(me, cell) : null;
    if ( preview ) plan = planPath(me, stairs ? { cells: stairs.around, level: stairs.level } : { cell }, { maxCost: movementCap(me), throughDoors: true });
    // En combat, on sait si le clic mènera quelque part : aucun chemin, ou plus de déplacement ce tour.
    cursor = (preview && (!plan || (!plan.waypoints.length && !plan.arrives))) ? "invalid" : "move";
  }
  setCursor(cursor);
  if ( !preview ) {
    if ( previewed ) previewPath(previewed, null);
    previewed = null;
    return;
  }
  if ( previewed && (previewed !== me) ) previewPath(previewed, null);
  previewPath(me, plan);
  previewed = plan ? me : null;
}, 60);

/** Alt ou Ctrl pressé ou relâché sans bouger la souris : la chance affichée suit (après que Foundry a noté la touche). */
let lastPointer = null;
function onModifierKey(event) {
  if ( !["Alt", "Control", "Meta", "OS"].includes(event.key) || !lastPointer ) return;
  setTimeout(() => onPointerMove({ target: lastPointer.target, clientX: lastPointer.clientX, clientY: lastPointer.clientY,
    buttons: 0, altKey: event.type === "keydown" ? event.altKey || event.key === "Alt" : event.altKey && event.key !== "Alt",
    ctrlKey: event.type === "keydown" ? event.ctrlKey || event.key === "Control" : event.ctrlKey && event.key !== "Control",
    shiftKey: event.shiftKey, metaKey: event.metaKey }), 0);
}

function onKeyDown(event) {
  onModifierKey(event);
  // §16.33 : Entrée lance un sort de groupe avec les créatures déjà choisies (« jusqu'à cinq créatures »).
  if ( (event.key === "Enter") && picking?.group && picking.picks.length ) { swallow(event); return finishGroup(); }
  if ( event.key !== "Escape" ) return;
  if ( menu ) { closeMenu(); swallow(event); }
  else if ( targeting || picking || dashing || recalling ) { stopTargeting(); swallow(event); }   // une zone en cours de pose : Échap est au cœur
}

/* -------------------------------------------- */
/*  Cibles relâchées                            */
/* -------------------------------------------- */

function releaseTargets() {
  if ( !setting("releaseTargets") ) return;
  for ( const token of Array.from(game.user.targets) ) token.setTarget(false, { releaseOthers: false });
}

/** Une action jugée (attaque touchée et dégâts appliqués, ratée, sauvegardes réglées) : son auteur relâche ses cibles. */
const released = new Set();
function onResolutionSettled(message) {
  if ( !message.author?.isSelf || released.has(message.id) ) return;
  const resolution = message.getFlag(MODULE_ID, "resolution");
  if ( !["done", "missed"].includes(resolution?.step) ) return;
  released.add(message.id);
  releaseTargets();
  if ( resolution.step === "done" ) offerBonusAttack(message, resolution);
  if ( resolution.step === "done" ) offerCleave(message, resolution);
  if ( message.getFlag(MODULE_ID, "flurry") ) offerFlurry(message.getAssociatedActor?.());
  if ( resolution.step === "done" ) offerLeap(message, resolution);
}

/**
 * §21 : Enchaînement (botte d'arme) — l'attaque au corps à corps a touché et le jet portait la botte : la visée s'ouvre chez
 * l'auteur pour une seconde attaque avec la même arme, sans coût, contre une créature à 1,50 m de la première et à l'allonge.
 * Une fois par tour de combat. Clic droit pour y renoncer.
 */
function offerCleave(message, resolution) {
  if ( !resolution.plan?.attack || message.getFlag(MODULE_ID, "cleave") ) return;
  const attackMessage = game.messages.get(resolution.attack?.messageId ?? "");
  if ( masteryOf(attackMessage) !== "cleave" ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.type !== "attack") || cleaveSpent(actor) ) return;
  const mode = attackMessage.rolls?.[0]?.options?.attackMode ?? "";
  if ( (activity.attack?.type?.value !== "melee") || mode.includes("thrown") || (mode === "ranged") ) return;
  const hit = resolution.targets.find(t => t.hit);
  const first = hit ? fromUuidSync(hit.token, { strict: false }) : null;
  const { scene, token: tokenId } = attackMessage.speaker ?? {};
  const token = game.scenes.get(scene)?.tokens.get(tokenId) ?? null;
  if ( !first || !token?.object || !cleaveCandidates(token, first, activity).length ) return;
  stopTargeting();
  targeting = { token, activity, usage: [{ [MODULE_ID]: { cost: "free", cleave: first.uuid } }, { configure: false }, {}] };
  document.body.classList.add("dnd5e-combat-targeting");
  ui.notifications.info(loc("Botte.Enchainement.Visee", { item: activity.item.name, name: first.name }));
  floatNotice(token, loc("Botte.Retour.cleave"));
  showReticle(loc("Botte.Retour.cleave"));
}

/**
 * §24 : Déluge de coups — tant qu'il reste des frappes gratuites au budget du tour, la visée de la frappe à mains nues s'ouvre chez
 * l'auteur : après l'activation du Déluge, puis après chaque frappe résolue. Clic droit pour y renoncer.
 */
function offerFlurry(actor) {
  const combatant = actor ? combatantFor(actor) : null;
  if ( !combatant || !isOwnTurn(combatant) || !((readBudget(combatant)?.flurry ?? 0) > 0) ) return;
  // §27 : Prêtre de guerre — l'attaque ouverte se fait avec l'arme de corps à corps équipée, sinon à mains nues.
  const weapon = readBudget(combatant).flurryAny
    ? actor.items.find(i => (i.type === "weapon") && i.system.equipped && (i.system.identifier !== "unarmed-strike")) : null;
  const strike = weapon ?? actor.items.find(i => i.system?.identifier === "unarmed-strike");
  const activity = strike?.system.activities?.find(a => a.type === "attack");
  const token = combatant.token;
  if ( !activity || !token?.object ) return;
  stopTargeting();
  targeting = { token, activity, usage: [{}, { configure: false }, {}] };
  document.body.classList.add("dnd5e-combat-targeting");
  const label = weapon ? "Clerc.PretreGuerre" : "Moine.Deluge";
  ui.notifications.info(loc(`${label}.Visee`, { n: readBudget(combatant).flurry }));
  floatNotice(token, loc(`${label}.Retour`));
  showReticle(loc(`${label}.Retour`));
}

/** §24 : l'activation du Déluge de coups (carte d'utilisation de l'auteur) : la première frappe se vise aussitôt, budget écrit. */
function onFlurryUsed(message) {
  if ( (message.type !== "usage") || !message.author?.isSelf ) return;
  const activity = message.getAssociatedActivity?.();
  const rule = activity?.item ? contentOf(activity.item).entry?.flurry : null;
  if ( !rule || (rule.activity !== activity.id) ) return;
  // Le budget est écrit par le MJ actif juste après la carte : on lui laisse un instant.
  setTimeout(() => offerFlurry(activity.actor), 800);
}

/**
 * §23 : Frappe assurée — « vous faites une attaque avec l'arme utilisée pour lancer le sort » : dès que l'enchantement (contenu
 * `oneAttack`) est posé sur l'arme, la visée de son attaque s'ouvre chez celui qui joue la créature (le joueur connecté, sinon le
 * MJ actif), sans coût — le sort a payé l'action. L'enchantement tombe après l'attaque (runtime/cantrips.mjs).
 */
function offerEnchantedAttack(effect) {
  const weapon = effect.parent;
  const actor = weapon?.actor;
  if ( (weapon?.documentName !== "Item") || (weapon.type !== "weapon") || !actor ) return;
  if ( contentOf(originItemOf(effect)).entry?.oneAttack !== true ) return;
  if ( (rollerFor(actor) ?? game.users.activeGM?.id) !== game.user.id ) return;
  const activity = weapon.system.activities?.find(a => a.type === "attack");
  const token = actor.getActiveTokens(true, true)?.[0] ?? null;
  if ( !activity || !token?.object ) return;
  stopTargeting();
  targeting = { token, activity, usage: [{ [MODULE_ID]: { cost: "free" } }, { configure: false }, {}] };
  document.body.classList.add("dnd5e-combat-targeting");
  ui.notifications.info(loc("Visee.AttaqueEnchantee", { item: weapon.name }));
  floatNotice(token, weapon.name);
  showReticle(weapon.name);
}

/**
 * §16.27 : Orbe chromatique — l'attaque a touché et les dés de dégâts montrent un double : la visée s'ouvre chez l'auteur pour
 * faire bondir l'orbe (même activité, sans emplacement ni action, même type de dégâts, au niveau du lancement). La cible est
 * validée à l'utilisation (runtime/projectiles.mjs) : à 9 m de la dernière, jamais visée. Clic droit pour y renoncer.
 */
function offerLeap(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const hit = resolution.targets.find(t => t.hit);
  if ( !hit ) return;
  const usage = game.messages.get(resolution.origin ?? message.id) ?? message;
  const activity = usage.getAssociatedActivity?.();
  const rule = leapOf(activity?.item);
  if ( !rule || !rolledDouble(game.messages.get(resolution.damageRoll?.messageId ?? "")) ) return;
  const prior = usage.getFlag(MODULE_ID, "leap");
  const first = prior?.of ? (game.messages.get(prior.of) ?? usage) : usage;
  const left = prior ? prior.left : evalRuleFormula(rule.max, first.getAssociatedActivity?.({ scaled: true }), 1);
  if ( !(left > 0) ) return;
  const token = activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !token?.object ) return;
  const level = activity.item.system.level ?? 0;
  const scaling = Number(first.system?.scaling) || 0;
  const leap = { of: first.id, from: hit.token, chain: [...(prior?.chain ?? []), ...resolution.targets.map(t => t.token)], left: left - 1 };
  const config = {
    consume: { spellSlot: false }, concentration: { begin: false },
    ...(level > 0 ? { scaling, spell: { slot: `spell${level + scaling}` } } : {}),
    [MODULE_ID]: { cost: "free", leap }
  };
  const damageType = usage.getFlag(MODULE_ID, "damageType");
  const flags = { leap, ...(damageType ? { damageType } : {}) };
  stopTargeting();
  targeting = { token, activity, usage: [config, { configure: false }, { data: { flags: { [MODULE_ID]: flags } } }] };
  document.body.classList.add("dnd5e-combat-targeting");
  log(`${activity.item.name} : double aux dés, rebond proposé (${left} possible(s))`);
  floatNotice(hit.token, loc("Retour.Rebond"));
  showReticle(loc("Retour.Rebond"));
  ui.notifications.info(loc("Rebond.Visee", { item: activity.item.name, left }));
}

/**
 * §16.26 : Taille (Maître d'armes lourdes) — après un coup critique, ou une créature tombée à 0 PV, d'une arme (de corps à
 * corps si la règle le dit), sur le client de l'auteur : la visée s'ouvre pour attaquer de nouveau avec la même arme, pour
 * l'action Bonus (`cost: "bonus"`, que la légalité et le budget lisent). À son tour, en combat, l'action Bonus encore là ;
 * clic droit pour y renoncer.
 */
function offerBonusAttack(message, resolution) {
  if ( !resolution.plan?.attack ) return;
  const activity = message.getAssociatedActivity?.();
  const actor = activity?.actor;
  if ( !actor || (activity.item?.type !== "weapon") || (activity.type !== "attack") ) return;
  const critical = resolution.targets.some(t => t.hit && t.critical);
  const felled = (resolution.log ?? []).some(l => (l.at === "applyDamage") && !l.kind && (l.before?.value > 0) && (l.after?.value === 0));
  const attackMode = game.messages.get(resolution.attack?.messageId ?? "")?.rolls?.[0]?.options?.attackMode ?? "";
  const melee = (activity.attack?.type?.value === "melee") && !attackMode.includes("thrown") && (attackMode !== "ranged");
  const rule = actor.items.map(i => contentOf(i).entry?.bonusAttack).find(r => r
    && ((critical && r.after.includes("critical")) || (felled && r.after.includes("felled"))) && (!r.melee || melee));
  if ( !rule ) return;
  const combatant = combatantFor(actor);
  if ( !combatant || !isOwnTurn(combatant) || !(readBudget(combatant)?.bonus > 0) ) return;
  const token = combatant.token;
  if ( !token?.object ) return;
  stopTargeting();
  targeting = { token, activity, usage: [{ [MODULE_ID]: { cost: "bonus" } }, { configure: false }, {}] };
  document.body.classList.add("dnd5e-combat-targeting");
  ui.notifications.info(loc("Visee.AttaqueBonus", { item: activity.item.name, why: loc(critical ? "Visee.Critique" : "Visee.Abattu") }));
  floatNotice(token, loc("Retour.Taille"));
  showReticle(loc("Retour.Taille"));
}

/** Fin de tour : celui qui jouait ce combattant relâche ses cibles. */
function onTurnChange(combat, prior) {
  const combatant = combat.combatants.get(prior?.combatantId);
  if ( !combatant?.isOwner || (game.user.isGM && combatant.hasPlayerOwner) ) return;
  releaseTargets();
}

/* -------------------------------------------- */

/**
 * §16.10 : une téléportation de soi (activité native « teleport » à portée « soi », ou item qui la déclare : Foulée
 * brumeuse, Porte dimensionnelle) ouvre la visée de la destination dès l'utilisation, sur le client de celui qui l'a
 * utilisée — le TODO de dnd5e 6 (`_triggerSubsequentActions`, teleport.mjs).
 */
function onPostUseActivity(activity, usageConfig, results) {
  if ( results && stormOf(activity?.item) ) return void stormAfterUse(activity, usageConfig).catch(err => console.error(`${MODULE_ID} | orage`, err));
  if ( !results || !setting("teleportPlanning") || !selfTeleportOf(activity) ) return;
  if ( usageConfig?.subsequentActions === false ) return;   // un appelant qui enchaîne lui-même (connecteur, scénarios)
  teleportSelf(activity).catch(err => console.error(`${MODULE_ID} | téléportation`, err));
}

/**
 * §16.34 : les jets d'attaque, de dégâts et de soins partent sans la fenêtre de configuration de dnd5e (réglage par joueur,
 * activé par défaut) — ceux que dnd5e enchaîne après l'utilisation (activity/attack.mjs:69, heal.mjs:61, damage.mjs:52), depuis
 * la fiche, le HUD ou le bouton de la carte. Avantage et désavantage viennent du moteur ; le mode d'attaque (« lancer ») est
 * présélectionné par runtime/turn.mjs. Les jets que le moteur lance lui-même sont déjà sans fenêtre (adapter/messages.mjs).
 */
function onPreRollDamage(config, dialog) {
  if ( dialog && setting("quickRolls") ) dialog.configure = false;
}

/** À inscrire AVANT `registerTurn()` : la visée suspend une utilisation avant que sa légalité soit jugée. */
export function registerPointer() {
  registerHitChance();
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  client("clickToMove", { type: String, default: "off",
    choices: { always: "DND5ECOMBAT.Reglage.clickToMove.always", combat: "DND5ECOMBAT.Reglage.clickToMove.combat", off: "DND5ECOMBAT.Reglage.clickToMove.off" } });
  client("clickToAttack", { type: String, default: "combat",
    choices: { always: "DND5ECOMBAT.Reglage.clickToAttack.always", combat: "DND5ECOMBAT.Reglage.clickToAttack.combat", off: "DND5ECOMBAT.Reglage.clickToAttack.off" } });
  client("targetingMode", { type: Boolean, default: true });
  client("fastAttack", { type: Boolean, default: true });
  client("quickRolls", { type: Boolean, default: true });
  client("pathPreview", { type: Boolean, default: true });
  client("releaseTargets", { type: Boolean, default: true });
  client("situationalCursor", { type: Boolean, default: true });
  client("closeSheetOnUse", { type: Boolean, default: true });
  client("teleportPlanning", { type: Boolean, default: true });

  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "visée : cible attendue" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "dégâts et soins sans fenêtre" });
  route("dnd5e.preRollAttackV2", onPreRollDamage, { cancellable: true, label: "jet d'attaque sans fenêtre" });
  route("dnd5e.postUseActivity", onPostUseActivity, { label: "téléportation : visée non ouverte" });
  route("dnd5e.preCreateMeasuredTemplate", onPreTemplate, { cancellable: true, label: "cône ou ligne : visée autour du lanceur (carte)" });
  route("updateChatMessage", onResolutionSettled, { label: "cibles relâchées" });
  route("createChatMessage", onResolutionSettled, { label: "cibles relâchées" });
  route("combatTurnChange", onTurnChange, { label: "cibles relâchées en fin de tour" });
  route("combatTurnChange", offerTurnStart, { label: "activité de début de tour proposée" });
  route("createActiveEffect", offerEnchantedAttack, { label: "Frappe assurée : attaque non proposée" });
  route("createChatMessage", onFlurryUsed, { label: "Déluge de coups : visée non ouverte" });
  route("canvasTearDown", () => { stopTargeting(); closeMenu(); previewed = null; lastHoverKey = null; }, { label: "souris : remise à zéro" });
  route("controlToken", () => clearPreview(), { label: "aperçu du chemin effacé" });
  route("ready", () => {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointermove", placeHitChance, { capture: true, passive: true });
    document.addEventListener("pointermove", placeReticle, { capture: true, passive: true });
    document.addEventListener("pointermove", event => { lastPointer = event; }, { capture: true, passive: true });
    document.addEventListener("keyup", onModifierKey, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onMenuShift, true);
    document.addEventListener("keyup", onMenuShift, true);
  }, { label: "souris : écouteurs non posés" });
}
