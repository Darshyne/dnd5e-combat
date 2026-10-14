/**
 * §105 — la « Brume vampirique » du monde `ravenloft` (fiche faite à la main, format 2014 en français, sans identifiant hors
 * de sa Forme brumeuse, `misty-form`), contre Alara, sur la scène « Carte de test » :
 *  1. Forme brumeuse, « et inversement » : la Brume peut finir dans la case d'Alara, et Alara dans celle de la Brume ;
 *  2. Drain de vie : touché, sauvegarde de Constitution enchaînée ; ratée, un effet de maximum de PV égal aux dégâts subis
 *     sur Alara, et la Brume regagne des PV ; réussie, aucun effet ;
 *  3. Caresse dévitalisante (Ombre du Monster Manual) prêtée à la Brume : touché, un effet « Force −1d4 » sur Alara.
 * Les jets sont aléatoires : on rejoue jusqu'à l'issue voulue (20 essais au plus).
 */
const SHADOW = "Compendium.dnd-monster-manual.actors.Actor.mmShadow00000000";
const DRAIN_EFFECT = /maximum de PV|Hit Point maximum|: (Force|Strength) −/;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Brume vampirique — Forme brumeuse, Drain de vie, Caresse dévitalisante",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Alara", "Brume vampirique"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Alara ou Brume vampirique absente : non applicable"); return; }
    const pc = await ctx.token("Alara");
    const mist = await ctx.token("Brume vampirique");
    const grid = await ctx.gridSize();
    const drained = async (t, kind="hp") => (await ctx.effects(t)).filter(e => e.flags?.["dnd5e-combat"]?.drain?.kind === kind)
      .reduce((n, e) => n + (e.flags["dnd5e-combat"].drain.total ?? 0), 0);
    const clearDrains = t => ctx.removeEffectsNamed(t, DRAIN_EFFECT);
    for ( const t of [pc, mist] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(() => clearDrains(t));
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(t, s));
    }
    const at = await ctx.position(pc);
    await ctx.call("move-token", { tokenId: mist.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    const cellAt = p => ({ i: Math.round(p.y / grid), j: Math.round(p.x / grid) });
    const endsAt = (plan, cell) => {
      const w = plan.waypoints?.at(-1);
      return !!w && (Math.round(w.x / grid) === cell.j) && (Math.round(w.y / grid) === cell.i);
    };

    // 1. Forme brumeuse.
    const pcCell = cellAt(at);
    const mistCell = { i: pcCell.i, j: pcCell.j + 1 };
    const intoPc = await ctx.engine("plan", { tokenId: mist.id, cell: pcCell, maxCost: 1e9 });
    ctx.expect(intoPc.found && intoPc.arrives && endsAt(intoPc, pcCell), "Forme brumeuse : la Brume peut finir dans la case d'Alara");
    const intoMist = await ctx.engine("plan", { tokenId: pc.id, cell: mistCell, maxCost: 1e9 });
    ctx.expect(intoMist.found && intoMist.arrives && endsAt(intoMist, mistCell), "« et inversement » : Alara peut finir dans la case de la Brume");
    const walked = await ctx.engine("move", { tokenId: mist.id, cell: pcCell });
    ctx.expect((walked.after.cell?.i === pcCell.i) && (walked.after.cell?.j === pcCell.j), `la Brume s'arrête dans la case d'Alara (${JSON.stringify(walked.after.cell)})`);
    await ctx.call("move-token", { tokenId: mist.id, x: at.x + grid, y: at.y, elevation: at.elevation });

    // 2. Drain de vie.
    const drainId = await ctx.engine("identify", { tokenId: mist.id }).then(() => null).catch(() => null);
    const { data: mistTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mist.id });
    const mistItems = (await ctx.call("get-actor", { actorId: mistTok.actorId })).items ?? [];
    const lifeDrain = mistItems.find(i => i.name === "Drain de vie")?._id ?? drainId;
    let sucked = null;
    let mistBefore = 0;
    let saved = false;
    for ( let i = 0; (i < 20) && !sucked; i++ ) {
      await ctx.setHp(pc, 100);
      await ctx.setHp(mist, 1);
      await clearDrains(pc);
      mistBefore = await ctx.hp(mist);
      const used = await ctx.use({ tokenId: mist.id, itemId: lifeDrain, activityType: "attack", targetTokenIds: [pc.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(pc.id));
      if ( (t?.hit === true) && (t.save?.success === false) && (t.damage?.applied > 0) ) sucked = t;
      else if ( !saved && (t?.hit === true) && (t.save?.success === true) ) {
        saved = true;
        await sleep(1000);
        ctx.expect((await drained(pc)) === 0, "Drain de vie, sauvegarde réussie : aucun effet de drain");
      }
    }
    if ( ctx.expect(!!sucked, "Drain de vie : touché, sauvegarde enchaînée ratée") ) {
      await sleep(1500);
      const n = await drained(pc);
      ctx.expect(n >= sucked.damage.applied, `effet : maximum de PV d'Alara -${n} (PV perdus ${sucked.damage.applied})`);
      ctx.expect((await ctx.hp(mist)) > mistBefore, `la Brume regagne des PV (${mistBefore} → ${await ctx.hp(mist)})`);
      const effect = (await ctx.effects(pc)).find(e => e.flags?.["dnd5e-combat"]?.drain?.kind === "hp");
      ctx.log(`effet posé : « ${effect?.name} », expiration ${effect?.duration?.expiry}`);
      ctx.expect(effect?.duration?.expiry === "longRest", "l'effet expire au repos long");
      const { hp } = await ctx.engine("stats", { tokenId: pc.id });
      ctx.expect((hp.tempmax ?? 0) <= -n, `maximum en vigueur réduit (PV max temporaires ${hp.tempmax}, PV ${hp.value}/${hp.max})`);
    }
    await clearDrains(pc);

    // 3. Caresse dévitalisante prêtée.
    const { data: source } = await ctx.call("get-compendium-entry", { uuid: SHADOW });
    const { _id, folder, ownership, _stats, ...itemData } = source.items.find(i => i.system?.identifier === "draining-swipe");
    const up = await ctx.call("upsert-actor-item", { actorId: mistTok.actorId, itemData, match: { path: "system.identifier", value: "draining-swipe" } });
    const swipe = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(mist.id, "draining-swipe"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mistTok.actorId, itemId: swipe }).catch(() => {}));
    let struck = null;
    for ( let i = 0; (i < 20) && !struck; i++ ) {
      await ctx.setHp(pc, 100);
      const used = await ctx.use({ tokenId: mist.id, itemId: swipe, activityType: "attack", targetTokenIds: [pc.id],
        usageConfig: { "dnd5e-combat": { legendary: "never" } } });
      const r = await ctx.settle(used.usageMessageId);
      const t = r.targets.find(x => x.token?.endsWith(pc.id));
      if ( t?.hit === true ) struck = t;
    }
    if ( ctx.expect(!!struck, "Caresse dévitalisante : touché") ) {
      await sleep(1500);
      const str = await drained(pc, "str");
      ctx.expect((str >= 1) && (str <= 4), `effet : Force d'Alara -${str} (1d4)`);
      const effect = (await ctx.effects(pc)).find(e => e.flags?.["dnd5e-combat"]?.drain?.kind === "str");
      ctx.log(`effet posé : « ${effect?.name} », expiration ${effect?.duration?.expiry}`);
      ctx.expect(effect?.duration?.expiry === "longRest", "l'effet de Force expire au repos long");
    }
  }
};
