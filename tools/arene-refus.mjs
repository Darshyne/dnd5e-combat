#!/usr/bin/env node
/**
 * Issue #44 (§408) : monte (ou remet en état) l'« Arène des refus » d'un monde de test, par le connecteur — la scène du scénario
 * `regle-forcee` et des essais à la main des refus du contrôle de légalité (fenêtre, « Utiliser quand même », alerte au MJ). Les
 * pré-tirés niveau 1 du Manuel des joueurs, leurs objets gardés, en personnages joueurs dont `claude player` est propriétaire (le
 * côté joueur se vérifie au navigateur intégré) : Mage (Magicien), Clerc (masse et bouclier en main), Guerrier (épée à deux mains).
 * Un Mannequin hostile qui ne meurt pas (999 PV, CA 15) au contact du Mage ; une Cible lointaine à 155 ft.
 *
 *   node tools/arene-refus.mjs         crée ce qui manque, remet acteurs et tokens à leur état de référence
 *
 * Idempotent : un acteur ou la scène se retrouve par son nom ; rien hors de son dossier n'est touché.
 */
import { connect } from "./lib/connector.mjs";
import { ARENE_REFUS } from "./lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";
const PHB = "Compendium.dnd-players-handbook.actors.";
const FOLDER = "DAS · Arène des refus";
/** Le joueur de test de `dnd-6` : propriétaire des personnages, pour vérifier la fenêtre de son côté. */
const PLAYER = "claude player";

const HP = { attributes: { hp: { value: 300, max: 300 } } };
const ACTORS = {
  "Mage des refus": { pack: PHB, base: "phbprgWizard0000", keepItems: true, disposition: 1, player: true, system: HP },
  "Clerc des refus": { pack: PHB, base: "phbprgCleric0000", keepItems: true, disposition: 1, player: true, system: HP },
  "Guerrier des refus": { pack: PHB, base: "phbprgFighter000", keepItems: true, disposition: 1, player: true, system: HP },
  "Mannequin des refus": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" } } } },
  "Cible lointaine des refus": { base: "mmCommoner000000", disposition: -1, system: { attributes: { hp: { value: 999, max: 999 }, ac: { flat: 15, calc: "flat" } } } }
};

const merge = (a, b) => {
  for ( const [k, v] of Object.entries(b) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) ) a[k] = merge(a[k] && (typeof a[k] === "object") ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};

const mcp = await connect();
try {
  const players = await mcp.call("list-players", {});
  const playerId = (Array.isArray(players) ? players : []).find(u => u.name === PLAYER)?.id ?? null;
  if ( !playerId ) console.log(`joueur « ${PLAYER} » absent : personnages au MJ seulement`);
  const folder = await mcp.call("create-folder", { name: FOLDER, type: "Actor" });
  const folderId = folder.id ?? folder.folderId ?? folder.folder?.id;
  const listed = await mcp.call("list-actors", {});
  const existing = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) ?? [];
  const ids = {};
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    const { data } = await mcp.call("get-compendium-entry", { uuid: (spec.pack ?? MM) + spec.base });
    const { _id, folder: f, ownership: _owners, _stats, items, effects, ...rest } = data;
    const ownership = (spec.player && playerId) ? { default: 0, [playerId]: 3 } : { default: 0 };
    const actorData = merge(rest, { name, ownership, system: spec.system, prototypeToken: { name, actorLink: true, disposition: spec.disposition,
      displayName: 30, appendNumber: false, prependAdjective: false } });
    const baseItems = items ?? [];
    actorData.items = spec.keepItems ? baseItems : [];
    actorData.effects = [];
    const found = existing.find(a => (a.name === name) && (a.folderId === folderId));
    if ( found ) {
      // Remis à l'état de référence : PV, aucun item ni effet laissé par un scénario interrompu.
      const actor = await mcp.call("get-actor", { actorId: found.id });
      const own = new Set(baseItems.map(i => `${i.type}|${i.name}`));
      for ( const i of actor.items ?? [] ) {
        if ( spec.keepItems && own.has(`${i.type}|${i.name}`) ) continue;
        await mcp.call("remove-embedded-item", { documentType: "Actor", id: found.id, itemId: i._id ?? i.id });
      }
      for ( const e of actor.effects ?? [] ) await mcp.call("remove-embedded-effect", { documentType: "Actor", id: found.id, effectId: e._id ?? e.id });
      // L'espèce d'un personnage, désignée par id (`details.race`) : réalignée sur l'item d'espèce de la fiche.
      const race = spec.keepItems ? (actor.items ?? []).find(i => i.type === "race") : null;
      const system = race ? merge(structuredClone(spec.system), { details: { race: race._id ?? race.id } }) : structuredClone(spec.system);
      // Emplacements de sort du pré-tiré remis (un scénario peut les avoir vidés).
      if ( rest.system?.spells ) system.spells = rest.system.spells;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, ownership, prototypeToken: actorData.prototypeToken } });
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  // `create-actor` / `update-actor` du connecteur ne posent pas `ownership` : le joueur de test en devient propriétaire par un script.
  if ( playerId ) {
    const names = Object.entries(ACTORS).filter(([, spec]) => spec.player).map(([name]) => name);
    await mcp.call("run-script", { code: `for ( const id of ${JSON.stringify(names.map(n => ids[n]))} ) await game.actors.get(id)?.update({ ownership: { ${JSON.stringify(playerId)}: 3 } }); return true;` })
      .catch(err => console.log(`propriété du joueur : ${err.message} (réglage « Outils de test » requis)`));
  }

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === ARENE_REFUS.name);
  const { cols, rows, grid } = ARENE_REFUS;
  const sceneData = {
    backgroundColor: "#3c4a44", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: "refus" } }
  };
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: ARENE_REFUS.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${ARENE_REFUS.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // Un seul niveau, sans plafond (le niveau créé par défaut plafonne à 20 ft : §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(ARENE_REFUS.tokens) ) {
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
  console.log(`arène prête : ${ARENE_REFUS.name} (${scene.id})`);
}
finally { await mcp.close?.(); }
