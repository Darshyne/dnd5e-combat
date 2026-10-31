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

import { theaterActive } from "../runtime/theater-state.mjs";
import { MODULE_ID } from "../constants.mjs";
import { stopWalking, forgetAllWalks, stopDeadMovements } from "../adapter/movement.mjs";
import { stormOf, cloudOf, cloudCircle, boltRadiusPx } from "../adapter/storm.mjs";
import { dressStorm, strike, setBoltAim, freshCloudOf, castStorm } from "../runtime/storm.mjs";
import { clampToCircle } from "../core/storm.mjs";
import { askStorm } from "./storm.mjs";
import { contentOf, rangeUnitsOf, identifierOf } from "../adapter/content.mjs";
import { projectilesOf, projectileCount, targetCount } from "../adapter/projectiles.mjs";
import { concentrationOn } from "../adapter/summons.mjs";
import { engage, castOnTargets, lineDashOf } from "../runtime/actions.mjs";
import { movableZoneOf, moveZone, tooFarForZone } from "../runtime/zones.mjs";
import { castWithPicks } from "../runtime/projectiles.mjs";
import { castLight, putOutLight } from "../runtime/lights.mjs";
import { lightChoiceOf } from "../adapter/lights.mjs";
import { askLightChoice } from "./light.mjs";
import { pickTargetsOf } from "../adapter/pick-targets.mjs";
import { castOnPicked } from "../runtime/pick-targets.mjs";
import { askPickTargets } from "./pick-targets.mjs";
import { askWildForm } from "./wildshape.mjs";
import { isWildShape } from "../adapter/wildshape.mjs";
import { enchantTargetOf } from "../adapter/enchant.mjs";
import { tetherOfActivity, tetheredToken } from "../adapter/tether.mjs";
import { enchantWith, pactWith } from "../runtime/enchant.mjs";
import { askPact } from "./pact.mjs";
import { askEnchantWeapon } from "./enchant.mjs";
import { takeForm } from "../runtime/wildshape.mjs";
import { shapeCenter } from "../core/area.mjs";
import { targetRule, targetRefusal } from "../core/targeting.mjs";
import { relationForTargeting } from "../adapter/factions.mjs";
import { route } from "../runtime/router.mjs";
import { loc, log } from "../runtime/shared.mjs";
import { registerHitChance, hideHitChance, placeHitChance } from "./hitchance.mjs";
import { floatNotice } from "./feedback.mjs";
import { isSpellCast } from "../adapter/scrolls.mjs";
import { potionCastsOnDrinker } from "../adapter/usage.mjs";
import { isPotion } from "../adapter/potions.mjs";
import { chainOf } from "../adapter/chain.mjs";
import { aimedAreaOf, aimedShapeData, aimedRegionData, wallAreaOf, rangedAreaOf, rangedPlacementProblem } from "../adapter/self-area.mjs";
import { castAimed, placeAimed, placeWall } from "../runtime/self-area.mjs";
import { clampPolyline, polylineLength, orthogonalize } from "../core/wall.mjs";
import { closeMenu, onMenuShift, HIGH_JUMP_MENU_SETTING, NONLETHAL_MENU_SETTING } from "./pointer-menu.mjs";
import { cancellable, clearPreview, forgetHover, lastPointer, onKeyDown, onModifierKey, onPointerDown, onPointerMove, onPointerUp, refusalFor, setCursor, trackPointer } from "./pointer-mouse.mjs";
import { clearTargets, leftoverTargets, noteInFlight, offerEnchantedAttack, onFlurryUsed, onPostUseActivity, onPreRollDamage, onResolutionSettled, onTurnChange } from "./pointer-offers.mjs";
export { menuEntriesFor, doorMenuFor, groundMenuFor } from "./pointer-menu.mjs";

export const setting = key => game.settings.get(MODULE_ID, key);
export const inCombat = () => game.combat?.started === true;

/** Le token qui agit : le seul token contrôlé, s'il est à soi. */
export function actingToken() {
  const controlled = canvas.tokens?.controlled ?? [];
  return ((controlled.length === 1) && controlled[0].document.isOwner) ? controlled[0].document : null;
}

/**
 * Une intention à la fois : un second clic pendant qu'une action se joue est ignoré. `generation` : une intention libérée par
 * `releaseMouse` (changement de scène) qui finirait plus tard ne libère pas celle qui l'a remplacée.
 */
export let busy = false;
let running = null;
let generation = 0;
export function exclusive(fn) {
  if ( busy ) return Promise.resolve();
  busy = true;
  const mine = ++generation;
  const current = (async () => {
    try { await fn(); }
    catch(err) { console.error(`${MODULE_ID} | mouse`, err); }
    finally { if ( generation === mine ) { busy = false; running = null; } }
  })();
  running = current;
  return current;
}

/** Le canevas a été démonté pour une autre scène (pas pour un autre niveau de la même). */
let sceneLeft = false;

