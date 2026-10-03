/**
 * Attaque de sort à distance : Trait de feu de l'Ensorceleur sur un Zombi. On tire jusqu'à
 * toucher une fois (quatre essais au plus) pour exercer aussi le chemin des dégâts ; chaque tir,
 * touché ou raté, est vérifié.
 */
export default {
  name: "attaque — Trait de feu → Zombi",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    let hits = 0;
    for ( let shot = 1; shot <= 4 && !hits; shot++ ) {
      const before = await ctx.hp(zombi);
      const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
      ctx.expect(used.used && used.attackRolled, `tir ${shot} : activité utilisée et jet d'attaque lancé`);
      const r = await ctx.settle(used.usageMessageId);
      const target = r.targets[0];
      const { total, isCritical, isFumble } = r.attack.roll;
      const shouldHit = isCritical || (!isFumble && (total >= target.ac));
      ctx.expect(target.hit === shouldHit, `tir ${shot} : ${total} contre CA ${target.ac} → ${target.hit ? "touché" : "raté"}, comme il se doit`);
      ctx.expect(r.step === (target.hit ? "done" : "missed"), `tir ${shot} : étape « ${r.step} »`);

      const after = await ctx.hp(zombi);
      if ( target.hit ) {
        hits++;
        const damage = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage");
        ctx.expect(!!damage, `tir ${shot} : un jet de dégâts enchaîné`);
        ctx.expect(!!r.damageRoll && (target.damage?.applied ?? null) !== null, `tir ${shot} : dégâts consignés (${target.damage?.applied} PV)`);
        ctx.expect(before - after === target.damage?.applied, `tir ${shot} : PV lus sur le token ${before} → ${after}, = ${target.damage?.applied} appliqués`);
        ctx.expect(!(damage?.flags?.["dnd5e-combat"]?.bonuses ?? damage?.flags?.bonuses)?.length, `tir ${shot} : aucun dégât bonus (pas de Maléfice)`);
      }
      else ctx.expect(after === before, `tir ${shot} : PV intacts sur un raté (${after})`);
    }
    ctx.expect(hits > 0, "au moins un tir a touché en quatre essais (chemin des dégâts exercé)");
  }
};
