/**
 * Ordre imposé (SPEC §16.59) : Injonction du Clerc (ajoutée à volonté), l'ordre fixé d'avance sur la carte
 * (`usageConfig["dnd5e-combat"].order`), sauvegarde de Sagesse rejouée jusqu'à l'échec, puis un combat : au début du tour
 * de la cible, l'ordre s'exécute ; à la fin de ce tour, l'effet tombe.
 *  - Choix de l'ordre : sans ordre fixé, la fenêtre s'ouvre chez l'auteur ; « Halte » choisi, posé.
 *  - Rampe (Zombi) : À terre, tour achevé (plus de déplacement).
 *  - Halte (Zombi) : ne bouge pas, tour achevé.
 *  - Approche (Zombi à 4 cases) : arrive au contact du Clerc, tour achevé.
 *  - Fuis (Zombi à 2 cases) : s'éloigne du Clerc. Depuis le contact : l'attaque d'opportunité du Clerc est proposée avant
 *    le déplacement, refusée (« Ne pas réagir »), puis la fuite reprend.
 *  - Lâche (Guerrier) : son arme équipée est lâchée — un tas au sol, l'arme quitte la fiche (rendue et tas retiré à la fin) :
 *    tas d'un module voisin inscrit au hook `dnd5e-combat.dropItems` (§40.3 : une région, sa tuile — Darsh Loot), sinon
 *    sans module voisin : déséquipée.
 * Remet positions, effets, états, équipement et combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "injonction — Rampe, Halte, Approche, Fuis, Lâche",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    await ctx.ensureItem(cleric, "Compendium.dnd5e.spells24.Item.phbsplCommand000", { system: { method: "atwill" } });
    const all = [cleric, fighter, zombi];
    const home = new Map();
    const effects0 = new Map();
    for ( const t of all ) { home.set(t.id, await ctx.position(t)); effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id))); }
    const fighterItems = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
    const equipped0 = fighterItems.filter(i => i.system?.equipped === true).map(i => i._id);
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        const h = home.get(t.id);
        const now = await ctx.position(t);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      for ( const id of equipped0 ) await ctx.call("upsert-actor-item", { actorId: fighter.actorId, match: { path: "_id", value: id }, itemData: { system: { equipped: true } } }).catch(() => {});
      await pause(1000);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };
    const gap = async (a, b) => {
      const pa = await ctx.position(a);
      const pb = await ctx.position(b);
      return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y)) / grid - 1;   // tokens d'une case
    };
    // Restored Keep (`dnd-6`), colonne x = 3080 : le Clerc en 4900, et au sud jusqu'en 5460 quatre cases libres de murs et de tokens
    // (relevé du scénario `poussee`). Le scénario avait été vérifié le 2026-09-27 sur le Mac (`dnd-test-module-combat`), où le Zombi se
    // posait à l'est du Clerc ; ici, à l'est du Clerc, un mur et une porte le séparent de lui (vu le 2026-09-28).
    const anchor = { x: 3080, y: 4900, elevation: 0 };
    const place = async (t, dx, dy) => {
      const c = await ctx.position(cleric);
      if ( (c.x !== anchor.x) || (c.y !== anchor.y) ) await ctx.call("move-token", { tokenId: cleric.id, ...anchor });
      await ctx.call("move-token", { tokenId: t.id, x: anchor.x + (dx * grid), y: anchor.y + (dy * grid), elevation: anchor.elevation });
      await pause(1000);
    };
    /** Injonction jusqu'à une sauvegarde ratée, l'ordre fixé ; rend true si l'effet est posé. */
    const command = async (target, order) => {
      for ( let n = 1; n <= 20; n++ ) {
        const used = await ctx.use({ tokenId: cleric.id, identifier: "command", activityType: "save", consume: false,
          targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { order } } });
        await ctx.settle(used.usageMessageId).catch(() => null);
        await pause(2000);
        if ( (await ctx.effects(target)).some(e => e.flags?.[MODULE_ID]?.order) ) return true;
      }
      return false;
    };
    /** Un combat Clerc (20) puis la cible (10) ; on passe au tour de la cible. */
    const toTurnOf = async target => {
      await ctx.startCombat([cleric, target]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [target, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      const now = await ctx.combat();
      if ( (now.combatants ?? []).find(x => x.isCurrent || x.current)?.name !== cleric.name ) await ctx.nextTurn();
      await pause(800);
      ctx.since = await ctx.lastMessageId();
      await ctx.nextTurn();
      await pause(1500);
    };
    /** Attend le message « obéit » de la cible (l'ordre exécuté jusqu'au bout), 20 s au plus. */
    const obeyed = async target => {
      for ( let n = 0; n < 40; n++ ) {
        const { messages } = await ctx.call("list-chat-messages", { limit: 20, ...(ctx.since ? { sinceId: ctx.since } : {}) });
        if ( (messages ?? []).some(m => (m.alias === target.name) && /obéit|obeys/i.test(m.text ?? m.content ?? "")) ) return true;
        await pause(500);
      }
      return false;
    };
    const movement = t => ctx.engine("movement", { tokenId: t.id });
    const stopped = m => !!m?.combat && Number.isFinite(m.cap) && (m.cap <= (m.combat.spent ?? 0) + 1e-6);
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);

    await part("Choix de l'ordre", async () => {
      // Sans ordre fixé d'avance : à la sauvegarde ratée, la fenêtre « Quel ordre donner ? » s'ouvre chez l'auteur (le MJ ici) ;
      // le scénario choisit « Halte » (connecteur : list-dialogs, answer-dialog).
      await place(zombi, 0, 3);
      let posed = null;
      for ( let n = 1; (n <= 20) && !posed; n++ ) {
        const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
        const used = await ctx.use({ tokenId: cleric.id, identifier: "command", activityType: "save", consume: false, targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.save?.success !== false ) continue;
        const dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 8000 })).windows[0] ?? null;
        if ( !ctx.expect(!!dialog, `la fenêtre du choix de l'ordre s'ouvre (${dialog?.title ?? "aucune"} : ${(dialog?.buttons ?? []).map(b => b.label).join(", ")})`) ) return;
        const halt = (dialog.buttons ?? []).find(b => /Halte|Halt/.test(b.label ?? ""));
        await ctx.call("answer-dialog", { id: dialog.id, button: halt?.action ?? halt?.label });
        await pause(2000);
        posed = (await ctx.effects(zombi)).find(e => e.flags?.[MODULE_ID]?.order);
      }
      ctx.expect(posed?.flags?.[MODULE_ID]?.order?.order === "halt", `l'ordre choisi est posé (${posed?.name ?? "aucun"})`);
    });
    await part("Rampe", async () => {
      await place(zombi, 0, 3);
      if ( !ctx.expect(await command(zombi, "grovel"), "Rampe : le Zombi rate sa sauvegarde, l'ordre est posé") ) return;
      await toTurnOf(zombi);
      ctx.expect(await obeyed(zombi), "Rampe : le Zombi obéit à son tour (message)");
      ctx.expect((await statuses(zombi)).includes("prone"), "Rampe : le Zombi est À terre à son tour");
      ctx.expect(stopped(await movement(zombi)), "Rampe : son tour s'achève (plus de déplacement)");
      await ctx.nextTurn();
      await pause(2500);
      ctx.expect(!(await ctx.effects(zombi)).some(e => e.flags?.[MODULE_ID]?.order), "l'effet de l'ordre tombe à la fin de son tour");
    });
    await part("Halte", async () => {
      await place(zombi, 0, 3);
      if ( !ctx.expect(await command(zombi, "halt"), "Halte : l'ordre est posé") ) return;
      const before = await ctx.position(zombi);
      await toTurnOf(zombi);
      await obeyed(zombi);
      const after = await ctx.position(zombi);
      ctx.expect((after.x === before.x) && (after.y === before.y) && stopped(await movement(zombi)), "Halte : le Zombi ne bouge pas, tour achevé");
    });
    await part("Approche", async () => {
      await place(zombi, 0, 4);
      if ( !ctx.expect(await command(zombi, "approach"), "Approche : l'ordre est posé") ) return;
      await toTurnOf(zombi);
      await obeyed(zombi);
      const g = await gap(zombi, cleric);
      ctx.expect(g === 0, `Approche : le Zombi arrive au contact du Clerc (écart ${g} case(s))`);
      ctx.expect(stopped(await movement(zombi)), "Approche : arrivé au contact, son tour s'achève");
    });
    await part("Fuis", async () => {
      await place(zombi, 0, 2);
      if ( !ctx.expect(await command(zombi, "flee"), "Fuis : l'ordre est posé") ) return;
      const g0 = await gap(zombi, cleric);
      await toTurnOf(zombi);
      await obeyed(zombi);
      const g1 = await gap(zombi, cleric);
      ctx.expect(g1 >= g0 + 2, `Fuis : le Zombi s'éloigne du Clerc (écart ${g0} → ${g1} cases)`);
    });
    await part("Fuis depuis le contact", async () => {
      // Quitter l'allonge du Clerc provoque son attaque d'opportunité, proposée AVANT le déplacement (fenêtre chez le MJ) ; le
      // scénario y répond « ne pas réagir » (connecteur : list-dialogs, answer-dialog), puis la fuite reprend.
      await place(zombi, 0, 1);
      if ( !ctx.expect(await command(zombi, "flee"), "Fuis (au contact) : l'ordre est posé") ) return;
      const g0 = await gap(zombi, cleric);
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      await toTurnOf(zombi);
      let dialog = null;
      for ( let n = 0; (n < 3) && !dialog; n++ ) dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 5000 })).windows[0] ?? null;
      if ( !ctx.expect(!!dialog, `attaque d'opportunité du Clerc proposée (${dialog?.title ?? "aucune fenêtre"})`) ) return;
      const decline = (dialog.buttons ?? []).find(b => !/^use/.test(b.action ?? "")) ?? dialog.buttons?.at(-1);
      await ctx.call("answer-dialog", { id: dialog.id, button: decline?.action ?? decline?.label });
      let g1 = g0;
      await obeyed(zombi);
      g1 = await gap(zombi, cleric);
      ctx.expect(g1 >= g0 + 2, `Fuis (au contact) : refusée l'attaque d'opportunité (« ${decline?.label} »), le Zombi s'éloigne (écart ${g0} → ${g1} cases)`);
    });
    await part("Lâche", async () => {
      await place(fighter, 2, 0);
      const held = fighterItems.filter(i => (i.system?.equipped === true) && (i.type === "weapon") && (i.system?.type?.value !== "natural"));
      if ( !ctx.expect(held.length > 0, `le Guerrier tient une arme (${held.map(i => i.name).join(", ")})`) ) return;
      // Les listes relues à chaque fois (`ctx.scene()` garde celle du début du scénario : un tas créé ensuite n'y est pas).
      // Un tas est une région et sa tuile (module voisin, hook `dnd5e-combat.dropItems`, §40.3).
      const KINDS = ["Token", "Region", "Tile"];
      const sceneObjects = async () => (await ctx.call("list-scene-objects", { types: KINDS })).objects ?? {};
      const before = await sceneObjects();
      const known = Object.fromEntries(KINDS.map(k => [k, new Set((before[k] ?? []).map(o => o.id))]));
      const created = async () => {
        const now = await sceneObjects();
        return Object.fromEntries(KINDS.map(k => [k, (now[k] ?? []).filter(o => !known[k].has(o.id))]));
      };
      // L'arme quitte la fiche pour un tas : on la rendra, et on retirera le tas (la région d'abord : son coffre part avec elle).
      ctx.restore(async () => {
        for ( const kind of ["Token", "Region", "Tile"] ) {
          for ( const o of (await created())[kind] ) await ctx.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
          await pause(500);
        }
        const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
        // Sous son identifiant d'origine : le filet de sécurité retire les items qu'il ne connaissait pas.
        for ( const h of held ) {
          if ( items.some(i => i._id === h._id) ) continue;
          const { folder, ownership, _stats, ...itemData } = h;
          itemData.system = { ...itemData.system, equipped: true };
          await ctx.engine("restoreItem", { actorId: fighter.actorId, itemData }).catch(err => ctx.log(`arme non rendue : ${err.message}`));
        }
      });
      if ( !ctx.expect(await command(fighter, "drop"), "Lâche : le Guerrier rate sa sauvegarde, l'ordre est posé") ) return;
      await toTurnOf(fighter);
      await obeyed(fighter);
      await pause(1500);   // le tas d'un module voisin se pose objet par objet
      const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
      const still = held.filter(h => items.find(i => i._id === h._id)?.system?.equipped === true);
      ctx.expect(!still.length, `Lâche : plus rien en main (${held.map(i => i.name).join(", ")} lâché)`);
      ctx.expect(stopped(await movement(fighter)), "Lâche : son tour s'achève");
      const made = await created();
      const gone = held.every(h => !items.some(i => i._id === h._id));
      // Où le Zombi doit pouvoir s'arrêter : la case du tas (ni obstacle ni case prise, §16.60).
      const zombiCanStopAt = async point => {
        // Le Guerrier s'écarte (le tas est posé sur sa case).
        const f = await ctx.position(fighter);
        await ctx.call("move-token", { tokenId: fighter.id, x: f.x, y: f.y + grid, elevation: f.elevation });
        await pause(1200);
        const p = await ctx.engine("plan", { tokenId: zombi.id, point, maxCost: 1000 });
        ctx.expect(p.found && p.arrives, `le Zombi peut s'arrêter sur la case du tas (chemin ${p.found ? (p.arrives ? "jusqu'au bout" : "incomplet") : "introuvable"})`);
      };
      if ( made.Region.length ) {
        // Module voisin (§40.3) : une région de moins d'une case, dans la case du Guerrier, et sa tuile.
        ctx.expect((made.Region.length === 1) && !made.Token.length, `module voisin : un tas posé au sol (${made.Region.map(r => r.name).join(", ")})`);
        ctx.expect(gone, "module voisin : l'arme a quitté la fiche du Guerrier");
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: made.Region[0].id });
        const shape = data.shapes?.[0] ?? {};
        const f = await ctx.position(fighter);
        const inside = (shape.x >= f.x) && (shape.y >= f.y) && ((shape.x + shape.width) <= f.x + grid) && ((shape.y + shape.height) <= f.y + grid);
        ctx.expect((shape.width < grid) && (shape.height < grid) && inside, `le tas est petit, dans la case du Guerrier (${shape.width}×${shape.height} px en ${shape.x} × ${shape.y})`);
        ctx.expect(made.Tile.length === 1, `le tas a sa tuile (${made.Tile.length})`);
        await zombiCanStopAt({ x: shape.x + 1, y: shape.y + 1 });
      } else ctx.log("aucun module ne pose de tas : l'arme est déséquipée, restée dans l'inventaire");
    });
  }
};
