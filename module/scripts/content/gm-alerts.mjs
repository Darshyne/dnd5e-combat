/**
 * §365 : alertes MJ — ce que l'automatisation d'une capacité laisse au MJ, signalé à l'utilisation de l'item (bandeau en haut de son
 * écran, carte chuchotée : runtime/gm-alert.mjs). Identifiant → règle `gmAlert` (`key` : le texte `DND5ECOMBAT.AlerteMJ.<key>`,
 * `activities` : seulement à l'utilisation de ces activités). Les objets du relevé des objets ont la leur dans content/item-fixes.mjs.
 * Ne figure ici que ce qui passe par une utilisation (un sort lancé, une activité) : un trait passif n'a pas de moment où alerter.
 */

export const GM_ALERTS = Object.freeze({
  // Sorts.
  "earthquake": { key: "Seisme" },
  "delayed-blast-fireball": { key: "BouleRetardement" },
  "tsunami": { key: "Tsunami" },
  "forbiddance": { key: "Interdiction" },
  "divine-word": { key: "ParoleDivine" },
  "compulsion": { key: "Injonction" },
  "telekinesis": { key: "Telekinesie" },
  "wall-of-ice": { key: "MurSections" },
  "wall-of-stone": { key: "MurSections" },
  "antimagic-field": { key: "ChampAntimagie" },
  "antilife-shell": { key: "CoquilleAntivie" },
  "levitate": { key: "Levitation" },
  "prismatic-spray": { key: "EmbrunsPrismatiques" },
  "geas": { key: "Quete" },
  "protection-from-evil-and-good": { key: "ProtectionMalBien" },
  "greater-restoration": { key: "RestaurationSup" },
  "abjure-foes": { key: "AbjurationEnnemis" },
  "conjure-elemental": { key: "InvocationElementaire" },
  // Classes, dons, objets courants.
  "boon-of-fate": { key: "Destin" },
  "maneuvering-attack": { key: "AttaqueManoeuvrante" },
  "steps-of-the-fey": { key: "FouleeFees" },
  "potion-of-vitality": { key: "PotionVitalite" },
  "lantern-of-revealing": { key: "LanterneRevelation" },
  // Monstres.
  "gibbering": { key: "Babil" },
  "toxic-escape": { key: "FuiteToxique" },
  "ice-spear": { key: "LanceGlace" },
  // Ravenloft.
  "living-shadow": { key: "OmbreVivante" },
  "symbiotic-being": { key: "Symbiote" },
  "mist-walker": { key: "MarcheBrumes" },
  "feral-pounce": { key: "BondFeroce" },
  "ghost-walk": { key: "MarcheFantome" },
  "wrath-of-the-wild": { key: "CourrouxSauvage" }
});
