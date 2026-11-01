/**
 * Téléportations de soi à l'utilisation (SPEC §16.10, clé `teleport` de core/content.mjs) : la distance que le texte
 * de la règle donne et que les données de l'item ne portent pas. Les sorts SRD du système ont une activité native
 * « teleport » (Foulée brumeuse, Porte dimensionnelle de spells24) ; ceux du module premium PHB, que la table utilise,
 * n'en ont pas (utilitaire, ou dégâts pour Porte dimensionnelle). Le moteur prend l'activité native quand elle existe.
 *
 * Identifiants vérifiés dans l'extraction du PHB 2.2.0 (projet de traduction, work/phb-en).
 */

export const TELEPORTS = Object.freeze({
  // « Vous vous téléportez jusqu'à 9 m dans un espace inoccupé que vous voyez » (action bonus).
  "misty-step": { distance: 30, units: "ft" },
  // « …jusqu'à 150 m » ; §264 : « une créature consentante… à 1,50 m de vous… dans un espace à 1,50 m de votre destination ».
  // C12-b : « un lieu que vous voyez, ou que vous décrivez » — derrière un mur, hors de vue : permis (`unseen`).
  "dimension-door": { distance: 500, units: "ft", passengers: { count: 1, within: 5, units: "ft" }, unseen: true },
  // Goliath, ascendance des géants des nuages : « jusqu'à 9 m dans un espace inoccupé que vous voyez ».
  "clouds-jaunt": { distance: 30, units: "ft" },
  // Don du voyage dimensionnel, Pas clignotants : « …après l'action Attaque ou Magie, jusqu'à 9 m ».
  "boon-of-dimensional-travel": { distance: 30, units: "ft" },
  // C12-d : Voyage au gré de l'Arbre (Arbre-monde 10) — « par une action Bonus, téléportez-vous jusqu'à 18 m dans un espace inoccupé que
  // vous voyez » (l'activité courte ; la longue, 45 m avec six passagers, reste au joueur).
  "travel-along-the-tree": { distance: 60, units: "ft", activity: "4e13OzT2UzbhQICL" }
});
