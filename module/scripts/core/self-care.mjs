/**
 * §278 : ce qu'une créature se rend à elle-même à un moment du tour — mettre fin à un de ses états, retirer un niveau d'Épuisement, regagner
 * les utilisations d'items au jet d'initiative. Formes de règle et décisions, sans Foundry (runtime/feats.mjs, runtime/roll-bonus.mjs).
 */

/**
 * `endsOwnConditions` : la liste d'états (§236, Auto-restauration : à la fin du tour), ou `{ statuses?, at?, exhaustion?, uses? }` —
 * `at` : "turnStart" | "turnEnd" (défaut) ; `exhaustion` : à défaut d'un état, un niveau d'Épuisement retiré ; `uses` : chaque fois coûte
 * une utilisation de l'item (rien sans utilisation restante).
 * @returns {{statuses: string[], at: "turnStart"|"turnEnd", exhaustion: boolean, uses: boolean}}
 */
export function ownConditionsRule(value) {
  if ( Array.isArray(value) ) return { statuses: value, at: "turnEnd", exhaustion: false, uses: false };
  return { statuses: value?.statuses ?? [], at: value?.at ?? "turnEnd", exhaustion: !!value?.exhaustion, uses: !!value?.uses };
}

/**
 * Ce que la règle retire maintenant : le premier état de la liste que la créature porte, sinon un niveau d'Épuisement (si permis).
 * @param {{statuses: Set<string>|string[], exhaustion: number, usesLeft?: number|null}} state  `usesLeft` : null = sans compte
 * @returns {{status: string}|{exhaustion: true}|null}
 */
export function pickOwnCondition(rule, { statuses, exhaustion=0, usesLeft=null }) {
  if ( rule.uses && !(usesLeft > 0) ) return null;
  const has = new Set(statuses ?? []);
  const status = rule.statuses.find(s => has.has(s));
  if ( status ) return { status };
  if ( rule.exhaustion && (exhaustion > 0) ) return { exhaustion: true };
  return null;
}

/**
 * `regainOnInitiative` : `{ item, upTo }` (§236, Inspiration supérieure : les utilisations de l'item remontent à `upTo` au moins), ou
 * `{ items?, exhaustion?, uses? }` — `items` : identifiants d'items dont toutes les utilisations reviennent ; `exhaustion` : niveaux
 * d'Épuisement retirés ; `uses` : coûte une utilisation de l'item qui porte la règle, et ne se fait que s'il y a quelque chose à gagner.
 * Ou `{ items, activity }` (Métabolisme surnaturel) : rien n'est écrit ici — l'activité nommée de l'item qui porte la règle fait le
 * travail (ses consommations, ses soins), proposée au joueur quand un des `items` a des utilisations dépensées et qu'il en
 * reste une à l'item de la règle.
 * @param {object} rule
 * @param {{items: Record<string, {max: number, spent: number}>, exhaustion: number, usesLeft?: number|null}} state  `items` : par identifiant
 * @returns {{spent: Record<string, number>, exhaustion: number|null, pay: boolean, use?: string, back?: number}|null}  les
 *   nouvelles valeurs de `uses.spent` par identifiant, le nouveau niveau d'Épuisement (null : inchangé), et s'il faut payer ; avec `use`,
 *   l'activité à proposer (`back` : ce qu'elle rendrait) ; null : rien à faire
 */
export function initiativeRegain(rule, { items={}, exhaustion=0, usesLeft=null }) {
  if ( rule.activity ) {
    const back = (rule.items ?? []).reduce((n, id) => n + (items[id]?.max ? (items[id].spent || 0) : 0), 0);
    if ( !back || ((usesLeft !== null) && !(usesLeft > 0)) ) return null;
    return { spent: {}, exhaustion: null, pay: false, use: rule.activity, back };
  }
  const spent = {};
  if ( rule.item ) {
    const s = items[rule.item];
    if ( s?.max ) {
      const want = Math.min(rule.upTo, s.max);
      if ( (s.max - (s.spent || 0)) < want ) spent[rule.item] = s.max - want;
    }
  }
  for ( const id of rule.items ?? [] ) if ( items[id]?.max && (items[id].spent > 0) ) spent[id] = 0;
  const level = (rule.exhaustion > 0) && (exhaustion > 0) ? Math.max(0, exhaustion - rule.exhaustion) : null;
  if ( !Object.keys(spent).length && (level === null) ) return null;
  if ( rule.uses && !(usesLeft > 0) ) return null;
  return { spent, exhaustion: level, pay: !!rule.uses };
}
