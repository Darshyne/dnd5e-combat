/**
 * Vision simulée (P1) : les faits « qui voit qui » posent l'avantage ou le désavantage du jet.
 * Ensorceleur et Zombi à découvert : rien. Zombi Invisible (l'Ensorceleur n'a pas de vision
 * aveugle) : « cible non vue » → désavantage, et le Zombi voit toujours l'Ensorceleur. Zombi
 * Aveuglé : « attaquant non vu » → avantage. Les états sont retirés en fin de scénario.
 */
const MODULE_ID = "dnd5e-combat";

export default {
  name: "vision — non vu, invisible, aveuglé",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const status = (id, active) => ctx.call("set-status", { tokenId: zombi.id, statusId: id, active });
    ctx.restore(() => status("invisible", false));
    ctx.restore(() => status("blinded", false));

    async function shoot(label) {
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const mods = attack?.flags?.[MODULE_ID]?.modifiers ?? { advantage: [], disadvantage: [] };
      const list = side => (mods[side] ?? []).map(r => `${r.who}.${r.key}`);
      ctx.log(`${label} : avantage [${list("advantage").join(", ")}] désavantage [${list("disadvantage").join(", ")}]`);
      return { advantage: list("advantage"), disadvantage: list("disadvantage") };
    }

    const open = await shoot("à découvert");
    ctx.expect(!open.advantage.includes("attacker.unseen") && !open.disadvantage.includes("target.unseen"),
      "à découvert : ni « attaquant non vu » ni « cible non vue »");

    await status("invisible", true);
    const invisible = await shoot("Zombi invisible");
    ctx.expect(invisible.disadvantage.includes("target.unseen"), "Zombi invisible : « cible non vue de l'attaquant » → désavantage");
    ctx.expect(!invisible.disadvantage.includes("target.invisible"), "l'état Invisible ne compte plus par lui-même (la vision le juge)");
    ctx.expect(!invisible.advantage.includes("attacker.unseen"), "le Zombi invisible voit toujours l'Ensorceleur : pas d'avantage");
    await status("invisible", false);

    await status("blinded", true);
    const blinded = await shoot("Zombi aveuglé");
    ctx.expect(blinded.advantage.includes("attacker.unseen"), "Zombi aveuglé : « attaquant non vu de la cible » → avantage");
    ctx.expect(!blinded.advantage.includes("target.blinded"), "l'état Aveuglé ne compte plus par lui-même");
    await status("blinded", false);
  }
};