/**
 * B12 : quand le canevas est démonté pour une autre scène (le MJ change de scène), une marche en cours n'aboutit jamais —
 * le `move` du cœur ou son animation attend un token qui n'est plus affiché — et la souris restait occupée jusqu'au F5.
 * On arrête les marches et on libère la souris.
 */
function releaseMouse() {
  forgetAllWalks();
  generation++;
  busy = false;
  running = null;
}

/**
 * §99 : un clic pendant que le token marche (déplacement, approche d'une attaque, d'une porte) l'arrête à la prochaine case
 * libre — l'intention en cours s'arrête là (pas d'attaque au bout) — puis `then`, s'il y en a un, part comme un nouveau clic.
 * Rend faux si le token ne marchait pas : le clic est alors ignoré, comme tout clic pendant une action.
 */
export function interruptWalk(token, then=null) {
  if ( !busy || !stopWalking(token) ) return false;
  const current = running;
  current.then(() => (then ? exclusive(then) : null));
  return true;
}

export const engageWith = (token, target, activity, options={}) => engage(token, target, activity, { fast: setting("fastAttack"), ...options });

export function observe(target) {
  const actor = target.actor;
  if ( actor?.testUserPermission(game.user, "LIMITED") ) return actor.sheet.render(true);
  ui.notifications.info(target.name);
}

/* -------------------------------------------- */
/*  Mode visée                                  */
/* -------------------------------------------- */

export let targeting = null;
/**
 * §16.27 : visée multiple d'un sort à projectiles (Projectile magique, Rayon ardent, Décharge occulte) — après le choix du
 * niveau, chaque clic sur une créature lui envoie un projectile (la même peut être cliquée plusieurs fois) ; un compteur
 * suit le curseur ; au dernier, le sort part. `{ token, activity, count, picks, usage }`.
 */
export let picking = null;
/** §16.14 : une zone à déplacer attend la case où la poser (`{ activity }`), par la pose du cœur (placeZone). */
export let placing = null;
/** §57 : une ruée en ligne droite (Frappe du vent) attend le clic sur sa case d'arrivée (`{ token, activity, usage }`). */
export let dashing = null;
/** §107 : le rappel d'un familier attend le clic sur la case où il réapparaît (`{ token }` : le token du maître). */
export let recalling = null;
/** Ouvre l'attente du rappel d'un familier (le clic sur la case, `startRecall`). */
export function openRecall(token) {
  recalling = { token };
}
/** Teinte de l'aperçu quand la case est hors de portée du déplacement. */
const TOO_FAR_COLOR = "#d03030";

/** §119 : la consigne de la visée ouverte (le texte de sa notification), que le bandeau garde à l'écran. */
let promptText = null;

/**
 * Fin d'une pose : `placing` n'est remis à null que s'il est encore celui de cette pose. Une pose attend la souris (`await`) ;
 * pendant ce temps une autre visée peut s'ouvrir (`stopTargeting` annule la pose, puis une offre ou un autre sort pose son propre
 * état), que la fin de l'ancienne ne doit pas effacer.
 */
function endPlacing(mine) {
  if ( placing !== mine ) return false;
  placing = null;
  return true;
}

/** §118 : quelle visée est ouverte, pour les voisins. */
function targetingKind() {
  if ( picking ) return picking.group ? "group" : "projectiles";
  if ( targeting ) return "target";
  if ( dashing ) return "dash";
  if ( recalling ) return "recall";
  if ( placing ) return "area";
  return null;
}

/**
 * §118 : la visée que ce client attend, pour les modules voisins (`api.ui.targeting()`) — tant qu'elle est ouverte, le clic
 * gauche est au moteur, quel que soit ce qu'il y a sous la souris (cadavre, coffre, marchand). `{ token, activity, identifier }`
 * (uuids du token qui agit et de l'activité, identifiant dnd5e de son item), ou null.
 * §119 : plus `kind` (`target`, `projectiles`, `group`, `dash`, `recall`, `area`), `item` (nom de l'item), `prompt` (la consigne
 * traduite, ou null), et pour une visée multiple ou de groupe `picked` / `total` (sinon null).
 */
export function pendingTargeting() {
  const open = picking ?? targeting ?? dashing ?? recalling ?? placing;
  if ( !open ) return null;
  return { token: open.token?.uuid ?? null, activity: open.activity?.uuid ?? null,
    identifier: open.activity?.item ? identifierOf(open.activity.item).id : null,
    kind: targetingKind(), item: open.activity?.item?.name ?? null, prompt: promptText,
    picked: picking ? picking.picks.length : null, total: picking ? picking.count : null };
}

/**
 * §118 : publie un changement de visée — hook `dnd5e-combat.targeting`, `(state)` (celui de `pendingTargeting`, null à la
 * fermeture), sur ce client seulement. Différé d'une microtâche : certains chemins posent la classe avant l'état.
 * §119 : aussi à chaque créature choisie ou retirée d'une visée multiple (`picked` change) ; et le bandeau suit.
 */
