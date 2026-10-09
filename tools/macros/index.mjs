/**
 * Le compendium « Outils du MJ » (pack `outils`, SPEC §56) : les macros de réparation et d'initialisation d'un monde, dans l'ordre
 * où les lancer. Les fichiers `.js` de ce dossier en sont la source ; `npm run packs` construit le compendium, `npm run dist`
 * l'archive pour la Forge. Toute macro de ce dossier doit figurer ici (`tests/macros.test.mjs`).
 */
export const MACROS = [
  { file: "nettoyage-midi.js", name: "1. Clean Midi-QOL, DAE and CPR from sheets",
    img: "icons/tools/laboratory/bowl-liquid-black.webp" },
  { file: "reparer-effets-phb.js", name: "2. Repair Player's Handbook effects",
    img: "icons/magic/life/ankh-gold-blue.webp" },
  { file: "reparer-objets.js", name: "3. Repair items (lost effects)",
    img: "icons/tools/smithing/anvil.webp" },
  { file: "reprendre-parchemins.js", name: "4. Update spell scrolls",
    img: "icons/sundries/scrolls/scroll-bound-blue-brown.webp" },
  { file: "nettoyage-tas-item-piles.js", name: "5. Remove basic actions from Item Piles piles",
    img: "icons/containers/bags/case-leather-tan.webp" },
  { file: "reparer-creatures.js", name: "6. Repair creature sheets (identifiers, CPR basic actions)",
    img: "icons/creatures/abilities/paw-print-pair-purple.webp" }
];
