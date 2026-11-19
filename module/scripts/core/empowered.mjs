/**
 * Sort renforcé (Métamagie, SRD 5.2) : « quand vous lancez les dégâts d'un sort, vous pouvez dépenser 1 point de sorcellerie
 * pour relancer un nombre de dés de dégâts allant jusqu'à votre modificateur de Charisme (au moins un) ; vous devez utiliser les
 * nouveaux jets ». Le moteur propose les dés qui valent la moitié de leur maximum ou moins, les plus bas d'abord. Fonctions pures.
 */

/**
 * Les dés à relancer : au plus `count`, parmi ceux qui valent la moitié de leur maximum ou moins, du plus bas (rapporté à ses
 * faces) au plus haut ; à égalité, le dé aux plus grandes faces (plus à gagner).
 * @param {Array<{value: number, faces: number}>} dice
 * @param {number} count
 * @returns {number[]}  les indices dans `dice`
 */
export function empoweredPicks(dice, count) {
  const limit = Math.max(1, Math.floor(Number(count) || 0));
  return (dice ?? []).map((d, index) => ({ index, value: Number(d.value), faces: Number(d.faces) }))
    .filter(d => (d.faces > 1) && (d.value <= d.faces / 2))
    .sort((a, b) => (a.value / a.faces) - (b.value / b.faces) || (b.faces - a.faces) || (a.index - b.index))
    .slice(0, limit).map(d => d.index);
}

/**
 * Ce que la relance change à l'agrégat des dégâts, part par part (type et propriétés) : l'ancien total des dés relancés et le
 * nouveau.
 * @param {Array<{type: string|null, properties: string[], value: number}>} picked  les dés relancés
 * @param {number[]} rerolled                                                       leurs nouvelles valeurs, dans le même ordre
 * @returns {Array<{type: string|null, properties: string[], old: number, now: number}>}
 */
export function empoweredDeltas(picked, rerolled) {
  const parts = new Map();
  picked.forEach((die, i) => {
    const key = `${die.type ?? ""}|${[...(die.properties ?? [])].sort().join(",")}`;
    const part = parts.get(key) ?? { type: die.type ?? null, properties: [...(die.properties ?? [])], old: 0, now: 0 };
    part.old += Number(die.value) || 0;
    part.now += Number(rerolled[i]) || 0;
    parts.set(key, part);
  });
  return [...parts.values()];
}
