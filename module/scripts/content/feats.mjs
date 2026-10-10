/**
 * Les dons du Manuel des joueurs 2024 (SPEC §129 ; relevé complet : prive/RELEVE_DONS.md), module premium `dnd-players-handbook`
 * 2.2.0, pack `feats`. Déjà ailleurs : Combat avec arme à deux mains, Combat avec arme de lancer, Interception (content/fighter.mjs),
 * Maître d'armes lourdes, Télékinésiste (content/triggers.mjs), Mage de guerre (content/bursts.mjs), Faveur du voyage dimensionnel
 * (content/teleports.mjs).
 *
 * Ce que dnd5e fait seul : la maîtrise à l'initiative de Vigilant (`initiativeAlert`), l'attaque améliorée de Bagarreur de tavernes (1d4 +
 * For, relance des 1 dans sa formule) et sa maîtrise des armes improvisées (`tavernBrawlerFeat`), les Soins de combat de Guérisseur
 * (activités, relance des 1 dans leur formule), les points de Chanceux (utilisations de l'item).
 */
export const FEATS = Object.freeze({
  // Bagarreur de tavernes : « quand vous touchez une créature d'une Attaque à mains nues dans le cadre de l'action Attaquer à votre tour,
  // vous pouvez lui infliger les dégâts et la repousser de 1,50 m. Une fois par tour. » Proposé au coup, comme une faveur.
  "tavern-brawler": { hitRider: { push: { distance: 5, units: "ft" }, unarmed: true, oncePerTurn: true } },
  // Sauvagerie martiale : « une fois par tour, quand vous touchez avec une arme, lancez ses dés de dégâts deux fois, gardez l'un ou
  // l'autre » (runtime/feats.mjs).
  "savage-attacker": { savageAttacker: true },
  // Chanceux : « quand vous lancez un d20 pour un Test d20, 1 point de chance pour l'Avantage » — proposé après le jet (attaque ratée,
  // sauvegarde ratée demandée par le moteur, test de caractéristique) : le d20 relancé, le meilleur gardé. « Quand une créature lance un
  // d20 pour une attaque contre vous, 1 point pour lui imposer le Désavantage » — avant son jet, sans coûter la Réaction (`free`).
  "lucky": {
    rollBonus: { activity: "DEX2YgxfqdMse2bT", on: ["attack", "save", "check"], luck: true },
    triggers: [{ on: "isAttacked", free: true, do: [{ type: "use", activity: "jBTnM51FdGwjlBuK", target: "source" }, { type: "disadvantage" }] }]
  },
  // Vigilant : l'échange d'initiative avec un allié, juste après le jet (runtime/roll-bonus.mjs).
  "alert": { initiativeSwap: true },
  // Guérisseur : « quand vous lancez un dé pour les PV que rend un sort… vous pouvez relancer un 1 » (runtime/feats.mjs).
  "healer": { healingRerolls: true }
});
