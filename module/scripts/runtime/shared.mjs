/** Ce que tout le runtime partage (SPEC §13, S1) : une seule définition de chaque chose. */

import { MODULE_ID } from "../constants.mjs";

export const log = (...args) => console.log(`${MODULE_ID} |`, ...args);

/** Texte traduit du module, avec ou sans données. */
/**
 * Un avis du moteur au-dessus d'un token (refus, invite : « Déjà visé », « Trop loin »), sur ce client : publié pour
 * l'interface (ui/feedback.mjs), qui l'écrit en texte défilant. Le runtime ne connaît pas l'interface.
 */
export function notice(token, text, kind="refused") {
  const uuid = token?.uuid ?? token?.document?.uuid ?? token ?? null;
  if ( uuid ) Hooks.callAll(`${MODULE_ID}.notice`, { token: uuid, text, kind });
}

export const loc = (key, data) => data ? game.i18n.format(`DND5ECOMBAT.${key}`, data) : game.i18n.localize(`DND5ECOMBAT.${key}`);

/** SPEC §5.3 : le MJ actif est l'unique exécutant du moteur. */
export function isExecutor() {
  return game.users.activeGM?.isSelf === true;
}

/** Au-delà, on juge sans attendre le canevas (et on le dit). */
export const CANVAS_WAIT_MAX_MS = 5000;

/**
 * Attend que le canevas ait fini de se dessiner (changement de niveau ou de scène : le cœur V14
 * redessine tout, `canvas.ready` faux le temps du redessin). Borné. Sans global : testable.
 * @param {object} ports
 * @param {() => boolean} ports.isReady
 * @param {(ms: number) => Promise} ports.sleep
 * @param {number} [maxMs]
 * @param {number} [stepMs]
 * @returns {() => Promise<boolean>}  true : prêt (tout de suite ou après attente) ; false : pas prêt à temps.
 */
export function createCanvasWait({ isReady, sleep }, maxMs=CANVAS_WAIT_MAX_MS, stepMs=50) {
  return async function whenCanvasReady() {
    for ( let waited = 0; !isReady(); waited += stepMs ) {
      if ( waited >= maxMs ) return false;
      await sleep(stepMs);
    }
    return true;
  };
}

export const whenCanvasReady = createCanvasWait({
  isReady: () => !!globalThis.canvas?.ready,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
});

/** Au-delà, on continue sans les dés 3D : une animation qui ne se joue pas ne retient pas le jeu. */
export const DICE_WAIT_MAX_MS = 8000;

/**
 * Principe 2 : rien ne s'applique avant que les dés se soient arrêtés. Dice So Nice reste optionnel,
 * et son attente est bornée (SPEC §12, blocage vu le 2026-09-22) : `waitFor3DAnimationByMessageID`
 * ne rend la main qu'au hook `diceSoNiceRollComplete` du message (main.js, 6.2.9), qui ne vient
 * jamais si le rendu est suspendu — fenêtre en arrière-plan, onglet masqué. Sans global : testable.
 * @param {object} ports
 * @param {(id: string) => Promise|null} ports.animation  Attente de l'animation d'un message ; null si pas de dés 3D.
 * @param {() => boolean} ports.isHidden                  La fenêtre est-elle sans rendu ?
 * @param {(ms: number) => Promise} ports.sleep
 * @param {(why: string) => void} [ports.report]          Consigne qu'on a continué sans attendre.
 * @param {number} [maxMs]
 */
export function createDiceWait({ animation, isHidden, sleep, report=() => {} }, maxMs=DICE_WAIT_MAX_MS) {
  return async function waitForDice(message) {
    if ( isHidden() ) return report("fenêtre en arrière-plan");   // sans rendu, l'animation ne se jouera pas
    const pending = animation(message.id);
    if ( !pending ) return;
    const outcome = await Promise.race([pending.then(() => "done"), sleep(maxMs).then(() => "late")]);
    if ( outcome === "late" ) report(`plus de ${maxMs} ms`);
  };
}

export const waitForDice = createDiceWait({
  animation: id => (game.modules.get("dice-so-nice")?.active && game.dice3d) ? game.dice3d.waitFor3DAnimationByMessageID(id) : null,
  isHidden: () => document.hidden === true,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  report: why => log(`dés 3D : on continue sans attendre (${why})`)
});
