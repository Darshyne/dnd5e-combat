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
 * §422 : deux précisions que seul ce client connaît.
 *  - `prompts` : les fenêtres ouvertes sur ce poste (adapter/dialogs.mjs) — leur texte et leurs boutons, pour que le MJ réponde depuis la
 *    file à ce que le moteur lui demande (`prompt` sur la ligne de `mine`) ;
 *  - `groupRolls` : les jets demandés encore attendus (§242) — la ligne du joueur porte `groupRoll` (la carte de la demande), son
 *    forçage est alors « Lancer pour lui », celui de la fenêtre de suivi des jets, et non la fermeture d'une fenêtre.
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Une question posée à ce joueur pour cet acteur (ou sans acteur connu) éclaire-t-elle cette attente ? */
const matches = (entry, wait) => (wait.userId === entry.userId) && (!entry.actor || !wait.actor || (wait.actor === entry.actor));

/**
 * @param {object} sources
 * @param {object[]} [sources.awaiting]    Les attentes connues de ce client (`awaitingList()`).
 * @param {object[]} [sources.waits]       Les questions posées par ce client (`playerWaits()`).
 * @param {object[]} [sources.blocked]     Les jets dus par un auteur absent : `{ messageId, userId, userName, actor, actorName, item, heal }`.
 * @param {object[]} [sources.prompts]     Les fenêtres ouvertes sur ce poste : `{ id, awaitingId, title, text, buttons }`.
 * @param {object[]} [sources.groupRolls]  Les jets demandés encore attendus : `{ messageId, actor, label }`.
 * @returns {{mine: object[], players: object[], blocked: object[], count: number}}
 *   Une ligne : `{ id, source: "awaiting"|"wait", userId, userName, actor, kind, label, since, seconds, waitIds, prompt, groupRoll }`.
 */
export function gmQueue({ awaiting=[], waits=[], blocked=[], prompts=[], groupRolls=[] }={}) {
  const used = new Set();
  const line = entry => {
    const own = waits.filter(w => matches(entry, w));
    for ( const w of own ) used.add(w.id);
    const prompt = prompts.find(p => p.awaitingId === entry.id) ?? null;
    const asked = ((entry.kind === "roll") && entry.actor) ? (groupRolls.find(g => g.actor === entry.actor) ?? null) : null;
    return {
      id: entry.id, source: "awaiting", userId: entry.userId, userName: entry.userName ?? "", actor: entry.actor ?? null,
      kind: entry.kind ?? "choice", label: own.find(w => w.label)?.label ?? asked?.label ?? prompt?.title ?? "",
      since: entry.since ?? 0, seconds: entry.seconds ?? null, waitIds: own.map(w => w.id),
      prompt: prompt ? { id: prompt.id, text: prompt.text ?? "", buttons: prompt.buttons ?? [] } : null,
      groupRoll: asked?.messageId ?? null
    };
  };
  const mine = awaiting.filter(e => e.gm).map(line);
  const players = awaiting.filter(e => !e.gm).map(line);
  // Une question dont la fenêtre n'est pas (encore) annoncée par le client du joueur : elle garde sa ligne.
  for ( const w of waits ) {
    if ( used.has(w.id) ) continue;
    players.push({ id: `wait:${w.id}`, source: "wait", userId: w.userId, userName: w.userName ?? "", actor: w.actor ?? null,
      kind: "choice", label: w.label ?? "", since: w.since ?? 0, seconds: null, waitIds: [w.id], prompt: null, groupRoll: null });
  }
  const bySince = (a, b) => (a.since - b.since) || String(a.id).localeCompare(String(b.id));
  mine.sort(bySince);
  players.sort(bySince);
  const stuck = blocked.map(b => ({ ...b, id: `blocked:${b.messageId}` }));
  return { mine, players, blocked: stuck, count: mine.length + players.length + stuck.length };
}

/** Une empreinte de la file : elle ne change que si une ligne arrive, part, ou gagne son libellé ou ses boutons (pas avec le temps). */
export function queueSignature(queue) {
  return [...queue.mine, ...queue.players, ...queue.blocked]
    .map(l => `${l.id}|${l.label ?? ""}|${l.prompt?.id ?? ""}|${l.groupRoll ?? ""}`).join(";");
}
