/**
 * La classe d'un sort. dnd5e 6.0 l'écrit dans `system.sourceItem` (« class:druid », ou l'item d'une sous-classe) et la lit par
 * `classIdentifier` (data/item/spell.mjs:169-177, la migration de `sourceClass` : spell.mjs:424-431) ; le moteur lisait encore
 * `sourceClass`, qui n'existe plus — relevé des trous, 2026-10-22 : il retombait toujours sur « l'acteur a-t-il la classe ? », faux
 * pour un multiclassé. `classIdentifier` demande la classe sur la fiche ; sans elle, l'identifiant écrit (« class:… ») vaut. "" : aucune.
 * @param {Item} item
 * @returns {string}
 */
export function spellClassOf(item) {
  const s = item?.system ?? {};
  const written = String(s.sourceItem ?? "");
  return s.classIdentifier || (written.startsWith("class:") ? written.slice(6) : "") || s.sourceClass || "";
}
