/**
 * K12 (SPEC §333) : défauts de la donnée du Monster Manual 2024 que le texte ne suffit pas à corriger, par identifiant dnd5e.
 * Ids d'effets relevés dans le pack `actors` du module premium.
 */
export const MONSTERS = Object.freeze({
  // Miasme nocif (dragons verts) : l'effet vise `system.armor.value`, sans effet sur une créature ; −2 à la CA.
  "noxious-miasma": { effectChanges: { TSWsGeApnMgxOyIF: [{ key: "system.attributes.ac.bonus", type: "add", value: "-2" }] } },
  // Frappe draconique (Dracomancien githyanki) : l'effet de la donnée pose À terre ; le texte dit Effrayé (lu dans le texte, §334).
  "draconic-strike": { dropsEffects: ["3EaKpE9izXLyKuZ0"] },
  // §334, restes de K1 à K9.
  // Dévorer l'intellect, Vol de poussière funéraire : l'état dure « jusqu'à la fin du prochain tour » de la créature.
  "devour-intellect": { effectEnds: { ZaYIN5Q0TftqUIDM: "casterTurnEnd" } },
  "grave-dust-flight": { effectEnds: { j48yvRFstRgyvy4r: "casterTurnEnd" } },
  // Souffle affaiblissant (dragons d'or) : Désavantage aux tests de Force et −3 aux dégâts (la donnée : −1d4 aux tests de Force).
  "weakening-breath": { effectChanges: { wpkp78XzdLs9q2C3: [
    { key: "system.abilities.str.bonuses.check", type: "add", value: "0", replace: true },
    { key: "system.abilities.str.check.roll.mode", type: "add", value: "-1" },
    { key: "system.abilities.str.save.roll.mode", type: "add", value: "-1" },
    ...["mwak", "rwak", "msak", "rsak"].map(k => ({ key: `system.bonuses.${k}.damage`, type: "add", value: "-3" }))
  ] } },
  // Absorption de vie (Feu follet) : seulement une créature à 0 PV.
  "consume-life": { targets: { unaffectedIf: { "target.atZero": false } } },
  // Identifiants propres (content/sources.mjs, clé « acteur.item ») : « sting » et « bite » sont partagés.
  // Dard (Pseudodragon) : Inconscient tant qu'Empoisonné (l'effet cité par l'activité n'existe pas), réveillé par des dégâts.
  "mm-pseudodragon-sting": { effectStatuses: { q8stMoNP0ENULsOn: ["unconscious"] },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "q8stMoNP0ENULsOn", do: [{ type: "remove" }] }] },
  // Morsure (Homoncule) : Empoisonné jusqu'à la fin de son prochain tour ; raté de 5 ou plus, Inconscient, réveillé par des dégâts.
  "mm-homunculus-bite": { effectEnds: { V1AmhFqcodun54W7: "casterTurnEnd" }, failMargins: { "1xPlmvipGrfrNiPY": { min: 5 } },
    triggers: [{ on: "isDamaged", via: "effect", fromEffect: "1xPlmvipGrfrNiPY", do: [{ type: "remove" }] }] },
  // Défense (Sanglier-garou) : la malédiction ne vise qu'un Humanoïde.
  "mm-wereboar-gore": { effectsIf: { "target.creatureType": "humanoid" } },
  // Ravenloft. Brochette psychique (Ancien) : Épuisement et Étourdi seulement pour une cible Charmée.
  "psychic-skewer": { effectsIf: { "target.hasStatus": "charmed" } },
  // Voile d'ombre (Saidra) : Invisible jusqu'au début de son prochain tour, tombe dès qu'elle inflige des dégâts.
  "shadow-veil": { breaksOn: ["damage"], effectEnds: { "3FJI2gtOiaXvSxrs": "bearerTurnStart" } },
  // Aiguille d'argent (Carrionette) : la malédiction ne vise qu'un Humanoïde.
  "silver-needle": { effectsIf: { "target.creatureType": "humanoid" } },
  // Esquive (Bête éclipsante) : rien sur une réussite, la moitié sur un échec, pour toute sauvegarde à moitié des dégâts.
  "avoidance": { avoidance: true },
  // Absorption de vie (Nécrophage) : la donnée laisse les dégâts sans type ; nécrotiques.
  "mm-wight-life-drain": { untypedDamage: "necrotic" },
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
