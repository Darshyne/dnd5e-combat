/**
 * Purge du journal (SPEC §58) : quels messages supprimer, sans Foundry.
 */

/**
 * Au-delà de `max` messages, les plus anciens à supprimer pour revenir à `keep` — sauf une action encore ouverte et ses jets.
 * Une carte d'utilisation supprimée emporte ses jets (`origin`), même plus récents que la coupe : rien ne reste orphelin.
 * @param {{id: string, origin: string|null, open: boolean}[]} messages  Du plus ancien au plus récent.
 * @param {{max: number, keep: number}} limits                           `max` ≤ 0 : jamais.
 * @returns {string[]}  Les ids à supprimer.
 */
export function planPurge(messages, { max, keep }) {
  if ( !(max > 0) || (messages.length <= max) ) return [];
  const cut = messages.length - Math.max(0, Math.min(keep, max));
  const open = new Set(messages.filter(m => m.open).map(m => m.id));
  const doomed = new Set();
  for ( const m of messages.slice(0, cut) ) {
    if ( open.has(m.id) || (m.origin && open.has(m.origin)) ) continue;
    doomed.add(m.id);
  }
  for ( const m of messages.slice(cut) ) if ( m.origin && doomed.has(m.origin) ) doomed.add(m.id);
  return messages.filter(m => doomed.has(m.id)).map(m => m.id);
}
