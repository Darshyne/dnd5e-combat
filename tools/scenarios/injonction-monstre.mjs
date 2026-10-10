/**
 * « Lâche » sur un monstre (SPEC §16.59, §40.3 ; Butin et commerce 0.15.1) : un Familier vampire du Monster Manual (importé le temps
 * du scénario, lié) tient sa Dague ombrale — de l'équipement (« Équipement : Dagues (10) »), source la Dague du Manuel des joueurs — et
 * une arme de test sans la propriété `gear` (une attaque de créature). Le Clerc lui ordonne « Lâche ».
 *  - Les dagues tombent en tas sous leur version « équipement » : « Dagger » ×10, la Dague du Manuel des joueurs, pas l'attaque.
 *  - L'attaque de créature ne tombe pas : elle reste sur la fiche, déséquipée.
 * Sans Butin et commerce (aucun voisin au hook `dropItems`) : non applicable. Remet tout (acteur, token, tas, combat).
 */
const MODULE_ID = "dnd5e-combat";
const FAMILIAR = "Compendium.dnd-monster-manual.actors.Actor.mmVampireFamilia";
const NAME = "zz-familier-injonction";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "injonction — Lâche sur un monstre : l'équipement tombe, ses attaques non",
  scene: "keep",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Clerc") ) { ctx.log("Clerc absent : non applicable"); return; }
    const status = await ctx.call("call-module-api", { moduleId: "darsh-loot", fn: "status", args: {} }).catch(() => null);
    if ( !status ) { ctx.log("Butin et commerce absent : non applicable"); return; }
    const entry = await ctx.call("get-compendium-entry", { uuid: FAMILIAR }).catch(() => null);
    if ( !entry?.data ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    await ctx.ensureItem(cleric, "Compendium.dnd5e.spells24.Item.phbsplCommand000", { system: { method: "atwill" } });
    const grid = await ctx.gridSize();

    // Le familier, lié (ses objets se lisent sur l'acteur), et une attaque de test sans `gear`.
    const { _id, folder, ownership, _stats, ...data } = entry.data;
    const created = await ctx.call("create-actor", { actorData: { ...data, name: NAME, prototypeToken: { ...(data.prototypeToken ?? {}), actorLink: true, name: NAME, disposition: -1 },
      // Marqué comme acteur d'essai : Butin et commerce le retire avec son token (`api.mcp.removeTestActors`).
      flags: { ...(data.flags ?? {}), "darsh-loot": { test: true } } } });
    const actorId = created?.id ?? created?.actor?.id;
    ctx.restore(async () => {
      await ctx.call("call-module-api", { moduleId: "darsh-loot", fn: "removeTestActors", args: {} }).catch(err => ctx.log(`familier non retiré : ${err.message}`));
    });
    const items = async () => (await ctx.call("get-actor", { actorId })).items ?? [];
    const dagger = (await items()).find(i => i.system?.identifier === "umbral-dagger");
    await ctx.call("upsert-actor-item", { actorId, match: { path: "_id", value: dagger._id }, itemData: { system: { equipped: true } } });
    await ctx.call("upsert-actor-item", { actorId, itemData: { name: "Lame d'ombre (attaque de test)", type: "weapon",
      system: { type: { value: "simpleM" }, equipped: true, quantity: 1, identifier: "test-shadow-blade" } } });
    const claw = (await items()).find(i => i.system?.identifier === "test-shadow-blade");
    // dnd5e pose `gear` sur tout objet physique d'un PNJ : retiré, c'est une attaque de créature.
    const props = (claw.system?.properties ?? []).filter(p => p !== "gear");
    await ctx.call("upsert-actor-item", { actorId, match: { path: "_id", value: claw._id }, itemData: { "system.properties": props } });
    const clawProps = (await items()).find(i => i._id === claw._id)?.system?.properties ?? [];
    ctx.expect(!clawProps.includes("gear"), `l'attaque de test n'a pas la propriété gear (${clawProps.join(", ")})`);

    // Placé au sud du Clerc (Restored Keep, colonne libre relevée par le scénario `injonction`).
    const anchor = { x: 3080, y: 4900, elevation: 0 };
    const c = await ctx.position(cleric);
    if ( (c.x !== anchor.x) || (c.y !== anchor.y) ) await ctx.call("move-token", { tokenId: cleric.id, ...anchor });
    ctx.restore(async () => { await ctx.call("move-token", { tokenId: cleric.id, x: c.x, y: c.y, elevation: c.elevation ?? 0 }).catch(() => {}); });
    await ctx.call("place-token", { actorId, x: anchor.x, y: anchor.y + (2 * grid) });
    await pause(1000);
    const famToken = ((await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? []).find(t => t.name === NAME);
    const fam = { id: famToken.id, actorId, name: NAME };

    // Les tas créés : relevés pour la vérification et la remise en état.
    const KINDS = ["Region", "Tile"];
    const objects = async () => (await ctx.call("list-scene-objects", { types: KINDS })).objects ?? {};
    const before = await objects();
    const known = Object.fromEntries(KINDS.map(k => [k, new Set((before[k] ?? []).map(o => o.id))]));
    const fresh = async () => { const now = await objects(); return Object.fromEntries(KINDS.map(k => [k, (now[k] ?? []).filter(o => !known[k].has(o.id))])); };
    ctx.restore(async () => {
      for ( const kind of KINDS ) {
        for ( const o of (await fresh())[kind] ) await ctx.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
        await pause(500);
      }
    });

    // L'Injonction « Lâche », jusqu'à une sauvegarde ratée.
    let posed = false;
    for ( let n = 1; (n <= 20) && !posed; n++ ) {
      const used = await ctx.use({ tokenId: cleric.id, identifier: "command", activityType: "save", consume: false,
        targetTokenIds: [fam.id], usageConfig: { [MODULE_ID]: { order: "drop" } } });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(2000);
      posed = (await ctx.effects(fam)).some(e => e.flags?.[MODULE_ID]?.order);
    }
    if ( !ctx.expect(posed, "Lâche : le familier rate sa sauvegarde, l'ordre est posé") ) return;

    // Au tour du familier, l'ordre s'exécute.
    await ctx.startCombat([cleric, fam]);
    const cb = await ctx.combat();
    for ( const [t, value] of [[cleric, 20], [fam, 10]] ) {
      const x = (cb.combatants ?? []).find(y => (y.tokenId === t.id) || (y.name === t.name));
      if ( x ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: x.id, value });
    }
    const now = await ctx.combat();
    if ( (now.combatants ?? []).find(x => x.isCurrent || x.current)?.name !== cleric.name ) await ctx.nextTurn();
    await pause(800);
    await ctx.nextTurn();
    await pause(5000);

    const after = await items();
    ctx.expect(!after.some(i => i._id === dagger._id), "les dagues ont quitté la fiche du familier");
    const kept = after.find(i => i._id === claw._id);
    ctx.expect(!!kept && (kept.system?.equipped === false), `l'attaque de créature reste sur la fiche, déséquipée (${kept ? (kept.system?.equipped ? "équipée" : "déséquipée") : "absente"})`);
    const made = await fresh();
    ctx.expect(made.Region.length === 1, `un tas au sol (${made.Region.length})`);
    const pile = made.Region[0] ? await ctx.call("call-module-api", { moduleId: "darsh-loot", fn: "zoneState", args: { regionId: made.Region[0].id } }).catch(() => null) : null;
    // Le tas range ses objets dans un acteur Groupe (`system.actor` du comportement).
    const storeUuid = pile?.result?.behaviors?.[0]?.system?.actor ?? "";
    const store = storeUuid ? await ctx.call("get-actor", { actorId: storeUuid.split(".").at(-1) }).catch(() => null) : null;
    const content = (store?.items ?? []).map(i => `${i.name} x${i.system?.quantity} [${i.system?.identifier}] ${i._stats?.compendiumSource ?? ""}`);
    ctx.log(`contenu du tas : ${content.join(" ; ")}`);
    const text = content.join(" ");
    ctx.expect(/Dagger|Dague/.test(text) && !/Umbral|ombrale/i.test(text), "le tas contient des Dagues normales, pas la Dague ombrale");
    ctx.expect(!/Lame d'ombre|test-shadow-blade/.test(text), "l'attaque de créature n'est pas dans le tas");
  }
};
