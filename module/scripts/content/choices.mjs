/**
 * Effets exclusifs livrés avec le module (SPEC §7, étape `choice`) : l'activité porte plusieurs
 * effets dont la règle n'en fait appliquer qu'UN, au choix de l'auteur. Le moteur le lui demande
 * (adapter/choices.mjs) avant d'appliquer, au lieu de tout poser comme le fait un plan d'utilitaire.
 * Un item peut déclarer le sien dans `flags["dnd5e-combat"].choice`.
 *
 *   { effects: "one", prompt?: <texte> }   — `prompt` : question affichée, à défaut la question générique.
 *
 * Identifiants vérifiés dans packs/_source/spells24 de dnd5e 6.0.3 (`system.identifier`).
 */

export const CHOICES = Object.freeze({
  // Une caractéristique au choix : six effets « Hexed <caractéristique> » sur l'activité Place Curse.
  "hex": { effects: "one" },
  // Attaque à mains nues 2024, sauvegarde ratée : Lutte (agrippé) OU Bousculade (à terre, ou repoussé de 1,50 m).
  // L'item du Barbare et du Moine (classes24, même identifiant) n'a que les deux premiers.
  "unarmed-strike": { effects: "one" },
  // Bouclier de feu : « le bouclier est chaud ou froid, au choix » — deux effets sur l'activité utilitaire (chaud :
  // résistance au froid, riposte de feu ; froid : l'inverse). Sans choix, le plan poserait les deux (§16.9).
  "fire-shield": { effects: "one" },
  // §53 : Potion de résistance — « Résistance à un type de dégâts » (le MJ choisit ou tire) : dix effets, un seul posé.
  "potion-of-resistance": { effects: "one" },
  // Résistance (§16.46) : « en choisissant un type de dégâts » — onze effets « Protection : … » sur l'activité ; sans choix, le
  // plan les poserait tous (la cible résisterait à tout).
  "resistance": { effects: "one" },
  // §16.47 : Assistance — « choisissez une compétence » ; dnd5e pose ses 18 effets (un par compétence) d'un coup.
  "guidance": { effects: "one" },
  // §19 : Cécité/surdité — « Aveuglé ou Assourdi (au choix) » ; Mauvais œil — « l'un des effets suivants, au choix ».
  "blindness-deafness": { effects: "one" },
  "eyebite": { effects: "one" },
  // Audit du compendium des sorts du PHB (le 2026-09-27) : activités à plusieurs effets dont la règle n'en donne qu'un.
  // Amélioration de caractéristique — « choisissez une caractéristique » (cinq effets, un par caractéristique hors Con).
  "enhance-ability": { effects: "one" },
  // Agrandissement/rapetissement — « la cible est agrandie ou rapetissée, au choix ».
  "enlarge-reduce": { effects: "one" },
  // Protection contre l'énergie — « résistance à un type de dégâts de votre choix » (acide, froid, feu, foudre, tonnerre).
  "protection-from-energy": { effects: "one" },
  // Apaisement des émotions — « choisissez l'un des deux effets » (Apaisé, Indifférence).
  "calm-emotions": { effects: "one" },
  // Contagion — « choisissez une caractéristique » (six effets Infecté).
  "contagion": { effects: "one" }
});
