/**
 * Changer de taille (SPEC §16.58) : Agrandissement/rapetissement du Clerc (ajouté à volonté), sauvegarde de Constitution
 * rejouée jusqu'à l'échec.
 *  1. Agrandi, le Guerrier passe de Moyen à Grand ; dnd5e (réglage « Autosize ») écrit la taille sur le token : 1×1 → 2×2.
 *     L'effet retiré, il redevient Moyen et le token reprend 1×1.
 *  2. Rapetissé, le Zombi passe de Moyen à Petit (le token reste sur une case : dnd5e donne une case à une créature Petite).
 * Remet effets, PV et tailles.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ENLARGE = "Wi2E10l7n6Ka8k6u";
const REDUCE = "NXdtOxX4HvPeodml";

export default {
  name: "agrandissement — Agrandissement (token 2×2), Rapetissement, retour à la taille d'origine",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    await ctx.ensureItem(cleric, "Compendium.dnd5e.spells24.Item.phbsplEnlargeRed", { system: { method: "atwill" } });
    const pattern = /Agrandissement|Rapetissement|Enlarge|Reduce|concentr/i;
    const hp = new Map([[fighter.id, await ctx.hp(fighter)], [zombi.id, await ctx.hp(zombi)]]);
    const cleanup = async () => {
      for ( const t of [fighter, zombi, cleric] ) await ctx.removeEffectsNamed(t, pattern);
      for ( const t of [fighter, zombi] ) await ctx.setHp(t, hp.get(t.id));
      await pause(1500);
    };
    ctx.restore(cleanup);
    const stats = t => ctx.engine("stats", { tokenId: t.id });
    const dims = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return `${data.width}×${data.height}`;
    };
    /** Lancé jusqu'à une sauvegarde ratée ; rend true si l'effet choisi est posé. */
    const shrinkOrGrow = async (target, choice, name) => {
      for ( let n = 1; n <= 20; n++ ) {
        const used = await ctx.use({ tokenId: cleric.id, identifier: "enlarge-reduce", activityType: "save", consume: false,
          targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { choice } } });
        await ctx.settle(used.usageMessageId).catch(() => null);
        await pause(2500);
        if ( (await ctx.effects(target)).some(e => name.test(e.name ?? "")) ) return true;
        await ctx.removeEffectsNamed(cleric, /concentr/i);
      }
      return false;
    };

    // 1. Agrandissement.
    const before = { size: (await stats(fighter)).size, dims: await dims(fighter) };
    const grown = await shrinkOrGrow(fighter, ENLARGE, /Agrandissement|Enlarge/i);
    if ( !ctx.expect(grown, "Agrandissement posé sur le Guerrier (sauvegarde ratée, 20 essais au plus)") ) return;
    const after = { size: (await stats(fighter)).size, dims: await dims(fighter) };
    ctx.expect((before.size === "med") && (after.size === "lg"), `taille ${before.size} → ${after.size}`);
    ctx.expect((before.dims === "1×1") && (after.dims === "2×2"), `token ${before.dims} → ${after.dims}`);
    await ctx.removeEffectsNamed(fighter, /Agrandissement|Enlarge/i);
    await pause(2500);
    const back = { size: (await stats(fighter)).size, dims: await dims(fighter) };
    ctx.expect((back.size === before.size) && (back.dims === before.dims), `effet retiré : taille ${back.size}, token ${back.dims}`);
    await cleanup();

    // 2. Rapetissement.
    const zBefore = (await stats(zombi)).size;
    const shrunk = await shrinkOrGrow(zombi, REDUCE, /Rapetissement|Reduce/i);
    if ( !ctx.expect(shrunk, "Rapetissement posé sur le Zombi (sauvegarde ratée, 20 essais au plus)") ) return;
    const zAfter = (await stats(zombi)).size;
    ctx.expect((zBefore === "med") && (zAfter === "sm"), `Zombi : taille ${zBefore} → ${zAfter}`);
  }
};
