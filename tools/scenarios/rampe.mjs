/**
 * À terre (SPEC §17.2) : un PJ (Guerrier dans `dnd-6`, Bramo dans `ravenloft`) mis À terre passe en mode ramper
 * (`movementAction: "crawl"` sur son token : coût double, mesuré par dnd5e) ; l'état retiré, il retrouve son mode d'avant.
 * Se relever demande un clic (menu) : hors scénario.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "rampe — À terre : mode ramper posé et retiré",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const name = ["Guerrier", "Bramo"].find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log("Guerrier ou Bramo absent : non applicable"); return; }
    const pc = await ctx.token(name);
    const actionOf = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: pc.id })).data.movementAction ?? null;
    const waitFor = async test => {
      for ( let i = 0; i < 20; i++ ) { const a = await actionOf(); if ( test(a) ) return a; await pause(250); }
      return actionOf();
    };
    const before = await actionOf();
    ctx.restore(() => ctx.removeStatusEffects(pc, "prone"));

    await ctx.call("set-status", { tokenId: pc.id, statusId: "prone", active: true });
    const crawling = await waitFor(a => a === "crawl");
    ctx.expect(crawling === "crawl", `${pc.name} À terre : mode ${crawling}`);

    await ctx.removeStatusEffects(pc, "prone");
    const after = await waitFor(a => a !== "crawl");
    ctx.expect(after === before, `${pc.name} debout : mode rendu (${after ?? "par défaut"}, avant : ${before ?? "par défaut"})`);
  }
};
