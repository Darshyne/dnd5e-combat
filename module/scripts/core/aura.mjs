/**
 * Auras passives (Aura de protection du paladin) : un effet que des créatures reçoivent tant
 * qu'elles se tiennent près d'une autre, et perdent en s'éloignant. dnd5e 6.0 ne sait le faire
 * que pour une zone posée par une activité ; son Aura de protection officielle ne touche que le
 * paladin. Fonctions pures, aucune dépendance à Foundry.
 */

/**
 * @typedef {object} AuraSource
 * @property {string} token          UUID du token porteur de l'aura.
 * @property {string} key            Identifiant de l'aura (deux auras de même nom ne se cumulent pas).
 * @property {number} disposition
 * @property {boolean} inactive      Porteur neutralisé ou mort : l'aura est éteinte.
 * @property {number} radius         Dans la même unité que les distances fournies.
 * @property {"ally"|"enemy"|"any"} affects
 * @property {boolean} includeSelf   Le porteur reçoit-il lui aussi la copie ? (non s'il a déjà l'effet d'origine)
 * @property {number} value          Force de l'aura, pour départager deux auras de même nom.
 * @property {string[]} [types]      Seulement ces types de créature (« les morts-vivants de son choix »).
 */

/**
 * Qui reçoit l'aura d'une source, parmi des tokens dont on connaît la distance à cette source.
 * `lineOfEffect` : false exclut (abri total entre les deux), null ou absent n'exclut pas ; `type` : type de créature.
 */
export function auraRecipients(source, candidates) {
  if ( source.inactive ) return [];
  return candidates.filter(c => {
    if ( c.token === source.token ) return source.includeSelf;
    if ( c.distance > source.radius + 1e-6 ) return false;
    // Une émanation est arrêtée par un abri total (règles 2024) : plancher, plafond, mur plein — P2 (§14.2).
    if ( c.lineOfEffect === false ) return false;
    if ( source.types?.length && !source.types.includes(c.type) ) return false;
    if ( source.affects === "ally" ) return c.disposition === source.disposition;
    if ( source.affects === "enemy" ) return c.disposition !== source.disposition;
    return true;
  }).map(c => c.token);
}

/**
 * Ce que chaque token doit porter, toutes sources confondues. Deux auras de même nom ne se
 * cumulent pas : la plus forte l'emporte (règles 2024, « effets de même nom »).
 * @param {Array<{source: AuraSource, recipients: string[]}>} auras
 * @returns {Array<{target: string, key: string, source: string, value: number}>}
 */
export function wantedAuraEffects(auras) {
  const best = new Map();
  for ( const { source, recipients } of auras ) for ( const target of recipients ) {
    const slot = `${target}|${source.key}`;
    const current = best.get(slot);
    if ( !current || (source.value > current.value) ) best.set(slot, { target, key: source.key, source: source.token, value: source.value });
  }
  return Array.from(best.values());
}

/**
 * Écart entre les copies d'aura qui existent et celles qu'on veut.
 * @param {Array<{id: string, target: string, key: string, source: string, value: number}>} existing
 * @param {Array<{target: string, key: string, source: string, value: number}>} wanted
 * @returns {{create: object[], update: object[], remove: object[]}}
 */
export function planAuraChanges(existing, wanted) {
  const slot = e => `${e.target}|${e.key}`;
  const wantedBySlot = new Map(wanted.map(w => [slot(w), w]));
  const seen = new Set();
  const update = [];
  const remove = [];
  for ( const e of existing ) {
    const w = wantedBySlot.get(slot(e));
    if ( !w || seen.has(slot(e)) ) { remove.push(e); continue; }   // plus voulue, ou doublon
    seen.add(slot(e));
    if ( (w.source !== e.source) || (w.value !== e.value) ) update.push({ ...w, id: e.id });
  }
  const create = wanted.filter(w => !seen.has(slot(w)));
  return { create, update, remove };
}
