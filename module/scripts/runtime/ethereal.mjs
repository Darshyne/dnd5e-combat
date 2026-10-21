/**
 * §225 : passer des créatures dans le plan Éthéré ou les en faire revenir — l'état `ethereal` de dnd5e, celui que le menu des états du
 * HUD du token pose aussi. Pour la macro du compendium « Outils du MJ » et les voisins : `api.ethereal.toggle(tokens, active)`. Lot 3 : l'action
 * de déplacement « Éthéré » (murs traversés).
 */

import { MODULE_ID } from "../constants.mjs";
import { isEthereal, perceivesPlane } from "../adapter/plane.mjs";
import { etherealStepCost, nearestFreeCell, shuntDamage, etherealPlaneOn, setEtherealPlaneState } from "../core/plane.mjs";
import { placementOf } from "../core/altitude.mjs";
import { cellOf } from "../adapter/movement.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { boundsUnder } from "../adapter/altitude.mjs";
import { occupiedAt } from "./actions.mjs";
import { fallNow } from "./altitude.mjs";
import { enqueue } from "./queue.mjs";
import { contentOf } from "../adapter/content.mjs";
import { route } from "./router.mjs";
import { isExecutor, loc, log } from "./shared.mjs";

const docOf = t => t?.document ?? t;

/**
 * Bascule l'état Éthéré des tokens donnés (par défaut les tokens contrôlés). `active` : true / false force le sens ; sans lui, chaque
 * token passe de l'un à l'autre — sauf un groupe mixte, qui passe tout entier dans l'Éthéré.
 * @returns {Promise<Array<{name: string, ethereal: boolean}>>}
 */
export async function toggleEthereal(tokens=null, active=null) {
  const docs = (tokens ?? canvas?.tokens?.controlled ?? []).map(docOf).filter(d => d?.actor?.isOwner);
  if ( active === null ) active = !docs.every(d => isEthereal(d));
  const out = [];
  for ( const doc of docs ) {
    if ( isEthereal(doc) !== active ) await doc.actor.toggleStatusEffect("ethereal", { active });
    out.push({ name: doc.name, ethereal: active });
    log(`${doc.name}: ${active ? "enters" : "leaves"} the Ethereal Plane`);
  }
  return out;
}

export const SETTING = "etherealPlane";

export const etherealApi = Object.freeze({
  enabled: () => etherealPlaneOn(),
  setEnabled: on => (game.user.isGM ? game.settings.set(MODULE_ID, SETTING, on !== false) : null),
  is: t => isEthereal(docOf(t)),
  perceives: (observer, target) => perceivesPlane(docOf(observer), docOf(target)),
  toggle: toggleEthereal
});

/* -------------------------------------------- */
/*  §225, lot 3 : se déplacer dans l'Éthéré      */
/* -------------------------------------------- */

const ACTION = "ethereal";
const PREVIOUS = "etherealPrevAction";

/**
 * L'action de déplacement « Éthéré » du cœur V14 (`CONFIG.Token.movement.actions`, comme dnd5e y ajoute « fall ») : aucun mur ni
 * plancher ne l'arrête (`walls: null`, client/canvas/placeables/token.mjs:3005, :3218) — les murs de force sont refusés par le contrôle des
 * déplacements (runtime/move-gate.mjs) ; pas de terrain difficile ; monter ou descendre coûte le double. Choisie seulement par un token Éthéré.
 */
function registerAction() {
  const actions = CONFIG.Token?.movement?.actions;
  if ( !actions ) return;
  actions[ACTION] = {
    label: "DND5ECOMBAT.Ethere.Action",
    icon: "fa-solid fa-ghost",
    img: "systems/dnd5e/icons/svg/statuses/ethereal.svg",
    order: 10,
    walls: null,
    terrainAction: null,
    canSelect: token => isEthereal(token),
    getCostFunction: () => (cost, from, to) => {
      const vertical = Math.abs((to?.k ?? 0) - (from?.k ?? 0)) * (canvas?.scene?.grid?.distance ?? 0);
      return etherealStepCost(cost, vertical);
    }
  };
}

