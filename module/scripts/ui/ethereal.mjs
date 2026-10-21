/**
 * §225, lot 2 : ce que l'Éthéré change à l'écran, sur chaque client, sans rien écrire.
 *  - un token Éthéré s'affiche en fantôme (transparent) pour qui le perçoit — « les créatures qui s'y trouvent paraissent
 *    fantomatiques » (Détection de l'invisibilité) ; pour les autres, les modes de détection le cachent (ui/perception.mjs) ;
 *  - quand le point de vue du client est Éthéré (ses tokens contrôlés, sinon, pour un joueur, son personnage), la scène passe en
 *    gris — « le plan que vous avez quitté … en nuances de gris » (Clignotement, Forme éthérée) — et les tokens Éthérés ne sont plus
 *    des fantômes : c'est le plan matériel qui l'est. Un voisin qui dessine une vue plus riche la prend en répondant false au hook
 *    `dnd5e-combat.etherealView` (`{ active }`) : le moteur retire alors son gris.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "../runtime/router.mjs";
import { theaterActive } from "../runtime/theater-state.mjs";
import { isEthereal } from "../adapter/plane.mjs";

const GHOST_ALPHA = 0.45;

let gray = null;

/** Les tokens d'où ce client regarde : les contrôlés, sinon ceux du personnage d'un joueur. */
function viewpoint() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if ( controlled.length || game.user.isGM ) return controlled;
  return game.user.character?.getActiveTokens?.() ?? [];
}

let ghost = null;

/**
 * Le fantôme : un filtre de transparence sur l'image du token, posé ou retiré à chaque rafraîchissement. Pas `mesh.alpha`, que le cœur
 * recalcule et qu'un voisin réécrit après nous (DAS · Shadows & Ambience, perspective d'élévation : vu en jeu).
 */
function onRefresh(token) {
  const mesh = token?.mesh;
  if ( !mesh || mesh.destroyed ) return;
  const want = !theaterActive() && isEthereal(token.document) && !viewpointEthereal();
  const has = !!mesh.filters?.includes(ghost);
  if ( want === has ) return;
  ghost ??= new PIXI.AlphaFilter(GHOST_ALPHA);
  const filters = (mesh.filters ?? []).filter(f => f !== ghost);
  if ( want ) filters.push(ghost);
  mesh.filters = filters.length ? filters : null;
}

/** Le point de vue de ce client est-il dans l'Éthéré ? */
const viewpointEthereal = () => viewpoint().some(t => isEthereal(t.document));

/** La scène en gris quand le point de vue est Éthéré — sauf si un voisin prend la vue à son compte. */
function updateView() {
  if ( !canvas?.ready || !canvas.stage ) return;
  const on = !theaterActive() && viewpointEthereal();
  const claimed = Hooks.call(`${MODULE_ID}.etherealView`, { active: on }) === false;
  const filters = (canvas.stage.filters ?? []).filter(f => f !== gray);
  if ( on && !claimed ) {
    if ( !gray ) {
      gray = new PIXI.ColorMatrixFilter();
      gray.desaturate();
    }
    filters.push(gray);
  }
  canvas.stage.filters = filters.length ? filters : null;
}

/**
 * Un état posé ou retiré : l'opacité des tokens, qui voit qui, et la vue. Au tour suivant de la boucle : au moment du hook, l'acteur
 * synthétique d'un token non lié n'a pas encore ses nouveaux statuts (vu en jeu : le test du cœur disait « caché », le token restait
 * affiché).
 */
function refreshAll(effect) {
  if ( !canvas?.ready || !(effect?.statuses?.has?.("ethereal")) ) return;
  setTimeout(() => {
    if ( !canvas?.ready ) return;
    canvas.perception.update({ refreshVision: true });
    for ( const token of canvas.tokens.placeables ) token.renderFlags.set({ refreshState: true, refreshVisibility: true });
    updateView();
  }, 0);
}

export function registerEtherealUI() {
  route("refreshToken", onRefresh, { label: "ethereal: ghost not drawn" });
  const label = { label: "ethereal: view not updated" };
  // Changer de point de vue change aussi qui est un fantôme.
  const viewChanged = () => {
    updateView();
    for ( const token of canvas?.tokens?.placeables ?? [] ) token.renderFlags.set({ refreshState: true });
  };
  for ( const hook of ["canvasReady", "controlToken", `${MODULE_ID}.etherealPlane`] ) route(hook, viewChanged, label);
  for ( const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"] ) route(hook, refreshAll, label);
  route("canvasTearDown", () => { if ( canvas?.stage?.filters ) canvas.stage.filters = canvas.stage.filters.filter(f => f !== gray); },
    { label: "ethereal: gray filter removed" });
}
