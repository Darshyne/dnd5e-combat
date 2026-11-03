/**
 * §350, lot O8g de la repasse des objets : lire un parchemin de sort (liste de classe, test au-dessus du niveau). Arène de test
 * (Guerrier, Magicien niveau 1, Roublard, Zombi). Parchemins faits comme dnd5e les fait depuis le Manuel des joueurs.
 *  1. Le Guerrier (sans liste de sorts) lit Projectile magique : inintelligible, rien ne part, le parchemin reste.
 *  2. Le Magicien lit Projectile magique (niveau 1) : le sort part, sans test.
 *  3. Le Magicien lit Immobilisation de monstre (niveau 5, au-dessus de ses emplacements) : test DD 15 ; raté, le sort s'efface et
 *     le parchemin part (rejoué jusqu'à un échec, pile de 10).
 *  4. Le Roublard avec Utilisation d'objets magiques (aptitude prêtée) : Soins (Clerc, niveau 1) part sans test ; Immobilisation
 *     de personne (niveau 2) demande un test d'Intelligence (Arcanes) DD 12.
 */
const MODULE_ID = "dnd5e-combat";
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8g — parchemins de sort : liste de classe, test au-dessus du niveau, Utilisation d'objets magiques",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Magicien", "Roublard", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Magicien, Roublard ou Zombi absent : non applicable"); return; }
    const [fighter, mage, rogue, zombi] = await Promise.all(["Guerrier", "Magicien", "Roublard", "Zombi"].map(n => ctx.token(n)));
    const hpZ = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    ctx.restore(() => ctx.removeEffectsFrom(zombi, "hold-monster", "hold-person"));
    const made = [];
    ctx.restore(async () => {
      for ( const { token, itemId } of made ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: token.actorId, itemId }).catch(() => {});
    });
    const scroll = async (token, spell, quantity=1) => {
      const s = await ctx.engine("makeScroll", { tokenId: token.id, spellUuid: SPELLS + spell, quantity });
      made.push({ token, itemId: s.itemId });
      return s.itemId;
    };
    const quantity = async (token, itemId) => (await ctx.engine("itemData", { tokenId: token.id, itemId, paths: ["system.quantity"] }).catch(() => null))?.["system.quantity"] ?? 0;
    /** Lit le parchemin sur le Zombi ; rend les lignes du journal du moteur écrites pendant la lecture qui nomment le lecteur. */
    const read = async (token, itemId) => {
      const before = (await ctx.engineLog()).length;
      await ctx.use({ tokenId: token.id, itemId, activityType: "cast", consume: false, targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "none" } } }).catch(() => null);
      await pause(4000);
      return (await ctx.engineLog()).slice(before).join("\n");
    };

    // 1. Le Guerrier.
    const mmF = await scroll(fighter, "phbsplMagicMissi");
    let log = await read(fighter, mmF);
    ctx.expect(/unintelligible/.test(log), `Guerrier : Projectile magique inintelligible (${/unintelligible/.test(log) ? "refusé" : "lu"})`);
    ctx.expect((await quantity(fighter, mmF)) === 1, "le parchemin du Guerrier reste");

    // 2. Le Magicien, niveau 1.
    const mmM = await scroll(mage, "phbsplMagicMissi");
    log = await read(mage, mmM);
    ctx.expect(!/unintelligible|reads .* check/.test(log), `Magicien : Projectile magique part sans test (${log.split("\n").find(l => /unintelligible|check/.test(l)) ?? "ok"})`);

    // 3. Le Magicien, niveau 2.
    const ray = await scroll(mage, "phbsplHoldMonste", 10);
    let lost = false, checked = 0;
    for ( let i = 0; (i < 10) && !lost; i++ ) {
      const q = await quantity(mage, ray);
      log = await read(mage, ray);
      if ( /reads .* check .* DC 15/.test(log) ) checked++;
      lost = /vanishes from the scroll/.test(log);
      if ( lost ) ctx.expect((await quantity(mage, ray)) === q - 1, `test raté : un parchemin de moins (${q} → ${await quantity(mage, ray)})`);
      await ctx.removeEffectsFrom(zombi, "hold-monster");
    }
    ctx.expect(checked > 0, `Immobilisation de monstre (niveau 5) : test DD 15 avant de lancer (${checked} test(s))`);
    ctx.expect(lost, "un test raté efface le sort");

    // 4. Le Roublard, Utilisation d'objets magiques.
    const device = await ctx.call("upsert-actor-item", { actorId: rogue.actorId, itemData: { name: "Use Magic Device (test)", type: "feat", system: { identifier: "use-magic-device" } },
      match: { path: "system.identifier", value: "use-magic-device" } });
    const deviceId = device.itemId ?? device.id ?? device.item?._id;
    if ( device.action === "created" || device.created ) ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: rogue.actorId, itemId: deviceId }).catch(() => {}));
    const cure = await scroll(rogue, "phbsplCureWounds");
    log = await read(rogue, cure);
    ctx.expect(!/unintelligible|reads .* check/.test(log), `Roublard : Soins part sans test (${log.split("\n").find(l => /unintelligible|check/.test(l)) ?? "ok"})`);
    const hold = await scroll(rogue, "phbsplHoldPerson");
    log = await read(rogue, hold);
    ctx.expect(/reads .* check .* DC 12/.test(log), `Roublard : Immobilisation de personne (niveau 2) demande un test DD 12 (${log.split("\n").find(l => /check|unintelligible/.test(l)) ?? "aucun test"})`);
  }
};