/** Les tokens de l'acteur, sur toutes les scènes. */
function tokensOf(actor) {
  if ( !actor ) return [];
  if ( actor.isToken ) return actor.token ? [actor.token] : [];
  return actor.getDependentTokens?.({ concreteOnly: true }) ?? [];
}

/**
 * L'état Éthéré posé ou retiré : le token prend l'action « Éthéré », puis reprend celle qu'il avait (gardée dans un flag). MJ actif.
 * L'option `altitude` : runtime/altitude.mjs ne traite pas ce changement de mode comme un décollage ou un atterrissage.
 */
async function syncAction(effect) {
  if ( !etherealPlaneOn() || !effect?.statuses?.has?.("ethereal") ) return;   // coupé : l'état ne fait rien
  const actor = effect.parent?.documentName === "Actor" ? effect.parent : null;
  const blink = effect.getFlag?.(MODULE_ID, "blink") === true;
  // Au tour suivant de la boucle : l'acteur synthétique d'un token non lié n'a ses nouveaux statuts qu'après le hook (ui/ethereal.mjs).
  await new Promise(resolve => setTimeout(resolve, 0));
  for ( const token of tokensOf(actor) ) {
    const inside = isEthereal(token);
    const current = token._source.movementAction;
    if ( inside && (current !== ACTION) ) {
      await token.update({ movementAction: ACTION, [`flags.${MODULE_ID}.${PREVIOUS}`]: current ?? null }, { [MODULE_ID]: { altitude: true } });
    }
    else if ( !inside ) {
      if ( current === ACTION ) {
        const previous = token.getFlag(MODULE_ID, PREVIOUS) ?? CONFIG.Token.movement.defaultAction;
        await token.update({ movementAction: previous, [`flags.${MODULE_ID}.-=${PREVIOUS}`]: null }, { [MODULE_ID]: { altitude: true } });
      }
      // Lot 4 : le retour, une fois l'action d'avant remise (la chute en dépend : à pied, pas « ethereal »).
      if ( token.object ) await enqueue(`ethereal-return:${token.uuid}`, () => returnToken(token, { blink }));
    }
  }
}

/**
 * L'interrupteur basculé (réglage de monde) : chaque client relit l'état, redessine la vue ; le MJ actif remet les actions de déplacement —
 * coupé, un token sur l'action « ethereal » reprend celle d'avant (sans quoi il traverserait encore les murs) ; rallumé, un token à l'état
 * Éthéré la reprend. Ni retour ni dégâts dans un sens comme dans l'autre : personne ne bouge.
 */
async function applied(value) {
  setEtherealPlaneState(value);
  log(`Ethereal Plane automation ${value ? "on" : "off"}`);
  Hooks.callAll(`${MODULE_ID}.etherealPlane`, { enabled: etherealPlaneOn() });
  if ( canvas?.ready ) {
    canvas.perception.update({ refreshVision: true });
    for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true, refreshVisibility: true });
  }
  if ( !isExecutor() ) return;
  for ( const scene of game.scenes ) for ( const token of scene.tokens ) {
    const current = token._source.movementAction;
    if ( !etherealPlaneOn() && (current === ACTION) ) {
      const previous = token.getFlag(MODULE_ID, PREVIOUS) ?? CONFIG.Token.movement.defaultAction;
      await token.update({ movementAction: previous, [`flags.${MODULE_ID}.-=${PREVIOUS}`]: null }, { [MODULE_ID]: { altitude: true } });
    }
    else if ( etherealPlaneOn() && isEthereal(token) && (current !== ACTION) ) {
      await token.update({ movementAction: ACTION, [`flags.${MODULE_ID}.${PREVIOUS}`]: current ?? null }, { [MODULE_ID]: { altitude: true } });
    }
  }
}

