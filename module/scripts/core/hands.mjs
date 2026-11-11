/**
 * §409 (issue #44, lot 2) : la main libre de la composante somatique. Pur : aucune dépendance à Foundry.
 *
 * Règle 2024 : un sort à composante somatique (S) demande une main libre ; la composante matérielle (M) demande une main pour la bourse
 * ou le focaliseur, qui peut être la même que celle de S. Mage de guerre : S se fait même avec des armes ou un bouclier en main.
 * Une arme « à deux mains » ne compte deux mains qu'à l'attaque (2024) : entre deux coups, on la tient d'une main.
 */

/**
 * Ce que la créature tient : une entrée par objet en main.
 * @typedef {object} Held
 * @property {string} name
 * @property {number} hands        Mains prises (1 ; 2 pour une arme « à deux mains » quand `twoHanded`).
 * @property {boolean} [twoHanded] Arme « à deux mains » (propriété `two` de dnd5e).
 * @property {boolean} [focus]     Un focaliseur d'incantation tenu (bâton, baguette, orbe…).
 * @property {boolean} [armament]  Une arme ou un bouclier (ce que Mage de guerre couvre).
 */

/** Mains prises pour incanter : une arme « à deux mains » n'en prend qu'une hors de l'attaque. */
export function handsUsed(held) {
  return (held ?? []).reduce((n, h) => n + (h.twoHanded ? 1 : Math.max(0, Number(h.hands) || 0)), 0);
}

/**
 * Le sort se heurte-t-il à l'absence de main libre ? null s'il passe, sinon `{ items }` : les noms de ce qui occupe les mains.
 * @param {object} use
 * @param {boolean} use.spell          L'utilisation lance un sort.
 * @param {boolean} use.somatic        Il garde sa composante S (une copie « cast » d'un objet qui en dispense ne l'a plus).
 * @param {boolean} [use.material]     Il a une composante M (la main du focaliseur suffit alors).
 * @param {Held[]} use.held            Ce que la créature tient.
 * @param {boolean} [use.freeSomatic]  Mage de guerre (contenu `freeSomatic`).
 * @param {boolean} [use.waived]       Composante S levée pour ce lancement (Sort subtil).
 * @returns {{items: string[]}|null}
 */
export function somaticBlocked({ spell, somatic, material=false, held=[], freeSomatic=false, waived=false }) {
  if ( !spell || !somatic || waived ) return null;
  if ( handsUsed(held) < 2 ) return null;
  if ( material && held.some(h => h.focus) ) return null;
  if ( freeSomatic && held.every(h => h.armament) ) return null;
  return { items: held.map(h => h.name) };
}

/** Le contrôle des mains s'applique-t-il à cet acteur ? Réglage `somaticHands` : "off", "pc" (personnages joueurs), "all". */
export function handsCheckedFor(setting, isCharacter) {
  if ( setting === "all" ) return true;
  if ( setting === "off" ) return false;
  return !!isCharacter;
}
