/**
 * Projectiles (SPEC §16.27), sur une seule cible (aucune question de répartition) :
 *  - Projectile magique (Bramo) : les projectiles touchent d'office — chacun est un lancement à part, avec ses dégâts ;
 *  - Rayon ardent et Décharge occulte (Kaalisti) : une attaque par rayon — le premier est le lancement, les autres sont
 *    enchaînés par le moteur (cartes marquées `projectileOf`), sans emplacement ni action.
 * Monde `ravenloft` (Bramo, Kaalisti, Rahadin) ; ailleurs, non applicable.
 */
const MODULE_ID = "dnd5e-combat";
const VICTIM = "Rahadin, chambellan du château";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "projectiles — Projectile magique, Rayon ardent, Décharge occulte",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Bramo", "Kaalisti", VICTIM].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Bramo, Kaalisti ou Rahadin absent : non applicable"); return; }
    const bramo = await ctx.token("Bramo");
    const kaalisti = await ctx.token("Kaalisti");
    const victim = await ctx.token(VICTIM);
    const grid = await ctx.gridSize();
    const at = await ctx.position(bramo);
    await ctx.call("move-token", { tokenId: victim.id, x: at.x + (3 * grid), y: at.y });

    // Rayons : chaque rayon a sa carte et son jet.
    for ( const identifier of ["scorching-ray", "eldritch-blast"] ) {
      await ctx.setHp(victim, 150);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: kaalisti.id, identifier, activityType: "attack", consume: false, targetTokenIds: [victim.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      let announced = null;
      for ( const until = Date.now() + 8000; !announced && (Date.now() < until); await sleep(500) ) {
        announced = (await ctx.engineLog()).map(l => l.match(/: (\d+) projectile\(s\), (\d+) enchaîné/)).filter(Boolean).at(-1);
      }
      const count = announced ? Number(announced[1]) : null;
      ctx.expect(count >= 2, `${identifier} : ${count ?? "?"} projectile(s) annoncé(s)`);
      if ( !count ) continue;
      let chained = [];
      for ( const until = Date.now() + 45000; Date.now() < until; await sleep(1000) ) {
        const messages = await ctx.messagesSince(since);
        chained = messages.filter(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.projectileOf ?? m.flags?.projectileOf));
        const steps = chained.map(m => (m.flags?.[MODULE_ID] ?? m.flags)?.resolution?.step);
        if ( (chained.length >= count - 1) && steps.every(s => ["done", "missed"].includes(s)) ) break;
      }
      ctx.expect(chained.length === count - 1, `${identifier} : ${chained.length} rayon(s) enchaîné(s) après le premier (attendu ${count - 1})`);
      const spent = chained.map(m => (m.flags?.[MODULE_ID] ?? m.flags)?.spent).filter(Boolean);
      ctx.expect(!spent.length, `${identifier} : les rayons enchaînés ne dépensent rien`);
    }

    // Projectile magique : chaque projectile est un lancement à part, avec ses propres dégâts.
    await ctx.setHp(victim, 150);
    const since = await ctx.lastMessageId();
    const mm = await ctx.use({ tokenId: bramo.id, identifier: "magic-missile", activityType: "damage", consume: false, targetTokenIds: [victim.id] });
    const first = await ctx.settle(mm.usageMessageId);
    let darts = [];
    for ( const until = Date.now() + 45000; Date.now() < until; await sleep(1000) ) {
      darts = (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.projectileOf ?? m.flags?.projectileOf));
      const steps = darts.map(m => (m.flags?.[MODULE_ID] ?? m.flags)?.resolution?.step);
      if ( (darts.length >= 2) && steps.every(s => s === "done") ) break;
    }
    ctx.expect(!!first.damageRoll && (first.targets[0]?.damage?.applied > 0), `1er projectile : ses dégâts (${first.targets[0]?.damage?.applied})`);
    ctx.expect(darts.length === 2, `Projectile magique (niveau 1) : 2 projectiles enchaînés après le premier (${darts.length})`);
    const applied = darts.map(m => (m.flags?.[MODULE_ID] ?? m.flags)?.resolution?.targets?.[0]?.damage?.applied);
    ctx.expect(applied.every(v => v > 0), `chacun ses dégâts : ${applied.join(", ")}`);
  }
};
