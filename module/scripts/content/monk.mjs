/**
 * Le Moine du Manuel des joueurs 2024 (SPEC §24), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbmnk…`).
 * Vocabulaire du PHB-fr (voir `translations/classes` du PHB-fr).
 *
 * Ce que dnd5e fait déjà seul : Défense sans armure, Déplacement sans armure, le dé d'arts martiaux et la Dextérité des frappes à
 * mains nues (item « Unarmed Strike » du moine, activités d'enchantement des armes de moine), Esquive totale (§20), Attaque
 * supplémentaire (budget). Le moteur ajoute ce qui suit (runtime/monk.mjs, runtime/turn.mjs).
 */

export const MONK = Object.freeze({
  // §123 : « touchez une créature » — Main guérisseuse (Guerrier de la miséricorde), Toucher du médecin (sa Main guérisseuse),
  // Ultime miséricorde (« touchez le cadavre ») : « personnelles » dans les données du Manuel des joueurs, au contact en vrai.
  "hand-of-healing": { ranges: { iDDZmeoYTIdWukLQ: { value: 5, units: "ft" } } },
  "physicians-touch": { ranges: { stWL2fvcxsh0HFw2: { value: 5, units: "ft" } } },
  "hand-of-ultimate-mercy": { ranges: { XtgmW9115BzcLiFr: { value: 5, units: "ft" } } },
  // Arts martiaux : « vous pouvez faire une frappe à mains nues par une action Bonus ».
  "martial-arts": { martialArts: true },
  // Concentration du moine : Déluge de coups (2ghJTBhilLrFn9xT) — « 1 point : deux frappes à mains nues par une action Bonus » ;
  // Défense patiente — gratuite : Se désengager (EFzidO6yAapw8d60) ; 1 point : Se désengager et Esquiver (7xj7b6e8tDznDSrE) ;
  // Pas du vent — 1 point : Se désengager et Foncer (0MuRZ0Ur95xQTKFq ; la version gratuite, Foncer seul, n'a pas d'activité).
  "monks-focus": {
    flurry: { activity: "2ghJTBhilLrFn9xT", strikes: 2 },
    basicActions: { EFzidO6yAapw8d60: "disengage", "7xj7b6e8tDznDSrE": ["disengage", "dodge"], "0MuRZ0Ur95xQTKFq": ["dash", "disengage"] }
  },
  // Frappe étourdissante (niveau 5) : au plus une fois par tour, sur un coup d'arme de moine ou à mains nues, 1 point impose un JS
  // de Constitution ; la cible qui le rate est Étourdie jusqu'au début du prochain tour du moine, celle qui le réussit voit sa
  // Vitesse réduite de moitié et la prochaine attaque contre elle gagne l'Avantage, sur la même durée. Effets de l'item : Stunned (échec), Slowed (réussite).
  "stunning-strike": {
    stunningStrike: { activity: "Xto99a8Zt46VLwaR", focus: "monks-focus" },
    savedEffects: ["cj9HhBNKtF6iOsH4"],
    effectEnds: { vofnieSTB0l8rpRg: "casterTurnStart", cj9HhBNKtF6iOsH4: "casterTurnStart" },
    triggers: [{ on: "preAttackRoll", via: "effect", fromEffect: "cj9HhBNKtF6iOsH4", if: { "target.hasEffect": "stunning-strike" },
      do: [{ type: "advantage" }, { type: "consume", side: "target" }] }]
  },
  // Technique de la main ouverte (Main ouverte 3) : « chaque fois que vous touchez une créature d'une attaque du Déluge de coups » —
  // Déstabiliser (pas d'attaque d'opportunité jusqu'au début de son prochain tour), Repousser (JS de Force ou 4,50 m), Renverser
  // (JS de Dextérité ou À terre).
  "open-hand-technique": {
    openHand: { addle: "1jdSaWanuRrdkVs3", push: "XoaS0RtDCGAqrQsf", topple: "5Qgc0K3TfuonkPIG" },
    noOpportunityAttacks: true,
    effectEnds: { uQ474o5Wsv3sEAJK: "bearerTurnStart" },
    triggers: [{ on: "failedSave", if: { "activity.id": "XoaS0RtDCGAqrQsf" }, do: [{ type: "move", mode: "push", distance: 15, units: "ft" }] }]
  },
  // Parade (Deflect Attacks, niveau 3) : « quand un jet d'attaque vous touche et que ses dégâts comptent des dégâts contondants,
  // perforants ou tranchants, votre Réaction réduit les dégâts totaux de 1d10 + Dextérité + niveau de Moine » — l'activité « Reduce »
  // (un soin dans les données) donne le montant, qui est retiré des dégâts de l'attaque au lieu de soigner.
  "deflect-attacks": { triggers: [{ on: "isHit", if: { "activity.dealsType": ["bludgeoning", "piercing", "slashing"] },
    do: [{ type: "use", activity: "rQwRKkuZ7WhnB7v7" }, { type: "reduce" }] }] }
});
