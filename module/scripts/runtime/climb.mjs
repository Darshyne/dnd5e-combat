/**
 * Escalade (SPEC §192, lot 1 : les murs ; lot 2 : les plafonds). Près d'un mur, une créature au sol grimpe : son token passe en mode
 * `climb`, monte sur place (même case, élévation + N cases — un déplacement mesuré en 3D par le cœur, payé au budget du tour : dnd5e
 * ajoute 1 ft par ft sans vitesse d'escalade, rien avec), puis marche le long du mur à cette hauteur (le mode `climb` laisse
 * l'élévation libre, runtime/altitude.mjs). Revenue au sol, elle reprend son mode d'avant.
 *  - Règles `2024` (défaut) : aucun jet (glossaire « Climbing » du Manuel des joueurs) ; `house` : DD 15 Force (Athlétisme) pour
 *    partir, puis à chaque tour en combat (au début du sien) ou toutes les 10 s hors combat — un échec fait tomber.
 *  - Chute : celle de dnd5e (`TokenDocument5e#updateFalling` puis `#plummet`, documents/token.mjs:398-444 — 1d6 par 10 ft, À terre
 *    si dégâts). dnd5e ne réévalue la chute qu'après un déplacement : un grimpeur mis À terre, Neutralisé, Agrippé ou sans vitesse
 *    est fait tomber par le MJ actif ; « Se laisser tomber » (menu) est une chute volontaire, sur le client du joueur.
 *  - Statut « En escalade » sur le token, tenu par le MJ actif d'après le mode.
 *  - **Plafonds (lot 2)** : « Grimper au plafond » (depuis le mur, ou depuis le sol près d'un mur) sous une Surface `move` : le token
 *    monte en `climb` jusqu'au plafond moins sa hauteur, drapeau `climb.ceiling`, statut « Au plafond » ; il marche ensuite sous tout
 *    le plafond (l'A* ne lui laisse que les cases où le plafond est à la même hauteur, adapter/path-world.mjs), un mur n'est plus
 *    nécessaire ; sortir de sous le plafond est refusé (règles 2024) ou fait tomber (maison). Réservé aux créatures qui en ont la
 *    capacité (`canWalkCeilings` : Pattes d'araignée, Pantoufles, Cape d'arachnide, contenu `climbsCeilings`) ; en mode maison, toute
 *    créature l'essaie au DD 20, refait à chaque tour comme le DD 15 du mur. Le MJ actif met le token la tête en bas (`texture.scaleY`
 *    inversé, l'échelle d'origine gardée dans un drapeau et rendue en quittant le plafond, chute comprise) si le réglage « Orienter les
 *    tokens dans le sens du mouvement » est inactif. « Descendre le long du mur » (près d'un mur) ramène au mur puis au sol.
 *  - **Contenu (lot 3, §195)** : « Courir sur le mur » (Mouvement acrobatique du moine) — la même montée, sans test, à son tour (ou hors
 *    combat) ; il tombe s'il finit son tour encore au mur. Les Pantoufles d'araignée ne donnent pas le plafond sur une surface glissante
 *    (Graisse, Huile) : pas d'entrée de menu, et un marcheur de plafond qui n'y tient que par elles en tombe (règles 2024). La chute de dnd5e
 *    (`fallLikeDnd5e`) sert aussi à l'Inversion de la gravité (runtime/elevation-spells.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { CLIMB_DC, CEILING_DC, CLIMB_CHECK_SECONDS, climbableCells, climbCheckDue, flippedScale, acrobaticFallDue, ledgeCost, climbGauge, fallDice } from "../core/climb.mjs";
import { placementOf } from "../core/altitude.mjs";
import {
  CLIMB_RULES_SETTING, CLIMB_FLAG, FLIP_FLAG, climbRules, isClimbing, isOnCeiling, wallsNear, climbingOf, climbFallReasonFor, aboveGround,
  canWalkCeilingsAt, canWalkCeilings, ceilingPerchFor, hangsAt, acrobaticFor, ledgesOf, wallTopOf, levelMarksAbove, edgesBelowOf
} from "../adapter/climb.mjs";
import { perceivedAt } from "../adapter/illumination.mjs";
import { boundsUnder, groundUnder, groundModeOf, modeRefusalFor } from "../adapter/altitude.mjs";
import { MODE_STATUSES, setStatus } from "../adapter/conditions.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter } from "../adapter/dialogs.mjs";
import { actorOfEffect } from "../adapter/grapple.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { pilotOf, isIntangible } from "../adapter/pilot.mjs";
import { rulerShown, continuedFlags } from "../adapter/movement.mjs";
import { historyCosts, positionOf, tokenCenter, combatantFor, readBudget, writeBudget } from "../adapter/turn.mjs";
import { settingOr } from "../adapter/settings.mjs";
import { ALTITUDE_SETTING } from "./altitude.mjs";
import { FACING_SETTING } from "./facing.mjs";
import { movementCap, isGrappled, approach, gapCells } from "./actions.mjs";
import { footprintOf, sizeOf, cellOf } from "../adapter/movement.mjs";
import { rayBlocker } from "../adapter/cover.mjs";
import { cellsAtGap } from "../core/orders.mjs";
import { route } from "./router.mjs";
import { enqueue } from "./queue.mjs";
import { esc, isExecutor, loc, locEsc, log, notice, say, waitForDice } from "./shared.mjs";

export const CLIMB_QUERY = `${MODULE_ID}.climbCheck`;
/** Le joueur a ce temps pour son test (sa fenêtre se ferme avant, au délai des fenêtres de combat). */
const CHECK_TIMEOUT_MS = 40000;
/** Hors combat, le MJ actif relit les grimpeurs à cette cadence. */
const TICK_MS = 2500;

const ALTITUDE_OPTIONS = { [MODULE_ID]: { altitude: true } };

/** Une créature que l'escalade concerne : le réglage « Modes de déplacement et élévation » actif, pas un objet ni un objet piloté. */
function concerned(token) {
  if ( !settingOr(ALTITUDE_SETTING, true) || !token?.actor || (token.actor.system?.isCreature === false) ) return false;
  return !pilotOf(token) && !isIntangible(token) && !isObjectToken(token);
}

function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

const climbFlag = token => token.getFlag(MODULE_ID, CLIMB_FLAG) ?? null;

/* -------------------------------------------- */
/*  Grimper                                     */
/* -------------------------------------------- */

/** Ce token peut-il grimper (ou monter encore) : à soi, au sol ou déjà au mur (pas au plafond), près d'un mur, ni agrippé ni sans vitesse. */
export function canClimb(token) {
  if ( !token?.isOwner || !concerned(token) || isOnCeiling(token) ) return false;
  if ( !isClimbing(token) && (placementOf(token.movementAction) !== "ground") ) return false;   // en vol ou sous terre, on ne grimpe pas
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  return wallsNear(token).length > 0;
}

/** Ce que ce grimpeur peut monter maintenant : cases au plus (budget du tour, plafond), coût d'une case. */
export function climbRoom(token) {
  const grid = token.parent.grid;
  const { multiplier } = climbingOf(token);
  const cap = movementCap(token);
  const history = historyCosts(token);
  const remaining = Number.isFinite(cap) ? Math.max(0, cap - history.spent - history.excluded) : Infinity;
  const elevation = token._source.elevation ?? 0;
  const { ceiling } = boundsUnder(token);
  const ceilingCells = Number.isFinite(ceiling) ? (ceiling - elevation) / grid.distance : Infinity;
  const max = climbableCells({ remaining, gridDistance: grid.distance, multiplier, ceilingCells });
  return { max, multiplier, cost: multiplier * grid.distance, units: grid.units, ceiling: Number.isFinite(ceiling) ? ceiling : null, remaining };
}

/**
 * §216 : « S'agripper au bord » — au bord d'un toit, d'un chemin de ronde, d'un étage, le token passe par-dessus et se retrouve
 * accroché au mur côté vide, la tête à hauteur du bord (adapter/climb.mjs, `edgesBelowOf`), en escalade : il descend ensuite le long du
 * mur. Coût en combat : la hauteur descendue au prix de l'escalade, plus la case (le pendant de « Se hisser »). Le test des règles
 * « maison » est dû comme pour grimper.
 */
