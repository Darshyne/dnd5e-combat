/**
 * §334, restes de la repasse des créatures. Arène des sorts : le Lanceur (PNJ) et l'« Ennemi au contact ».
 *  - Esquive de la Bête éclipsante (`avoidance`) prêtée au Lanceur : l'Ennemi lui lance le Rocher du Singe géant (sauvegarde de
 *    Dextérité, moitié des dégâts) ; une réussite n'inflige rien, un échec la moitié.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k1d — Esquive : rien sur une réussite (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const casterHp = await ctx.hp(caster);
    const lent = [];
    const lend = async (token, uuid) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([token.actorId, r.id]);
      return r.id;
    };
    ctx.restore(async () => {
      await ctx.call("set-status", { tokenId: caster.id, statusId: "prone", active: false }).catch(() => {});
      await ctx.setHp(caster, casterHp).catch(() => {});
      for ( const [actorId, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    });
    await lend(caster, `${MM}.mmDisplacerBeast.Item.mmAvoidance00000`);
    const boulder = await lend(enemy, `${MM}.mmGiantApe000000.Item.mmBoulderToss000`);
    let saved = false;
    for ( let i = 0; (i < 20) && !saved; i++ ) {
      await ctx.setHp(caster, casterHp);
      await ctx.call("set-status", { tokenId: caster.id, statusId: "prone", active: false }).catch(() => {});
      await pause(400);
      const u = await ctx.use({ tokenId: enemy.id, itemId: boulder, activityType: "save", targetTokenIds: [caster.id], consume: false, rollDamage: true,
        area: { shape: "rectangle", ...(await ctx.box(caster)) } });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Lanceur")?.save?.success !== true ) continue;
      await pause(1500);
      const hp = await ctx.hp(caster);
      ctx.expect(hp === casterHp, `Esquive, réussite : aucun dégât (${casterHp} → ${hp})`);
      saved = true;
    }
    ctx.expect(saved, "le Lanceur réussit la sauvegarde du Rocher (20 essais au plus)");
  }
};
