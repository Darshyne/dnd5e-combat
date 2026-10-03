/**
 * M5 (SPEC §18.8) — variantes d'attaque du Monster Manual, prêtées au Loup le temps du scénario. Monde `ravenloft`.
 * L'attaque jouée reste celle de base (même jet) ; le plan de la résolution retient la variante (`plan.variant`), qui donne
 * ses effets et ses dégâts.
 *  1. Charge : Défense du Sanglier. Sans déplacement, pas de variante, et pas d'À terre même touché (l'effet recopié sur
 *     l'attaque de base ne vaut qu'après une charge). Après 20 ft en ligne droite vers le Zombi, la variante « Moving
 *     Attack » ; touché, le Zombi (M) tombe À terre et les dégâts portent le 1d6 de la charge.
 *  2. En sang : Morsures de la Nuée de rats. Loup à moitié de ses PV : la variante « Bloodied Attack » (1d4 au lieu de 2d4).
 *  3. Avantage : Cimeterre du Guerrier gobelin contre le Zombi À terre au contact (avantage) : les dégâts se lancent sur la
 *     variante « Attack with Advantage » (1d6 + 1d4 au lieu de 1d6).
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ACTOR = id => `Compendium.dnd-monster-manual.actors.Actor.${id}`;

export default {
  name: "variantes d'attaque — charge, En sang, avantage",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Zombi absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    for ( const t of [wolf, zombi] ) {
      const home = await ctx.position(t);
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      ctx.restore(() => ctx.setHp(t, hp));
    }
    ctx.restore(() => ctx.removeStatusEffects(zombi, "prone"));
    await ctx.removeStatusEffects(zombi, "prone");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const wolfHpMax = (await ctx.call("get-actor", { actorId: tok.actorId })).system?.attributes?.hp?.max ?? 11;

    /** Prête au Loup l'item `identifier` d'une créature du MM ; rend son id et les ids de ses activités par nom anglais. */
    const borrow = async (actorId, identifier) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid: ACTOR(actorId) });
      const { _id, folder, ownership, _stats, ...itemData } = data.items.find(i => i.system?.identifier === identifier);
      const mine = `variant-${identifier}`;
      itemData.system.identifier = mine;
      const r = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: mine } });
      const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(wolf.id, mine));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));
      const names = itemData.flags?.babele?.originalPayload?.activities ?? {};
      const byName = Object.fromEntries(Object.keys(itemData.system.activities).map(id => [names[id]?.name ?? itemData.system.activities[id].name ?? "", id]));
      return { itemId, byName };
    };

    /** Attaque ; rend la résolution, et la formule des dégâts lancés. */
    const strike = async itemId => {
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: wolf.id, itemId, activityType: "attack", targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      return { r, formula: damage?.rolls?.map(x => x.formula).join(" + ") ?? "" };
    };
    const variantOf = r => String(r?.plan?.variant?.activity ?? "").split(".").pop() || null;
    const prone = async () => (await ctx.effects(zombi)).some(e => !e.disabled && !e.duration?.expired && (e.statuses ?? []).includes("prone"));

    await ctx.startCombat([wolf, zombi]);
    const current = async () => {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      return combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId ?? null;
    };
    const toWolf = async () => { for ( let i = 0; (i < 3) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(800); } };
    await toWolf();
    const at = await ctx.position(wolf);

    // 1. Charge — Défense du Sanglier.
    const gore = await borrow("mmBoar0000000000", "gore");
    // Une ligne libre pour la charge : le Zombi d'un côté du Loup, quatre cases libres de l'autre (la scène bouge d'un
    // essai à l'autre — vu le 2026-09-26 : Kaalisti posée au point de départ, la charge n'avait pas lieu).
    const others = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.filter(t => ![wolf.id, zombi.id].includes(t.id));
    const occupied = (x, y) => others.some(t => (x < t.x + (t.width ?? 1) * grid) && (x + grid > t.x) && (y < t.y + (t.height ?? 1) * grid) && (y + grid > t.y));
    const dir = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => !occupied(at.x - dx * grid, at.y - dy * grid)
      && [1, 2, 3, 4].every(k => !occupied(at.x + k * dx * grid, at.y + k * dy * grid))) ?? [-1, 0];
    const cell = k => ({ x: at.x + k * dir[0] * grid, y: at.y + k * dir[1] * grid });
    await ctx.call("move-token", { tokenId: zombi.id, ...cell(-1), elevation: at.elevation });
    let still = null;
    for ( let i = 0; (i < 20) && !still?.r?.targets?.[0]?.hit; i++ ) { await ctx.setHp(zombi, 100); still = await strike(gore.itemId); }
    ctx.expect(!variantOf(still?.r), `sans charge : pas de variante (${variantOf(still?.r)})`);
    await sleep(800);
    ctx.expect(!(await prone()), "touché sans charge : le Zombi reste debout (À terre seulement après une charge)");

    let charged = null;
    for ( let turn = 0; (turn < 8) && !charged?.r?.targets?.[0]?.hit; turn++ ) {
      await ctx.nextTurn(); await sleep(600); await toWolf();
      await ctx.removeStatusEffects(zombi, "prone");
      await ctx.call("move-token", { tokenId: wolf.id, ...cell(4), elevation: at.elevation });
      await ctx.nextTurn(); await sleep(600); await toWolf();   // l'historique du tour repart de là
      await ctx.call("update-scene-object", { type: "Token", objectId: wolf.id, data: { x: at.x, y: at.y } });
      await sleep(1200);
      await ctx.setHp(zombi, 100);
      charged = await strike(gore.itemId);
    }
    ctx.expect(variantOf(charged?.r) === gore.byName["Moving Attack"], `après 20 ft droit vers le Zombi : variante « Moving Attack » (${variantOf(charged?.r)})`);
    if ( charged?.r?.targets?.[0]?.hit ) {
      await sleep(800);
      ctx.expect(await prone(), "touché après la charge : le Zombi tombe À terre");
      ctx.expect(/1d6.*1d6|2d6/.test(charged.formula), `dégâts de la charge (${charged.formula})`);
    }
    else ctx.expect(false, "aucun toucher après la charge en 8 essais");
    await ctx.removeStatusEffects(zombi, "prone");

    // 2. En sang — Morsures de la Nuée de rats.
    const bites = await borrow("mmSwarmOfRats000", "bites");
    await ctx.setHp(wolf, Math.floor(wolfHpMax / 2));
    let swarm = null;
    for ( let i = 0; (i < 20) && !swarm?.r?.targets?.[0]?.hit; i++ ) { await ctx.setHp(zombi, 100); swarm = await strike(bites.itemId); }
    ctx.expect(variantOf(swarm?.r) === bites.byName["Bloodied Attack"], `Loup En sang : variante « Bloodied Attack » (${variantOf(swarm?.r)})`);
    if ( swarm?.r?.targets?.[0]?.hit ) ctx.expect(/1d4/.test(swarm.formula) && !/2d4/.test(swarm.formula), `dégâts de la nuée En sang (${swarm.formula})`);
    await ctx.setHp(wolf, wolfHpMax);

    // 3. Avantage — Cimeterre du Guerrier gobelin contre le Zombi À terre, au contact.
    const scimitar = await borrow("mmGoblinWarrior0", "scimitar");
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "prone", active: true }).catch(() => null);
    let adv = null;
    for ( let i = 0; (i < 20) && !adv?.r?.targets?.[0]?.hit; i++ ) { await ctx.setHp(zombi, 100); adv = await strike(scimitar.itemId); }
    ctx.expect(!variantOf(adv?.r), `avant le jet, pas de variante (${variantOf(adv?.r)})`);
    ctx.expect(/1d4/.test(adv?.formula ?? ""), `jet avec l'avantage : dégâts de la variante « Attack with Advantage » (${adv?.formula})`);
  }
};
