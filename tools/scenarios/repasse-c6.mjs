/**
 * §301, lot C6 de la repasse terme par terme : réactions jamais proposées. Arène des sorts (Lanceur, Allié, Ennemi au contact).
 * Chaque partie prête ses items depuis le Manuel des joueurs (avec leur source) et remet tout.
 *  - Interception : l'Ennemi au contact touche le Lanceur ; l'Allié à côté, armé, réduit les dégâts (réaction prise d'office) ;
 *  - Représailles : l'Ennemi blesse l'Allié ; la réaction attaque l'Ennemi avec l'arme de l'Allié ;
 *  - Chute ralentie : l'Allié (Moine 4) tombe de 30 ft — la fenêtre s'ouvre avant les dégâts, ils sont réduits de 20 ;
 *  - Feuille morte : l'Allié tombe ; le Lanceur, qui connaît le sort, réagit — pas de dégâts de chute.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c6 — réactions : Interception, Représailles, Chute ralentie, Feuille morte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally, enemy] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, ally, enemy];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await unlend();
      for ( const t of all ) {
        for ( const s of ["prone", "falling"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
        await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { movementAction: "walk" } }).catch(() => {});
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const auto = { [MODULE_ID]: { autoReact: "first" } };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** Répond à la première fenêtre nouvelle dont un bouton correspond (la réaction proposée au MJ, qui joue les PNJ). */
    const answer = async (ids, re, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return (d.buttons ?? []).map(x => x.label); }
        }
      }
      return null;
    };
    /** L'Ennemi frappe sa cible avec son gourdin jusqu'à toucher (20 essais au plus) ; rend la résolution du coup. */
    const strike = async (target, club) => {
      for ( let n = 0; n < 20; n++ ) {
        await ctx.setHp(target, 999);
        const u = await ctx.use({ tokenId: enemy.id, itemId: club, activityType: "attack", targetTokenIds: [target.id], usageConfig: auto });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        const t = r?.targets?.find(x => x.name === target.name);
        if ( t?.hit ) return { r, t, usage: u.usageMessageId };
        await pause(800);
      }
      return null;
    };
    /** L'Allié, en l'air à 30 ft et « En chute », fait un pas : il tombe (2d6… 3d6 de dnd5e). */
    const drop = async () => {
      const p = await ctx.position(ally);
      await ctx.call("move-token", { tokenId: ally.id, x: p.x + ARENE_SORTS.grid * 3, y: p.y, elevation: 30 });
      await pause(1200);
      await ctx.call("set-status", { tokenId: ally.id, statusId: "falling", active: true });
      await pause(800);
      await ctx.engine("move", { tokenId: ally.id, cell: { i: ARENE_SORTS.tokens["Allié"][0] + 4, j: ARENE_SORTS.tokens["Allié"][1] } }).catch(() => null);
    };
    const landed = async () => {
      for ( let n = 0; n < 30; n++ ) { if ( ((await ctx.position(ally)).elevation ?? 0) === 0 ) return true; await pause(500); }
      return false;
    };

    await part("Interception", async () => {
      await lend(ally, `${PHB}.feats.Item.phbfstIntercepti`);
      await lend(ally, `${PHB}.equipment.Item.phbwepLongsword0`, { "system.equipped": true, "system.proficient": 1 });
      const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await pause(1200);
      const since = await ctx.lastMessageId();
      const hit = await strike(caster, club);
      if ( !ctx.expect(!!hit, "l'Ennemi touche le Lanceur (20 essais au plus)") ) return;
      const reaction = (hit.r?.events ?? hit.r?.log ?? []).find?.(e => e.type === "reactionResolved") ?? null;
      const applied = hit.t.damage?.applied ?? null;
      ctx.log(`coup : ${JSON.stringify({ damage: hit.t.damage, reaction: hit.t.reaction ?? reaction ?? null })}`);
      ctx.expect(/Intercept/i.test(JSON.stringify(hit.r ?? {})), "l'Allié intercepte (réaction prise d'office)");
      ctx.expect((applied !== null) && (applied < 13), `dégâts réduits avant l'application (${applied} appliqués ; un gourdin fait 13 au plus)`);
    });

    await part("Représailles", async () => {
      await lend(ally, `${PHB}.classes.Item.phbbrbRetaliatio`);
      await lend(ally, `${PHB}.equipment.Item.phbwepLongsword0`, { "system.equipped": true, "system.proficient": 1 });
      const club = await lend(enemy, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      // L'Ennemi au contact de l'Allié (« une créature à 1,50 m »), de l'autre côté que le Lanceur.
      const a = await ctx.position(ally);
      await ctx.call("move-token", { tokenId: enemy.id, x: a.x, y: a.y + ARENE_SORTS.grid, elevation: 0 });
      await pause(1200);
      const since = await ctx.lastMessageId();
      const hit = await strike(ally, club);
      if ( !ctx.expect(!!hit, "l'Ennemi touche l'Allié (20 essais au plus)") ) return;
      // La riposte peut rater : on lit l'utilisation en réaction de l'Allié, touché ou non.
      let back = false;
      for ( let i = 0; (i < 15) && !back; i++ ) {
        await pause(1000);
        back = (await ctx.messagesSince(since)).some(m => (m.tokenId === ally.id) && (m.type === "usage") && m.flags?.["dnd5e-combat"]?.reaction);
      }
      ctx.expect(!!back, "blessé, l'Allié riposte avec son épée longue");
    });

    await part("Chute ralentie", async () => {
      await lend(ally, `${PHB}.classes.Item.phbmnkMonk000000`, { "system.levels": 4 });
      await lend(ally, `${PHB}.classes.Item.phbmnkSlowFall00`);
      await pause(1200);
      const ids = await known();
      await drop();
      const labels = await answer(ids, /Slow Fall|Chute ralentie|Reduce|Réduire/i);
      ctx.expect(!!labels, `avant les dégâts, la Chute ralentie est proposée (${labels?.join(", ") ?? "aucune fenêtre"})`);
      ctx.expect(await landed(), "l'Allié est au sol");
      await pause(4000);
      const hp = await ctx.hp(ally);
      ctx.expect(hp === 999, `dégâts de chute réduits de 20 — ici à 0 (999 → ${hp})`);
    });

    await part("Feuille morte", async () => {
      await lend(caster, `${PHB}.spells.Item.phbsplFeatherFal`, { "system.method": "atwill" });
      await pause(1200);
      const ids = await known();
      await drop();
      const labels = await answer(ids, /Feather Fall|Feuille morte/i);
      ctx.expect(!!labels, `le Lanceur se voit proposer Feuille morte (${labels?.join(", ") ?? "aucune fenêtre"})`);
      ctx.expect(await landed(), "l'Allié est au sol");
      await pause(4000);
      ctx.expect(await ctx.hp(ally) === 999, `pas de dégâts de chute (${await ctx.hp(ally)})`);
    });
  }
};
