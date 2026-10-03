/**
 * Le répartiteur (SPEC §13, S2) : il fait tourner la machine d'action du cœur.
 *
 *   évènement → advance() → ÉCRIRE la résolution → exécuter les commandes → nouveaux évènements → …
 *
 * L'écriture précède toujours l'exécution : une commande qui attend quelqu'un (fenêtre de
 * réaction) laisse derrière elle un état lisible et repris après un F5. Tout ce qui touche un
 * même porteur passe par une seule file, dans l'ordre d'arrivée.
 *
 * Écritures regroupées (réglage « journal de chat allégé », `coalesce`) : chaque écriture du flag refait la
 * carte de chat chez tous les clients. Regroupées, les étapes qui s'enchaînent vite dans une même tâche ne
 * font qu'une écriture : la dernière reste en mémoire (`peek` la rend), part au plus tard `flushMs` après,
 * et toujours à la fin de la tâche. Une commande qui attend quelqu'un (réaction, sauvegarde, choix) laisse
 * donc son état lisible au bout de `flushMs` au lieu de tout de suite.
 *
 * `createDispatcher` ne référence aucun global : il se teste hors de Foundry, avec de faux ports.
 */

import { advance, open, current } from "../core/action.mjs";

/**
 * @param {object} ports
 * @param {(carrierId: string) => object|null} ports.read             Résolution portée par un message.
 * @param {(carrierId: string, resolution: object) => Promise} ports.write
 * @param {(command: object, carrierId: string, resolution: object) => Promise<object[]|void>} ports.execute
 *        Exécute une commande du cœur ; rend les évènements qu'elle produit tout de suite, s'il y en a.
 * @param {(key: string, task: Function) => Promise} ports.enqueue    File par clé.
 * @param {(resolution: object, event: object) => void} [ports.publish]  Sortie pour les consommateurs passifs (SPEC §5.6).
 * @param {() => boolean} [ports.coalesce]  Regrouper les écritures (relu à chaque écriture).
 * @param {number} [ports.flushMs]           Délai maximal d'une écriture regroupée.
 */
export function createDispatcher({ read, write, execute, enqueue, publish=() => {}, coalesce=() => false, flushMs=250 }) {

  /** Porteur → { resolution, timer } : la dernière résolution pas encore écrite. */
  const staged = new Map();
  /** Porteur → dernière écriture partie : celles d'un même porteur arrivent dans l'ordre. */
  const writing = new Map();

  const peek = carrierId => staged.has(carrierId) ? staged.get(carrierId).resolution : read(carrierId);

  function writeInOrder(carrierId, resolution) {
    const next = (writing.get(carrierId) ?? Promise.resolve()).then(() => write(carrierId, resolution));
    writing.set(carrierId, next.catch(() => {}));
    return next;
  }

  function flush(carrierId) {
    const entry = staged.get(carrierId);
    if ( !entry ) return writing.get(carrierId);
    staged.delete(carrierId);
    clearTimeout(entry.timer);
    return writeInOrder(carrierId, entry.resolution);
  }

  function store(carrierId, resolution) {
    const entry = staged.get(carrierId);
    if ( entry ) { entry.resolution = resolution; return; }
    if ( !coalesce() ) return writeInOrder(carrierId, resolution);
    const timer = setTimeout(() => flush(carrierId)?.catch(err => console.error("dnd5e-combat | écriture regroupée", err)), flushMs);
    staged.set(carrierId, { resolution, timer });
  }

  /** Une tâche de la file : ce qu'elle a changé est écrit avant qu'elle ne rende la main. */
  async function task(carrierId, fn) {
    try { return await fn(); }
    finally { await flush(carrierId); }
  }

  /** Fait avancer une résolution déjà écrite, évènement après évènement. */
  async function pump(carrierId, resolution, events) {
    const queue = [...events];
    while ( queue.length ) {
      const event = queue.shift();
      const step = advance(resolution, event);
      if ( step.resolution === resolution ) continue;   // évènement sans effet : rien à écrire, rien à faire
      resolution = step.resolution;
      await store(carrierId, resolution);
      publish(resolution, event);
      queue.push(...await run(carrierId, resolution, step.commands));
    }
    return resolution;
  }

  async function run(carrierId, resolution, commands) {
    const events = [];
    for ( const command of commands ) events.push(...(await execute(command, carrierId, resolution) ?? []));
    return events;
  }

  return {
    /**
     * Ouvre une résolution sur un porteur. `build` est appelé DANS la file du porteur, et rend les
     * données d'`open()` du cœur, ou null s'il n'y a rien à résoudre.
     */
    open(carrierId, build) {
      return enqueue(carrierId, () => task(carrierId, async () => {
        if ( current(peek(carrierId)) ) return null;   // déjà ouverte (hook reçu deux fois)
        const data = await build();
        if ( !data ) return null;
        const first = open({ ...data, carrier: carrierId });
        await store(carrierId, first.resolution);
        publish(first.resolution, { type: "opened" });
        return pump(carrierId, first.resolution, await run(carrierId, first.resolution, first.commands));
      }));
    },

    /**
     * Soumet un évènement à la résolution d'un porteur. `event` peut être une fonction
     * `(résolution) => évènement | null`, appelée DANS la file : elle voit l'état du moment.
     * @returns {Promise<boolean>}  false si le porteur n'a pas de résolution, ou si l'évènement ne l'a pas changée.
     */
    send(carrierId, event) {
      return enqueue(carrierId, () => task(carrierId, async () => {
        const resolution = current(peek(carrierId));
        if ( !resolution ) return false;
        const actual = (typeof event === "function") ? await event(resolution) : event;
        if ( !actual ) return false;
        return (await pump(carrierId, resolution, [actual])) !== resolution;
      }));
    },

    /** Attend que tout ce qui est en file pour ce porteur soit traité. */
    drained(carrierId) {
      return enqueue(carrierId, async () => {});
    },

    /** La résolution du moment : encore en mémoire (écritures regroupées) ou écrite sur le porteur. */
    peek
  };
}
