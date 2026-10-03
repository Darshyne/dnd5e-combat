/**
 * M8 (SPEC §18.14) — Mort explosive. Monde `ravenloft` : la Mort explosive du Méphite de poussière (Monster Manual) prêtée
 * au Loup. Bramo et le Zombi à 1,50 m, l'Ours brun à 4,50 m. Le Loup tombe à 0 PV → Mort → une carte : sauvegarde de
 * Dextérité de Bramo et du Zombi (pas de l'Ours), dégâts appliqués. Une seconde écriture de 0 PV ne relance rien.
 */
const MEPHIT = "Compendium.dnd-monster-manual.actors.Actor.mmDustMephit0000";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "mort explosive — le Méphite explose en mourant",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi", "Ours brun", "Bramo"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup, Zombi, Ours brun ou Bramo absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const bear = await ctx.token("Ours brun");
    const bramo = await ctx.token("Bramo");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, zombi, bear, bramo] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(wolf, s));

    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const { data: mephit } = await ctx.call("get-compendium-entry", { uuid: MEPHIT });
    const { _id, folder, ownership, _stats, ...itemData } = mephit.items.find(i => i.system?.identifier === "death-burst");
    const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "death-burst" } });
    const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(wolf.id, "death-burst"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: bramo.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x - grid, y: at.y, elevation: at.elevation });
    await ctx.call("move-token", { tokenId: bear.id, x: at.x, y: at.y + 3 * grid, elevation: at.elevation });
    for ( const t of [bramo, zombi, bear] ) await ctx.setHp(t, 100);
    await sleep(800);
    const hpBefore = { bramo: await ctx.hp(bramo), zombi: await ctx.hp(zombi) };

    const mark = await ctx.lastMessageId();
    await ctx.setHp(wolf, 0);
    await sleep(3000);
    const bursts = async since => (await ctx.messagesSince(since)).filter(m => (m.flags?.[MODULE_ID]?.areaTick?.event === "emanation")
      && (m.flags[MODULE_ID].areaTick.moment === "death"));
    const cards = await bursts(mark);
    if ( !ctx.expect(cards.length === 1, `le Loup meurt : une carte de Mort explosive (${cards.length})`) ) return;
    const r = await ctx.settle(cards[0].id).catch(() => null);
    const on = (r?.targets ?? []).map(t => String(t.token ?? ""));
    ctx.expect(on.some(u => u.endsWith(bramo.id)) && on.some(u => u.endsWith(zombi.id)), `Bramo et le Zombi, à 1,50 m, sont pris (${on.length} cible(s))`);
    ctx.expect(!on.some(u => u.endsWith(bear.id)), "l'Ours brun, à 4,50 m, non");
    ctx.expect(!on.some(u => u.endsWith(wolf.id)), "le Loup lui-même, non");
    ctx.expect((r?.targets ?? []).every(t => t.save && (t.save.success !== null)), `sauvegardes de Dextérité jouées (${(r?.targets ?? []).map(t => `${t.name} ${t.save?.total}`).join(", ")})`);
    await sleep(800);
    const lost = (await ctx.hp(bramo)) < hpBefore.bramo || (await ctx.hp(zombi)) < hpBefore.zombi;
    ctx.expect(lost, `dégâts appliqués (Bramo ${hpBefore.bramo} → ${await ctx.hp(bramo)}, Zombi ${hpBefore.zombi} → ${await ctx.hp(zombi)})`);

    const again = await ctx.lastMessageId();
    await ctx.setHp(wolf, 0);
    await sleep(2000);
    ctx.expect(!(await bursts(again)).length, "déjà mort : pas de seconde explosion");
  }
};
