#!/usr/bin/env node
/**
 * Scénarios d'intégration rejouables sans main humaine (SPEC §13, S5) : le moteur tourne dans
 * le client du MJ, piloté par le connecteur MCP (tools/lib/connector.mjs), et chaque scénario
 * vérifie la COHÉRENCE de ce qui s'est passé — pas des valeurs de dés : touché ⇔ jet ≥ CA, PV
 * retirés = dégâts appliqués, sauvegarde réussie ⇔ jet ≥ DD, zone retirée…
 *
 *   node tools/scenario.mjs                 tous les scénarios de tools/scenarios/
 *   node tools/scenario.mjs attaque zone    ceux-là seulement (nom de fichier sans extension)
 *   node tools/scenario.mjs <dossier|fichier.mjs>   des scénarios gardés ailleurs (le dépôt d'un autre module), mêlables aux noms
 *
 * Prérequis : serveur du connecteur lancé, monde de test ouvert chez le MJ (réglage « Outils de
 * test » activé), scène affichée avec les tokens que le scénario nomme, et **F5 du client du MJ
 * après tout changement du moteur** (c'est lui qui l'exécute). Un scénario remet en état ce qu'il
 * a touché (PV, zones, combat), même s'il échoue. Code de sortie 1 si une vérification manque.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connect } from "./lib/connector.mjs";
import { ARENA, RESTORED_KEEP } from "./lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const TERMINAL = new Set(["done", "missed", "undone"]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Une fonction de test courte du moteur (réponse dans les 8 s). */
async function callEngine(mcp, fn, args={}) {
  const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 8000 });
  if ( !r.settled ) throw new Error(`${fn} : pas de réponse en 8 s`);
  return r.result;
}

