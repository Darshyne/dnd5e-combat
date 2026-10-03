/**
 * Chance d'échec d'une sauvegarde (SPEC §15.3, dette réglée le 2026-09-27) : ce que la pastille calcule doit être le jet que
 * la cible fera. Le Clerc lance (à volonté) Injonction (Sagesse) et Immobilisation de personne (Sagesse) sur le Zombi et le
 * Guerrier : le bonus calculé (`api.mcp.saveChance`) = la partie fixe du vrai jet (total − dé), le DD = celui du plan ; puis
 * Bénédiction sur le Guerrier : le calcul porte +1d4 et la chance d'échec baisse ; enfin le Zombi Paralysé rate d'office
 * une sauvegarde de Dextérité (Tempête de neige) : 100 %.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };

export default {
  name: "chance de sauvegarde — calcul = vrai jet, Bénédiction, échec d'office",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbsplCommand000", "phbsplHoldPerson", "phbsplBless00000", "phbsplSleetStorm"] ) await ctx.ensureItem(cleric, SRD + id, atWill);
    const pattern = /Béni|Bless|Paralys|Injonction|Command|Immobil|Hold|concentr/i;
    const cleanup = async () => {
      for ( const t of [cleric, fighter, zombi] ) await ctx.removeEffectsNamed(t, pattern);
      await ctx.removeStatusEffects(zombi, "paralyzed");
      await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: false }).catch(() => {});
    };
    ctx.restore(cleanup);
    const chance = async (target, identifier) => ctx.engine("saveChance", { casterId: cleric.id, targetId: target.id, itemId: await ctx.itemId(cleric.id, identifier) });

    /** Le vrai jet : lancé, lu ; rend { total, die, dc }. */
    const realSave = async (target, identifier) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, activityType: "save", consume: false, targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { order: "halt" } } });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      const save = (await ctx.messagesSince(used.usageMessageId)).find(m => (m.type === "save") && (m.alias === target.name));
      const roll = rollOf(save);
      // Le connecteur rend les jets résumés (`dice` : faces et résultats), plus leurs `terms` (vu le 2026-09-28).
      const die = (roll?.terms ?? roll?.dice)?.find(t => (t.class === "D20Die") || (t.faces === 20))?.results?.find(x => x.active !== false)?.result ?? null;
      await pause(800);
      await cleanup();
      return { total: roll?.total ?? null, die, dc: r?.plan?.save?.dc ?? null, formula: roll?.formula ?? "" };
    };

    for ( const [target, identifier] of [[zombi, "command"], [fighter, "command"], [fighter, "hold-person"]] ) {
      const c = await chance(target, identifier);
      const real = await realSave(target, identifier);
      if ( !ctx.expect(!!c && (real.total !== null) && (real.die !== null), `${identifier} sur ${target.name} : calcul et vrai jet lus (${real.formula})`) ) continue;
      ctx.expect(c.dc === real.dc, `${identifier} sur ${target.name} : DD calculé ${c.dc} = DD du plan ${real.dc}`);
      ctx.expect(!c.dice.length && (c.bonus === real.total - real.die), `${identifier} sur ${target.name} : bonus calculé ${c.bonus >= 0 ? "+" : ""}${c.bonus} = vrai jet ${real.total} − dé ${real.die} (${real.formula})`);
      ctx.log(`${identifier} sur ${target.name} : ${Math.round(c.fail * 100)} % d'échec (DD ${c.dc}, ${c.ability} ${c.bonus})`);
    }

    // Bénédiction : +1d4 au calcul, la chance d'échec baisse.
    const before = await chance(fighter, "command");
    await ctx.use({ tokenId: cleric.id, identifier: "bless", consume: false, targetTokenIds: [fighter.id] });
    await pause(2000);
    const blessed = await chance(fighter, "command");
    ctx.expect(blessed?.dice?.some(d => (d.faces === 4) && (d.sign !== -1)) && (blessed.fail < before.fail),
      `Bénédiction : +1d4 compté, échec ${Math.round(before.fail * 100)} % → ${Math.round(blessed.fail * 100)} %`);
    await cleanup();

    // Paralysé : sauvegarde de Dextérité ratée d'office.
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "paralyzed", active: true });
    await pause(1000);
    const para = await chance(zombi, "sleet-storm");
    ctx.expect(para?.autoFail === "paralyzed" && para.fail === 1, `Zombi Paralysé, Tempête de neige (Dex) : échec d'office, ${Math.round((para?.fail ?? 0) * 100)} %`);
  }
};
