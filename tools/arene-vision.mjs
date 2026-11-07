#!/usr/bin/env node
/**
 * Issue #42 : monte (ou remet en état) l'« Arène de la vision » d'un monde de test, par le connecteur — une scène plate en pleine
 * lumière pour juger la vision : des observateurs aux sens différents, possédés par `claude player` (pour voir la scène par ses yeux
 * dans le navigateur intégré), et des cibles dans, derrière et loin des Ténèbres que pose le scénario `vision-tenebres`.
 *
 *   node tools/arene-vision.mjs     crée ce qui manque, remet acteurs, items et tokens à leur état de référence
 *
 * Observateurs : Humain (Druide pré-tiré du Manuel, espèce Humain : aucune vision dans le noir), Occultiste du diable (Occultiste
 * pré-tiré, gnome : vision dans le noir 60 ft ; + l'invocation Vision du diable du Manuel et le sort Ténèbres, à volonté, pour le lancer
 * depuis la fiche), Rôdeur elfe (Rôdeur pré-tiré, elfe sylvestre : vision dans le noir 60 ft), Vision véritable (roturier, 120 ft),
 * Vision aveugle (roturier, 30 ft). Cibles : roturiers hostiles à 999 PV. Positions : `ARENE_VISION` (tools/lib/stages.mjs).
 *
 * Ce qu'on lit ensuite : `api.mcp.visionMatrix` (règles + écran par les yeux de chaque observateur, chez le MJ) et `api.mcp.screenHere`
 * (ce que montre le client courant, chez un joueur).
 */
import { buildArena } from "./lib/arena.mjs";
import { ARENE_VISION } from "./lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.actors.";
const DEVILS_SIGHT = "Compendium.dnd-players-handbook.classes.phbinvDevilsSigh";
const DARKNESS = { uuid: "Compendium.dnd-players-handbook.spells.phbsplDarkness00", system: { method: "atwill", prepared: 1 } };
const OWNERS = ["claude player"];
// La vue activée sur chaque observateur : sans elle, un token ne donne aucune source de vision (le MJ qui le contrôle verrait tout, un
// joueur ne verrait rien par lui) ; dnd5e y projette les sens de la fiche (`senseVisionSync`).
const SIGHT = { sight: { enabled: true } };
const sturdy = { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } };
const senses = ranges => ({ ...sturdy, attributes: { ...sturdy.attributes, senses: { ranges } } });

const ACTORS = {
  "Humain": { pack: PHB, base: "phbprgDruid00000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, system: { attributes: { hp: { value: 300, max: 300 } } } },
  "Occultiste du diable": { pack: PHB, base: "phbprgWarlock000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, items: [DEVILS_SIGHT, DARKNESS],
    // L'emplacement de pacte rendu à chaque remise : Maléfice (« une créature que vous voyez ») sert à juger le refus de cible.
    system: { attributes: { hp: { value: 300, max: 300 } }, spells: { pact: { value: 1 } } } },
  "Rôdeur elfe": { pack: PHB, base: "phbprgRanger0000", keepItems: true, disposition: 1, owners: OWNERS, token: SIGHT, system: { attributes: { hp: { value: 300, max: 300 } } } },
  "Vision véritable": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, token: SIGHT, system: senses({ truesight: 120 }) },
  "Vision aveugle": { base: "mmCommoner000000", disposition: 1, owners: OWNERS, token: SIGHT, system: senses({ blindsight: 30 }) },
  "Cible dans les ténèbres": { base: "mmCommoner000000", disposition: -1, system: sturdy },
  "Cible derrière les ténèbres": { base: "mmCommoner000000", disposition: -1, system: sturdy },
  "Cible au loin": { base: "mmCommoner000000", disposition: -1, system: sturdy }
};

await buildArena({ stage: ARENE_VISION, folder: "DAS · Arène de la vision", flag: "vision", actors: ACTORS });
