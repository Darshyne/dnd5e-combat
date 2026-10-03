/**
 * §62 — L'ouïe et la brume à l'écran. Monde `ravenloft` : ce que Kaalisti voit du Zombi, par ses yeux (le MJ prend le contrôle
 * de son token, `api.mcp.perceived`), et ce que la légalité dit d'une cible cachée.
 *  1. Zombi Invisible : il reste à l'écran, avec le contour ondulant de l'ouïe.
 *  2. Nappe de brouillard (prêtée à Bramo, à volonté) posée sur le Zombi : à l'écran, contour de l'ouïe, pas vu normalement.
 *  3. Kaalisti Assourdi, Zombi dans la brume : plus rien à l'écran.
 *  4. Zombi caché (effet de Furtivité du moteur, DD 20) : plus rien à l'écran ; un Trait de feu de Kaalisti sur lui est refusé
 *     par la légalité (« caché : vous ne savez pas où il est »).
 * Se déclare non applicable si Kaalisti ne voit pas le Zombi au départ (scène trop sombre, murs).
 */
const FOG_CLOUD = "Compendium.dnd-players-handbook.spells.Item.phbsplFogCloud00";
const HEARING = [0.55, 0.8, 1, 1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "ouïe — invisible ou dans la brume : entendu ; assourdi ou caché : rien ; cible cachée refusée",

  async run(ctx) {
    const { sceneId, tokens } = await ctx.scene();
    if ( !["Zombi", "Kaalisti", "Bramo"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Kaalisti ou Bramo absent : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const warlock = await ctx.token("Kaalisti");
    const wizard = await ctx.token("Bramo");
    const seen = async () => (await ctx.engine("perceived", { observerId: warlock.id, targetIds: [zombie.id] }))[zombie.id];
    const isHeard = p => p?.visible && Array.isArray(p.filter) && p.filter.every((c, i) => Math.abs(c - HEARING[i]) < 0.02);
    const describe = p => (p?.visible ? (p.filter ? `entendu (${JSON.stringify(p.filter)})` : "vu") : "rien");

    const start = await seen();
    if ( !(start?.visible && !start.filter) ) { ctx.log(`Kaalisti ne voit pas le Zombi au départ (${describe(start)}) : non applicable`); return; }

    // 1. Invisible.
    ctx.restore(() => ctx.call("set-status", { tokenId: zombie.id, statusId: "invisible", active: false }).catch(() => {}));
    await ctx.call("set-status", { tokenId: zombie.id, statusId: "invisible", active: true });
    await sleep(500);
    let p = await seen();
    ctx.expect(isHeard(p), `Zombi Invisible : entendu, contour de l'ouïe (${describe(p)})`);
    await ctx.call("set-status", { tokenId: zombie.id, statusId: "invisible", active: false });
    await sleep(500);

    // 2. Nappe de brouillard sur le Zombi.
    await ctx.ensureItem(wizard, FOG_CLOUD, { system: { method: "atwill" } });
    const box = await ctx.box(zombie);
    const used = await ctx.use({ tokenId: wizard.id, identifier: "fog-cloud", activityType: "utility",
      area: { shape: "circle", x: box.x + box.width / 2, y: box.y + box.height / 2, radius: box.width * 2 } });
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    if ( !ctx.expect(used.used !== false && !!used.regionId, "Nappe de brouillard posée sur le Zombi") ) return;
    await sleep(800);
    p = await seen();
    ctx.expect(isHeard(p), `dans la brume : pas vu, entendu (${describe(p)})`);

    // 3. Assourdi.
    ctx.restore(() => ctx.call("set-status", { tokenId: warlock.id, statusId: "deafened", active: false }).catch(() => {}));
    await ctx.call("set-status", { tokenId: warlock.id, statusId: "deafened", active: true });
    await sleep(500);
    p = await seen();
    ctx.expect(!p?.visible, `Kaalisti Assourdi, Zombi dans la brume : rien à l'écran (${describe(p)})`);
    await ctx.call("set-status", { tokenId: warlock.id, statusId: "deafened", active: false });
    await ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {});
    await sleep(800);

    // 4. Caché.
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const target = tok.actorLink ? { documentType: "Actor", id: tok.actorId } : { uuid: `Scene.${sceneId}.Token.${zombie.id}.Actor.${tok.actorId}` };
    const hidden = await ctx.call("upsert-embedded-effect", { ...target, effectData: {
      name: "Furtivité (scénario ouïe)", img: "icons/svg/cowled.svg", transfer: false, disabled: false, statuses: ["invisible"], changes: [],
      flags: { "dnd5e-combat": { hidden: { dc: 20 } } } } });
    const hiddenId = hidden.effectId ?? hidden.id ?? hidden.effect?._id;
    ctx.restore(() => ctx.removeEffectsNamed(zombie, /Furtivité \(scénario ouïe\)/));
    await sleep(500);
    p = await seen();
    ctx.expect(!p?.visible, `Zombi caché : rien à l'écran (${describe(p)})`);

    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    await ctx.call("use-activity", { tokenId: warlock.id, itemId: await ctx.itemId(warlock.id, "fire-bolt"), activityType: "attack",
      targetTokenIds: [zombie.id], configure: false, usageConfig: { "dnd5e-combat": { autoReact: "none" } } }).catch(() => null);
    const d = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 6000 }).catch(() => null))?.windows?.[0];
    ctx.expect(!!d && /cach|hidden/i.test(d.text ?? ""), `Trait de feu sur le Zombi caché : refusé (« ${(d?.text ?? "aucune fenêtre").slice(0, 160)} »)`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    void hiddenId;
  }
};
