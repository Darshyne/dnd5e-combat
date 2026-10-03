/**
 * Ascendance féerique (SPEC §16.25, `saveAdvantage`) : avantage aux sauvegardes contre une activité qui charme. Monde
 * `ravenloft` : Kaalisti lance Suggestion (effet Charmé) sur Sylaene (elfe), qui sauvegarde avec l'avantage, puis sur Alara
 * (humaine), sans. Ailleurs : non applicable.
 */
export default {
  name: "avantage contre Charmé — Ascendance féerique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Sylaene", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara, Sylaene et Kaalisti absents : non applicable"); return; }
    const kaalisti = await ctx.token("Kaalisti");
    const modeOn = async target => {
      const used = await ctx.use({ tokenId: kaalisti.id, identifier: "suggestion", activityType: "save", consume: false, targetTokenIds: [target.id] });
      await ctx.settle(used.usageMessageId);
      const save = (await ctx.messagesSince(used.usageMessageId)).find(m => (m.type === "save") && (m.alias === target.name));
      const raw = save?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return { found: !!save, mode: roll?.options?.advantageMode ?? null, formula: roll?.formula ?? "" };
    };
    const sy = await modeOn(await ctx.token("Sylaene"));
    ctx.expect(sy.found && (sy.mode === 1), `Sylaene sauvegarde avec l'avantage (${sy.formula}, mode ${sy.mode})`);
    const al = await modeOn(await ctx.token("Alara"));
    ctx.expect(al.found && (al.mode !== 1), `Alara sans avantage (${al.formula}, mode ${al.mode})`);
  }
};
