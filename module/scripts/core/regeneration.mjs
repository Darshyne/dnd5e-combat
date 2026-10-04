/**
 * M8 (SPEC §18.13) : Régénération des monstres (Trolls, Slaads, Oni, Gardien du bouclier, Revenant). Ce que le texte anglais
 * d'origine précise, et ce qui se passe au début du tour de la créature. Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…").replace(/&Reference\[([^\]]+)\]/g, "$1")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/\s+/g, " ");

/**
 * - `needsHp` : « if it has at least 1 Hit Point » (Slaads, Oni) ;
 * - `stoppedBy` : « If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn » ;
 * - `survivesZero` : « The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate ».
 * @param {string} html
 * - §78, lycanthropes (MM 2014) : « regains 10 hit points at the start of her turn if she hasn't taken necrotic damage or
 *   bludgeoning, piercing, or slashing damage from a silvered weapon since her last turn » — `stoppedBy` (nécrotique) et
 *   `silveredBy` (contondant, perforant, tranchant : seulement d'une arme argentée).
 * @returns {{needsHp: boolean, stoppedBy: string[], silveredBy: string[], survivesZero: boolean}}
 */
export function readRegeneration(html) {
  const text = plain(html);
  const needsHp = /\bif it has at least 1 Hit Points?\b/i.test(text);
  const types = s => s.split(/,|\bor\b|\band\b/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const stopped = text.match(/\btakes ([A-Za-z ,]+?) damage, this trait doesn[’']t function/i);
  const stoppedBy = stopped ? types(stopped[1]) : [];
  const silveredBy = [];
  const since = text.match(/\bif (?:it|she|he|they) (?:hasn[’']t|has not|haven[’']t) taken (.+?) since (?:its|her|his|their) last turn/i);
  if ( since ) {
    // « necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon » : un groupe par « … damage ».
    for ( const m of since[1].matchAll(/(?:^|\bor\s+)((?:[a-z]+,?\s+(?:or\s+)?)*?[a-z]+) damage( from (?:a )?silvered weapons?)?/gi) ) {
      (m[2] ? silveredBy : stoppedBy).push(...types(m[1]));
    }
  }
  const survivesZero = /\b(?:dies|destroyed) only if (?:it|she|he|they) starts? (?:its|her|his|their) turn with 0 Hit Points\b/i.test(text);
  return { needsHp, stoppedBy, silveredBy, survivesZero };
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

/** Les types de dégâts subis coupent-ils la régénération ? `silvered` : les types reçus d'une arme argentée (§78). */
export function stopsRegeneration(stoppedBy, types, silveredBy=[], silvered=[]) {
  return stoppedBy.some(t => types.includes(t)) || silveredBy.some(t => silvered.includes(t));
}
