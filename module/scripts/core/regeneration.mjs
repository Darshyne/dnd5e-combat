/**
 * M8 (SPEC §18.13) : Régénération des monstres (Trolls, Slaads, Oni, Gardien du bouclier, Revenant). Ce que le texte anglais
 * d'origine précise, et ce qui se passe au début du tour de la créature. Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…").replace(/&Reference\[([^\]]+)\]/g, "$1")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/**
 * - `needsHp` : « if it has at least 1 Hit Point » (Slaads, Oni) ;
 * - `stoppedBy` : « If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn » ;
 * - `survivesZero` : « The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate ».
 * @param {string} html
 * @returns {{needsHp: boolean, stoppedBy: string[], survivesZero: boolean}}
 */
export function readRegeneration(html) {
  const text = plain(html);
  const needsHp = /\bif it has at least 1 Hit Points?\b/i.test(text);
  const stopped = text.match(/\btakes ([A-Za-z ,]+?) damage, this trait doesn[’']t function/i);
  const stoppedBy = stopped ? stopped[1].split(/,|\bor\b|\band\b/).map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  const survivesZero = /\bdies only if it starts its turn with 0 Hit Points\b|\bdestroyed only if it starts its turn with 0 Hit Points\b/i.test(text);
  return { needsHp, stoppedBy, survivesZero };
}

/**
 * Au début de son tour : `heal` (elle régénère), `dies` (0 PV et la régénération ne fonctionne pas : le troll meurt) ou
 * `none`.
 * @param {{hp: number, needsHp: boolean, stopped: boolean, survivesZero: boolean, dead: boolean}} state
 */
export function regenerationAtTurnStart({ hp, needsHp, stopped, survivesZero, dead }) {
  if ( dead ) return "none";
  if ( stopped ) return (survivesZero && (hp <= 0)) ? "dies" : "none";
  if ( needsHp && (hp < 1) ) return "none";
  return "heal";
}

/** Les types de dégâts subis coupent-ils la régénération ? */
export function stopsRegeneration(stoppedBy, types) {
  return stoppedBy.some(t => types.includes(t));
}
