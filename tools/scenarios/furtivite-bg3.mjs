/**
 * §184 : la Furtivité « BG3 ». Le Zombi regarde vers le bas ; le Guerrier (armure lourde : Discrétion au Désavantage) en mode furtif :
 *  1. dans son dos : pas vu, aucun test ;
 *  2. devant lui en pleine lumière : repéré aussitôt (le Zombi le voit désormais) ;
 *  3. dans une zone d'obscurité (région « Ajuster l'obscurité » du cœur), le mode remis à zéro : à chaque entrée dans sa vue, un test ;
 *     un échec = doute, deux = repéré — on entre et ressort jusqu'à être repéré (ou quatorze entrées sans deux échecs, cohérent aussi) ;
 *  4. sortir du mode efface les repérages.
 * Remet : réglages, mode furtif, positions, rotation, région.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "furtivite-bg3 — BG3 : repéré en pleine lumière, tests à l'entrée dans le noir, doute puis repéré",

  async run(ctx) {
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const rogue = await ctx.token("Guerrier");
    const npc = await ctx.call("call-module-api", { moduleId: "darsh-npc", fn: "reglage", args: { key: "aiEnabled", value: false } }).catch(() => null);
    if ( npc?.result ) ctx.restore(() => ctx.call("call-module-api", { moduleId: "darsh-npc", fn: "reglage", args: { key: "aiEnabled", value: npc.result.before } }));
    for ( const [key, value] of [["visionCones", true], ["stealthRules", "bg3"]] ) {
      const r = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: r.before }));
    }
    // Seuls le Zombi (l'ennemi qui regarde), le Guerrier et le Clerc (un allié) : un autre ennemi le repérerait aussi.
    for ( const t of tokens.filter(t => !["Zombi", "Guerrier", "Clerc"].includes(t.name)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const st = (op="state", extra={}) => ctx.engine("stealth", { op, tokenId: rogue.id, ...extra });
    ctx.restore(() => st("set", { on: false }));
    const { data: z } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { rotation: z.rotation ?? 0 } }));
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { rotation: 0 } });
    const grid = await ctx.gridSize();
    const behind = [z.x, z.y - (grid * 3)];
    const front = [z.x, z.y + (grid * 3)];
    await ctx.stage({ tokens: { Guerrier: behind } });
    const go = async ([x, y]) => { await ctx.call("move-token", { tokenId: rogue.id, x, y, elevation: 0 }); await pause(700); return st("check"); };

    // 1. Dans son dos.
    await st("set", { on: true });
    let s = await go(behind);
    ctx.expect(s.hidden && !s.spottedBy.length, "caché dans son dos, sans jet : pas repéré");
    const ally = await ctx.token("Clerc").catch(() => null);
    if ( ally ) ctx.expect((await ctx.engine("sees", { observerId: ally.id, targetId: rogue.id })).sees === true, "un allié (le Clerc) le voit toujours");
    ctx.expect((await ctx.engine("sees", { observerId: zombi.id, targetId: rogue.id })).sees === false, "le Zombi ne le voit pas");

    // 2. Devant, en pleine lumière.
    s = await go(front);
    if ( s.light !== 2 ) ctx.log(`lumière au point : ${s.light} (l'arène n'est pas en plein jour ?)`);
    else {
      ctx.expect(s.spottedBy.includes("Zombi"), "devant lui en pleine lumière : repéré aussitôt");
      ctx.expect((await ctx.engine("sees", { observerId: zombi.id, targetId: rogue.id })).sees === true, "le Zombi le voit désormais");
    }

    // 3. Dans le noir : une région d'obscurité autour du Roublard et de la ligne de vue.
    const region = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: z.x - (grid * 3), y: z.y - (grid * 5), width: grid * 7, height: grid * 11 }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const regionId = region?.id ?? region?.regionId ?? region?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
    await pause(1000);
    await st("set", { on: false });
    await go(behind);
    await st("set", { on: true });
    s = await go(behind);
    ctx.expect(!s.spottedBy.length, "le mode remis à zéro : plus repéré");
    let entries = 0, doubted = false;
    for ( ; (entries < 14) && !s.spottedBy.length; entries++ ) {
      s = await go(front);
      if ( s.light === 2 ) { ctx.log("encore en pleine lumière dans la région : obscurité non prise"); break; }
      if ( (s.views?.Zombi?.fails ?? 0) >= 1 ) doubted = true;
      if ( !s.spottedBy.length ) s = await go(behind);
    }
    ctx.log(`entrées : ${entries}, lumière ${s.light}, état ${JSON.stringify(s.views)}`);
    if ( s.spottedBy.length ) {
      ctx.expect(doubted, "repéré seulement après un premier doute");
      ctx.expect((s.views?.Zombi?.fails ?? 0) >= 2, "deux tests ratés");
    }
    else ctx.expect((s.views?.Zombi?.fails ?? 0) <= 1, "pas repéré : au plus un échec");

    // 4. Attaquer depuis la furtivité, dans son dos : Avantage (il ne le voit pas), puis on sort du mode.
    await st("set", { on: false });
    await st("set", { on: true });
    await go([z.x, z.y - grid]);
    const itemId = await ctx.itemId(rogue.id, "greatsword").catch(() => null);
    if ( itemId ) {
      const why = await ctx.engine("attackReasons", { attackerId: rogue.id, targetId: zombi.id, itemId });
      ctx.expect(why.advantage.length > 0, `Avantage depuis la furtivité (${why.advantage.join(", ")})`);
      const hp0 = await ctx.hp(zombi);
      ctx.restore(() => ctx.setHp(zombi, hp0));
      const used = await ctx.use({ tokenId: rogue.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [zombi.id] });
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(800);
      ctx.expect((await st()).hidden === false, "après l'attaque : plus caché");
    }
    else ctx.log("pas d'épée à deux mains sur le Guerrier : attaque non vérifiée");

    // 5. Sortir du mode furtif.
    await st("set", { on: false });
    s = await st();
    ctx.expect(!s.hidden && !s.spottedBy.length, "plus caché : plus rien");
  }
};
