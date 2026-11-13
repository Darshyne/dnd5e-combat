/**
 * §434 : Disciple de la vie du SRD de dnd5e 6.1 joué en jeu (§433, point 6). Le SRD 6.1 en fait un enchantement du sort de soin
 * (`2 + @item.level` sur le soin de l'activité) ; le moteur, qui ajoutait lui-même 2 + le niveau du sort, ne doit plus le faire pour un
 * sort enchanté. Arène de test : le Clerc passe niveau 3 (emplacements de niveau 2) et reçoit, prêtés depuis `dnd5e.classes24` et
 * `dnd5e.spells24` (SRD 6.1, pas le Manuel), Guérison suprême (dés au maximum : le montant se lit exactement) et Soins. Le Guerrier,
 * à côté, reçoit 60 PV max de plus et tombe à 1 PV avant chaque soin. Vérifie que le soin rendu vaut :
 *  - Disciple de la vie du SRD 6.1, Soins enchanté par son activité : niveau 1 → 16 + Sagesse + 3, niveau 2 → 32 + Sagesse + 4 (le bonus
 *    une seule fois) ; le sort porte l'enchantement ;
 *  - Disciple de la vie du SRD 6.1, Soins non enchanté : 16 + Sagesse + 3 (le moteur ajoute le bonus) ;
 *  - ancienne forme (le même item sans son activité ni son effet d'enchantement, comme une fiche faite avant dnd5e 6.1) : 16 + Sagesse + 3.
 * Remet niveau, PV ; retire les items prêtés.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e";
const DISCIPLE = `${SRD}.classes24.Item.phbclcDiscipleOf`;
const PROFILE = "SJswY9WWGfmNXW2E";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "srd61-clerc — Disciple de la vie du SRD 6.1 : sort enchanté, non enchanté, ancienne forme (bonus compté une fois)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [cleric, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(cleric.id).pos;
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);

    const actor = await ctx.call("get-actor", { actorId: cleric.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "cleric"));
    if ( !ctx.expect(!!cls, "le Clerc a sa classe de clerc") ) return;
    await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData: { "system.levels": 3 }, match: { path: "_id", value: cls._id } });
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData: { "system.levels": cls.system.levels }, match: { path: "_id", value: cls._id } }).catch(() => {}));
    // Les emplacements dépensés remis à plein à la fin.
    ctx.restore(() => ctx.call("update-actor", { actorId: cleric.actorId, actorData: { "system.spells.spell1.value": 9, "system.spells.spell2.value": 9 } }).catch(() => {}));

    const lend = async (uuid, edit=null) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      if ( edit ) edit(itemData);
      const r = await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: id }).catch(() => {});
    await lend(`${SRD}.classes24.Item.phbclcSupremeHea`);

    await ctx.call("move-token", { tokenId: fighter.id, x: g.x + grid, y: g.y, elevation: 0 });
    await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "60" } });
    ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "" } }).catch(() => {}));
    await pause(800);
    const wis = (await ctx.engine("stats", { tokenId: cleric.id }))?.mods?.wis ?? 0;
    const fmax = (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max;

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Soins sur le Guerrier à 1 PV, à ce niveau d'emplacement ; rend les PV gagnés et la formule du jet. */
    const heal = async (cure, level) => {
      await ctx.call("update-actor", { actorId: cleric.actorId, actorData: { [`system.spells.spell${level}.value`]: 2 } });
      await ctx.setHp(fighter, 1);
      await pause(500);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: cleric.id, itemId: cure, activityType: "heal", targetTokenIds: [fighter.id],
        usageConfig: { spell: { slot: `spell${level}` }, [MODULE_ID]: { confirmed: true } } });
      await pause(1500);
      await ctx.engine("rollCard", { messageId: u.usageMessageId });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const roll = (await ctx.messagesSince(since)).find(m => m.rolls?.length && (m.type !== "usage"));
      const formula = (roll?.rolls ?? []).map(x => `${x.formula} = ${x.total}`).join(" + ");
      return { gained: (await ctx.hp(fighter)) - 1, formula };
    };
    const expected = (dice, bonus) => Math.min(fmax - 1, dice + wis + bonus);

    await part("Disciple de la vie (SRD 6.1), Soins enchanté", async () => {
      const disciple = await lend(DISCIPLE);
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      // En jeu, le joueur dépose le sort sur la carte de l'activité (dnd5e : EnchantActivity#applyEnchantment) ; `enchant` fait le même appel.
      await ctx.engine("enchant", { tokenId: cleric.id, itemId: disciple, activityId: "7BzRpy5Nw0guVN1y", targetItemId: cure, profile: PROFILE });
      await pause(1500);
      const item = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).find(i => i._id === cure);
      const ench = (item?.effects ?? []).find(e => e.type === "enchantment");
      if ( !ctx.expect(!!ench, `Soins porte l'enchantement de Disciple de la vie (${item?.name} ; ${(item?.effects ?? []).map(e => e.name).join(", ") || "aucun effet"})`) ) return;
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `niveau 1 : +${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3) — ${one.formula}`);
      const two = await heal(cure, 2);
      ctx.expect(two.gained === expected(32, 4), `niveau 2 : +${two.gained} PV (attendu ${expected(32, 4)} = 32 + ${wis} + 4) — ${two.formula}`);
      await unlend(cure); await unlend(disciple);
    });

    await part("Disciple de la vie (SRD 6.1), Soins non enchanté", async () => {
      const disciple = await lend(DISCIPLE);
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `+${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3, bonus du moteur) — ${one.formula}`);
      await unlend(cure); await unlend(disciple);
    });

    await part("Disciple de la vie, ancienne forme", async () => {
      const disciple = await lend(DISCIPLE, d => { d.system.activities = {}; d.effects = []; });
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `+${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3) — ${one.formula}`);
      await unlend(cure); await unlend(disciple);
    });
  }
};
