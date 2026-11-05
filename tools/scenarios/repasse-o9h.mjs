/**
 * §363, lot O9h de la repasse des objets : les briques demandées par l'utilisateur. Arène de test (Guerrier, Zombi, Clerc).
 * `ONLY=poison,othur` ne joue que les parties dont le nom contient l'un de ces mots.
 *  - poison : Poison standard — « Coat Weapon » enduit l'Épée à deux mains ; le coup suivant ajoute 1d4 poison, l'enduit tombe.
 *  - othur : Fumées d'othur — ratée, l'effet suivi est posé ; au début du tour du Clerc, la sauvegarde est rejouée.
 *  - pugilistes : Potion des pugilistes — un effet de 10 minutes ; la Frappe à mains nues ajoute 1d6 force.
 *  - résistance : Potion de résistance donnée au Clerc — c'est lui qui reçoit la Résistance au feu, pas le Guerrier.
 *  - perle : Perle de force — le Zombi raté est enfermé ; l'attaque du Guerrier ne l'atteint plus.
 *  - cor : Cor de dévastation — après le souffle, le jet d'explosion ; forcé à 100 % : dégâts au Guerrier, cor détruit.
 *  - parchemin : Parchemin de protection (Morts-vivants), lu et consommé — 5 minutes ; le Zombi n'entre pas, ne frappe pas dedans ;
 *    le Guerrier va au contact : l'émanation tombe.
 *  - poussière : Poussière de disparition — le Guerrier et le Clerc (à 3 m) Invisibles, même durée de 2 à 8 minutes ; pas le Zombi.
 *  - huile : Huile d'insaisissabilité — Liberté de mouvement 8 heures ; Graisse au sol 8 heures.
 *  - dynamite : la liasse d'un bâton fait 3d6.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o9h — Poison, othur, pugilistes, résistance, perle, cor, parchemin, poussière, huile, dynamite",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi", "Clerc"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Zombi ou Clerc absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const [fighter, zombi, cleric] = await Promise.all(["Guerrier", "Zombi", "Clerc"].map(n => ctx.token(n)));
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    const place = async (zx, cx=null) => ctx.stage({ tokens: { Zombi: [at.x + zx * g, at.y], Clerc: [at.x + (cx ?? 0) * g, at.y + g] } });
    const { data: ftok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = ftok.actorId;
    const hpF = await ctx.hp(fighter), hpZ = await ctx.hp(zombi), hpC = await ctx.hp(cleric);
    const base = new Map();
    for ( const t of [fighter, zombi, cleric] ) base.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    const added = async t => (await ctx.effects(t)).filter(e => !base.get(t.id).has(e._id ?? e.id) && !e.flags?.[MODULE_ID]?.aura && !(e.statuses ?? []).includes("bloodied"));
    const clean = async () => {
      for ( const t of [fighter, zombi, cleric] ) {
        const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
        for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: data.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.setHp(fighter, hpF); await ctx.setHp(zombi, hpZ); await ctx.setHp(cleric, hpC);
    };
    ctx.restore(clean);
    const fixes = await ctx.engine("setting", { key: "dataFixes" });
    ctx.restore(() => ctx.engine("setting", { key: "dataFixes", value: fixes.before }));
    await ctx.engine("setting", { key: "dataFixes", value: true });
    /** L'item du compendium, recréé à neuf (les réparations de données se font à la création). */
    const fresh = async (token, uuid) => {
      const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      for ( const i of ((await ctx.call("get-actor", { actorId: tok.actorId })).items ?? []).filter(i => i.system?.identifier === data.system?.identifier) ) {
        await ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: i._id }).catch(() => {});
      }
      const id = await ctx.ensureItem(token, uuid);
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: id }).catch(() => {}));
      await pause(800);
      return id;
    };
    const use = async (token, itemId, activityId, targets=[], extra={}) => {
      const used = await ctx.use({ tokenId: token.id, itemId, activityId, consume: false, targetTokenIds: targets, ...extra,
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none", ...(extra.config ?? {}) } } }).catch(err => ({ error: err.message }));
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
      await pause(1500);
      return { used, r };
    };
    /** Attaque jusqu'au toucher ; rend les formules des jets de dégâts. */
    const hitWith = async (itemId, target) => {
      for ( let i = 0; i < 15; i++ ) {
        await ctx.setHp(target, target === zombi ? hpZ : hpC);
        const used = await ctx.use({ tokenId: fighter.id, itemId, activityType: "attack", consume: false, targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( !r?.targets?.[0]?.hit ) continue;
        await pause(2000);
        const damage = (await ctx.messagesSince(used.usageMessageId)).filter(m => m.type === "damage");
        return damage.flatMap(m => (m.rolls ?? []).map(x => `${x.formula}`)).join(" | ");
      }
      return null;
    };
    /** La durée d'un effet en secondes (V14 : `duration.value` en `units`). */
    const secs = e => e?.duration?.seconds ?? ((e?.duration?.units === "seconds") ? e.duration.value : null);
    const data = (itemId, paths, token=fighter) => ctx.engine("itemData", { tokenId: token.id, itemId, paths });
    const only = (process.env.ONLY ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const part = async (name, fn) => {
      if ( only.length && !only.some(o => name.toLowerCase().includes(o)) ) return;
      await clean();
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
    };

    await part("poison", async () => {
      await place(1);
      const poison = await fresh(fighter, `${PHB}phbagPoisonBasic`);
      const sword = await ctx.itemId(fighter.id, "greatsword");
      await use(fighter, poison, "dasCoatWeapon000", [], { config: { coatItem: sword } });
      const coat = (await data(sword, [`flags.${MODULE_ID}.coating`]))?.[`flags.${MODULE_ID}.coating`];
      ctx.restore(() => ctx.call("upsert-actor-item", { actorId, itemData: { [`flags.${MODULE_ID}.-=coating`]: null }, match: { path: "_id", value: sword } }).catch(() => {}));
      if ( !ctx.expect(!!coat && coat.formula === "1d4" && coat.damageType === "poison", `Poison standard : l'Épée à deux mains est enduite (${JSON.stringify(coat)})`) ) return;
      const formulas = await hitWith(sword, zombi);
      ctx.expect(/1d4/.test(formulas ?? ""), `le coup suivant ajoute 1d4 poison (${formulas ?? "raté"})`);
      await pause(800);
      const left = (await data(sword, [`flags.${MODULE_ID}.coating`]))?.[`flags.${MODULE_ID}.coating`];
      ctx.expect(!left, `l'enduit tombe après ses dégâts (${JSON.stringify(left ?? null)})`);
      const again = await hitWith(sword, zombi);
      ctx.expect(!!again && !/1d4/.test(again), `le coup d'après : plus de poison (${again ?? "raté"})`);
    });

    await part("othur", async () => {
      await place(4, 1);
      const fumes = await fresh(fighter, `${DMG}dmgBurntOthurFum`);
      let poisoned = false;
      for ( let i = 0; (i < 10) && !poisoned; i++ ) {
        await use(fighter, fumes, "13ZvV9bxzM90FeQO", [cleric.id]);
        poisoned = (await added(cleric)).some(e => /Othur/i.test(e.name ?? ""));
      }
      if ( !ctx.expect(poisoned, "Fumées d'othur : ratée, le Clerc porte l'effet suivi") ) return;
      await ctx.startCombat([fighter, cleric]);
      const started = await ctx.combat();
      for ( const [t, v] of [[fighter, 20], [cleric, 5]] ) await ctx.call("set-initiative", { combatantId: started.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      await pause(800);
      const hpBefore = await ctx.hp(cleric);
      await ctx.nextTurn();   // le Clerc : début de son tour
      await pause(6000);
      const effectNow = (await added(cleric)).find(e => /Othur/i.test(e.name ?? ""));
      const tally = effectNow?.flags?.[MODULE_ID]?.tally;
      ctx.expect(!!tally && ((tally.successes + tally.failures) === 1), `au début de son tour, il rejoue la sauvegarde, comptée (${JSON.stringify(tally ?? null)})`);
      // Une sauvegarde rejouée ratée : 1d6 poison (le Clerc nain résiste au poison : le moteur le dit, les PV peuvent ne pas bouger).
      let failed = !!tally && (tally.failures > 0);
      for ( let i = 0; (i < 4) && !failed; i++ ) {
        await ctx.nextTurn(); await ctx.nextTurn(); await pause(6000);
        const e = (await added(cleric)).find(x => /Othur/i.test(x.name ?? ""));
        failed = !!e && ((e.flags?.[MODULE_ID]?.tally?.failures ?? 0) > 0);
        if ( !e ) break;
      }
      if ( failed ) {
        const lines = (await ctx.engineLog()).slice(-40);
        ctx.expect(lines.some(l => /Burnt Othur Fumes: saving throw failed, Clerc takes its damage/.test(l)), `ratée : 1d6 poison (${hpBefore} → ${await ctx.hp(cleric)})`);
      } else ctx.log("aucun échec en quatre tours : dégâts d'échec non vus");

    });

    await part("pugilistes", async () => {
      await place(1);
      const potion = await fresh(fighter, `${DMG}dmgPotionOfPugil`);
      await use(fighter, potion, "RoR08ONPd8se88h5", []);
      const effect = (await added(fighter)).find(e => /Pugilism/i.test(e.name ?? ""));
      if ( !ctx.expect(!!effect && secs(effect) === 600, `Potion des pugilistes : effet de 10 minutes sur le Guerrier (${effect?.name ?? "aucun"}, ${secs(effect) ?? JSON.stringify(effect?.duration)} s)`) ) return;
      const fist = await ctx.itemId(fighter.id, "unarmed-strike");
      const formulas = await hitWith(fist, zombi);
      ctx.expect(/1d6/.test(formulas ?? ""), `Frappe à mains nues : 1d6 force en plus (${formulas ?? "raté"})`);
      const sword = await ctx.itemId(fighter.id, "greatsword");
      const other = await hitWith(sword, zombi);
      ctx.expect(!!other && !/1d6\[force\]|1d6$/.test(other.replace(/2d6/g, "")), `pas avec l'Épée (${other ?? "raté"})`);
    });

    await part("résistance", async () => {
      await place(4, 1);
      const potion = await fresh(fighter, `${DMG}dmgPotionOfResis`);
      await use(fighter, potion, "n52xzzYU7CI8sywr", [cleric.id], { config: { choice: "UI7peFQB9vCGuwpG" } });
      const onCleric = (await added(cleric)).map(e => e.name);
      const onFighter = (await added(fighter)).map(e => e.name);
      ctx.expect(onCleric.some(n => /Resistance/i.test(n)) && (onCleric.length === 1), `Potion de résistance donnée : le Clerc la reçoit (${onCleric.join(", ") || "rien"})`);
      ctx.expect(!onFighter.some(n => /Resistance/i.test(n)), `pas le Guerrier (${onFighter.join(", ") || "rien"})`);
    });

    await part("perle", async () => {
      await place(4);
      const bead = await fresh(fighter, `${DMG}dmgBeadOfForce00`);
      const centre = await ctx.position(zombi);
      let trapped = false;
      for ( let i = 0; (i < 10) && !trapped; i++ ) {
        await clean();
        await use(fighter, bead, "OZHtgfnTZWKOg9JP", [], { area: { shape: "circle", x: centre.x + g / 2, y: centre.y + g / 2, radius: 2 * g } });
        trapped = (await added(zombi)).some(e => /Sphere of Force/i.test(e.name ?? ""));
      }
      if ( !ctx.expect(trapped, "Perle de force : le Zombi raté est enfermé dans la sphère") ) return;
      const sword = await ctx.itemId(fighter.id, "greatsword");
      const used = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", consume: false, targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      ctx.expect(r?.targets?.[0]?.unaffected?.reason === "enclosed", `l'attaque du Guerrier ne l'atteint pas (${JSON.stringify(r?.targets?.[0]?.unaffected ?? null)})`);
    });

    await part("cor", async () => {
      await place(2);
      const horn = await fresh(fighter, `${DMG}dmgHornOfBlastin`);
      const cone = { shape: "circle", x: at.x + 2.5 * g, y: at.y + g / 2, radius: g / 2 };
      const { used } = await use(fighter, horn, "FMTcQOb5MZKBohdN", [zombi.id], { area: cone });
      await pause(2500);
      const rolled = (await ctx.messagesSince(used.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.backfire);
      ctx.expect(rolled.length === 1, `Cor de dévastation : un jet d'explosion après le souffle (${rolled.map(m => JSON.stringify(m.flags[MODULE_ID].backfire)).join(" ; ") || "aucun"})`);
      const exploded = rolled[0]?.flags?.[MODULE_ID]?.backfire?.blows;
      if ( exploded ) { ctx.log("le cor a explosé dès le premier souffle (20 %)"); return; }
      const over = await ctx.engine("overrideContent", { identifier: "horn-of-blasting",
        entry: { backfire: { after: ["FMTcQOb5MZKBohdN"], chance: 100, activity: "q8PShLHyh2ItXbkQ", destroys: true } } });
      ctx.restore(() => ctx.engine("overrideContent", { identifier: "horn-of-blasting", entry: over.before }));
      await ctx.setHp(fighter, hpF);
      const second = await use(fighter, horn, "FMTcQOb5MZKBohdN", [zombi.id], { area: cone });
      await pause(3000);
      const boom = (await ctx.messagesSince(second.used.usageMessageId)).filter(m => m.flags?.[MODULE_ID]?.backfire);
      ctx.expect(boom[0]?.flags?.[MODULE_ID]?.backfire?.blows === true, `forcé à 100 % : il explose (${JSON.stringify(boom[0]?.flags?.[MODULE_ID]?.backfire ?? null)})`);
      const hp = await ctx.hp(fighter);
      ctx.expect(hp < hpF, `10d6 force au Guerrier (${hpF} → ${hp})`);
      const gone = !((await ctx.call("get-actor", { actorId })).items ?? []).some(i => i._id === horn);
      ctx.expect(gone, "le cor est détruit");
    });

    await part("parchemin", async () => {
      await place(3);
      const scroll = await fresh(fighter, `${DMG}dmgScrollOfProte`);
      // Le connecteur coupe les actions qui suivent l'utilisation (`subsequentActions`) : l'enchantement de soi est posé comme dnd5e le ferait.
      await ctx.engine("enchant", { tokenId: fighter.id, itemId: scroll, activityId: "SLT3PkMx7Cq6Rnon", targetItemId: scroll, profile: "JvE43pQh6FVZ42qp" }).catch(err => ctx.log(err.message));
      await pause(1500);
      const effects = (await data(scroll, ["effects"]))?.effects ?? [];
      const applied = effects.filter(e => (e.type === "enchantment") && !e.disabled && e.flags?.dnd5e?.enchantmentProfile);
      if ( process.env.DETAIL ) ctx.log(JSON.stringify(effects.map(e => [e._id, e.name, e.type, e.disabled, e.flags?.dnd5e])));
      if ( !ctx.expect(applied.some(e => /Undead/i.test(e.name ?? "")), `Parchemin de protection : il s'enchante lui-même, contre les Morts-vivants (${applied.map(e => e.name).join(", ") || "rien"})`) ) return;
      const acts = (await data(scroll, ["system.activities"]))?.["system.activities"] ?? {};
      const reading = Object.values(acts).find(a => (a.type === "utility") && a.flags?.dnd5e?.dependentOn)?._id;
      if ( !ctx.expect(!!reading, "l'enchantement donne au parchemin son activité « Use »") ) return;
      await use(fighter, scroll, reading, [], { consume: !process.env.KEEP });
      const effect = (await added(fighter)).find(e => /Protection/i.test(e.name ?? ""));
      if ( !ctx.expect(!!effect && (secs(effect) === 300), `lu : l'émanation dure 5 minutes (${effect?.name ?? "aucun"}, ${secs(effect) ?? JSON.stringify(effect?.duration)} s)`) ) return;
      if ( process.env.DETAIL ) ctx.log(JSON.stringify((await ctx.engine("identify", { tokenId: fighter.id })).filter(r => /Scroll/.test(r.item))));
      if ( process.env.DETAIL ) ctx.log(JSON.stringify((await ctx.engine("effectOrigins", { tokenId: fighter.id })).filter(e => /Protection/.test(e.effect))));
      const z0 = await ctx.position(zombi);
      const step = await ctx.engine("rawMove", { tokenId: zombi.id, cell: { i: Math.round(at.y / g), j: Math.round(at.x / g) + 1 } });
      const z1 = await ctx.position(zombi);
      ctx.expect((z1.x === z0.x) && (z1.y === z0.y), `le Zombi n'entre pas dans l'émanation (${JSON.stringify(step?.result ?? null)})`);
      const slam = await ctx.itemId(zombi.id, "slam");
      const blocked = await ctx.engine("barrier", { attackerId: zombi.id, targetId: fighter.id, itemId: slam });
      ctx.expect(/Protection/i.test(blocked ?? ""), `il n'affecte rien dedans (${blocked ?? "rien"})`);
      const reasonsOther = await ctx.engine("barrier", { attackerId: cleric.id, targetId: fighter.id, itemId: await ctx.itemId(cleric.id, "mace").catch(() => slam) }).catch(() => null);
      ctx.expect(!reasonsOther, `le Clerc (Humanoïde) n'est pas arrêté (${reasonsOther ?? "rien"})`);
      await ctx.call("move-token", { tokenId: fighter.id, x: z0.x - g, y: z0.y, action: "displace" }).catch(err => ctx.log(`move-token : ${err.message}`));
      ctx.restore(() => ctx.call("move-token", { tokenId: fighter.id, x: at.x, y: at.y, action: "displace" }).catch(() => {}));
      await pause(2500);
      const after = (await added(fighter)).find(e => /Protection/i.test(e.name ?? ""));
      ctx.expect(!after, "le Guerrier va au contact du Zombi : l'émanation tombe");
    });

    await part("poussière", async () => {
      await place(4, 1);
      const dust = await fresh(fighter, `${DMG}dmgDustOfDisappe`);
      await use(fighter, dust, "OVcWAXY5IJGdKSqw", [], { area: { shape: "circle", x: at.x + g / 2, y: at.y + g / 2, radius: 2 * g } });
      const inv = async t => (await added(t)).find(e => (e.statuses ?? []).includes("invisible"));
      const [f, c, z] = [await inv(fighter), await inv(cleric), await inv(zombi)];
      ctx.expect(!!f && !!c, `Poussière de disparition : le Guerrier et le Clerc Invisibles (${!!f} / ${!!c})`);
      ctx.expect(!z, "pas le Zombi, à 6 m");
      const d = [secs(f), secs(c)];
      ctx.expect((d[0] === d[1]) && (d[0] >= 120) && (d[0] <= 480) && (d[0] % 60 === 0), `même durée, 2d4 minutes (${d.join(" / ")} s)`);
    });

    await part("huile", async () => {
      await place(4);
      const oil = await fresh(fighter, `${DMG}dmgOilOfSlipperi`);
      await use(fighter, oil, "dgp4czAiBiwgDJ2X", [fighter.id], {});
      const fx = await added(fighter);
      if ( process.env.DETAIL ) ctx.log(JSON.stringify(fx.map(e => ({ name: e.name, duration: e.duration, origin: e.origin }))));
      const fom = fx.find(e => /Freedom|Liberté|Unrestricted|entrave/i.test(e.name ?? "") || /FreedomofM/.test(e.origin ?? ""));
      ctx.expect(secs(fom) === 28800, `Huile d'insaisissabilité : Liberté de mouvement 8 heures (${fom?.name ?? "aucun"}, ${secs(fom) ?? JSON.stringify(fom?.duration)} s)`);
      const listRegions = async () => (await ctx.call("list-scene-objects", { types: ["Region"] }).catch(() => null))?.objects?.Region ?? [];
      const regions0 = new Set((await listRegions()).map(r => r.id ?? r._id));
      const now = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      await use(fighter, oil, "IQsAg45adQPcbS86", [], { area: { shape: "rectangle", x: at.x + 2 * g, y: at.y - g, width: 2 * g, height: 2 * g } });
      const regions = (await listRegions()).filter(r => !regions0.has(r.id ?? r._id));
      for ( const r of regions ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id ?? r._id }).catch(() => {}));
      if ( process.env.DETAIL ) for ( const r of regions ) ctx.log(JSON.stringify((await ctx.call("get-scene-object", { type: "Region", objectId: r.id ?? r._id })).data?.flags ?? {}));
      const grease = regions.find(r => /Grease|Graisse|Slipperiness/i.test(r.name ?? ""));
      const expires = grease ? (await ctx.call("get-scene-object", { type: "Region", objectId: grease.id ?? grease._id })).data?.flags?.[MODULE_ID]?.expiresAt : null;
      ctx.expect(Number.isFinite(expires) && (Math.abs(expires - now - 28800) <= 60), `Graisse au sol : 8 heures (${grease?.name ?? "aucune zone"}, fin dans ${Number.isFinite(expires) ? expires - now : "?"} s)`);
    });

    await part("dynamite", async () => {
      const stick = await fresh(fighter, `${DMG}dmgDynamiteStick`);
      const f = (await data(stick, ["system.activities.4aJqDXopO4psnUXg.damage.parts"]))?.["system.activities.4aJqDXopO4psnUXg.damage.parts"];
      const formula = f?.[0]?.custom?.formula;
      ctx.expect(formula === "(2 + @scaling)d6", `Liasse de dynamite : un bâton fait 3d6 (@scaling = 1) — ${formula}`);
    });
  }
};
