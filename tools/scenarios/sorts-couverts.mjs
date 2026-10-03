/**
 * Sorts que dnd5e couvre seul (données du système, résolution du moteur), jamais essayés (issues #3 à #6, le 2026-09-27).
 * Le Clerc lance (sorts ajoutés à volonté pour le scénario, retirés à la fin). Valeurs calculées lues par `api.mcp.stats`,
 * soins lancés par `api.mcp.rollCard` (le clic « Soins » de la carte).
 *  - Bénédiction (Guerrier) : +1d4 aux attaques et aux sauvegardes. Imprécation (Zombi, sauvegarde ratée) : -1d4.
 *  - Bouclier de la foi (Guerrier) : CA +2. Peau d'écorce (Zombi, CA 8) : CA 17. Armure du mage (Magicien) : 13 + Dex.
 *  - Grande foulée (Guerrier) : vitesse +10 ft. Saut (Guerrier) : l'effet est posé (le reste se joue à la main).
 *  - Mot de guérison (Guerrier), Mot de guérison de groupe (Guerrier et Magicien) : le soin lancé est appliqué.
 *  - Blessure, Boule de feu (Zombi) : sauvegarde, dégâts entiers ou moitié.
 *  - Mot de radiance : Zombi et Guerrier au contact du Clerc, seul le Zombi (l'ennemi) est pris.
 *  - Amitié avec les animaux : le Zombi (mort-vivant) n'est pas charmé ; le Loup (bête), sur un échec, Charmé.
 *  - Injonction (Zombi) : la sauvegarde est demandée et tranchée (l'ordre se joue à la main).
 * Chaque partie remet PV, effets, états, positions et zones.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };
const total = m => (m?.rolls ?? []).reduce((sum, r) => sum + (((typeof r === "string") ? JSON.parse(r) : r)?.total ?? 0), 0);

export default {
  name: "sorts couverts par dnd5e — bonus, CA, vitesse, soins, dégâts, cibles",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const needed = ["Clerc", "Guerrier", "Zombi", "Magicien", "Loup"];
    if ( !needed.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${needed.join(", ")} : l'un manque, non applicable`); return; }
    const [cleric, fighter, zombi, mage, wolf] = await Promise.all(needed.map(n => ctx.token(n)));
    const all = [cleric, fighter, zombi, mage, wolf];
    const grid = await ctx.gridSize();
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbsplBless00000", "phbsplBane000000", "phbsplShieldofFa", "phbsplBarkskin00", "phbsplLongstride",
      "phbsplJump000000", "phbsplMageArmor0", "phbsplHealingWor", "phbsplMassHealin", "phbsplInflictWou", "phbsplFireball00",
      "phbsplAnimalFrie", "phbsplCommand000"] ) await ctx.ensureItem(cleric, SRD + id, atWill);
    await ctx.ensureItem(cleric, PHB + "phbsplWordofRadi", atWill);

    const hp0 = new Map();
    const effects0 = new Map();
    const home = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
      home.set(t.id, await ctx.position(t));
    }
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
      for ( const t of all ) {
        const now = await ctx.position(t);
        const h = home.get(t.id);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };
    const stats = t => ctx.engine("stats", { tokenId: t.id });
    const cast = async (identifier, targets, extra={}) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, consume: false, targetTokenIds: targets.map(t => t.id), ...extra });
      if ( extra.roll ) { await pause(1200); await ctx.engine("rollCard", { messageId: used.usageMessageId }); }
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return { used, r };
    };
    /** Rejoue jusqu'à ce que `target` rate sa sauvegarde (20 fois au plus) ; rend la dernière résolution. */
    const untilFailed = async (identifier, target, extra={}) => {
      for ( let n = 1; n <= 20; n++ ) {
        const c = await cast(identifier, [target], extra);
        const t = c.r?.targets?.find(x => x.name === target.name);
        if ( t?.save && !t.save.success ) return { ...c, t };
        await clearNew(target);
        await clearNew(cleric);
      }
      return null;
    };
    const hurt = async t => { await ctx.setHp(t, Math.max(1, hp0.get(t.id) - 8)); return ctx.hp(t); };
    const has = (bonus, piece) => String(bonus ?? "").replace(/\s+/g, "").includes(piece);

    await part("Bénédiction", async () => {
      await cast("bless", [fighter]);
      const s = await stats(fighter);
      ctx.expect(has(s.bonuses.mwak, "1d4") && has(s.bonuses.save, "1d4"), `Bénédiction : +1d4 aux attaques (${s.bonuses.mwak}) et aux sauvegardes (${s.bonuses.save})`);
    });
    await part("Imprécation", async () => {
      const c = await untilFailed("bane", zombi, { activityType: "save" });
      if ( !ctx.expect(!!c, "Imprécation : le Zombi rate une sauvegarde (20 essais au plus)") ) return;
      const s = await stats(zombi);
      ctx.expect(has(s.bonuses.mwak, "-1d4") && has(s.bonuses.save, "-1d4"), `Imprécation : -1d4 aux attaques (${s.bonuses.mwak}) et aux sauvegardes (${s.bonuses.save})`);
    });
    await part("Bouclier de la foi", async () => {
      const before = (await stats(fighter)).ac;
      await cast("shield-of-faith", [fighter]);
      const after = (await stats(fighter)).ac;
      ctx.expect(after === before + 2, `Bouclier de la foi : CA ${before} → ${after}`);
    });
    await part("Peau d'écorce", async () => {
      const before = (await stats(zombi)).ac;
      await cast("barkskin", [zombi]);
      const after = (await stats(zombi)).ac;
      ctx.expect(after === Math.max(before, 17), `Peau d'écorce : CA ${before} → ${after} (17 au moins)`);
    });
    await part("Armure du mage", async () => {
      const before = await stats(mage);
      await cast("mage-armor", [mage]);
      const after = await stats(mage);
      ctx.expect(after.ac === Math.max(before.ac, 13 + (after.mods.dex ?? 0)), `Armure du mage : CA ${before.ac} → ${after.ac} (13 + Dex ${after.mods.dex})`);
    });
    await part("Grande foulée", async () => {
      const before = (await stats(fighter)).speed;
      await cast("longstrider", [fighter]);
      const after = (await stats(fighter)).speed;
      ctx.expect(after.walk === (before.walk ?? 0) + 10, `Grande foulée : vitesse ${before.walk} → ${after.walk} ft`);
    });
    await part("Saut", async () => {
      await cast("jump", [fighter]);
      ctx.expect((await ctx.effects(fighter)).some(e => /Saut|Jump/i.test(e.name ?? "")), "Saut : l'effet est posé sur le Guerrier");
    });
    await part("Mot de guérison", async () => {
      const before = await hurt(fighter);
      const { used, r } = await cast("healing-word", [fighter], { roll: true });
      const heal = total((await ctx.messagesSince(used.usageMessageId)).find(m => ["healing", "damage"].includes(m.type)));
      const after = await ctx.hp(fighter);
      ctx.expect((r?.step === "done") && (after - before === Math.min(heal, hp0.get(fighter.id) - before)), `Mot de guérison : ${before} → ${after} PV (jet ${heal})`);
    });
    await part("Mot de guérison de groupe", async () => {
      const b1 = await hurt(fighter);
      const b2 = await hurt(mage);
      const { used } = await cast("mass-healing-word", [fighter, mage], { roll: true });
      const heal = total((await ctx.messagesSince(used.usageMessageId)).find(m => ["healing", "damage"].includes(m.type)));
      const a1 = await ctx.hp(fighter);
      const a2 = await ctx.hp(mage);
      ctx.expect((a1 - b1 === Math.min(heal, hp0.get(fighter.id) - b1)) && (a2 - b2 === Math.min(heal, hp0.get(mage.id) - b2)),
        `Mot de guérison de groupe (jet ${heal}) : Guerrier ${b1} → ${a1}, Magicien ${b2} → ${a2}`);
    });
    const saveDamage = async (label, used, r, target) => {
      const t = r?.targets?.find(x => x.name === target.name);
      if ( !ctx.expect(!!t?.save, `${label} : sauvegarde du ${target.name} (${t?.save?.total ?? "aucune"} contre DD ${r?.plan?.save?.dc})`) ) return;
      const rolled = total((await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage"));
      const expected = t.save.success ? Math.floor(rolled / 2) : rolled;
      ctx.expect((rolled > 0) && (t.damage?.applied === expected), `${label} : ${t.save.success ? "réussie, moitié" : "ratée, entiers"} — ${t.damage?.applied} appliqués pour ${rolled}`);
    };
    await part("Blessure", async () => {
      await ctx.setHp(zombi, 60);
      const { used, r } = await cast("inflict-wounds", [zombi], { activityType: "save" });
      await saveDamage("Blessure", used, r, zombi);
    });
    await part("Boule de feu", async () => {
      await ctx.setHp(zombi, 60);
      const box = await ctx.box(zombi);
      const used = await ctx.use({ tokenId: cleric.id, identifier: "fireball", activityType: "save", consume: false,
        area: { shape: "circle", x: box.x + (box.width / 2), y: box.y + (box.height / 2), radius: Math.round(grid * 0.9) } });
      if ( used.regionId ) regions.push(used.regionId);
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1500);
      await saveDamage("Boule de feu", used, r, zombi);
    });
    await part("Mot de radiance", async () => {
      const p = await ctx.position(cleric);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x + grid, y: p.y, elevation: p.elevation });
      await ctx.call("move-token", { tokenId: fighter.id, x: p.x - grid, y: p.y, elevation: p.elevation });
      await pause(1500);
      const used = await ctx.use({ tokenId: cleric.id, identifier: "word-of-radiance", consume: false,
        area: { shape: "circle", x: p.x + (grid / 2), y: p.y + (grid / 2), radius: Math.round(grid * 1.6) } });
      if ( used.regionId ) regions.push(used.regionId);
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      const names = (r?.targets ?? []).map(t => t.name);
      ctx.expect(names.includes("Zombi") && !names.includes("Guerrier") && !names.includes("Clerc"), `Mot de radiance : seul l'ennemi est pris (${names.join(", ") || "aucune cible"})`);
    });
    await part("Amitié avec les animaux", async () => {
      await cast("animal-friendship", [zombi], { activityType: "save" });
      ctx.expect(!(await stats(zombi)).statuses.includes("charmed"), "Amitié avec les animaux : le Zombi (mort-vivant) n'est pas Charmé");
      const c = await untilFailed("animal-friendship", wolf, { activityType: "save" });
      if ( !ctx.expect(!!c, "Amitié avec les animaux : le Loup rate une sauvegarde (20 essais au plus)") ) return;
      ctx.expect((await stats(wolf)).statuses.includes("charmed"), "Amitié avec les animaux : le Loup (bête) est Charmé");
    });
    await part("Injonction", async () => {
      const { r } = await cast("command", [zombi], { activityType: "save" });
      const t = r?.targets?.find(x => x.name === "Zombi");
      ctx.expect((r?.step === "done") && !!t?.save, `Injonction : sauvegarde de Sagesse tranchée (${t?.save?.total ?? "aucune"} contre DD ${r?.plan?.save?.dc})`);
    });
  }
};
