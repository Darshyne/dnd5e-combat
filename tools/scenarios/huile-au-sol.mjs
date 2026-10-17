/**
 * §188 : l'Huile et les zones inflammables, dans l'arène.
 *  1. Le lancer d'une flasque remplace une attaque de l'action Attaquer (Paladin, Attaque supplémentaire) ; l'étalage au sol, non.
 *  2. L'huile étalée reste au sol, avec son image, sans rien faire tant qu'elle ne brûle pas.
 *  3. Elle s'embrase : (a) le Zombi qui s'y tient subit des dégâts de feu ; (b) Mains brûlantes posées dessus ; (c) le Magicien, au
 *     contact avec une boîte à amadou, l'allume (l'entrée du menu).
 *  4. En feu : 5 dégâts de feu à qui y entre (hors combat) ou y termine son tour (en combat) ; elle s'éteint hors combat après 12 s, en
 *     combat à la fin du même tour deux rounds plus tard, et sa lumière avec elle.
 *  5. La Toile d'araignée s'embrase aussi : 2d4 au début du tour de qui s'y trouve, puis elle disparaît et libère qui elle entravait.
 * Remet positions, PV, effets, items, zones, combat (le filet du lanceur).
 */
const MODULE_ID = "dnd5e-combat";
const EQUIPMENT = "Compendium.dnd-players-handbook.equipment.Item.";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const THROW = "FoeoumkYcnAsGCRo";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "huile — lancer, flaque, embrasement, toile qui brûle",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi", "Paladin"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Zombi, Paladin requis : non applicable"); return; }
    const [mage, zombi, paladin] = await Promise.all(["Magicien", "Zombi", "Paladin"].map(n => ctx.token(n)));
    const g = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const hp0 = await ctx.hp(zombi);
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await pause(800);
    };
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await endCombat();
      await ctx.setHp(zombi, hp0);
      await ctx.removeStatusEffects(zombi, "restrained").catch(() => {});
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y }).catch(() => {});
      await pause(600);
    };
    const flammable = (args={}) => ctx.engine("flammable", { tokenId: mage.id, ...args });
    const zoneState = async id => (await flammable()).zones.find(z => z.id === id) ?? null;

    // La flaque : sur la case du Zombi ; le Magicien au contact, à l'ouest.
    const spot = { x: home.x, y: home.y };
    await ctx.call("move-token", { tokenId: mage.id, x: spot.x - g, y: spot.y });
    await pause(600);
    const oilId = await ctx.ensureItem(mage, EQUIPMENT + "phbagOil00000000");
    const spread = async () => {
      // La flasque se détruit à l'usage (« autoDestroy ») : on la redonne avant chaque flaque.
      const id = await ctx.ensureItem(mage, EQUIPMENT + "phbagOil00000000").catch(() => oilId);
      const used = await ctx.use({ tokenId: mage.id, itemId: id, activityType: "damage", consume: false,
        area: { shape: "rectangle", x: spot.x, y: spot.y, width: g, height: g } });
      if ( used.regionId ) regions.push(used.regionId);
      await pause(1800);
      return used.regionId ?? null;
    };

    await part("Lancer", async () => {
      const oil = await ctx.ensureItem(paladin, EQUIPMENT + "phbagOil00000000");
      const sword = await ctx.itemId(paladin.id, "longsword");
      await ctx.call("move-token", { tokenId: paladin.id, x: home.x + g, y: home.y });
      await pause(500);
      await ctx.startCombat([paladin, zombi]);
      const used = await ctx.use({ tokenId: paladin.id, itemId: sword, activityType: "attack", targetTokenIds: [zombi.id], consume: false });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(800);
      const thrown = await ctx.engine("issues", { tokenId: paladin.id, itemId: oil, activityType: "save" });
      ctx.expect(!thrown.length, `après une attaque, le lancer d'une flasque remplace la seconde (${thrown.join(" ; ") || "aucun souci"})`);
      const douse = await ctx.engine("issues", { tokenId: paladin.id, itemId: oil, activityType: "damage" });
      ctx.expect(douse.length > 0, `l'étalage au sol, lui, demande l'action (${douse.join(" ; ") || "aucun souci"})`);
    });

    await part("Flaque + dégâts de feu (a), hors combat", async () => {
      const id = await spread();
      if ( !ctx.expect(!!id, "flaque posée") ) return;
      const z = await zoneState(id);
      ctx.expect(!!z && !z.burning, `la flaque reste au sol sans brûler (${z ? "présente" : "absente"})`);
      await ctx.engine("hurt", { tokenId: zombi.id, amount: 1, type: "fire" });
      await pause(1500);
      const lit = await zoneState(id);
      if ( !ctx.expect(!!lit?.burning, "le Zombi, dans la flaque, subit des dégâts de feu : elle s'embrase") ) return;
      // Hors combat, chaque entrée brûle (sortie par le sud : la case à l'est est souvent prise dans l'arène).
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y + g });
      await pause(600);
      const hp = await ctx.hp(zombi);
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, action: "walk" });
      await pause(2500);
      ctx.expect((hp - (await ctx.hp(zombi))) === 5, `entrer dans l'huile en feu : ${hp - (await ctx.hp(zombi))} dégâts (attendu 5)`);
      await pause(11000);
      ctx.expect(!(await zoneState(id)), "hors combat, le feu s'éteint après 12 secondes (zone retirée)");
    });

    await part("Mains brûlantes sur la flaque (b)", async () => {
      const id = await spread();
      if ( !id ) return;
      const hands = await ctx.ensureItem(mage, SPELLS + "phbsplBurningHan", { system: { method: "atwill" } });
      const used = await ctx.use({ tokenId: mage.id, itemId: hands, activityType: "save", consume: false,
        area: { shape: "circle", x: spot.x + (g / 2), y: spot.y + (g / 2), radius: g * 0.6 } });
      if ( used.regionId ) regions.push(used.regionId);
      if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      ctx.expect(!!(await zoneState(id))?.burning, "une zone de feu posée sur la flaque l'embrase");
    });

    await part("Allumer au contact (c), puis en combat", async () => {
      const id = await spread();
      if ( !id ) return;
      // Le Magicien de `dnd-6` porte déjà une boîte à amadou (sac d'explorateur) : « sans flamme » ne se vérifie que s'il n'en a pas.
      const kit = ((await ctx.call("get-actor", { actorId: (await ctx.call("get-scene-object", { type: "Token", objectId: mage.id })).data.actorId })).items ?? [])
        .some(i => ["tinderbox", "torch", "lamp", "candle", "lantern-hooded", "lantern-bullseye"].includes(i.system?.identifier));
      if ( !kit ) {
        const before = await flammable();
        ctx.expect(!before.near.some(z => z.id === id), "sans flamme, le Magicien ne peut pas l'allumer");
      }
      await ctx.ensureItem(mage, EQUIPMENT + "phbagTinderbox00");
      const near = await flammable();
      ctx.expect(near.near.some(z => z.id === id), "avec une boîte à amadou, au contact : « Allumer » proposé");
      // Combat : le Magicien allume à son tour ; le Zombi, dans la flaque, brûle à la fin de chacun de ses tours ; la flaque s'éteint
      // à la fin du tour du Magicien deux rounds plus tard.
      await ctx.setHp(zombi, hp0);
      await ctx.startCombat([mage, zombi]);
      const lit = await flammable({ ignite: true, regionId: id });
      if ( !ctx.expect(lit.lit === true, "allumée") ) return;
      const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
      const hp = await ctx.hp(zombi);
      await next();   // fin du tour du Magicien (round 1)
      await next();   // fin du tour du Zombi : brûle
      await next();   // fin du tour du Magicien (round 2)
      await next();   // fin du tour du Zombi : brûle
      ctx.expect((hp - (await ctx.hp(zombi))) === 10, `deux fins de tour dans l'huile en feu : ${hp - (await ctx.hp(zombi))} dégâts (attendu 10)`);
      ctx.expect(!!(await zoneState(id))?.burning, "toujours en feu au tour du Magicien, deux rounds après l'allumage");
      await next();   // fin du tour du Magicien (round 3) : terme
      ctx.expect(!(await zoneState(id)), "éteinte à la fin du tour, deux rounds après l'allumage");
      const { objects } = await ctx.call("list-scene-objects", { type: "AmbientLight" }).catch(() => ({ objects: null }));
      if ( objects?.AmbientLight ) ctx.expect(!objects.AmbientLight.some(l => l.flags?.[MODULE_ID]?.burning === id), "sa lumière aussi");
    });

    await part("Toile d'araignée qui brûle", async () => {
      const web = await ctx.ensureItem(mage, SPELLS + "phbsplWeb0000000", { system: { method: "atwill" } });
      let id = null;
      let held = false;
      for ( let n = 0; (n < 6) && !held; n++ ) {
        if ( id ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
        await ctx.removeStatusEffects(zombi, "restrained").catch(() => {});
        const used = await ctx.use({ tokenId: mage.id, itemId: web, activityType: "save", consume: false,
          area: { shape: "circle", x: spot.x + (g / 2), y: spot.y + (g / 2), radius: g * 0.6 } });
        id = used.regionId ?? null;
        if ( id ) regions.push(id);
        if ( used.usageMessageId ) await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        held = (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("restrained"));
      }
      if ( !ctx.expect(!!id && held, "le Zombi, entravé par la toile") ) return;
      await ctx.startCombat([mage, zombi]);
      const lit = await flammable({ ignite: true, regionId: id });
      if ( !ctx.expect(lit.lit === true, "la toile s'embrase") ) return;
      const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
      const hp = await ctx.hp(zombi);
      await next();   // début du tour du Zombi : 2d4
      const lost = hp - (await ctx.hp(zombi));
      ctx.expect((lost >= 2) && (lost <= 8), `début de tour dans la toile en feu : ${lost} dégâts (2d4)`);
      await next();   // fin du tour du Zombi
      await next();   // fin du tour du Magicien (round 2) : brûlée
      ctx.expect(!(await zoneState(id)), "la toile a brûlé (zone retirée)");
      const still = (await ctx.effects(zombi)).some(e => (e.statuses ?? []).includes("restrained"));
      ctx.expect(!still, "le Zombi n'est plus entravé");
    });
  }
};
