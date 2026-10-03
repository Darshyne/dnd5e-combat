/**
 * M1 (SPEC §18.6) — Attaques multiples lues dans le texte anglais d'origine, sous Babele. Monde `ravenloft` : l'Ours brun
 * du Monster Manual (« makes one Bite attack and one Claw attack », traduit en français sur la fiche).
 * À son tour : la Morsure paie l'action et ouvre les Attaques multiples (1/2) ; la Griffe passe sans action (2/2) ; une
 * seconde Morsure ne tient plus dans le plan — la légalité la signale (le scénario la confirme d'office) et le plan ne
 * bouge pas.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Attaques multiples — Ours brun : une Morsure et une Griffe",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun ou Zombi absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const hp = await ctx.hp(zombi);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.setHp(zombi, hp));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "prone"));
    const at = await ctx.position(bear);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 2 * grid, y: at.y, elevation: at.elevation });

    await ctx.startCombat([bear, zombi]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === bear.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }
    const spentOn = async id => {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const m = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(x => x.id === id);
        const spent = m?.flags?.[MODULE_ID]?.spent ?? m?.flags?.spent;
        if ( spent ) return spent;
      }
      return null;
    };
    const strike = async identifier => {
      await ctx.setHp(zombi, 100);
      const used = await ctx.use({ tokenId: bear.id, identifier, activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      return spentOn(used.usageMessageId);
    };

    const bite = await strike("bite");
    ctx.expect(!!bite?.after?.multi, `Morsure : Attaques multiples ouvertes (${JSON.stringify(bite?.after?.multi?.plan?.options ?? null)})`);
    ctx.expect((bite?.before?.action === 1) && (bite?.after?.action === 0), `Morsure : l'action est payée (${bite?.before?.action} → ${bite?.after?.action})`);
    ctx.expect((bite?.after?.attacks?.used === 1) && (bite?.after?.attacks?.granted === 2), `attaques ${bite?.after?.attacks?.used}/${bite?.after?.attacks?.granted}`);

    const claw = await strike("claw");
    ctx.expect(claw?.after?.multi?.used?.length === 2, `Griffe : tient dans le plan (${claw?.after?.multi?.used?.length} utilisation(s))`);
    ctx.expect((claw?.after?.attacks?.used === 2), `attaques ${claw?.after?.attacks?.used}/${claw?.after?.attacks?.granted}`);

    const extra = await strike("bite");
    ctx.expect(extra?.after?.multi?.used?.length === 2, `seconde Morsure : hors du plan, qui reste à 2 utilisations (${extra?.after?.multi?.used?.length})`);
  }
};
