/**
 * Le compendium « Outils du MJ » (pack `outils`, SPEC §56) : les macros de réparation et d'initialisation d'un monde, dans l'ordre
 * où les lancer. Les fichiers `.js` de ce dossier en sont la source ; `npm run packs` construit le compendium, `npm run dist`
 * l'archive pour la Forge. Toute macro de ce dossier doit figurer ici (`tests/macros.test.mjs`).
 */
export const MACROS = [
  { file: "nettoyage-midi.js", name: "1. Nettoyer les fiches de Midi-QOL, DAE et CPR",
    img: "icons/tools/laboratory/bowl-liquid-black.webp" },
  { file: "reparer-effets-phb.js", name: "2. Réparer les effets du Manuel des joueurs",
    img: "icons/magic/life/ankh-gold-blue.webp" },
  { file: "reparer-objets.js", name: "3. Réparer les objets (effets perdus)",
    img: "icons/tools/smithing/anvil.webp" },
  { file: "reprendre-parchemins.js", name: "4. Reprendre les parchemins de sort",
    img: "icons/sundries/scrolls/scroll-bound-blue-brown.webp" },
  { file: "nettoyage-tas-item-piles.js", name: "5. Retirer les actions de base des tas d'Item Piles",
    img: "icons/containers/bags/case-leather-tan.webp" },
  { file: "reparer-creatures.js", name: "6. Réparer les fiches de créatures (identifiants, actions de base CPR)",
    img: "icons/creatures/abilities/paw-print-pair-purple.webp" }
];
