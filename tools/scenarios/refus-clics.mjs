/**
 * §411 (issue #44, lot 4) : les refus des clics — clic d'attaque, menu contextuel, pose d'une zone de sort, téléportation — ouvrent la
 * fenêtre de légalité au lieu d'un refus sec ; forcé, le geste part, le MJ est prévenu. « Arène des refus » (`node tools/arene-refus.mjs`).
 *  1. Clic d'attaque (le chemin d'`engage`, comme la souris) : Trait de feu du Mage sur la Cible lointaine (155 ft) — fenêtre « hors de
 *     portée » ; renoncé, rien ; forcé, la carte part, marquée, une alerte MJ, le Mage n'a pas bougé.
 *  2. Menu contextuel : l'entrée « Lancer » de la javeline du Guerrier sur la Cible lointaine est grisée, avec sa raison (`refused`).
 *  3. Boule de feu posée hors de portée (`dnd5e.createMeasuredTemplate`, comme la pose de dnd5e) : fenêtre « hors de portée » ; forcée,
 *     la zone est créée là où elle a été posée, marquée `forcedPlacement`, une alerte MJ.
 *  4. Foulée brumeuse vers la case du Mannequin (occupée) : fenêtre « espace inoccupé » ; forcée, le Mage y est téléporté.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "refus des clics — attaque, menu, zone hors de portée, téléportation",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const fighter = await ctx.token("Guerrier des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const far = await ctx.token("Cible lointaine des refus");
    // Trait de feu (120 ft), pas le Rayon de givre de `regle-forcee` : forcer la portée la tient pour acquise 60 s, par activité et cibles
    // (`acknowledge`, runtime/turn.mjs) — le scénario suivant ne verrait plus sa fenêtre.
    const ray = await ctx.ensureItem(mage, `${PHB}phbsplFireBolt00`);
    const fireball = await ctx.ensureItem(mage, `${PHB}phbsplFireball00`);
    const misty = await ctx.ensureItem(mage, `${PHB}phbsplMistyStep0`);
    const script = async code => (await ctx.call("run-script", { code }))?.result;
    const where = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data;
    const home = await where(mage);
    ctx.restore(async () => {
      await script(`await canvas.scene.tokens.get("${mage.id}").move([{ x: ${home.x}, y: ${home.y}, action: "blink" }], { "${MODULE_ID}": { cleared: true } }); return true;`).catch(() => {});
    });

    const legality = async (name, ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      for ( const n of [mage.name, fighter.name] ) {
        const d = await legality(n, 300);
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      }
    });
    const textOf = d => [d?.title, d?.content, d?.text].filter(Boolean).join(" ");
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const marked = messages => messages.filter(m => m.flags?.[MODULE_ID]?.overridden?.length);

    // 1. Clic d'attaque hors de portée : `engage`, le chemin du clic gauche et du menu.
    const engage = () => script(`const { engage } = await import("/modules/${MODULE_ID}/scripts/runtime/actions.mjs");
      const token = canvas.scene.tokens.get("${mage.id}"); const target = canvas.scene.tokens.get("${far.id}");
      const activity = token.actor.items.get("${ray}").system.activities.find(a => a.type === "attack");
      engage(token, target, activity, { fast: true }); return true;`);
    let since = await ctx.lastMessageId();
    await engage();
    let d = await legality(mage.name);
    ctx.expect(!!d && /range|portée/i.test(textOf(d)), `clic d'attaque hors de portée : la fenêtre le dit (${textOf(d).slice(0, 160)})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
    await pause(1500);
    let after = await ctx.messagesSince(since);
    ctx.expect(!after.length, `renoncé : rien (${after.length} message(s))`);

    since = await ctx.lastMessageId();
    await engage();
    d = await legality(mage.name);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    await pause(3500);
    after = await ctx.messagesSince(since);
    ctx.expect(marked(after).some(m => m.type === "usage"), `forcé : la carte part, marquée (${after.map(m => m.type).join(", ")})`);
    ctx.expect(alerts(after).length === 1, `forcé : une alerte MJ (${alerts(after).length})`);
    const moved = await where(mage);
    ctx.expect((moved.x === home.x) && (moved.y === home.y), `forcé : le Mage attaque d'où il est (${moved.x},${moved.y})`);

    // 2. Menu contextuel : l'attaque refusée reste, grisée, avec sa raison. La javeline du Guerrier, équipée le temps de l'essai (son
    //    lancer, à 120 ft au plus, ne se juge pas en cherchant un chemin).
    const javelin = await ctx.itemId(fighter.id, "javelin");
    const fighterActor = (await ctx.call("get-scene-object", { type: "Token", objectId: fighter.id })).data.actorId;
    const equip = on => ctx.call("upsert-actor-item", { actorId: fighterActor, itemData: { "system.equipped": on }, match: { path: "_id", value: javelin } });
    await equip(true);
    ctx.restore(() => equip(false).catch(() => {}));
    const menu = await ctx.engine("menu", { tokenId: fighter.id, targetId: far.id });
    const refused = Object.entries(menu?.refused ?? {});
    ctx.expect(refused.some(([label, why]) => /javelin|javeline/i.test(label) && /range|portée/i.test(why)),
      `menu : la javeline lancée sur la Cible lointaine est grisée (${JSON.stringify(menu?.refused ?? {}).slice(0, 200)})`);

    // 3. Boule de feu posée sur la Cible lointaine (155 ft, portée 150 ft) — la pose de dnd5e passe par `dnd5e.createMeasuredTemplate`.
    const target = await where(far);
    const place = () => script(`const token = canvas.scene.tokens.get("${mage.id}");
      const activity = token.actor.items.get("${fireball}").system.activities.find(a => a.target?.template?.type);
      const g = canvas.scene.grid.size;
      const data = [{ name: "Boule de feu", shapes: [{ type: "circle", x: ${target.x} + g / 2, y: ${target.y} + g / 2, radius: 4 * g }],
        flags: { dnd5e: { activity: activity.uuid, item: activity.item.uuid, origin: token.uuid } } }];
      return Hooks.call("dnd5e.createMeasuredTemplate", activity, data);`);
    const zones = () => script(`return canvas.scene.regions.filter(r => r.flags?.["${MODULE_ID}"]?.forcedPlacement).map(r => r.id);`);
    ctx.restore(async () => {
      const ids = await zones().catch(() => []);
      if ( ids?.length ) await script(`await canvas.scene.deleteEmbeddedDocuments("Region", ${JSON.stringify(ids)}); return true;`).catch(() => {});
      await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 300 }).catch(() => {});
    });
    since = await ctx.lastMessageId();
    const allowed = await place();
    ctx.expect(allowed === false, `zone hors de portée : la création est d'abord retenue (${allowed})`);
    d = await legality(mage.name);
    ctx.expect(!!d && /range|portée/i.test(textOf(d)), `zone hors de portée : la fenêtre le dit (${textOf(d).slice(0, 160)})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    await pause(2500);
    const created = await zones();
    ctx.expect(created?.length === 1, `forcée : la zone est créée, marquée (${created?.length})`);
    after = await ctx.messagesSince(since);
    ctx.expect(alerts(after).length === 1, `forcée : une alerte MJ (${alerts(after).length})`);
    // Une pose rouverte par « Renoncer » attend la souris : elle n'est pas essayée ici (le geste ouvre la pose de dnd5e).

    // 4. Foulée brumeuse vers une case occupée (celle du Mannequin).
    const spot = await where(dummy);
    since = await ctx.lastMessageId();
    // La visée qu'ouvre l'utilisation (`teleportSelf`, ui/pointer-offers.mjs) ; le connecteur, lui, n'enchaîne pas les actions qui suivent.
    await script(`const { teleportSelf } = await import("/modules/${MODULE_ID}/scripts/runtime/teleport.mjs");
      const activity = canvas.scene.tokens.get("${mage.id}").actor.items.get("${misty}").system.activities.contents[0];
      teleportSelf(activity).catch(err => console.error(err)); return true;`);
    await pause(1500);
    await ctx.engine("teleportPick", { x: spot.x + 70, y: spot.y + 70 });
    d = await legality(mage.name);
    ctx.expect(!!d && /unoccupied|inoccupé/i.test(textOf(d)), `téléportation sur une case prise : la fenêtre le dit (${textOf(d).slice(0, 160)})`);
    if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "go" });
    await pause(2500);
    const landed = await where(mage);
    ctx.expect((landed.x === spot.x) && (landed.y === spot.y), `forcée : le Mage y est téléporté (${landed.x},${landed.y} / ${spot.x},${spot.y})`);
    after = await ctx.messagesSince(since);
    ctx.expect(alerts(after).length === 1, `forcée : une alerte MJ (${alerts(after).length})`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
