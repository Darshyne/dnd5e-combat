/**
 * Le Barde du Manuel des joueurs 2024 (SPEC §33), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbbrd…`).
 * L'Inspiration bardique elle-même (le dé ajouté à un jet raté par la créature inspirée) est tenue par le moteur hors du contenu :
 * adapter/inspiration.mjs, runtime/engine.mjs.
 *
 * Ce que dnd5e fait déjà seul : l'Inspiration bardique donnée (activité, effet « Inspiré », utilisations), Touche-à-tout, Expertise,
 * Source d'inspiration, Pirouettes éblouissantes (CA, frappe à mains nues), Mante d'inspiration (PV temporaires), Attaque
 * supplémentaire (budget), les sorts toujours préparés des collèges.
 */

export const BARD = Object.freeze({
  // Mots cinglants (Savoir 3) : « quand une créature que vous voyez à 18 m réussit un jet d'attaque, votre Réaction et une
  // Inspiration : lancez le dé et soustrayez le résultat du jet » — proposé quand l'attaque touche le barde ou un allié ; l'attaque
  // est rejugée (le dé vaut autant de CA). Les tests et les jets de dégâts restent au joueur.
  "cutting-words": { triggers: [{ on: ["isHit", "allyIsHit"], do: [{ type: "use" }, { type: "penalty", formula: "@scale.bard.inspiration" }] }] },
  // Esquive cavalière (Danse 14) : l'Esquive totale (§20) ; la partager avec une créature à 1,50 m reste au joueur.
  "leading-evasion": { evasion: true }
});
