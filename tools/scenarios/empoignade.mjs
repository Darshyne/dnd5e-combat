/**
 * L'empoignade en jeu (SPEC §15.2, règles 2024) :
 *  1. le Magicien agrippe le Zombi (Lutte, rejouée jusqu'à un échec du Zombi) ;
 *  2. le Zombi agrippé attaque l'Ensorceleur : désavantage « attaquant Agrippé » ; attaque le Magicien,
 *     son agrippeur : pas ce désavantage ;
 *  3. le Magicien s'éloigne de trois cases : l'empoignade cesse d'elle-même (hors de portée) ;
 *  4. le Paladin agrippe le Magicien, qui tente S'échapper jusqu'à réussir : l'état Agrippé tombe.
 * Remet tokens, états, PV et items en place.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "empoignade — désavantage, rupture à distance, s'échapper",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const sorc = await ctx.token("Ensorceleur");
    const paladin = await ctx.token("Paladin");
    const size = await ctx.gridSize();

    const hpBefore = new Map();
    for ( const t of [zombi, sorc, mage] ) {
      const hp = await ctx.hp(t);
      hpBefore.set(t.id, hp);
      ctx.restore(() => ctx.setHp(t, hp));
    }
    const move = async (token, x, y) => {
      const r = await ctx.call("move-token", { tokenId: token.id, x, y });
      if ( !r?.moved && ((r?.after?.x !== x) || (r?.after?.y !== y)) ) throw new Error(`${token.name} non déplacé en ${x},${y}`);
    };
    for ( const t of [mage, paladin, zombi] ) ctx.restore(() => move(t, t.x, t.y));
    for ( const t of [zombi, mage] ) ctx.restore(() => ctx.removeStatusEffects(t, "grappled"));

    /** Les états d'un token (effets du token, ou de l'acteur lié). */
    const statusesOf = async token => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      const own = [...(data.delta?.effects ?? [])].flatMap(e => e.statuses ?? []);
      const actor = data.actorLink ? await ctx.call("get-actor", { actorId: data.actorId }) : null;
      return [...own, ...(actor?.effects ?? []).filter(e => !e.disabled).flatMap(e => e.statuses ?? [])];
    };
    const itemsOf = async token => (await ctx.call("get-actor", { actorId: token.actorId })).items ?? [];
    const engineItem = async (token, kind) => (await itemsOf(token)).find(i => i.flags?.[MODULE_ID]?.basicAction === kind);

    await move(mage, zombi.x + size, zombi.y);
    await ctx.startCombat([mage, zombi, paladin]);
    let unarmed = null;
    for ( const until = Date.now() + 6000; !unarmed && (Date.now() < until); await sleep(400) ) unarmed = await engineItem(mage, "unarmed");
    if ( !unarmed ) return ctx.expect(false, "attaque à mains nues posée sur le Magicien");

    /** Lutte de `who` sur `target`, rejouée jusqu'à un échec. true si la cible est agrippée. */
    // Jusqu'à 20 essais : une cible dans l'Aura de protection du Paladin rate rarement sa sauvegarde.
    async function grapple(who, target) {
      const item = await engineItem(who, "unarmed");
      const totals = [];
      for ( let i = 0; i < 20; i++ ) {
        const used = await ctx.use({ tokenId: who.id, itemId: item._id, activityType: "save", targetTokenIds: [target.id],
          usageConfig: { [MODULE_ID]: { confirmed: true, saveChoice: "best", choice: "dnd5eCombatGrapl" } } });
        const r = await ctx.settle(used.usageMessageId);
        totals.push(r?.targets?.[0]?.save?.total);
        if ( r?.targets?.[0]?.save?.success === false ) {
          ctx.log(`${who.name} → ${target.name} : DD ${r.plan.save.dc}, sauvegardes ${totals.join(", ")}`);
          await sleep(800);
          return (await statusesOf(target)).includes("grappled");
        }
      }
      ctx.log(`${who.name} → ${target.name} : 20 sauvegardes réussies (${totals.join(", ")})`);
      return false;
    }

    // 1. Le Magicien agrippe le Zombi.
    const held = await grapple(mage, zombi);
    ctx.expect(held, "le Magicien agrippe le Zombi");
    if ( !held ) return;

    // 2. Désavantage du Zombi agrippé contre une autre cible que son agrippeur.
    const zombiWeapon = (await itemsOf(zombi)).find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    async function reasonsAgainst(target) {
      const used = await ctx.use({ tokenId: zombi.id, itemId: zombiWeapon._id, activityType: "attack", targetTokenIds: [target.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      const attack = (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "attack");
      const mods = attack?.flags?.[MODULE_ID]?.modifiers ?? attack?.flags?.modifiers ?? null;
      return (mods?.disadvantage ?? []).map(r => `${r.who}.${r.key}`);
    }
    const vsSorc = await reasonsAgainst(sorc);
    ctx.expect(vsSorc.includes("attacker.grappled"), `Zombi agrippé contre l'Ensorceleur : désavantage (${vsSorc.join(", ") || "aucun"})`);
    const vsMage = await reasonsAgainst(mage);
    ctx.expect(!vsMage.includes("attacker.grappled"), `Zombi agrippé contre le Magicien, son agrippeur : pas ce désavantage (${vsMage.join(", ") || "aucun"})`);
    // Les coups du Zombi peuvent mettre le Magicien (7 PV) à terre, inconscient : on le remet sur pied avant qu'il marche.
    const mageHp = hpBefore.get(mage.id);
    await ctx.setHp(mage, mageHp);
    for ( const status of ["unconscious", "prone"] ) await ctx.removeStatusEffects(mage, status);
    await sleep(500);

    // 2 bis. La marque de l'agrippeur, et le Zombi traîné quand le Magicien MARCHE.
    const marksOf = async token => ((await ctx.call("get-actor", { actorId: token.actorId })).effects ?? []).filter(e => e.flags?.[MODULE_ID]?.grappling);
    let marks = [];
    for ( const until = Date.now() + 4000; !marks.length && (Date.now() < until); await sleep(300) ) marks = await marksOf(mage);
    ctx.expect(marks.length === 1, `marque sur l'agrippeur : « ${marks[0]?.name ?? "absente"} »`);
    const posOf = async token => (await ctx.call("get-scene-object", { type: "Token", objectId: token.id })).data;
    const before = await posOf(zombi);
    const mageAt = await posOf(mage);
    // Un déplacement ordinaire (marche), pas une téléportation : `move-token` avec l'action « walk ». Une mise à jour
    // de x (`update-scene-object`) fait échouer le cœur V14 sur Restored Keep (« setting 'last' », segment parcouru vide
    // dans `createTerrainMovementPath`, canvas/placeables/token.mjs:3831 — vu le 2026-09-25).
    // Vers le sud : à l'est, le Bandit peut occuper la deuxième case (vu le 2026-09-25).
    await ctx.call("move-token", { tokenId: mage.id, x: mageAt.x, y: mageAt.y + (2 * size), action: "walk" });
    let after = before;
    for ( const until = Date.now() + 5000; (after.x === before.x) && (after.y === before.y) && (Date.now() < until); await sleep(300) ) after = await posOf(zombi);
    const mageNow = await posOf(mage);
    ctx.expect(mageNow.y === mageAt.y + (2 * size), `le Magicien marche de deux cases (${mageAt.y} → ${mageNow.y})`);
    // À sa place relative si elle est libre, sinon sur une case libre au contact (SPEC §15.2, `dragDestination`) :
    // la scène peut avoir une créature sur le chemin — on exige seulement qu'il ait bougé et soit au contact.
    const gap = Math.max(Math.abs(after.x - mageNow.x), Math.abs(after.y - mageNow.y)) / size;
    ctx.expect(((after.x !== before.x) || (after.y !== before.y)) && (gap === 1),
      `le Zombi agrippé suit, au contact du Magicien (${before.x},${before.y} → ${after.x},${after.y})`);
    await sleep(800);
    ctx.expect((await statusesOf(zombi)).includes("grappled"), "toujours agrippé après avoir été traîné");

    // 3. Le Magicien se téléporte à 20 ft : pas de traînée, l'empoignade cesse, la marque tombe.
    await move(mage, after.x + (4 * size), after.y);
    let still = true;
    for ( const until = Date.now() + 5000; still && (Date.now() < until); await sleep(400) ) still = (await statusesOf(zombi)).includes("grappled");
    ctx.expect(!still, "le Magicien téléporté à 20 ft : le Zombi n'est plus agrippé (hors de portée)");
    for ( const until = Date.now() + 3000; marks.length && (Date.now() < until); await sleep(300) ) marks = await marksOf(mage);
    ctx.expect(!marks.length, "la marque de l'agrippeur est retirée avec l'empoignade");
    await move(zombi, zombi.x, zombi.y);

    // 4. Le Paladin agrippe le Magicien, qui s'échappe.
    const magePos = await posOf(mage);
    await move(paladin, magePos.x + size, magePos.y);   // au contact du Magicien, à l'est
    const caught = await grapple(paladin, mage);
    ctx.expect(caught, "le Paladin agrippe le Magicien");
    if ( !caught ) return;
    const escape = await engineItem(mage, "escape");
    ctx.expect(!!escape, `S'échapper posé sur le Magicien (${escape?.name ?? "absent"})`);
    if ( !escape ) return;
    let free = false;
    let tries = 0;
    // Chaque essai : on attend le test (message « check ») avant de juger — les dés 3D d'une fenêtre visible
    // prennent 2 à 3 s, et un essai relancé trop tôt se superposait au précédent.
    for ( ; (tries < 12) && !free; tries++ ) {
      const used = await ctx.use({ tokenId: mage.id, itemId: escape._id, activityType: "utility" });
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(300) ) {
        if ( (await ctx.messagesSince(used.usageMessageId)).some(m => m.type === "check") ) break;
      }
      await sleep(500);
      free = !(await statusesOf(mage)).includes("grappled");
    }
    ctx.expect(free, `le Magicien s'échappe (${tries} essai(s))`);
  }
};
