/**
 * Protection contre la mort (§73, Manuel des joueurs 2024) : « la première fois que la cible devrait tomber à 0 point de vie avant la
 * fin du sort, elle tombe à 1 point de vie à la place, et le sort prend fin ».
 *  - un personnage joueur de la scène reçoit le sort (compendium du Manuel des joueurs, sans emplacement) et le lance sur lui ;
 *  - à 5 PV, 12 dégâts : il reste à 1 PV, l'effet du sort est retiré, aucun état de mort ;
 *  - de nouveau 12 dégâts : la règle ordinaire (0 PV, Inconscient).
 * Le filet de sécurité remet PV, effets et items.
 */
const SPELL = "Compendium.dnd-players-handbook.spells.Item.phbsplDeathWard0";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "protection contre la mort — à 1 PV au lieu de 0, puis le sort prend fin",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    let pcRef = null;
    for ( const t of tokens ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( a?.type === "character" ) { pcRef = t; break; }
    }
    if ( !pcRef ) { ctx.log("aucun personnage joueur sur la scène : non applicable"); return; }
    const pc = await ctx.token(pcRef.name);
    const itemId = await ctx.ensureItem(pc, SPELL, { system: { method: "atwill" } });
    const ward = () => ctx.effects(pc).then(list => list.filter(e => /Protection contre la mort|Death Ward/i.test(e.name ?? "")));

    const used = await ctx.use({ tokenId: pc.id, itemId, targetTokenIds: [pc.id], usageConfig: { "dnd5e-combat": { autoReact: "none" } } });
    ctx.expect(used.used, "Protection contre la mort lancée sur lui-même");
    await sleep(2500);
    ctx.expect((await ward()).length === 1, `l'effet du sort est posé (${(await ctx.effects(pc)).map(e => e.name).join(", ")})`);

    await ctx.setHp(pc, 5);
    const first = (await ctx.engine("hurt", { tokenId: pc.id, amount: 12 })).result ?? null;
    await sleep(2500);
    const hp1 = await ctx.hp(pc);
    ctx.expect(hp1 === 1, `12 dégâts à 5 PV : il reste à 1 PV (${hp1})`);
    ctx.expect((await ward()).length === 0, "le sort prend fin (effet retiré)");
    const statuses = new Set((await ctx.effects(pc)).flatMap(e => e.statuses ?? []));
    ctx.expect(!statuses.has("unconscious") && !statuses.has("dead"), `ni Inconscient ni Mort (${[...statuses].join(", ") || "aucun état"})`);

    await ctx.engine("hurt", { tokenId: pc.id, amount: 12 });
    await sleep(2500);
    const hp2 = await ctx.hp(pc);
    const after = new Set((await ctx.effects(pc)).flatMap(e => e.statuses ?? []));
    ctx.expect((hp2 === 0) && after.has("unconscious"), `sans le sort, 12 dégâts de plus : 0 PV, Inconscient (${hp2} PV, ${[...after].join(", ")})`);
    ctx.log(first ? `dégâts : ${JSON.stringify(first)}` : "");
  }
};
