/**
 * §181 : les factions. Le Bandit et le Zombi, tous deux Hostiles, sont alliés tant que rien n'est réglé ; mis dans des factions
 * hostiles l'une à l'autre, ils deviennent ennemis pour les règles du moteur (attaque d'opportunité), sans rien changer pour le
 * Guerrier. Puis : relation neutre, le Bandit frappe le Zombi → rancune sur la scène (hostiles) ; relation explicite avec les PJ →
 * la disposition du Bandit suit. Remet : réglage des factions, rancunes, flags, disposition, PV, positions.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "factions — bandit et zombi ennemis par la matrice, rancune, disposition déduite",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Bandit absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const f = args => ctx.engine("factions", args);
    // Les cônes de vision (§182) ne sont pas le sujet : hors combat, le Zombi ne verrait pas le Bandit posé à côté de lui.
    const cones = await ctx.engine("setting", { key: "visionCones", value: false });
    ctx.restore(() => ctx.engine("setting", { key: "visionCones", value: cones.before }));

    const snap = await f({ op: "snapshot" });
    ctx.restore(() => f({ op: "restore", value: snap.value, clear: true }));
    ctx.restore(() => f({ op: "assign", tokenIds: [bandit.id], faction: null }));
    const { data: banditData } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { disposition: banditData.disposition } }));
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // Un monde de test qui aurait déjà des factions : on part d'un réglage vierge (le défaut, sans relation).
    await f({ op: "restore", value: { factions: snap.value?.factions ?? [], relations: {} }, clear: true });

    // Le Bandit au contact du Zombi, à sa droite.
    const grid = await ctx.gridSize();
    const { data: z } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    await ctx.stage({ tokens: { Bandit: [z.x + grid, z.y] } });
    await pause(400);
    // Les attaques d'opportunité ne se jugent que dans un combat commencé.
    await ctx.startCombat([zombi, bandit]);
    await pause(400);
    const away = { x: z.x + (grid * 5.5), y: z.y + (grid / 2) };
    const threatened = async () => (await ctx.engine("threats", { tokenId: bandit.id, point: away })).includes("Zombi");

    // 1. Rien de réglé : la disposition décide (deux Hostiles = même camp).
    const before = await f({ op: "between", aId: bandit.id, bId: zombi.id });
    const pc = (await f({ op: "between", aId: guerrier.id, bId: zombi.id })).relation;
    ctx.expect(before.relation === "allied", `sans faction réglée : Bandit et Zombi « ${before.relation} » (attendu allied)`);
    ctx.expect(!(await threatened()), "sans faction réglée : le Zombi ne menace pas le Bandit qui s'éloigne");

    // 2. Faction des bandits, hostile aux morts-vivants (le Zombi y est par la règle de type).
    const { id } = await f({ op: "add", name: "Bandits (test)" });
    await f({ op: "assign", tokenIds: [bandit.id], faction: id });
    const state = await f({ tokenIds: [bandit.id, zombi.id, guerrier.id] });
    ctx.expect(state.tokens[0].faction === id && state.tokens[1].faction === "undead" && state.tokens[2].faction === "party",
      `factions : ${state.tokens.map(t => `${t.name} = ${t.faction}`).join(", ")}`);
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "allied", "faction posée sans relation : toujours la disposition");
    await f({ op: "relation", a: id, b: "undead", relation: "hostile" });
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "hostile", "matrice bandits ↔ morts-vivants hostile : ennemis");
    ctx.expect(await threatened(), "le Zombi menace maintenant le Bandit qui s'éloigne (attaque d'opportunité)");
    ctx.expect((await f({ op: "between", aId: guerrier.id, bId: zombi.id })).relation === pc, `Guerrier ↔ Zombi inchangé (${pc})`);

    // 3. Neutres ; le Bandit frappe le Zombi : rancune, ils redeviennent hostiles sur cette scène.
    await f({ op: "relation", a: id, b: "undead", relation: "neutral" });
    ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "neutral", "matrice neutre : neutres");
    ctx.expect(!(await threatened()), "neutres : pas d'attaque d'opportunité");
    const used = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [zombi.id] }).catch(err => ({ error: err.message }));
    if ( used.used ) {
      await ctx.settle(used.usageMessageId).catch(() => null);
      let grudges = [];
      for ( let i = 0; (i < 20) && !grudges.length; i++ ) { await pause(300); grudges = (await f({ op: "grudges" })).grudges; }
      ctx.expect(grudges.some(g => g.includes(id) && g.includes("undead")), `rancune notée : ${JSON.stringify(grudges)}`);
      ctx.expect((await f({ op: "between", aId: bandit.id, bId: zombi.id })).relation === "hostile", "après l'attaque : hostiles (rancune)");
      await f({ op: "grudges", clear: true });
    }
    else ctx.log(`attaque du Bandit impossible (${used.error ?? "pas d'activité scimitar"}) : rancune non vérifiée`);

    // 4. Relation explicite avec les PJ : la disposition du Bandit suit.
    await f({ op: "relation", a: id, b: "party", relation: "neutral" });
    await pause(500);
    const after = await f({ tokenIds: [bandit.id] });
    ctx.expect(after.tokens[0].disposition === 0, `bandits ↔ PJ neutres : disposition du Bandit ${after.tokens[0].disposition} (attendu 0)`);
    ctx.expect((await f({ op: "between", aId: guerrier.id, bId: bandit.id })).relation === "neutral", "Guerrier ↔ Bandit neutres");
  }
};
