/**
 * §428 : l'attaque d'opportunité à mains nues. Règles 2024 : « une attaque de corps à corps avec une arme ou une attaque à mains nues » —
 * un personnage qui n'a qu'un arc en main garde donc la sienne. L'Attaque à mains nues que le moteur pose sur les personnages est créée
 * non équipée (adapter/basics.mjs) : elle compte quand même (`meleeAttacksOf`, adapter/reactions.mjs).
 *  1. Toutes les armes du Roublard rangées, sauf son arc : le Zombi qui quitte son allonge est menacé par lui.
 *  2. La fenêtre de réaction du Roublard propose l'Attaque à mains nues ; « ne pas réagir » : la Réaction reste.
 * L'équipement du Roublard et la place du Zombi sont remis.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "attaque d'opportunité à mains nues — un personnage sans arme de mêlée en main",

  async run(ctx) {
    const rogue = await ctx.token("Roublard");
    const zombi = await ctx.token("Zombi");
    const script = async (code, args={}) => (await ctx.call("run-script", { waitMs: 8000, args, code }))?.result;
    const grid = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const at = await ctx.position(rogue);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));

    // Le Roublard ne tient que son arme à distance ; l'Attaque à mains nues reste comme elle est (rangée, en général).
    const gear = await script(`const a = canvas.tokens.get(args.id).actor; const weapons = a.items.filter(i => i.type === "weapon");
      const before = weapons.map(i => ({ id: i.id, equipped: i.system.equipped }));
      const ranged = weapons.find(i => [...i.system.activities].some(x => (x.type === "attack") && (x.attack?.type?.value === "ranged")));
      await a.updateEmbeddedDocuments("Item", weapons.map(i => ({ _id: i.id, "system.equipped": i.id === ranged?.id })));
      const unarmed = weapons.find(i => i.system.identifier === "unarmed-strike");
      return { before, ranged: ranged?.name ?? null, unarmed: unarmed ? { name: unarmed.name, equipped: unarmed.system.equipped } : null };`, { id: rogue.id });
    ctx.restore(() => script(`const a = canvas.tokens.get(args.id).actor;
      await a.updateEmbeddedDocuments("Item", args.before.map(b => ({ _id: b.id, "system.equipped": b.equipped }))); return true;`, { id: rogue.id, before: gear.before }));
    if ( !ctx.expect(!!gear.unarmed, `le Roublard a une Attaque à mains nues (${gear.unarmed?.name ?? "absente"})`) ) return;
    ctx.expect(gear.unarmed.equipped === false, `elle n'est pas équipée, et seule l'arme à distance l'est (${gear.ranged ?? "aucune"})`);

    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + grid, y: at.y, elevation: at.elevation });
    await pause(800);
    await ctx.startCombat([zombi, rogue]);
    await pause(800);

    // 1. Qui menace le départ du Zombi ?
    const away = { x: at.x + 5 * grid + grid / 2, y: at.y + grid / 2 };
    const threats = await ctx.engine("threats", { tokenId: zombi.id, point: away });
    ctx.expect(threats.includes("Roublard"), `le Roublard, sans arme de mêlée en main, menace quand même (${threats.join(", ") || "personne"})`);

    // 2. La fenêtre propose l'Attaque à mains nues.
    const moving = ctx.engine("move", { tokenId: zombi.id, point: away, stopAfterMs: 9000 }, { timeoutMs: 20000 }).catch(() => null);
    let offered = null;
    for ( const stop = Date.now() + 6000; !offered && (Date.now() < stop); ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 800 }).catch(() => null);
      offered = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${rogue.name}`) && (w.buttons ?? []).some(b => b.action === "none")) ?? null;
    }
    const labels = (offered?.buttons ?? []).filter(b => b.action !== "none").map(b => b.label);
    ctx.expect(!!offered && labels.some(l => l === gear.unarmed.name), `sa fenêtre de réaction propose l'Attaque à mains nues (${labels.join(", ") || "aucune fenêtre"})`);
    if ( offered ) await ctx.call("answer-dialog", { id: offered.id, button: "none" }).catch(() => {});
    await moving;
  }
};
