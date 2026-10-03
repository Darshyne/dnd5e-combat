/**
 * File d'attente par clé. Plusieurs évènements touchant le même document arrivent presque en
 * même temps (sauvegardes simultanées, effets sur soi demandés par deux chemins) ; chacun lit un
 * flag, le modifie et le réécrit. Sans mise en série, la dernière écriture écrase les autres.
 */
const queues = new Map();

export function enqueue(key, task) {
  const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, next.catch(() => {}));
  return next;
}
