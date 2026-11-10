/**
 * §401 : la file des fenêtres d'un poste — une question du moteur (choix, réaction, répartition, jet demandé) attend que la précédente
 * soit fermée avant de s'ouvrir, pour que les fenêtres s'enchaînent au lieu de s'empiler. Une attente est plafonnée (`capMs`) : une
 * fenêtre qui en attendrait une autre restée ouverte (ou qui dépendrait d'elle) s'ouvre quand même au bout du plafond, comme avant la file.
 * Pur : les minuteries se passent en argument (testable hors de Foundry).
 */

/**
 * @param {object} [ports]
 * @param {() => number} [ports.capMs]  L'attente maximale d'une fenêtre derrière la précédente.
 * @param {(ms: number) => Promise<void>} [ports.wait]
 * @param {() => number} [ports.now]
 * @returns {(<T>(open: () => Promise<T>, label?: string) => Promise<T>) & { state: () => Array<{label: string, since: number, open: boolean}> }}
 *   Ouvre `open` à son tour ; rend ce qu'elle rend. `state()` : les entrées en cours (pour le débogage).
 */
export function createWindowLine({ capMs=() => 13000, wait=ms => new Promise(resolve => setTimeout(resolve, ms)), now=() => Date.now() }={}) {
  let last = Promise.resolve();
  const entries = new Set();
  function inLine(open, label="") {
    const before = last;
    let release;
    const mine = new Promise(resolve => { release = resolve; });
    last = mine;
    const entry = { label, since: now(), open: false };
    entries.add(entry);
    const turn = Promise.race([before, wait(capMs())]);
    return turn.then(() => { entry.open = true; return open(); }).finally(() => { entries.delete(entry); release(); });
  }
  inLine.state = () => [...entries].map(e => ({ ...e }));
  return inLine;
}
