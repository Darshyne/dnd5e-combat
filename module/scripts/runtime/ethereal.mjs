/**
 * §225 : passer des créatures dans le plan Éthéré ou les en faire revenir — l'état `ethereal` de dnd5e, celui que le menu des états du
 * HUD du token pose aussi. Pour la macro du compendium « Outils du MJ » et les voisins : `api.ethereal.toggle(tokens, active)`. Lot 3 : l'action
 * de déplacement « Éthéré » (murs traversés).
 */

import { MODULE_ID } from "../constants.mjs";
import { isEthereal, perceivesPlane } from "../adapter/plane.mjs";
import { etherealStepCost } from "../core/plane.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

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

export const etherealApi = Object.freeze({
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
  if ( !effect?.statuses?.has?.("ethereal") ) return;
  const actor = effect.parent?.documentName === "Actor" ? effect.parent : null;
  // Au tour suivant de la boucle : l'acteur synthétique d'un token non lié n'a ses nouveaux statuts qu'après le hook (ui/ethereal.mjs).
  await new Promise(resolve => setTimeout(resolve, 0));
  for ( const token of tokensOf(actor) ) {
    const inside = isEthereal(token);
    const current = token._source.movementAction;
    if ( inside && (current !== ACTION) ) {
      await token.update({ movementAction: ACTION, [`flags.${MODULE_ID}.${PREVIOUS}`]: current ?? null }, { [MODULE_ID]: { altitude: true } });
    }
    else if ( !inside && (current === ACTION) ) {
      const previous = token.getFlag(MODULE_ID, PREVIOUS) ?? CONFIG.Token.movement.defaultAction;
      await token.update({ movementAction: previous, [`flags.${MODULE_ID}.-=${PREVIOUS}`]: null }, { [MODULE_ID]: { altitude: true } });
    }
  }
}

export function registerEtherealMovement() {
  // Dès `init`, comme dnd5e pour « fall » : les tokens sont construits avant `setup`, et leur champ `movementAction` refuse une action
  // inconnue à ce moment (« ethereal is not a valid choice », vu en jeu).
  registerAction();
  const label = { executor: true, label: "ethereal: movement action not switched" };
  for ( const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"] ) route(hook, syncAction, label);
}
