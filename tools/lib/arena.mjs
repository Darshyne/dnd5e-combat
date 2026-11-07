/**
 * §393 : le montage commun des arènes de test (une scène plate, vide, éclairée ; des acteurs d'essai dans un dossier à eux ; leurs
 * tokens à des cases fixes), tiré de `tools/arene-sorts.mjs` pour servir aussi à `tools/arene-invocations.mjs`. Idempotent : un acteur
 * se retrouve par son nom dans son dossier, la scène par son nom ; rien hors du dossier n'est touché.
 *
 *   spec : { stage (tools/lib/stages.mjs), folder, flag (flags.dnd5e-combat.arena), actors: { nom: { pack, base, keepItems,
 *            disposition, system, statuses } } }
 * `statuses` : les états posés sur le token après la pose (« dead » : un cadavre que darsh-loot reconnaît).
 * `owners` : noms d'utilisateurs qui possèdent l'acteur (issue #42 : `claude player`, pour voir la scène par ses yeux).
 * `scene` (à côté de `actors`) : données ajoutées à la scène.
 * `token` : données du token posé et du prototype (issue #42 : `{ sight: { enabled: true } }`, pour qu'un roturier ait une vue).
 * `items` : uuids (ou { uuid, system }) d'items de compendium ajoutés à la fiche (issue #42 : la Vision du diable du Manuel des joueurs), gardés à la remise.
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

export async function buildArena({ stage, folder: FOLDER, flag, actors: ACTORS, scene: sceneExtra={} }) {
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
      displayName: 30, appendNumber: false, prependAdjective: false, ...(spec.token ?? {}) } });
    // Les ids d'items gardés : `details.race` d'un personnage désigne son espèce par id — sans elle, plus de Vitesse (prepareRace).
    const extra = [];
    for ( const entry of spec.items ?? [] ) {
      // Un uuid, ou { uuid, system } : le système remplacé en partie (un sort à volonté).
      const { uuid, system: patch } = (typeof entry === "string") ? { uuid: entry } : entry;
      const { data: item } = await mcp.call("get-compendium-entry", { uuid });
      const { _id: _i, folder: _f, ownership: _o, ...itemData } = item;
      if ( patch ) merge(itemData.system, patch);
      extra.push({ ...itemData, _stats: { ...(itemData._stats ?? {}), compendiumSource: uuid } });
    }
    const baseItems = [...(spec.keepItems ? (items ?? []) : []), ...extra];
    actorData.items = baseItems;
    actorData.effects = [];
    const found = existing.find(a => (a.name === name) && (a.folderId === folderId));
    if ( found ) {
      // Remis à l'état de référence : PV, emplacements, aucun item ni effet laissé par un balayage interrompu.
      const actor = await mcp.call("get-actor", { actorId: found.id });
      // Un acteur qui garde ses items ne perd que ceux qu'un balayage ou un scénario a prêtés (absents de sa base).
      const own = new Set(baseItems.map(i => `${i.type}|${i.name}`));
      for ( const i of actor.items ?? [] ) {
        if ( own.has(`${i.type}|${i.name}`) ) continue;
        await mcp.call("remove-embedded-item", { documentType: "Actor", id: found.id, itemId: i._id ?? i.id });
      }
      for ( const e of actor.effects ?? [] ) await mcp.call("remove-embedded-effect", { documentType: "Actor", id: found.id, effectId: e._id ?? e.id });
      // L'espèce d'un personnage, désignée par id (`details.race`) : réalignée sur l'item d'espèce de la fiche.
      const race = spec.keepItems ? (actor.items ?? []).find(i => i.type === "race") : null;
      const system = race ? mergeCopy(spec.system, { details: { race: race._id ?? race.id } }) : spec.system;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, prototypeToken: actorData.prototypeToken } });
      // Un item ajouté (`items`) qu'un essai aurait retiré revient.
      const present = new Set((actor.items ?? []).map(i => `${i.type}|${i.name}`));
      for ( const item of extra ) {
        if ( !present.has(`${item.type}|${item.name}`) ) await mcp.call("upsert-embedded-item", { documentType: "Actor", id: found.id, itemData: item });
      }
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  // Les propriétaires (`owners`) : le connecteur ignore `ownership` — la fonction de test du moteur s'en charge (« Outils de test »).
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    if ( !spec.owners?.length ) continue;
    await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setOwners", args: { actorId: ids[name], users: spec.owners } })
      .catch(err => console.log(`propriétaires de « ${name} » : ${err.message}`));
  }

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === stage.name);
  const { cols, rows, grid } = stage;
  const sceneData = {
    backgroundColor: "#5a5a5a", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: flag } }
  };
  // Issue #42 : ce qu'une arène ajoute à la scène (la plage d'obscurité de la lumière globale, pour qu'une région sombre le soit).
  merge(sceneData, sceneExtra);
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
    const extra = ACTORS[name]?.token ?? {};
    if ( found ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: found.id, data: { x, y, elevation: 0, ...(level?.id ? { level: level.id } : {}), ...extra } });
    else {
      const r = await mcp.call("place-token", { sceneId: scene.id, actorId: ids[name], x, y });
      const tokenId = r.id ?? r.tokenId ?? r.token?.id;
      if ( tokenId && (level?.id || Object.keys(extra).length) ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: tokenId, data: { x, y, ...(level?.id ? { level: level.id } : {}), ...extra } });
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
