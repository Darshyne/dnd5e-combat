/**
 * §393 : le montage commun des arènes de test (une scène plate, vide, éclairée ; des acteurs d'essai dans un dossier à eux ; leurs
 * tokens à des cases fixes), tiré de `tools/arene-sorts.mjs` pour servir aussi à `tools/arene-invocations.mjs`. Idempotent : un acteur
 * se retrouve par son nom dans son dossier, la scène par son nom ; rien hors du dossier n'est touché.
 *
 *   spec : { stage (tools/lib/stages.mjs), folder, flag (flags.dnd5e-combat.arena), actors: { nom: { pack, base, keepItems,
 *            disposition, system, statuses } } }
 * `statuses` : les états posés sur le token après la pose (« dead » : un cadavre que darsh-loot reconnaît).
 */
import { connect } from "./connector.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";

const mergeCopy = (a, b) => merge(structuredClone(a), b);
const merge = (a, b) => {
  for ( const [k, v] of Object.entries(b) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) ) a[k] = merge(a[k] && (typeof a[k] === "object") ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};

export async function buildArena({ stage, folder: FOLDER, flag, actors: ACTORS }) {
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
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === stage.name);
  const { cols, rows, grid } = stage;
  const sceneData = {
    backgroundColor: "#5a5a5a", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: flag } }
  };
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: stage.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${stage.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // Un seul niveau, sans plafond (le niveau créé par défaut plafonne à 20 ft : §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(stage.tokens) ) {
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
  // Les états de référence (un cadavre : « dead »), posés sur l'acteur lié — idempotent.
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    for ( const statusId of spec.statuses ?? [] ) {
      await mcp.call("set-status", { actorId: ids[name], statusId, active: true }).catch(err => console.log(`état ${statusId} de « ${name} » : ${err.message}`));
    }
  }
  console.log(`arène prête : ${stage.name} (${scene.id})`);
  return { sceneId: scene.id, actorIds: ids };
}
finally { await mcp.close?.(); }
}
