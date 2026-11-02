/**
 * K12 (SPEC §333) : défauts de la donnée du Monster Manual 2024 que le texte ne suffit pas à corriger, par identifiant dnd5e.
 * Ids d'effets relevés dans le pack `actors` du module premium.
 */
export const MONSTERS = Object.freeze({
  // Miasme nocif (dragons verts) : l'effet vise `system.armor.value`, sans effet sur une créature ; −2 à la CA.
  "noxious-miasma": { effectChanges: { TSWsGeApnMgxOyIF: [{ key: "system.attributes.ac.bonus", type: "add", value: "-2" }] } }
});
