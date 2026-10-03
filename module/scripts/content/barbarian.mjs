/**
 * Le Barbare du Manuel des joueurs 2024 (SPEC §22), module premium `dnd-players-handbook` 2.2.0 (pack `classes`, items
 * `phbbrb…`). Vocabulaire du PHB-fr : Rage, Témérité, Bond instinctif, Rage implacable, Rage persistante, Frénésie (Voie du
 * Berserker), Fureur divine (Voie du Zélateur).
 *
 * Ce que dnd5e fait déjà seul : les effets de la Rage (résistances, bonus aux dégâts de mêlée, Avantage en Force), Défense sans
 * armure, Sens du danger, Déplacement rapide, Instinct sauvage, Rage aveugle, Savoir primitif ; Attaque supplémentaire est dans
 * le budget. Durée et fin de la Rage, Témérité : runtime/barbarian.mjs.
 */

/** Une part de dégâts bonus, une fois par tour, à son tour, sur un coup d'arme ou à mains nues. */
const onceOnOwnTurn = (condition, formula, damageType) => ({
  on: "preDamageRoll", oncePerTurn: true,
  if: { "activity.isAttack": true, "activity.isWeapon": true, "source.onOwnTurn": true, ...condition },
  do: [{ type: "damage", formula, damageType }]
});

export const BARBARIAN = Object.freeze({
  // Rage : l'effet de l'item (G5XZTi4zYTFiHVll), activé par « Expend Rage ». « Elle dure jusqu'à la fin de votre tour suivant » ;
  // on l'entretient en attaquant un ennemi, en imposant une sauvegarde à un ennemi ou par une action Bonus.
  "rage": { rage: { effect: "G5XZTi4zYTFiHVll" } },
  // Rage persistante (niveau 15) : « elle dure 10 minutes sans que vous ayez rien à faire pour l'entretenir ; elle prend fin plus
  // tôt si vous avez l'état Inconscient (pas seulement Neutralisé) ».
  "persistent-rage": { persistentRage: true },
  // Témérité (niveau 2) : choisie au premier jet d'attaque du tour ; jusqu'au début du tour suivant du barbare, ses attaques
  // fondées sur la Force ont l'Avantage, et celles qui le visent aussi.
  "reckless-attack": { reckless: true },
  // Bond instinctif (niveau 7) : « dans le cadre de l'action Bonus pour entrer en Rage, vous pouvez vous déplacer de la moitié de
  // votre Vitesse » — sans rien dire des attaques d'opportunité.
  "instinctive-pounce": { movesAfter: { item: "rage", disengage: false } },
  // Rage implacable (niveau 11) : « si vous tombez à 0 PV en Rage sans mourir sur le coup, un JS de Constitution DD 10 : réussi,
  // vos PV deviennent le double de votre niveau de Barbare ; le DD augmente de 5 à chaque utilisation » — la sauvegarde de l'item
  // (dnd5eactivity100, DD « 10 + utilisations × 5 »).
  "relentless-rage": { relentless: { activity: "dnd5eactivity100" } },
  // Frénésie (Berserker 3) : « si vous utilisez Témérité en Rage, le premier coup de votre tour avec une attaque de Force inflige
  // autant de d6 supplémentaires que votre bonus de dégâts de Rage, du type de l'arme ».
  "frenzy": { triggers: [onceOnOwnTurn({ all: [{ "source.hasEffect": "rage" }, { "source.hasEffect": "reckless-attack" }] },
    "(@scale.barbarian.rage-damage)d6", "weapon")] },
  // Fureur divine (Zélateur 3) : en Rage, une fois par tour du barbare, son premier coup d'arme ou à mains nues ajoute 1d6 + la
  // moitié de son niveau de Barbare, en nécrotique ou en radiant — radiants ici ; l'item peut le changer dans son flag `triggers`.
  "divine-fury": { triggers: [onceOnOwnTurn({ "source.hasEffect": "rage" }, "1d6 + floor(@classes.barbarian.levels / 2)", "radiant")] }
});
