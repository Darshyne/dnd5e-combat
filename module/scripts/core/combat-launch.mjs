/**
 * §397 : « Lancer un combat » (MJ) — la règle seule : qui la fenêtre propose, dans quelle liste et coché ou non, quelles initiatives se
 * partagent un jet, et quand le premier round peut commencer.
 *
 * Décisions de l'utilisateur (2026-11-07) :
 *  - « Joueurs » : ce que contrôlent les joueurs connectés et qui a une initiative (personnages, familiers, invocations), coché ;
 *  - « Vus par les joueurs » : les autres créatures qu'un token des joueurs voit, cochées ;
 *  - « Reste de la carte » : les autres, décochées — hors créatures à 0 PV, acteurs qui ne sont pas des créatures, pièges marqués,
 *    tokens d'un autre niveau de la scène ;
 *  - une invocation « juste après son maître » n'a pas son propre jet ; une invocation sans initiative (Serviteur invisible) n'est pas
 *    proposée ;
 *  - case « une initiative par type de créature » : les PNJ d'un même acteur partagent un jet.
 *
 * Pur : aucune dépendance à Foundry.
 */

/**
 * @typedef {object} LaunchEntry
 * @property {string} id                Id du token.
 * @property {string} actorKey          L'acteur (de base pour un token non lié) : sert au regroupement.
 * @property {boolean} player           Possédé par un joueur.
 * @property {boolean} online           Un de ses joueurs est connecté.
 * @property {boolean} creature         Une créature (personnage ou PNJ), pas un groupe, un véhicule, un piège.
 * @property {boolean} alive            Plus de 0 PV, pas mort.
 * @property {boolean} sameLevel        Au niveau affiché de la scène.
 * @property {boolean} notCombatant     Marqué « hors combat » (`flags.dnd5e-combat.notCombatant`).
 * @property {"own"|"after"|"none"|null} summon  La règle d'initiative d'une invocation, null sinon.
 * @property {boolean} seen             Un token des joueurs le voit.
 */

/**
 * Range les tokens d'une scène dans les trois listes de la fenêtre.
 * @param {LaunchEntry[]} entries
 * @returns {{players: LaunchEntry[], seen: LaunchEntry[], rest: LaunchEntry[]}}  Chaque entrée reçoit `checked`.
 */
export function classify(entries) {
  const players = [];
  const seen = [];
  const rest = [];
  for ( const e of entries ?? [] ) {
    if ( !e.creature || e.notCombatant || (e.summon === "none") ) continue;
    if ( e.player && e.online ) { players.push({ ...e, checked: e.alive }); continue; }
    if ( !e.alive ) continue;
    if ( e.seen ) { seen.push({ ...e, checked: true }); continue; }
    if ( !e.sameLevel ) continue;
    rest.push({ ...e, checked: false });
  }
  return { players, seen, rest };
}

/**
 * Les PNJ qui lancent eux-mêmes : un jet par combattant, ou par acteur quand `grouped`. Les invocations « après » leur maître ne lancent
 * pas. Rend `[{ roll, copies }]` : `roll` lance, `copies` reçoivent le même résultat.
 * @param {Array<{id: string, actorKey: string, summon?: string|null}>} npcs
 * @param {boolean} grouped
 */
export function initiativeGroups(npcs, grouped) {
  const own = (npcs ?? []).filter(n => n.summon !== "after");
  if ( !grouped ) return own.map(n => ({ roll: n.id, copies: [] }));
  const byActor = new Map();
  for ( const n of own ) {
    const group = byActor.get(n.actorKey);
    if ( group ) group.copies.push(n.id);
    else byActor.set(n.actorKey, { roll: n.id, copies: [] });
  }
  return [...byActor.values()];
}

/** Tous les combattants ont-ils une initiative ? (le premier round peut commencer) */
export function allRolled(initiatives) {
  const list = initiatives ?? [];
  return list.length > 0 && list.every(n => Number.isFinite(n));
}
