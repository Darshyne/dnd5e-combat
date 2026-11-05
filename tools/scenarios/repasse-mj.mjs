/**
 * §366 : repasse des parts laissées au MJ. Arène de test (Magicien, Bandit, Zombi).
 *  1. Amitié (`breaksOnOrigin`) : le Bandit charmé par le Magicien, puis le Magicien attaque le Zombi (Rayon de givre) → le
 *     Bandit n'est plus charmé.
 *  2. Le Bouffon : le Magicien tire la carte (effet de 72 h), puis Rayon de givre → Avantage déclaré par le contenu.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse MJ — Amitié rompue par le lanceur, Avantage aux attaques du Bouffon",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Bandit", "Zombi"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, bandit, zombi] = await Promise.all(names.map(n => ctx.token(n)));
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.removeEffectsNamed(bandit, /Charm/i).catch(() => {}));
    ctx.restore(() => ctx.removeEffectsNamed(mage, /Jester/i).catch(() => {}));

    const rayOfFrost = async () => {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId);
      const messages = await ctx.messagesSince(used.usageMessageId);
      const flags = messages.find(m => m.type === "attack")?.flags ?? {};
      return flags[MODULE_ID]?.modifiers ?? { advantage: [], disadvantage: [] };
    };
    const charmed = async () => (await ctx.effects(bandit)).some(e => (e.statuses ?? []).includes("charmed"));

    // 1. Amitié
    const friends = await ctx.ensureItem(mage, `${PHB}phbsplFriends000`, { system: { method: "atwill" } });
    for ( let n = 1; (n <= 20) && !(await charmed()); n++ ) {
      const cast = await ctx.use({ tokenId: mage.id, itemId: friends, targetTokenIds: [bandit.id], consume: false });
      await ctx.settle(cast.usageMessageId);
      await pause(800);
    }
    ctx.expect(await charmed(), "Amitié : le Bandit charmé");
    await rayOfFrost();
    await pause(2500);
    ctx.expect(!(await charmed()), "Amitié : le Magicien attaque — le Bandit n'est plus charmé");

    // 2. Le Bouffon
    const jester = await ctx.ensureItem(mage, `${DMG}dmgDmtJester0000`);
    const drawn = await ctx.use({ tokenId: mage.id, itemId: jester, activityId: "6WJ08JWazu3OZign", consume: false, targetTokenIds: [] });
    await ctx.settle(drawn.usageMessageId).catch(() => {});
    await pause(1500);
    ctx.expect((await ctx.effects(mage)).some(e => /Jester/i.test(e.name ?? "")), "Bouffon : l'effet de 72 h sur le Magicien");
    const m = await rayOfFrost();
    const adv = (m.advantage ?? []).map(r => `${r.who}.${r.key}`);
    ctx.expect((m.advantage ?? []).some(r => r.who === "content"), `Bouffon : Avantage au jet d'attaque (${adv.join(", ") || "aucun"})`);
  }
};
