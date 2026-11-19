/**
 * Étape `resist` d'une réaction à un coup (Défense supérieure du chasseur : « quand vous subissez des dégâts, votre Réaction vous
 * donne la Résistance à ces dégâts et à tout autre dégât du même type jusqu'à la fin du tour en cours »). Fonction pure : les
 * changements de l'effet à poser, dans la forme des données de dnd5e (`system.traits.dr.value`, « add », comme la Rage).
 * @param {string[]} types               les types de dégâts du coup
 * @param {{resisted?: Iterable<string>, immune?: Iterable<string>}} [bearer]  ce que le porteur a déjà
 * @returns {Array<{key: string, type: "add", value: string, phase: "initial"}>}  rien si tout est déjà couvert
 */
export function turnResistanceChanges(types, { resisted=[], immune=[] }={}) {
  const covered = new Set([...resisted, ...immune]);
  return [...new Set(types ?? [])].filter(t => (typeof t === "string") && t && !covered.has(t))
    .map(value => ({ key: "system.traits.dr.value", type: "add", value, phase: "initial" }));
}
