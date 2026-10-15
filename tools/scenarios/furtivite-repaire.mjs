/**
 * §184-§186 : la Furtivité « BG3 » sur une vraie carte — le repaire des Chapes rouges (« Redbrand Hideout [30x20] » de `dnd-6`). La
 * pièce nord-ouest est sans lumière ; un couloir, portes ouvertes, mène à la pièce juste au sud, éclairée par une lampe au fond, où
 * deux Bandits (Hostiles, sans vision dans le noir) se tiennent sous la porte. Le Magicien en mode furtif :
 *  1. au fond de la pièce sombre : ni test ni repérage, et les Bandits ne le voient pas ;
 *  2. les Bandits tournés vers le nord (vers la porte), le Magicien face à eux mais dans le noir complet : toujours aucun test —
 *     ils ne voient pas dans le noir ;
 *  3. dans le couloir, en lumière faible : chaque entrée dans leur champ de vision est un test (Discrétion contre Perception
 *     passive) — un échec = doute, deux = repéré ; on entre et ressort jusqu'à être repéré (quatorze entrées sans deux échecs :
 *     cohérent aussi) ;
 *  4. les Bandits tournés vers le sud (vers la lampe), le Magicien sous la lampe devant eux : repéré aussitôt ;
 *  5. sortir du mode efface les repérages.
 * Une obscurité réelle (lumière de la pièce éteinte), là où `furtivite-bg3` pose une région « Ajuster l'obscurité » dans l'arène.
 * Remet : réglages, mode furtif, positions, rotations.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "furtivite-repaire — BG3 dans le repaire : pièce sombre, doute puis repéré, pièce éclairée",
  scene: "Redbrand Hideout [30x20]",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const bandits = tokens.filter(t => t.name === "Bandit");
    const mage = tokens.find(t => t.name === "Magicien");
    if ( !mage || (bandits.length < 2) ) { ctx.log("Magicien ou les deux Bandits absents : non applicable"); return; }
    for ( const [key, value] of [["visionCones", true], ["stealthRules", "bg3"]] ) {
      const r = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: r.before }));
    }
    const st = (op="state", extra={}) => ctx.engine("stealth", { op, tokenId: mage.id, ...extra });
    ctx.restore(() => st("set", { on: false }));
    // Les Bandits regardent vers le nord (rotation 180 : 0 regarde vers le bas), vers la porte de la pièce sombre.
    for ( const b of bandits ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: b.id });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: b.id, data: { rotation: data.rotation ?? 0 } }));
    }
    const face = async rotation => {
      for ( const b of bandits ) await ctx.call("update-scene-object", { type: "Token", objectId: b.id, data: { rotation } });
      await pause(500);
    };
    await face(180);
    const { data: m0 } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: m0.x, y: m0.y, elevation: m0.elevation ?? 0 }));
    // Pièce sombre : x 994–1400, y 688–1094 ; portes du couloir en x 1181–1306 (y 1094 et 1200) ; Bandits en (1200, 1400) et (1300, 1300).
    const corner = [1000, 700];        // au fond, à l'ouest : hors de l'axe des portes
    const facing = [1200, 900];        // dans la pièce sombre, face aux portes : noir complet
    const corridor = [1200, 1100];     // le couloir entre les deux portes : lumière faible (la lampe de la pièce sud)
    const lamp = [1200, 1550];         // sous la lampe (1248, 1671), au sud des Bandits : pleine lumière
    const go = async ([x, y]) => { await ctx.call("move-token", { tokenId: mage.id, x, y, elevation: 0 }); await pause(900); return st("check"); };
    const seen = async () => Promise.all(bandits.map(async b => (await ctx.engine("sees", { observerId: b.id, targetId: mage.id })).sees));

    // 1. Au fond de la pièce sombre.
    await st("set", { on: true });
    let s = await go(corner);
    ctx.expect(s.hidden && !s.spottedBy.length, `au fond de la pièce sombre : caché, pas repéré (lumière ${s.light})`);
    ctx.expect((await seen()).every(v => v === false), "les Bandits ne le voient pas");

    // 2. Face à eux, dans le noir complet : ils ne voient pas dans le noir.
    s = await go(facing);
    ctx.expect(s.light === 0, `face aux portes : noir complet (lumière ${s.light})`);
    ctx.expect(!s.spottedBy.length && !Object.keys(s.views ?? {}).length, `dans le noir complet : aucun test (${JSON.stringify(s.views)})`);

    // 3. Dans le couloir, en lumière faible : un test à chaque entrée dans leur vue.
    s = await go(corridor);
    ctx.expect(s.light === 1, `le couloir : lumière faible (lumière ${s.light})`);
    if ( !s.spottedBy.length ) s = await go(corner);
    // Un doute (un échec) d'un Bandit, vu à une entrée précédente ou au moment où il le repère (deux échecs).
    let entries = 0, doubted = false;
    for ( ; (entries < 14) && !s.spottedBy.length; entries++ ) {
      s = await go(corridor);
      if ( Object.values(s.views ?? {}).some(v => (v.fails ?? 0) >= 1) ) doubted = true;
      if ( !s.spottedBy.length ) s = await go(corner);
    }
    ctx.log(`entrées : ${entries}, lumière ${s.light}, état ${JSON.stringify(s.views)}`);
    const tested = Object.values(s.views ?? {}).some(v => v.inView || (v.fails ?? 0) > 0) || doubted || s.spottedBy.length;
    ctx.expect(tested, "dans le couloir : sa présence est testée (doute ou repérage)");
    if ( s.spottedBy.length ) ctx.expect(doubted, `repéré (${s.spottedBy.join(", ")}) seulement après un premier doute`);
    else ctx.log("quatorze entrées sans deux échecs : la Discrétion a tenu (cohérent)");

    // 4. Sous la lampe, devant eux : le mode remis à zéro, repéré aussitôt.
    await st("set", { on: false });
    await go(corner);
    await face(0);
    await st("set", { on: true });
    s = await go(lamp);
    ctx.expect(s.light === 2, `sous la lampe : pleine lumière (lumière ${s.light})`);
    ctx.expect(s.spottedBy.length > 0, `devant eux en pleine lumière : repéré aussitôt (${s.spottedBy.join(", ") || "personne"})`);

    // 5. Sortir du mode efface les repérages.
    await st("set", { on: false });
    s = await st("state");
    ctx.expect(!s.hidden && !s.spottedBy.length, "hors du mode furtif : plus caché, plus repéré");
  }
};
