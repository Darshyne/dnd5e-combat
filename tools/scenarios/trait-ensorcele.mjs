/**
 * Trait ensorcelé (SPEC §16.43, clés `tether` et `ranges`). Monde `ravenloft` : Kaalisti (occultiste 5) et le Zombi.
 *  1. L'attaque lie le Zombi, touché ou raté (`flags["dnd5e-combat"].tethers.<id d'item>` sur Kaalisti).
 *  2. L'action Bonus « 1d12 foudre » (activité `ffuqn0xdclG9YAQt`) le vise (ses dégâts : à la main, le connecteur ne les lance pas).
 *  3. Le Zombi éloigné au-delà de 60 ft : le lien se rompt, la concentration tombe, le lien est oublié.
 * Non applicable sans Kaalisti et le Zombi. Remet PV, position et concentration.
 */
const MODULE_ID = "dnd5e-combat";
const FOLLOW = "ffuqn0xdclG9YAQt";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Trait ensorcelé — lien, action Bonus, rupture hors de portée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Kaalisti", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Kaalisti ou le Zombi absent : non applicable"); return; }
    const warlock = await ctx.token("Kaalisti");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    const start = await ctx.position(zombi);
    const at = await ctx.position(warlock);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: start.x, y: start.y }).catch(() => {}));
    ctx.restore(() => ctx.removeEffectsNamed(warlock, /concentr/i));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /Foudre continue|Witch Bolt/i));

    // Le Zombi à 20 ft de Kaalisti.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + (4 * grid), y: at.y });
    const itemId = await ctx.itemId(warlock.id, "witch-bolt");
    const tethered = async () => (await ctx.call("get-actor", { actorId: warlock.actorId })).flags?.[MODULE_ID]?.tethers?.[itemId] ?? null;

    // 1. L'attaque lie le Zombi.
    const used = await ctx.use({ tokenId: warlock.id, identifier: "witch-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
    const r = await ctx.settle(used.usageMessageId).catch(() => null);
    await pause(1500);
    const bound = await tethered();
    ctx.expect(!!bound && bound.endsWith(zombi.id), `lien noté (${r?.targets?.[0]?.hit ? "touché" : "raté"}) : ${bound}`);

    // 2. L'action Bonus : 1d12 d'office.
    // Le connecteur coupe l'enchaînement de dnd5e (`subsequentActions: false`) : le jet de dégâts d'une activité « damage » n'est
    // jamais lancé ici. On vérifie que l'action Bonus vise la créature liée ; les dégâts se vérifient à la main.
    const follow = await ctx.use({ tokenId: warlock.id, identifier: "witch-bolt", activityId: FOLLOW, targetTokenIds: [zombi.id] });
    await pause(1500);
    const rf = await ctx.resolution(follow.usageMessageId);
    const names = (rf?.targets ?? []).map(t => t.name);
    ctx.expect(follow.used && names.includes("Zombi") && !(rf?.targets ?? []).some(t => t.unaffected), `action Bonus : vise le Zombi (${names.join(", ") || "aucune cible"})`);

    // 3. Au-delà de 60 ft : le sort prend fin.
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + (14 * grid), y: at.y });
    await pause(2500);
    const concentration = ((await ctx.call("get-actor", { actorId: warlock.actorId })).effects ?? []).some(e => (e.statuses ?? []).includes("concentrating"));
    ctx.expect(!concentration, "Zombi à 70 ft : la concentration de Kaalisti tombe");
    ctx.expect(!(await tethered()), "le lien est oublié");
  }
};
