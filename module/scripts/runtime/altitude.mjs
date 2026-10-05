/**
 * Modes de déplacement et élévation (SPEC §17.4, demande de l'utilisateur du 2026-09-26) : marcher et ramper au sol,
 * voler à 5 ft au moins au-dessus, fouir à 5 ft au moins dessous. Le sol : la Surface qui arrête le déplacement sous le
 * token, sinon la base de son niveau (adapter/altitude.mjs).
 *
 *  - Chaque déplacement (glisser, clavier, clic au sol, champ d'élévation du HUD) est aligné AVANT de partir : ses points
 *    reçoivent l'élévation de leur mode (`alignPath`, core/altitude.mjs). `preMoveToken` est synchrone et ses points de
 *    passage sont figés (client/documents/token.mjs:1976-1990) : un chemin à corriger est refusé puis relancé corrigé,
 *    comme les attaques d'opportunité le font déjà (runtime/actions.mjs). Au sol, une marche de 5 ft au plus : plus haut
 *    il faut grimper (refusé), plus bas c'est une chute — le chemin s'arrête au-dessus du vide et dnd5e met la créature
 *    « En chute » (documents/token.mjs:436), le MJ la fait tomber d'un clic sur l'icône (canvas/token.mjs:168), dégâts
 *    compris. Le MJ n'est pas retenu : pour lui le sol est suivi quoi qu'il arrive.
 *  - Changer de mode (HUD du token, barre d'actions : une mise à jour de `movementAction`) déplace le token verticalement dans le
 *    bon mode, au prix du déplacement : décoller de 5 ft, atterrir, s'enfouir, remonter. Ce choix vaut décision : une
 *    créature sans la vitesse de vol (ou de fouissement) la reçoit, égale à sa marche, par un effet que le moteur retire
 *    quand elle reprend un mode qui n'en a pas besoin (demande de l'utilisateur, 2026-09-26). Refusé seulement si le
 *    tour ne permet plus ce mouvement.
 *  - Monter ou descendre par le champ d'élévation du HUD, sans bouger : au-dessus du sol, la créature s'envole si elle
 *    le peut ; dessous, elle fouit ; au sol, elle atterrit.
 *  - Non touchés : les déplacements forcés du moteur (`cleared` : poussée, empoignade, avaler), la téléportation, les
 *    objets pilotés (Main de Bigby, sphères), ce qui n'est pas une créature, et l'annulation.
 */

import { MODULE_ID } from "../constants.mjs";
import { placementOf, alignPath, modeShift, coherentElevation, speedFor } from "../core/altitude.mjs";
import { rulerShown, continuedFlags } from "../adapter/movement.mjs";
import { boundsUnder, levelAt, clearanceOf, modeRefusalFor, groundModeOf, effectiveMode, grantSpeedFor, revokeSpeedsBut, grantedSpeedEffects } from "../adapter/altitude.mjs";
import { pilotOf, isIntangible } from "../adapter/pilot.mjs";
import { route } from "./router.mjs";
import { loc, log, notice } from "./shared.mjs";

export const ALTITUDE_SETTING = "altitude";
const BETTER_LEVELS = "baileywiki-better-levels";

const MOVEMENT_FIELDS = ["x", "y", "elevation", "level", "width", "height", "depth", "shape"];

function concerned(token) {
  if ( !game.settings.get(MODULE_ID, ALTITUDE_SETTING) ) return false;
  const actor = token.actor;
  if ( !actor || (actor.system?.isCreature === false) ) return false;
  return !pilotOf(token) && !isIntangible(token);
}

/** Ce qu'on recopie d'un point de passage pour relancer un déplacement (comme runtime/actions.mjs). */
const copyOf = ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint }) =>
  ({ x, y, elevation, width, height, depth, shape, level, action, snapped, explicit, checkpoint });

const refuse = (token, key, data) => {
  ui.notifications.warn(loc(`Altitude.${key}`, { name: token.name, ...data }));
  notice(token, loc(`Retour.Altitude.${key}`));
};

