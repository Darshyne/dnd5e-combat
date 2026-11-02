/**
 * K12 (SPEC §333) : défauts de la donnée du Monster Manual 2024 que le texte ne suffit pas à corriger, par identifiant dnd5e.
 * Ids d'effets relevés dans le pack `actors` du module premium.
 */
export const MONSTERS = Object.freeze({
  // Miasme nocif (dragons verts) : l'effet vise `system.armor.value`, sans effet sur une créature ; −2 à la CA.
  "noxious-miasma": { effectChanges: { TSWsGeApnMgxOyIF: [{ key: "system.attributes.ac.bonus", type: "add", value: "-2" }] } },
  // Disparition (Feu follet, Esprit frappeur) : l'Invisibilité tombe après un jet d'attaque.
  "vanish": { breaksOn: ["attack"] },
  // Ravenloft. Protection ésotérique (Gennifer) : Étourdi seulement pour un Mort-vivant.
  "esoteric-ward": { effectsIf: { "target.creatureType": "undead" } },
  // Déformation du corps (Émissaire stellaire inférieur) : Étourdi « jusqu'au début de son prochain tour » — celui de la cible.
  "warp-body": { effectEnds: { TWb6uCeWCkVjk9eZ: "bearerTurnStart" } },
  // Savoir interdit (Azalin Rex) : Étourdi « jusqu'à la fin du prochain tour d'Azalin ».
  "forbidden-knowledge": { effectEnds: { uOo6EccSwmKB7CUp: "casterTurnEnd" } },
  // Forme tourbillonnante (Porte-parole du gibet) : entre dans la case d'une créature et s'y arrête.
  "whirling-form": { sharesSpace: "enter" },
  // Chair qui se défait (Désossé) : se déplace ensuite sans provoquer d'attaque d'opportunité.
  "unraveling-flesh": { noOpportunity: "afterUse" }
});
