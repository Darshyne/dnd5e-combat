/**
 * Brique B8 « effet qui cesse sur dégâts » et B4 sur dégâts (SPEC §16.7), portées par l'effet posé sur le Zombi :
 *  1. Motif hypnotique (spells24, donné au Magicien le temps du scénario), zone réduite à la case du Zombi, rejoué
 *     jusqu'à un échec : le Zombi est Charmé et Neutralisé. Un Rayon de givre qui le touche → l'effet cesse, carte
 *     « cesse » (`flags["dnd5e-combat"].ended`).
 *  2. Fou rire de Tasha, rejoué jusqu'à un échec (Neutralisé, À terre). Un Rayon de givre qui le touche → il rejoue
 *     sa sauvegarde (message `resave`, moment `isDamaged`) ; l'effet reste sur un échec, tombe sur une réussite.
 * Le Magicien est concentré sur l'un puis l'autre : la concentration est rompue entre les deux et à la fin.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "fin sur dégâts — Motif hypnotique cesse, Fou rire rejoue sa sauvegarde",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const endConcentration = () => ctx.removeStatusEffects(mage, "concentrating");
    const clearZombi = async () => { for ( const s of ["charmed", "incapacitated", "prone"] ) await ctx.removeStatusEffects(zombi, s); };
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(clearZombi);
    ctx.restore(endConcentration);
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplHypnoticPa");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplTashasHide");
    const statusesOf = async () => (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);

    /** Lance le sort jusqu'à ce que le Zombi rate sa sauvegarde ; rend la résolution, ou null. */
    const until = async (identifier, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await endConcentration();
        await clearZombi();
        await pause(600);
        const used = await ctx.use({ tokenId: mage.id, identifier, activityType: "save", ...extra });
        const r = await ctx.settle(used.usageMessageId);
        const target = r.targets.find(t => t.name === "Zombi");
        if ( target?.save?.success === false ) { await pause(1200); return r; }
      }
      return null;
    };

    /** Rayon de givre jusqu'à toucher le Zombi ; rend le message d'avant le tir (pour lire ce qui a suivi). */
    const hurt = async () => {
      for ( let i = 0; i < 20; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId);
        if ( r.targets.find(t => t.name === "Zombi")?.hit ) { await pause(2000); return since; }
      }
      return null;
    };

    // 1. Motif hypnotique : cesse sur dégâts.
    const box = await ctx.box(zombi);
    const hp = await until("hypnotic-pattern", { area: { shape: "rectangle", ...box } });
    if ( !ctx.expect(!!hp, "Motif hypnotique : le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
    const before = await statusesOf();
    ctx.expect(before.includes("charmed") && before.includes("incapacitated"), `Zombi Charmé et Neutralisé (${before.join(", ")})`);
    const since = await hurt();
    if ( !ctx.expect(!!since, "le Rayon de givre touche le Zombi (20 essais au plus)") ) return;
    const after = await statusesOf();
    ctx.expect(!after.includes("charmed"), `blessé, le Zombi n'est plus charmé (${after.join(", ") || "aucun état"})`);
    const ended = (await ctx.messagesSince(since)).find(m => m.flags?.["dnd5e-combat"]?.ended);
    ctx.expect(!!ended, `le chat dit que le sort cesse (${ended ? "carte « cesse »" : "aucune carte"})`);

    // 2. Fou rire de Tasha : sauvegarde rejouée sur dégâts.
    const hl = await until("hideous-laughter", { targetTokenIds: [zombi.id] });
    if ( !ctx.expect(!!hl, "Fou rire : le Zombi rate sa sauvegarde (20 essais au plus)") ) return;
    ctx.expect((await statusesOf()).includes("incapacitated"), "Zombi Neutralisé par le Fou rire");
    const since2 = await hurt();
    if ( !ctx.expect(!!since2, "le Rayon de givre touche le Zombi (20 essais au plus)") ) return;
    const resave = (await ctx.messagesSince(since2)).find(m => m.flags?.["dnd5e-combat"]?.resave?.moment === "isDamaged");
    if ( !ctx.expect(!!resave, "blessé, le Zombi rejoue sa sauvegarde (message « resave », moment isDamaged)") ) return;
    const r = await ctx.settle(resave.id);
    const saved = r.targets.find(t => t.name === "Zombi")?.save?.success;
    await pause(1500);
    const still = (await statusesOf()).includes("incapacitated");
    ctx.expect(saved === !still, `sauvegarde ${saved ? "réussie : le Fou rire tombe" : "ratée : le Fou rire reste"} (Neutralisé : ${still})`);
  }
};