/**
 * Comme le comportement `changeLevel` du cœur (change-level.mjs:110) : la vue de celui qui contrôle le token suit son
 * changement de niveau, s'il regardait le niveau d'où il vient.
 */
async function followLevel(token, from) {
  const to = token._source.level;
  if ( (to === from) || !token.parent.isView || (canvas.level?.id !== from) || !token.object?.controlled ) return;
  await token.parent.view({ level: to, controlledTokens: [token.id] });
}

/* -------------------------------------------- */
/*  Changer de mode                             */
/* -------------------------------------------- */

/**
 * Passe le token dans le mode `to` : le mouvement vertical d'abord (payé comme un déplacement), le mode ensuite.
 * @returns {Promise<boolean>}
 */
export async function switchMode(token, to, shift, value=to) {
  if ( shift ) {
    const reached = () => Math.abs((token._source.elevation ?? 0) - shift.elevation) <= 1e-6;
    // Le niveau suit l'élévation (levelAt), sauf sous terre.
    const level = (placementOf(shift.action) === "under") ? token._source.level : levelAt(token.parent, shift.elevation, token._source.level);
    const moved = { elevation: shift.elevation, action: shift.action, ...((level !== token._source.level) ? { level } : {}) };
    const from = token._source.level;
    await token.move([moved], { [MODULE_ID]: { altitude: true } });
    if ( !reached() && (placementOf(to) === "ground") ) {
      // Revenir au sol de son niveau ne doit jamais rester bloqué : un token posé SUR une surface (plancher du dessus)
      // ne peut plus redescendre en volant (le cœur la tient pour pleine vers le bas). Un pas `displace` n'est pas
      // contraint (constrainMovementPath : « unless teleporting ») ; le sol visé est celui de son propre niveau.
      await token.move([{ ...moved, action: "displace" }], { [MODULE_ID]: { altitude: true }, constrainOptions: { ignoreWalls: true } });
      if ( reached() ) log(`${token.name} : retour au sol par un pas displace (bloqué par une surface)`);
    }
    if ( !reached() ) return false;
    await followLevel(token, from);
  }
  if ( token._source.movementAction !== value ) await token.update({ movementAction: value }, { [MODULE_ID]: { altitude: true } });
  log(`${token.name} : mode ${to}${shift ? `, élévation ${shift.elevation}` : ""}`);
  return true;
}

/**
 * Le mode choisi dans le HUD du token (ou la barre d'actions) : la vitesse qui manque est accordée, le mouvement vertical fait,
 * le mode posé, puis les vitesses accordées qui ne servent plus retirées. `value` null : le mode par défaut du cœur.
 * @returns {Promise<boolean>}
 */
async function applyMode(token, value) {
  const to = value ?? CONFIG.Token.movement.defaultAction;
  const granted = await grantSpeedFor(token, to);
  if ( granted ) notice(token, loc("Retour.Altitude.Accordee", { mode: game.i18n.localize(CONFIG.Token.movement.actions[to]?.label ?? to) }), "gain");
  const pos = token._source;
  const { ground, ceiling } = boundsUnder(token);
  const shift = modeShift(token.movementAction, to, pos.elevation ?? 0, ground, clearanceOf(token.parent), ceiling);
  if ( !(await switchMode(token, to, shift, value)) ) {
    if ( granted ) await revokeSpeedsBut(token, token.movementAction);
    return false;
  }
  await revokeSpeedsBut(token, to);
  return true;
}

/** Une vitesse accordée par le moteur que le mode `to` n'utilise pas ? */
const staleGrant = (token, to) => grantedSpeedEffects(token.actor).some(e => e.getFlag(MODULE_ID, "grantedSpeed") !== speedFor(to));

