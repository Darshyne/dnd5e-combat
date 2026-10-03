/**
 * Sources de lumière portées (SPEC §52). Items prêtés depuis le compendium du Manuel des joueurs.
 *  1. Lampe : son activité l'allume (Lumière vive 4,50 m, faible jusqu'à 13,50 m, flamme qui vacille), puis l'éteint.
 *  2. Lanterne sourde : un cône (angle).
 *  3. Torche (pas d'activité de lumière) : la boîte à amadou l'allume — seule source éteinte restante, d'office.
 *  4. La torche quitte la fiche : sa lumière s'éteint.
 * Remet la lumière ; retire les items prêtés.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const EQ = "Compendium.dnd-players-handbook.equipment.Item";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sources de lumière — lampe, lanterne sourde, torche par la boîte à amadou",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier requis : non applicable"); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.equipment") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const g = await ctx.token("Guerrier");
    const actorId = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.actorId;
    const light = async () => (await ctx.engine("stats", { tokenId: g.id }))?.light ?? {};
    const lit = async () => ((await ctx.call("get-actor", { actorId })).effects ?? []).filter(e => e.flags?.["dnd5e-combat"]?.carriedLightOf);
    ctx.restore(async () => {
      for ( const e of await lit() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
    });
    const grid = await ctx.call("get-scene", {}).then(s => s.grid ?? s.scene?.grid ?? null).catch(() => null);
    const base = await light();
    ctx.log(`lumière de départ : ${base.bright}/${base.dim} (unité de la scène : ${grid?.units ?? "?"})`);
    const use = async (itemId, activityType="utility") => {
      await ctx.use({ tokenId: g.id, itemId, activityType, targetTokenIds: [] });
      await pause(2000);
    };

    // 1. Lampe.
    const lamp = await ctx.ensureItem(g, `${EQ}.Ekz3r0UKJ261oBJj`);
    await use(lamp);
    let l = await light();
    ctx.expect((l.bright === 15) && (l.dim === 45) && (l.animation === "torch"), `lampe allumée : ${l.bright}/${l.dim} ft, animation ${l.animation}`);
    await use(lamp);
    l = await light();
    ctx.expect((l.bright === base.bright) && (l.dim === base.dim) && !(await lit()).length, `lampe éteinte : ${l.bright}/${l.dim}, plus d'effet`);

    // 2. Lanterne sourde : un cône.
    const bullseye = await ctx.ensureItem(g, `${EQ}.KZUoiZrigDbovEu7`);
    await use(bullseye);
    l = await light();
    ctx.expect((l.bright === 60) && (l.dim === 120) && (l.angle === 53), `lanterne sourde : ${l.bright}/${l.dim} ft en cône de ${l.angle}°`);
    await use(bullseye);

    // 3. Torche, par la boîte à amadou (la lampe et la lanterne sont éteintes : trois sources, donc un choix — on retire les deux
    // premières pour que la torche reste seule et soit allumée d'office).
    for ( const id of [lamp, bullseye] ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: id }).catch(() => {});
    await pause(1000);
    const torch = await ctx.ensureItem(g, `${EQ}.gYKSyS7STTresmnS`);
    const tinderbox = await ctx.ensureItem(g, `${EQ}.367bsHMaHI1II4k9`);
    await use(tinderbox);
    l = await light();
    ctx.expect((l.bright === 20) && (l.dim === 40), `boîte à amadou : torche allumée, ${l.bright}/${l.dim} ft`);

    // 4. La torche quitte la fiche : sa lumière s'éteint.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: torch });
    await pause(2500);
    l = await light();
    ctx.expect(!(await lit()).length && (l.bright === base.bright), `torche retirée : plus de lumière (${l.bright}/${l.dim})`);
  }
};
