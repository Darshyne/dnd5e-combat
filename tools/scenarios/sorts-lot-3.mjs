/**
 * §91 — Sorts dont la zone agit au tour du lanceur (`casterPulse`). Le Magicien reçoit, prêtés depuis le compendium du Manuel des
 * joueurs, Tempête vengeresse et Tremblement de terre (lancés sans emplacement : `use-activity` ne consomme rien).
 *  - Tempête vengeresse : la pose (Constitution) ; au début du tour suivant du Magicien, la pluie acide sur ce qui est sous le nuage
 *    (dégâts sans sauvegarde) ; au début du suivant, les éclairs (Dextérité, six cibles au plus).
 *  - Tremblement de terre, loin du Magicien : la pose (Dextérité, À terre ⇔ ratée) ; à la fin du tour du Magicien, la même
 *    sauvegarde rejouée sur les créatures au sol de la zone.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "sorts au tour du lanceur — Tempête vengeresse, Tremblement de terre",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Zombi ou Bandit absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    for ( const t of [mage, zombi, bandit] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const zmax0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
      data: zmax0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": zmax0 } }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const bmax0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: bmax0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": bmax0 } }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const mhp = await ctx.hp(mage);
    const clear = async () => { for ( const t of [mage, zombi, bandit] ) { await ctx.removeStatusEffects(t, "prone"); await ctx.removeEffectsNamed(t, /Assourdi|Deafened/i); } };
    ctx.restore(clear);
    const endConcentration = async () => {
      const actor = await ctx.call("get-actor", { actorId: mage.actorId });
      for ( const e of (actor.effects ?? []).filter(e => /concentr/i.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
      await pause(1500);
    };
    ctx.restore(endConcentration);

    const storm = await ctx.ensureItem(mage, `${SPELLS}.phbsplStormofVen`);
    const quake = await ctx.ensureItem(mage, `${SPELLS}.phbsplEarthquake`);
    const centreOf = async t => { const b = await ctx.box(t); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const pulses = async since => (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick?.event === "casterPulse"));

    await ctx.startCombat([mage, zombi, bandit]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    let combat = await state();
    for ( const [t, v] of [[mage, 20], [zombi, 10], [bandit, 5]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const toMage = async () => { for ( let i = 0; (i < 4) && ((await current()) !== mage.id); i++ ) { await ctx.nextTurn(); await pause(2500); } };
    for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    ctx.expect((await current()) === mage.id, "tour du Magicien");

    // 1. Tempête vengeresse : Zombi et Bandit à 10 cases du Magicien, sous un nuage réduit à 4 cases autour du Zombi — le Magicien hors
    // du nuage (sous lui, l'acide le blesserait et sa concentration pourrait tomber : la règle).
    const m0 = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: m0.x + 10 * grid, y: m0.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: m0.x + 10 * grid, y: m0.y + grid, elevation: 0 });
    await pause(800);
    const c1 = await centreOf(zombi);
    const used = await ctx.use({ tokenId: mage.id, itemId: storm, activityType: "save", area: { shape: "circle", ...c1, radius: 4 * grid } });
    ctx.expect(used.used && !!used.regionId, "Tempête vengeresse posée");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    const cast = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    const zcast = cast?.targets?.find(t => t.name === "Zombi");
    ctx.expect(cast?.plan?.save?.ability === "con" && !!zcast?.save, `la pose : sauvegarde de Constitution du Zombi (${zcast?.save?.total} contre DD ${cast?.plan?.save?.dc})`);
    const region = used.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: used.regionId }).catch(() => null))?.data : null;
    ctx.expect(region?.flags?.[MODULE_ID]?.area?.source?.endsWith?.(mage.id) === true, `la zone retient son lanceur (${region?.flags?.[MODULE_ID]?.area?.source ?? "absent"})`);

    // Tour suivant du Magicien : la pluie acide.
    let since = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(2000); await toMage(); await pause(3000);
    let p = await pulses(since);
    if ( ctx.expect(p.length === 1, `début du 2ᵉ tour du Magicien : un rejeu de la tempête (${p.length})`) ) {
      const r = await ctx.settle(p[0].id, { timeoutMs: 45000 }).catch(() => null);
      const names = (r?.targets ?? []).map(t => t.name);
      const z = r?.targets?.find(t => t.name === "Zombi");
      ctx.expect(names.includes("Zombi") && names.includes("Bandit"), `pluie acide sur ${names.join(", ")}`);
      ctx.expect(!r?.plan?.save && ((z?.damage?.applied ?? 0) > 0) && ((z?.damage?.applied ?? 0) <= 24), `4d6 d'acide, sans sauvegarde (Zombi : ${z?.damage?.applied})`);
    }
    // Tour suivant : les éclairs.
    since = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(2000); await toMage(); await pause(3000);
    p = await pulses(since);
    if ( ctx.expect(p.length === 1, `début du 3ᵉ tour : un rejeu (${p.length})`) ) {
      const r = await ctx.settle(p[0].id, { timeoutMs: 60000 }).catch(() => null);
      const z = r?.targets?.find(t => t.name === "Zombi");
      ctx.expect(r?.plan?.save?.ability === "dex" && (r?.targets?.length ?? 0) <= 6 && !!z?.save, `éclairs : sauvegarde de Dextérité, ${r?.targets?.length} cible(s) (Zombi ${z?.save?.total} contre DD ${r?.plan?.save?.dc})`);
      const hostileFirst = (r?.targets ?? []).findIndex(t => t.name === "Magicien");
      ctx.expect((hostileFirst === -1) || (r.targets.length < 6) || (hostileFirst >= r.targets.filter(t => ["Zombi", "Bandit"].includes(t.name)).length),
        `les ennemis d'abord (${(r?.targets ?? []).map(t => t.name).join(", ")})`);
    }
    await endConcentration();
    await clear();
    await ctx.setHp(mage, mhp);

    // 2. Tremblement de terre : le Zombi et le Bandit à 24 cases du Magicien (30 m de rayon : le Magicien hors de la zone).
    await ctx.call("move-token", { tokenId: mage.id, x: 3080, y: 1680, elevation: 0 });
    await ctx.call("move-token", { tokenId: zombi.id, x: 3080, y: 1680 + 24 * grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: 3080 + grid, y: 1680 + 24 * grid, elevation: 0 });
    await pause(1000);
    const c2 = await centreOf(zombi);
    const q = await ctx.use({ tokenId: mage.id, itemId: quake, activityType: "save", area: { shape: "circle", ...c2, radius: 20 * grid } });
    ctx.expect(q.used && !!q.regionId, "Tremblement de terre posé");
    if ( q.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: q.regionId }).catch(() => {}));
    const qcast = await ctx.settle(q.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    const zq = qcast?.targets?.find(t => t.name === "Zombi");
    await pause(1500);
    const proneOf = async t => (await ctx.effects(t)).some(e => !e.disabled && (e.statuses ?? []).includes("prone"));
    ctx.expect(qcast?.plan?.save?.ability === "dex" && !!zq?.save, `la pose : sauvegarde de Dextérité du Zombi (${zq?.save?.total} contre DD ${qcast?.plan?.save?.dc})`);
    ctx.expect((await proneOf(zombi)) === (zq?.save?.success === false), `Zombi À terre ⇔ sauvegarde ratée (${zq?.save?.success ? "réussie" : "ratée"})`);
    ctx.expect(!(qcast?.targets ?? []).some(t => t.name === "Magicien"), "le Magicien, hors de la zone, n'est pas visé");
    await clear();
    // Fin du tour du Magicien : la sauvegarde rejouée.
    since = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(3500);
    p = await pulses(since);
    if ( ctx.expect(p.length === 1, `fin du tour du Magicien : un rejeu du séisme (${p.length})`) ) {
      const r = await ctx.settle(p[0].id, { timeoutMs: 45000 }).catch(() => null);
      const z = r?.targets?.find(t => t.name === "Zombi");
      await pause(1500);
      ctx.expect(r?.plan?.save?.ability === "dex" && !!z?.save, `rejeu : Dextérité du Zombi (${z?.save?.total} contre DD ${r?.plan?.save?.dc})`);
      ctx.expect((await proneOf(zombi)) === (z?.save?.success === false), `rejeu : À terre ⇔ ratée (${z?.save?.success ? "réussie" : "ratée"})`);
    }
    await endConcentration();
    await clear();

    // 3. Boule de feu à retardement : la bille sur le Zombi ; un tour du Magicien qui s'achève l'enrichit d'un d6 ; la concentration
    // rompue, elle explose (Dextérité, 12d6 + 1d6).
    const fireball = await ctx.ensureItem(mage, `${SPELLS}.phbsplDelayedBla`);
    const uses = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === fireball)?.system?.uses ?? {};
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.uses.spent": 10 }, match: { path: "_id", value: fireball } });
    await toMage();
    ctx.expect((await current()) === mage.id, "de nouveau le tour du Magicien");
    const c3 = await centreOf(zombi);
    const bead = await ctx.use({ tokenId: mage.id, itemId: fireball, activityType: "utility", area: { shape: "circle", ...c3, radius: grid / 5 } });
    ctx.expect(bead.used && !!bead.regionId, "la bille est posée");
    await pause(2500);
    const beadRegion = bead.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: bead.regionId }).catch(() => null))?.data : null;
    ctx.expect(!!beadRegion?.flags?.[MODULE_ID]?.area?.usage, "la bille est une zone qui dure");
    const u0 = await uses();
    since = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(4000);
    const u1 = await uses();
    ctx.expect((u1.spent ?? 10) === (u0.spent ?? 10) - 1, `fin du tour du Magicien : un d6 de plus (utilisations dépensées ${u0.spent} → ${u1.spent})`);
    const zhp = await ctx.hp(zombi);
    since = await ctx.lastMessageId();
    await endConcentration();
    await pause(4000);
    const blast = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && /explosion/i.test(JSON.stringify(m.system?.activity ?? m.flavor ?? "")) ) ??
      (await ctx.messagesSince(since)).find(m => m.type === "usage");
    if ( ctx.expect(!!blast, "la concentration rompue : l'explosion part") ) {
      const r = await ctx.settle(blast.id, { timeoutMs: 60000 }).catch(() => null);
      const z = r?.targets?.find(t => t.name === "Zombi");
      ctx.expect(r?.plan?.save?.ability === "dex" && !!z?.save, `explosion : Dextérité du Zombi (${z?.save?.total} contre DD ${r?.plan?.save?.dc})`);
      const dmg = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const formula = (dmg?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/12d6/.test(formula) && /\(?1\)?d6/.test(formula.replace("12d6", "")), `12d6 + 1d6 de feu (${formula})`);
      ctx.expect((await ctx.hp(zombi)) < zhp, `le Zombi est blessé (${zhp} → ${await ctx.hp(zombi)})`);
    }
    await clear();

    // 4. Tsunami : un mur (zone de 2 cases de rayon) à 4 cases du Magicien, le Zombi 10 cases plus loin. Au début du tour suivant du
    // Magicien, le mur s'éloigne de 15 m (sur le Zombi), une utilisation payée (6 → 5), Force ou 5d10. Puis, la dernière utilisation
    // payée, le sort prend fin.
    const tsunami = await ctx.ensureItem(mage, `${SPELLS}.phbsplTsunami000`);
    const tuses = async () => ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === tsunami)?.system?.uses ?? {};
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: tsunami } });
    await toMage();
    const m4 = await ctx.position(mage);
    await ctx.call("move-token", { tokenId: zombi.id, x: m4.x + 14 * grid, y: m4.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: m4.x, y: m4.y + 6 * grid, elevation: 0 });
    await pause(1000);
    const wallAt = { x: m4.x + 4.5 * grid, y: m4.y + grid / 2 };
    const w = await ctx.use({ tokenId: mage.id, itemId: tsunami, activityType: "save", area: { shape: "circle", ...wallAt, radius: 2 * grid } });
    ctx.expect(w.used && !!w.regionId, "Tsunami posé");
    if ( w.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: w.regionId }).catch(() => {}));
    await ctx.settle(w.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
    since = await ctx.lastMessageId();
    await ctx.nextTurn(); await pause(1500); await toMage(); await pause(4000);
    const wall = w.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: w.regionId }).catch(() => null))?.data : null;
    const shape = wall?.shapes?.[0];
    ctx.expect(!!shape && Math.abs((shape.x ?? 0) - (wallAt.x + 10 * grid)) < grid / 2, `le mur s'éloigne de 15 m (centre x ${Math.round(wallAt.x)} → ${Math.round(shape?.x ?? 0)})`);
    ctx.expect((await tuses()).spent === 1, `une utilisation payée (${(await tuses()).spent} dépensée)`);
    p = await pulses(since);
    if ( ctx.expect(p.length === 1, `début du tour suivant du Magicien : le mur frappe (${p.length})`) ) {
      const r = await ctx.settle(p[0].id, { timeoutMs: 45000 }).catch(() => null);
      const z = r?.targets?.find(t => t.name === "Zombi");
      ctx.expect(r?.plan?.save?.ability === "str" && !!z?.save, `Force du Zombi (${z?.save?.total} contre DD ${r?.plan?.save?.dc})`);
      const dmg = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      const formula = (dmg?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/\(?5\)?d10/.test(formula), `5d10 contondants (${formula})`);
    }
    // La dernière utilisation : le sort prend fin.
    await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.uses.spent": 5 }, match: { path: "_id", value: tsunami } });
    await ctx.nextTurn(); await pause(1500); await toMage(); await pause(5000);
    const gone = w.regionId ? !(await ctx.call("get-scene-object", { type: "Region", objectId: w.regionId }).catch(() => null))?.data : false;
    const conc = ((await ctx.call("get-actor", { actorId: mage.actorId })).effects ?? []).some(e => /concentr/i.test(e.name ?? "") && /Tsunami/i.test(e.name ?? ""));
    ctx.expect(gone && !conc, `plus d'utilisation : le mur disparaît, la concentration prend fin (${gone ? "zone retirée" : "zone là"}, ${conc ? "concentration là" : "plus de concentration"})`);
    await endConcentration();
    await clear();

    // 5. Symbole, Discorde : sur le Zombi jusqu'à un échec ; ses attaques et ses tests au Désavantage.
    const symbol = await ctx.ensureItem(mage, `${SPELLS}.phbsplSymbol0000`);
    const z5 = await centreOf(zombi);
    let discord = false;
    for ( let n = 0; (n < 12) && !discord; n++ ) {
      await ctx.removeEffectsNamed(zombi, /chamaille|Discord|Bicker/i);
      const s = await ctx.use({ tokenId: mage.id, itemId: symbol, activityId: "DHsotF5GdSA4Nrpz", area: { shape: "circle", ...z5, radius: grid } });
      if ( s.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: s.regionId }).catch(() => {}));
      await ctx.settle(s.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      discord = (await ctx.effects(zombi)).some(e => /chamaille|Discord|Bicker/i.test(e.name ?? ""));
    }
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /chamaille|Discord|Bicker/i));
    if ( ctx.expect(discord, "Discorde posée sur le Zombi (12 essais au plus)") ) {
      const check = await ctx.engine("rollCheck", { tokenId: zombi.id, ability: "str" });
      ctx.expect(/kl|dis/.test(check?.formula ?? ""), `test de Force du Zombi au Désavantage (${check?.formula})`);
      since = await ctx.lastMessageId();
      await ctx.use({ tokenId: zombi.id, identifier: "slam", activityType: "attack", targetTokenIds: [mage.id] });
      await pause(4000);
      const attack = (await ctx.messagesSince(since)).find(m => m.type === "attack");
      ctx.expect(attack?.rolls?.[0]?.options?.advantageMode === -1, `attaque du Zombi au Désavantage (mode ${attack?.rolls?.[0]?.options?.advantageMode})`);
    }
    await ctx.removeEffectsNamed(zombi, /chamaille|Discord|Bicker/i);

    // 6. Interdiction : une zone de 4 × 4 cases à l'est du Zombi et du Bandit ; tous deux y entrent — le Zombi (mort-vivant) subit
    // 5d10, le Bandit (humanoïde) rien.
    const forbiddance = await ctx.ensureItem(mage, `${SPELLS}.phbsplForbiddanc`);
    const m6 = await ctx.position(mage);
    const zoneAt = { x: m6.x + 6 * grid, y: m6.y + 6 * grid, width: 4 * grid, height: 4 * grid };
    await ctx.call("move-token", { tokenId: zombi.id, x: zoneAt.x - 2 * grid, y: zoneAt.y + grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: zoneAt.x - 2 * grid, y: zoneAt.y + 2 * grid, elevation: 0 });
    await pause(800);
    const f = await ctx.use({ tokenId: mage.id, itemId: forbiddance, activityType: "utility", area: { shape: "rectangle", ...zoneAt } });
    ctx.expect(f.used && !!f.regionId, "Interdiction posée");
    if ( f.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: f.regionId }).catch(() => {}));
    await pause(2500);
    const fz = f.regionId ? (await ctx.call("get-scene-object", { type: "Region", objectId: f.regionId }).catch(() => null))?.data : null;
    ctx.expect(fz?.flags?.[MODULE_ID]?.area?.on?.includes("enter") === true, `zone qui dure, à l'entrée et en fin de tour (${fz?.flags?.[MODULE_ID]?.area?.on?.join(", ")})`);
    const zh0 = await ctx.hp(zombi), bh0 = await ctx.hp(bandit);
    since = await ctx.lastMessageId();
    await ctx.call("move-token", { tokenId: zombi.id, x: zoneAt.x + grid, y: zoneAt.y + grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: zoneAt.x + grid, y: zoneAt.y + 2 * grid, elevation: 0 });
    await pause(6000);
    const ticks = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.areaTick?.event === "enter");
    for ( const t of ticks ) await ctx.settle(t.id, { timeoutMs: 45000 }).catch(() => null);
    await pause(1500);
    const zh1 = await ctx.hp(zombi), bh1 = await ctx.hp(bandit);
    ctx.expect((zh1 < zh0) && (zh0 - zh1 <= 50), `le Zombi entre : 5d10 (${zh0} → ${zh1})`);
    ctx.expect(bh1 === bh0, `le Bandit entre : rien (${bh0} → ${bh1})`);
  }
};
