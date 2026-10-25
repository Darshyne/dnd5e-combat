/**
 * Serrures des portes (SPEC §244, issue #22) : une porte verrouillée posée pour le scénario dans l'Arène de test, à quatre cases du
 * Guerrier, avec un DD de crochetage 15, un DD de forçage 20 et une clé « Clé d'essai DAS ».
 *  1. Sans la clé, le menu propose Crocheter et Forcer ; réglage « un essai » : un crochetage raté (10) est noté, l'entrée le dit, un
 *     second essai est refusé ; les essais remis à zéro, un crochetage à 18 déverrouille (fermée), hook `doorUnlocked` « pick ».
 *  2. Reverrouillée : forcer à 25 l'ouvre, hooks `noise` et `doorUnlocked` « force ».
 *  3. Reverrouillée, porte « ne peut pas être forcée » : Forcer disparaît du menu.
 *  4. Le Guerrier reçoit la clé : « Déverrouiller (clé) » au menu, et elle ouvre sans jet.
 *  5. En combat, un vrai crochetage (dés du MJ) coûte l'action.
 *  6. Sans DD, le MJ tranche : la porte reste verrouillée, rien n'est noté.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODULE_ID = "dnd5e-combat";
const LOCKED = 2;
const KEY = "Clé d'essai DAS";

export default {
  name: "porte-serrure — crocheter, forcer, clé, DD caché",

  async run(ctx) {
    const fighter = await ctx.token("Guerrier").catch(() => null);
    const zombi = await ctx.token("Zombi").catch(() => null);
    if ( !fighter ) { ctx.log("Guerrier absent : non applicable"); return; }
    const grid = await ctx.gridSize();
    const home = await ctx.position(fighter);
    const doorX = home.x + (4 * grid);
    const created = await ctx.call("create-walls", { walls: [{ c: [doorX, home.y, doorX, home.y + grid], preset: "door" }] });
    const wallId = created?.walls?.[0]?.id ?? created?.walls?.[0]?._id ?? null;
    if ( !wallId ) throw new Error(`porte non créée (${JSON.stringify(created).slice(0, 200)})`);
    const failure = await ctx.engine("setting", { key: "lockFailure", value: "once" });
    ctx.restore(async () => {
      await ctx.engine("setting", { key: "lockFailure", value: failure.before }).catch(() => {});
      await ctx.call("delete-scene-object", { type: "Wall", objectId: wallId }).catch(() => {});
      const now = await ctx.position(fighter);
      if ( (now.x !== home.x) || (now.y !== home.y) ) await ctx.call("move-token", { tokenId: fighter.id, ...home }).catch(() => {});
    });
    const setLock = (lock, extra={}) => ctx.call("update-scene-object", { type: "Wall", objectId: wallId,
      data: { ds: LOCKED, [`flags.${MODULE_ID}.lock`]: lock, [`flags.${MODULE_ID}.-=lockTries`]: null, ...extra } });
    const lock = { pickDc: 15, forceDc: 20, unforceable: false, key: KEY };
    await setLock(lock);
    await pause(800);
    const methods = r => (r?.entries ?? []).map(e => e.method + (e.spent ? "*" : "")).join(", ");

    // 1. Crocheter.
    const missed = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 10 });
    ctx.expect((missed?.outcome === "failure") && (missed?.state === "locked"), `crochetage à 10 contre 15 : ${missed?.outcome}, ${missed?.state}`);
    ctx.expect(methods(missed) === "pick*, force", `sans la clé, après un échec : ${methods(missed)}`);
    const again = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 30 });
    ctx.expect((again?.outcome === null) && (again?.state === "locked"), `second essai refusé (un essai) : ${again?.outcome}, ${again?.state}`);
    await ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data: { [`flags.${MODULE_ID}.-=lockTries`]: null } });
    await pause(300);
    const picked = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 18 });
    ctx.expect((picked?.outcome === "success") && (picked?.state === "closed"), `crochetage à 18 : ${picked?.outcome}, ${picked?.state}`);
    ctx.expect(picked?.fired?.some(f => (f.hook === "doorUnlocked") && (f.method === "pick") && (f.door === wallId)),
      `hook doorUnlocked : ${JSON.stringify(picked?.fired)}`);

    // 2. Forcer.
    await setLock(lock);
    await pause(300);
    const forced = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "force", total: 25 });
    ctx.expect((forced?.outcome === "success") && (forced?.state === "open"), `forcer à 25 : ${forced?.outcome}, ${forced?.state}`);
    ctx.expect(forced?.fired?.some(f => f.hook === "noise") && forced?.fired?.some(f => (f.hook === "doorUnlocked") && (f.method === "force")),
      `hooks noise + doorUnlocked : ${JSON.stringify(forced?.fired)}`);

    // 3. Ne peut pas être forcée.
    await setLock({ ...lock, unforceable: true });
    await pause(300);
    const solid = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "force", total: 40 });
    ctx.expect((solid?.outcome === "failure") && (solid?.state === "locked") && (methods(solid) === "pick"),
      `porte non forçable : ${solid?.outcome}, ${solid?.state}, menu ${methods(solid)}`);

    // 4. La clé.
    await setLock(lock);
    const keyItem = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { name: KEY, type: "loot" }, match: { path: "name", value: KEY } });
    const keyId = keyItem.itemId ?? keyItem.id ?? keyItem.item?._id;
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: keyId }).catch(() => {}));
    await pause(500);
    const opened = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "key" });
    ctx.expect((opened?.outcome === "success") && (opened?.state === "closed"), `à la clé : ${opened?.outcome}, ${opened?.state}`);
    ctx.expect(opened?.fired?.some(f => (f.hook === "doorUnlocked") && (f.method === "key")), `hook doorUnlocked « key » : ${JSON.stringify(opened?.fired)}`);
    await setLock(lock);
    await pause(300);
    const shown = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 1 });
    ctx.expect(methods(shown).startsWith("key"), `avec la clé, le menu la propose : ${methods(shown)}`);

    // 5. En combat, un vrai crochetage coûte l'action.
    if ( zombi ) {
      await ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data: { [`flags.${MODULE_ID}.-=lockTries`]: null } });
      await ctx.startCombat([fighter, zombi]);
      await pause(800);
      const before = await ctx.engine("budget", { tokenId: fighter.id });
      const real = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick" });
      const after = await ctx.engine("budget", { tokenId: fighter.id });
      ctx.expect(["success", "failure"].includes(real?.outcome), `vrai crochetage, jugé contre le DD : ${real?.outcome}, ${real?.state}`);
      ctx.expect((before?.action > 0) && (after?.action === 0), `l'action est dépensée : ${before?.action} → ${after?.action}`);
    }

    // 6. Sans DD : le MJ tranche.
    await setLock({ pickDc: null, forceDc: null, unforceable: false, key: "" });
    await pause(300);
    const gm = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 30 });
    ctx.expect((gm?.outcome === "gm") && (gm?.state === "locked") && !Object.keys(gm?.tries ?? {}).length,
      `sans DD : ${gm?.outcome}, ${gm?.state}, essais ${JSON.stringify(gm?.tries)}`);
  }
};