let announcedTargeting = null;
function announceTargeting() {
  queueMicrotask(() => {
    const state = pendingTargeting();
    if ( !state ) promptText = null;
    renderBanner(state);
    const key = state ? `${state.token}|${state.activity}|${state.kind}|${state.picked}|${state.prompt}` : null;
    if ( key === announcedTargeting ) return;
    announcedTargeting = key;
    Hooks.callAll(`${MODULE_ID}.targeting`, state);
  });
}

/**
 * §119 : la consigne d'une visée qui s'ouvre — gardée par le bandeau tant que la visée dure ; la notification seulement sans
 * bandeau (réglage coupé), pour ne pas l'afficher deux fois.
 */
export function promptTargeting(text) {
  promptText = text;
  if ( !setting("targetingBanner") ) ui.notifications.info(text);
  announceTargeting();
}

/**
 * §119 : bandeau de visée (issue #4 : la notification passe, et rien ne disait plus que le moteur attendait des clics) — en haut
 * de l'écran tant qu'une visée est ouverte : la consigne, et pour une visée multiple le compteur. Réglage par client
 * (`targetingBanner`) ; un voisin qui a son propre affichage peut le masquer (`.dnd5e-combat-banner`) ou le déplacer
 * (variable CSS `--dnd5e-combat-banner-top`). Ne prend aucun clic.
 */
let banner = null;
function renderBanner(state) {
  const text = state?.prompt ?? null;
  if ( !text || !setting("targetingBanner") ) {
    if ( banner ) banner.hidden = true;
    return;
  }
  if ( !banner ) {
    banner = document.createElement("div");
    banner.className = "dnd5e-combat-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `<span class="text"></span><span class="count"></span>`;
  }
  banner.querySelector(".text").textContent = text;
  const count = banner.querySelector(".count");
  count.textContent = Number.isFinite(state.total) ? `${state.picked}/${state.total}` : "";
  count.hidden = !count.textContent;
  banner.hidden = false;
  if ( !banner.isConnected ) document.body.append(banner);
}

export function markTargeting() {
  document.body.classList.add("dnd5e-combat-targeting");
  announceTargeting();
}

/**
 * Ouvre la visée d'une activité : la cible de `token` se choisit d'un clic, puis `activity.use(...usage)`. `prompt` : la consigne du
 * bandeau ; `notice` : un retour flottant au-dessus de `noticeOn` (le token qui agit, d'ordinaire) ; `reticle` : le texte qui suit la
 * souris. `fresh` (par défaut) : la visée en cours se ferme d'abord.
 */
export function openTargeting(token, activity, usage, { prompt, notice=null, noticeOn=token, reticle=null, fresh=true }) {
  if ( fresh ) stopTargeting();
  targeting = { token, activity, usage };
  markTargeting();
  promptTargeting(prompt);
  if ( notice ) floatNotice(noticeOn, notice);
  if ( reticle ) showReticle(reticle);
}

/** Les options de fenêtre d'une utilisation, sans la fenêtre de dnd5e (le choix est déjà fait). */
const noDialog = dialogConfig => ({ ...(dialogConfig ?? {}), configure: false });

/** Qui l'activité vise d'un clic (core/targeting.mjs), ou null si elle ne se vise pas ainsi. */
function ruleOf(activity) {
  // §16.41 : l'arme d'une créature, soi compris (Arme élémentaire : dnd5e vise un « objet »).
  if ( enchantTargetOf(activity) === "weapon" ) return { self: true, side: null };
  // §53 : le sort qu'une potion fait lancer est pour le buveur (adapter/usage.mjs) — rien à viser.
  if ( potionCastsOnDrinker(activity?.item) ) return null;
  // §101 : une potion « au toucher » se boit sans cible (le buveur), ou va à la créature déjà désignée — pas de visée.
  if ( isPotion(activity?.item) && (activity.range?.units === "touch") ) return null;
  // §123 : la portée corrigée par le contenu (Imposition des mains : « personnelle » dans les données, au contact en vrai).
  return activity ? targetRule({ type: activity.type, affects: activity.target?.affects?.type, rangeUnits: rangeUnitsOf(activity),
    template: activity.target?.template?.type }) : null;
}

function needsTarget(activity) {
  return !!ruleOf(activity);
}

const TARGET_REFUSALS = { self: "Retour.PasSoi", notAlly: "Retour.PasAllie", notEnemy: "Retour.PasEnnemi" };