export async function grabEdge(token, edge) {
  if ( !token?.isOwner || !edge ) return false;
  const grid = token.parent.grid;
  const feet = token._source.elevation ?? 0;
  const { multiplier, native } = climbingOf(token);
  const cost = ledgeCost({ rise: feet - edge.elevation, multiplier, gridDistance: grid.distance });
  const combatant = combatantFor(token.actor);
  if ( combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( cost > left + 1e-6 ) {
      ui.notifications.warn(loc("Escalade.HisserPasAssez", { name: token.name, cost: `${cost} ${grid.units}`, left: `${Math.max(0, Math.floor(left * 10) / 10)} ${grid.units}` }));
      return false;
    }
  }
  if ( (climbRules() === "house") && !native && !(await houseCheckPassed(token, CLIMB_DC)) ) return false;
  const mode = token._source.movementAction ?? null;
  const from = token._source.level;
  await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { from: mode, checkedAt: Date.now() } }, ALTITUDE_OPTIONS);
  await statusSettled(token, true);
  const step = { x: edge.x, y: edge.y, elevation: edge.elevation, action: "displace", ...((edge.level !== from) ? { level: edge.level } : {}) };
  await token.move([step], { [MODULE_ID]: { altitude: true, planned: true, cleared: true }, constrainOptions: { ignoreWalls: true } });
  if ( Math.abs((token._source.elevation ?? 0) - edge.elevation) > 1e-6 ) {
    await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  if ( combatant ) {
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + cost });
  }
  if ( (token._source.level !== from) && token.parent.isView && (canvas.level?.id === from) && token.object?.controlled ) {
    await token.parent.view({ level: token._source.level, controlledTokens: [token.id] });
  }
  notice(token, loc("Retour.Escalade.Agrippe"), "gain");
  await say({ token }, locEsc("Escalade.SAgrippe", { name: token.name }));
  log(`${token.name}: grabs the edge (${edge.dir}), hangs at ${edge.elevation}, level ${from} → ${token._source.level}${combatant ? `, ${cost} of movement` : ""}`);
  return true;
}

/* -------------------------------------------- */
/*  La fenêtre « Combien de cases ? » (§215)     */
/* -------------------------------------------- */

const GAUGE_HEIGHT = 240;   // hauteur de la colonne de cases, en pixels
const GAUGE_WIDTH = 250;   // la marge de gauche porte les noms des niveaux (§216)

/** Le haut du mur est-il vu du grimpeur (lumière et sens : `perceivedAt`) ? Aveuglé, non ; sans canevas, oui. */
function seesTop(token, top) {
  if ( !top ) return true;
  if ( token.actor?.statuses?.has("blinded") ) return false;
  const center = tokenCenter(token);
  const seen = perceivedAt(token, { x: center.x, y: center.y, elevation: top.at });
  return seen ? !seen.blinded : true;
}

/** Le modèle de la jauge (core/climb.mjs, `climbGauge`) pour ce grimpeur. */
function gaugeFor(token, room, { down=false }={}) {
  const grid = token.parent.grid;
  const feet = token._source.elevation ?? 0;
  const { top, ceilingFeet, height } = wallTopOf(token);
  const seen = down || seesTop(token, top);
  const model = climbGauge({ feet, ground: groundUnder(token), gridDistance: grid.distance, height, remaining: room.remaining,
    multiplier: room.multiplier, ceilingFeet, top, seen, down, marks: levelMarksAbove(token, feet) });
  return { ...model, feet, ground: groundUnder(token), distance: grid.distance, units: grid.units, height };
}

/** Le mur de profil, en SVG : le sol, les cases (choisissables ou non, choisies), le grimpeur, le haut (rebord, plafond, ou inconnu). */
function gaugeSvg(model, chosen, { down=false }={}) {
  const n = model.cells.length;
  const step = Math.min(34, Math.floor(GAUGE_HEIGHT / Math.max(n + 1, 4)));
  const x = 100, w = 46;
  const base = 20 + ((n + 1) * step);
  const yOf = i => base - (i * step);   // i : rang de la case au-dessus (montée) ou au-dessous (descente) du départ
  const parts = [];
  const label = (y, text, cls="") => parts.push(`<text x="${x + w + 8}" y="${y}" class="${cls}">${esc(text)}</text>`);
  // Départ : pour la montée, la case du grimpeur est en bas ; pour la descente, en haut.
  const start = down ? 20 + step : base;
  const order = down ? model.cells.map((c, i) => ({ ...c, y: start + ((i + 1) * step) - step })) : model.cells.map((c, i) => ({ ...c, y: yOf(i + 1) }));
  // Descente : la case de départ (le grimpeur y est), en haut, non cliquable.
  if ( down ) {
    parts.push(`<rect class="cell start" x="${x}" y="${22}" width="${w}" height="${step - 4}" rx="3"/>`);
    label(20 + (step / 2) + 4, `${Math.round(model.feet * 10) / 10} ${model.units}`);
  }
  for ( const c of order ) {
    const cls = ["cell", c.choosable ? "reach" : "off", (c.n <= chosen) ? "sel" : ""].join(" ");
    parts.push(`<rect class="${cls}" data-cells="${c.choosable ? c.n : ""}" x="${x}" y="${c.y + 2}" width="${w}" height="${step - 4}" rx="3"/>`);
    label(c.y + (step / 2) + 4, `${Math.round(c.at * 10) / 10} ${model.units}`);
  }
  // Le sol (montée : sous la colonne ; descente : sous la dernière case).
  const groundY = down ? 20 + step + (n * step) : base;
  parts.push(`<line class="ground" x1="${x - 18}" y1="${groundY}" x2="${x + w + 8}" y2="${groundY}"/>`);
  label(groundY + 14, loc(down ? "Escalade.Jauge.SolBas" : "Escalade.Jauge.Sol"), "muted");
  // §216 : les séparations de niveaux (même à ciel ouvert), à leur hauteur — un rebord vu à la même hauteur porte déjà le nom.
  if ( !down ) {
    for ( const m of model.marks ?? [] ) {
      const y = base - (((m.at - model.feet) / model.distance) * step);
      parts.push(`<line class="level" x1="${x - 18}" y1="${y}" x2="${x + w + 4}" y2="${y}"/>`);
      parts.push(`<text x="${x - 20}" y="${y - 3}" text-anchor="end" class="level-text">${esc(m.name)}</text>`);
    }
  }
  // Le haut : à sa vraie hauteur (le rebord peut être sous le haut de la colonne) ; inconnu, au-dessus de la colonne.
  if ( !down ) {
    // Même échelle que les repères de niveaux : une hauteur `h` au-dessus des pieds de départ est à `base - (h / case) × pas`.
    const topY = (model.top && !model.hidden) ? (base - (((model.top.at - model.feet) / model.distance) * step) + 2) : (yOf(n) - 2);
    if ( model.hidden ) {
      parts.push(`<rect class="unknown" x="${x - 18}" y="${topY - 22}" width="${w + 36}" height="20" rx="3"/>`);
      parts.push(`<text x="${x + (w / 2)}" y="${topY - 8}" text-anchor="middle" class="unknown-text">?</text>`);
    } else if ( model.top?.kind === "ceiling" ) {
      parts.push(`<rect class="ceiling" x="${x - 18}" y="${topY - 10}" width="${w + 36}" height="8" rx="2"/>`);
    } else if ( model.top?.kind === "ledge" ) {
      parts.push(`<line class="ledge" x1="${x - 18}" y1="${topY - 6}" x2="${x + w + 18}" y2="${topY - 6}"/>`);
    }
  }
  // Le grimpeur, sur la case choisie (ou à son départ).
  const at = chosen ? order.find(c => c.n === chosen) : null;
  const cy = at ? at.y + (step / 2) : (down ? 20 + (step / 2) : base - (step / 2));
  parts.push(`<circle class="climber" cx="${x + (w / 2)}" cy="${cy}" r="${Math.max(6, Math.min(11, (step / 2) - 3))}"/>`);
  const svgHeight = Math.max(base, groundY) + 22;
  return `<svg class="das-climb-gauge" width="${GAUGE_WIDTH}" height="${svgHeight}" viewBox="0 0 ${GAUGE_WIDTH} ${svgHeight}">${parts.join("")}</svg>`;
}