export function registerEtherealMovement() {
  game.settings.register(MODULE_ID, SETTING, {
    name: `DND5ECOMBAT.Reglage.${SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true,
    onChange: value => applied(value)
  });
  route("setup", () => setEtherealPlaneState(game.settings.get(MODULE_ID, SETTING)), { always: true, label: "ethereal switch: state not read" });
  // Dès `init`, comme dnd5e pour « fall » : les tokens sont construits avant `setup`, et leur champ `movementAction` refuse une action
  // inconnue à ce moment (« ethereal is not a valid choice », vu en jeu).
  registerAction();
  const label = { executor: true, label: "ethereal: movement action not switched" };
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"] ) route(hook, syncAction, label);
  route("dnd5e.postUseActivity", onShiftUsed, { label: "ethereal: Ethereal Jaunt / Stride not applied" });
}

/* -------------------------------------------- */
/*  §225, lot 4 : le retour sur le plan matériel  */
/* -------------------------------------------- */

const SHUNT_RINGS = 12;

/**
 * Lot 4 : la créature a quitté l'Éthéré (l'état retiré, quelle qu'en soit la cause ; appelé par `syncAction`) — si sa case est occupée,
 * elle est repoussée vers la case libre la plus proche (déplacement forcé, sans attaque d'opportunité) et subit deux fois les pieds
 * parcourus en dégâts de force (Forme éthérée) ; pas au retour de Clignotement (« vous revenez dans un espace inoccupé … à 3 m », l'effet
 * marqué `blink`). En l'air, à pied, elle tombe. MJ actif.
 */
async function returnToken(token, { blink }) {
  const grid = token.parent.grid;
  if ( occupiedAt(token, token._source) ) {
    const start = cellOf(token);
    const cell = nearestFreeCell(start, c => !occupiedAt(token, grid.getTopLeftPoint(c)), SHUNT_RINGS);
    if ( !cell ) {
      log(`${token.name}: back from the Ethereal Plane on an occupied space, no free space nearby`);
      return;
    }
    const to = grid.getTopLeftPoint(cell);
    const feet = lengthIn(distanceBetween(token, token, { posB: { x: to.x, y: to.y } }).value, grid.units, "ft", readUnitFactors());
    await token.move([{ x: to.x, y: to.y, elevation: token._source.elevation, level: token._source.level, snapped: true, action: "displace" }],
      { [MODULE_ID]: { cleared: true } });
    const damage = blink ? 0 : shuntDamage(feet);
    log(`${token.name}: back from the Ethereal Plane on an occupied space, shunted ${Math.round(feet)} ft${damage ? `, ${damage} force` : ""}`);
    if ( damage > 0 ) {
      const actor = token.actor;
      await ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor, token }),
        content: `<p>${loc("Ethere.Repousse", { name: token.name, feet: Math.round(feet), damage })}</p>`
      });
      await actor.applyDamage([{ value: damage, type: "force" }]);
    }
  }
  // Sans gravité dans l'Éthéré, la créature a pu y monter : revenue en l'air, à pied, elle tombe (règle du moteur, système allumé).
  const ground = boundsUnder(token, token._source).ground;
  if ( ((token._source.elevation ?? 0) > ground + 1e-6) && (placementOf(token._source.movementAction) === "ground") ) await fallNow(token);
}

/**
 * §225, lot 4 : Saut éthéré, Foulée éthérée (contenu `etherealShift`) — la créature passe dans l'Éthéré ou en revient ; avec `others`,
 * les cibles désignées (sauf elle) prennent le même plan qu'elle. Sur le client de l'auteur, après l'utilisation : ses activités
 * n'ont ni effet ni état dans la donnée (« Expend Use » seulement).
 */
async function onShiftUsed(activity) {
  const rule = (etherealPlaneOn() && activity?.item) ? contentOf(activity.item).entry?.etherealShift : null;
  const actor = activity?.actor;
  if ( !rule || !actor?.isOwner ) return;
  const self = actor.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;
  if ( !self ) return;
  const into = !isEthereal(self);
  const others = (rule.others === true) ? Array.from(game.user.targets ?? []).map(t => t.document).filter(d => d && (d !== self)) : [];
  await toggleEthereal([self, ...others], into);
  log(`${self.name}: ${activity.item.name} — ${into ? "into" : "out of"} the Ethereal Plane${others.length ? ` with ${others.map(d => d.name).join(", ")}` : ""}`);
}
