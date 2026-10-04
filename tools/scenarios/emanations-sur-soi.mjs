/**
 * §86 — Émanations sur soi dont la donnée n'a pas de gabarit (Manuel des joueurs premium) : le contenu fournit l'émanation de 10 ft
 * (`selfZone`), posée d'office sur le lanceur (§47), et la zone épargne les alliés (`zoneAffects: "enemy"`).
 *  1. Présence royale de Yolande (prêtée au Barde) : l'émanation est posée sur lui ; le Zombi (ennemi) et le Druide (allié) à 1,50 m.
 *     En combat, le Zombi qui finit son tour dedans fait « Emanation Save » (Sagesse) — À terre s'il la rate ; le Druide, jamais.
 *  2. Invocation d'êtres sylvestres (prêtée au Druide) : « Cast » résout sa sauvegarde à la pose sur le Zombi au contact, pas sur
 *     le Barde (allié) ; la zone retient la sœur « Emanation Save ».
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.spells.Item";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tickOf = m => m.flags?.[MODULE_ID]?.areaTick ?? null;

export default {
  name: "émanations sur soi sans gabarit — Présence royale de Yolande, Invocation d'êtres sylvestres (alliés épargnés)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Barde", "Druide", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Barde, Druide ou Zombi absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const barde = await ctx.token("Barde");
    const druide = await ctx.token("Druide");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const b0 = await ctx.position(barde), d0 = await ctx.position(druide), z0 = await ctx.position(zombi);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: z0.x, y: z0.y, elevation: 0 }));
    ctx.restore(() => ctx.call("move-token", { tokenId: druide.id, x: d0.x, y: d0.y, elevation: 0 }));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "prone"));
    // 200 PV le temps du scénario : la Présence royale (4d6) tuait parfois le Zombi, qui n'était plus affecté par la seconde zone.
    const { data: ztok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    if ( !ztok.actorLink ) {
      const max = ztok.delta?.system?.attributes?.hp?.max ?? null;
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 200, "delta.system.attributes.hp.value": 200 } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
        data: max === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max } }).catch(() => {}));
    }
    const endConcentration = async t => ctx.removeEffectsNamed(t, /Concentr/i);
    ctx.restore(() => endConcentration(barde));
    ctx.restore(() => endConcentration(druide));
    // Le Zombi à droite du Barde, le Druide à sa gauche : tous deux à 1,50 m.
    await ctx.call("move-token", { tokenId: zombi.id, x: b0.x + grid, y: b0.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: druide.id, x: b0.x - grid, y: b0.y, elevation: 0 });
    await sleep(800);
    const regionsOf = async () => (await ctx.call("list-scene-objects", { types: ["Region"] })).objects.Region ?? [];
    const zoneState = async id => (await ctx.call("get-scene-object", { type: "Region", objectId: id })).data?.flags?.[MODULE_ID]?.area ?? null;

    // 1. Présence royale de Yolande.
    const yolande = await ctx.ensureItem(barde, `${PHB}.phbsplYolandesRe`, { system: { method: "atwill" } });
    const before = new Set((await regionsOf()).map(r => r.id));
    const since = await ctx.lastMessageId();
    await ctx.use({ tokenId: barde.id, itemId: yolande, activityType: "utility" });
    await sleep(3000);
    const zone = (await regionsOf()).find(r => !before.has(r.id) && /Yolande|Présence/i.test(r.name ?? ""));
    if ( zone ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone.id }).catch(() => {}));
    if ( !ctx.expect(!!zone, `l'émanation est posée d'office sur le Barde (${zone?.name ?? "aucune région"})`) ) return;
    const state = await zoneState(zone.id);
    ctx.expect(state?.activity === "dzeoGwKOPG7PHbyE" && state?.affects === "enemy",
      `zone qui dure : « Emanation Save », alliés épargnés (${JSON.stringify(state && { on: state.on, activity: state.activity, affects: state.affects })})`);
    await ctx.startCombat([barde, zombi, druide]);
    const ticks = async () => (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && (tickOf(m)?.event === "turnEnd"));
    let zombiTick = null;
    for ( let i = 0; (i < 4) && !zombiTick; i++ ) {
      await ctx.nextTurn(); await sleep(3000);
      zombiTick = (await ticks()).find(m => tickOf(m).token?.endsWith(zombi.id));
    }
    if ( ctx.expect(!!zombiTick, "fin du tour du Zombi dans l'émanation : la sauvegarde est rejouée") ) {
      const r = await ctx.settle(zombiTick.id).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Zombi");
      await sleep(1500);
      const prone = (await ctx.effects(zombi)).some(e => !e.disabled && (e.statuses ?? []).includes("prone"));
      ctx.expect(r?.plan?.save?.ability === "wis" && !!t?.save, `sauvegarde de Sagesse : ${t?.save?.total} contre DD ${r?.plan?.save?.dc}`);
      ctx.expect(prone === (t?.save?.success === false), `À terre ${prone ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
    }
    await ctx.nextTurn(); await sleep(3000);   // la fin du tour du Druide, s'il n'est pas encore passé
    ctx.expect(!(await ticks()).some(m => tickOf(m).token?.endsWith(druide.id)), "le Druide (allié) n'est jamais pris par l'émanation");
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await endConcentration(barde);
    await ctx.call("delete-scene-object", { type: "Region", objectId: zone.id }).catch(() => {});
    await ctx.removeStatusEffects(zombi, "prone");
    await sleep(1000);

    // 2. Invocation d'êtres sylvestres, par le Druide revenu à sa place : le Zombi au contact, en diagonale au-dessus à droite (case
    // libre de la distribution), le Barde (allié) à deux cases à droite, dans l'émanation.
    await ctx.call("move-token", { tokenId: druide.id, x: d0.x, y: d0.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: zombi.id, x: d0.x + grid, y: d0.y - grid, elevation: 0 });
    await sleep(800);
    const beings = await ctx.ensureItem(druide, `${PHB}.phbsplConjureWoo`, { system: { method: "atwill" } });
    const before2 = new Set((await regionsOf()).map(r => r.id));
    const used = await ctx.use({ tokenId: druide.id, itemId: beings, activityId: "dnd5eactivity000" });
    await sleep(2500);
    const zone2 = (await regionsOf()).find(r => !before2.has(r.id));
    if ( zone2 ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: zone2.id }).catch(() => {}));
    if ( !ctx.expect(!!zone2, `l'émanation est posée d'office sur le Druide (${zone2?.name ?? "aucune région"})`) ) return;
    const r2 = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
    const names = (r2?.targets ?? []).map(t => t.name);
    ctx.expect(names.includes("Zombi") && !names.includes("Barde"), `à la pose : le Zombi sauvegarde, pas le Barde (${names.join(", ") || "personne"})`);
    const state2 = await zoneState(zone2.id);
    ctx.expect(state2?.activity === "UkXLSgFbCBI9CHMf", `zone qui dure : « Emanation Save » à rejouer (${state2?.activity ?? "aucune"})`);
  }
};