/** Le type de cible de l'activité refuse-t-il cette créature (soi-même, mauvais camp) ? Le texte du refus, ou null. */
export function targetTypeRefusal(me, hover, activity) {
  const why = targetRefusal(ruleOf(activity), { isSelf: hover === me, relation: relationForTargeting(me, hover) });
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
      startPicking(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | multiple targeting`, err));
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
      .catch(err => console.error(`${MODULE_ID} | storm`, err));
    return false;
  }
  // §16.35 : un sort de lumière qui invoque un objet (Lumière) — au sol ou sur soi, et la couleur, avant de lancer.
  if ( lightChoiceOf(activity) && !ours.lightChoice && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askLightChoice(activity).then(choice => !choice ? null
      : exclusive(() => (choice.where === "off") ? putOutLight(activity) : castLight(activity, usage, choice)))
      .catch(err => console.error(`${MODULE_ID} | light choice`, err));
    return false;
  }
  // §293 : « chaque créature de votre choix dans un rayon » (Renvoi des morts-vivants) — la liste des créatures à portée, cochées, et
  // la case de l'activité qui le remplace (Calcination) ; puis l'activité part sur les cochées, sans zone ni visée au clic.
  if ( pickTargetsOf(activity) && !ours.picked && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askPickTargets(activity).then(choice => !choice ? null : exclusive(() => castOnPicked(activity, usage, choice)))
      .catch(err => console.error(`${MODULE_ID} | creatures of your choice`, err));
    return false;
  }
  // §16.41 : Arme élémentaire — le niveau et l'élément (fenêtre de dnd5e), puis la créature (visée), puis son arme.
  // §16.45 : Pacte de la lame — ses armes ou une arme invoquée, et le type de dégâts ; pas de créature à viser.
  if ( (enchantTargetOf(activity) === "ownWeapon") && !ours.enchantItem && !ours.confirmed && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askPact(activity).then(choice => choice ? exclusive(() => pactWith(activity, usage, choice)) : null)
      .catch(err => console.error(`${MODULE_ID} | pact weapon`, err));
    return false;
  }
  if ( (enchantTargetOf(activity) === "weapon") && !ours.enchantItem && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const target = [...game.user.targets][0]?.document ?? null;
    if ( ours.engaged || target ) {
      const usage = [usageConfig, dialogConfig, messageConfig];
      askEnchantWeapon(activity, target?.actor).then(uuid => uuid ? exclusive(() => enchantWith(activity, usage, uuid)) : null)
        .catch(err => console.error(`${MODULE_ID} | enchantment`, err));
      return false;
    }
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( !token?.object ) return true;
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      openTargeting(token, activity, [chosen.config, noDialog(dialogConfig), messageConfig],
        { prompt: loc("Enchant.ChoisirCreature", { name: activity.item.name }), fresh: false });
    }).catch(err => console.error(`${MODULE_ID} | enchantment`, err));
    return false;
  }
  // §16.39 : Forme sauvage, Formes du cercle — la forme se choisit parmi les formes connues, avant de lancer.
  if ( isWildShape(activity) && !ours.wildForm && !ours.confirmed && canvas.ready && activity.actor?.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    const usage = [usageConfig, dialogConfig, messageConfig];
    askWildForm(activity).then(uuid => uuid ? exclusive(() => takeForm(activity, usage, uuid)) : null)
      .catch(err => console.error(`${MODULE_ID} | Wild Shape`, err));
    return false;
  }
  // §57 : une ruée en ligne droite (Frappe du vent) — la case d'arrivée se vise au lieu de poser le gabarit de ligne.
  if ( lineDashOf(activity) && !ours.dash && !ours.confirmed && canvas.ready ) {
    const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
    if ( token?.object && token.isOwner ) {
      closeSheetFor(activity);
      stopTargeting();
      promptTargeting(loc("Ruee.Choisir", { item: activity.item.name }));
      dashing = { token, activity, usage: [usageConfig, dialogConfig, messageConfig] };
      markTargeting();
      return false;
    }
  }
  // §162 : un mur (gabarit « wall ») se pose par points — le niveau d'abord, puis deux points ou plus ; l'activité part avec eux.
  const wall = (ours.aimed || ours.confirmed || !canvas.ready || (usageConfig.create?.measuredTemplate !== true)) ? null : wallAreaOf(activity);
  if ( wall && wall.token.object && wall.token.isOwner ) {
    closeSheetFor(activity);
    stopTargeting();
    usageConfig.create.measuredTemplate = false;
    if ( dialogConfig ) {
      dialogConfig.options ??= {};
      dialogConfig.options.display = foundry.utils.mergeObject(dialogConfig.options.display ?? {}, { create: false }, { inplace: false });
    }
    configureFirst(activity, usageConfig, dialogConfig).then(chosen => {
      if ( !chosen ) return;
      return aimWall(activity, wall, points => exclusive(() => castAimed(activity,
        [chosen.config, noDialog(dialogConfig), messageConfig], { type: "wall", points })));
    }).catch(err => console.error(`${MODULE_ID} | wall placement`, err));
    return false;
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
        [chosen.config, noDialog(dialogConfig), messageConfig], shape)));
    }).catch(err => console.error(`${MODULE_ID} | area targeting`, err));
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
  // §125 : une action que le moteur lance sur les cibles qu'il a choisies (visée, projectiles, groupe) — retenues jusqu'à leur relâchement.
  if ( ours.engaged || ours.picks || ours.projectileOf ) noteInFlight(activity);
  // §189 : une action de feu tirée sur une flaque d'huile, une toile — sans créature ciblée, rien à viser.
  if ( !setting("targetingMode") || usageConfig[MODULE_ID]?.engaged || usageConfig[MODULE_ID]?.confirmed || ours.igniteZone ) return true;
  // §125 : les cibles d'une action précédente pas encore réglée (son animation, ses jets) ne servent pas à une autre — vu : un Mot
  // de guérison lancé juste après une Moquerie cruelle a soigné le Zombi encore ciblé. Relâchées, et la visée s'ouvre.
  if ( leftoverTargets(activity) ) { clearTargets(); log(`${activity.item?.name}: previous action's targets released, targeting opened`); }
  if ( !canvas.ready || game.user.targets.size || !needsTarget(activity) ) return true;
  const token = activity.getUsageToken?.() ?? activity.actor?.getActiveTokens()[0]?.document;
  if ( !token?.object || !token.isOwner ) return true;
  stopTargeting();
  // §16.33 : un sort à plusieurs cibles (Bénédiction, Prière de guérison…) — le niveau d'abord, puis un clic par créature.
  if ( maySeveral(activity) ) {
    startGroup(token, activity, usageConfig, dialogConfig, messageConfig).catch(err => console.error(`${MODULE_ID} | group targeting`, err));
    return false;
  }
  openTargeting(token, activity, [usageConfig, dialogConfig, messageConfig], { prompt: loc("Visee.Choisir", { name: activity.item.name }), fresh: false });
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
  const mine = placing = { activity };
  announceTargeting();
  promptTargeting(loc("Zone.Choisir", { item: activity.item.name }));
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
  } catch(err) { console.error(`${MODULE_ID} | area move`, err); }
  finally { endPlacing(mine); announceTargeting(); }
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
  const mine = placing = { activity };
  announceTargeting();
  promptTargeting(loc("Zone.Viser", { item: activity.item.name, name: area.token.name }));
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
    endPlacing(mine);
    announceTargeting();
    await then(shape);
  } catch(err) { console.error(`${MODULE_ID} | area targeting`, err); }
  finally { endPlacing(mine); announceTargeting(); }
}