/** Ce qu'un scénario reçoit. */
function makeContext(mcp) {
  const failures = [];
  const restorations = [];
  let scene = null;
  /** Heure des bornes rendues par `lastMessageId`, pour le cas où le message borne disparaît. */
  const stamps = new Map();

  const ctx = {
    call: (tool, args) => mcp.call(tool, args),
    log: (...args) => console.log("   ", ...args),

    /**
     * Une fonction de test du moteur (`api.mcp`, runtime/testing.mjs) par `call-module-api` (connecteur ≥ 0.28.0). Une
     * fonction longue (déplacement animé) rend la main au bout de 8 s ; on la reprend par son `callId` jusqu'au résultat.
     * Au-delà de `timeoutMs`, on ferme les dialogues ouverts entre-temps (un « Change Level » du cœur met le déplacement en
     * pause) et on lève.
     */
    async engine(fn, args={}, { timeoutMs=60000 }={}) {
      const before = new Set((await callEngine(mcp, "windows")).map(w => w.id));
      const until = Date.now() + timeoutMs;
      // Un changement de niveau de la vue du MJ (escalier pris, la vue suit le token) redessine tout le canevas
      // (documents/scene.mjs:273-281) : le temps du dessin, les fonctions de test répondent « aucune scène affichée » ou
      // « non dessiné ». On attend que le canevas revienne (15 s au plus) plutôt que d'interrompre le scénario (vu dans `escaliers`).
      let r;
      for ( const redrawn = Date.now() + 15000; !r; ) {
        try { r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 8000 }); }
        catch(err) {
          if ( !/aucune scène affichée|non dessiné/.test(err.message) || (Date.now() > redrawn) ) throw err;
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      while ( !r.settled ) {
        if ( Date.now() > until ) {
          const stuck = (await callEngine(mcp, "windows")).filter(w => !before.has(w.id));
          for ( const w of stuck ) await callEngine(mcp, "closeWindow", { id: w.id }).catch(() => {});
          // Le dialogue fermé, le déplacement reprend et se termine : on vide l'appel en attente.
          await mcp.call("call-module-api", { callId: r.callId, waitMs: 8000 }).catch(() => {});
          throw new Error(`${fn} : pas de réponse après ${timeoutMs} ms${stuck.length ? ` — fenêtre(s) fermée(s) : ${stuck.map(w => w.title ?? w.id).join(", ")}` : ""}`);
        }
        r = await mcp.call("call-module-api", { callId: r.callId, waitMs: 8000 });
      }
      return r.result;
    },

    /** Une vérification : consignée, jamais bloquante — on lit tout le scénario. */
    expect(condition, label) {
      console.log(`    ${condition ? "✓" : "✗"} ${label}`);
      if ( !condition ) failures.push(label);
      return !!condition;
    },
    get failures() { return failures; },

    /** À défaire en fin de scénario, quoi qu'il arrive (du dernier au premier). */
    restore(fn) { restorations.push(fn); },
    async undoAll() {
      for ( const fn of restorations.reverse() ) {
        try { await fn(); }
        catch(err) { console.log(`    ! remise en état : ${err.message}`); }
      }
    },

    /* ---- la scène et ses tokens ---- */

    async scene() {
      if ( !scene ) {
        const { sceneId, objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
        scene = { sceneId, tokens: objects.Token ?? [] };
      }
      return scene;
    },

    /**
     * Les tokens de la scène MAINTENANT — `scene()` garde la liste du début du scénario (vu le 2026-09-29 : des invocations créées
     * pendant un scénario n'étaient ni vues ni retirées par sa remise en état, et un « l'esprit est retiré » passait à tort).
     */
    async liveTokens() {
      const { objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
      return objects.Token ?? [];
    },

    /** Le premier token visible de ce nom sur la scène affichée. */
    async token(name) {
      const { tokens } = await ctx.scene();
      // Plusieurs tokens du même nom (dans `dnd-6`, un second Zombi à l'étage de Restored Keep, élévation 20 : pris en premier, il
      // faisait échouer `attaque`, `empoignade`, `injonction`… par abri total) : celui du niveau où sont la plupart des tokens, au sol.
      const levels = new Map();
      for ( const t of tokens ) levels.set(t.level ?? null, (levels.get(t.level ?? null) ?? 0) + 1);
      const main = [...levels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const rank = t => (t.hidden ? 4 : 0) + (((t.level ?? null) === main) ? 0 : 2) + ((t.elevation ?? 0) ? 1 : 0);
      const found = tokens.filter(t => t.name === name).sort((a, b) => rank(a) - rank(b))[0];
      if ( !found ) throw new Error(`token « ${name} » absent de la scène (présents : ${[...new Set(tokens.map(t => t.name))].join(", ")})`);
      return found;
    },

    /**
     * Pose la distribution d'un scénario (tools/lib/stages.mjs, SPEC §40.6) : chaque token nommé va à sa place, par
     * `move-token` (un déplacement « displace », sans murs ni budget), et retourne où il était à la fin — cette remise est
     * inscrite d'ici : appeler `stage` AVANT toute autre remise en état du scénario, elle passera donc en dernier (les remises
     * se jouent à rebours). Rend faux, sans rien bouger, sur une autre scène que celle de la distribution.
     * @param {{scene?: string, level?: string, tokens: Record<string, [number, number]>}} layout
     */
    async stage(layout) {
      const { sceneId } = await ctx.scene();
      if ( layout.scene && (sceneId !== layout.scene) ) return false;
      const moved = [];
      for ( const [name, [x, y]] of Object.entries(layout.tokens) ) {
        const t = await ctx.token(name).catch(() => null);
        if ( !t ) continue;
        const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
        const before = { x: data.x, y: data.y, elevation: data.elevation ?? 0, level: data.level ?? null };
        const changesLevel = !!layout.level && (before.level !== layout.level);
        if ( (before.x === x) && (before.y === y) && (before.elevation === 0) && !changesLevel ) continue;
        await mcp.call("move-token", { tokenId: t.id, x, y, elevation: 0, ...(changesLevel ? { levelId: layout.level } : {}) });
        await sleep(500);
        moved.push({ id: t.id, name, before, changesLevel });
      }
      if ( moved.length ) {
        console.log(`    ⇄ distribution posée : ${moved.map(m => m.name).join(", ")}`);
        restorations.push(async () => {
          for ( const m of moved ) {
            await mcp.call("move-token", { tokenId: m.id, x: m.before.x, y: m.before.y, elevation: m.before.elevation,
              ...((m.changesLevel && m.before.level) ? { levelId: m.before.level } : {}) }).catch(err => console.log(`    ! ${m.name} non remis : ${err.message}`));
            await sleep(400);
          }
        });
      }
      scene = null;   // la liste gardée portait les anciennes positions
      return true;
    },

    /** Les PV d'un token, lus sur le document (delta du token, ou acteur lié) — pas sur le moteur. */
    async hp(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const own = data.actorLink ? null : (data.delta?.system?.attributes?.hp?.value ?? null);
      if ( own !== null ) return own;
      // Acteur lié, ou token non lié dont le delta ne porte pas de PV : ceux de la fiche. Rendre `null` ici faisait réécrire
      // `null` au token à la remise en état — 0 PV, un Zombi « Mort » pour les scénarios suivants (§82).
      const actor = await mcp.call("get-actor", { actorId: data.actorId ?? token.actorId });
      return actor.system?.attributes?.hp?.value ?? actor.actor?.system?.attributes?.hp?.value ?? null;
    },

    async setHp(token, value) {
      if ( (value === null) || (value === undefined) ) throw new Error(`setHp(${token.name ?? token.id}) : PV inconnus, rien n'est écrit`);
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      if ( data.actorLink ) await mcp.call("update-actor", { actorId: token.actorId, actorData: { "system.attributes.hp.value": value } });
      else await mcp.call("update-scene-object", { type: "Token", objectId: token.id, data: { "delta.system.attributes.hp.value": value } });
    },

    /** Rectangle en pixels d'un token, pour poser une zone dessus. */
    async box(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const grid = data.parent?.grid?.size ?? null;
      const size = grid ?? (await ctx.gridSize());
      return { x: data.x, y: data.y, width: data.width * size, height: data.height * size };
    },

    /**
     * Retire d'un token les effets qui portent cet état (effet posé par une activité : Agrippé de la Lutte…).
     * `set-status … active: false` ne retire que l'état posé par la bascule, pas ces effets-là.
     */
    async removeStatusEffects(token, status) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const scene = (await ctx.scene()).sceneId;
      const linked = !!data.actorLink;
      const effects = linked ? ((await mcp.call("get-actor", { actorId: data.actorId })).effects ?? []) : (data.delta?.effects ?? []);
      const target = linked ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of effects.filter(e => (e.statuses ?? []).includes(status)) ) {
        await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});   // déjà expiré : rien à faire
      }
    },

    /** Retire d'un token les effets dont le nom correspond (effet posé par un sort, concentration). */
    async removeEffectsNamed(token, pattern) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const scene = (await ctx.scene()).sceneId;
      const linked = !!data.actorLink;
      const effects = linked ? ((await mcp.call("get-actor", { actorId: data.actorId })).effects ?? []) : (data.delta?.effects ?? []);
      const target = linked ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${token.id}.Actor.${data.actorId}` };
      for ( const e of effects.filter(e => pattern.test(e.name ?? "")) ) {
        await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});
      }
    },

    async gridSize() {
      const s = await mcp.call("get-scene", {});
      return s.grid?.size ?? s.scene?.grid?.size ?? 100;
    },

    /* ---- actions et résolutions ---- */

    /**
     * Utilise une activité, confirmée d'office pour le moteur (pas de dialogue de légalité).
     * L'item se désigne par `identifier` (identifiant dnd5e, `system.identifier`) ou par `itemId` — jamais
     * par son nom : les noms sont traduits à la volée par Babele (« Moonbeam » / « Rayon de lune »).
     */
    async use({ identifier, ...params }) {
      if ( identifier ) params.itemId = await ctx.itemId(params.tokenId, identifier);
      // Le drapeau du moteur se fusionne (confirmé d'office) ; sans autre consigne, aucune fenêtre de réaction ne
      // s'ouvre (`autoReact: "none"`) : un Mage hostile qui voit toute la salle contrerait chaque sort des scénarios.
      const ours = { confirmed: true, autoReact: "none", ...(params.usageConfig?.[MODULE_ID] ?? {}) };
      return mcp.call("use-activity", {
        configure: false,
        ...params,
        usageConfig: { ...(params.usageConfig ?? {}), [MODULE_ID]: ours }
      });
    },

    /**
     * S'assure qu'un token porte l'item d'un compendium (par son uuid), pour un scénario qui a besoin d'un sort
     * que la fiche n'a pas ; ajouté pour le scénario, retiré à la fin. Rend l'id de l'item sur la fiche.
     */
    async ensureItem(token, uuid, { system={} }={}) {
      const { data } = await mcp.call("get-compendium-entry", { uuid });
      Object.assign(data.system ??= {}, system);   // retouches (ex. { method: "atwill" } : un sort sans emplacement)
      const identifier = data.system?.identifier;
      const { data: tok } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      const items = (await mcp.call("get-actor", { actorId: tok.actorId })).items ?? [];
      const existing = items.find(i => i.system?.identifier === identifier);
      if ( existing ) return existing._id;
      const { _id, folder, ownership, _stats, ...itemData } = data;
      const r = await mcp.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const id = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(token.id, identifier));
      ctx.restore(() => mcp.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: id }).catch(() => {}));
      return id;
    },

    /** Position (coin haut-gauche, pixels) et élévation d'un token, lues sur le document. */
    async position(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      return { x: data.x, y: data.y, elevation: data.elevation ?? 0 };
    },

    /** Les effets actifs d'un token (acteur lié ou delta). */
    async effects(token) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: token.id });
      if ( data.actorLink ) return (await mcp.call("get-actor", { actorId: data.actorId })).effects ?? [];
      return data.delta?.effects ?? [];
    },

    /** L'id de l'item d'un token par son identifiant dnd5e, stable quelle que soit la langue. */
    async itemId(tokenId, identifier) {
      const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: tokenId });
      const items = (await mcp.call("get-actor", { actorId: data.actorId })).items ?? [];
      const found = items.find(i => i.system?.identifier === identifier);
      if ( !found ) throw new Error(`item « ${identifier} » absent de ${data.name} (identifiants : ${items.map(i => i.system?.identifier).filter(Boolean).join(", ")})`);
      return found._id;
    },

    /** La résolution portée par un message, telle que le moteur l'a écrite. */
    async resolution(messageId) {
      const { messages } = await mcp.call("list-chat-messages", { limit: 60, flagScope: MODULE_ID });
      const m = (messages ?? []).find(x => x.id === messageId);
      return m ? (m.flags?.[MODULE_ID]?.resolution ?? m.flags?.resolution ?? null) : null;
    },

    /** Attend qu'une résolution soit tranchée (done / missed / undone). */
    async settle(messageId, { timeoutMs=30000 }={}) {
      const until = Date.now() + timeoutMs;
      let last = null;
      while ( Date.now() < until ) {
        last = await ctx.resolution(messageId);
        if ( last && TERMINAL.has(last.step) ) return last;
        await sleep(500);
      }
      throw new Error(`résolution ${messageId} non tranchée après ${timeoutMs} ms (étape : ${last?.step ?? "aucune"})`);
    },

    /** Les messages créés depuis un message donné, flags du moteur compris. */
    async messagesSince(messageId) {
      // Journal vide au moment de la borne (`lastMessageId` → null) : tout ce qui existe est postérieur.
      try {
        const { messages } = await mcp.call("list-chat-messages", { limit: 100, ...(messageId ? { sinceId: messageId } : {}), flagScope: MODULE_ID });
        return messages ?? [];
      } catch(err) {
        // La borne a été supprimée entre-temps (carte retirée par le moteur, journal vidé) : on se rabat sur son heure.
        const since = stamps.get(messageId);
        if ( !/introuvable|not found/i.test(err.message) || (since === undefined) ) throw err;
        const { messages } = await mcp.call("list-chat-messages", { limit: 100, flagScope: MODULE_ID });
        return (messages ?? []).filter(m => (m.timestamp ?? 0) > since);
      }
    },

    /** Le dernier message du chat (pour borner « depuis »). */
    async lastMessageId() {
      const { messages } = await mcp.call("list-chat-messages", { limit: 1 });
      const last = messages?.at(-1) ?? null;
      if ( last ) stamps.set(last.id, last.timestamp ?? 0);
      return last?.id ?? null;
    },

    /** Erreurs de la console du MJ depuis le dernier appel (tampon vidé). Le journal du moteur est suivi (`watch`). */
    async clientErrors() {
      const r = await mcp.call("get-client-errors", { levels: ["error", "uncaught", "unhandledrejection"], watch: [MODULE_ID], clear: true, limit: 50 });
      // « id … does not exist in the EmbeddedCollection » : BLFX écrit sur un effet après son animation (Bouclier de feu :
      // `effect.setFlag(…, "blfxCustom")`, macros/spell/customSpells4.js:709 → utils/light.js:158), parfois après que le
      // scénario ou le moteur l'a retiré — la course déjà vue avec ses régions (SPEC §14.2). Pas le moteur (2026-09-25).
      // « "auraeffects.aura" is not a valid type » : monde `ravenloft`, items de PJ faits pour le module Aura Effects, absent
      // (Passage sans trace d'Alara, Voile spirituel de Kaalisti) ; relevé à chaque préparation de la fiche. Pas le moteur.
      // « Cannot set properties of null (setting 'hidden') » à #postNotification : notification de chat du cœur (panneau de chat
      // replié), dont le message est supprimé pendant son animation d'entrée (foundry.mjs, ChatLog, `#postNotification` relit
      // l'élément par son id). Vu le 2026-09-26 dans `defenses`, chat replié. Pas le moteur.
      // BG3 HUD 0.6.0 sans token sélectionné (`this.actor` null) : `getSelectedPassives` (DnD5ePassivesContainer.js:63) et le
      // bouton « Fin du tour » (DnD5eActionButtonsContainer.js:40) se rafraîchissent à un changement de combat ou de niveau.
      // Vu le 2026-09-27 dans `escaliers` (le changement de niveau du cœur désélectionne le token). Pas le moteur.
      // Même cause, confirmée le 2026-09-27 par la pile : « Cannot read properties of null (reading 'system') » à
      // `DnD5eInfoContainer.renderAbilitiesHeader` (DnD5eInfoContainer.js:100), par `PortraitContainer.swapTokenContext` ←
      // `BG3Hotbar._softTokenSwapRefresh` ← `UpdateCoordinator._onUpdateToken` (bg3-hud-core 0.6.0), au changement de niveau.
      // Un son de module tiers qui ne se charge pas (BLFX : « Failed to load audio element "modules/blfx-assets-pack01/…" »), vu le
      // 2026-09-28 au rejeu de `druide` (téléportation de la Foulée sélène). Pas le moteur. De même les sons du cœur (« sounds/dice.wav »,
      // par dizaines dans `malediction` à la passe complète du 2026-09-29) : l'audio du client, pas le moteur.
      // L'animation d'un token du cœur (foundry.mjs, `#animate` ← `#animateFrame`) interrompue par un changement de niveau :
      // « Cannot read properties of undefined (reading 'chain') », vu le 2026-09-28 dans `escaliers`. Pas le moteur.
      // Animations de Sequencer et de Boss Loot (BLFX) lancées sur un token ou un effet que le scénario déplace, retire ou dont il
      // retire l'effet aussitôt : « Cannot read/set properties of null (reading 'position' | 'rotation', setting 'volume') », la
      // pile DANS sequencer.js (`CanvasEffect._createFile`, `PersistentCanvasEffect._createSprite`) ou boss-loot-assets-premium
      // (`summonActorAnimation`, customSpells3.js). Vu le 2026-09-29 dans `repliques`, `riposte`, `sorts-clerc-druide`, `sorts-codes`,
      // leurs vérifications propres passant. Décidé par l'utilisateur : ignorées ici, les modules restent actifs. Seule une erreur
      // « propriété de null » dont la pile est dans ces modules : toute autre erreur reste comptée.
      // « Codec reclaimed due to inactivity » : Chromium reprend les décodeurs vidéo (WebCodecs) des animations en .webm quand la
      // fenêtre de Foundry reste en arrière-plan — par dizaines à la passe complète du 2026-10-01 (`sorts-lot-1`, `sorts-lot-2`,
      // `tours-de-magie`, `ravenloft-options`), l'utilisateur travaillant dans une autre fenêtre. Le navigateur, pas le moteur.
      // « Cannot read properties of null (reading 'off') » à PreciseText.destroy (pixi) : un texte du canevas détruit deux fois quand
      // la vue du MJ change de niveau (le canevas est redessiné) pendant qu'un AUTRE token est en marche — le suiveur, dans
      // `suivre` (2026-10-01, §41.3) ; jamais avec un seul token (`escaliers`, `escalier-direct`). La pile s'arrête à pixi : origine
      // non établie (règle ou étiquette d'un token animé), le suiveur arrive quand même. Pas une erreur du moteur.
      // « triggerItems is not iterable » : `_updateCombat` de boss-loot-assets-premium (hooks.js:779), au changement de tour d'un
      // combat dont un combattant vient de mourir — vu dans `crapaud` (ravenloft, 2026-10-01). Module tiers.
      const thirdPartyAnimation = /Cannot (read|set) properties of null[\s\S]*(modules\/sequencer\/dist\/sequencer\.js|modules\/boss-loot-assets-premium\/)/;
      return (r.entries ?? r.errors ?? r ?? []).filter?.(e => !thirdPartyAnimation.test(e.message ?? e.text ?? "")).filter?.(e => !/reading 'chain'\)[\s\S]*#animate|Failed to load audio element "(modules\/blfx-|sounds\/)|Codec reclaimed due to inactivity|triggerItems is not iterable|reading 'off'\)[\s\S]*PreciseText\.destroy|screen resolution|usable window dimensions|ResizeObserver loop|search for 'turn' in undefined|does not exist in the EmbeddedCollection|"auraeffects.aura" is not a valid type|Cannot set properties of null \(setting 'hidden'\)|bg3-hud-dnd5e\/scripts\/components\/containers\/DnD5e(Passives|ActionButtons|Info)Container/i.test(e.message ?? e.text ?? "")) ?? [];
    },

    /** Le journal du moteur (lignes `dnd5e-combat |`) depuis le dernier vidage : imprimé quand un scénario échoue. */
    async engineLog() {
      const r = await mcp.call("get-client-errors", { levels: ["log", "warn"], limit: 200 });
      return (r.entries ?? r.errors ?? []).map(e => String(e.message ?? e.text ?? "")).filter(m => /dnd5e-combat/.test(m) && !/budget|cibles relâchées|visée|dés 3D/.test(m));
    },

    /* ---- combat ---- */

    async startCombat(tokens) {
      // Au début du combat, le moteur pose ses actions de base sur les personnages des joueurs (§15.2) :
      // on retire à la fin celles qu'il aura posées pendant le scénario.
      const engineItems = async actorId => ((await mcp.call("get-actor", { actorId })).items ?? [])
        .filter(i => i.flags?.[MODULE_ID]?.basicAction).map(i => i._id);
      const actorIds = [...new Set(tokens.map(t => t.actorId).filter(Boolean))];
      const before = new Map();
      for ( const id of actorIds ) before.set(id, new Set(await engineItems(id)));
      ctx.restore(async () => {
        for ( const id of actorIds ) {
          for ( const itemId of await engineItems(id) ) {
            if ( !before.get(id).has(itemId) ) await mcp.call("remove-embedded-item", { documentType: "Actor", id, itemId });
          }
        }
      });
      const r = await mcp.call("start-combat", { tokenIds: tokens.map(t => t.id), rollInitiative: false });
      // Toujours CE combat-là, par son id : sans id, le connecteur agit sur le combat ACTIF — celui d'une partie
      // en cours si le MJ joue en même temps (vu le 2026-09-23 : un combat de l'utilisateur supprimé).
      ctx.ownCombat = r?.id ?? null;
      ctx.restore(() => (ctx.ownCombat ? mcp.call("end-combat", { combatId: ctx.ownCombat }) : null)?.catch?.(() => {}));
      return r;
    },
    ownCombat: null,
    nextTurn: () => mcp.call("next-turn", ctx.ownCombat ? { combatId: ctx.ownCombat } : {}),
    combat: () => mcp.call("get-combat", ctx.ownCombat ? { combatId: ctx.ownCombat } : {})
  };
  return ctx;
}

