/**
 * Potions de guérison (SPEC §51). Items prêtés depuis les compendiums du Manuel des joueurs et du Guide du maître.
 *  1. En combat, au tour du Guerrier : il boit la potion du Manuel des joueurs — 2d4 + 2 PV, action Bonus dépensée, potion consommée.
 *  2. Hors combat : il la donne au Clerc blessé, au contact — c'est le Clerc qui est soigné.
 *  3. Hors combat : le Clerc à 0 PV (Inconscient) — la potion le relève (plus Inconscient).
 *  4. La potion du Guide du maître (portée « personnelle »), sans cible désignée : c'est celui qui la boit qui est soigné.
 * Remet PV, états, positions (filet de sécurité) ; retire les potions prêtées.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook.equipment.Item.phbagPotionofHea";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgPotionOfHeali";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "potions de guérison — boire, donner, relever, version du Guide",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Guerrier", "Clerc"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Guerrier et Clerc requis : non applicable"); return; }
    const packs = JSON.stringify(await ctx.call("list-compendiums", {}).catch(() => null) ?? "");
    if ( !packs.includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const guerrier = await ctx.token("Guerrier");
    const clerc = await ctx.token("Clerc");
    const before = { g: await ctx.hp(guerrier), c: await ctx.hp(clerc) };
    const actorOf = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data.actorId;
    const gActor = await actorOf(guerrier);
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);
    const potions = new Set();
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const t of [guerrier, clerc] ) for ( const s of ["stable", "unconscious", "prone"] ) await ctx.removeStatusEffects(t, s);
      if ( before.g !== null ) await ctx.setHp(guerrier, before.g);
      if ( before.c !== null ) await ctx.setHp(clerc, before.c);
      for ( const id of potions ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: gActor, itemId: id }).catch(() => {});
    });

    /** Une potion fraîche sur le Guerrier (la précédente est détruite à l'usage), d'après le compendium donné. */
    const fresh = async (uuid, name) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.name = name;
      const r = await ctx.call("upsert-embedded-item", { documentType: "Actor", id: gActor, itemData, match: { path: "name", value: name } });
      potions.add(r.itemId);
      return r.itemId;
    };
    const drink = async (itemId, targets) => {
      const used = await ctx.use({ tokenId: guerrier.id, itemId, activityType: "heal", targetTokenIds: targets.map(t => t.id), consume: true });
      // use-activity du connecteur coupe l'enchaînement de dnd5e (`subsequentActions: false`) : le jet de soin se lance par la
      // carte, comme le clic d'un joueur (api.mcp.rollCard) — la potion est alors déjà détruite, dnd5e la relit dans le message.
      await pause(1000);
      await ctx.engine("rollCard", { messageId: used.usageMessageId });
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return r;
    };
    const exists = async itemId => ((await ctx.call("get-actor", { actorId: gActor })).items ?? []).some(i => (i._id ?? i.id) === itemId);
    const healed = (from, to) => ((to - from) >= 4) && ((to - from) <= 10);

    // 1. Boire, en combat, au tour du Guerrier.
    await ctx.setHp(guerrier, Math.max(1, before.g - 15));
    await ctx.startCombat([guerrier, clerc]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const combat = await state();
    for ( const [t, v] of [[guerrier, 20], [clerc, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    for ( let i = 0; (i < 3) && ((await current()) !== guerrier.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( ctx.expect((await current()) === guerrier.id, "combat : au tour du Guerrier") ) {
      const potion = await fresh(PHB, "Potion de guérison (scénario)");
      const hp0 = await ctx.hp(guerrier);
      await drink(potion, [guerrier]);
      const hp1 = await ctx.hp(guerrier);
      ctx.expect(healed(hp0, hp1), `il boit : ${hp1 - hp0} PV (2d4 + 2) — ${hp0} → ${hp1}`);
      ctx.expect((await ctx.engine("budget", { tokenId: guerrier.id }))?.bonus === 0, "l'action Bonus est dépensée");
      ctx.expect(!(await exists(potion)), "la potion est consommée");
    }
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await pause(1500);

    // 2. La donner au Clerc, au contact.
    const spot = await ctx.position(guerrier);
    const grid = await ctx.gridSize();
    await ctx.call("move-token", { tokenId: clerc.id, x: spot.x + grid, y: spot.y, elevation: spot.elevation ?? 0 });
    await ctx.setHp(clerc, Math.max(1, before.c - 15));
    await pause(1500);
    {
      const potion = await fresh(PHB, "Potion de guérison (scénario)");
      const g0 = await ctx.hp(guerrier), c0 = await ctx.hp(clerc);
      await drink(potion, [clerc]);
      const g1 = await ctx.hp(guerrier), c1 = await ctx.hp(clerc);
      ctx.expect(healed(c0, c1) && (g1 === g0), `donnée au Clerc : lui regagne ${c1 - c0} PV, le Guerrier rien (${g1 - g0})`);
    }

    // 3. Relever le Clerc à 0 PV.
    await ctx.setHp(clerc, 0);
    await pause(2500);
    ctx.expect((await statuses(clerc)).includes("unconscious"), "le Clerc à 0 PV est Inconscient");
    {
      const potion = await fresh(PHB, "Potion de guérison (scénario)");
      await drink(potion, [clerc]);
      await pause(1500);
      const c1 = await ctx.hp(clerc);
      ctx.expect((c1 >= 4) && !(await statuses(clerc)).includes("unconscious"), `relevé : ${c1} PV, plus Inconscient (états : ${(await statuses(clerc)).join(", ")})`);
    }

    // 4. La potion du Guide du maître, sans cible : celui qui la boit.
    if ( !packs.includes("dnd-dungeon-masters-guide.equipment") ) { ctx.log("Guide du maître absent : partie 4 non applicable"); return; }
    await ctx.setHp(guerrier, Math.max(1, before.g - 15));
    await pause(1000);
    {
      const potion = await fresh(DMG, "Potion de guérison (Guide, scénario)");
      const g0 = await ctx.hp(guerrier);
      await drink(potion, []);
      const g1 = await ctx.hp(guerrier);
      ctx.expect(healed(g0, g1), `version du Guide, sans cible : le buveur regagne ${g1 - g0} PV — ${g0} → ${g1}`);
    }
  }
};
