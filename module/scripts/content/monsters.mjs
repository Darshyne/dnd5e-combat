/**
 * K12 (SPEC §333) : défauts de la donnée du Monster Manual 2024 que le texte ne suffit pas à corriger, par identifiant dnd5e.
 * Ids d'effets relevés dans le pack `actors` du module premium.
 */
/** « Désavantage aux jets d'attaque et aux tests de caractéristique » : une source de Désavantage par caractéristique. */
const ATTACK_AND_CHECK_DISADVANTAGE = Object.freeze(["str", "dex", "con", "int", "wis", "cha"].flatMap(a => ["attack", "check"]
  .map(roll => ({ key: `system.abilities.${a}.${roll}.roll.mode`, value: -1, priority: null, type: "add" }))));

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
  // Faiblesse au soleil (Ombre, SRD 5.2) : « tant qu'elle est à la lumière du soleil, l'ombre a le Désavantage aux Tests de d20 » —
  // jets d'attaque, tests de caractéristique et jets de sauvegarde. La lecture du texte ne connaît que « … aux jets d'attaque ».
  "sunlight-weakness": { rollDisadvantage: { on: ["check", "save"], if: { "self.inSunlight": true } },
    triggers: [{ on: "preAttackRoll", if: { "source.inSunlight": true }, do: [{ type: "disadvantage" }] }] },
  // Perception de la magie (Chuul, SRD 5.2) : « le chuul perçoit la magie dans un rayon de 36 m ; ce trait fonctionne par ailleurs
  // comme le sort Détection de la magie, sans être lui-même magique » — permanent, sans effet à porter.
  "sense-magic": { sense: { kind: "locate", range: 120, units: "ft", reveals: "aura", detects: { "target.carriesMagic": true } } },
  // Résistance supérieure à la magie (Rakshasa, SRD 5.2) : « le rakshasa réussit automatiquement ses jets de sauvegarde contre
  // les sorts et autres effets magiques, et les jets d'attaque des sorts le ratent automatiquement ».
  "greater-magic-resistance": { saveAutoSuccessAgainst: ["magic"], spellAttacksMiss: true },
  // Gel (Élémentaire de l'eau, SRD 5.2) : « s'il subit des dégâts de froid, sa Vitesse diminue de 6 m jusqu'à la fin de son
  // prochain tour » — l'effet est dans la donnée, rien ne le posait.
  "freeze": { onDamageTaken: { types: ["cold"], effect: "B3otZdkyUcUlgrmk" } },
  // Aversion au feu (Golem de chair, SRD 5.2) : « s'il subit des dégâts de feu, il a le Désavantage aux jets d'attaque et aux tests
  // de caractéristique jusqu'à la fin de son prochain tour » — l'effet « Averse » de la donnée est vide.
  "aversion-to-fire": { onDamageTaken: { types: ["fire"], effect: "kJYNjmfI0RpvF7CQ" },
    dataFixes: [{ effect: "kJYNjmfI0RpvF7CQ", path: "system.changes", from: [], value: ATTACK_AND_CHECK_DISADVANTAGE }] },
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
  // Rayons oculaires (Tyrannœil, Tyran de la mort ; identifiant propre, content/sources.mjs) : chaque rayon par son effet ou son
  // activité. Charme et sommeil tombent aux dégâts ; paralysie rejouée en fin de tour ; pétrification : Entravé au premier échec,
  // Pétrifié au second (l'effet « Restrained » de la donnée porte Pétrifié, son double Pétrifié est écarté) ; ralentissement : ni
  // Réaction ni « action et action Bonus » (sa copie de vitesse écartée) ; énervation : pas de soins tant qu'Empoisonné ; durées
  // « jusqu'à la fin de son prochain tour » ; le rayon de sommeil épargne Artificiels et Morts-vivants.
  "mm-beholder-eye-rays": {
    triggers: [
      { on: "isDamaged", via: "effect", fromEffect: "OZBZrDI0m8zZSCxq", do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "uqejMIv7S1xZmEcD", do: [{ type: "resave" }] },
      { on: "isDamaged", via: "effect", fromEffect: "TlR4l9cSFcUEbsJW", do: [{ type: "remove" }] },
      { on: "endOfTurn", via: "effect", fromEffect: "K1dTJYj98PUwPBTZ", do: [{ type: "resave", tally: { successes: 1, failures: 1, status: "petrified" } }] }
    ],
    dropsEffects: ["l6MomayhxYuMYQR3", "DDygZ3FWo4nRabwO"],
    effectStatuses: { K1dTJYj98PUwPBTZ: { set: ["restrained"] } },
    noReactions: ["1zE4l88npB9r24MV"], actionOrBonus: ["1zE4l88npB9r24MV"], blocksHealing: ["XvZO30AwVhzcboC7"],
    effectEnds: { okGmSea9t9idzzrp: "bearerTurnEnd", XvZO30AwVhzcboC7: "bearerTurnEnd", "1zE4l88npB9r24MV": "bearerTurnEnd", "5tr2oDlFLN7khXBT": "casterTurnStart" },
    targets: { unaffectedIf: { "activity.id": "CSKrXM1Pkhlf23et", any: [{ "target.creatureType": "construct" }, { "target.creatureType": "undead" }] } }
  },
  // Lance de glace (Diable gelé) : ni action Bonus ni Réaction (lue dans le texte), Vitesse −10 ft jusqu'à la fin de son prochain tour ;
  // « se déplacer ou agir, pas les deux » reste au MJ.
  "ice-spear": { noBonus: "273sG6C6R7qUcL2v", effectChanges: { "273sG6C6R7qUcL2v": [{ key: "system.attributes.movement.walk", type: "add", value: "-10" }] } },
  // Réactions de monstres dont le déclencheur ne suffit pas (§334) — l'effet de la réponse avec les briques de Réaction.
  // Fuite toxique (Yochlol) : la moitié des dégâts du coup, puis la sauvegarde du nuage ; la téléportation reste au MJ.
  "toxic-escape": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "f6zHSW2bzTmUO9oR" }, { type: "halve" }] }] },
  // Prévoyance limitée (Cyclope sentinelle) : Désavantage au jet d'attaque contre lui.
  "limited-foresight": { triggers: [{ on: "isAttacked", do: [{ type: "use", activity: "oNKuSb8WamcMktfk" }, { type: "disadvantage" }] }] },
  // Ravenloft. Parer le coup (Laurie Weathermay) : les dégâts du coup réduits par le jet de l'activité.
  "deflect-blow": { triggers: [{ on: "isHit", do: [{ type: "use", activity: "qvWn7DuBd5mmvZ1M" }, { type: "reduce" }] }] },
  // Réactif (Marilith) : une Réaction à chaque tour du combat.
  "reactive": { reactions: { perRound: 20 } },
  // Têtes réactives (Hydre, SRD 5.2) : « pour chaque tête au-delà de la première, l'hydre dispose d'une Réaction supplémentaire,
  // qui ne sert qu'aux attaques d'opportunité » — cinq têtes : cinq Réactions par round (elle n'a pas d'autre Réaction). Le compte
  // suit les cinq têtes du bloc de statistiques ; les têtes mortes ou repoussées restent au MJ.
  "reactive-heads": { reactions: { perRound: 5 } },
  // Disparition : rien ici. Plusieurs monstres portent le même item (identifiant, ids) sans la même règle ; celle du Feu follet
  // tombe après un jet d'attaque — lu dans son texte (core/monster-text.mjs, `monsterBreaksOn`).
  // Ravenloft. Protection ésotérique (Gennifer) : Étourdi seulement pour un Mort-vivant.
  "esoteric-ward": { effectsIf: { "target.creatureType": "undead" } },
  // Déformation du corps (Émissaire stellaire inférieur) : Étourdi « jusqu'au début de son prochain tour » — celui de la cible.
  "warp-body": { effectEnds: { TWb6uCeWCkVjk9eZ: "bearerTurnStart" } },
  // Savoir interdit (Azalin Rex) : Étourdi « jusqu'à la fin du prochain tour d'Azalin ».
  "forbidden-knowledge": { effectEnds: { uOo6EccSwmKB7CUp: "casterTurnEnd" } },
  // Forme tourbillonnante (Porte-parole du gibet) : entre dans la case d'une créature et s'y arrête.
  "whirling-form": { sharesSpace: "enter" },
  // Chair qui se défait (Désossé) : se déplace ensuite sans provoquer d'attaque d'opportunité.
  "unraveling-flesh": { noOpportunity: "afterUse" },
  // §460, Ravenloft. Absorption d'énergie (Jiangshi) : sur un échec comme sur une réussite, il regagne autant de PV que les dégâts
  // nécrotiques subis par la cible (runtime/lifesteal.mjs). Le gain de Vitesse de vol et l'action Bonus offerte restent au MJ.
  "consume-energy": { lifesteal: { damageType: "necrotic" } }
});
