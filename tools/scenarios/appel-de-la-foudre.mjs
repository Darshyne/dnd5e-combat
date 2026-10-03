/**
 * Appel de la foudre (§70) : l'incantation pose le NUAGE (la pose de dnd5e, validée par `api.mcp.placeRegionAt`), habillé en orage
 * (FXMaster s'il est actif, sinon une zone sombre) ; la visée de l'ÉCLAIR s'ouvre aussitôt (`api.mcp.stormStrike` joue le clic) :
 * 1,50 m autour du point, le Zombi y fait sa sauvegarde de Dextérité. « Orage déjà là » (`stormy`) : +1d10. Relancé : pas de
 * nouveau nuage, un nouvel éclair. La concentration finie, le nuage s'en va.
 * Monde : un token dont l'acteur connaît le sort (`call-lightning`) et un Zombi sur la scène.
 */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "appel de la foudre — nuage qui reste, éclair visé dessous, orage déjà là, relance",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const zombieRef = tokens.find(t => t.name === "Zombi");
    let caster = null, item = null;
    for ( const t of tokens.filter(x => x.name !== "Zombi") ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( !a ) continue;
      const i = (a.items ?? []).find(x => x.system?.identifier === "call-lightning");
      if ( i ) { caster = t; item = i; break; }
    }
    if ( !caster || !zombieRef ) { ctx.log("ni lanceur d'Appel de la foudre ni Zombi : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const z = await ctx.position(zombie);
    const center = { x: z.x + (grid / 2), y: z.y + (grid / 2) };
    const api = (fn, args, waitMs) => ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn, args, ...(waitMs ? { waitMs } : {}) });
    const endConcentration = async () => {
      const a = await ctx.call("get-actor", { actorId: caster.actorId });
      for ( const e of (a.effects ?? []).filter(e => /Concentr/.test(e.name ?? "")) ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id }).catch(() => {});
      }
    };
    ctx.restore(endConcentration);

    // 1. L'incantation, orage déjà là : dnd5e attend la pose du nuage.
    let since = await ctx.lastMessageId();
    await api("use", { tokenId: caster.id, itemId: item._id, extra: { stormy: true } }, 500);
    await sleep(1500);
    const cloudPlaced = (await api("placeRegionAt", center)).result;
    ctx.expect(cloudPlaced?.placed, `le nuage est posé sur le Zombi (${JSON.stringify(cloudPlaced)})`);
    await sleep(2500);
    let state = (await api("storm", { tokenId: caster.id, itemId: item._id })).result;
    ctx.expect(!!state?.cloud, `le nuage reste sur la scène (${state?.cloud?.id ?? "aucun"})`);
    ctx.expect(state?.cloud?.stormy === true, "« orage déjà là » noté sur le nuage");
    ctx.log("habillage du nuage :", JSON.stringify({ visibility: state?.cloud?.visibility, behaviors: state?.cloud?.behaviors }));
    ctx.expect(state?.aiming === true, "la visée de l'éclair est ouverte");

    // 2. L'éclair sur le Zombi.
    const hp0 = await ctx.hp(zombie);
    const struck = (await api("stormStrike", center)).result;
    ctx.expect(struck?.struck, "l'éclair est posé");
    await sleep(7000);
    let messages = await ctx.messagesSince(since);
    const save = messages.find(m => /Dextérité|Dexterity/i.test(m.flavor ?? "") && (m.alias === "Zombi"));
    ctx.expect(!!save, "le Zombi fait sa sauvegarde de Dextérité");
    const damage = messages.find(m => /dégâts|damage/i.test(m.flavor ?? "") && /Appel|Lightning/i.test(m.flavor ?? ""));
    const formula = JSON.stringify(damage?.rolls ?? []);
    ctx.expect(formula.includes("3d10 + 1d10"), `dégâts 3d10 + 1d10 de l'orage (${formula.slice(0, 160)})`);
    ctx.log(`Zombi : ${hp0} → ${await ctx.hp(zombie)} PV`);
    state = (await api("storm", { tokenId: caster.id, itemId: item._id })).result;
    ctx.expect(!!state?.cloud && !state.aiming, "après l'éclair, le nuage est toujours là, la visée fermée");

    // 3. La relance : pas de nouveau nuage, un nouvel éclair.
    const cloudId = state?.cloud?.id;
    since = await ctx.lastMessageId();
    await api("use", { tokenId: caster.id, itemId: item._id }, 500);
    await sleep(2500);
    state = (await api("storm", { tokenId: caster.id, itemId: item._id })).result;
    ctx.expect(state?.cloud?.id === cloudId, "relancé : le même nuage");
    ctx.expect(state?.aiming === true, "relancé : la visée de l'éclair s'ouvre, sans pose de nuage");
    await api("stormStrike", { x: center.x + (2 * grid), y: center.y });
    await sleep(6000);
    messages = await ctx.messagesSince(since);
    ctx.expect(messages.some(m => (m.type === "usage") && JSON.stringify(m.flags ?? {}).includes("recast")), "la relance est notée (sans emplacement)");

    // 4. La concentration finie, le nuage s'en va.
    await endConcentration();
    await sleep(2500);
    state = (await api("storm", { tokenId: caster.id, itemId: item._id })).result;
    ctx.expect(!state?.cloud, "la concentration finie, le nuage est retiré");
  }
};
