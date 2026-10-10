/**
 * Le Paladin du Manuel des joueurs 2024 (SPEC §25), et les sorts de châtiment. Items du module premium `dnd-players-handbook` 2.2.0
 * (packs `classes` : `phbpdn…`, `spells`). Aura de protection : déjà là (§16, content/auras.mjs).
 *
 * Ce que dnd5e fait déjà seul : Imposition des mains (soin, retrait du poison — sauf la portée, ci-dessous), Frappes radiantes (effet : +1d8 radiants aux
 * attaques d'arme de corps à corps), Arme sacrée (enchantement : Charisme à l'attaque, dégâts radiants au choix), Châtiment divin
 * gratuit une fois par repos long (l'utilisation de l'item de sort).
 *
 * `smite` (§25) : un sort de châtiment se lance « immédiatement après avoir touché une cible avec une arme de corps à corps ou une
 * frappe à mains nues », par une action Bonus. Le moteur le propose au jet de dégâts de ce coup : `damage` est l'activité de dégâts
 * du sort (ses dés, au niveau lancé, s'ajoutent au jet et sont doublés sur un critique), `fiends` celle qui vaut contre un Fiélon ou
 * un Mort-vivant (Châtiment divin), `save` la sauvegarde que la cible fait ensuite (À terre, Effrayé, Aveuglé…).
 */

/** « Vous et vos alliés dans votre Aura de protection » : même rayon que l'aura de protection (niveau 18 : 9 m). */
const auraImmunity = status => ({ includeSelf: true, affects: "ally", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft",
  changes: [{ key: "system.traits.ci.value", value: status, type: "add" }] });

/** Les activités d'Imposition des mains du Manuel des joueurs : Soin, Retrait du poison. */
const LAY_ON_HANDS = ["gXZh9aGHcywV9huC", "K6UeXQwTyDHWvis8"];

export const PALADIN = Object.freeze({
  // §123 : Imposition des mains — « touchez une créature (vous y compris) » ; les données du Manuel des joueurs disent « personnelle »,
  // et le moteur soignait toujours le paladin. Au contact : la visée s'ouvre, on clique la créature (soi compris).
  "lay-on-hands": { ranges: Object.fromEntries(LAY_ON_HANDS.map(id => [id, { value: 5, units: "ft" }])) },
  // Sorts de châtiment (PHB 2024) — Châtiment divin : 2d8 radiants (+1d8 par niveau), 3d8 contre un Fiélon ou un Mort-vivant.
  "divine-smite": { smite: { damage: "dnd5eactivity200", fiends: "dnd5eactivity000" } },
  // Châtiment de fournaise (1d6 feu ; §42.2 : la brûlure qui dure, effet « Seared », posée au coup — sa suite dans content/triggers.mjs),
  // Châtiment lumineux (2d6 radiants ; la marque « Shining » reste au MJ).
  "searing-smite": { smite: { damage: "M4KS57lcf4K6fUMU", effect: "A0tTvLeRetrC708K" } },
  "shining-smite": { smite: { damage: "dnd5eactivity000" } },
  // Châtiment tonitruant (2d6 tonnerre ; JS de Force ou À terre), Châtiment courroucé (1d6 nécrotiques ; JS de Sagesse ou Effrayé),
  // Châtiment étourdissant (4d6 psychiques ; JS de Sagesse),
  // Châtiment bannisseur (5d10 de force ; JS de Charisme ou banni).
  "thunderous-smite": { smite: { damage: "dnd5eactivity000", save: "dnd5eactivity100" } },
  "wrathful-smite": { smite: { damage: "7g4z2R5Xozd8TESe", save: "dnd5eactivity000" } },
  // Châtiment de cécité (3d8 radiants) : Aveuglé sans sauvegarde au coup — sa sauvegarde (dnd5eactivity100) est celle de fin de
  // tour, qui reste au MJ comme l'état.
  // §42.2 : l'aveuglement (« Blinded »), posé au coup ; la sauvegarde de fin de tour dans content/triggers.mjs.
  "blinding-smite": { smite: { damage: "dnd5eactivity000", effect: "5FPaEGhqJ5yPP2Ln" } },
  "staggering-smite": { smite: { damage: "AMwFB1wsbzWYakK4", save: "dnd5eactivity000" } },
  "banishing-smite": { smite: { damage: "CXmmXBTfen6D6LXY", save: "dnd5eactivity000" } },

  // Aura de courage (niveau 10) : immunité à Effrayé ; Aura de dévotion (Serment de dévotion 7) : immunité à Charmé.
  "aura-of-courage": { aura: auraImmunity("frightened") },
  "aura-of-devotion": { aura: auraImmunity("charmed") },
  // Vœu d'inimitié (Serment de vengeance 3) : le paladin attaque la créature visée avec l'Avantage — l'effet « Vow of Enmity »
  // qu'elle porte, venu du paladin.
  "vow-of-enmity": { triggers: [{ on: "preAttackRoll", via: "effect", if: { "target.hasEffectFrom": "vow-of-enmity" }, do: [{ type: "advantage" }] }] },
  // Abjuration des ennemis (niveau 9) : « Effrayé pendant 1 minute ou jusqu'à ce qu'elle subisse des dégâts ».
  "abjure-foes": { triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] },
  // §92 : Ange vengeur (Serment de vengeance 20), Aura terrifiante — tant que l'Ange vengeur est actif (son effet sur le paladin), un
  // ennemi qui commence son tour dans l'Aura de protection fait la sauvegarde de Sagesse d'« Aura terrifiante », Effrayé pendant 1 minute
  // « ou jusqu'à ce qu'il subisse des dégâts » ; « les jets d'attaque contre la créature Effrayée ont l'Avantage ». Le vol : l'effet de
  // la donnée.
  "avenging-angel": {
    emanation: { on: "turnStart", affects: "enemy", activity: "UV3wzKmXpqDjWDAy", radiusFormula: "@scale.paladin.aura", radius: 10, units: "ft", whileActive: true },
    triggers: [
      { on: "isDamaged", via: "effect", fromEffect: "ucmM8P37dhbuz8eK", do: [{ type: "remove" }] },
      { on: "preAttackRoll", via: "effect", fromEffect: "ucmM8P37dhbuz8eK", if: { "target.hasEffect": "avenging-angel" }, do: [{ type: "advantage" }] }
    ]
  }
});
