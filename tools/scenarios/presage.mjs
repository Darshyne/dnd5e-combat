/**
 * Présage du Devin (SPEC §36), monde `dnd-6`. Le Magicien reçoit Présage, prêté depuis le compendium du Manuel des joueurs ; le Bandit
 * 300 PV. Les jets notés sont fixés par `api.mcp.portent` (valeurs connues), la question prise d'office (`autoReact: "first"` : la plus
 * haute valeur pour soi ou un allié, la plus basse pour un ennemi). Vérifie :
 *  - Repos long simulé (`roll: true`) : deux d20 notés, la carte chuchotée ;
 *  - attaque : Rayon de givre du Magicien sur le Bandit avec [20, 2] → le d20 vaut 20 (« min20max20 »), coup critique, il reste [2] ;
 *  - sauvegarde : Aspersion acide sur le Bandit avec [20, 2] → sa sauvegarde a 2 au d20, ratée, il reste [20] ;
 *  - une fois par tour : en combat, deux Rayons de givre au même tour — le second garde son d20 ;
 *  - réglage « Présage du Devin » désactivé (§38.4) : ni l'attaque ni la sauvegarde ne sont bornées, les jets notés restent.
 * Remet positions, PV, états, emplacements ; retire l'item prêté et les jets notés.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "présage — jets notés, attaque, sauvegarde, une fois par tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes(CLASSES) ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const mage = await ctx.token("Magicien");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [mage, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(mage.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const place = async (t, x, y) => { await ctx.call("move-token", { tokenId: t.id, x, y, elevation: 0 }); await pause(700); };

    // L'item prêté, et les jets notés effacés en fin de scénario.
    const uuid = `Compendium.${CLASSES}.Item.phbwzdPortent000`;
    const { data } = await ctx.call("get-compendium-entry", { uuid });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    setPath(itemData, "flags.dnd5e.sourceId", uuid);
    const lent = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: lent.id }).catch(() => {}));
    ctx.restore(() => ctx.engine("portent", { tokenId: mage.id, clear: true }).catch(() => {}));
    const foretell = rolls => ctx.engine("portent", { tokenId: mage.id, rolls });

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.removeEffectsNamed(t, /Ralenti|Slowed|Rayon de givre|Ray of Frost/i);
        if ( id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };

    /** Rayon de givre du Magicien sur le Bandit, question prise d'office : la porte suspend l'utilisation, la suite se lit dans le chat.
     * Seul le Magicien agit dans ce scénario ; ses cartes sont signées du nom de son token (« claude » dans `dnd-6`), d'où le filtre par type. */
    const frostRay = async () => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [bandit.id],
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "first" } } });
      let attack = null;
      for ( const stop = Date.now() + 25000; !attack && (Date.now() < stop); await pause(800) ) {
        attack = (await ctx.messagesSince(since)).find(m => (m.type === "attack"));
      }
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const usage = msgs.find(m => (m.type === "usage") && !m.flags?.["dnd5e-combat"]?.reaction);
      const r = usage ? await ctx.settle(usage.id, { timeoutMs: 30000 }).catch(() => null) : null;
      return { attack, msgs, r, formula: attack?.rolls?.[0]?.formula ?? "" };
    };

    await part("Repos long", async () => {
      const since = await ctx.lastMessageId();
      const state = await ctx.engine("portent", { tokenId: mage.id, roll: true });
      ctx.expect((state.dice === 2) && (state.rolls.length === 2) && state.rolls.every(n => (n >= 1) && (n <= 20)), `deux d20 notés (${state.rolls.join(", ")})`);
      const card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.portent?.rolled);
      ctx.expect(!!card && (card.whisper === true), `carte des jets notés, chuchotée (${card?.whisper})`);
    });

    await part("Attaque", async () => {
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      await foretell([20, 2]);
      const { formula, msgs, r } = await frostRay();
      ctx.expect(/min20/.test(formula) && /max20/.test(formula), `le d20 du Magicien vaut 20 : ${formula}`);
      const used = msgs.find(m => m.flags?.[MODULE_ID]?.portent?.used !== undefined)?.flags?.[MODULE_ID]?.portent;
      ctx.expect(used?.used === 20, `carte du Présage : ${JSON.stringify(used)}`);
      const t = r?.targets?.find(x => x.name === "Bandit");
      ctx.expect((t?.hit === true) && (t?.critical === true), `coup critique (touché ${t?.hit}, critique ${t?.critical})`);
      const left = await ctx.engine("portent", { tokenId: mage.id });
      ctx.expect(JSON.stringify(left.rolls) === "[2]", `il reste ${JSON.stringify(left.rolls)}`);
    });

    await part("Sauvegarde", async () => {
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      await foretell([20, 2]);
      const since = await ctx.lastMessageId();
      const box = await ctx.box(bandit);
      const u = await ctx.use({ tokenId: mage.id, identifier: "acid-splash", activityType: "save", area: { shape: "rectangle", ...box },
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "first" } } });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1000);
      const save = (await ctx.messagesSince(since)).find(m => (m.type === "save") && (m.alias === "Bandit"));
      const formula = save?.rolls?.[0]?.formula ?? "";
      ctx.expect(/min2(?!\d)/.test(formula) && /max2(?!\d)/.test(formula), `le d20 du Bandit vaut 2 : ${formula} = ${save?.rolls?.[0]?.total}`);
      const t = r?.targets?.find(x => x.name === "Bandit");
      ctx.expect(t?.save?.success === false, `sauvegarde ratée (${t?.save?.total} contre DD ${r?.plan?.save?.dc ?? "?"})`);
      const left = await ctx.engine("portent", { tokenId: mage.id });
      ctx.expect(JSON.stringify(left.rolls) === "[20]", `il reste ${JSON.stringify(left.rolls)}`);
    });

    await part("Réglage désactivé", async () => {
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      await foretell([20, 2]);
      const was = await ctx.engine("setting", { key: "portent", value: false });
      ctx.restore(() => ctx.engine("setting", { key: "portent", value: was.before }).catch(() => {}));
      const { formula } = await frostRay();
      ctx.expect(!!formula && !/min\d/.test(formula), `attaque, Présage désactivé : d20 libre (${formula})`);
      const box = await ctx.box(bandit);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: mage.id, identifier: "acid-splash", activityType: "save", area: { shape: "rectangle", ...box },
        usageConfig: { [MODULE_ID]: { confirmed: true, autoReact: "first" } } });
      if ( u.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: u.regionId }).catch(() => {}));
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1000);
      const save = (await ctx.messagesSince(since)).find(m => (m.type === "save") && (m.alias === "Bandit"));
      ctx.expect(!!save && !/min\d/.test(save?.rolls?.[0]?.formula ?? ""), `sauvegarde, Présage désactivé : d20 libre (${save?.rolls?.[0]?.formula})`);
      const left = await ctx.engine("portent", { tokenId: mage.id });
      ctx.expect(JSON.stringify(left.rolls) === "[20,2]", `les jets notés restent ${JSON.stringify(left.rolls)}`);
      await ctx.engine("setting", { key: "portent", value: was.before });
    });

    await part("Une fois par tour", async () => {
      await tough(); await place(bandit, g.x + 2 * grid, g.y);
      await foretell([20, 19]);
      await ctx.startCombat([mage, bandit]);
      const first = await frostRay();
      ctx.expect(/min20/.test(first.formula), `premier Rayon : ${first.formula}`);
      const second = await frostRay();
      ctx.expect(!/min\d/.test(second.formula), `second Rayon au même tour, d20 libre : ${second.formula}`);
      const left = await ctx.engine("portent", { tokenId: mage.id });
      ctx.expect(JSON.stringify(left.rolls) === "[19]", `il reste ${JSON.stringify(left.rolls)}`);
    });
  }
};
