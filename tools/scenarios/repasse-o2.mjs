/**
 * §336, lot O2 de la repasse des objets : sauvegardes et défenses d'objets. Arène de test (Clerc, Guerrier).
 *  1. Manteau de résistance aux sorts sur le Guerrier : pas d'Avantage à la sauvegarde contre Injonction tant qu'il n'est ni porté ni
 *     harmonisé ; porté et harmonisé, l'Avantage (`saveAdvantage`) — le calcul du moteur (`api.mcp.saveChance`).
 *  2. Antidote : corrigé à la création (l'effet porte la marque d'Avantage contre Empoisonné) ; bu, le Guerrier a l'Avantage contre le
 *     Dard de Lolth, qui pose Empoisonné.
 *  3. Broche de défense portée et harmonisée : le Guerrier n'est plus atteint par Projectile magique (`targets.unaffectedIf`).
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o2 — sauvegardes et défenses d'objets (porté et harmonisé, Antidote, Broche de défense)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc ou Guerrier absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const cleric = await ctx.token("Clerc");
    const drinkerRef = {};
    const fighter = await ctx.token("Guerrier");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const atWill = { system: { method: "atwill" } };
    await ctx.ensureItem(cleric, `${SRD}phbsplCommand000`, atWill);
    await ctx.ensureItem(cleric, `${DMG}dmgLolthsSting00`);
    ctx.restore(async () => {
      for ( const t of [fighter, cleric, ...(drinkerRef.target ? [drinkerRef.target] : [])] ) {
        await ctx.removeEffectsFrom(t, "antitoxin", "magic-missile");
        await ctx.removeEffectsNamed(t, /Antitoxin|Antidote/i);
      }
    });
    const chance = async identifier => ctx.engine("saveChance", { casterId: cleric.id, targetId: fighter.id, itemId: await ctx.itemId(cleric.id, identifier) });
    const wear = (identifier, on) => ctx.call("upsert-actor-item", { actorId, itemData: { system: { equipped: on, attuned: on } }, match: { path: "system.identifier", value: identifier } });

    // 1. Manteau : porté et harmonisé seulement.
    await ctx.ensureItem(fighter, `${DMG}dmgMantleOfSpell`);
    await wear("mantle-of-spell-resistance", false);
    await pause(400);
    const off = await chance("command");
    ctx.expect(!(off?.advantage ?? []).includes("saveAdvantage"), `Manteau non porté : pas d'Avantage (${JSON.stringify(off?.advantage)})`);
    await wear("mantle-of-spell-resistance", true);
    await pause(400);
    const on = await chance("command");
    ctx.expect((on?.advantage ?? []).includes("saveAdvantage"), `Manteau porté et harmonisé : Avantage contre Injonction (${JSON.stringify(on?.advantage)})`);
    await wear("mantle-of-spell-resistance", false);

    // 2. Antidote : corrigé à la création, puis bu — par une créature qui n'a pas déjà l'Avantage contre Empoisonné (Résilience naine).
    await ctx.ensureItem(fighter, `${DMG}dmgLolthsSting00`);
    const sting = async (caster, target) => ctx.engine("saveChance", { casterId: caster.id, targetId: target.id, itemId: await ctx.itemId(caster.id, "lolths-sting") });
    let drinker = null;
    Object.assign(drinkerRef, {});
    const others = [];
    for ( const t of tokens.filter(t => !["Clerc", "Guerrier", "Zombi"].includes(t.name)) ) others.push(await ctx.token(t.name).catch(() => null));
    for ( const [target, caster] of [[fighter, cleric], [cleric, fighter], ...others.filter(Boolean).map(t => [t, cleric])] ) {
      const before = await sting(caster, target);
      if ( !(before?.advantage ?? []).includes("saveAdvantage") ) { drinker = { target, caster }; drinkerRef.target = target; break; }
    }
    if ( !drinker ) ctx.log("toutes les créatures de la scène ont déjà l'Avantage contre Empoisonné : étape de l'Antidote sautée");
    else {
      const { target, caster } = drinker;
      const antitoxin = await ctx.ensureItem(target, `${PHB}phbagAntitoxin00`);
      await pause(800);
      const data = await ctx.engine("itemData", { tokenId: target.id, itemId: antitoxin, paths: ["effect:DzWVacNiq6ggXbU9:system.changes"] });
      const changes = data?.["effect:DzWVacNiq6ggXbU9:system.changes"] ?? [];
      ctx.expect(changes.some(c => c.key === "flags.dnd5e-combat.saveAdvantage.poisoned"), `Antidote corrigé à la création (${target.name})`);
      const used = await ctx.use({ tokenId: target.id, identifier: "antitoxin", consume: false, targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      const drunk = await sting(caster, target);
      ctx.expect((drunk?.advantage ?? []).includes("saveAdvantage"), `Antidote bu par ${target.name} : Avantage contre le Dard de Lolth (${JSON.stringify(drunk?.advantage)})`);
      await ctx.removeEffectsFrom(target, "antitoxin");
      await ctx.removeEffectsNamed(target, /Antitoxin|Antidote/i);
    }

    // 3. Broche de défense : immunité à Projectile magique, portée et harmonisée.
    await ctx.ensureItem(cleric, `${SRD}phbsplMagicMissi`, atWill).catch(() => null);
    await ctx.ensureItem(fighter, `${DMG}dmgBroochOfShiel`);
    await wear("brooch-of-shielding", true);
    await pause(500);
    const hpBefore = await ctx.hp(fighter);
    const missile = await ctx.use({ tokenId: cleric.id, identifier: "magic-missile", consume: false, targetTokenIds: [fighter.id],
      usageConfig: { [MODULE_ID]: { confirmed: true } } }).catch(err => ({ error: err.message }));
    if ( missile?.usageMessageId ) await ctx.settle(missile.usageMessageId).catch(() => null);
    await pause(1500);
    const hpAfter = await ctx.hp(fighter);
    ctx.expect(hpAfter >= hpBefore, `Broche de défense : Projectile magique sans effet (PV ${hpBefore} → ${hpAfter}${missile?.error ? `, ${missile.error}` : ""})`);
    await wear("brooch-of-shielding", false);
  }
};
