/**
 * §311, sous-lot C12-c de la repasse terme par terme : invocations, compagnons, formes. Arène des sorts (Lanceur, Cible).
 * Chaque partie prête ses items depuis le Manuel des joueurs et remet tout.
 *  - Compagnon primitif : en combat, la bête du Lanceur ne peut attaquer (souci « sur ordre ») tant que le Lanceur ne l'a pas commandée ;
 *    après « Command », plus de souci ;
 *  - Appel de familier : une attaque du familier est un souci (« un familier ne peut pas attaquer ») ;
 *  - Plénitude stellaire : l'effet de résistances est éteint hors de la Forme stellaire, allumé quand elle est active.
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
  name: "repasse-c12c — Compagnon primitif sur ordre, familier sans attaque, Plénitude stellaire (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const summoned = [];
    const lend = async (uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const id of summoned.splice(0) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    /** L'item d'attaque d'un token invoqué (non lié) : le premier qui porte une activité d'attaque. */
    const attackOf = async tokenId => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: tokenId });
      const items = data.actorLink ? ((await ctx.call("get-actor", { actorId: data.actorId })).items ?? []) : [...((await ctx.call("get-actor", { actorId: data.actorId })).items ?? []), ...(data.delta?.items ?? [])];
      return items.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"))?._id ?? null;
    };

    await part("Compagnon primitif", async () => {
      await lend(`${PHB}.classes.Item.phbrgrRanger0000`, { "system.levels": 3 }).catch(() => null);
      const companion = await lend(`${PHB}.classes.Item.phbrgrPrimalComp`);
      await ctx.startCombat([caster, target]);
      await pause(1000);
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: companion, x: home.x + grid, y: home.y + 2 * grid }).catch(err => ({ error: err.message }));
      const beast = s?.tokens?.[0];
      if ( !ctx.expect(!!beast, `la bête est invoquée${s?.error ? ` (${s.error})` : ""}`) ) return;
      summoned.push(beast.id);
      await pause(2000);
      const strike = await attackOf(beast.id);
      if ( !ctx.expect(!!strike, "la bête a une attaque") ) return;
      const before = await ctx.engine("issues", { tokenId: beast.id, itemId: strike, activityType: "attack" });
      ctx.expect(before.some(l => /ordre|command/i.test(l)), `sans ordre : « sur ordre seulement » (${before.join(" | ") || "rien"})`);
      await ctx.use({ tokenId: caster.id, itemId: companion, activityId: "Jtr7GXnCHb85xHg8", targetTokenIds: [beast.id], consume: false });
      await pause(2500);
      const after = await ctx.engine("issues", { tokenId: beast.id, itemId: strike, activityType: "attack" });
      ctx.expect(!after.some(l => /ordre|command/i.test(l)), `commandée : plus de souci d'ordre (${after.join(" | ") || "rien"})`);
    });

    await part("Appel de familier", async () => {
      const familiar = await lend(`${PHB}.spells.Item.phbsplFindFamili`, { "system.method": "atwill" });
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: familiar, x: home.x + grid, y: home.y + 2 * grid, actorUuid: "Actor.mmStirge00000000" }).catch(err => ({ error: err.message }));
      const pet = s?.tokens?.[0];
      if ( !ctx.expect(!!pet, `le familier est invoqué${s?.error ? ` (${s.error})` : ""}`) ) return;
      summoned.push(pet.id);
      await pause(2000);
      const bite = await attackOf(pet.id);
      if ( !ctx.expect(!!bite, "le familier a une attaque sur sa fiche") ) return;
      const issues = await ctx.engine("issues", { tokenId: pet.id, itemId: bite, activityType: "attack" });
      ctx.expect(issues.some(l => /familier|familiar/i.test(l)), `son attaque est refusée (${issues.join(" | ") || "rien"})`);
    });

    await part("Plénitude stellaire", async () => {
      const starry = await lend(`${PHB}.classes.Item.phbdrdStarryForm`);
      const full = await lend(`${PHB}.classes.Item.phbdrdFullOfStar`);
      await pause(2000);
      const fullEffect = async () => ((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === full)?.effects?.find(e => e._id === "Z3dPVHxaYqTIvLPg");
      // §438 : Manuel 3.0.0, l'item Plénitude stellaire n'a plus d'effet ; les résistances sont des changements de l'effet « Starry Form »,
      // à condition (`classes.druid.levels` ≥ 14) — dnd5e les applique lui-même. Le Lanceur reçoit un Druide 14 le temps de la partie, et
      // les résistances se lisent sur les données préparées.
      if ( !(await fullEffect()) ) {
        await lend(`${PHB}.classes.Item.phbdrdDruid00000`, { "system.levels": 14 });
        await pause(1000);
        const resists = async () => {
          const r = (await ctx.engine("stats", { tokenId: caster.id }))?.resistances ?? [];
          return ["bludgeoning", "piercing", "slashing"].every(t => r.includes(t));
        };
        const shown = async () => ((await ctx.engine("stats", { tokenId: caster.id }))?.resistances ?? []).join(", ") || "aucune";
        ctx.expect(!(await resists()), `forme 3.0.0, hors de la Forme stellaire : pas de résistances (${await shown()})`);
        await ctx.engine("placeItemEffect", { tokenId: caster.id, casterId: caster.id, itemId: starry, effectId: "orMzu14BYojAQkUm" });
        let on3 = false;
        for ( let n = 0; (n < 20) && !on3; n++ ) { await pause(500); on3 = await resists(); }
        ctx.expect(on3, `forme 3.0.0, sous la Forme stellaire : résistances contondantes, perforantes, tranchantes (${await shown()})`);
        for ( const e of await ctx.effects(caster) ) {
          if ( /Starry|stellaire/i.test(e.name) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id }).catch(() => {});
        }
        let off3 = false;
        for ( let n = 0; (n < 20) && !off3; n++ ) { await pause(500); off3 = !(await resists()); }
        ctx.expect(off3, `forme 3.0.0, la Forme stellaire finie : elles tombent (${await shown()})`);
        return;
      }
      ctx.expect((await fullEffect())?.disabled === true, "hors de la Forme stellaire : pas de résistances");
      // « Consume Wild Shape » pose sur le druide une copie de l'effet « Starry Form » (effet d'activité : allumer celui de l'item ne
      // s'applique pas à l'acteur dans dnd5e 6).
      await ctx.engine("placeItemEffect", { tokenId: caster.id, casterId: caster.id, itemId: starry, effectId: "orMzu14BYojAQkUm" });
      let on = false;
      for ( let n = 0; (n < 20) && !on; n++ ) { await pause(500); on = (await fullEffect())?.disabled === false; }
      ctx.expect(on, "sous la Forme stellaire : résistances contondantes, perforantes, tranchantes");
      for ( const e of await ctx.effects(caster) ) {
        if ( /Starry|stellaire/i.test(e.name) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id }).catch(() => {});
      }
      let off = false;
      for ( let n = 0; (n < 20) && !off; n++ ) { await pause(500); off = (await fullEffect())?.disabled === true; }
      ctx.expect(off, "la Forme stellaire finie : elles tombent");
    });
  }
};
