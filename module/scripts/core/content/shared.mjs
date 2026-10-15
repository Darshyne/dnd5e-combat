/**
 * Petits tests partagés par les validateurs du contenu. Fonctions pures, aucune dépendance à Foundry.
 */
export const isObject = v => (typeof v === "object") && (v !== null) && !Array.isArray(v);
export const isId = v => (typeof v === "string") && /^[A-Za-z0-9]{16}$/.test(v);
