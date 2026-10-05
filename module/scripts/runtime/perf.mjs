/**
 * §98 : relevé des temps du moteur, sur chaque client (le MJ actif résout presque tout ; un joueur, ses propres gestes).
 *  - Le routeur chronomètre chaque inscrit (runtime/router.mjs → `recordTiming`) : au-delà du seuil (réglage CLIENT `perfWarnMs`,
 *    50 ms par défaut, 0 = muet), un avertissement en console — au plus un par inscrit toutes les 10 s.
 *  - Les « tâches longues » du navigateur (PerformanceObserver `longtask`, Chromium : tout blocage de plus de 50 ms, rendu du cœur et
 *    des autres modules compris) sont comptées, pour situer le moteur dans le tout.
 *  - `game.modules.get("dnd5e-combat").api.perf` : `report()` (lignes triées, les plus coûteuses d'abord), `table()` (en console),
 *    `longTasks()`, `reset()`. Le même relevé : `api.mcp.perf` (connecteur).
 * Rien n'est écrit dans le monde : tout reste dans la mémoire du client, effacé au rechargement.
 */

import { MODULE_ID } from "../constants.mjs";
import { createPerf } from "../core/perf.mjs";

export const PERF_SETTING = "perfWarnMs";

const warned = new Map();
const perf = createPerf({
  threshold: 50,
  onSlow(row, ms) {
    const key = `${row.hook}|${row.label}`;
    const now = Date.now();
    if ( (now - (warned.get(key) ?? 0)) < 10000 ) return;
    warned.set(key, now);
    console.warn(`${MODULE_ID} | lent : ${row.hook} « ${row.label} » ${Math.round(ms)} ms (seuil ${perf.threshold} ms ; ${row.slow} fois sur ${row.calls})`);
  }
});

/** Appelé par le routeur pour chaque inscrit. */
export function recordTiming(hook, label, kind, ms) {
  perf.record(hook, label, kind, ms);
}

const long = { count: 0, totalMs: 0, maxMs: 0, since: Date.now() };
function observeLongTasks() {
  try {
    if ( !globalThis.PerformanceObserver?.supportedEntryTypes?.includes("longtask") ) return false;
    new PerformanceObserver(list => {
      for ( const e of list.getEntries() ) {
        long.count++;
        long.totalMs += e.duration;
        long.maxMs = Math.max(long.maxMs, e.duration);
      }
    }).observe({ type: "longtask", buffered: false });
    return true;
  } catch { return false; }
}

export const perfApi = Object.freeze({
  report: () => perf.report(),
  longTasks: () => ({ count: long.count, totalMs: Math.round(long.totalMs), maxMs: Math.round(long.maxMs), sinceMinutes: Math.round((Date.now() - long.since) / 60000) }),
  table(limit=25) {
    console.table(perf.report().slice(0, limit));
    console.log(`${MODULE_ID} | tâches longues du navigateur :`, perfApi.longTasks());
  },
  reset() {
    perf.reset();
    warned.clear();
    Object.assign(long, { count: 0, totalMs: 0, maxMs: 0, since: Date.now() });
  }
});

export function registerPerf() {
  game.settings.register(MODULE_ID, PERF_SETTING, {
    name: "DND5ECOMBAT.Reglage.perfWarnMs.Nom", hint: "DND5ECOMBAT.Reglage.perfWarnMs.Aide",
    scope: "client", config: true, type: Number, default: 50, range: { min: 0, max: 500, step: 10 },
    onChange: value => perf.setThreshold(value)
  });
  try { perf.setThreshold(game.settings.get(MODULE_ID, PERF_SETTING)); } catch { /* réglage illisible : 50 ms */ }
  observeLongTasks();
}
