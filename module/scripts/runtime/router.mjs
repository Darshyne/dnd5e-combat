/**
 * Routeur de hooks (SPEC §13, S1). Chaque hook de Foundry est branché UNE fois ; les
 * fonctionnalités s'y inscrivent, et sont appelées dans l'ordre de leur inscription — un ordre
 * qu'on lit dans `dnd5e-combat.mjs` au lieu de le déduire de l'ordre des imports.
 *
 * Trois choses que chaque fichier refaisait à la main :
 *  - `executor` : ne tourne que sur le client du MJ actif (SPEC §5.3)
 *  - une erreur, synchrone ou dans une promesse, est consignée et n'arrête ni les suivants ni le jeu
 *  - `cancellable` : pour un hook que Foundry appelle avec `Hooks.call` (`pre…`), un `false`
 *    arrête la chaîne et annule l'opération. Sans cette option la valeur de retour est ignorée,
 *    comme le fait `Hooks.callAll`.
 *
 * `createRouter` ne référence aucun global : il se teste hors de Foundry.
 */

import { MODULE_ID } from "../constants.mjs";
import { recordTiming } from "./perf.mjs";

/**
 * @param {object} deps
 * @param {(hook: string, fn: Function) => void} deps.subscribe  Branche `fn` sur un hook de Foundry.
 * @param {() => boolean} deps.isExecutor
 * @param {(entry: {hook: string, label: string, notify?: string, level?: string}, err: Error) => void} deps.report
 * @param {(entry: {hook: string, label: string}) => void} [deps.refused]  Un inscrit a annulé l'opération (trace).
 * @param {{now: () => number, record: (hook: string, label: string, kind: "sync"|"async", ms: number) => void}} [deps.timing]
 *   §98 : chronomètre chaque appel — le temps synchrone, et pour une promesse, le temps jusqu'à sa fin (core/perf.mjs).
 */
export function createRouter({ subscribe, isExecutor, report, refused=() => {}, timing=null }) {
  const routes = new Map();
  // §117 : pendant `withoutRoutes`, une inscription est notée mais rien n'est branché (fonction au-dessus du niveau choisi).
  let suspended = null;
  const skipped = [];

  function dispatch(hook, args) {
    for ( const entry of routes.get(hook) ) {
      if ( entry.executor && !isExecutor() ) continue;
      let result;
      const t0 = timing ? timing.now() : 0;
      try { result = entry.handler(...args); }
      catch(err) { report(entry, err); continue; }
      finally { if ( timing ) timing.record(hook, entry.label, "sync", timing.now() - t0); }
      if ( typeof result?.then === "function" ) {
        result.then(timing ? () => timing.record(hook, entry.label, "async", timing.now() - t0) : null, err => report(entry, err));
      }
      else if ( entry.cancellable && (result === false) ) {
        refused(entry);
        return false;
      }
    }
    return true;
  }

  return {
    /**
     * @param {string} hook
     * @param {Function} handler
     * @param {object} [options]
     * @param {string} [options.label]        Ce qu'on lit dans la console si le traitement échoue.
     * @param {boolean} [options.executor]    MJ actif uniquement.
     * @param {boolean} [options.cancellable] `false` annule l'opération et arrête la chaîne.
     * @param {string} [options.notify]       Clé de traduction d'une notification d'erreur.
     * @param {"error"|"warn"} [options.level]
     */
    on(hook, handler, { label=hook, executor=false, cancellable=false, notify=null, level="error" }={}) {
      if ( suspended ) { skipped.push({ hook, label, feature: suspended }); return; }
      if ( !routes.has(hook) ) {
        routes.set(hook, []);
        subscribe(hook, (...args) => dispatch(hook, args));
      }
      routes.get(hook).push({ hook, handler, label, executor, cancellable, notify, level });
    },

    /**
     * §117 : lance `register` sans brancher ses écoutes — ses réglages et ses requêtes sont déclarés, ses hooks non.
     * @param {string} feature   Son nom, pour l'inspection.
     * @param {Function} register
     */
    withoutRoutes(feature, register) {
      suspended = feature;
      try { return register(); }
      finally { suspended = null; }
    },

    /** Les inscriptions écartées par `withoutRoutes` : `[{ hook, label, feature }]`. */
    skipped() {
      return skipped.slice();
    },

    /** Qui écoute quoi, dans quel ordre : pour l'inspection (`api.routes()`). */
    describe() {
      return Object.fromEntries(Array.from(routes, ([hook, entries]) =>
        [hook, entries.map(({ label, executor, cancellable }) => ({ label, executor, cancellable }))]));
    }
  };
}

const router = createRouter({
  subscribe: (hook, fn) => Hooks.on(hook, fn),
  isExecutor: () => game.users.activeGM?.isSelf === true,
  report: (entry, err) => {
    console[entry.level](`${MODULE_ID} | ${entry.label}`, err);
    if ( entry.notify ) ui.notifications.error(entry.notify, { localize: true });
  },
  // Qui annule quoi : un déplacement arrêté en route se lit ainsi dans la console (get-client-errors, watch).
  refused: entry => console.log(`${MODULE_ID} | ${entry.hook} cancelled by "${entry.label}"`),
  // §98 : relevé des temps (runtime/perf.mjs).
  timing: { now: () => performance.now(), record: recordTiming }
});

export const route = router.on;
export const describeRoutes = router.describe;
export const withoutRoutes = router.withoutRoutes;
export const skippedRoutes = router.skipped;
