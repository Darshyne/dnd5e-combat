/**
 * Sorts du clerc et du druide codés mais jamais joués (issues #4 à #6, le 2026-09-27). Le Clerc lance (sorts ajoutés à
 * volonté pour le scénario, retirés à la fin), le Zombi (mort-vivant) frappe ou subit :
 *  1. Protection contre le mal et le bien sur le Guerrier : l'attaque du Zombi a le Désavantage ; sans la protection, non.
 *  2. Lien de protection sur le Guerrier : le Zombi le touche, le Clerc perd autant de PV — par le moteur (le drapeau de
 *     BLFX, s'il en pose un, est retiré de l'effet pour que ce soit le moteur qui partage).
 *  3. Cécité/surdité sur le Zombi, Cécité choisie : un seul effet (Aveuglé) ; au combat, sauvegarde répétée à la fin de
 *     chacun de ses tours, l'effet tombe sur une réussite.
 *  4. Tempête de neige sur le Zombi : sauvegarde de Dextérité à la pose, À terre sur un échec ; au début de son tour, le
 *     sort rejoue (message marqué `areaTick`).
 *  5. Aura de vitalité, « Soins de début de tour » sur le Guerrier blessé : le soin lancé est appliqué.
 *  6. Convocation de fée, au combat : l'esprit entre juste après le Clerc (initiative entre le Clerc et le suivant) ; la fin
 *     de la concentration le retire. Placement à une case fixe (`api.mcp.summonAt`).
 * Chaque partie remet PV, effets, états, zones, positions et combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };

export default {
  name: "sorts codés — Protection contre le mal et le bien, Lien de protection, Cécité/surdité, Tempête de neige, Aura de vitalité, Convocation de fée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbEvilAndGoodPr", "phbsplWardingBon", "phbsplBlindnessD"] ) await ctx.ensureItem(cleric, SRD + id, atWill);
    for ( const id of ["phbsplSleetStorm", "phbsplAuraofVita", "phbsplSummonFey0"] ) await ctx.ensureItem(cleric, PHB + id, atWill);

    const all = [cleric, fighter, zombi];
    const hp0 = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const home = await ctx.position(zombi);
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id)) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const regions = [];
    const reset = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) await clearNew(t);
      for ( const t of all ) await ctx.setHp(t, hp0.get(t.id));
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };
    const named = async (t, pattern) => (await ctx.effects(t)).filter(e => pattern.test(e.name ?? ""));
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);
    const castOn = async (identifier, target, extra={}) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, consume: false, targetTokenIds: [target.id], ...extra });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return used;
    };
    const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = zItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    const nextTo = async t => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: p.elevation });
      await pause(800);
    };
    /** Une attaque du Zombi ; `untilHit` : rejouée jusqu'à toucher. Rend la résolution, le jet et les messages. */
    const strike = async (target, { untilHit=false }={}) => {
      for ( let i = 0; i < (untilHit ? 20 : 1); i++ ) {
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [target.id] });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
        await pause(2500);
        const messages = await ctx.messagesSince(since);
        const hit = !!r.targets.find(t => t.name === target.name)?.hit;
        if ( untilHit && !hit ) { await ctx.setHp(target, hp0.get(target.id)); continue; }
        return { r, hit, messages, attack: rollOf(messages.find(m => m.type === "attack")) };
      }
      return null;
    };
    const combatWith = async (list, initiatives) => {
      await ctx.startCombat(list);
      const c = await ctx.combat();
      for ( const [t, value] of initiatives ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      return ctx.combat();
    };
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };

    // 1. Protection contre le mal et le bien.
    await part("Protection contre le mal et le bien", async () => {
      if ( !ctx.expect(!!weapon, `le Zombi a une attaque (${weapon?.name})`) ) return;
      await castOn("protection-from-evil-and-good", fighter);
      ctx.expect((await named(fighter, /Protégé|Protected/i)).length === 1, "Protection : l'effet est posé sur le Guerrier");
      await nextTo(fighter);
      const withIt = await strike(fighter);
      ctx.expect(withIt?.attack?.options?.advantageMode === -1, `attaque du Zombi (mort-vivant) contre le Guerrier protégé : Désavantage (${withIt?.attack?.formula}, mode ${withIt?.attack?.options?.advantageMode})`);
      await clearNew(fighter);
      await clearNew(cleric);
      await pause(800);
      const without = await strike(fighter);
      ctx.expect(without?.attack?.options?.advantageMode !== -1, `sans la protection : pas de Désavantage (${without?.attack?.formula}, mode ${without?.attack?.options?.advantageMode})`);
    });

    // 2. Lien de protection, par le moteur.
    await part("Lien de protection", async () => {
      if ( !weapon ) return;
      await castOn("warding-bond", fighter);
      const bond = (await named(fighter, /^Lié$|Warding Bond|Bond/i))[0];
      if ( !ctx.expect(!!bond, "Lien de protection : l'effet « Lié » est posé sur le Guerrier") ) return;
      if ( bond.flags?.["boss-loot-assets-premium"]?.blfxCustom ) {
        await ctx.call("upsert-embedded-effect", { ...(await targetOf(fighter)), match: { path: "_id", value: bond._id ?? bond.id },
          effectData: { "flags.boss-loot-assets-premium.-=blfxCustom": null } });
        ctx.log("drapeau BLFX retiré de l'effet : c'est le moteur qui partage");
      }
      await nextTo(fighter);
      const clericBefore = await ctx.hp(cleric);
      const hit = await strike(fighter, { untilHit: true });
      if ( !ctx.expect(!!hit, "le Zombi touche le Guerrier (20 essais au plus)") ) return;
      const lostFighter = hp0.get(fighter.id) - await ctx.hp(fighter);
      const lostCleric = clericBefore - await ctx.hp(cleric);
      const shared = hit.messages.some(m => m.flags?.[MODULE_ID]?.shared) || (await ctx.engineLog()).slice(-15).some(l => /partag|Lien/i.test(l));
      ctx.expect(shared, "partage annoncé par le moteur");
      ctx.expect((lostFighter > 0) && (lostCleric === Math.min(lostFighter, clericBefore)), `le Guerrier perd ${lostFighter} PV, le Clerc aussi : ${lostCleric}`);
    });

    // 3. Cécité/surdité, Cécité choisie, puis sauvegarde répétée en fin de tour.
    await part("Cécité/surdité", async () => {
      let blinded = null;
      for ( let n = 1; (n <= 20) && !blinded; n++ ) {
        await castOn("blindness-deafness", zombi, { activityType: "save", usageConfig: { [MODULE_ID]: { choice: "MIYqFloILx3luzwc" } } });
        const posed = await named(zombi, /Cécité|Surdité|Blind|Deaf/i);
        if ( posed.length ) blinded = posed;
      }
      if ( !ctx.expect(!!blinded, "Cécité/surdité : le Zombi rate une sauvegarde (20 essais au plus)") ) return;
      ctx.expect((blinded.length === 1) && (await statuses(zombi)).includes("blinded") && !(await statuses(zombi)).includes("deafened"),
        `un seul effet, Aveuglé (${blinded.map(e => e.name).join(", ")})`);
      await combatWith([cleric, zombi], [[cleric, 20], [zombi, 10]]);
      // Le sort dure 1 minute (10 rounds) : on s'arrête avant, pour que l'effet ne tombe que sur une sauvegarde réussie.
      // Deux combattants : un changement de tour sur deux finit le tour du Zombi.
      let removed = null;
      let resaves = 0;
      for ( let turn = 0; (turn < 16) && !removed; turn++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(2500);
        const resave = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);
        if ( !resave ) continue;
        resaves++;
        const r = await ctx.settle(resave.id).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        await pause(800);
        const still = (await statuses(zombi)).includes("blinded");
        ctx.expect(!!t?.save && (still === !t.save.success), `sauvegarde répétée ${t?.save?.total} contre DD ${r?.plan?.save?.dc} : ${t?.save?.success ? "réussie, Aveuglé retiré" : "ratée, Aveuglé reste"}`);
        if ( !still ) removed = t;
      }
      ctx.expect(resaves > 0, `sauvegarde répétée jouée à la fin des tours du Zombi (${resaves})`);
      ctx.expect(!!removed?.save?.success, "Aveuglé tombe sur une sauvegarde répétée réussie (en 8 rounds au plus)");
      await endCombat();
    });

    // 4. Tempête de neige : pose, À terre sur un échec, rejeu au début du tour du Zombi.
    await part("Tempête de neige", async () => {
      // Posée jusqu'à une sauvegarde ratée (au plus 10 fois) : on veut voir À terre posé, pas seulement son absence.
      let failed = false;
      for ( let n = 1; (n <= 10) && !failed; n++ ) {
        for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
        await ctx.removeEffectsNamed(cleric, /concentr/i);
        await ctx.removeStatusEffects(zombi, "prone");
        const box = await ctx.box(zombi);
        const used = await ctx.use({ tokenId: cleric.id, identifier: "sleet-storm", activityType: "save", consume: false,
          area: { shape: "circle", x: box.x + (box.width / 2), y: box.y + (box.height / 2), radius: Math.round(grid * 0.9) } });
        if ( used.regionId ) regions.push(used.regionId);
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        await pause(1500);
        const t = r?.targets?.find(x => x.name === "Zombi");
        if ( !ctx.expect(!!t?.save, `Tempête de neige : sauvegarde du Zombi à la pose (${t?.save?.total ?? "aucune"} contre DD ${r?.plan?.save?.dc})`) ) return;
        ctx.expect((await statuses(zombi)).includes("prone") === !t.save.success, `À terre ⇔ sauvegarde ratée (${t.save.success ? "réussie, debout" : "ratée, À terre"})`);
        failed = !t.save.success;
      }
      ctx.expect(failed, "au moins une sauvegarde ratée vue (10 poses au plus)");
      await ctx.removeStatusEffects(zombi, "prone");
      await combatWith([cleric, zombi], [[cleric, 20], [zombi, 10]]);
      const since = await ctx.lastMessageId();
      await ctx.nextTurn();   // Clerc → Zombi : début de son tour dans la zone
      await pause(3500);
      const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick));
      ctx.expect(!!tick, "début du tour du Zombi dans la zone : le sort rejoue (message marqué areaTick)");
      await endCombat();
    });

    // 5. Aura de vitalité : le soin de début de tour.
    await part("Aura de vitalité", async () => {
      await ctx.setHp(fighter, Math.max(1, hp0.get(fighter.id) - 9));
      const before = await ctx.hp(fighter);
      const used = await ctx.use({ tokenId: cleric.id, identifier: "aura-of-vitality", activityId: "0vYjMbBcXaMfGWR2", consume: false, targetTokenIds: [fighter.id] });
      await pause(1200);
      await ctx.engine("rollCard", { messageId: used.usageMessageId });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      const healing = rollOf((await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "healing" || m.type === "damage"));
      const after = await ctx.hp(fighter);
      ctx.expect(!!r && (r.step === "done"), `résolution tranchée (${r?.step ?? "aucune"})`);
      ctx.expect((after > before) && (after - before === Math.min(healing?.total ?? -1, hp0.get(fighter.id) - before)),
        `soin appliqué : ${before} → ${after} PV (jet ${healing?.total ?? "?"})`);
    });

    // 6. Convocation de fée, au combat.
    await part("Convocation de fée", async () => {
      await combatWith([cleric, zombi], [[cleric, 15], [zombi, 10]]);
      const p = await ctx.position(cleric);
      const itemId = await ctx.itemId(cleric.id, "summon-fey");
      const s = await ctx.engine("summonAt", { tokenId: cleric.id, itemId, x: p.x + grid, y: p.y + grid });
      const spirit = s?.tokens?.[0];
      if ( !ctx.expect(!!spirit, `un esprit féerique est invoqué (${spirit?.name ?? JSON.stringify(s)})`) ) return;
      await pause(2500);
      const c = await ctx.combat();
      const cb = (c.combatants ?? []).find(x => (x.tokenId === spirit.id) || (x.name === spirit.name));
      ctx.expect(!!cb && (cb.initiative < 15) && (cb.initiative > 10), `il entre au combat juste après le Clerc (initiative ${cb?.initiative ?? "absente"})`);
      await ctx.removeEffectsNamed(cleric, /concentr/i);
      await pause(2500);
      const left = await ctx.liveTokens();
      ctx.expect(!left.some(t => t.id === spirit.id), "fin de la concentration : l'esprit est retiré");
      await endCombat();
    });
  }
};