/** La longueur en pieds (unités de la grille) pour le bandeau. */
const gridUnits = px => Math.round((px / canvas.dimensions.size) * canvas.dimensions.distance);

/**
 * §162 : la pose d'un mur par points. Clic gauche : un point (au coin de case le plus proche, la longueur restante bornée) ; le segment
 * suivant suit la souris ; clic droit ou Entrée : terminé (deux points au moins) ; Échap : rien. Le mur se termine seul quand sa
 * longueur est atteinte. `then(points)` reçoit la ligne brisée, en pixels.
 * @param {Activity} activity
 * @param {{token: TokenDocument, length: number, width: number}} area  `wallAreaOf`.
 * @param {(points: Array<{x: number, y: number}>) => any} then
 */
async function aimWall(activity, area, then) {
  if ( !canvas.ready ) return;
  stopTargeting();
  const points = [];
  let mine = null;
  const g = new PIXI.Graphics();
  canvas.controls.addChild(g);
  const color = Number(foundry.utils.Color.from(game.user.color)) || 0xff6400;
  // §172 : un mur épais se pose de centre de case en centre de case ; sa ligne de centres est plus courte d'une case que le mur.
  const max = (area.cells ? area.lineLength : area.length) || Infinity;
  // §169 : sans diagonale — le point suit l'axe où il s'écarte le plus du précédent.
  const snap = p => {
    const v = canvas.grid.getSnappedPoint(p, { mode: area.cells ? CONST.GRID_SNAPPING_MODES.CENTER : CONST.GRID_SNAPPING_MODES.VERTEX });
    return (area.orthogonal && points.length) ? orthogonalize([points.at(-1), v])[1] : v;
  };
  const say = cursor => {
    const used = polylineLength(clampPolyline(cursor ? [...points, cursor] : points, max));
    const left = Number.isFinite(max) ? loc("Mur.Reste", { n: gridUnits(Math.max(0, max - used)), units: canvas.scene.grid.units }) : "";
    promptText = `${loc(points.length < 2 ? "Mur.Poser" : "Mur.Continuer", { item: activity.item.name })}${left ? ` ${left}` : ""}`;
    announceTargeting();
  };
  const draw = cursor => {
    const line = clampPolyline(cursor ? [...points, cursor] : points, max);
    g.clear();
    if ( !line.length ) return;
    g.lineStyle(Math.max(area.width, 6), color, 0.6).moveTo(line[0].x, line[0].y);
    for ( const p of line.slice(1) ) g.lineTo(p.x, p.y);
    g.lineStyle(0).beginFill(color, 0.9);
    for ( const p of points ) g.drawCircle(p.x, p.y, 6);
    g.endFill();
  };
  const result = await new Promise(resolve => {
    let done = false;
    const finish = value => {
      if ( done ) return;
      done = true;
      canvas.stage.off("pointermove", onMove);
      canvas.stage.off("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      g.destroy();
      resolve(value);
    };
    const onMove = event => { const p = snap(event.getLocalPosition(canvas.stage)); draw(p); say(p); };
    const onDown = event => {
      if ( event.button === 2 ) return finish(points.length >= 2 ? clampPolyline(points, max) : null);
      if ( event.button !== 0 ) return;
      event.stopPropagation();
      const p = snap(event.getLocalPosition(canvas.stage));
      points.push(p);
      const line = clampPolyline(points, max);
      if ( (line.length < points.length) || (polylineLength(line) >= max - 0.5) ) return finish(line.length >= 2 ? line : null);
      draw(p); say(p);
    };
    const onKey = event => {
      if ( event.key === "Escape" ) { event.preventDefault(); finish(null); }
      else if ( event.key === "Enter" ) { event.preventDefault(); finish(points.length >= 2 ? clampPolyline(points, max) : null); }
    };
    mine = placing = { activity, cancel: () => finish(null) };
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    promptTargeting(loc("Mur.Poser", { item: activity.item.name }));
    say(null);
  });
  if ( endPlacing(mine) ) promptText = null;
  announceTargeting();
  if ( !result ) return ui.notifications.info(loc("Visee.Annulee"));
  await then(result);
}

/**
 * §70 : après une utilisation d'Appel de la foudre — à l'incantation, le nuage que dnd5e vient de poser est habillé en orage ;
 * puis (incantation comme relance) l'éclair se vise sous le nuage : un cercle de 1,50 m suit la souris sans sortir du nuage,
 * le clic le pose (la résolution le lit), clic droit ou Échap : pas d'éclair (la carte reste sans résolution).
 */
export async function stormAfterUse(activity, usageConfig) {
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
  const mine = placing = { activity };
  announceTargeting();
  setBoltAim({ activity, cloud });
  promptTargeting(loc("Orage.Viser", { item: activity.item.name }));
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
    endPlacing(mine);
    announceTargeting();
    setBoltAim(null);
    await exclusive(() => strike(activity, cloud, { x: shape.x, y: shape.y }));
  } catch(err) { console.error(`${MODULE_ID} | lightning bolt targeting`, err); }
  finally { endPlacing(mine); announceTargeting(); setBoltAim(null); }
}