/* -------------------------------------------- */

const dir = join(import.meta.dirname, "scenarios");
// Un argument qui est un chemin (fichier .mjs ou dossier) désigne des scénarios d'ailleurs — ceux qu'un autre module garde dans son
// propre dépôt (`node tools/scenario.mjs ../autre-module/tools/scenarios`, ou un fichier). Les autres sont des noms de tools/scenarios/.
const args = process.argv.slice(2);
const external = args.filter(a => existsSync(a) && (statSync(a).isDirectory() || a.endsWith(".mjs"))).map(a => resolve(a));
const wanted = args.filter(a => !external.includes(resolve(a)));
const listed = d => readdirSync(d).filter(f => f.endsWith(".mjs")).sort().map(f => join(d, f));
const files = [
  ...(external.length && !wanted.length ? [] : listed(dir).filter(f => !wanted.length || wanted.includes(basename(f, ".mjs")))),
  ...external.flatMap(p => statSync(p).isDirectory() ? listed(p) : [p])
];
if ( !files.length ) {
  console.error(`aucun scénario ${args.join(", ")} dans ${dir}`);
  process.exit(2);
}

let mcp;
try { mcp = await connect(); }
catch(err) { console.error(err.message); process.exit(2); }

/** Message et début de pile d'une erreur du client, pour situer le fautif (moteur, système, autre module). */
const describeError = e => (e.message ?? e.text ?? "")
  + (e.stack ? "\n        " + String(e.stack).split("\n").filter(l => /\bat\b/.test(l)).slice(0, 12).join("\n        ") : "");

