/**
 * §347, lot O8d de la repasse des objets : défenses contre les seules attaques à distance. Arène de test (Guerrier, Clerc, Zombi).
 * Le Clerc juste au sud du Guerrier, le Zombi à 4 cases à l'est du Guerrier, une Arbalète légère en main.
 *  1. Bouclier antiprojectiles tenu : la CA du Guerrier contre le carreau vaut 2 de plus harmonisé que non harmonisé.
 *  2. Le Zombi tire sur le Clerc : le Guerrier réagit (prise d'office) et devient la cible.
 *  3. Bouclier d'attraction tenu et harmonisé : le carreau tiré sur le Clerc vise le Guerrier, sans réaction ; touché, il ne subit que
 *     la moitié des dégâts (Résistance). Non harmonisé : le carreau reste sur le Clerc.
 */
const MODULE_ID = "dnd5e-combat";
const DMG = "Compendium.dnd-dungeon-masters-guide.equipment.Item.";
const PHB = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-o8d — Bouclier antiprojectiles et Bouclier d'attraction : défenses contre les attaques à distance",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Clerc", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier, Clerc ou Zombi absent : non applicable"); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-dungeon-masters-guide.equipment") ) {
      ctx.log("Guide du maître absent : non applicable"); return;
    }
    const fighter = await ctx.token("Guerrier");
    const g = await ctx.gridSize();
    const at = await ctx.position(fighter);
    await ctx.stage({ tokens: { Clerc: [at.x, at.y + g], Zombi: [at.x + 4 * g, at.y] } });
    const cleric = await ctx.token("Clerc");
    const zombi = await ctx.token("Zombi");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id });
    const actorId = tok.actorId;
    const hp0 = await ctx.hp(fighter);
    const hpC = await ctx.hp(cleric);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    ctx.restore(() => ctx.setHp(cleric, hpC));
    const set = (itemId, data) => ctx.call("upsert-actor-item", { actorId, itemData: data, match: { path: "_id", value: itemId } });
    const bow = await ctx.ensureItem(zombi, `${PHB}phbwepLightCross`);
    const catcher = await ctx.ensureItem(fighter, `${DMG}dmgArrowcatching`);
    const attractor = await ctx.ensureItem(fighter, `${DMG}dmgShieldOfMissi`);
    await set(attractor, { system: { equipped: false, attuned: false } });

    /** Le Zombi tire sur `target` (réactions prises d'office) ; rend la cible de la résolution et la résolution. */
    // Une réaction avant le jet relance l'utilisation : la carte qui porte la résolution est alors la dernière depuis la borne.
    const shoot = async (target, autoReact="first") => {
      const mark = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: zombi.id, itemId: bow, activityType: "attack", consume: false, targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact } } });
      let r = used.usageMessageId ? await ctx.settle(used.usageMessageId).catch(() => null) : null;
      for ( let i = 0; !r && (i < 30); i++ ) {
        await pause(1000);
        const card = (await ctx.messagesSince(mark)).findLast(m => m.flags?.[MODULE_ID]?.resolution && (m.flags[MODULE_ID].resolution.targets ?? []).length);
        if ( card ) r = await ctx.settle(card.id).catch(() => null);
      }
      return { r, t: r?.targets?.[0] ?? null, used: { usageMessageId: used.usageMessageId ?? mark } };
    };

    // 1. CA contre le carreau.
    await set(catcher, { system: { equipped: true, attuned: false } });
    await pause(400);
    const plain = (await shoot(fighter, "none")).t?.ac;
    await set(catcher, { system: { equipped: true, attuned: true } });
    await pause(400);
    const shielded = (await shoot(fighter, "none")).t?.ac;
    ctx.expect(Number.isFinite(plain) && (shielded === plain + 2), `Bouclier antiprojectiles : CA ${plain} → ${shielded} contre le carreau`);

    // 2. Interception.
    const caught = await shoot(cleric);
    ctx.expect(caught.t?.name === "Guerrier", `Le Guerrier intercepte le carreau tiré sur le Clerc (cible : ${caught.t?.name ?? "?"})`);
    await set(catcher, { system: { equipped: false, attuned: false } });
    await ctx.setHp(fighter, hp0);

    // 3. Bouclier d'attraction.
    await set(attractor, { system: { equipped: true, attuned: false } });
    await pause(400);
    const free = await shoot(cleric, "none");
    ctx.expect(free.t?.name === "Clerc", `Bouclier d'attraction non harmonisé : le carreau reste sur le Clerc (${free.t?.name ?? "?"})`);
    await ctx.setHp(cleric, hpC);
    await set(attractor, { system: { equipped: true, attuned: true } });
    await pause(400);
    let halved = null;
    for ( let i = 0; (i < 20) && (halved === null); i++ ) {
      await ctx.setHp(fighter, hp0);
      const { t, used } = await shoot(cleric, "none");
      if ( i === 0 ) ctx.expect(t?.name === "Guerrier", `Bouclier d'attraction : le carreau tiré sur le Clerc vise le Guerrier (${t?.name ?? "?"})`);
      if ( !t?.hit ) continue;
      await pause(1500);
      const damage = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage");
      const total = (damage?.rolls ?? []).reduce((s, roll) => s + (roll.total ?? 0), 0);
      const lost = hp0 - await ctx.hp(fighter);
      if ( total > 0 ) halved = { total, lost };
    }
    ctx.expect(!!halved && (halved.lost === Math.floor(halved.total / 2)),
      `Résistance : ${halved?.total ?? "?"} dégâts de carreau, ${halved?.lost ?? "?"} PV perdus`);
    await set(attractor, { system: { equipped: false, attuned: false } });
  }
};
