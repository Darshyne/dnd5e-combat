/**
 * Familiers (SPEC §107) : Appel de familier (PHB 2024, `find-familiar`), le Compagnon sauvage du druide (`wild-companion`) et le
 * Pacte de la chaîne de l'occultiste (`pact-of-the-chain`), déclarés `summon.familiar` (content/summons.mjs). Fonctions pures.
 *
 * Règles (PHB 2024, Appel de familier) : « un familier ne peut pas attaquer, mais il peut entreprendre d'autres actions
 * normalement » ; « par une action Magie, vous pouvez congédier temporairement le familier dans une poche dimensionnelle » ;
 * « par une action Magie tant qu'il est congédié temporairement, vous pouvez le faire réapparaître dans un espace inoccupé à
 * 9 m ou moins de vous » ; « chaque fois que le familier tombe à 0 point de vie ou disparaît dans la poche dimensionnelle, il
 * laisse dans son espace tout ce qu'il portait ».
 */

/** La distance à laquelle le familier réapparaît, en pieds (constante de règle, convertie comme le reste : SPEC §5.7). */
export const RECALL_RANGE = Object.freeze({ value: 30, units: "ft" });

/** Le coût de chaque geste du maître en combat : l'action Magie, une action. */
export const POCKET_COST = "action";

/**
 * Les actions de base qu'un familier reçoit : toutes sauf celles qui attaquent (`attack: true` dans la table — l'attaque à
 * mains nues et sa Lutte / Bousculade).
 * @param {Record<string, {attack?: boolean}>} table  BASIC_ACTIONS (content/actions.mjs).
 * @returns {string[]}
 */
export function familiarBasicKinds(table) {
  return Object.entries(table ?? {}).filter(([, def]) => def?.attack !== true).map(([kind]) => kind);
}

/** Types d'items qu'une créature porte (objets), par opposition à ses capacités. */
const CARRIED_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/**
 * Ce que le familier « porte » : les objets de sa fiche, sauf ses armes naturelles (Serres, Morsure : arme de type « natural »),
 * son armure naturelle (équipement « natural ») et les items du moteur (actions de base). Données simples :
 * `{ id, type, system: { type: { value } }, flags }`.
 * @param {object[]} items
 * @param {string} moduleId
 * @returns {string[]}  Les ids.
 */
export function carriedItemIds(items, moduleId) {
  return (items ?? []).filter(i => CARRIED_TYPES.has(i?.type)
    && !(((i.type === "weapon") || (i.type === "equipment")) && (i.system?.type?.value === "natural"))
    && !i.flags?.[moduleId]?.basicAction).map(i => i.id ?? i._id);
}

/**
 * Ce qui refuse la case de réapparition : « far » (au-delà de la portée), « occupied » (une créature l'occupe), ou null.
 * @param {{distance: number, limit: number, occupied: boolean}} args
 */
export function recallProblem({ distance, limit, occupied }) {
  if ( !Number.isFinite(distance) || (distance > limit + 1e-6) ) return "far";
  if ( occupied ) return "occupied";
  return null;
}

/**
 * Les données de création du token qui revient de la poche : celles du token congédié (son delta compris : PV, effets, items),
 * sans son id ni ses statistiques, sans ordre de suivi, posé à la case choisie, au niveau et à l'élévation du maître.
 * @param {object} stored    `TokenDocument#toObject()` au moment du congé.
 * @param {{x: number, y: number, elevation?: number, level?: string|null}} at
 * @param {string} moduleId
 */
export function recalledTokenData(stored, { x, y, elevation=0, level=null }, moduleId) {
  const { _id, _stats, ...data } = structuredClone(stored ?? {});
  const ours = data.flags?.[moduleId];
  if ( ours ) {
    delete ours.follow;
    if ( !Object.keys(ours).length ) delete data.flags[moduleId];
  }
  // La trace du déplacement d'avant (V14 : `_movementHistory`) ne vaut plus pour ce nouveau token.
  delete data._movementHistory;
  return { ...data, x, y, elevation, ...(level ? { level } : {}) };
}
