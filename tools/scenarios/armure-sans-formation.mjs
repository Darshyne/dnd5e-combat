/**
 * §214 : Formation au port d'armure — le Magicien de `dnd-6` (aucune formation d'armure) revêt une cotte de mailles et un bouclier du
 * compendium SRD 2024 de dnd5e.
 *  1. Bouclier sans formation : l'effet du moteur retire son bonus — CA 16 (cotte de mailles), pas 18.
 *  2. Armure sans formation : Désavantage aux sauvegardes de Dextérité (pas de Sagesse), raison « Armure sans formation » à une attaque
 *     de Force ou de Dextérité, et lancer un sort est un souci de légalité.
 *  3. Armure et bouclier retirés : plus d'effet, plus de souci.
 * Retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.equipment24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "armure sans formation — Désavantage Force/Dextérité, pas de sorts, bouclier sans bonus",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Magicien", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombie = await ctx.token("Zombi");
    const stats = () => ctx.engine("stats", { tokenId: mage.id });
    const ac0 = (await stats()).ac;
    const lent = [];
    ctx.restore(async () => { for ( const id of lent ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: id }).catch(() => {}); });
    const items = async () => (await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [];
    const penalty = async () => (await ctx.effects(mage)).find(e => e.flags?.[MODULE_ID]?.untrainedShield || /sans formation|without training/i.test(e.name ?? "")) ?? null;

    // Une cotte de mailles et un bouclier du SRD, équipés, marqués par le scénario : jamais trouvés par leur nom (le sort « Shield »
    // du Magicien porte le même nom anglais que le bouclier — `ensureItem` l'aurait pris).
    const wear = async (id, mark) => {
      const uuid = `${SRD}${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.system = { ...itemData.system, equipped: true };
      itemData.flags = { ...(itemData.flags ?? {}), [MODULE_ID]: { scenarioArmor: mark } };
      const r = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: `flags.${MODULE_ID}.scenarioArmor`, value: mark } });
      lent.push(r.id);
      return r.id;
    };
    const equip = (id, on) => ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": on }, match: { path: "_id", value: id } });
    const mail = await wear("phbarmChainMail0", "mail");
    const shield = await wear("phbarmShield0000", "shield");
    await pause(2000);

    const s = await stats();
    const effect = await penalty();
    ctx.expect(!!effect, `effet « bouclier sans formation » posé (${effect?.name ?? "aucun"})`);
    ctx.expect(s.ac === 16, `CA 16 : la cotte de mailles, sans le bonus du bouclier (${s.ac}, avant ${ac0})`);

    const dex = await ctx.engine("rollSave", { tokenId: mage.id, ability: "dex" });
    ctx.expect(/kl|dis/.test(dex.formula ?? ""), `sauvegarde de Dextérité avec le Désavantage (${dex.formula})`);
    const wis = await ctx.engine("rollSave", { tokenId: mage.id, ability: "wis" });
    ctx.expect(!/kl|dis/.test(wis.formula ?? ""), `sauvegarde de Sagesse normale (${wis.formula})`);

    const weapon = (await items()).find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack")
      && !i.flags?.[MODULE_ID]?.basicAction);
    if ( weapon ) {
      const r = await ctx.engine("attackReasons", { attackerId: mage.id, targetId: zombie.id, itemId: weapon._id });
      ctx.expect(r.disadvantage.includes("situation.untrainedArmor"), `attaque (${weapon.name}) : raison « Armure sans formation » (${r.disadvantage.join(", ") || "aucune"})`);
    } else ctx.log("pas d'arme sur la fiche : attaque non vérifiée");

    const spell = (await items()).find(i => (i.type === "spell") && ((i.system?.level ?? 0) >= 1));
    if ( spell ) {
      const lines = await ctx.engine("issues", { tokenId: mage.id, itemId: spell._id });
      ctx.expect(lines.some(l => /formation|training/i.test(l)), `sort (${spell.name}) : souci « sans formation » (${lines.join(" ; ") || "aucun"})`);
    }

    for ( const id of [mail, shield] ) await equip(id, false);
    await pause(2000);
    ctx.expect(!(await penalty()), "armure et bouclier retirés : l'effet tombe");
    ctx.expect((await stats()).ac === ac0, `CA revenue à ${ac0}`);
    if ( spell ) {
      const lines = await ctx.engine("issues", { tokenId: mage.id, itemId: spell._id });
      ctx.expect(!lines.some(l => /formation|training/i.test(l)), "le sort n'a plus ce souci");
    }
  }
};
