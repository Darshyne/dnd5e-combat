/**
 * §421 : la « File du MJ » — tout ce qui attend quelqu'un, rangé pour le MJ en trois parts :
 *  - `mine` : ce que le moteur demande au MJ (une fenêtre ouverte chez un MJ) ;
 *  - `players` : les joueurs attendus (une fenêtre ouverte chez eux, ou une question qui leur est posée) ;
 *  - `blocked` : une action dont l'auteur n'est plus là pour lancer ses dés.
 *
 * Deux sources se recoupent : le tableau des attentes diffusé par chaque client (core/awaiting.mjs — toute fenêtre de réaction, de choix
 * ou de jet, où qu'elle soit ouverte, sans dire ce qu'elle demande) et les questions que ce client a posées à un joueur
 * (adapter/player-wait.mjs — elles disent quoi, mais n'existent que chez celui qui les pose). La file garde une ligne par fenêtre et lui
 * donne le libellé de la question quand il y en a une.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Une question posée à ce joueur pour cet acteur (ou sans acteur connu) éclaire-t-elle cette attente ? */
const matches = (entry, wait) => (wait.userId === entry.userId) && (!entry.actor || !wait.actor || (wait.actor === entry.actor));

/**
 * @param {object} sources
 * @param {object[]} [sources.awaiting]  Les attentes connues de ce client (`awaitingList()`).
 * @param {object[]} [sources.waits]     Les questions posées par ce client (`playerWaits()`).
 * @param {object[]} [sources.blocked]   Les jets dus par un auteur absent : `{ messageId, userId, userName, actor, actorName, item, heal }`.
 * @returns {{mine: object[], players: object[], blocked: object[], count: number}}
 *   Une ligne : `{ id, source: "awaiting"|"wait", userId, userName, actor, kind, label, since, seconds, waitIds }`.
 */
export function gmQueue({ awaiting=[], waits=[], blocked=[] }={}) {
  const used = new Set();
  const line = entry => {
    const own = waits.filter(w => matches(entry, w));
    for ( const w of own ) used.add(w.id);
    return {
      id: entry.id, source: "awaiting", userId: entry.userId, userName: entry.userName ?? "", actor: entry.actor ?? null,
      kind: entry.kind ?? "choice", label: own.find(w => w.label)?.label ?? "", since: entry.since ?? 0, seconds: entry.seconds ?? null,
      waitIds: own.map(w => w.id)
    };
  };
  const mine = awaiting.filter(e => e.gm).map(line);
  const players = awaiting.filter(e => !e.gm).map(line);
  // Une question dont la fenêtre n'est pas (encore) annoncée par le client du joueur : elle garde sa ligne.
  for ( const w of waits ) {
    if ( used.has(w.id) ) continue;
    players.push({ id: `wait:${w.id}`, source: "wait", userId: w.userId, userName: w.userName ?? "", actor: w.actor ?? null,
      kind: "choice", label: w.label ?? "", since: w.since ?? 0, seconds: null, waitIds: [w.id] });
  }
  const bySince = (a, b) => (a.since - b.since) || String(a.id).localeCompare(String(b.id));
  mine.sort(bySince);
  players.sort(bySince);
  const stuck = blocked.map(b => ({ ...b, id: `blocked:${b.messageId}` }));
  return { mine, players, blocked: stuck, count: mine.length + players.length + stuck.length };
}

/** Une empreinte de la file : elle ne change que si une ligne arrive ou part (pas avec le temps qui passe). */
export function queueSignature(queue) {
  return [...queue.mine, ...queue.players, ...queue.blocked].map(l => `${l.id}|${l.label ?? ""}`).join(";");
}
