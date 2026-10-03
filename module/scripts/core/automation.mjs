/**
 * Ce que le moteur fait d'un item, pour la pastille de la fiche (SPEC §9.2) : un classement lisible par le MJ,
 * pas une règle. Rien ici ne décide d'une résolution.
 *
 *   rule     une règle propre au moteur (contenu déclaré, identifiant reconnu, variantes lues dans le texte)
 *   auto     le chemin commun : une activité qui jette, pose un effet, invoque, transforme ou lance un sort
 *   passive  aucun geste : des effets permanents (transfert) que dnd5e applique seul
 *   manual   rien de tout ça : une activité vide, ou pas d'activité du tout
 *   none     du matériel sans rien à jouer (butin, contenant, focaliseur) : pas de pastille, le drapeau reste
 */

/** Types d'activité de dnd5e 6 que le chemin commun résout sans rien de plus (data/activity/, `metadata.type`). */
export const AUTO_ACTIVITY_TYPES = Object.freeze(["attack", "save", "damage", "heal", "check", "summon", "enchant",
  "transform", "cast", "forward"]);

/**
 * @param {object} desc
 * @param {string[]} [desc.rules]  ce que le moteur reconnaît en propre (clés du contenu, « multiattack »…)
 * @param {Array<{type: string, roll?: boolean, effects?: number}>} [desc.activities]
 * @param {number} [desc.passiveEffects]  effets transférés actifs, ou ce que dnd5e calcule seul (la CA d'une armure)
 * @param {boolean} [desc.gear]  du matériel (objet, butin, contenant), pas une capacité ni un sort
 * @returns {{level: "rule"|"auto"|"passive"|"manual"|"none", rules: string[]}}
 */
export function automationOf({ rules=[], activities=[], passiveEffects=0, gear=false }={}) {
  if ( rules.length ) return { level: "rule", rules: [...rules] };
  const acts = activities.some(a => AUTO_ACTIVITY_TYPES.includes(a.type) || a.roll || (a.effects > 0));
  if ( acts ) return { level: "auto", rules: [] };
  if ( passiveEffects > 0 ) return { level: "passive", rules: [] };
  return { level: (gear && !activities.length) ? "none" : "manual", rules: [] };
}

/**
 * Les signalements groupés par acteur, pour le bilan de fin de partie.
 * @param {Record<string, {actor: string, item: string, note?: string, at: number}>} entries
 * @returns {Array<{actor: string, items: Array<{key: string, item: string, note: string, at: number}>}>}
 */
export function reportsByActor(entries={}) {
  const groups = new Map();
  for ( const [key, e] of Object.entries(entries) ) {
    const list = groups.get(e.actor) ?? [];
    list.push({ key, item: e.item, note: e.note ?? "", at: e.at ?? 0 });
    groups.set(e.actor, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([actor, items]) => ({ actor, items: items.sort((a, b) => a.item.localeCompare(b.item)) }));
}

/** Le bilan en texte brut, à coller dans une conversation. */
export function reportsText(entries={}) {
  return reportsByActor(entries).map(({ actor, items }) =>
    [`${actor}`, ...items.map(i => `  - ${i.item}${i.note ? ` : ${i.note}` : ""}`)].join("\n")).join("\n");
}
