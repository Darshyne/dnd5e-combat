/**
 * §96 — Collège des esprits (module premium `dnd-ravenloft-horrors-within`, pack `options`) : les Esprits d'outre-tombe prêtés au Barde.
 *  - Esprit vengeur sur le Clerc : aucun dégât au Clerc ; le Bandit qui le touche au corps à corps subit des dégâts de force.
 *  - Esprit brute (émanation de 9 m autour du Bandit) : le Clerc (allié) épargné ; Force, À terre ⇔ ratée.
 *  - Esprit couard : Sagesse ; Effrayé (l'état ajouté à l'effet) ⇔ ratée.
 *  - Esprit diseur de bonne aventure sur le Clerc : son attaque a l'Avantage.
 *  - Esprit prêtre : le Clerc Empoisonné — soigné, et l'état choisi prend fin.
 *  - Esprit de l'ombre sur le Clerc : Invisible ; il attaque — l'invisibilité prend fin.
 *  - Canalisation renforcée : Murmures dissonants (emplacement) — +1d6 au jet de dégâts.
 */
const MODULE_ID = "dnd5e-combat";
const RHW = "dnd-ravenloft-horrors-within.options";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Collège des esprits — Esprits vengeur, brute, couard, diseur de bonne aventure, prêtre, de l'ombre ; Canalisation renforcée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Barde", "Clerc", "Bandit", "Zombi"];
    if ( !need.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(RHW) ) { ctx.log("module Ravenloft absent : non applicable"); return; }
    const bard = await ctx.token("Barde"), cleric = await ctx.token("Clerc"), bandit = await ctx.token("Bandit"), zombie = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [bard, cleric, bandit, zombie] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const b0 = await ctx.position(bard);
    await ctx.call("move-token", { tokenId: cleric.id, x: b0.x + 2 * grid, y: b0.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: b0.x + 3 * grid, y: b0.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: zombie.id, x: b0.x + 3 * grid, y: b0.y + grid, elevation: 0 });
    await pause(800);
    const lend = async id => {
      const uuid = `Compendium.${RHW}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: bard.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: bard.actorId, itemId: r.id }).catch(() => {}));
      await pause(800);
      return r.id;
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (ids, re, ms=9000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return { labels: (d.buttons ?? []).map(x => x.label) }; }
        }
      }
      return null;
    };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    const named = async (t, re) => (await ctx.effects(t)).filter(e => !e.disabled && re.test(e.name ?? ""));
    const clearAll = async () => {
      for ( const t of [cleric, bandit, zombie] ) for ( const s of ["prone", "frightened", "invisible", "poisoned"] ) await ctx.removeStatusEffects(t, s);
      await ctx.removeEffectsNamed(cleric, /Spirit|Esprit|Avantage|Advantage|Invisible/i);
      await ctx.removeEffectsNamed(bandit, /Frightened|Effray|Spirit|Esprit/i);
    };
    ctx.restore(clearAll);
    const useOn = async (itemId, targets, area=null) => {
      const u = await ctx.use({ tokenId: bard.id, itemId, targetTokenIds: targets.map(t => t.id), ...(area ? { area } : {}) });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      await pause(800);
      if ( u.usageMessageId ) await ctx.engine("rollCard", { messageId: u.usageMessageId }).catch(() => null);
      const r = u.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { u, r };
    };
    const centreOf = async t => { const b = await ctx.box(t); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

    // 1. Esprit vengeur.
    const avenger = await lend("rhwCSAvengerSpv2");
    const c0 = await ctx.hp(cleric);
    await useOn(avenger, [cleric]);
    ctx.expect((await ctx.hp(cleric)) === c0, `Esprit vengeur : aucun dégât au Clerc (${c0} → ${await ctx.hp(cleric)})`);
    ctx.expect((await named(cleric, /Avenger|vengeur/i)).length > 0, "l'effet sur le Clerc");
    let avenged = null;
    for ( let n = 0; (n < 15) && !avenged; n++ ) {
      await tough(); await ctx.setHp(cleric, c0);
      const u = await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [cleric.id] });
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      if ( r?.targets?.find(t => t.name === "Clerc")?.hit !== true ) continue;
      await pause(3000);
      avenged = await ctx.hp(bandit);
    }
    ctx.expect((avenged !== null) && (avenged < 300) && (avenged >= 294), `le Bandit qui touche le Clerc subit 1d6 de force (300 → ${avenged})`);
    await clearAll();

    // 2. Esprit brute.
    const brute = await lend("rhwCSBruteSpir1q");
    let pr = null;
    for ( let n = 0; (n < 10) && !pr; n++ ) {
      await clearAll(); await tough();
      const { r } = await useOn(brute, [], { shape: "circle", ...(await centreOf(bandit)), radius: 6 * grid });
      const names = (r?.targets ?? []).map(t => t.name);
      if ( n === 0 ) ctx.expect(names.includes("Bandit") && !names.includes("Clerc"), `Esprit brute : le Bandit visé, pas le Clerc (${names.join(", ")})`);
      const t = r?.targets?.find(x => x.name === "Bandit");
      const prone = (await statuses(bandit)).includes("prone");
      if ( n === 0 ) ctx.expect(r?.plan?.save?.ability === "str" && (prone === (t?.save?.success === false)), `Force du Bandit (${t?.save?.total}), À terre ⇔ ratée`);
      if ( prone ) pr = true;
    }
    await clearAll();

    // 3. Esprit couard.
    const coward = await lend("rhwCSCowardSpi34");
    let scared = false;
    for ( let n = 0; (n < 10) && !scared; n++ ) {
      await clearAll();
      const { r } = await useOn(coward, [], { shape: "circle", ...(await centreOf(bandit)), radius: 6 * grid });
      const t = r?.targets?.find(x => x.name === "Bandit");
      scared = (await statuses(bandit)).includes("frightened");
      if ( n === 0 ) ctx.expect(r?.plan?.save?.ability === "wis" && (scared === (t?.save?.success === false)), `Esprit couard : Sagesse du Bandit (${t?.save?.total}), Effrayé ⇔ ratée`);
    }
    ctx.expect(scared, "Esprit couard : le Bandit Effrayé (10 essais au plus)");
    await clearAll();

    // 4. Esprit diseur de bonne aventure.
    const fortune = await lend("rhwCSFortuneTeZz");
    await useOn(fortune, [cleric]);
    const since4 = await ctx.lastMessageId();
    await ctx.use({ tokenId: cleric.id, identifier: "mace", activityType: "attack", targetTokenIds: [bandit.id] });
    await pause(4000);
    const atk = (await ctx.messagesSince(since4)).find(m => m.type === "attack");
    ctx.expect(atk?.rolls?.[0]?.options?.advantageMode === 1, `Esprit diseur de bonne aventure : l'attaque du Clerc a l'Avantage (mode ${atk?.rolls?.[0]?.options?.advantageMode})`);
    await clearAll();

    // 5. Esprit prêtre.
    const priest = await lend("rhwCSPriestSpi36");
    await ctx.call("set-status", { tokenId: cleric.id, statusId: "poisoned", active: true });
    await ctx.setHp(cleric, Math.max(1, c0 - 6));
    await pause(1000);
    const u5 = ctx.use({ tokenId: bard.id, itemId: priest, targetTokenIds: [cleric.id] });
    const used5 = await u5;
    await pause(800);
    if ( used5.usageMessageId ) await ctx.engine("rollCard", { messageId: used5.usageMessageId }).catch(() => null);
    // Un seul état de la liste présent : il prend fin d'office, sans question (ui/cure.mjs).
    await pause(3500);
    ctx.expect(!(await statuses(cleric)).includes("poisoned"), "Esprit prêtre : Empoisonné prend fin");
    ctx.expect((await ctx.hp(cleric)) > Math.max(1, c0 - 6), "Esprit prêtre : le Clerc soigné");
    await clearAll();

    // 6. Esprit de l'ombre.
    const shade = await lend("rhwCSShadeSpirvt");
    await useOn(shade, [cleric]);
    const inv = (await statuses(cleric)).includes("invisible");
    ctx.expect(inv, "Esprit de l'ombre : le Clerc Invisible");
    await ctx.use({ tokenId: cleric.id, identifier: "mace", activityType: "attack", targetTokenIds: [bandit.id] });
    await pause(4000);
    ctx.expect(!(await statuses(cleric)).includes("invisible"), "il attaque : l'invisibilité prend fin");
    await clearAll();

    // 7. Canalisation renforcée.
    await lend("rhwCSEmpoweredtO");
    const whispers = await ctx.ensureItem(bard, `${SPELLS}.phbsplDissonantW`);
    let empowered = null;
    for ( let n = 0; (n < 10) && !empowered; n++ ) {
      await tough();
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bard.id, itemId: whispers, activityType: "save", targetTokenIds: [bandit.id] });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const dmg = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      if ( dmg ) empowered = (dmg.rolls ?? []).map(x => x.formula).join(" | ");
    }
    ctx.expect(/1d6/.test(empowered ?? ""), `Puissance d'outre-tombe : +1d6 aux dégâts de Murmures dissonants (${empowered})`);
  }
};
