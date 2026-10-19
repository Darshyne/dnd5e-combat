/**
 * §212 : En feu et propagation des flammes — Arène, Guerrier, Magicien, Zombi (300 PV le temps du test).
 *  1. Brûlures : le Zombi en feu (état de dnd5e) subit 1d4 de feu au début de son tour.
 *  2. Éteindre : le Guerrier en feu éteint ses flammes (action) — plus en feu, À terre, l'action dépensée.
 *  3. Propagation (règles) : le Guerrier en feu entre dans une flaque d'huile — elle s'embrase.
 *  4. Propagation maison (`fireSpread`) : le Zombi entre dans une flaque en feu, s'y brûle, et prend feu ; sans le réglage, non.
 * Remet positions, PV, états, réglage, zones.
 */
const MODULE_ID = "dnd5e-combat";
const EQUIPMENT = "Compendium.dnd-players-handbook.equipment.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "en feu — brûlures, éteindre, propagation",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Magicien", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const [hero, mage, zombie] = await Promise.all(need.map(n => ctx.token(n)));
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [hero, mage, zombie] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(hero.id).pos;
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });

    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const max0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: zombie.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const spread0 = await ctx.engine("setting", { key: "fireSpread" });
    ctx.restore(() => ctx.engine("setting", { key: "fireSpread", value: spread0.before ?? spread0.value ?? false }).catch(() => {}));

    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));
    const burn = (t, on) => ctx.call("set-status", { tokenId: t.id, statusId: "burning", active: on });
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const st of ["burning", "prone", "dead", "unconscious"] ) {
          await ctx.removeStatusEffects(t, st);
          await ctx.call("set-status", { tokenId: id, statusId: st, active: false }).catch(() => {});
        }
        if ( id !== zombie.id ) await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      await tough();
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async order => {
      await ctx.startCombat(order.map(([t]) => t));
      const combat = await state();
      for ( const [t, v] of order ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 4) && ((await current()) !== order[0][0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === order[0][0].id;
    };
    const flammable = () => ctx.engine("flammable", { tokenId: mage.id });
    const zoneState = async id => (await flammable()).zones.find(z => z.id === id) ?? null;
    /** Une flaque d'huile sur cette case (le Magicien la verse ; la flasque redonnée à chaque fois). */
    const puddle = async spot => {
      await ctx.call("move-token", { tokenId: mage.id, x: spot.x - grid, y: spot.y }); await pause(600);
      const id = await ctx.ensureItem(mage, EQUIPMENT + "phbagOil00000000");
      const used = await ctx.use({ tokenId: mage.id, itemId: id, activityType: "damage", consume: false,
        area: { shape: "rectangle", x: spot.x, y: spot.y, width: grid, height: grid } });
      if ( used.regionId ) regions.push(used.regionId);
      await pause(1800);
      return used.regionId ?? null;
    };
    const cellOf = pos => ({ i: Math.round(pos.y / grid), j: Math.round(pos.x / grid) });
    /** Une case libre à `dy` cases sous le Guerrier, avec deux cases libres à l'est (pour s'élancer) et une à l'ouest (le Magicien). */
    const occupied = async () => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token
      .filter(t => ![hero.id, mage.id, zombie.id].includes(t.id)).map(t => `${Math.round(t.x / grid)},${Math.round(t.y / grid)}`);
    const freeSpot = async (dy, skip=[]) => {
      const taken = new Set(await occupied());
      for ( let dx = 3; dx < 12; dx++ ) {
        const x = g.x + dx * grid, y = g.y + dy * grid;
        const cells = [-1, 0, 1, 2].map(k => `${Math.round(x / grid) + k},${Math.round(y / grid)}`);
        if ( cells.some(c => taken.has(c)) || skip.includes(`${x},${y}`) ) continue;
        return { x, y };
      }
      throw new Error("pas de case libre");
    };

    await part("Brûlures", async () => {
      await ctx.call("move-token", { tokenId: zombie.id, x: g.x + 3 * grid, y: g.y, elevation: 0 }); await pause(600);
      await burn(zombie, true);
      if ( !ctx.expect(await fight([[hero, 20], [zombie, 10]]), "combat : au tour du Guerrier") ) return;
      const before = await ctx.hp(zombie);
      await ctx.nextTurn(); await pause(4000);
      const after = await ctx.hp(zombie);
      ctx.expect((before - after >= 1) && (before - after <= 4), `au début de son tour, le Zombi en feu perd 1d4 PV (${before} → ${after})`);
      ctx.expect((await statuses(zombie)).has("burning"), "il reste en feu");
    });

    await part("Éteindre", async () => {
      if ( !ctx.expect(await fight([[hero, 20], [zombie, 10]]), "combat : au tour du Guerrier") ) return;
      await burn(hero, true); await pause(500);
      const r = await ctx.engine("burning", { tokenId: hero.id, extinguish: true });
      await pause(800);
      const s = await statuses(hero);
      ctx.expect(r.burning && r.extinguished && !s.has("burning"), `flammes éteintes (${[...s].join(", ")})`);
      ctx.expect(s.has("prone"), "À terre");
      const b = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect(b.action === 0, `l'action est dépensée (${b.action})`);
    });

    await part("Propagation", async () => {
      const spot = await freeSpot(2);
      const id = await puddle(spot);
      if ( !ctx.expect(!!id, "flaque d'huile posée") ) return;
      await burn(hero, true); await pause(500);
      // Hors combat, une flaque en feu s'éteint au bout de 12 s : on la regarde pendant la marche.
      const walking = ctx.engine("move", { tokenId: hero.id, cell: cellOf(spot) });
      let lit = false;
      for ( let n = 0; (n < 40) && !lit; n++ ) { lit = !!(await zoneState(id))?.burning; if ( !lit ) await pause(500); }
      await walking.catch(() => null);
      ctx.expect(lit, `le Guerrier en feu entre dans la flaque : elle s'embrase (${lit ? "en feu" : "froide"})`);
    });

    await part("Propagation maison", async () => {
      for ( const spread of [false, true] ) {
        await ctx.engine("setting", { key: "fireSpread", value: spread });
        const spot = await freeSpot(spread ? 4 : 2);
        const id = await puddle(spot);
        if ( !ctx.expect(!!id, "flaque d'huile posée") ) return;
        await ctx.engine("flammable", { tokenId: mage.id, ignite: true, regionId: id });
        await pause(1500);
        await ctx.call("move-token", { tokenId: zombie.id, x: spot.x + 2 * grid, y: spot.y, elevation: 0 }); await pause(600);
        const before = await ctx.hp(zombie);
        await ctx.engine("move", { tokenId: zombie.id, cell: cellOf(spot) });
        await pause(3500);
        const burnt = before - (await ctx.hp(zombie));
        const on = (await statuses(zombie)).has("burning");
        ctx.expect(burnt > 0, `${spread ? "avec" : "sans"} le réglage : le Zombi se brûle dans la flaque (${burnt} PV)`);
        ctx.expect(on === spread, `${spread ? "avec le réglage, il prend feu" : "sans le réglage, il ne prend pas feu"} (${on ? "en feu" : "pas en feu"})`);
        await ctx.call("set-status", { tokenId: zombie.id, statusId: "burning", active: false }).catch(() => {});
      }
    });
  }
};