/** Une mise à jour de `movementAction` seule : on la remplace par ce qu'elle demande (vitesse, mouvement vertical). */
function onPreUpdateToken(token, changes, options) {
  if ( !("movementAction" in changes) || options?.[MODULE_ID]?.altitude ) return true;
  if ( MOVEMENT_FIELDS.some(k => k in changes) || !concerned(token) ) return true;
  const value = changes.movementAction ?? null;
  const to = value ?? CONFIG.Token.movement.defaultAction;
  if ( options?.[MODULE_ID]?.forced ) {
    // Mis À terre, relevé : pas un choix de mode ; un vol accordé qui ne sert plus tombe quand même.
    if ( staleGrant(token, to) ) setTimeout(() => revokeSpeedsBut(token, to).catch(err => console.error(`${MODULE_ID} | vitesse accordée`, err)), 0);
    return true;
  }
  const pos = token._source;
  const { ground, ceiling } = boundsUnder(token);
  const shift = modeShift(token.movementAction, to, pos.elevation ?? 0, ground, clearanceOf(token.parent), ceiling);
  if ( !shift && !modeRefusalFor(token.actor, to) && !staleGrant(token, to) ) return true;
  applyMode(token, value).then(ok => { if ( !ok ) refuse(token, "Impossible"); })
    .catch(err => console.error(`${MODULE_ID} | changement de mode`, err));
  return false;
}

/* -------------------------------------------- */
/*  Aligner chaque déplacement                  */
/* -------------------------------------------- */

/**
 * Le niveau de chaque point d'un chemin d'après son élévation (`levelAt`) : monter au-dessus du haut de son niveau fait
 * passer dans celui du dessus, descendre sous son bas dans celui du dessous — le cœur ne le fait pas (demande de
 * l'utilisateur, 2026-09-26). Un point dont le niveau diffère de celui du départ (escalier, pas `displace` de l'A*) garde
 * le sien. En fouissement, on reste dans son niveau : sous le sol, on n'est pas dans la cave du dessous.
 */
function levelsAlong(token, origin, waypoints, elevations) {
  let current = origin.level;
  return waypoints.map((w, n) => {
    const base = ((w.level ?? origin.level) !== origin.level) ? w.level : current;
    current = (placementOf(w.action) === "under") ? base : levelAt(token.parent, elevations[n], base);
    return current;
  });
}

/** Le déplacement ne fait que monter ou descendre (champ d'élévation du HUD, touches d'élévation) ? */
function isPureVertical(origin, waypoints) {
  const last = waypoints.at(-1);
  return waypoints.every(w => (w.x === origin.x) && (w.y === origin.y) && ((w.level ?? origin.level) === origin.level))
    && (Math.abs((last.elevation ?? 0) - (origin.elevation ?? 0)) > 1e-6);
}

/** Le déplacement ne fait que changer de niveau, sans bouger ni changer d'élévation (bouton « niveau » du HUD) ? */
function isLevelOnly(origin, waypoints) {
  const last = waypoints.at(-1);
  return waypoints.every(w => (w.x === origin.x) && (w.y === origin.y))
    && ((last.level ?? origin.level) !== origin.level) && (Math.abs((last.elevation ?? 0) - (origin.elevation ?? 0)) < 1e-6);
}

/** Sur place, vers un autre niveau, posé à sa base : la recette du comportement `changeLevel` du cœur (escaliers). */
function isStairsLevelChange(token, origin, waypoints) {
  const last = waypoints.at(-1);
  if ( !last.level || (last.level === origin.level) ) return false;
  if ( !waypoints.every(w => (w.x === origin.x) && (w.y === origin.y)) ) return false;
  const base = token.parent.levels.get(last.level)?.elevation?.base;
  return Number.isFinite(base) && (Math.abs((last.elevation ?? 0) - base) < 1e-6);
}

/**
 * Changer de niveau par le HUD : le token va au sol de ce niveau, à l'élévation de son mode (en vol 5 ft au-dessus, en
 * fouissement 5 ft dessous). Un seul pas `displace` (la recette du comportement `changeLevel` du cœur, change-level.mjs:163) :
 * un plancher ne l'arrête pas. Ce que faisait le réglage « Set elevation on level change » de Baileywiki Better Levels
 * (qui pose toujours le token au bas du niveau, quel que soit son mode) — à couper quand ce réglage-ci est actif.
 */
