/**
 * Qui une action peut affecter (SPEC §16.8, clé `targets` de core/content.mjs), par identifiant dnd5e. Les données
 * d'activité de dnd5e ne disent que « créature » : le type exigé par le texte de la règle est déclaré ici.
 *   types         les types de créature permis : une cible d'un autre type n'est pas affectée (ni sauvegarde, ni
 *                 effet), et la légalité le dit avant l'utilisation
 *   unaffectedIf  une condition (faits de adapter/facts.mjs, la cible en `target`) qui la laisse hors d'atteinte
 * Les immunités aux états, elles, ne se déclarent pas : elles se lisent sur la fiche (`traits.ci`).
 *
 * Textes vérifiés dans packs/_source/spells24 de dnd5e 6.0.3.
 */

export const TARGETS = Object.freeze({
  // « Choisissez un Humanoïde… », « Un Humanoïde que vous voyez… », « Chaque Humanoïde dans une Sphère… »
  "hold-person": { types: ["humanoid"] },
  "charm-person": { types: ["humanoid"] },
  "dominate-person": { types: ["humanoid"] },
  "calm-emotions": { types: ["humanoid"] },
  // §19 : Couronne du dément — sans effet sur une créature qui n'est pas Humanoïde.
  "crown-of-madness": { types: ["humanoid"] },
  // Causer la peur (Xanathar's) : sans prise sur les Créatures artificielles et les Morts-vivants.
  "cause-fear": { unaffectedIf: { "target.creatureType": ["construct", "undead"] } },
  // « Une Bête que vous voyez… »
  "dominate-beast": { types: ["beast"] },
  // §65 : Eau bénite (PHB 2024, et la fiole 2014) — les dégâts radiants ne valent que contre un Fiélon ou un Mort-vivant.
  "holy-water": { types: ["fiend", "undead"] },
  "flask-of-holy-water": { types: ["fiend", "undead"] },
  "animal-friendship": { types: ["beast"] },
  // Sommeil 2024 : « les créatures qui ne dorment pas, comme les elfes, ou qui ont l'immunité à l'état Épuisement
  // réussissent automatiquement leurs sauvegardes contre ce sort ». L'immunité se lit ; « ne dort pas » (elfes) non.
  "sleep": { unaffectedIf: { "target.immuneTo": "exhaustion" } },
  // §16.47 : Stabilisation — « une créature à 0 point de vie et qui n'est pas morte ».
  "spare-the-dying": { unaffectedIf: { any: [{ "target.atZero": false }, { "target.isDead": true }] } },
  // Renvoi des morts-vivants (§16.25) : « chaque Mort-vivant de votre choix dans un rayon de 9 m ». Conduit divin du clerc
  // (PHB et dnd5e 6 : `channel-divinity` / `channel-divinity-cleric`) : la seule activité « Turn Undead » ; Étincelle divine
  // vise n'importe qui. Calcination des morts-vivants remplace le Renvoi (même sauvegarde, même effet, plus les dégâts).
  "channel-divinity": { unaffectedIf: { "activity.id": "aOptL5pMaj3WtR8S", not: { "target.creatureType": "undead" } } },
  "channel-divinity-cleric": { unaffectedIf: { "activity.id": "aOptL5pMaj3WtR8S", not: { "target.creatureType": "undead" } } },
  "sear-undead": { types: ["undead"] },
  // Prière de guérison 2024 (§16.38) : « une créature ne peut plus être affectée par ce sort avant d'avoir terminé un Repos
  // long » — l'effet « Guéris par prière » que le sort pose la marque (et tombe au repos long, EFFECT_EXPIRIES ci-dessous).
  "prayer-of-healing": { unaffectedIf: { "target.hasEffect": "prayer-of-healing" } }
});

/**
 * Limites d'utilisation (§16.40, `usageLimits`). Regain sauvage (druide 5, PHB 2024) : « une fois à chacun de vos tours, si vous
 * n'avez plus d'utilisation de Forme sauvage, vous pouvez vous en rendre une en dépensant un emplacement de sort » — activité
 * « Regain de Forme sauvage » (`7nAgPNN2dth7SR0D`). L'autre (« Regain d'emplacement de sort », une fois par repos long) est
 * tenue par les utilisations de l'item, dnd5e le contrôle.
 */
export const USAGE_LIMITS = Object.freeze({
  // `lowestSlot` : le PHB laisse choisir le niveau par un curseur « Valeur d'évolution » (scaling) — il ne change rien.
  // « Regain d'emplacement de sort » (`dnd5eactivity000`) : une Forme sauvage contre un emplacement de niveau 1, rien à choisir.
  "wild-resurgence": {
    "7nAgPNN2dth7SR0D": { oncePerTurn: true, whenEmpty: "wild-shape", lowestSlot: true },
    "dnd5eactivity000": { noDialog: true }
  },
  // Lame de feu (§16.41) : l'attaque de la lame invoquée n'a rien à choisir (ni emplacement, ni concentration) — pas de fenêtre.
  "flame-blade": { "dnd5eactivity000": { noDialog: true } },
  // Flammes (§16.42) : « Temps d'incantation : action Bonus » (PHB 2024 ; les données disent « action ») ; « projeter des flammes »
  // (action Magie) n'a rien à choisir.
  "produce-flame": { "MModRd17Oi6hhztj": { cost: "bonus" }, "tqKlIEdglRYdqHrp": { noDialog: true } },
  // Crosse des druides : « Temps d'incantation : action Bonus » (PHB 2024 ; les données disent « action »).
  "shillelagh": { "B4nxtIzrCEGEzq1T": { cost: "bonus" } }
});

/**
 * L'enchantement vise l'arme d'une créature choisie (§16.41, `enchantTarget`). Arme élémentaire (PHB 2024) : rend magique une
 * arme non magique touchée — activité « enchant » de dnd5e (15 profils : 5 éléments × +1/+2/+3 selon le
 * niveau), que dnd5e applique par un glisser-déposer de l'arme sur la carte.
 */
export const ENCHANT_TARGETS = Object.freeze({ "elemental-weapon": "weapon", "pact-of-the-blade": "ownWeapon" });

/**
 * Pacte de la lame (§16.45, `pact`). PHB 2024 : en action Bonus, l'occultiste fait apparaître en main une arme de corps à corps
 * (courante ou de guerre, au choix) ou se lie à une arme magique touchée ; il y emploie son Charisme à l'attaque et aux dégâts,
 * dont le type peut être nécrotique, psychique, radiant ou celui de l'arme ; une nouvelle invocation fait disparaître la
 * précédente. Activité « Forge Pact Weapon » (`8MSXmrGSgc6xHotB`).
 */
export const PACTS = Object.freeze({ "pact-of-the-blade": { damageTypes: ["necrotic", "psychic", "radiant"], ability: "spellcasting" } });

/** Les effets de l'item prennent fin à ce repos du porteur (§16.38, `effectsExpire`) : dnd5e ne le règle pas sur l'effet. */
export const EFFECT_EXPIRIES = Object.freeze({ "prayer-of-healing": "longRest" });
