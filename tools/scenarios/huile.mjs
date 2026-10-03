/**
 * L'Huile (SPEC §54). Item prêté depuis le compendium du Manuel des joueurs.
 *  1. Le Magicien lance une fiole sur le Zombi jusqu'à une sauvegarde ratée : « Couvert d'huile » (1 minute).
 *  2. Des dégâts contondants : l'huile ne s'enflamme pas, la marque reste.
 *  3. Des dégâts de feu : 5 dégâts de feu en plus, annoncés au chat, la marque tombe.
 * Remet PV et effets ; retire l'item prêté.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const OIL = "Compendium.dnd-players-handbook.equipment.Item.8dJcpxveaFEzjK5C";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "huile — couvert d'huile, puis le feu l'enflamme",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Magicien", "Zombi"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Magicien et Zombi requis : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    const oiled = async () => (await ctx.effects(zombi)).filter(e => e.flags?.["dnd5e-combat"]?.mark === "oiled");
    const clear = async () => {
      for ( const e of await oiled() ) await ctx.call("remove-embedded-effect", { documentType: "Token", id: zombi.id, effectId: e._id ?? e.id }).catch(() => {});
    };
    ctx.restore(async () => { await clear(); if ( hp0 !== null ) await ctx.setHp(zombi, hp0); });

    const oil = await ctx.ensureItem(mage, OIL);
    let covered = false;
    for ( let i = 0; (i < 20) && !covered; i++ ) {
      await clear();
      const used = await ctx.use({ tokenId: mage.id, itemId: oil, activityType: "save", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
      const save = r.targets.find(t => t.name === "Zombi")?.save;
      await pause(1500);
      if ( save?.success === false ) covered = (await oiled()).length === 1;
      else if ( save?.success ) ctx.expect(!(await oiled()).length, `sauvegarde réussie (${save.total}) : pas d'huile`);
    }
    if ( !ctx.expect(covered, "sauvegarde ratée : le Zombi est couvert d'huile (20 essais au plus)") ) return;
    const mark = (await oiled())[0];
    ctx.expect((mark.duration?.seconds ?? mark.duration?.value) === 60, `l'huile sèche au bout d'1 minute (${JSON.stringify(mark.duration)})`);

    await ctx.setHp(zombi, hp0);
    await ctx.engine("hurt", { tokenId: zombi.id, amount: 3, type: "bludgeoning" });
    await pause(2000);
    ctx.expect(((await ctx.hp(zombi)) === hp0 - 3) && ((await oiled()).length === 1), `dégâts contondants : 3 PV, l'huile ne s'enflamme pas (${hp0} → ${await ctx.hp(zombi)})`);

    await ctx.setHp(zombi, hp0);
    const since = await ctx.lastMessageId();
    await ctx.engine("hurt", { tokenId: zombi.id, amount: 3, type: "fire" });
    await pause(2500);
    const hp = await ctx.hp(zombi);
    ctx.expect(hp === hp0 - 8, `dégâts de feu : 3 + 5 de l'huile qui brûle (${hp0} → ${hp})`);
    ctx.expect(!(await oiled()).length, "l'huile a brûlé : la marque tombe");
    ctx.expect((await ctx.messagesSince(since)).some(m => m.flags?.["dnd5e-combat"]?.oilBurns), "annoncé au chat");
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
