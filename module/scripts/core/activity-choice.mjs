/**
 * Quelle activité utiliser quand dnd5e demande « laquelle ? » (SPEC §42.1). Un item à plusieurs activités ouvre le choix
 * d'activité de dnd5e à chaque utilisation ; souvent ce choix n'en est pas un — une seule activité se lance, les autres sont
 * des suites que le moteur joue lui-même (les dégâts de froid de l'Armure d'Agathys, la sauvegarde du Sanctuaire), ou la
 * réponse est un fait (Glas : la cible est-elle blessée ?). Ici, la décision, sans Foundry ; null = laisser la question.
 *
 * On ne répond à la place du joueur que pour un item que le moteur connaît (`known`) : pour un sort qu'il ne joue pas, la
 * fenêtre reste le moyen d'atteindre ses suites à la main.
 */

/**
 * @param {object} query
 * @param {{id: string, timed: boolean, slot: boolean}[]} query.activities  Les activités que la fenêtre propose. `timed` : elle
 *   a un temps d'incantation (action, action Bonus, réaction, minute…) — une suite déclenchée par le moteur n'en a pas ;
 *   `slot` : elle dépense l'emplacement de sort.
 * @param {number} [query.level]      Niveau du sort (0 : tour de magie, ou pas un sort).
 * @param {boolean} [query.known]     Le moteur a une règle pour cet item.
 * @param {boolean} [query.running]   Le sort est déjà en cours pour ce lanceur (concentration, effet posé).
 * @param {{healthy: string, wounded: string}|null} [query.byWounds]  Glas : l'activité selon les PV de la cible.
 * @param {boolean} [query.wounded]   Les cibles désignées sont toutes blessées.
 * @returns {string|null}  L'identifiant de l'activité à utiliser, ou null : la question reste posée.
 */
export function activityToUse({ activities=[], level=0, known=false, running=false, byWounds=null, wounded=false, entry=null }={}) {
  const has = id => activities.some(a => a.id === id);
  // §45 : l'item désigne lui-même l'activité qu'on lance (Avaler / Engloutir : celle qui avale ; les dégâts à chaque tour et
  // la sortie du cadavre sont joués par le moteur).
  if ( entry && has(entry) ) return entry;
  // §46 : une attaque, seule activité de l'item à coûter une action (action, action Bonus, réaction…), dont les autres ne
  // sont que des suites — la sauvegarde que le coup impose (Griffe de la Goule : le moteur l'enchaîne, §18.4), un test
  // d'évasion, des dégâts à part. Vaut pour tout item, connu du moteur ou non : les suites restent dans la liste des
  // activités de la fiche.
  const costly = activities.filter(a => a.cost);
  if ( (costly.length === 1) && (costly[0].type === "attack") ) return costly[0].id;
  if ( byWounds ) {
    const wanted = wounded ? byWounds.wounded : byWounds.healthy;
    return has(wanted) ? wanted : (has(byWounds.healthy) ? byWounds.healthy : null);
  }
  if ( !known ) return null;
  const timed = activities.filter(a => a.timed);
  // Une seule activité se lance : les autres sont des suites.
  if ( timed.length === 1 ) return timed[0].id;
  // Un sort à emplacements pas encore lancé : l'incantation est la seule à dépenser l'emplacement, les autres (déplacer la
  // marque, réchauffer le métal, les dégâts de l'action Bonus) n'ont de sens qu'une fois le sort en cours — là, on demande.
  if ( running || !(level > 0) ) return null;
  const casts = timed.filter(a => a.slot);
  return (casts.length === 1) ? casts[0].id : null;
}