// Un combat déjà là : une partie en cours. Les scénarios créent le leur et n'agissent que sur lui (par son id).
{
  const existing = await mcp.call("get-combat", {}).catch(() => null);
  const combats = existing?.combats ?? (existing?.id ? [existing] : []);
  if ( combats.length ) console.log(`⚠ ${combats.length} combat(s) déjà dans le monde : les scénarios n'y touchent pas, ils créent et terminent le leur.`);
}

/**
 * Filet de sécurité entre deux scénarios (ajouté le 2026-09-23, après un Magicien laissé au contact du Zombi,
 * à 0 PV, par une suite de scénarios) : on relève chaque token de la scène — position, PV, effets — avant
 * le scénario, et on remet après sa propre remise en état ce qui a bougé ; les effets apparus sont retirés.
 * Les items aussi (2026-09-26) : un item prêté à un token NON LIÉ va sur l'acteur de base, mais dès que le moteur ou dnd5e
 * le modifie par le token (utilisations, flags), V14 en recopie une version dans le delta du token — retirer l'item de
 * l'acteur de base la laisse en place. 43 items prêtés s'étaient accumulés ainsi sur le Loup de `ravenloft`.
 * Les items **disparus** aussi (2026-10-01) : un module voisin qui fait quitter la main à une arme lancée (Darsh Loot : plantée
 * dans la cible ou tombée en tas) retirait leurs armes aux personnages de `dnd-6` — la Javeline du Guerrier, une Dague du
 * Magicien à la passe complète de ce jour-là. Un item de l'acteur qui a disparu est rendu sous son identifiant
 * (`api.mcp.restoreItem`), une quantité changée est remise, et une région ou une tuile née pendant le scénario et restée là
 * (un tas au sol) est retirée.
 */
