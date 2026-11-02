/**
 * §329, lot K8 de la repasse des créatures : poussées et tractions lues dans le texte des monstres (`monsterPushes`). Arène des sorts : le
 * Lanceur (PNJ) et la Cible.
 *  - Lancer de marteau du Géant du feu : au toucher, la Cible est repoussée de 15 ft (3 cases) ;
 *  - Tourbillon de l'Élémentaire de l'air : sur un échec, repoussée de 20 ft (4 cases).
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
  name: "repasse-k8 — poussées des monstres lues dans le texte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, target] ) homes.set(t.id, await ctx.position(t));
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const place = async () => {
      // Deux rangées plus bas que la Cible : rien à l'est pour arrêter la poussée.
      const t0 = { x: homes.get(target.id).x, y: homes.get(target.id).y + 2 * grid };
      await ctx.call("move-token", { tokenId: caster.id, x: t0.x - grid, y: t0.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: target.id, x: t0.x, y: t0.y, elevation: 0 });
      await pause(800);
      return t0;
    };
    ctx.restore(async () => {
      for ( const t of [caster, target] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
    });
    const cells = async t0 => { const p = await ctx.position(target); return Math.round(Math.hypot(p.x - t0.x, p.y - t0.y) / grid); };

    const hammer = await lend(`${MM}.mmFireGiant00000.Item.mmHammerThrow000`);
    let checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      const t0 = await place();
      const u = await ctx.use({ tokenId: caster.id, itemId: hammer, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.hit !== true ) continue;
      await pause(2500);
      const n = await cells(t0);
      ctx.expect(n === 3, `Lancer de marteau, touché : la Cible recule de ${n} case(s) (3 attendues)`);
      checked = true;
    }
    ctx.expect(checked, "le Lancer de marteau touche (20 essais au plus)");

    const whirl = await lend(`${MM}.mmAirElemental00.Item.mmWhirlwind00000`);
    checked = false;
    for ( let i = 0; (i < 20) && !checked; i++ ) {
      const t0 = await place();
      const u = await ctx.use({ tokenId: caster.id, itemId: whirl, activityType: "save", targetTokenIds: [target.id], consume: false });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
      await pause(2500);
      const n = await cells(t0);
      ctx.expect(n === 4, `Tourbillon, échec : la Cible recule de ${n} case(s) (4 attendues)`);
      checked = true;
    }
    ctx.expect(checked, "la Cible rate la sauvegarde du Tourbillon (20 essais au plus)");
  }
};