function levelOnlyMove(token, last) {
  const bounds = boundsUnder(token, last);
  // On a choisi CE niveau : si son sol est ailleurs (pas de plancher de l'étage ici, sol du rez-de-chaussée), sa base.
  const level = token.parent.levels.get(last.level);
  const bottom = level?.elevation?.bottom ?? -Infinity;
  const top = level?.elevation?.top ?? Infinity;
  const ground = ((bounds.ground >= bottom) && (bounds.ground < top)) ? bounds.ground : (level?.elevation?.base ?? bounds.ground);
  const ceiling = bounds.ceiling;
  const elevation = coherentElevation(token.movementAction, ground, ground, clearanceOf(token.parent), ceiling);
  const from = token._source.level;
  log(`${token.name} : niveau ${from} → ${last.level}, élévation ${elevation} (sol ${ground})`);
  token.move([{ elevation, level: last.level, action: "displace" }], { [MODULE_ID]: { altitude: true }, constrainOptions: { ignoreWalls: true } })
    .then(() => followLevel(token, from))
    .catch(err => console.error(`${MODULE_ID} | changement de niveau`, err));
  return false;
}

/**
 * Monter ou descendre sur place : le mode suit l'élévation voulue — au-dessus du sol voler, dessous fouir, au sol le
 * mode au sol. Même mode qu'avant : on laisse l'alignement ordinaire faire.
 */
function verticalMove(token, last) {
  const { ground, ceiling } = boundsUnder(token);
  const clearance = clearanceOf(token.parent);
  const wanted = last.elevation ?? 0;
  const current = token.movementAction;
  if ( placementOf(current) === null ) return null;   // escalade, nage, saut : l'élévation est libre
  const to = (wanted > ground + 1e-6) ? "fly" : ((wanted < ground - 1e-6) ? "burrow"
    : ((placementOf(current) === "ground") ? current : groundModeOf(token.actor)));
  log(`${token.name} : élévation ${token._source.elevation} → ${wanted} sur place (niveau ${token._source.level}, sol ${ground}, plafond ${ceiling}) : ${current} → ${to}`);
  if ( placementOf(to) === placementOf(current) ) return null;
  if ( modeRefusalFor(token.actor, to) ) {
    // Le MJ pose où il veut : une créature sans vol laissée en l'air est « En chute » (dnd5e).
    if ( game.user.isGM ) return true;
    refuse(token, "SansVitesse", { mode: game.i18n.localize(CONFIG.Token.movement.actions[to]?.label ?? to) });
    return false;
  }
  const elevation = coherentElevation(to, wanted, ground, clearance, ceiling);
  const action = (placementOf(to) === "ground") ? current : to;
  switchMode(token, to, { elevation, action }).then(ok => { if ( !ok ) refuse(token, "Impossible"); })
    .catch(err => console.error(`${MODULE_ID} | changement de mode par l'élévation`, err));
  return false;
}

