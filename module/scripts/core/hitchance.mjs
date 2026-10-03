/**
 * Chance de toucher (SPEC §15.3, façon BG3) : la probabilité qu'un jet d'attaque touche une CA,
 * avec les règles du d20 de dnd5e — 1 naturel rate toujours, un naturel au seuil de critique ou
 * au-dessus touche toujours (et est critique), avantage et désavantage s'annulent. Le bonus peut
 * porter des dés (Bénédiction : +1d4), dont on calcule la loi exacte. Fonctions pures, aucune
 * dépendance à Foundry.
 */

/**
 * Loi du d20 naturel selon le mode : probabilité de chaque face 1..20 (indice 0 inutilisé).
 * @param {1|0|-1} mode  1 : avantage (le plus haut de deux), -1 : désavantage (le plus bas).
 * @returns {number[]}
 */
export function d20Law(mode=0) {
  const law = [0];
  for ( let n = 1; n <= 20; n++ ) {
    if ( mode === 1 ) law.push(((n * n) - ((n - 1) * (n - 1))) / 400);
    else if ( mode === -1 ) law.push((((21 - n) * (21 - n)) - ((20 - n) * (20 - n))) / 400);
    else law.push(1 / 20);
  }
  return law;
}

/**
 * Loi de la somme d'un bonus fixe et de dés : Map valeur → probabilité.
 * @param {number} flat
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} dice
 * @returns {Map<number, number>}
 */
export function bonusLaw(flat=0, dice=[]) {
  let law = new Map([[flat, 1]]);
  for ( const { number, faces, sign=1 } of dice ) {
    for ( let k = 0; k < number; k++ ) {
      const next = new Map();
      for ( const [value, p] of law ) {
        for ( let f = 1; f <= faces; f++ ) {
          const v = value + (sign * f);
          next.set(v, (next.get(v) ?? 0) + (p / faces));
        }
      }
      law = next;
    }
  }
  return law;
}

/**
 * Chance de toucher une CA.
 * @param {object} attack
 * @param {number|null} attack.ac                 CA à battre (abri compris) ; null : intouchable (abri total).
 * @param {number} [attack.bonus]                 Partie fixe du bonus d'attaque.
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} [attack.dice]  Dés du bonus.
 * @param {1|0|-1} [attack.mode]                  Avantage, jet normal, désavantage.
 * @param {number} [attack.critical]              Seuil de critique (20 par défaut).
 * @param {boolean} [attack.autoCritical]         Tout coup qui touche est critique (Paralysé, Inconscient au contact).
 * @returns {{hit: number, critical: number}}     Probabilités entre 0 et 1 ; `critical` est comprise dans `hit`.
 */
export function hitChance({ ac, bonus=0, dice=[], mode=0, critical=20, autoCritical=false }) {
  if ( (ac === null) || (ac === undefined) ) return { hit: 0, critical: 0 };
  const d20 = d20Law(mode);
  const extra = Array.from(bonusLaw(bonus, dice));
  const threshold = Math.min(Math.max(critical, 2), 20);
  let hit = 0;
  let crit = 0;
  for ( let n = 1; n <= 20; n++ ) {
    const p = d20[n];
    if ( n === 1 ) continue;
    if ( n >= threshold ) { hit += p; crit += p; continue; }
    for ( const [value, q] of extra ) if ( n + value >= ac ) hit += p * q;
  }
  if ( autoCritical ) crit = hit;
  return { hit: clamp01(hit), critical: clamp01(crit) };
}

const clamp01 = x => Math.min(1, Math.max(0, x));

/**
 * Chance qu'une sauvegarde échoue (§15.3, dette réglée le 2026-09-27) : d20 + bonus < DD. Pas de réussite ni d'échec
 * automatique au dé naturel pour une sauvegarde (règles 2024 : seul le jet d'attaque a son 1 et son 20) ; un état peut
 * la faire échouer d'office (Paralysé en Force ou Dextérité), une immunité la rendre sans objet.
 * @param {object} save
 * @param {number} save.dc
 * @param {number} [save.bonus]                   Partie fixe du bonus de sauvegarde.
 * @param {Array<{number: number, faces: number, sign?: 1|-1}>} [save.dice]  Dés du bonus (Bénédiction, Imprécation).
 * @param {1|0|-1} [save.mode]
 * @param {boolean} [save.autoFail]
 * @param {boolean} [save.immune]
 * @returns {number}  Probabilité d'échec, entre 0 et 1.
 */
export function saveFailChance({ dc, bonus=0, dice=[], mode=0, autoFail=false, immune=false }) {
  if ( immune ) return 0;
  if ( autoFail ) return 1;
  const d20 = d20Law(mode);
  const extra = Array.from(bonusLaw(bonus, dice));
  let fail = 0;
  for ( let n = 1; n <= 20; n++ ) {
    for ( const [value, q] of extra ) if ( n + value < dc ) fail += d20[n] * q;
  }
  return clamp01(fail);
}

/** Pourcentage entier à afficher : jamais 0 ni 100 tant que le résultat n'est pas certain. */
export function asPercent(p) {
  if ( p <= 0 ) return 0;
  if ( p >= 1 ) return 100;
  return Math.min(99, Math.max(1, Math.round(p * 100)));
}
