/**
 * §354, lot O9a de la repasse des objets : correctifs de contenu. Arène de test (Guerrier, Zombi, Clerc).
 *  1. Torche : l'attaque porte la maîtrise.
 *  2. Sur le Clerc (le Zombi est immunisé contre le poison) — Torpeur ratée : Empoisonné, Vitesse au sol divisée par deux ; Teinture pâle
 *     ratée : plus de soin.
 *  3. Pierre roulante ratée : À terre.
 *  4. Talisman du mal absolu (Fin ultime) raté : Mort, 0 PV.
 *  5. Voleuse de vie (Life Stealing) sur le Clerc (moins de 100 PV) : un échec le tue ; sur le Zombi (Mort-vivant) : jamais.
 *  6. Sceptre de suzeraineté : le Zombi Charmé, blessé par le Guerrier, ne l'est plus.
 *  7. Masse d'anéantissement (sauvegarde) sur le Zombi à 20 PV : ratée → Mort, réussie → Effrayé.
 *  8. Liens de fer de Bilarro : le Zombi Entravé peut tenter de s'en libérer (test DD 20).
 *  9. Armure en adamantium : un coup critique d'office (Guerrier Paralysé, Zombi au contact) devient un coup normal.
 * Les états posés sont retirés, les PV remis, l'enchantement de l'armure retiré.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9a — poisons, pièges, talismans, Voleuse de vie, Sceptre de suzeraineté, Masse d'anéantissement, Liens de fer, adamantium",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Clerc absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Zombi: [at.x + g, at.y], Clerc: [at.x, at.y + 2 * g] } });
    const [zombi, cleric] = await Promise.all(["Zombi", "Clerc"].map(n => ctx.token(n)));
    const hpZ = await ctx.hp(zombi), hpC = await ctx.hp(cleric), hpF = await ctx.hp(fighter);
    const STATUSES = ["dead", "prone", "poisoned", "charmed", "frightened", "restrained", "paralyzed"];
    const clean = async () => {
      for ( const t of [zombi, cleric, fighter] ) for ( const s of STATUSES ) await ctx.removeStatusEffects(t, s).catch(() => {});
      for ( const t of [zombi, cleric] ) await ctx.removeEffectsNamed(t, /Torpor|Pale|Poison|Obedient|Restrained by Iron|Frightened|Empoison/i).catch(() => {});
      await ctx.setHp(zombi, hpZ); await ctx.setHp(cleric, hpC); await ctx.setHp(fighter, hpF);
    };
    ctx.restore(clean);
    const stats = async t => (await ctx.engine("stats", { tokenId: t.id })) ?? {};
    const has = async (t, s) => ((await stats(t)).statuses ?? []).includes(s);
    /** Joue l'activité de l'item sur la cible ; rend la cible de la résolution. */
    const play = async (itemId, activityId, target, user=fighter) => {
      const used = await ctx.use({ tokenId: user.id, itemId, ...(activityId ? { activityId } : { activityType: "attack" }), consume: false, targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } }).catch(err => ({ error: err.message }));
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId).catch(() => null) : null;
      await pause(1500);
      return { t: r?.targets?.find(x => x.name === target.name) ?? null, used };
    };
    /** Rejoue jusqu'à une sauvegarde ratée (12 essais) ; rend la cible. */
    const untilFail = async (itemId, activityId, target, before=async () => {}) => {
      for ( let i = 0; i < 12; i++ ) {
        await before();
        const { t } = await play(itemId, activityId, target);
        if ( t?.save?.success === false ) return t;
      }
      return null;
    };

    // Les corrections de donnée à la création en service (réglage `dataFixes`), le temps du scénario.
    const fixes = await ctx.engine("setting", { key: "dataFixes" });
    ctx.restore(() => ctx.engine("setting", { key: "dataFixes", value: fixes.before }));
    await ctx.engine("setting", { key: "dataFixes", value: true });

    // 1. Torche (prêtée au Zombi : une torche déjà sur une fiche n'a reçu la correction que si elle a été créée depuis).
    const torch = await ctx.ensureItem(zombi, `${PHB}phbagTorch000000`);
    const { used } = await play(torch, "SouNhSdWdnznKCam", fighter, zombi);
    const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
    const formula = attack?.rolls?.[0]?.formula ?? "";
    ctx.expect(/\+ 2\b|\+ 3 \+ 2/.test(formula) && !/\+ 0$/.test(formula), `Torche : la maîtrise est ajoutée (${formula})`);
    await clean();

    // 2. Poisons.
    const torpor = await ctx.ensureItem(fighter, `${DMG}dmgTorpor0000000`);
    const walkOf = async tk => { const st = await stats(tk); return st.speeds?.walk ?? st.speed?.walk ?? st.speed; };
    const walk0 = await walkOf(cleric);
    let t = await untilFail(torpor, "xcXSxZbXxxjJhaUF", cleric, clean);
    const walk1 = await walkOf(cleric);
    ctx.expect(!!t && (await has(cleric, "poisoned")) && (walk1 === Math.floor(walk0 / 2) || walk1 === walk0 / 2), `Torpeur ratée : Empoisonné, Vitesse ${walk0} → ${walk1}`);
    await clean();
    const pale = await ctx.ensureItem(fighter, `${DMG}dmgPaleTincture0`);
    // Le Clerc à 20 PV d'abord (ses PV du monde peuvent être bas) : les 1d6 du poison ne le mettent pas à 0.
    t = await untilFail(pale, "Xm0k8JLnz00jgCg7", cleric, async () => { await clean(); await ctx.setHp(cleric, 20); });
    if ( ctx.expect(!!t, "Teinture pâle ratée") ) {
      // Les dégâts du poison viennent d'être subis : le Clerc n'est pas à son maximum.
      const healed = await ctx.engine("heal", { tokenId: cleric.id, amount: 2 });
      ctx.expect((healed.before > 0) && (healed.after === healed.before), `Teinture pâle : pas de soin tant qu'Empoisonné (${healed.before} → ${healed.after})`);
    }
    await clean();

    // 3. Pierre roulante.
    const stone = await ctx.ensureItem(fighter, `${DMG}dmgRollingStone0`);
    t = await untilFail(stone, "MLbhL4DqA54XPO0N", zombi, clean);
    ctx.expect(!!t && (await has(zombi, "prone")), "Pierre roulante ratée : À terre");
    await clean();

    // 4. Talisman du mal absolu.
    const evil = await ctx.ensureItem(fighter, `${DMG}dmgTalismanOfUlt`);
    t = await untilFail(evil, "zknPGzuSFtET9BIe", zombi, clean);
    ctx.expect(!!t && (await has(zombi, "dead")) && ((await ctx.hp(zombi)) === 0), `Fin ultime ratée : Mort, 0 PV (${await ctx.hp(zombi)})`);
    await clean();

    // 5. Voleuse de vie, posée sur une Dague prêtée au Guerrier (enchantement retiré à la fin).
    const stealerSource = await ctx.ensureItem(fighter, `${DMG}dmgNineLivesStea`);
    const stealer = await ctx.ensureItem(fighter, `${PHB}phbwepDagger0000`);
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const nine = await ctx.engine("enchant", { tokenId: fighter.id, itemId: stealerSource, activityId: "9rvsI8e3iaHSuv1k", targetItemId: stealer }).catch(err => ({ error: err.message }));
    if ( nine?.effectId ) ctx.restore(() => ctx.engine("removeItemEffect", { actorId: ftok.actorId, itemId: stealer, effectId: nine.effectId }).catch(() => {}));
    const acts = Object.values((await ctx.engine("itemData", { tokenId: fighter.id, itemId: stealer, paths: ["system.activities"] }))?.["system.activities"] ?? {});
    const life = acts.find(a => a.type === "save")?._id;
    ctx.expect(!!life, `la Voleuse de vie est posée sur la Dague (${nine?.error ?? `« Life Stealing » ${life ?? "absente"}`})`);
    t = await untilFail(stealer, life, cleric, clean);
    ctx.expect(!!t && (await has(cleric, "dead")), "Voleuse de vie : le Clerc rate et meurt");
    await clean();
    t = await untilFail(stealer, life, zombi, clean);
    ctx.expect(!t || !(await has(zombi, "dead")), "Voleuse de vie : le Zombi (Mort-vivant) ne meurt pas");
    await clean();

    // 6. Sceptre de suzeraineté.
    const rod = await ctx.ensureItem(fighter, `${DMG}dmgRodOfRulershi`);
    t = await untilFail(rod, "DowAEvSCeMqJMEoR", zombi, clean);
    if ( ctx.expect(!!t && (await has(zombi, "charmed")), "Sceptre : le Zombi est Charmé") ) {
      const sword = await ctx.ensureItem(fighter, `${PHB}phbwepLongsword0`);
      for ( let i = 0; (i < 10) && (await has(zombi, "charmed")); i++ ) {
        const { t: hit } = await play(sword, null, zombi);
        if ( hit?.hit ) await pause(1500);
      }
      ctx.expect(!(await has(zombi, "charmed")), "blessé par le Guerrier : plus Charmé");
    }
    await clean();

    // 7. Masse d'anéantissement.
    const mace = await ctx.ensureItem(fighter, `${DMG}dmgMaceOfDisrupt`);
    let dead = false, scared = false;
    for ( let i = 0; (i < 12) && !(dead && scared); i++ ) {
      await clean();
      await ctx.setHp(zombi, 20);
      const { t: s } = await play(mace, "sUoIpd68kJWIxRaU", zombi);
      if ( s?.save?.success === false ) dead = dead || ((await has(zombi, "dead")) && !(await has(zombi, "frightened")));
      if ( s?.save?.success === true ) scared = scared || ((await has(zombi, "frightened")) && !(await has(zombi, "dead")));
    }
    ctx.expect(dead, "Masse : sauvegarde ratée à 20 PV → Mort (pas Effrayé)");
    ctx.expect(scared, "Masse : sauvegarde réussie → Effrayé");
    await clean();

    // 8. Liens de fer.
    const bands = await ctx.ensureItem(fighter, `${DMG}dmgIronBandsOfBi`);
    let bound = false;
    for ( let i = 0; (i < 10) && !bound; i++ ) { await play(bands, "YvxUL75GlG2OoFMg", zombi); bound = await has(zombi, "restrained"); }
    if ( ctx.expect(bound, "Liens de fer : le Zombi est Entravé") ) {
      const e = await ctx.engine("endings", { tokenId: zombi.id });
      const own = (e?.own ?? []).find(x => /Iron|fer/i.test(x.item));
      ctx.expect(!!own && (own.roll === "check") && (own.dc === 20), `le Zombi peut tenter de s'en libérer : ${JSON.stringify(own ?? e)}`);
    }
    await clean();

    // 9. Armure en adamantium.
    const ada = await ctx.ensureItem(fighter, `${DMG}dmgAdamantineArm`);
    const mail = await ctx.ensureItem(fighter, `${PHB}phbarmChainMail0`);
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const was = await ctx.engine("itemData", { tokenId: fighter.id, itemId: mail, paths: ["system.equipped"] });
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData: { system: { equipped: was?.["system.equipped"] ?? false } }, match: { path: "_id", value: mail } }).catch(() => {}));
    const done = await ctx.engine("enchant", { tokenId: fighter.id, itemId: ada, activityId: "C5NIsXGUzK4QmD9U", targetItemId: mail }).catch(err => ({ error: err.message }));
    if ( done?.effectId ) ctx.restore(() => ctx.engine("removeItemEffect", { actorId: tok.actorId, itemId: mail, effectId: done.effectId }).catch(() => {}));
    if ( ctx.expect(!!done?.effectId, `l'adamantium est posé sur la Cotte de mailles (${done?.error ?? "ok"})`) ) {
      await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData: { system: { equipped: true } }, match: { path: "_id", value: mail } });
      await ctx.call("set-status", { tokenId: fighter.id, statusId: "paralyzed", active: true });
      const slam = await ctx.itemId(zombi.id, "slam");
      let judged = null;
      for ( let i = 0; (i < 12) && !judged; i++ ) {
        await ctx.setHp(fighter, hpF);
        const { t: hit } = await play(slam, null, fighter, zombi);
        if ( hit?.hit ) judged = hit;
      }
      ctx.expect(!!judged && !judged.critical && judged.uncritted === true, `Guerrier Paralysé en adamantium : coup normal (${JSON.stringify(judged && { critical: judged.critical, uncritted: judged.uncritted, reason: judged.reason })})`);
    }
  }
};