async function snapshotScene(mcp) {
  const { sceneId, objects } = await mcp.call("list-scene-objects", { types: ["Token", "Region", "Tile"] });
  const tokens = [];
  for ( const t of objects.Token ?? [] ) {
    if ( !t.actorId ) continue;
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
    const actor = await mcp.call("get-actor", { actorId: data.actorId });
    tokens.push({
      id: t.id, name: t.name, linked: !!data.actorLink, actorId: data.actorId,
      pos: { x: data.x, y: data.y, elevation: data.elevation ?? 0, level: data.level ?? null },
      hp: data.actorLink ? (actor?.system?.attributes?.hp?.value ?? null) : (data.delta?.system?.attributes?.hp?.value ?? null),
      effects: new Set((data.actorLink ? (actor?.effects ?? []) : (data.delta?.effects ?? [])).map(e => e._id)),
      // §84 : les emplacements de sort restants d'un acteur lié (les scénarios qui consomment vidaient ceux du Clerc).
      spells: data.actorLink ? Object.fromEntries(Object.entries(actor?.system?.spells ?? {}).map(([k, v]) => [k, v?.value ?? null])) : null,
      items: new Set((actor?.items ?? []).map(i => i._id)),
      // Les données des items de l'acteur, pour rendre celui qui disparaît et remettre une quantité.
      itemData: new Map((actor?.items ?? []).map(i => [i._id, i])),
      deltaItems: new Set((data.delta?.items ?? []).map(i => i._id))
    });
  }
  return { sceneId, tokens, regions: new Set((objects.Region ?? []).map(r => r.id)), tiles: new Set((objects.Tile ?? []).map(t => t.id)) };
}

