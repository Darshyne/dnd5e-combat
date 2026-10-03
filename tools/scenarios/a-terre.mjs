/**
 * L'état obligatoire à 0 PV (SPEC §17.1), **hors combat** (le système, lui, ne le pose qu'en combat) :
 *  1. un PNJ ordinaire (le Zombi) mis à 0 PV reçoit Mort ;
 *  2. un PJ (le Guerrier dans `dnd-6`, Bramo dans `ravenloft`) mis à 0 PV reçoit Inconscient et À terre ;
 *  3. ses PV remontent : Inconscient tombe (À terre reste, comme le veut la règle).
 * Remis en état : PV, compteurs, états.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const DOWNED = ["unconscious", "incapacitated", "prone", "dead", "stable", "bloodied"];

export default {
  name: "à terre — Mort / Inconscient à 0 PV, même hors combat",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = tokens.map(t => t.name);
    const npcName = ["Zombi"].find(n => names.includes(n));
    const pcName = ["Guerrier", "Bramo"].find(n => names.includes(n));
    if ( !npcName || !pcName ) { ctx.log("Zombi ou PJ (Guerrier, Bramo) absent : non applicable"); return; }
    const npc = await ctx.token(npcName);
    const pc = await ctx.token(pcName);
    const statusesOf = async token => (await ctx.effects(token)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const waitFor = async (token, test) => {
      for ( let i = 0; i < 20; i++ ) { const s = await statusesOf(token); if ( test(s) ) return s; await pause(250); }
      return statusesOf(token);
    };

    for ( const token of [npc, pc] ) {
      const hp0 = await ctx.hp(token);
      ctx.restore(async () => {
        await ctx.setHp(token, hp0);
        await pause(500);
        for ( const s of DOWNED ) await ctx.removeStatusEffects(token, s);
      });
    }
    ctx.restore(() => ctx.call("update-actor", { actorId: pc.actorId, actorData: {
      "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }));

    // 1. PNJ ordinaire.
    await ctx.setHp(npc, 0);
    const npcStatuses = await waitFor(npc, s => s.includes("dead"));
    ctx.expect(npcStatuses.includes("dead"), `${npc.name} à 0 PV : Mort (${npcStatuses.join(", ")})`);

    // 2. PJ.
    const hpPc = await ctx.hp(pc);
    await ctx.setHp(pc, 0);
    const pcStatuses = await waitFor(pc, s => s.includes("unconscious") && s.includes("prone"));
    ctx.expect(pcStatuses.includes("unconscious") && pcStatuses.includes("prone"),
      `${pc.name} à 0 PV : Inconscient et À terre (${pcStatuses.join(", ")})`);
    ctx.expect(!pcStatuses.includes("dead"), `${pc.name} n'est pas mort`);

    // 3. Les PV remontent.
    await ctx.setHp(pc, hpPc);
    const after = await waitFor(pc, s => !s.includes("unconscious"));
    ctx.expect(!after.includes("unconscious"), `${pc.name} soigné : plus Inconscient (${after.join(", ") || "aucun état"})`);
  }
};
