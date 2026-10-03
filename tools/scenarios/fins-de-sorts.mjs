/**
 * Fins de sorts (SPEC §42.2), avec les sorts du **Manuel des joueurs** (ceux des fiches de joueurs — leurs identifiants ne sont
 * pas toujours ceux du SRD : « tashas-hideous-laughter »).
 *  1. Fou rire de Tasha (PHB) : la sauvegarde est rejouée quand la cible subit des dégâts.
 *  2. Lenteur : la sauvegarde est rejouée à la fin de chaque tour de la cible ; réussie, l'effet tombe.
 *  3. Sanctuaire : le sort cesse quand la créature protégée fait un jet d'attaque.
 * Pose la distribution de référence de Restored Keep. Remet PV, effets, positions ; retire les sorts prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "fins de sorts — Fou rire de Tasha (PHB), Lenteur, Sanctuaire",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Clerc ou Zombi absent : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.spells") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const clerc = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    const effects0 = new Map();
    for ( const t of [mage, clerc, zombi] ) effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const endConcentration = () => ctx.removeStatusEffects(mage, "concentrating");
    const clearZombi = async () => { for ( const s of ["incapacitated", "prone"] ) await ctx.removeStatusEffects(zombi, s); await ctx.removeEffectsNamed(zombi, /Laughter|Fou rire|Slowed|Ralenti|Lent/i); };
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(clearZombi);
    ctx.restore(endConcentration);
    ctx.restore(() => ctx.removeEffectsNamed(clerc, /Warded|Protégé|Sanctua/i));

    const laughter = await ctx.ensureItem(mage, `${SPELLS}.phbsplTashasHide`);
    const slow = await ctx.ensureItem(mage, `${SPELLS}.phbsplSlow000000`);
    const sanctuary = await ctx.ensureItem(clerc, `${SPELLS}.phbSanctuary0000`);
    const newEffects = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id));

    /** Lance le sort sur le Zombi jusqu'à ce qu'il rate sa sauvegarde ; rend la résolution, ou null. */
    const until = async (itemId, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await endConcentration();
        await clearZombi();
        await pause(600);
        const used = await ctx.use({ tokenId: mage.id, itemId, activityType: "save", ...extra });
        const r = await ctx.settle(used.usageMessageId);
        if ( r.targets.find(t => t.name === "Zombi")?.save?.success === false ) { await pause(1200); return r; }
      }
      return null;
    };

    // 1. Fou rire de Tasha, celui du Manuel des joueurs : rejoué sur dégâts.
    const hl = await until(laughter, { targetTokenIds: [zombi.id] });
    if ( ctx.expect(!!hl, "Fou rire de Tasha (PHB) : le Zombi rate sa sauvegarde (20 essais au plus)") ) {
      const since = await ctx.lastMessageId();
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 1 });
      await pause(3000);
      const resave = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.resave?.moment === "isDamaged");
      ctx.expect(!!resave, "blessé, le Zombi rejoue sa sauvegarde (message « resave », moment isDamaged)");
      if ( resave ) await ctx.settle(resave.id).catch(() => null);
    }
    await endConcentration();
    await clearZombi();
    await ctx.setHp(zombi, hp0);

    // 2. Lenteur : rejouée à la fin de chaque tour de la cible.
    const box = await ctx.box(zombi);
    const sl = await until(slow, { targetTokenIds: [zombi.id], area: { shape: "rectangle", ...box } });
    if ( ctx.expect(!!sl, "Lenteur : le Zombi rate sa sauvegarde (20 essais au plus)") ) {
      const slowed = async () => (await newEffects(zombi)).length > 0;
      ctx.expect(await slowed(), "le Zombi porte l'effet de Lenteur");
      await ctx.startCombat([mage, zombi]);
      const since = sl.origin;
      let resaves = 0;
      let removed = false;
      let last = null;
      for ( let turn = 0; (turn < 24) && !removed; turn++ ) {
        await ctx.nextTurn();
        await pause(2500);
        const resave = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave).at(-1);
        if ( !resave || (resave.id === last) ) continue;
        last = resave.id;
        const r = await ctx.settle(resave.id).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( !t?.save ) continue;
        resaves++;
        await pause(800);
        const still = await slowed();
        if ( t.save.success ) { ctx.expect(!still, `fin de tour, sauvegarde réussie (${t.save.total}) : la Lenteur tombe`); removed = !still; }
        else ctx.expect(still, `fin de tour, sauvegarde ratée (${t.save.total}) : la Lenteur reste`);
      }
      ctx.expect(resaves > 0, `au moins une sauvegarde rejouée en fin de tour (${resaves})`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    }
    await endConcentration();
    await clearZombi();

    // 3. Sanctuaire : cesse quand la créature protégée fait un jet d'attaque.
    const z = await ctx.position(zombi);
    await ctx.call("move-token", { tokenId: clerc.id, x: z.x + grid, y: z.y, elevation: 0 });
    await pause(800);
    const cast = await ctx.use({ tokenId: clerc.id, itemId: sanctuary, activityType: "utility", targetTokenIds: [clerc.id] });
    if ( cast.usageMessageId ) await ctx.settle(cast.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(1500);
    const warded = async () => (await newEffects(clerc)).some(e => /Warded|Protégé|Sanctua/i.test(e.name ?? ""));
    if ( ctx.expect(await warded(), "Sanctuaire : le Clerc porte l'effet du sort") ) {
      const attack = await ctx.use({ tokenId: clerc.id, identifier: "mace", activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(attack.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      ctx.expect(!(await warded()), "le Clerc fait un jet d'attaque : le Sanctuaire cesse");
    }
  }
};
