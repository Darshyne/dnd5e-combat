#!/usr/bin/env node
/**
 * Monte (ou remet en état) l'« Arène des sorts » d'un monde de test, par le connecteur : une scène plate et vide, et des acteurs
 * d'essai faits pour le balayage des sorts et des aptitudes (`tools/scenarios/balayage-sorts.mjs`, `balayage-aptitudes.mjs`).
 * Pourquoi pas l'« Arène de test » (§83) : quinze tokens y entourent le Zombi, une zone en touche une demi-douzaine, et ce sont les
 * fiches de PJ, que prêter 391 sorts salirait. Ici, un **Lanceur** PNJ sans aucun item (lanceur de niveau 20, emplacements 9 à
 * chaque niveau, carac. d'incantation à 20 : les sorts prêtés sont les seuls qu'il porte), des cibles à 999 PV qui ne meurent pas,
 * et rien d'autre à portée d'une zone.
 *
 *   node tools/arene-sorts.mjs          crée ce qui manque, remet acteurs et tokens à leur état de référence
 *
 * Idempotent : un acteur ou la scène se retrouve par son nom ; rien hors de son dossier n'est touché. Positions en cases :
 * `ARENE_SORTS` (tools/lib/stages.mjs), que le lanceur de scénarios rétablit avant chaque scénario de cette scène.
 */
import { connect } from "./lib/connector.mjs";
import { ARENE_SORTS } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène des sorts";
const SLOTS = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`spell${i + 1}`, { value: 9, override: 9 }]));

/**
 * Les acteurs d'essai : base du Bestiaire, items retirés (rien d'autre que ce qu'un scénario prête), puis retouches. Le Héros, un
 * personnage (le Barbare pré-tiré du Manuel, `keepItems`) : ce qu'un PNJ n'a pas — classe et échelles (dégâts de Rage), Rage, armes,
 * budget de tour d'un PJ (Concentration fanatique, Athlète remarquable, Inspiration de combat, scénario `passifs-releve`).
 */
const ACTORS = {
  "Lanceur": { base: "mmArchmage000000", disposition: 1, system: {
    abilities: { int: { value: 20 }, wis: { value: 20 }, cha: { value: 20 }, con: { value: 14 } },
    attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" }, spellcasting: "int", spell: { level: 20 } },
    spells: SLOTS, details: { cr: 12 } } },
  "Héros": { pack: PHB, base: "phbprgBarbarian0", keepItems: true, disposition: 1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Allié": { base: "mmCommoner000000", disposition: 1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Ennemi au contact": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible voisine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Cible lointaine": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 12, calc: "flat" } } } },
  "Mort-vivant": { base: "mmZombie00000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Grande cible": { base: "mmOgre0000000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } },
  "Créature artificielle": { base: "mmAnimatedArmor0", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 } } } }
};

const mergeCopy = (a, b) => merge(structuredClone(a), b);
const merge = (a, b) => {
  for ( const [k, v] of Object.entries(b) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) ) a[k] = merge(a[k] && (typeof a[k] === "object") ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};

const mcp = await connect();
try {
  const folder = await mcp.call("create-folder", { name: FOLDER, type: "Actor" });
  const folderId = folder.id ?? folder.folderId ?? folder.folder?.id;
  const listed = await mcp.call("list-actors", {});
  const existing = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) ?? [];
  const ids = {};
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    const { data } = await mcp.call("get-compendium-entry", { uuid: (spec.pack ?? MM) + spec.base });
    const { _id, folder: f, ownership, _stats, items, effects, ...rest } = data;
    const actorData = merge(rest, { name, system: spec.system, prototypeToken: { name, actorLink: true, disposition: spec.disposition,
      displayName: 30, appendNumber: false, prependAdjective: false } });
    // Les ids d'items gardés : `details.race` d'un personnage désigne son espèce par id — sans elle, plus de Vitesse (prepareRace).
    const baseItems = items ?? [];
    actorData.items = spec.keepItems ? baseItems : [];
    actorData.effects = [];
    const found = existing.find(a => (a.name === name) && (a.folderId === folderId));
    if ( found ) {
      // Remis à l'état de référence : PV, emplacements, aucun item ni effet laissé par un balayage interrompu.
      const actor = await mcp.call("get-actor", { actorId: found.id });
      // Un acteur qui garde ses items ne perd que ceux qu'un balayage ou un scénario a prêtés (absents de sa base).
      const own = new Set(baseItems.map(i => `${i.type}|${i.name}`));
      for ( const i of actor.items ?? [] ) {
        if ( spec.keepItems && own.has(`${i.type}|${i.name}`) ) continue;
        await mcp.call("remove-embedded-item", { documentType: "Actor", id: found.id, itemId: i._id ?? i.id });
      }
      for ( const e of actor.effects ?? [] ) await mcp.call("remove-embedded-effect", { documentType: "Actor", id: found.id, effectId: e._id ?? e.id });
      // L'espèce d'un personnage, désignée par id (`details.race`) : réalignée sur l'item d'espèce de la fiche.
      const race = spec.keepItems ? (actor.items ?? []).find(i => i.type === "race") : null;
      const system = race ? mergeCopy(spec.system, { details: { race: race._id ?? race.id } }) : spec.system;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, prototypeToken: actorData.prototypeToken } });
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === ARENE_SORTS.name);
  const { cols, rows, grid } = ARENE_SORTS;
  const sceneData = {
    backgroundColor: "#5a5a5a", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: "sorts" } }
  };
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: ARENE_SORTS.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${ARENE_SORTS.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // Un seul niveau, sans plafond (le niveau créé par défaut plafonne à 20 ft : §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(ARENE_SORTS.tokens) ) {
    const x = cx * grid, y = cy * grid;
    const found = tokens.find(t => t.name === name);
    if ( found ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: found.id, data: { x, y, elevation: 0, ...(level?.id ? { level: level.id } : {}) } });
    else {
      const r = await mcp.call("place-token", { sceneId: scene.id, actorId: ids[name], x, y });
      const tokenId = r.id ?? r.tokenId ?? r.token?.id;
      if ( level?.id && tokenId ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: tokenId, data: { x, y, level: level.id } });
      console.log(`token « ${name} » posé`);
    }
  }
  console.log(`arène prête : ${ARENE_SORTS.name} (${scene.id})`);
}
finally { await mcp.close?.(); }