async function restoreScene(mcp, snap) {
  const fixed = [];
  const seenActors = new Set();
  for ( const t of snap.tokens ) {
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id }).catch(() => ({}));
    if ( !data ) continue;
    const away = d => (d.x !== t.pos.x) || (d.y !== t.pos.y) || ((d.elevation ?? 0) !== t.pos.elevation) || ((d.level ?? null) !== t.pos.level);
    if ( away(data) ) {
      // Relu après coup, une nouvelle tentative : des tokens restaient ailleurs sans qu'on le voie (le Roublard et le Magicien,
      // relevés hors de leur case le 2026-09-28). Un échec se dit, pour qu'on sache quel scénario et quel token.
      let now = data;
      for ( let attempt = 0; (attempt < 2) && away(now); attempt++ ) {
        await mcp.call("move-token", { tokenId: t.id, x: t.pos.x, y: t.pos.y, elevation: t.pos.elevation, ...(t.pos.level ? { levelId: t.pos.level } : {}) }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 600));
        now = (await mcp.call("get-scene-object", { type: "Token", objectId: t.id }).catch(() => ({}))).data ?? now;
      }
      fixed.push(away(now) ? `${t.name} NON replacé (${now.x} × ${now.y} au lieu de ${t.pos.x} × ${t.pos.y})` : `${t.name} replacé`);
    }
    if ( t.linked && seenActors.has(t.actorId) ) continue;
    seenActors.add(t.actorId);
    const actor = t.linked ? await mcp.call("get-actor", { actorId: t.actorId }) : null;
    const hp = t.linked ? actor?.system?.attributes?.hp?.value : data.delta?.system?.attributes?.hp?.value;
    if ( (t.hp !== null) && (hp !== t.hp) ) {
      if ( t.linked ) await mcp.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.hp.value": t.hp } });
      else await mcp.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.value": t.hp } });
      fixed.push(`${t.name} PV ${hp} → ${t.hp}`);
    } else if ( (t.hp === null) && !t.linked && (hp !== null) && (hp !== undefined) ) {
      // §82 : token non lié qui héritait des PV de sa fiche ; le scénario lui en a écrit dans son delta — on les retire.
      await mcp.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.-=value": null } });
      fixed.push(`${t.name} PV ${hp} → ceux de la fiche`);
    }
    if ( t.spells && actor ) {
      const changed = Object.entries(t.spells).filter(([k, v]) => (v !== null) && ((actor.system?.spells?.[k]?.value ?? null) !== v));
      if ( changed.length ) {
        await mcp.call("update-actor", { actorId: t.actorId, actorData: Object.fromEntries(changed.map(([k, v]) => [`system.spells.${k}.value`, v])) });
        fixed.push(`${t.name} : emplacements ${changed.map(([k, v]) => `${k} → ${v}`).join(", ")}`);
      }
    }
    const effects = t.linked ? (actor?.effects ?? []) : (data.delta?.effects ?? []);
    const target = t.linked ? { documentType: "Actor", id: t.actorId } : { uuid: `Scene.${snap.sceneId}.Token.${t.id}.Actor.${t.actorId}` };
    // Les copies d'aura vont et viennent avec les positions (le moteur les recrée) : pas au filet.
    for ( const e of effects.filter(e => !t.effects.has(e._id) && !e.flags?.[MODULE_ID]?.aura) ) {
      await mcp.call("remove-embedded-effect", { ...target, effectId: e._id }).catch(() => {});
      fixed.push(`${t.name} : effet « ${e.name} » retiré`);
    }
    // Items apparus : sur l'acteur (lié, ou acteur de base d'un token non lié), puis dans le delta d'un token non lié.
    const base = actor ?? await mcp.call("get-actor", { actorId: t.actorId }).catch(() => null);
    for ( const i of (base?.items ?? []).filter(i => !t.items.has(i._id)) ) {
      await mcp.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: i._id }).catch(() => {});
      fixed.push(`${t.name} : item « ${i.name} » retiré`);
    }
    // Items disparus de l'acteur, quantités changées (arme lancée qu'un module voisin fait quitter la main).
    const present = new Map((base?.items ?? []).map(i => [i._id, i]));
    for ( const [id, before] of t.itemData ?? [] ) {
      const now = present.get(id);
      if ( !now ) {
        const { folder, ownership, _stats, ...itemData } = before;
        const r = await mcp.call("call-module-api", { moduleId: MODULE_ID, fn: "restoreItem", args: { actorId: t.actorId, itemData }, waitMs: 8000 }).catch(err => ({ error: err.message }));
        fixed.push(r?.result?.restored ? `${t.name} : item « ${before.name} » rendu` : `${t.name} : item « ${before.name} » NON rendu (${r?.error ?? "sans réponse"})`);
      } else if ( (before.system?.quantity !== undefined) && (now.system?.quantity !== before.system.quantity) ) {
        await mcp.call("upsert-actor-item", { actorId: t.actorId, itemData: { "system.quantity": before.system.quantity }, match: { path: "_id", value: id } }).catch(() => {});
        fixed.push(`${t.name} : « ${before.name} » quantité ${now.system?.quantity} → ${before.system.quantity}`);
      }
    }
    if ( !t.linked ) {
      const baseIds = new Set((base?.items ?? []).map(i => i._id));
      for ( const i of (data.delta?.items ?? []).filter(i => !t.deltaItems.has(i._id) && !baseIds.has(i._id)) ) {
        await mcp.call("remove-embedded-item", { ...target, itemId: i._id }).catch(() => {});
        fixed.push(`${t.name} : item « ${i.name} » retiré du token`);
      }
    }
  }
  // Régions et tuiles nées pendant le scénario et restées là (le tas d'un module voisin) : la région d'abord, son coffre part
  // avec elle.
  if ( snap.regions && snap.tiles ) {
    for ( const [kind, known] of [["Region", snap.regions], ["Tile", snap.tiles]] ) {
      const { objects } = await mcp.call("list-scene-objects", { types: [kind] }).catch(() => ({ objects: {} }));
      for ( const o of (objects?.[kind] ?? []).filter(o => !known.has(o.id)) ) {
        await mcp.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
        fixed.push(`${kind === "Region" ? "région" : "tuile"} « ${o.name ?? o.id} » retirée`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if ( fixed.length ) console.log(`    ↺ filet de sécurité : ${fixed.join(" ; ")}`);
}

// §83 : la scène de chaque scénario. Dans un monde qui a l'arène de test (`dnd-6`), un scénario s'y joue, sauf `scene: "keep"`
// (étages, escaliers : Restored Keep) ; la scène active du départ est rétablie à la fin. Sans arène, la scène active, comme avant.
const scenes = await mcp.call("list-scenes", {}).catch(() => []);
const sceneList = Array.isArray(scenes) ? scenes : (scenes.scenes ?? []);
// `ARENE=0` : sans l'arène (la scène active), pour comparer.
const arenaScene = (process.env.ARENE === "0") ? null : (sceneList.find(s => s.name === ARENA.name) ?? null);
const keepScene = sceneList.find(s => s.id === RESTORED_KEEP.scene) ?? null;
const activeAtStart = sceneList.find(s => s.active)?.id ?? null;
let activeNow = activeAtStart;

/** Active une scène et attend que le client du MJ l'affiche. */
async function useScene(id) {
  if ( !id || (activeNow === id) ) return;
  await mcp.call("activate-scene", { sceneId: id });
  for ( let i = 0; i < 30; i++ ) {
    await sleep(500);
    const { sceneId } = await mcp.call("list-scene-objects", { types: ["Token"] }).catch(() => ({}));
    if ( sceneId === id ) break;
  }
  await sleep(2500);   // le canevas du MJ se dessine (vision, régions) avant que le moteur y lise quoi que ce soit
  activeNow = id;
  console.log(`    ⇄ scène : ${sceneList.find(s => s.id === id)?.name ?? id}`);
}

/** Dans l'arène, chaque token de la distribution à sa place, au sol. */
async function arrangeArena() {
  const { objects } = await mcp.call("list-scene-objects", { types: ["Token"] });
  for ( const t of objects.Token ?? [] ) {
    const at = ARENA.tokens[t.name];
    if ( !at ) continue;
    const { data } = await mcp.call("get-scene-object", { type: "Token", objectId: t.id });
    if ( (data.x === at[0]) && (data.y === at[1]) && !(data.elevation ?? 0) ) continue;
    await mcp.call("move-token", { tokenId: t.id, x: at[0], y: at[1], elevation: 0 }).catch(err => console.log(`    ! ${t.name} non replacé : ${err.message}`));
    await sleep(300);
  }
}

let failed = 0;
let skipped = 0;
// L'état laissé par le scénario précédent, une fois remis en place : un token qui a bougé ENTRE deux scénarios (un déplacement
// retardé du moteur, après le filet de sécurité) est signalé en nommant ce scénario, et remis. Le Magicien et le Roublard se
// retrouvaient hors de leur case sans que le filet le voie (2026-09-28).
let previous = null;
for ( const file of files ) {
  const { default: scenario } = await import(pathToFileURL(file).href);
  const named = wanted.length || external.includes(file);
  // Un scénario qui attend un clic du MJ (`interactive`) ne se joue que nommé.
  if ( scenario.interactive && !named ) { console.log(`\n· ${scenario.name ?? basename(file)} : interactif, sauté (le nommer pour le jouer)`); skipped++; continue; }
  console.log(`\n▶ ${scenario.name ?? basename(file)}`);
  if ( arenaScene ) {
    const target = (scenario.scene === "keep") ? keepScene : arenaScene;
    if ( target ) {
      if ( target.id !== activeNow ) previous = null;   // l'état laissé dans l'autre scène ne se compare pas
      await useScene(target.id);
      if ( target === arenaScene ) await arrangeArena();
    }
  }
  const ctx = makeContext(mcp);
  if ( previous ) {
    const now = await snapshotScene(mcp).catch(() => null);
    const moved = (now?.tokens ?? []).filter(t => {
      const before = previous.snap.tokens.find(b => b.id === t.id);
      return before && ((before.pos.x !== t.pos.x) || (before.pos.y !== t.pos.y) || (before.pos.elevation !== t.pos.elevation) || (before.pos.level !== t.pos.level));
    });
    if ( moved.length ) {
      console.log(`    ⚠ entre « ${previous.name} » et ce scénario, des tokens ont bougé : ${moved.map(t => {
        const b = previous.snap.tokens.find(x => x.id === t.id).pos;
        return `${t.name} (${b.x} × ${b.y} → ${t.pos.x} × ${t.pos.y})`;
      }).join(", ")} — remis`);
      await restoreScene(mcp, previous.snap).catch(err => console.log(`    ! filet de sécurité : ${err.message}`));
    }
  }
  const snap = await snapshotScene(mcp);
  // Les effets et sons Sequencer d'avant le scénario : ceux qui naissent pendant (animations de BLFX, sons en boucle) sont terminés
  // après la remise en état.
  const seq0 = await ctx.engine("sequencer").catch(() => null);
  try {
    await ctx.clientErrors();   // vide le tampon
    await scenario.run(ctx);
    if ( ctx.failures.length ) for ( const line of await ctx.engineLog() ) console.log(`      · ${line.slice(0, 200)}`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(describeError).join(" | ").slice(0, 1500)}` : ""}`);
  } catch(err) {
    console.log(`    ✗ interrompu : ${err.message}`);
    ctx.failures.push(err.message);
  } finally {
    await ctx.undoAll();
    await sleep(1500);   // les suppressions de la remise en état (auras, états) se propagent
    await restoreScene(mcp, snap).catch(err => console.log(`    ! filet de sécurité : ${err.message}`));
    if ( seq0?.available ) {
      const now = await ctx.engine("sequencer").catch(() => null);
      const effects = (now?.effects ?? []).filter(e => !seq0.effects.some(x => x.id === e.id)).map(e => e.id);
      const sounds = (now?.sounds ?? []).filter(s => !seq0.sounds.some(x => x.id === s.id)).map(s => s.id);
      if ( effects.length || sounds.length ) {
        await ctx.engine("sequencer", { end: { effects, sounds } }).catch(err => console.log(`    ! Sequencer : ${err.message}`));
        console.log(`    ↺ Sequencer : ${effects.length} effet(s), ${sounds.length} son(s) laissés par le scénario, terminés`);
      }
    }
    previous = { name: scenario.name ?? basename(file), snap };
  }
  if ( ctx.failures.length ) failed++;
  console.log(ctx.failures.length ? `  ✗ ${ctx.failures.length} vérification(s) en défaut` : "  ✓ scénario tenu");
}
if ( activeAtStart && (activeNow !== activeAtStart) ) await useScene(activeAtStart);
console.log(`\n${files.length - skipped - failed}/${files.length - skipped} scénario(s) tenus${skipped ? ` (${skipped} interactif(s) sauté(s))` : ""}`);
process.exitCode = failed ? 1 : 0;
