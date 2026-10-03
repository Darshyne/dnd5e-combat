/**
 * Le Clerc du Manuel des joueurs 2024 (SPEC §27), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items `phbclc…`).
 * Déjà là : Renvoi des morts-vivants et Calcination (§16, content/targets.mjs, triggers.mjs), Invocation de duplicata (§16,
 * summons.mjs), Domaine de la Tombe (Ravenloft, §19.9).
 *
 * Ce que dnd5e fait déjà seul : Étincelle divine (soins ou sauvegarde), Radiance de l'aube (sauvegarde en émanation), Survivance
 * (soin — le plafond « la moitié de ses PV » reste au MJ), Voile de la nature… et les utilisations de Conduit divin.
 */

/** Impact divin : « une fois à chacun de vos tours, quand vous touchez une créature par un jet d'attaque avec une arme ». */
const divineStrike = (formula, improved) => ({ on: "preDamageRoll", oncePerTurn: true,
  if: { "activity.isWeapon": true, ...(improved ? { "source.hasFeature": "improved-blessed-strikes" } : { not: { "source.hasFeature": "improved-blessed-strikes" } }) },
  do: [{ type: "damage", formula, damageType: "radiant" }] });

/**
 * Incantation puissante, l'autre option d'Impacts bénis : « ajoutez votre modificateur de Sagesse aux dégâts de tout sort mineur de
 * Clerc ». La fiche ne dit pas quelle option a été retenue : Impact divin est déclaré par défaut ; pour un clerc qui a choisi
 * Incantation puissante, la surcouche du monde remplace les déclarations de l'item :
 *   game.modules.get("dnd5e-combat").api.content.set("blessed-strikes", { triggers: POTENT_SPELLCASTING })
 * (ou le flag `flags["dnd5e-combat"].triggers` de l'item de ce clerc seul).
 */
export const POTENT_SPELLCASTING = Object.freeze([{ on: "preDamageRoll", if: { "activity.cantripOf": "cleric" },
  do: [{ type: "damage", formula: "@abilities.wis.mod", damageType: "weapon" }] }]);

export const CLERIC = Object.freeze({
  // Éclat protecteur (Lumière 3) : en Réaction, le clerc donne le Désavantage au jet d'attaque d'une créature qu'il voit à 9 m ou
  // moins — contre lui ou un allié (§34 : fenêtre avant le jet). Les PV temporaires de l'Éclat
  // protecteur amélioré restent au joueur.
  "warding-flare": { triggers: [{ on: "enemyAttacks", if: { "source.nearSelf": { distance: 30, units: "ft" }, "self.seesSource": true },
    do: [{ type: "use", activity: "dnd5eactivity000" }, { type: "disadvantage" }] }] },
  // Impacts bénis (niveau 7), option Impact divin : 1d8 radiants (au choix nécrotiques ou radiants : radiants d'office) ;
  // 2d8 avec Impacts bénis améliorés (niveau 14).
  "blessed-strikes": { triggers: [divineStrike("1d8", false), divineStrike("2d8", true)] },
  // Guérison suprême (niveau 17) : « prenez la valeur maximale pour chaque dé » d'un sort ou d'une Conduit divin qui soigne.
  "supreme-healing": { supremeHealing: true },
  // Disciple de la Vie (Vie 3) : « 2 plus le niveau de l'emplacement » de plus ; Guérisseur béni (Vie 6) : autant pour le lanceur
  // quand le sort soigne une autre créature.
  "disciple-of-life": { discipleOfLife: true },
  "blessed-healer": { blessedHealer: true },
  // Prêtre de guerre (Guerre 3) : une attaque d'arme ou à mains nues de plus, au prix d'une action Bonus —
  // l'activité (action Bonus, une utilisation) ouvre une attaque gratuite, comme le Déluge de coups (§24).
  "war-priest": { flurry: { activity: "dnd5eactivity000", strikes: 1, weapons: true } },
  // Troc du filou (Duperie 6, `phbclcTricksters`) : quand l'action Bonus crée ou déplace l'illusion d'Invoquer la duplicité, le
  // clerc peut aussi prendre sa place par téléportation, l'illusion venant à la sienne (§38.2) — une entrée du menu
  // contextuel de l'illusion et du lanceur ; l'activité « Transpose » de l'item (action Bonus de suivi) n'est pas utilisée.
  "tricksters-transposition": { transpose: { summon: "invoke-duplicity" } }
});
