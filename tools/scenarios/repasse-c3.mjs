/**
 * §298, lot C3 de la repasse terme par terme : coût d'action et budget du tour. Arène des sorts (Héros : Barbarien pré-tiré, Lanceur,
 * Cible). Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Magie de guerre : le Héros (Attaque supplémentaire) attaque, puis lance Trait de feu (tour de magie de Magicien) — compté comme
 *    la seconde attaque de l'action Attaquer, pas comme une seconde action ;
 *  - Arme sacrée : l'utilisation ne coûte pas l'action du Héros ;
 * Le Pacte de la chaîne (même mécanisme, `usageLimits.cost`) n'est pas joué : Appel de familier ouvre le navigateur de compendium et
 * attend la pose de l'invocation. Le Contresort qui fait perdre l'action est joué par le scénario `contresort`.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c3 — coût d'action : Magie de guerre, Arme sacrée (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Héros", "Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [hero, caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [hero, caster, target];
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await unlend();
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const settled = async used => (used?.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 40000 }).catch(() => null) : null);
    const combatOf = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const startFight = async order => {
      await ctx.startCombat(order);
      const c = await combatOf();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; i < 6; i++ ) {
        const now = await combatOf();
        if ( now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId === order[0].id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
      await pause(1500);
    };
    const budget = t => ctx.engine("budget", { tokenId: t.id });

    await part("Magie de guerre", async () => {
      await lend(hero, `${PHB}.classes.Item.phbbrbExtraAttac`);
      await lend(hero, `${PHB}.classes.Item.phbftrWarMagic00`);
      const bolt = await lend(hero, `${PHB}.spells.Item.phbsplFireBolt00`, { "system.method": "atwill", "system.sourceItem": "class:wizard" });
      const actor = await ctx.call("get-actor", { actorId: hero.actorId });
      const weapon = (actor.items ?? []).find(i => (i.type === "weapon") && i.system?.equipped && (i.system?.type?.value !== "natural"));
      if ( !ctx.expect(!!weapon, `une arme équipée (${weapon?.name ?? "aucune"})`) ) return;
      const p = await ctx.position(target);
      await ctx.call("move-token", { tokenId: hero.id, x: p.x - grid, y: p.y, elevation: 0 }); await pause(800);
      await startFight([hero, target]);
      await settled(await ctx.use({ tokenId: hero.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [target.id] }));
      await pause(1500);
      const mid = await budget(hero);
      ctx.expect(mid?.attacks?.granted === 2 && mid?.attacks?.used === 1, `l'action Attaquer ouvre deux attaques, une faite (${JSON.stringify(mid?.attacks)})`);
      const issues = await ctx.engine("issues", { tokenId: hero.id, itemId: bolt }).catch(() => null);
      ctx.expect(!JSON.stringify(issues ?? "").includes("noAction"), `Trait de feu dans l'action Attaquer : pas « plus d'action » (${JSON.stringify(issues)})`);
      await settled(await ctx.use({ tokenId: hero.id, itemId: bolt, activityType: "attack", targetTokenIds: [target.id] }));
      await pause(1500);
      const after = await budget(hero);
      ctx.expect(after?.attacks?.used === 2 && after?.bonus === mid?.bonus, `Trait de feu compte comme la seconde attaque (${JSON.stringify(after?.attacks)}, action Bonus ${after?.bonus})`);
    });

    await part("Arme sacrée", async () => {
      await lend(hero, `${PHB}.classes.Item.phbpdnChannelDiv`, { "system.uses.max": "9", "system.uses.spent": 0 });
      const item = await lend(hero, `${PHB}.classes.Item.phbpdnSacredWeap`);
      await startFight([hero, target]);
      const before = await budget(hero);
      await settled(await ctx.use({ tokenId: hero.id, itemId: item, activityId: "Ew70lNTD8dR3vREt", targetTokenIds: [hero.id] }));
      await pause(1500);
      const after = await budget(hero);
      ctx.expect(before?.action === 1 && after?.action === 1, `Arme sacrée : l'action reste (${before?.action} → ${after?.action})`);
    });
  }
};