/** Les lignes à droite de la jauge : hauteur visée, ce qu'il y a en haut, coût, chute, test des règles « maison ». */
function gaugeInfo(token, model, room, chosen, { down=false }={}) {
  const height = down ? (model.feet - (chosen * model.distance)) : (model.feet + (chosen * model.distance));
  const lines = [];
  lines.push(`<p class="aim">${esc(loc(down ? "Escalade.Jauge.Visee" : "Escalade.Jauge.Visee", { height: Math.round(height * 10) / 10, units: model.units, cells: chosen }))}</p>`);
  if ( !down ) {
    const top = model.top;
    const text = model.hidden ? loc("Escalade.Jauge.HautInconnu")
      : (top?.kind === "ledge") ? loc(top.name ? "Escalade.Jauge.Rebord" : "Escalade.Jauge.RebordSansNom", { height: top.at, units: model.units, level: top.name ?? "" })
      : (top?.kind === "ceiling") ? loc("Escalade.Jauge.Plafond", { height: top.at, units: model.units })
      : loc("Escalade.Jauge.SansPlafond");
    lines.push(`<p><i class="fa-solid ${model.hidden ? "fa-question" : top ? (top.kind === "ledge" ? "fa-stairs" : "fa-arrow-up-from-bracket") : "fa-cloud"}"></i> ${esc(text)}</p>`);
  }
  const cost = chosen * room.cost;
  lines.push(`<p class="muted">${esc(Number.isFinite(room.remaining)
    ? loc("Escalade.Jauge.Cout", { cost, units: model.units, left: room.remaining, factor: room.multiplier })
    : loc("Escalade.Jauge.CoutHorsCombat", { cost, units: model.units, factor: room.multiplier }))}</p>`);
  const fall = fallDice(height - model.ground, (model.units === "m") ? 3 : 10);
  lines.push(`<p class="muted">${esc(fall ? loc("Escalade.Jauge.Chute", { dice: `${fall}d6` }) : loc("Escalade.Jauge.ChuteSansDegats"))}</p>`);
  if ( !down && (climbRules() === "house") && !isClimbing(token) && !climbingOf(token).native ) lines.push(`<p class="warn">${esc(loc("Escalade.Jauge.Test", { dc: CLIMB_DC }))}</p>`);
  if ( model.cells.some(c => !c.choosable) ) lines.push(`<p class="warn">${esc(loc("Escalade.Jauge.Grisees"))}</p>`);
  return lines.join("");
}

