/**
 * Jets demandés par le MJ (SPEC §242, issue #18), sans joueur connecté : le MJ lance pour chacun, sans fenêtre.
 *  1. Test de groupe de Force, DD 10 caché, à trois : chaque ligne lancée, réussite ⇔ total ≥ 10, verdict 2024 (au moins la moitié).
 *  2. Sauvegarde de Dextérité DD 12, pas de groupe : le verdict est « tous réussissent ».
 *  3. Sans DD : ni réussite ni verdict.
 *  4. « Lancer pour lui » sur une ligne déjà lancée : refusé, le total ne bouge pas (un seul jet par ligne).
 *  5. Avantage + Désavantage demandés ensemble s'annulent ; le modificateur du MJ paraît en tuile.
 *  6. Le mode vient du système : Paladin empoisonné → Désavantage à son test.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "jets-demandes — test de groupe, DD caché, un jet par ligne, mode du système",

  async run(ctx) {
    const names = ["Guerrier", "Zombi", "Paladin"];
    const tokens = [];
    for ( const name of names ) {
      const t = await ctx.token(name).catch(() => null);
      if ( t ) tokens.push(t);
    }
    if ( tokens.length < 3 ) { ctx.log(`il faut ${names.join(", ")} : non applicable`); return; }
    const tokenIds = tokens.map(t => t.id);
    const coherent = (view, dc) => (view?.entries ?? []).every(e => (e.status === "rolled") && Number.isFinite(e.total)
      && (e.success === ((dc === null) ? null : (e.total >= dc))));
    const totals = view => (view?.entries ?? []).map(e => `${e.name} ${e.total}${e.success === true ? "✓" : e.success === false ? "✗" : ""}`).join(", ");

    // 1. Test de groupe, DD caché.
    const group = await ctx.engine("groupRoll", { tokenIds, type: "check", key: "str", dc: 10, hideDc: true, group: true, label: "DAS test — group" });
    ctx.expect(group?.done && (group.entries.length === 3), `trois lignes, toutes lancées : ${totals(group)}`);
    ctx.expect(coherent(group, 10), `réussite ⇔ total ≥ 10 sur chaque ligne : ${totals(group)}`);
    const won = group.entries.filter(e => e.success).length;
    ctx.expect((group.successes === won) && (group.success === (won >= 2)), `verdict du groupe : ${won} sur 3 → ${group.success}`);
    ctx.expect(group.request?.hideDc === true && group.request?.dc === 10, `le MJ voit le DD caché : ${JSON.stringify(group.request)}`);

    // 2. Sauvegarde, chacun doit réussir.
    const save = await ctx.engine("groupRoll", { tokenIds, type: "save", key: "dex", dc: 12, label: "DAS test — save" });
    ctx.expect(save?.done && coherent(save, 12), `sauvegardes jugées contre 12 : ${totals(save)}`);
    ctx.expect(save.success === save.entries.every(e => e.success), `verdict « tous » : ${save.success}`);

    // 3. Sans DD.
    const free = await ctx.engine("groupRoll", { tokenIds: tokenIds.slice(0, 2), type: "skill", key: "prc", label: "DAS test — no DC" });
    ctx.expect(free?.done && coherent(free, null) && (free.success === null), `sans DD, ni réussite ni verdict : ${totals(free)}, ${free?.success}`);

    // 4. Un seul jet par ligne.
    const before = group.entries.map(e => e.total).join(",");
    const forced = await ctx.engine("groupRollForce", { id: group.id, tokenId: tokens[0].id });
    await pause(500);
    const after = await ctx.engine("groupRollState", { id: group.id });
    ctx.expect((forced === false) && (after.entries.map(e => e.total).join(",") === before), `« Lancer pour lui » refusé sur une ligne lancée : ${forced}, ${before} → ${after.entries.map(e => e.total).join(",")}`);

    // 5. Avantage + Désavantage, modificateur.
    const both = await ctx.engine("groupRoll", { tokenIds: [tokens[0].id], type: "check", key: "con", advantage: true, disadvantage: true, bonus: 3, label: "DAS test — modes" });
    ctx.expect(both?.done && !both.request?.advantage && !both.request?.disadvantage && (both.request?.bonus === 3),
      `Avantage et Désavantage s'annulent : ${JSON.stringify(both?.request)}`);
    const tiles = await ctx.engine("groupRollBreakdown", { tokenId: tokens[0].id, type: "check", key: "con", bonus: 3 });
    ctx.expect((tiles ?? []).some(t => (t.kind === "request") && (t.value === "+3")), `tuile du modificateur : ${JSON.stringify(tiles)}`);
    ctx.expect((tiles ?? []).some(t => t.kind === "ability"), "tuile de la caractéristique");

    // 6. Mode du système.
    const paladin = tokens[2];
    const plain = await ctx.engine("groupRollMode", { tokenId: paladin.id, type: "check", key: "str" });
    await ctx.call("set-status", { tokenId: paladin.id, statusId: "poisoned", active: true });
    ctx.restore(() => ctx.call("set-status", { tokenId: paladin.id, statusId: "poisoned", active: false }).catch(() => {}));
    await pause(500);
    const poisoned = await ctx.engine("groupRollMode", { tokenId: paladin.id, type: "check", key: "str" });
    ctx.expect(!plain?.disadvantage && (poisoned?.disadvantage === true), `Empoisonné → Désavantage : ${JSON.stringify(plain)} → ${JSON.stringify(poisoned)}`);
  }
};
