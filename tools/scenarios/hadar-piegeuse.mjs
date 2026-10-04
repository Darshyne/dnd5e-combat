/**
 * §80 — Faim de Hadar et Frappe piégeuse (Manuel des joueurs, prêtées sans emplacement au Magicien).
 *  1. Faim de Hadar posée sur le Guerrier (zone réduite à sa case, pour n'y prendre personne d'autre). La zone retient une activité
 *     par moment ; au début du tour du Guerrier, « Start of Turn Damage » (froid) ; à la fin de ce même tour, « End of Turn Save »
 *     (sauvegarde de Dextérité, acide) — le froid n'empêche pas l'acide.
 *  2. Frappe piégeuse sur le Zombi (200 PV le temps du test), jusqu'à ce qu'il soit Entravé ; au début de son tour, il subit les
 *     dégâts perforants de « Start of Turn Damage ».
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.spells.Item";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tickOf = m => m.flags?.[MODULE_ID]?.areaTick ?? null;

export default {
  name: "Faim de Hadar (froid au début du tour, acide à la fin) et Frappe piégeuse (dégâts au début du tour)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Guerrier ou Zombi absent : non applicable"); return; }
    await ctx.stage({ ...RESTORED_KEEP, tokens: { ...RESTORED_KEEP.tokens, Zombi: [2800, 4900] } });
    const mage = await ctx.token("Magicien");
    const guerrier = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const endConcentration = async () => {
      for ( const e of (await ctx.effects(mage)).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    ctx.restore(endConcentration);
    const hadar = await ctx.ensureItem(mage, `${PHB}.phbsplHungerofHa`, { system: { method: "atwill" } });
    const snare = await ctx.ensureItem(mage, `${PHB}.phbsplEnsnaringS`, { system: { method: "atwill" } });

    // 1. Faim de Hadar.
    const hp0 = await ctx.hp(guerrier);
    ctx.restore(() => ctx.setHp(guerrier, hp0));
    const box = await ctx.box(guerrier);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const used = await ctx.use({ tokenId: mage.id, itemId: hadar, activityType: "utility", area: { shape: "circle", ...centre, radius: box.width / 2 } });
    ctx.expect(used.used && !!used.regionId, "Faim de Hadar posée sur le Guerrier");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    await sleep(2000);
    const region = used.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: used.regionId })).data : null;
    const state = region?.flags?.[MODULE_ID]?.area;
    ctx.expect(state?.activities?.turnStart === "G6bH5mBR3kkEYjYe" && state?.activities?.turnEnd === "FGDyvqQz5JQQc5mf",
      `zone qui dure, une activité par moment (${JSON.stringify(state && { on: state.on, activities: state.activities })})`);

    await ctx.startCombat([mage, guerrier]);
    const ticks = async () => (await ctx.messagesSince(used.usageMessageId)).filter(m => (m.type === "usage") && tickOf(m)?.token?.endsWith(guerrier.id));
    let start = null;
    let before = null;
    for ( let i = 0; (i < 4) && !start; i++ ) {
      before = await ctx.hp(guerrier);   // relevé avant le changement de tour : le froid s'applique aussitôt
      await ctx.nextTurn(); await sleep(2500);
      start = (await ticks()).find(m => tickOf(m).event === "turnStart");
    }
    if ( ctx.expect(!!start, "début du tour du Guerrier dans la sphère : le froid est rejoué") ) {
      const r = await ctx.settle(start.id).catch(() => null);
      await sleep(1500);
      const after = await ctx.hp(guerrier);
      ctx.expect(r?.step === "done" && (after < before), `froid : résolution « ${r?.step} », PV ${before} → ${after}`);
    }
    await ctx.nextTurn(); await sleep(3000);
    const end = (await ticks()).find(m => tickOf(m).event === "turnEnd");
    if ( ctx.expect(!!end, "fin du tour du Guerrier dans la sphère : la sauvegarde d'acide est rejouée, malgré le froid du même tour") ) {
      const r = await ctx.settle(end.id).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Guerrier");
      ctx.expect(r?.plan?.save?.ability === "dex" && !!t?.save, `acide : sauvegarde de Dextérité ${t?.save?.total} contre DD ${r?.plan?.save?.dc} (${t?.save?.success ? "réussie" : "ratée"})`);
    }
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await endConcentration();
    if ( used.regionId ) await ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {});
    await sleep(1000);

    // 2. Frappe piégeuse.
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const zhp = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, zhp));
    if ( !tok.actorLink ) {
      const max = tok.delta?.system?.attributes?.hp?.max ?? null;
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 200 } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
        data: max === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max } }).catch(() => {}));
    }
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Ensnared|piég|Entrav/i));
    await ctx.setHp(zombi, 200);
    const restrained = async () => (await ctx.effects(zombi)).some(e => !e.disabled && (e.statuses ?? []).includes("restrained"));
    let caught = false;
    const castHp = await ctx.hp(zombi);
    for ( let i = 0; (i < 15) && !caught; i++ ) {
      await endConcentration();
      const u = await ctx.use({ tokenId: mage.id, itemId: snare, activityType: "save", targetTokenIds: [zombi.id] });
      await ctx.settle(u.usageMessageId).catch(() => null);
      await sleep(1000);
      caught = await restrained();
    }
    if ( !ctx.expect(caught, "Frappe piégeuse : le Zombi est Entravé (15 essais au plus)") ) return;
    // §81 : la donnée met 1d6 sur la sauvegarde du lancement ; la règle 2024 n'en donne qu'au début des tours.
    const afterCast = await ctx.hp(zombi);
    ctx.expect(afterCast === castHp, `lancement : aucun dégât, réussie ou ratée (${castHp} → ${afterCast} PV)`);
    await ctx.startCombat([mage, zombi]);
    let hurt = false;
    for ( let i = 0; (i < 3) && !hurt; i++ ) {
      const before = await ctx.hp(zombi);
      await ctx.nextTurn(); await sleep(3500);
      const after = await ctx.hp(zombi);
      if ( after < before ) { hurt = true; ctx.log(`Zombi : ${before} → ${after} PV`); }
    }
    ctx.expect(hurt, "au début du tour du Zombi entravé : dégâts perforants de la Frappe piégeuse");
  }
};