function onPreMoveToken(token, movement, operation) {
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);   // §99 : morceau enchaîné par le cœur
  if ( flags?.cleared || flags?.altitude || operation?.isUndo || !concerned(token) ) return true;
  const waypoints = [...movement.passed.waypoints, ...movement.pending.waypoints];
  if ( !waypoints.length ) return true;
  const origin = movement.origin;

  // §18.26 : le changement de niveau d'un escalier (comportement `changeLevel` du cœur, change-level.mjs:163-164) — sur
  // place, à la base du niveau choisi, planchers ignorés. Le réaligner le relancerait sans `ignoreWalls` : un plancher
  // (Surface) l'arrêterait (vu en jeu le 2026-09-26 : le dialogue « monter / descendre » ne menait plus nulle part).
  if ( isStairsLevelChange(token, origin, waypoints) ) return true;
  if ( isLevelOnly(origin, waypoints) ) return levelOnlyMove(token, waypoints.at(-1));

  if ( isPureVertical(origin, waypoints) ) {
    const verdict = verticalMove(token, waypoints.at(-1));
    if ( verdict !== null ) return verdict;
  }

  const clearance = clearanceOf(token.parent);
  // Un mode au sol nettement en l'air (ou sous terre) chez une créature qui vole (ou fouit) : elle prend ce mode plutôt
  // que d'être ramenée au sol. Le mode d'abord, puis le même déplacement dans ce mode (il repasse par ici : aligné,
  // puis contrôlé par le tour).
  const implied = effectiveMode(token, origin);
  if ( implied !== token.movementAction ) {
    const again = waypoints.map(w => ({ ...copyOf(w), action: (placementOf(w.action) === "ground") ? implied : w.action }));
    (async () => {
      if ( !(await switchMode(token, implied, null)) ) return;
      await token.move(again, { showRuler: rulerShown() });
    })().catch(err => console.error(`${MODULE_ID} | déplacement dans le mode de l'élévation`, err));
    return false;
  }
  const points = waypoints.map(w => ({ elevation: w.elevation ?? 0, action: w.action, ...boundsUnder(token, w) }));
  const result = alignPath(origin, points, { clearance, step: clearance, lenient: game.user.isGM });
  const levels = levelsAlong(token, origin, waypoints.slice(0, result.kept), result.elevations);
  const relevelled = levels.some((level, n) => level !== waypoints[n].level);
  if ( !result.changed && !relevelled ) return true;
  log(`${token.name} : chemin aligné — ${points.map((p, n) => `${p.action} ${p.elevation}→${result.elevations[n] ?? "×"} (sol ${p.ground}, plafond ${p.ceiling}, niveau ${levels[n] ?? "×"})`).join(" ; ")}${result.issue ? ` [${result.issue}]` : ""}`);
  if ( result.issue === "tooHigh" ) refuse(token, "TropHaut");
  if ( result.issue === "falls" ) notice(token, loc("Retour.Altitude.Chute"));
  if ( !result.kept ) return false;
  const again = waypoints.slice(0, result.kept).map((w, n) => ({ ...copyOf(w), elevation: result.elevations[n], level: levels[n] }));
  const from = token._source.level;
  token.move(again, { showRuler: rulerShown(), [MODULE_ID]: { altitude: true } }).then(() => relevelled && followLevel(token, from))
    .catch(err => console.error(`${MODULE_ID} | déplacement aligné sur le sol`, err));
  return false;
}

/* -------------------------------------------- */

export function registerAltitude() {
  game.settings.register(MODULE_ID, ALTITUDE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${ALTITUDE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${ALTITUDE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  // Baileywiki Better Levels remet l'élévation au bas du niveau à chaque changement de niveau (updateToken, token-hud.mjs:44) :
  // incompatible avec un niveau qui suit l'élévation (vu en jeu le 2026-09-26 : monté à 16 ft, ramené à 15 ; redescendu à
  // 5 ft, posé à 0 et lu comme un atterrissage). On le dit au MJ.
  route("ready", () => {
    if ( !game.user.isGM || !game.settings.get(MODULE_ID, ALTITUDE_SETTING) ) return;
    if ( !game.modules.get(BETTER_LEVELS)?.active ) return;
    let on = false;
    try { on = game.settings.get(BETTER_LEVELS, "setElevationOnLevelChange") === true; } catch { /* réglage absent */ }
    if ( on ) ui.notifications.warn(loc("Altitude.BetterLevels"), { permanent: true });
  }, { label: "modes de déplacement : réglage de Better Levels" });
  route("preUpdateToken", onPreUpdateToken, { cancellable: true, label: "mode de déplacement : élévation" });
  // Avant le plafond du tour et les attaques d'opportunité (runtime/actions.mjs) : ils jugent le chemin aligné.
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "déplacement : élévation du mode" });
}