/** §59 : le bouton « Placer la zone » de la carte d'un cône ou d'une ligne de portée personnelle — la même visée. */
function onPreTemplate(activity) {
  if ( lineDashOf(activity) ) return;
  // §162 : un mur, par points.
  const wall = wallAreaOf(activity);
  if ( wall?.token.object && wall.token.isOwner ) {
    aimWall(activity, wall, points => placeWall(activity, points)).catch(err => console.error(`${MODULE_ID} | wall placement`, err));
    return false;
  }
  const aim = aimedAreaOf(activity);
  if ( !aim?.token.object || !aim.token.isOwner ) return;
  aimArea(activity, aim, shape => placeAimed(activity, shape)).catch(err => console.error(`${MODULE_ID} | area targeting`, err));
  return false;
}

/**
 * §190 : une sphère, un cylindre, un cube lancé « en un point à portée » (Aspersion d'acide, Boule de feu) — la pose de dnd5e
 * (`TemplatePlacement.fromActivity`) n'a pas de portée. Juste avant la création (`dnd5e.createMeasuredTemplate`,
 * canvas/template-placement.mjs:175, annulable), une zone hors de portée n'est pas créée : le message le dit et la pose se rouvre.
 * La pose reste celle de dnd5e, attendue par l'utilisation : ce qui lit la zone à `postUseActivity` la trouve (le nuage d'Appel
 * de la foudre, que la 0.242.1 avait cassé en posant la zone après coup). Un nuage d'orage n'est pas vérifié (sa visée de l'éclair
 * suit l'utilisation) ; les zones que le moteur crée lui-même (`enginePlaced`) non plus.
 */
