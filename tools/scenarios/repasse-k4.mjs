/**
 * §325, lot K4 de la repasse des créatures : l'empoignade d'un monstre — l'allonge de la capacité qui agrippe et le DD d'évasion qu'elle
 * écrit (activité « Escape Check » du Monster Manual). Arène des sorts : le Lanceur (PNJ) reçoit des capacités prêtées, la Cible à 3 m.
 *  - Pince du Chuul (allonge 3 m) : la Cible agrippée à 3 m le reste (elle était relâchée aussitôt, portée des mains nues) ; DD d'évasion
 *    = Athlétisme passif du Lanceur, la formule de la donnée ;
 *  - Tentacule de l'Aboleth : DD d'évasion 14, celui de la donnée (et non 8 + For + maîtrise du Lanceur).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k4 — empoignade des monstres : allonge de la prise, DD d'évasion de la donnée (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const release = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      for ( const g of await ctx.engine("grappleState", { tokenId: target.id }).catch(() => []) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}`, effectId: g.effect }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      await release();
      await ctx.setHp(target, 999).catch(() => {});
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const t = await ctx.position(target);
    const grab = async (itemId, cells) => {
      await ctx.call("move-token", { tokenId: caster.id, x: t.x - cells * grid, y: t.y, elevation: 0 });
      await pause(800);
      for ( let i = 0; i < 20; i++ ) {
        await release();
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2500);
        if ( r?.targets?.find(x => x.name === "Cible")?.hit === true ) return ctx.engine("grappleState", { tokenId: target.id });
      }
      return null;
    };

    // Pince du Chuul, à 3 m.
    const pincer = await lend("Compendium.dnd-monster-manual.actors.Actor.mmChuul000000000.Item.mmPincer00000000");
    let state = await grab(pincer, 2);
    if ( ctx.expect(!!state, "la Pince touche la Cible à 3 m (20 essais au plus)") ) {
      const g = state[0];
      ctx.expect(!!g && g.withinReach === true, `la Cible reste agrippée à 3 m (allonge ${g?.reach?.value ?? "?"} ${g?.reach?.units ?? ""})`);
      const passive = (await ctx.call("get-actor", { actorId: caster.actorId, preparedPaths: ["system.skills.ath.passive"] }).catch(() => null))?.prepared?.["system.skills.ath.passive"] ?? null;
      ctx.log(`DD d'évasion ${g?.escapeDc}, Athlétisme passif du Lanceur ${passive}`);
      ctx.expect(Number.isFinite(g?.escapeDc) && ((passive === null) || (g.escapeDc === passive)), `DD d'évasion lu dans la donnée (${g?.escapeDc})`);
    }
    await release();
    // Tentacule de l'Aboleth : DD 14.
    const tentacle = await lend("Compendium.dnd-monster-manual.actors.Actor.mmAboleth0000000.Item.mmTentacle000000");
    state = await grab(tentacle, 2);
    if ( ctx.expect(!!state, "le Tentacule touche la Cible (20 essais au plus)") ) {
      ctx.expect(state[0]?.escapeDc === 14, `DD d'évasion du Tentacule : ${state[0]?.escapeDc} (14 attendu)`);
    }
  }
};
