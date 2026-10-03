/**
 * Défenses de sorts (SPEC §16.46), textes du PHB 2024 (FR) :
 *  - Résistance : « quand la créature subit des dégâts du type retenu avant la fin du sort, elle réduit les dégâts subis de
 *    1d4 ; une même créature ne peut bénéficier qu'une fois par tour de ce sort » — 11 profils « Protection : … » sans aucun
 *    changement ; l'id de chacun dit son type (`_stats.duplicateSource` de l'effet appliqué).
 *  - Vigueur arcanique : le lanceur dépense un ou deux dés de vie et regagne leur total plus son modificateur d'incantation ;
 *    +1 dé par niveau d'emplacement au-delà du 2e — activité
 *    « Incanter » (`5paXkJ6hEw07yl8g`) ; les cinq activités de soin par taille de dé de dnd5e dépensent deux dés d'office.
 */

export const DAMAGE_SHIELDS = Object.freeze({
  "resistance": {
    formula: "1d4", oncePerTurn: true,
    effects: {
      u2mf5JowVgwqCARq: "acid", XYOXUUgKLjXXGt9W: "bludgeoning", Wpc5zvXyw2FSCJSD: "cold", S7XVvtgRT8uEP1iw: "fire",
      E8jlVJoTlfjKcz1r: "lightning", "2TZhhhCDUC2pqqNg": "necrotic", iR95ZjBkbXXD3Ena: "piercing", KZdzty5DTXdpGukZ: "poison",
      "9EhogBhAM9yIoREK": "radiant", sBrdZmXfn33LhYwh: "slashing", jP1TZyrEYtskdWXf: "thunder"
    }
  }
});

export const HIT_DICE_HEALS = Object.freeze({ "arcane-vigor": { activity: "5paXkJ6hEw07yl8g", base: 2 } });