/** La fenêtre « Combien de cases ? » (`down` : descendre) : la jauge du mur, une case choisie par un clic ; null si elle est annulée. */
async function askCells(token, room, { down=false }={}) {
  const model = gaugeFor(token, room, { down });
  if ( !model.choosable ) return null;
  // Par défaut : jusqu'au haut s'il est vu (sous le rebord, au plafond), jusqu'au sol en descente ; sinon (à l'aveugle, ciel ouvert) une case.
  let chosen = down ? model.choosable : (model.topCells || 1);
  const render = root => {
    const gauge = root.querySelector(".das-climb-gauge-wrap");
    const info = root.querySelector(".das-climb-info");
    if ( gauge ) gauge.innerHTML = gaugeSvg(model, chosen, { down });
    if ( info ) info.innerHTML = gaugeInfo(token, model, room, chosen, { down });
    const input = root.querySelector("input[name=cells]");
    if ( input ) input.value = String(chosen);
  };
  const content = `<div class="das-climb"><div class="das-climb-gauge-wrap"></div><div class="das-climb-side"><div class="das-climb-info"></div>
    <div class="form-group"><label>${loc("Escalade.Cases")}</label><input type="number" name="cells" min="1" max="${model.choosable}" step="1" value="${chosen}"></div></div></div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc(down ? "Escalade.TitreDescente" : "Escalade.Titre") }, content, rejectClose: false, position: { width: 590 },
    classes: ["dnd5e-combat-climb"],
    render: (event, dialog) => {
      const root = dialog.element;
      render(root);
      root.querySelector(".das-climb-gauge-wrap")?.addEventListener("click", ev => {
        const n = Number(ev.target?.dataset?.cells);
        if ( n >= 1 ) { chosen = n; render(root); }
      });
      root.querySelector("input[name=cells]")?.addEventListener("change", ev => {
        const n = Math.floor(Number(ev.target.value));
        if ( (n >= 1) && (n <= model.choosable) ) { chosen = n; render(root); }
      });
    },
    buttons: [
      { action: "climb", label: loc(down ? "Escalade.Descendre" : "Escalade.Monter"), icon: down ? "fa-solid fa-arrow-down" : "fa-solid fa-mountain", default: true,
        callback: () => chosen },
      { action: "cancel", label: loc("Escalade.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return Number.isFinite(answer) ? Math.floor(answer) : null;
}

/**
 * Le test des règles « maison » avant de partir (mur : DD 15 ; plafond : DD 20) — faux si le jet est raté. Déjà au mur, monter encore
 * ne refait pas le test du mur (il se refait à chaque tour) ; gagner le plafond, si.
 */
async function houseCheckPassed(token, dc) {
  const result = await handleClimbQuery({ token: token.uuid, configure: true, dc });
  if ( result?.success ) return true;
  notice(token, loc("Retour.Escalade.Rate"));
  log(`${token.name}: fails to climb (${result?.total ?? "no roll"} vs DC ${dc})`);
  return false;
}

/**
 * Grimper : la hauteur demandée (ou choisie dans la fenêtre), le test des règles « maison », puis le mode `climb` et la montée sur
 * place. Si le cœur refuse la montée (budget, plafond, mur de sort au-dessus), le mode d'avant est rendu.
 * @param {TokenDocument} token
 * `acrobatic` (§195, « Courir sur le mur ») : le Mouvement acrobatique du moine — sans test, drapeau `climb.acrobatic` ; il tombera s'il
 * finit son tour au mur.
 * @param {{cells?: number|null, acrobatic?: boolean}} [options]  Cases à monter, sans fenêtre (scénarios).
 * @returns {Promise<boolean>}
 */
export async function startClimb(token, { cells=null, acrobatic=false }={}) {
  if ( !canClimb(token) ) return false;
  if ( acrobatic && (isClimbing(token) || !acrobaticFor(token)) ) return false;
  const room = climbRoom(token);
  if ( room.max < 1 ) {
    ui.notifications.warn(loc((room.remaining < room.cost) ? "Escalade.PasDeDeplacement" : "Escalade.Plafond", { name: token.name }));
    return false;
  }
  const wanted = Number.isFinite(cells) ? Math.floor(cells) : await askCells(token, room);
  if ( !(wanted >= 1) ) return false;
  const n = Math.min(wanted, room.max);
  // §215 : le haut n'était pas vu — on a pu demander plus que le plafond ne laisse : la montée s'arrête là.
  if ( wanted > room.max ) notice(token, loc("Escalade.Bute"), "refused");
  const already = isClimbing(token);   // déjà au mur : on monte encore, sans nouveau test (il se refait à chaque tour)
  if ( !already && !acrobatic && (climbRules() === "house") && !climbingOf(token).native && !(await houseCheckPassed(token, CLIMB_DC)) ) return false;
  const grid = token.parent.grid;
  const from = token._source.elevation ?? 0;
  const mode = token._source.movementAction ?? null;
  if ( !already ) {
    const flag = { from: mode, checkedAt: Date.now(), ...(acrobatic ? { acrobatic: true } : {}) };
    await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: flag }, ALTITUDE_OPTIONS);
    // Le statut (et son immunité à la chute) avant la montée : posé par le MJ actif (`updateToken`, seul à l'écrire — deux clients qui
    // l'écrivaient se marchaient dessus) ; on l'attend, sinon dnd5e mettrait le grimpeur « En chute » entre la montée et le statut.
    await statusSettled(token, true);
  }
  await token.move([{ elevation: from + (n * grid.distance), action: "climb" }], { showRuler: rulerShown() });
  if ( Math.abs((token._source.elevation ?? 0) - from) < 1e-6 ) {
    if ( !already ) await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  notice(token, loc("Retour.Escalade.Grimpe"), "gain");
  log(`${token.name}: ${climbFlag(token)?.acrobatic ? "runs up the wall" : "climbs"} ${n} cell(s), ${from} → ${token._source.elevation} (${climbRules()}, ×${room.multiplier})`);
  return true;
}

/* -------------------------------------------- */
/*  Le plafond (lot 2)                          */
/* -------------------------------------------- */

/**
 * Ce token peut-il gagner le plafond : à soi, au mur (en escalade) ou au sol près d'un mur, un plafond au-dessus de lui, la capacité
 * (§192.3) ou les règles « maison » (DD 20), ni agrippé ni sans vitesse, pas déjà au plafond.
 */
export function canClimbCeiling(token) {
  if ( !token?.isOwner || !concerned(token) || isOnCeiling(token) ) return false;
  if ( !isClimbing(token) && (placementOf(token.movementAction) !== "ground") ) return false;
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  if ( !isClimbing(token) && !wallsNear(token).length ) return false;   // du sol, on monte le long d'un mur
  if ( !canWalkCeilingsAt(token) && (climbRules() !== "house") ) return false;   // §195 : pas par les Pantoufles sur une surface glissante
  return ceilingPerchFor(token) !== null;
}

/**
 * Ce qu'il faut pour gagner le plafond d'ici : le perchoir (pieds), les cases à monter, et si le budget du tour les paie.
 * @returns {{perch: number, cells: number, affordable: boolean, room: object}|null}
 */
export function ceilingRoom(token) {
  const perch = ceilingPerchFor(token);
  if ( perch === null ) return null;
  const grid = token.parent.grid;
  const room = climbRoom(token);
  const cells = Math.max(0, Math.ceil(((perch - (token._source.elevation ?? 0)) / grid.distance) - 1e-6));
  return { perch, cells, affordable: cells <= room.max, room };
}

/**
 * « Grimper au plafond » : le test des règles « maison » (DD 20, sans la capacité), le mode `climb` (du sol), la montée jusqu'au
 * plafond moins la hauteur du token, puis le drapeau `climb.ceiling` — le MJ actif pose alors le statut « Au plafond » et retourne
 * le token. Refusé par le cœur (budget, plafond), tout est rendu.
 * @returns {Promise<boolean>}
 */
export async function climbToCeiling(token) {
  if ( !canClimbCeiling(token) ) return false;
  const need = ceilingRoom(token);
  if ( !need ) return false;
  if ( !need.affordable ) {
    ui.notifications.warn(loc("Escalade.PasDeDeplacement", { name: token.name }));
    return false;
  }
  if ( (climbRules() === "house") && !canWalkCeilingsAt(token) && !(await houseCheckPassed(token, CEILING_DC)) ) return false;
  const already = isClimbing(token);
  const from = token._source.elevation ?? 0;
  const mode = token._source.movementAction ?? null;
  if ( !already ) {
    await token.update({ movementAction: "climb", [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { from: mode, checkedAt: Date.now() } }, ALTITUDE_OPTIONS);
    await statusSettled(token, true);
  }
  if ( need.cells > 0 ) await token.move([{ elevation: need.perch, action: "climb" }], { showRuler: rulerShown() });
  if ( Math.abs((token._source.elevation ?? 0) - need.perch) > 1e-6 ) {
    if ( !already ) await token.update({ movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  const { acrobatic: _run, ...kept } = climbFlag(token) ?? { from: mode };   // au plafond, on ne court plus sur le mur
  await token.update({ [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { ...kept, checkedAt: Date.now(), ceiling: true } }, ALTITUDE_OPTIONS);
  await statusSettled(token, true);
  notice(token, loc("Retour.Escalade.AuPlafond"), "gain");
  log(`${token.name}: reaches the ceiling (${from} → ${need.perch}, ${climbRules()})`);
  return true;
}

/** Ce grimpeur (au mur ou au plafond) peut-il redescendre le long d'un mur : à soi, en escalade, au-dessus du sol, près d'un mur. */
export function canClimbDown(token) {
  if ( !token?.isOwner || !concerned(token) || !isClimbing(token) || !aboveGround(token) ) return false;
  if ( isGrappled(token) || climbFallReasonFor(token) ) return false;
  return wallsNear(token).length > 0;
}

/** Ce que ce grimpeur peut descendre maintenant : cases au plus (budget du tour, hauteur au-dessus du sol), coût d'une case. */
export function descentRoom(token) {
  const grid = token.parent.grid;
  const room = climbRoom(token);
  const height = Math.max(0, (token._source.elevation ?? 0) - groundUnder(token));
  const max = climbableCells({ remaining: room.remaining, gridDistance: grid.distance, multiplier: room.multiplier, ceilingCells: height / grid.distance });
  return { ...room, max };
}

/**
 * « Descendre le long du mur » : depuis le plafond (le drapeau `ceiling` tombe d'abord : statut et miroir rendus par le MJ actif) ou
 * depuis le mur, N cases vers le bas en `climb`, payées comme la montée ; revenu au sol, le MJ actif rend le mode d'avant.
 * @param {TokenDocument} token
 * @param {{cells?: number|null}} [options]
 * @returns {Promise<boolean>}
 */
export async function climbDown(token, { cells=null }={}) {
  if ( !canClimbDown(token) ) return false;
  const room = descentRoom(token);
  if ( room.max < 1 ) {
    ui.notifications.warn(loc("Escalade.PasDeDeplacement", { name: token.name }));
    return false;
  }
  const wanted = Number.isFinite(cells) ? Math.floor(cells) : await askCells(token, room, { down: true });
  if ( !(wanted >= 1) ) return false;
  const n = Math.min(wanted, room.max);
  const grid = token.parent.grid;
  const from = token._source.elevation ?? 0;
  if ( isOnCeiling(token) ) {
    await token.update({ [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: { ...(climbFlag(token) ?? {}), ceiling: false } }, ALTITUDE_OPTIONS);
    await statusSettled(token, true);
  }
  await token.move([{ elevation: from - (n * grid.distance), action: "climb" }], { showRuler: rulerShown() });
  if ( Math.abs((token._source.elevation ?? 0) - from) < 1e-6 ) {
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  log(`${token.name}: climbs down ${n} cell(s), ${from} → ${token._source.elevation}`);
  return true;
}

/**
 * §209 : se hisser du mur sur un rebord (toit, chemin de ronde, étage) — la case voisine dont le sol est à portée de la tête
 * (`ledgesOf`). Le token y prend pied par un pas `displace` (par-dessus le haut du mur : ni murs ni Surfaces ne l'arrêtent), sur le
 * niveau de ce sol (le sol à 20 ft d'un niveau 0-20 est le bas du suivant) ; en combat, la hauteur restante au prix de l'escalade plus
 * une case (`ledgeCost`), comptée au budget (`climbed`, comme un escalier). Puis le mode au sol, le drapeau d'escalade retiré, et la vue
 * suit le token à l'étage. Sur le client de son propriétaire.
 * @param {TokenDocument} token
 * @param {{dir: string, x: number, y: number, ground: number, rise: number, level: string}} ledge
 */
export async function hoistOnto(token, ledge) {
  if ( !token?.isOwner || !ledge ) return false;
  const grid = token.parent.grid;
  const cost = ledgeCost({ rise: ledge.rise, multiplier: climbingOf(token).multiplier, gridDistance: grid.distance });
  const combatant = combatantFor(token.actor);
  if ( combatant ) {
    const { spent, excluded } = historyCosts(token);
    const left = movementCap(token) - spent - excluded;
    if ( cost > left + 1e-6 ) {
      ui.notifications.warn(loc("Escalade.HisserPasAssez", { name: token.name, cost: `${cost} ${grid.units}`, left: `${Math.max(0, Math.floor(left * 10) / 10)} ${grid.units}` }));
      return false;
    }
  }
  const from = token._source.level;
  const step = { x: ledge.x, y: ledge.y, elevation: ledge.ground, action: "displace", ...((ledge.level !== from) ? { level: ledge.level } : {}) };
  await token.move([step], { [MODULE_ID]: { altitude: true, planned: true, cleared: true }, constrainOptions: { ignoreWalls: true } });
  if ( Math.abs((token._source.elevation ?? 0) - ledge.ground) > 1e-6 ) {
    ui.notifications.warn(loc("Escalade.Impossible", { name: token.name }));
    return false;
  }
  if ( combatant ) {
    const budget = readBudget(combatant);
    await writeBudget(combatant, { ...budget, climbed: (Number(budget.climbed) || 0) + cost });
  }
  await token.update({ movementAction: groundModeFor(token), [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
  if ( (token._source.level !== from) && token.parent.isView && (canvas.level?.id === from) && token.object?.controlled ) {
    await token.parent.view({ level: token._source.level, controlledTokens: [token.id] });
  }
  notice(token, loc("Retour.Escalade.Hisse"));
  await say({ token }, locEsc("Escalade.SeHisse", { name: token.name }));
  log(`${token.name}: hoists up onto the ledge (${ledge.dir}, ${ledge.rise} up, level ${from} → ${token._source.level}, ${combatant ? `${cost} of movement` : "out of combat"})`);
  return true;
}

/**
 * Le miroir vertical d'un token au plafond, tenu par le MJ actif (§192.4 point 8) : `texture.scaleY` inversé en arrivant au plafond
 * (l'échelle d'origine gardée dans `flags.dnd5e-combat.ceilingFlip`), rendu dès qu'il n'y est plus (descente, chute, mode changé) —
 * seulement si le réglage « Orienter les tokens dans le sens du mouvement » est inactif (avec lui, le token tourne déjà). En file par
 * token : deux mises à jour qui se suivent ne l'écrivent pas en même temps.
 */
const syncFlip = token => enqueue(`climb-flip:${token.uuid}`, async () => {
  const kept = token.getFlag(MODULE_ID, FLIP_FLAG) ?? null;
  const wanted = isOnCeiling(token) && !settingOr(FACING_SETTING, true);
  if ( wanted && !kept ) {
    const scaleY = token._source.texture?.scaleY ?? 1;
    await token.update({ "texture.scaleY": flippedScale(scaleY), [`flags.${MODULE_ID}.${FLIP_FLAG}`]: { scaleY } }, ALTITUDE_OPTIONS);
    log(`${token.name}: upside down on the ceiling (scaleY ${scaleY} → ${flippedScale(scaleY)})`);
  }
  else if ( !wanted && kept ) {
    await token.update({ "texture.scaleY": Number(kept.scaleY) || 1, [`flags.${MODULE_ID}.${FLIP_FLAG}`]: null }, ALTITUDE_OPTIONS);
    log(`${token.name}: back the right way up (scaleY ${kept.scaleY})`);
  }
}).catch(err => console.error(`${MODULE_ID} | ceiling flip`, err));

/**
 * Un joueur au plafond ne sort pas de sous le plafond en marchant (règles 2024 : on y reste accroché tant qu'il y a un plafond ; en
 * mode « maison », il en sort et tombe — `onTokenUpdated`). Les déplacements du moteur (`altitude`, `forced`), les téléportations, la
 * chute et le MJ passent.
 */
function onPreMoveToken(token, movement, operation) {
  if ( !isClimbing(token) || !concerned(token) ) return true;
  const flags = operation?.[MODULE_ID] ?? continuedFlags(token, movement);
  if ( flags?.altitude || flags?.forced || operation?.isUndo || game.user.isGM || (climbRules() === "house") ) return true;
  const walking = w => !CONFIG.Token.movement.actions[w.action]?.teleport && !["displace", "fall"].includes(w.action);
  const steps = movement.pending.waypoints.filter(walking);
  // §196 : au mur, pas de pas loin du mur (en l'air) — on redescend ou on se laisse tomber, comme au plafond.
  if ( !isOnCeiling(token) ) {
    if ( !steps.some(w => !holdsWallAt(token, positionOf(w))) ) return true;
    ui.notifications.warn(loc("Escalade.MurFini", { name: token.name }));
    notice(token, loc("Retour.Escalade.MurFini"));
    return false;
  }
  const off = steps.find(w => !hangsAt(token, positionOf(w)));
  // §195 : celui qui ne tient au plafond que par les Pantoufles n'avance pas au-dessus d'une surface glissante.
  const slips = !off && steps.find(w => !canWalkCeilingsAt(token, positionOf(w)));
  if ( !off && !slips ) return true;
  const key = off ? "PlafondFini" : "Glissant";
  ui.notifications.warn(loc(`Escalade.${key}`, { name: token.name }));
  notice(token, loc(`Retour.Escalade.${key}`));
  return false;
}

/**
 * §196 : un grimpeur au mur tient-il à cette position (point de passage) : un mur à grimper le touche, ou le sol y remonte jusqu'à lui.
 * Le même jugement que l'A* (adapter/path-world.mjs `wallHolds`).
 */
function holdsWallAt(token, pos) {
  const elevation = pos.elevation ?? token._source.elevation ?? 0;
  if ( elevation <= groundUnder(token, pos) + 1e-6 ) return true;
  return wallsNear(token, { ...pos, elevation }).length > 0;
}

/* -------------------------------------------- */
/*  Tomber, atterrir                            */
/* -------------------------------------------- */

/** Le mode au sol qu'un grimpeur reprend : celui d'avant l'escalade (un vol accordé entre-temps : la marche). */
function groundModeFor(token) {
  const from = climbFlag(token)?.from ?? null;
  if ( ["air", "under"].includes(placementOf(from)) ) return groundModeOf(token.actor);
  return from;
}

/** La fin de l'animation de déplacement du token (au plus `ms`), sinon on l'arrête : l'élévation visuelle rejoint la source. */
async function settleAnimation(token, ms=5000) {
  const animation = token.object?.movementAnimationPromise;
  if ( animation ) await Promise.race([animation, new Promise(resolve => setTimeout(resolve, ms))]);
  if ( Math.abs((token.elevation ?? 0) - (token._source.elevation ?? 0)) > 1e-6 ) token.object?.stopAnimation?.();
}

/**
 * La chute de dnd5e : `updateFalling` pose l'état « En chute » d'après la surface sous le token et ses vitesses, puis `plummet` le fait
 * tomber jusqu'à cette surface et poste la carte de dégâts (1d6 par 10 ft ; le moteur l'applique, `onFallCard`, d'où À terre). Vrai si
 * le token est tombé. Sur un client qui peut modifier le token. Sert aussi à l'Inversion de la gravité (§195).
 */
export async function fallLikeDnd5e(token) {
  // §208 : une seule chute à la fois par token — l'escalade et la chute automatique (runtime/falls.mjs) peuvent la demander ensemble
  // (deux `plummet` en même temps : deux cartes de dégâts).
  if ( plummeting.has(token.uuid) ) return false;
  plummeting.add(token.uuid);
  try { return await plummetOnce(token); }
  finally { plummeting.delete(token.uuid); }
}
const plummeting = new Set();

async function plummetOnce(token) {
  if ( typeof token.updateFalling === "function" ) await token.updateFalling();
  if ( !token.actor?.statuses?.has("falling") || (typeof token.plummet !== "function") ) return false;
  // `plummet` mesure la chute depuis l'élévation VISUELLE du token (documents/token.mjs : `this.elevation`, qui suit l'animation) :
  // lâché juste après la montée, le token n'était visuellement qu'à 1,5 ft et la chute ne faisait aucun dégât (vu le 2026-10-17).
  // On attend la fin de l'animation en cours (jamais dans un onglet masqué : au plus 5 s, puis on l'arrête).
  await settleAnimation(token);
  await token.plummet();   // dnd5e retire lui-même « En chute » après le déplacement de chute (`_onUpdateMovement`)
  return true;
}

/**
 * Le grimpeur lâche le mur : son mode d'avant, puis la chute de dnd5e s'il est en l'air (`updateFalling` pose l'état « En chute »
 * d'après la surface sous lui et ses vitesses ; `plummet` le fait tomber, dégâts compris). Une créature qui vole reste en l'air, en vol.
 * Sur un client qui peut modifier le token (son propriétaire, le MJ).
 */
async function letGo(token) {
  const mode = groundModeFor(token);
  // Mis À terre, le token est déjà en mode ramper (runtime/prone.mjs, même hook, ordre libre) : on garde ramper, et le mode que le
  // relevé rendra est celui d'avant l'escalade, pas `climb`.
  const crawling = token._source.movementAction === "crawl";
  const changes = crawling
    ? { [`flags.${MODULE_ID}.crawl.from`]: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }
    : { movementAction: mode, [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null };
  await token.update(changes, { [MODULE_ID]: { altitude: true, forced: true } });
  // Le statut doit être parti avant la chute : il porte l'immunité, dnd5e ne ferait pas tomber le grimpeur avec (le MJ actif le retire
  // sur la mise à jour du token : mode ou drapeau).
  await statusSettled(token, false);
  if ( !aboveGround(token) ) return "ground";
  if ( await fallLikeDnd5e(token) ) return "fell";
  if ( !modeRefusalFor(token.actor, "fly") ) {
    await token.update({ movementAction: "fly" }, ALTITUDE_OPTIONS);
    return "flies";
  }
  return "stays";
}

/** « Se laisser tomber » (menu) : chute volontaire. */
export async function dropDown(token) {
  if ( !token?.isOwner || !isClimbing(token) ) return false;
  const ceiling = isOnCeiling(token);
  const outcome = await letGo(token);
  if ( outcome === "fell" ) await say({ token }, locEsc(ceiling ? "Escalade.SeLaisseTomberPlafond" : "Escalade.SeLaisseTomber", { name: token.name }));
  log(`${token.name}: lets go of the ${ceiling ? "ceiling" : "wall"} (${outcome})`);
  return true;
}

/** Les tokens en train de tomber : un même effet (À terre) passe par plusieurs hooks, la chute ne se joue qu'une fois. */
const falling = new Set();

/** §208 : l'escalade fait-elle tomber ce token en ce moment ? La chute automatique (runtime/falls.mjs) s'efface alors. */
export const climbFallInProgress = token => falling.has(token?.id) || plummeting.has(token?.uuid);

/** Un grimpeur qui ne tient plus (À terre, Neutralisé, Agrippé, sans vitesse, plus de plafond) ou qui rate son test tombe. MJ actif. */
async function fall(token, reason) {
  if ( falling.has(token.id) ) return;
  falling.add(token.id);
  try {
    notice(token, loc("Retour.Escalade.Tombe"));
    const ceiling = isOnCeiling(token);
    const outcome = await letGo(token);
    await say({ token }, locEsc(ceiling ? "Escalade.ChutePlafond" : "Escalade.Chute", { name: token.name, reason: loc(`Escalade.Raison.${reason}`) }));
    log(`${token.name}: falls off the ${ceiling ? "ceiling" : "wall"} (${reason}: ${outcome})`);
  } finally { falling.delete(token.id); }
}

/** Un grimpeur : en mode `climb`, ou déjà passé en mode ramper par À terre mais encore au mur (le drapeau d'escalade est là). */
const climber = token => isClimbing(token) || !!climbFlag(token);

/** Les grimpeurs de cet acteur qui ne tiennent plus au mur tombent. MJ actif. */
async function checkClimbers(actor) {
  for ( const token of tokensOf(actor) ) {
    if ( !climber(token) || !concerned(token) ) continue;
    const reason = climbFallReasonFor(token);
    if ( reason ) await fall(token, reason);
  }
}

/** Les statuts de prise que le moteur tient : « En escalade » au mur, « Au plafond » au plafond (jamais les deux). */
const HOLD_STATUSES = [MODE_STATUSES.climbing.id, MODE_STATUSES.ceiling.id];
const holds = token => HOLD_STATUSES.some(id => token.actor?.statuses?.has(id));

/**
 * Les statuts « En escalade » / « Au plafond » suivent le mode et le drapeau — écrits par le MJ actif seulement, en file par acteur :
 * deux mises à jour qui se suivent (le mode ramper d'À terre, le drapeau retiré par la chute) ne retirent pas le même effet en même temps
 * (« ActiveEffect … does not exist »). Le statut qui arrive est posé AVANT que l'autre ne parte : entre les deux, le grimpeur garderait
 * sinon un instant sans immunité à « En chute », que dnd5e réévalue à chaque changement d'effet.
 */
const syncStatus = token => enqueue(`climb-status:${token.actor?.uuid}`, async () => {
  const climbing = isClimbing(token);
  const wanted = { [MODE_STATUSES.climbing.id]: climbing && !isOnCeiling(token), [MODE_STATUSES.ceiling.id]: climbing && isOnCeiling(token) };
  for ( const [id, on] of Object.entries(wanted) ) if ( on ) await setStatus(token.actor, id, true);
  for ( const [id, on] of Object.entries(wanted) ) if ( !on ) await setStatus(token.actor, id, false);
}).catch(() => {});

/** Le client du grimpeur attend que le MJ actif ait posé (ou retiré) un statut de prise — au plus `ms` ; sans MJ actif, on n'attend pas. */
async function statusSettled(token, wanted, ms=3000) {
  if ( !game.users.activeGM ) return false;
  const until = Date.now() + ms;
  const settled = () => wanted ? (holds(token) && (token.actor?.statuses?.has(MODE_STATUSES.ceiling.id) === isOnCeiling(token))) : !holds(token);
  while ( !settled() && (Date.now() < until) ) await new Promise(resolve => setTimeout(resolve, 50));
  return settled();
}

/**
 * MJ actif, sur chaque mise à jour d'un token : les statuts et le miroir suivent le mode et le drapeau ; un grimpeur revenu au sol
 * (descendu le long du mur) reprend son mode d'avant ; un marcheur de plafond arrivé là où il n'y a plus de plafond à sa hauteur
 * (glissé par le MJ, ou sorti en mode « maison ») tombe.
 */
async function onTokenUpdated(token, changes) {
  if ( !token.actor || !concerned(token) ) return;
  const moved = ["x", "y", "elevation", "level"].some(k => k in changes);
  const flagged = ("movementAction" in changes) || (changes.flags?.[MODULE_ID] && (CLIMB_FLAG in changes.flags[MODULE_ID]));
  if ( flagged ) {
    await syncStatus(token);
    await syncFlip(token);
  }
  if ( moved && isClimbing(token) && !aboveGround(token) ) {
    await token.update({ movementAction: groundModeFor(token), [`flags.${MODULE_ID}.${CLIMB_FLAG}`]: null }, ALTITUDE_OPTIONS);
    log(`${token.name}: back on the ground, climbing over`);
    return;
  }
  // §196 : glissé loin du mur par le MJ (ou en mode « maison »), le grimpeur lâche prise.
  if ( moved && isClimbing(token) && !isOnCeiling(token) && !holdsWallAt(token, positionOf(token._source)) ) await fall(token, "noWall");
  else if ( moved && isOnCeiling(token) && !hangsAt(token) ) await fall(token, "noCeiling");
  // §195 : règles 2024, au plafond par les seules Pantoufles au-dessus d'une surface glissante (glissé là par le MJ) : il tombe. En mode
  // « maison », il reste — le DD 20 est alors dû, comme pour qui n'a pas la capacité (`checkWanted`).
  else if ( moved && isOnCeiling(token) && (climbRules() !== "house") && !canWalkCeilingsAt(token) ) await fall(token, "slippery");
}

/**
 * La carte de dégâts de chute de dnd5e (`postFallDamage`, rules/falling.mjs:36 : `flags.dnd5e.context.fall`, cibles dans
 * `system.targets`) n'applique rien d'elle-même — c'est le plateau de dégâts du MJ. Le moteur l'applique aux cibles, par
 * `applyDamage` avec la carte pour origine : dnd5e lit alors son contexte et met À terre (`applyFallProne`, attributes.mjs:684).
 * MJ actif, une fois par carte.
 */
async function onFallCard(message) {
  if ( message.getFlag("dnd5e", "context")?.fall !== true || message.getFlag(MODULE_ID, "fallApplied") ) return;
  const targets = Array.from(message.system?.targets ?? []);
  const damages = (message.rolls ?? []).filter(r => Number.isFinite(r.total)).map(r => ({ value: r.total, type: r.options?.type ?? "bludgeoning" }));
  if ( !targets.length || !damages.length ) return;
  await message.setFlag(MODULE_ID, "fallApplied", true);
  await waitForDice(message);
  for ( const target of targets ) {
    // Un descripteur de cible de dnd5e porte l'uuid du token (`uuid`) — ou, selon la version, sous `token`.
    const doc = fromUuidSync(target.uuid ?? target.token ?? "", { strict: false });
    const actor = (doc?.documentName === "Actor") ? doc : (doc?.actor ?? null);
    if ( !actor ) continue;
    await actor.applyDamage(damages, { origin: message });
    log(`${actor.name}: fall damage applied (${damages.map(d => d.value).join(" + ")})`);
  }
}

/* -------------------------------------------- */
/*  Le test des règles « maison »               */
/* -------------------------------------------- */

/**
 * Côté de celui qui grimpe : le test de Force (Athlétisme) — DD 15 au mur, DD 20 au plafond —, dans la fenêtre de jet de dnd5e (où
 * l'interface propose ses aides, §113) ; fermée ou au délai, lancé sans fenêtre. Rend `{ total, success }`, ou null sans jet.
 */
export async function handleClimbQuery({ token: uuid, configure=true, dc=CLIMB_DC }) {
  const token = await fromUuid(uuid);
  const actor = token?.actor;
  if ( !actor ) return null;
  ui.notifications.info(loc((dc === CEILING_DC) ? "Escalade.TestPlafond" : "Escalade.Test", { name: token.name, dc }));
  const cancel = configure ? closeRollDialogAfter(actor, () => {}) : () => {};
  let rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: dc }, { configure });
  cancel();
  if ( !rolls?.length && configure ) rolls = await actor.rollSkill({ skill: "ath", ability: "str", target: dc }, { configure: false });
  const total = rolls?.[0]?.total;
  return Number.isFinite(total) ? { total, success: total >= dc } : null;
}

const busy = new Set();

/** Le DD du test périodique de ce grimpeur : 20 au plafond, 15 au mur. */
const checkDcOf = token => (isOnCeiling(token) ? CEILING_DC : CLIMB_DC);

/** MJ actif : le test demandé au joueur qui possède le grimpeur (chez lui), sinon lancé ici ; un échec fait tomber. */
async function requestClimbCheck(token) {
  if ( busy.has(token.id) ) return;
  busy.add(token.id);
  try {
    await token.setFlag(MODULE_ID, CLIMB_FLAG, { ...(climbFlag(token) ?? {}), checkedAt: Date.now() });
    const dc = checkDcOf(token);
    const userId = rollerFor(token.actor);
    const user = userId ? game.users.get(userId) : null;
    let result = null;
    if ( user && !user.isSelf ) result = await user.query(CLIMB_QUERY, { token: token.uuid, dc }, { timeout: CHECK_TIMEOUT_MS }).catch(() => null);
    if ( !result ) result = await handleClimbQuery({ token: token.uuid, configure: false, dc });
    if ( !isClimbing(token) ) return;
    if ( result && !result.success ) await fall(token, "check");
    else log(`${token.name}: holds on to the ${isOnCeiling(token) ? "ceiling" : "wall"} (${result?.total ?? "no roll"} vs DC ${dc})`);
  } finally { busy.delete(token.id); }
}

/**
 * Le test est-il dû pour ce grimpeur (règles « maison ») ? Pas avec une vraie vitesse d'escalade ; au plafond, pas non plus avec la
 * capacité d'y marcher (Pattes d'araignée, Pantoufles…).
 */
const checkWanted = token => (climbRules() === "house") && isClimbing(token) && concerned(token) && !climbingOf(token).native
  && !climbFlag(token)?.acrobatic && !(isOnCeiling(token) && canWalkCeilingsAt(token));

/**
 * Changement de tour, MJ actif : le moine qui finissait son tour en courant sur le mur tombe (§195, Mouvement acrobatique : « pendant
 * votre tour ») ; puis le tour d'un grimpeur commence : son test (règles « maison »).
 */
async function onTurnChange(combat, prior) {
  const ended = prior?.combatantId ? combat.combatants.get(prior.combatantId)?.token : null;
  if ( ended && concerned(ended) && acrobaticFallDue({ acrobatic: !!climbFlag(ended)?.acrobatic, climbing: isClimbing(ended),
    aboveGround: aboveGround(ended), onCeiling: isOnCeiling(ended) }) ) await fall(ended, "acrobatic");
  const token = combat.combatant?.token;
  if ( !token || !checkWanted(token) ) return;
  await requestClimbCheck(token);
}

/** Hors combat, toutes les 10 s. MJ actif, scène affichée. */
function tick() {
  if ( !isExecutor() || !canvas?.ready || game.combat?.started || (climbRules() !== "house") ) return;
  for ( const token of canvas.scene?.tokens ?? [] ) {
    if ( !checkWanted(token) || !climbCheckDue(climbFlag(token)?.checkedAt, Date.now(), CLIMB_CHECK_SECONDS * 1000) ) continue;
    requestClimbCheck(token).catch(err => console.error(`${MODULE_ID} | climb check`, err));
  }
}

/* -------------------------------------------- */

/**
 * Les entrées du menu de son propre token : « Grimper au mur » près d'un mur, « Courir sur le mur » pour le moine (§195), « Grimper au
 * plafond » sous un plafond (capacité ou règles maison), « Descendre le long du mur » en escalade près d'un mur, « Se laisser tomber » en
 * escalade.
 */
export function climbEntries(token) {
  const entries = [];
  if ( canClimb(token) ) entries.push({ icon: "fa-solid fa-mountain", label: loc("Menu.Grimper"), run: () => startClimb(token) });
  if ( canClimb(token) && !isClimbing(token) && acrobaticFor(token) ) {
    entries.push({ icon: "fa-solid fa-person-running", label: loc("Menu.CourirMur"), run: () => startClimb(token, { acrobatic: true }) });
  }
  if ( canClimbCeiling(token) ) entries.push({ icon: "fa-solid fa-spider", label: loc("Menu.GrimperPlafond"), run: () => climbToCeiling(token) });
  if ( canClimbDown(token) ) entries.push({ icon: "fa-solid fa-arrow-down", label: loc("Menu.DescendreMur"), run: () => climbDown(token) });
  // §209 : se hisser sur un rebord à portée — une entrée par direction quand il y en a plusieurs.
  if ( token?.isOwner ) {
    const ledges = ledgesOf(token);
    for ( const ledge of ledges ) {
      const label = (ledges.length > 1) ? loc("Menu.SeHisserVers", { dir: loc(`Escalade.Dir.${ledge.dir}`) }) : loc("Menu.SeHisser");
      entries.push({ icon: "fa-solid fa-person-through-window", label, run: () => hoistOnto(token, ledge) });
    }
  }
  // §216 : s'agripper au bord pour descendre — une entrée par direction quand il y en a plusieurs.
  if ( token?.isOwner && concerned(token) && !isGrappled(token) && !climbFallReasonFor(token) ) {
    const edges = edgesBelowOf(token);
    for ( const edge of edges ) {
      const label = (edges.length > 1) ? loc("Menu.SAgripperVers", { dir: loc(`Escalade.Dir.${edge.dir}`) }) : loc("Menu.SAgripper");
      entries.push({ icon: "fa-solid fa-person-arrow-down-to-line", label, run: () => grabEdge(token, edge) });
    }
  }
  if ( token?.isOwner && isClimbing(token) ) entries.push({ icon: "fa-solid fa-person-falling", label: loc("Menu.SeLaisserTomber"), run: () => dropDown(token) });
  return entries;
}

/* -------------------------------------------- */
/*  API publique (§196, lot 4 : les voisins)    */
/* -------------------------------------------- */

const docOf = token => token?.document ?? token ?? null;

/**
 * §196 : l'état d'escalade d'un token, pour une interface ou une IA — ce que le moteur tient (mode, drapeau, statut) et ce que son menu
 * proposerait maintenant. null sans token ni acteur.
 * @param {Token|TokenDocument} token
 * @returns {{climbing: boolean, onCeiling: boolean, acrobatic: boolean, elevation: number, height: number, units: string, speed: number,
 *   native: boolean, multiplier: number, walksCeilings: boolean, rules: "2024"|"house", canClimb: boolean, canRun: boolean,
 *   canCeiling: boolean, canDown: boolean, canDrop: boolean}|null}
 */
export function climbStateOf(token) {
  const doc = docOf(token);
  if ( !doc?.actor || !doc.parent?.grid ) return null;
  const climbing = isClimbing(doc);
  const speeds = climbingOf(doc);
  const elevation = doc._source.elevation ?? 0;
  let ground = elevation;
  try { ground = groundUnder(doc); } catch { /* scène sans niveaux ni surfaces : le sol est là où il est */ }
  return {
    climbing, onCeiling: isOnCeiling(doc), acrobatic: climbing && (climbFlag(doc)?.acrobatic === true),
    elevation, height: Math.max(0, elevation - ground), units: doc.parent.grid.units,
    speed: speeds.speed ?? 0, native: !!speeds.native, multiplier: speeds.multiplier ?? 1, walksCeilings: canWalkCeilings(doc.actor),
    rules: climbRules(), canClimb: canClimb(doc), canRun: canClimb(doc) && !climbing && acrobaticFor(doc),
    canCeiling: canClimbCeiling(doc), canDown: canClimbDown(doc), canDrop: !!doc.isOwner && climbing,
    // §209 : les rebords où il peut se hisser (direction, sol, hauteur à monter, niveau d'arrivée).
    ledges: ledgesOf(doc).map(({ dir, ground, rise, level }) => ({ dir, ground, rise, level }))
  };
}

/**
 * §196 : ce grimpeur tiendrait-il sur cette case (coin haut-gauche, à sa hauteur) — au mur, un mur à grimper la touche ; au plafond, le
 * plafond y est à sa hauteur (et ne glisse pas sous des Pantoufles) ? Toujours vrai pour qui ne grimpe pas. Pour une marche case par
 * case (manette) : l'A* du moteur applique le même jugement.
 * @param {Token|TokenDocument} token
 * @param {{i: number, j: number}} cell
 */
export function climbHoldsAt(token, cell) {
  const doc = docOf(token);
  if ( !doc || !isClimbing(doc) || !cell ) return true;
  const pos = { ...doc.parent.grid.getTopLeftPoint(cell), elevation: doc._source.elevation ?? 0, level: doc._source.level };
  if ( isOnCeiling(doc) ) return hangsAt(doc, pos) && canWalkCeilingsAt(doc, pos);
  return holdsWallAt(doc, pos);
}

/** Les cases d'où grimper vers une cible : à `reach` cases d'elle au plus (sur la carte), contre un mur, du même côté du mur qu'elle. */
function climbSpotsToward(token, target, reach) {
  const scene = token.parent;
  const grid = scene.grid;
  const { sceneX, sceneY, sceneWidth, sceneHeight } = scene.dimensions;
  const top = grid.getOffset({ x: sceneX + 1, y: sceneY + 1 });
  const bottom = grid.getOffset({ x: sceneX + sceneWidth - 1, y: sceneY + sceneHeight - 1 });
  const bounds = { i0: top.i, j0: top.j, i1: bottom.i, j1: bottom.j };
  const elevation = token._source.elevation ?? 0;
  const level = token._source.level;
  const goal = tokenCenter(target);
  const spots = [];
  for ( let gap = 0; gap < reach; gap++ ) {
    for ( const cell of cellsAtGap(footprintOf(target), sizeOf(token), gap, bounds) ) {
      const pos = { ...grid.getTopLeftPoint(cell), elevation, level };
      if ( !wallsNear(token, pos).length ) continue;
      if ( rayBlocker(token, target, { posA: pos })(tokenCenter(token, pos), goal) ) continue;   // derrière le mur : pas le même côté
      spots.push(cell);
    }
  }
  return spots;
}

/**
 * §196 : rejoindre une cible hors d'allonge par le vide vertical (au mur, au plafond près d'un mur) en grimpant — le cas simple : aller
 * au pied du mur à côté d'elle (`api.approach`, dans le budget du tour), puis monter le moins de cases qui la mettent à `reachCells`
 * (l'escalade du menu, payée au budget : ×2 sans vitesse d'escalade ; test DD 15 en mode « maison »). Ne décide pas qui doit grimper :
 * l'appelant (une IA) choisit. Rend `{ arrived, climbed, reason? }` — `reason` : `notOwner`, `noWall` (aucun mur à côté d'elle, de son
 * côté), `cannotClimb`, `tooHigh` (même au plus haut, encore hors d'allonge), `refused` (montée refusée ou test raté), ou ce que rend
 * la marche (`noPath`, `exhausted`, `stopped`…).
 * @param {Token|TokenDocument} token
 * @param {Token|TokenDocument} target
 * @param {{reachCells?: number}} [options]
 */
export async function climbToward(token, target, { reachCells=1 }={}) {
  token = docOf(token);
  target = docOf(target);
  if ( !token?.isOwner || !target ) return { arrived: false, climbed: 0, reason: "notOwner" };
  const reach = Math.max(1, Math.round(reachCells) || 1);
  const there = () => ((token._source.level ?? null) === (target._source.level ?? null)) && (gapCells(token, target) <= reach);
  if ( there() ) return { arrived: true, climbed: 0 };
  if ( isOnCeiling(token) ) return { arrived: false, climbed: 0, reason: "cannotClimb" };
  const spots = climbSpotsToward(token, target, reach);
  if ( !spots.length ) return { arrived: false, climbed: 0, reason: "noWall" };
  const here = cellOf(token);
  if ( !spots.some(c => (c.i === here.i) && (c.j === here.j)) ) {
    const walked = await approach(token, { cells: spots });
    if ( !walked.arrived ) return { climbed: 0, ...walked };
    if ( there() ) return { arrived: true, climbed: 0 };
  }
  if ( !canClimb(token) ) return { arrived: false, climbed: 0, reason: "cannotClimb" };
  const grid = token.parent.grid;
  const room = climbRoom(token);
  const from = token._source.elevation ?? 0;
  const highest = Number.isFinite(room.ceiling) ? Math.floor(((room.ceiling - from) / grid.distance) + 1e-6) : 20;
  let need = null;
  for ( let n = 1; n <= Math.min(highest, 20); n++ ) {
    if ( gapCells(token, target, { posA: { elevation: from + (n * grid.distance) } }) <= reach ) { need = n; break; }
  }
  if ( need === null ) return { arrived: false, climbed: 0, reason: "tooHigh" };
  const n = Math.min(need, room.max);
  if ( n < 1 ) return { arrived: false, climbed: 0, reason: "exhausted" };
  if ( !(await startClimb(token, { cells: n })) ) return { arrived: false, climbed: 0, reason: "refused" };
  const climbed = Math.round(((token._source.elevation ?? 0) - from) / grid.distance);
  return there() ? { arrived: true, climbed } : { arrived: false, climbed, reason: "exhausted" };
}

/**
 * §196 : `api.climb` — l'escalade pour les voisins (interface, IA, manette). Lecture : `state(token)`, `holds(token, cell)`,
 * `entries(token)` (les entrées du menu du moteur : `{ icon, label, run }`) ; gestes, sur le client qui possède le token, sans `cells`
 * la fenêtre « combien de cases » du moteur s'ouvre : `up(token, { cells })`, `run(token, { cells })` (Mouvement acrobatique),
 * `ceiling(token)`, `down(token, { cells })`, `drop(token)` → booléen ; `toward(token, target, { reachCells })` (voir `climbToward`).
 */
export const climbApi = Object.freeze({
  state: climbStateOf,
  holds: climbHoldsAt,
  entries: token => climbEntries(docOf(token)).map(({ icon, label, run }) => ({ icon, label, run })),
  up: (token, { cells=null }={}) => startClimb(docOf(token), { cells }),
  run: (token, { cells=null }={}) => startClimb(docOf(token), { cells, acrobatic: true }),
  ceiling: token => climbToCeiling(docOf(token)),
  down: (token, { cells=null }={}) => climbDown(docOf(token), { cells }),
  drop: token => dropDown(docOf(token)),
  edges: token => edgesBelowOf(docOf(token)),
  grab: (token, edge) => grabEdge(docOf(token), edge),
  toward: climbToward
});

export function registerClimb() {
  game.settings.register(MODULE_ID, CLIMB_RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.Aide`, scope: "world", config: true,
    type: String, choices: { 2024: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.2024`, house: `DND5ECOMBAT.Reglage.${CLIMB_RULES_SETTING}.house` },
    default: "2024"
  });
  CONFIG.queries[CLIMB_QUERY] = handleClimbQuery;
  const executor = { executor: true };
  route("preMoveToken", onPreMoveToken, { cancellable: true, label: "ceiling: staying under it" });
  route("updateToken", onTokenUpdated, { ...executor, label: "climbing: status, flip or landing not applied" });
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) {
    route(hook, effect => checkClimbers(actorOfEffect(effect)), { ...executor, label: "climbing: fall not triggered" });
  }
  route("combatTurnChange", onTurnChange, { ...executor, label: "climbing: check not asked" });
  route("createChatMessage", onFallCard, { ...executor, label: "fall damage not applied" });
  route("ready", () => { setInterval(tick, TICK_MS); }, { label: "climbing: out-of-combat checks" });
}