function onCreateTemplate(activity, regionData) {
  if ( stormOf(activity?.item) ) return;
  if ( (regionData ?? []).some(d => d?.flags?.[MODULE_ID]?.enginePlaced) ) return;
  const area = rangedAreaOf(activity);
  if ( !area ) return;
  const shapes = (regionData ?? []).flatMap(d => d.shapes ?? []);
  // §200 : « Chemin dégagé vers la cible » — pas de point d'origine derrière un mur (Boule de feu lancée derrière un mur, retour de
  // table du 2026-10-18). §286 : chaque gabarit d'une zone multiple ; Tempête de feu — « chaque cube contigu à au moins un autre ».
  const problem = rangedPlacementProblem(area, shapes);
  if ( !problem ) return;
  const key = { far: "Zone.HorsPortee", hidden: "Zone.SansChemin", apart: "Zone.NonContigue" }[problem];
  ui.notifications.warn(loc(key, { item: activity.item.name, max: area.max, units: area.units }));
  dnd5e.canvas.TemplatePlacement.fromActivity(activity).catch(err => console.error(`${MODULE_ID} | ranged area placement`, err));
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
    catch(err) {
      // Fenêtre fermée : dnd5e rejette sans erreur (activity-usage-dialog.mjs:556) — rien n'est lancé. Une vraie erreur se journalise.
      if ( err ) console.warn(`${MODULE_ID} | usage dialog of ${activity.item?.name}`, err);
      return null;
    }
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
  const usage = [chosen.config, noDialog(dialogConfig), messageConfig];
  const count = targetCount(activity, { level: chosen.level });
  clearTargets();
  markTargeting();
  if ( count <= 1 ) {
    targeting = { token, activity, usage };
    return promptTargeting(loc("Visee.Choisir", { name: activity.item.name }));
  }
  picking = { token, activity, count, picks: [], group: true, usage };
  showReticle(counterText());
  promptTargeting(loc("Cibles.Choisir", { item: activity.item.name, count }));
}

