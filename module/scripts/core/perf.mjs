/**
 * §98 : relevé des temps du moteur — par inscrit du routeur (hook + libellé) : le temps SYNCHRONE de chaque appel (le calcul qui bloque
 * le navigateur) et, pour un inscrit qui rend une promesse, le temps jusqu'à sa fin (attentes comprises : une réponse de joueur, un jet
 * de dés 3D — informatif, pas un coût de calcul). Pur : l'horloge est donnée.
 */

/**
 * @param {object} [options]
 * @param {number} [options.threshold=50]  Au-delà (ms, synchrone), l'appel est « lent » et signalé (`onSlow`).
 * @param {(row: object, ms: number) => void} [options.onSlow]
 */
export function createPerf({ threshold=50, onSlow=() => {} }={}) {
  let rows = new Map();
  let limit = threshold;
  const rowOf = (hook, label) => {
    const key = `${hook}|${label}`;
    let row = rows.get(key);
    if ( !row ) rows.set(key, row = { hook, label, calls: 0, syncTotal: 0, syncMax: 0, slow: 0, asyncCalls: 0, asyncMax: 0 });
    return row;
  };
  return {
    /** Un appel : `kind` "sync" (le temps bloquant) ou "async" (jusqu'à la fin de la promesse). */
    record(hook, label, kind, ms) {
      if ( !Number.isFinite(ms) || (ms < 0) ) return;
      const row = rowOf(hook, label);
      if ( kind === "async" ) {
        row.asyncCalls++;
        row.asyncMax = Math.max(row.asyncMax, ms);
        return;
      }
      row.calls++;
      row.syncTotal += ms;
      row.syncMax = Math.max(row.syncMax, ms);
      if ( limit && (ms > limit) ) {
        row.slow++;
        onSlow(row, ms);
      }
    },
    /** Les lignes, les plus coûteuses d'abord (temps synchrone cumulé), arrondies au dixième de ms. */
    report() {
      const r = n => Math.round(n * 10) / 10;
      return Array.from(rows.values())
        .map(x => ({ hook: x.hook, label: x.label, calls: x.calls, totalMs: r(x.syncTotal), avgMs: x.calls ? r(x.syncTotal / x.calls) : 0,
          maxMs: r(x.syncMax), slow: x.slow, asyncMaxMs: r(x.asyncMax) }))
        .sort((a, b) => (b.totalMs - a.totalMs) || (b.maxMs - a.maxMs));
    },
    reset() { rows = new Map(); },
    setThreshold(ms) { limit = Math.max(0, Number(ms) || 0); },
    get threshold() { return limit; }
  };
}
