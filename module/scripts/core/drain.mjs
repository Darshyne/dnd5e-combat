/**
 * M8 (SPEC §18.16) : drain du maximum de points de vie (Absorption de vie des Nécrophage, Âme-en-peine, Spectre ; Trompe du
 * Chasme ; Coup du Golem d'argile ; Morsure et Drain sanguin des vampires ; Baiser drainant ; Parole funeste ; Drain
 * d'énergie de la Demi-liche). Ce que dit le texte anglais d'origine. Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…")
  .replace(/&Reference\[([^\]]+)\](?:\{[^}]*\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/**
 * - `equal` : « its Hit Point maximum decreases by an amount equal to the [Necrotic] damage taken » — `type` : ce type-là
 *   seulement (null : tous) ;
 * - `regains` : « and the vampire regains Hit Points equal to that amount » ;
 * - `fixed` : « the target's Hit Point maximum decreases by 14 ([[/r 4d6]]) » — une formule, sur une sauvegarde ratée.
 * Une réduction « every 24 hours » (malédictions de la Momie, du Slaad) n'est pas un drain de combat : ignorée.
 * @param {string} html
 * @returns {{equal: boolean, type: string|null, regains: boolean, fixed: string|null}}
 */
export function readDrain(html) {
  const raw = String(html ?? "");
  const text = plain(raw);
  if ( /\bevery \d+ hours\b/i.test(text) ) return { equal: false, type: null, regains: false, fixed: null };
  const equal = text.match(/Hit Point maximum decreases by an amount equal to the (?:([A-Za-z]+) )?damage taken/i);
  const type = equal?.[1] ? equal[1].toLowerCase() : null;
  const regains = /\bregains Hit Points equal to that amount\b/i.test(text);
  const fixed = raw.match(/Hit Point maximum decreases by \d+ \(\[\[\/r ([^\]#]+?)(?:#[^\]]*)?\]\]\)/i)?.[1]?.trim() ?? null;
  return { equal: !!equal, type, regains, fixed };
}

/**
 * La part drainée de dégâts calculés (valeurs finales par type, après résistances) : ceux du type nommé, ou tous les dégâts
 * (hors soins et PV temporaires) ; jamais plus que le total subi.
 * @param {Array<{type: string, value: number}>} damages
 * @param {string|null} type
 * @param {number} [amount]   Total subi.
 */
export function drainedAmount(damages, type, amount) {
  const skip = new Set(["healing", "temphp", "maximum"]);
  const sum = damages.filter(d => (d.value > 0) && !skip.has(d.type) && (!type || (d.type === type))).reduce((n, d) => n + d.value, 0);
  return Math.max(0, Math.min(Math.trunc(sum), Math.trunc(amount ?? sum)));
}
