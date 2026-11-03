/**
 * Défenses de sorts (SPEC §16.46), sans Foundry.
 *  - Résistance (`damageShield`) : « quand la créature subit des dégâts du type retenu, elle réduit les dégâts subis de 1d4 ;
 *    une même créature ne peut bénéficier qu'une fois par tour de ce sort ».
 *  - Vigueur arcanique (`hitDiceHeal`) : un ou deux dés de vie dépensés pour se soigner, un dé de plus par niveau
 *    d'emplacement au-delà du 2e.
 * Fonctions pures.
 */

/**
 * Retire `amount` aux dégâts du type `type` (répartis sur leurs entrées, dans l'ordre), sans passer sous zéro.
 * @param {Array<{value: number, type: string}>} damages
 * @returns {{damages: Array<object>, reduced: number}}
 */
export function reduceDamageOfType(damages, type, amount) {
  let left = Math.max(0, Number(amount) || 0);
  let reduced = 0;
  const out = (damages ?? []).map(d => {
    if ( (d.type !== type) || (left <= 0) || !(d.value > 0) ) return d;
    const take = Math.min(left, d.value);
    left -= take;
    reduced += take;
    return { ...d, value: d.value - take };
  });
  return { damages: out, reduced };
}

/** Combien de dés de vie la Vigueur arcanique lance à ce niveau d'emplacement (au plus ceux qui restent). */
export function hitDiceAllowed({ base, spellLevel, slotLevel, available }) {
  const allowed = base + Math.max(0, (Number(slotLevel) || spellLevel) - spellLevel);
  return Math.max(0, Math.min(allowed, Number(available) || 0));
}

/**
 * O8d (§347) : Résistance aux dégâts d'une attaque à distance avec une arme (Bouclier d'attraction : « tant que vous tenez ce bouclier,
 * vous avez la Résistance aux dégâts des attaques faites avec des armes à distance »). Chaque part dont le type n'est pas déjà résisté
 * ni immunisé est divisée par deux, arrondie à l'inférieur ; les soins et les PV temporaires restent.
 * @param {Array<{value: number, type: string}>} damages
 * @param {{resisted?: Iterable<string>, immune?: Iterable<string>}} traits
 * @returns {{damages: Array<object>, reduced: number}}
 */
export function halveUnresisted(damages, { resisted=[], immune=[] }={}) {
  const skip = new Set([...resisted, ...immune, "healing", "temphp"]);
  let reduced = 0;
  const out = (damages ?? []).map(d => {
    if ( skip.has(d.type) || !(d.value > 0) ) return d;
    const value = Math.floor(d.value / 2);
    reduced += d.value - value;
    return { ...d, value };
  });
  return { damages: out, reduced };
}

/**
 * O8d (§347) : le porteur qui prend la place de la cible (Bouclier d'attraction : « quand une attaque avec une arme à distance vise une
 * créature à 3 m ou moins de vous, la malédiction fait de vous la cible ») — le plus proche parmi ceux à portée (`within`).
 * @param {Array<{id: string, distance: number, within: boolean}>} bearers
 * @returns {string|null}
 */
export function attractorOf(bearers) {
  const near = (bearers ?? []).filter(b => b.within && Number.isFinite(b.distance)).sort((a, b) => a.distance - b.distance);
  return near[0]?.id ?? null;
}

/** §355 : les types de créature dont une arme ne se nourrit pas (« sauf une Créature artificielle ou un Mort-vivant »). */
const SOULLESS = Object.freeze(["construct", "undead"]);

/**
 * §355 : ce qu'une attaque de l'arme rapporte à son porteur — `devours` (Noirtranchant : PV temporaires égaux au maximum de PV de la
 * créature qu'elle fait tomber à 0, et la créature est tuée) ; `critAmount` (Épée voleuse de vie : ces PV temporaires sur un coup
 * critique). Les PV temporaires ne se cumulent pas : la plus forte valeur. Rend `{ tempHp, slain }` (ids des victimes tuées).
 * @param {{devours?: boolean, critAmount?: number, victims: Array<{id: string, type: string|null, hit: boolean, critical: boolean, fell: boolean, maxHp: number}>}} data
 */
export function weaponFeed({ devours=false, critAmount=0, victims=[] }) {
  let tempHp = 0;
  const slain = [];
  for ( const v of victims ) {
    if ( SOULLESS.includes(v.type) ) continue;
    if ( devours && v.fell ) { slain.push(v.id); tempHp = Math.max(tempHp, Number(v.maxHp) || 0); }
    if ( (critAmount > 0) && v.hit && v.critical ) tempHp = Math.max(tempHp, critAmount);
  }
  return { tempHp, slain };
}

/**
 * §356 : les armes maudites qui s'emparent de leur porteur quand on le blesse (`wrath`) — Hache du berserker (`berserk` : « chaque fois
 * qu'une autre créature vous inflige des dégâts ») et Épée vengeresse (`vengeance` : « … en combat »). La sauvegarde est-elle due ?
 * @param {{kind: "berserk"|"vengeance", byOther: boolean, inCombat: boolean, marked: boolean}} data
 */
export function wrathSaveDue({ kind, byOther, inCombat, marked }) {
  if ( !byOther || marked ) return false;
  return (kind === "vengeance") ? inCombat : true;
}

/**
 * §356 : la colère prend-elle fin, au début du tour du porteur ? Folie furieuse : « quand vous commencez votre tour sans créature à 18 m
 * de vous » ; vengeance : « jusqu'à ce que vous tombiez à 0 PV, ou elle ».
 * @param {{kind: "berserk"|"vengeance", othersNear: boolean, foeDown: boolean, bearerDown: boolean}} data
 */
export function wrathEnds({ kind, othersNear, foeDown, bearerDown }) {
  if ( bearerDown ) return true;
  return (kind === "vengeance") ? foeDown : !othersNear;
}
