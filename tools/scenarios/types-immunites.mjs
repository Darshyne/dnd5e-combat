/**
 * Types de créature et immunités (SPEC §16.8), sur le Zombi : mort-vivant, immunisé contre Épuisement et Empoisonné.
 *  1. Immobilisation de personne (« un Humanoïde ») : non affecté, type — aucune sauvegarde, rien de posé.
 *  2. Sommeil (« immunité à l'Épuisement : réussite automatique ») : non affecté, règle du contenu.
 *  3. Rayon empoisonné (attaque, dégâts de poison ET Empoisonné) : les dégâts passent par le système (immunité au
 *     poison de la fiche comprise), mais l'effet Empoisonné n'est pas posé — immunité à l'état.
 * Les sorts sont donnés au Magicien le temps du scénario.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "types et immunités — pas un humanoïde, immunisé contre l'Épuisement, contre Empoisonné",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(async () => { for ( const s of ["paralyzed", "incapacitated", "poisoned"] ) await ctx.removeStatusEffects(zombi, s); });
    ctx.restore(() => ctx.removeStatusEffects(mage, "concentrating"));
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplHoldPerson");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplSleep00000");
    await ctx.ensureItem(mage, "Compendium.dnd5e.spells24.Item.phbsplRayofSickn");
    const statuses = async () => (await ctx.effects(zombi)).flatMap(e => e.statuses ?? []);

    // 1. Pas un humanoïde.
    const hold = await ctx.use({ tokenId: mage.id, identifier: "hold-person", activityType: "save", targetTokenIds: [zombi.id] });
    const r1 = await ctx.settle(hold.usageMessageId);
    const t1 = r1.targets.find(t => t.name === "Zombi");
    ctx.expect(t1?.unaffected?.reason === "type", `Immobilisation de personne : Zombi non affecté (${JSON.stringify(t1?.unaffected ?? null)})`);
    ctx.expect(!t1?.save, "aucune sauvegarde demandée au Zombi");
    await pause(800);
    ctx.expect(!(await statuses()).includes("paralyzed"), "le Zombi n'est pas Paralysé");
    await ctx.removeStatusEffects(mage, "concentrating");

    // 2. Immunisé contre l'Épuisement : Sommeil ne l'atteint pas (zone réduite à sa case).
    const box = await ctx.box(zombi);
    const sleep = await ctx.use({ tokenId: mage.id, identifier: "sleep", activityType: "save", area: { shape: "rectangle", ...box } });
    const r2 = await ctx.settle(sleep.usageMessageId);
    const t2 = r2.targets.find(t => t.name === "Zombi");
    ctx.expect(t2?.unaffected?.reason === "content", `Sommeil : Zombi non affecté (${JSON.stringify(t2?.unaffected ?? null)})`);
    ctx.expect(!t2?.save, "aucune sauvegarde demandée au Zombi");
    await pause(800);
    ctx.expect(!(await statuses()).includes("incapacitated"), "le Zombi n'est pas Neutralisé");
    await ctx.removeStatusEffects(mage, "concentrating");

    // 3. Immunisé contre Empoisonné : Rayon empoisonné, rejoué jusqu'à toucher.
    let hit = null;
    for ( let i = 0; i < 20 && !hit; i++ ) {
      await ctx.setHp(zombi, hp0);
      const used = await ctx.use({ tokenId: mage.id, identifier: "ray-of-sickness", activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.name === "Zombi");
      if ( t?.hit ) hit = { r, t };
    }
    if ( !ctx.expect(!!hit, "Rayon empoisonné : touché (20 essais au plus)") ) return;
    await pause(1500);
    ctx.expect(!hit.t.unaffected, "des dégâts : la cible reste affectée par l'action");
    ctx.expect((hit.t.effects ?? []).length === 0, `aucun effet posé (${(hit.t.effects ?? []).length})`);
    ctx.expect(!(await statuses()).includes("poisoned"), "le Zombi n'est pas Empoisonné");
    ctx.log(`dégâts de poison appliqués au Zombi (immunité de la fiche comprise) : ${hit.t.damage?.applied ?? "aucun"}`);
  }
};
