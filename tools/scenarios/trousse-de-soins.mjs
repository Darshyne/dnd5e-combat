/**
 * Trousse de soins (SPEC §50). Item prêté depuis le compendium du Manuel des joueurs.
 *  1. Le Guerrier tombe à 0 PV (Inconscient) ; le Clerc, au contact, utilise la trousse : Stabilisé, annoncé au chat, une
 *     utilisation dépensée.
 *  2. Le Guerrier debout : la trousse ne stabilise rien.
 * Remet PV, états, utilisations ; retire l'item prêté (positions : filet de sécurité).
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const KIT = "Compendium.dnd-players-handbook.equipment.Item.phbagHealersKit0";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "trousse de soins — stabiliser une créature à 0 PV",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Clerc", "Guerrier"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Clerc et Guerrier requis : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const clerc = await ctx.token("Clerc");
    const guerrier = await ctx.token("Guerrier");
    const hpBefore = await ctx.hp(guerrier);
    const statuses = async () => (await ctx.effects(guerrier)).flatMap(e => e.statuses ?? []);
    const clean = async () => {
      for ( const s of ["stable", "unconscious", "prone"] ) await ctx.removeStatusEffects(guerrier, s);
      if ( hpBefore !== null ) await ctx.setHp(guerrier, hpBefore);
    };
    ctx.restore(clean);

    const kit = await ctx.ensureItem(clerc, KIT);
    const spot = await ctx.position(guerrier);
    const grid = await ctx.gridSize();
    await ctx.call("move-token", { tokenId: clerc.id, x: spot.x + grid, y: spot.y, elevation: spot.elevation ?? 0 });
    await pause(1500);
    const uses = async () => {
      const actor = await ctx.call("get-actor", { actorId: clerc.actorId });
      const item = (actor.items ?? []).find(i => (i._id ?? i.id) === kit);
      return item?.system?.uses?.spent ?? null;
    };

    // Une trousse déjà sur la fiche garde son compteur d'utilisations.
    const spent0 = await uses();
    ctx.restore(() => ctx.call("upsert-embedded-item", { documentType: "Actor", id: clerc.actorId,
      itemData: { "system.uses.spent": spent0 ?? 0 }, match: { path: "_id", value: kit } }).catch(() => {}));

    // 1. À 0 PV : stabilisé.
    await ctx.setHp(guerrier, 0);
    await pause(2500);
    ctx.expect((await statuses()).includes("unconscious") && !(await statuses()).includes("stable"), "le Guerrier à 0 PV est Inconscient, pas Stabilisé");
    const spentBefore = await uses();
    const since = await ctx.lastMessageId();
    await ctx.use({ tokenId: clerc.id, itemId: kit, activityType: "utility", targetTokenIds: [guerrier.id], consume: true });
    await pause(3000);
    ctx.expect((await statuses()).includes("stable"), `trousse : le Guerrier est Stabilisé (états : ${(await statuses()).join(", ")})`);
    const told = (await ctx.messagesSince(since)).some(m => m.flags?.["dnd5e-combat"]?.death?.kind === "stable");
    ctx.expect(told, "la stabilisation est annoncée au chat");
    ctx.expect((await uses()) === (spentBefore ?? 0) + 1, `une utilisation de la trousse dépensée (${spentBefore} → ${await uses()})`);

    // 2. Debout : rien à stabiliser.
    await clean();
    await pause(1500);
    await ctx.use({ tokenId: clerc.id, itemId: kit, activityType: "utility", targetTokenIds: [guerrier.id], consume: true });
    await pause(2500);
    ctx.expect(!(await statuses()).includes("stable"), "le Guerrier debout n'est pas « stabilisé »");
  }
};