/** §16.33 : la visée de groupe est close (complète, ou Entrée) — le sort part sur les créatures choisies. */
export function finishGroup() {
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
  clearTargets();
  picking = { token, activity, count, picks: [], usage: [config, noDialog(dialogConfig), messageConfig] };
  markTargeting();
  showReticle(counterText());
  promptTargeting(loc("Projectiles.Choisir", { item: activity.item.name, count }));
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
export let reticle = null;

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

export function setReticleRefused(refused) {
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

/**
 * Une visée multiple abandonnée (clic droit, Échap) relâche les créatures déjà choisies : sinon l'attaque suivante partait
 * aussitôt sur elles, sans visée (vu en jeu le 2026-10-10, §119 — Échap les laissait ciblées, le clic droit non).
 */
/** Un clic sur une créature pendant la visée multiple : un projectile de plus pour elle ; au dernier, le sort part. */
export function pickTarget(hover) {
  if ( !picking || !hover?.object ) return;
  // §16.33 : en visée de groupe, une créature ne compte qu'une fois — la recliquer la retire.
  if ( picking.group && picking.picks.includes(hover.uuid) ) {
    picking.picks.splice(picking.picks.indexOf(hover.uuid), 1);
    hover.object.setTarget(false, { releaseOthers: false, groupSelection: true });
    announceTargeting();
    return setReticleLabel(counterText());
  }
  // §286 : Chaîne d'éclairs — après la première, chaque cible à 9 m d'elle.
  const chained = (picking.group && picking.picks.length && chainOf(picking.activity.item)) ? { [MODULE_ID]: { chainFrom: picking.picks[0] } } : null;
  const refusal = refusalFor(picking.token, hover, picking.activity, chained);
  if ( refusal ) return floatNotice(hover, refusal, "refused");
  picking.picks.push(hover.uuid);
  hover.object.setTarget(true, { releaseOthers: false, groupSelection: true });
  setReticleLabel(counterText());
  floatNotice(hover, `${picking.picks.length}/${picking.count}`);
  announceTargeting();
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

export function stopTargeting() {
  stopPicking();
  dashing = null;
  recalling = null;
  hideReticle();
  targeting = null;
  if ( placing ) { canvas.regions?._cancelPlacement?.(); placing.cancel?.(); }
  placing = null;
  promptText = null;
  hideHitChance();
  setCursor(null);
  document.body.classList.remove("dnd5e-combat-targeting");
  announceTargeting();
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
    openTargeting(token, activity, [{}, { configure: false }, {}], { prompt: loc("Visee.DebutTour", { item: item.name }), reticle: item.name });
    return;
  }
}

/** À inscrire AVANT `registerTurn()` : la visée suspend une utilisation avant que sa légalité soit jugée. */
export function registerPointer() {
  registerHitChance();
  const client = (key, data) => game.settings.register(MODULE_ID, key, { scope: "client", config: true,
    name: `DND5ECOMBAT.Reglage.${key}.Nom`, hint: `DND5ECOMBAT.Reglage.${key}.Aide`, ...data });
  client("clickToMove", { type: String, default: "off",
    choices: { always: "DND5ECOMBAT.Reglage.clickToMove.always", combat: "DND5ECOMBAT.Reglage.clickToMove.combat", off: "DND5ECOMBAT.Reglage.clickToMove.off" } });
  // 2026-10-22 (retour de table) : « jamais » par défaut, comme le clic-déplacement — le clic droit propose toujours l'attaque.
  client("clickToAttack", { type: String, default: "off",
    choices: { always: "DND5ECOMBAT.Reglage.clickToAttack.always", combat: "DND5ECOMBAT.Reglage.clickToAttack.combat", off: "DND5ECOMBAT.Reglage.clickToAttack.off" } });
  client("targetingMode", { type: Boolean, default: true });
  client("fastAttack", { type: Boolean, default: true });
  client("quickRolls", { type: Boolean, default: true });
  client("pathPreview", { type: Boolean, default: true });
  client("releaseTargets", { type: Boolean, default: true });
  client("situationalCursor", { type: Boolean, default: true });
  client("closeSheetOnUse", { type: Boolean, default: true });
  client("teleportPlanning", { type: Boolean, default: true });
  client("targetingBanner", { type: Boolean, default: true, onChange: () => announceTargeting() });
  // §208 : « Sauter en hauteur ici » dans le menu contextuel — bêta, décidé par le MJ pour la table, désactivé par défaut.
  game.settings.register(MODULE_ID, HIGH_JUMP_MENU_SETTING, { scope: "world", config: true, type: Boolean, default: false,
    name: `DND5ECOMBAT.Reglage.${HIGH_JUMP_MENU_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${HIGH_JUMP_MENU_SETTING}.Aide` });
  // §210 : l'interrupteur des coups non létaux dans le menu contextuel de son token — masqué par défaut.
  game.settings.register(MODULE_ID, NONLETHAL_MENU_SETTING, { scope: "world", config: true, type: Boolean, default: false,
    name: `DND5ECOMBAT.Reglage.${NONLETHAL_MENU_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${NONLETHAL_MENU_SETTING}.Aide` });

  route("dnd5e.preUseActivity", onPreUseActivity, { cancellable: true, label: "targeting: target expected" });
  route("dnd5e.preRollDamageV2", onPreRollDamage, { cancellable: true, label: "damage and healing without dialog" });
  route("dnd5e.preRollAttackV2", onPreRollDamage, { cancellable: true, label: "attack roll without dialog" });
  route("dnd5e.postUseActivity", onPostUseActivity, { label: "teleportation: targeting not opened" });
  route("dnd5e.preCreateMeasuredTemplate", onPreTemplate, { cancellable: true, label: "cone or line: targeting around the caster (map)" });
  route("dnd5e.createMeasuredTemplate", onCreateTemplate, { cancellable: true, label: "ranged area: within range, clear path" });
  route("updateChatMessage", onResolutionSettled, { label: "targets released" });
  route("createChatMessage", onResolutionSettled, { label: "targets released" });
  route("combatTurnChange", onTurnChange, { label: "targets released at end of turn" });
  route("combatTurnChange", offerTurnStart, { label: "start-of-turn activity offered" });
  route("createActiveEffect", offerEnchantedAttack, { label: "True Strike: attack not offered" });
  route("createChatMessage", onFlurryUsed, { label: "Flurry of Blows: targeting not opened" });
  route("canvasTearDown", (board, options) => {
    stopTargeting(); closeMenu(); forgetHover();
    // B12 : seulement si l'on quitte la scène — un changement de niveau redessine aussi le canevas (scene.mjs:273), en pleine
    // marche d'un escalier (`walkMoves`), et cette marche-là doit continuer.
    sceneLeft = (options?.nextScene ?? null) !== board.scene;
    if ( sceneLeft ) releaseMouse();
  }, { label: "mouse: reset" });
  route("canvasReady", () => { if ( sceneLeft ) stopDeadMovements(); sceneLeft = false; }, { label: "dead movements stopped" });
  route("controlToken", () => clearPreview(), { label: "path preview cleared" });
  route("ready", () => {
    // §220 : pendant le Théâtre de l'esprit, la souris et le clavier reviennent au cœur.
    const live = fn => event => (theaterActive() ? undefined : fn(event));
    document.addEventListener("pointerdown", live(onPointerDown), true);
    document.addEventListener("pointerup", live(onPointerUp), true);
    document.addEventListener("pointermove", live(onPointerMove), true);
    document.addEventListener("pointermove", live(placeHitChance), { capture: true, passive: true });
    document.addEventListener("pointermove", live(placeReticle), { capture: true, passive: true });
    document.addEventListener("pointermove", live(trackPointer), { capture: true, passive: true });
    document.addEventListener("keyup", live(onModifierKey), true);
    document.addEventListener("keydown", live(onKeyDown), true);
    document.addEventListener("keydown", live(onMenuShift), true);
    document.addEventListener("keyup", live(onMenuShift), true);
  }, { label: "mouse: listeners not attached" });
  // §220 : en passant en Théâtre de l'esprit, l'aperçu de chemin s'efface.
  route(`${MODULE_ID}.theater`, active => { if ( active ) clearPreview(); }, { always: true, label: "theatre of the mind: path preview cleared" });
}
