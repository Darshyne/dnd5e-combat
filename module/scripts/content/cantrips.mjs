/**
 * Les tours de magie du Manuel des joueurs 2024 (SPEC §23), par identifiant dnd5e (les mêmes dans `spells24` du système et dans
 * le module premium). Ids d'activités et d'effets relevés dans le pack `spells` du module premium 2.2.0.
 *
 * Déjà complets ailleurs (§16) : Voile défensif, Lumières dansantes, Décharge occulte, Assistance, Lumière, Flammes, Résistance,
 * Gourdin magique, Épargner les mourants, Trait étoilé, Fouet épineux, Moquerie cruelle. Réglés par les données de dnd5e (le
 * moteur ne fait que résoudre) : Aspersion d'acide, Trait de feu, Aspersion de poison, Flamme sacrée (le moteur n'ajoute jamais
 * l'abri aux sauvegardes), Explosion occulte (d8 qui explosent, type au choix), Coup de tonnerre et Mot de radiance (émanations
 * qui épargnent le lanceur ; Mot de radiance, « de votre choix » : les ennemis). Sans effet en combat : Druidisme,
 * Élémentalisme, Réparation, Message, Prestidigitation, Thaumaturgie.
 *
 * `effectEnds` : l'effet tombe au début ou à la fin d'un tour précis — dnd5e leur donne « 1 round » ou « 1 tour », qu'il fait
 * expirer au début d'un tour quelconque ; le moteur les retire à leur heure (runtime/cantrips.mjs).
 */

export const CANTRIPS = Object.freeze({
  // Contact glacial : « elle ne peut pas regagner de points de vie jusqu'à la fin de votre prochain tour » — effet « Blocked Healing ».
  "chill-touch": { blocksHealing: true, effectEnds: { zwks0mAqBHGZC1Pk: "casterTurnEnd" } },
  // Rayon de givre : « sa Vitesse est réduite de 3 m jusqu'au début de votre prochain tour » — effet « Reduced Movement ».
  "ray-of-frost": { effectEnds: { "7dnnwBMWLykrVJub": "casterTurnStart" } },
  // Éclat mental : -1d4 à la prochaine sauvegarde de la cible, jusqu'à la fin du prochain tour du lanceur — l'effet
  // « Slivered » (-1d4 aux sauvegardes) tombe à la première sauvegarde, sinon à la fin du prochain tour du lanceur.
  "mind-sliver": { breaksOn: ["save"], effectEnds: { DMjD7IpAZuoVPCXY: "casterTurnEnd" } },
  // Poigne électrique : « elle ne peut pas faire d'attaque d'opportunité jusqu'au début de son prochain tour » — effet « Shocked ».
  "shocking-grasp": { noOpportunityAttacks: true, effectEnds: { DQCAm67ck1GEKHtE: "bearerTurnStart" } },
  // Moquerie cruelle (§16.12) : « … sa prochaine attaque avant la fin de votre prochain tour » — l'effet « Mocked ».
  "vicious-mockery": { effectEnds: { suEeAQQXl0X2JqzF: "casterTurnEnd" } },
  // Glas : 1d8 nécrotiques, ou 1d12 contre une cible déjà blessée — les deux activités de l'item ; la
  // bonne est jouée d'après la cible, quelle que soit celle choisie.
  "toll-the-dead": { byWounds: { healthy: "LFXYm5sLg6D3ZilN", wounded: "w9KUTNVoj3K8XSlv" } },
  // Amitié : sans effet sur une cible qui n'est pas Humanoïde ; des dégâts subis par la cible mettent fin au sort.
  // (L'Avantage quand on la combat, et la fin quand le lanceur attaque, blesse ou impose une sauvegarde : au MJ.)
  "friends": { targets: { types: ["humanoid"] }, triggers: [{ on: "isDamaged", via: "effect", do: [{ type: "remove" }] }] },
  // Main de mage, Illusion mineure : ni l'une ni l'autre n'agit au combat.
  "mage-hand": { summon: { initiative: "none" } },
  "minor-illusion": { summon: { initiative: "none" } },
  // Frappe assurée : « vous faites une attaque avec l'arme utilisée pour lancer le sort » — une arme à soi, enchantée (caractéristique
  // d'incantation, dégâts radiants au choix, dés radiants en plus) ; l'attaque est offerte aussitôt, sans coût, et l'enchantement
  // tombe après elle.
  "true-strike": { enchantTarget: "ownWeapon", oneAttack: true }
});
