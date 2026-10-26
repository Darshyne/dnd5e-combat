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
 *  Chaque essai jugé publie `lockAttempt` (§247 : façon, issue, total). 7. Le menu de la porte (`api.ui.doorMenu`) entend un voisin
 *  par `doorMenu` : son entrée vient après celles de la serrure et avant celles du MJ ; le menu d'une case (`api.ui.groundMenu`) met
 *  celle d'un voisin (`groundMenu`, §243) en tête.
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
    const attempt = r => r?.fired?.find(f => f.hook === "lockAttempt") ?? null;

    // 1. Crocheter.
    const missed = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 10 });
    ctx.expect((missed?.outcome === "failure") && (missed?.state === "locked"), `crochetage à 10 contre 15 : ${missed?.outcome}, ${missed?.state}`);
    ctx.expect(methods(missed) === "pick*, force", `sans la clé, après un échec : ${methods(missed)}`);
    const a1 = attempt(missed);
    ctx.expect((a1?.method === "pick") && (a1?.outcome === "failure") && (a1?.total === 10) && (a1?.door === wallId) && (a1?.token === fighter.id),
      `lockAttempt sur l'échec : ${JSON.stringify(a1)}`);
    ctx.expect(!missed?.fired?.some(f => f.hook === "doorUnlocked"), "pas de doorUnlocked sur un échec");
    const again = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 30 });
    ctx.expect((again?.outcome === null) && (again?.state === "locked"), `second essai refusé (un essai) : ${again?.outcome}, ${again?.state}`);
    await ctx.call("update-scene-object", { type: "Wall", objectId: wallId, data: { [`flags.${MODULE_ID}.-=lockTries`]: null } });
    await pause(300);
    const picked = await ctx.engine("lock", { tokenId: fighter.id, wallId, method: "pick", total: 18 });
    ctx.expect((picked?.outcome === "success") && (picked?.state === "closed"), `crochetage à 18 : ${picked?.outcome}, ${picked?.state}`);
    ctx.expect(picked?.fired?.some(f => (f.hook === "doorUnlocked") && (f.method === "pick") && (f.door === wallId)),
      `hook doorUnlocked : ${JSON.stringify(picked?.fired)}`);
    const order = (picked?.fired ?? []).map(f => f.hook);
    ctx.expect((attempt(picked)?.outcome === "success") && (order.indexOf("lockAttempt") < order.indexOf("doorUnlocked")),
      `lockAttempt « success » avant doorUnlocked : ${order.join(" → ")}`);

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
    ctx.expect((attempt(opened)?.method === "key") && (attempt(opened)?.outcome === "success") && (attempt(opened)?.total === null),
      `lockAttempt de la clé, sans total : ${JSON.stringify(attempt(opened))}`);
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
    ctx.expect(attempt(gm)?.outcome === "gm", `lockAttempt « gm » : ${JSON.stringify(attempt(gm))}`);

    // 7. Les menus entendent les voisins (§243, §247).
    await setLock(lock);
    await pause(300);
    const PROBE = "DAS test probe";
    const doorMenu = await ctx.engine("placeMenu", { tokenId: fighter.id, wallId, probe: PROBE });
    const labels = doorMenu?.labels ?? [];
    const at = labels.indexOf(PROBE);
    ctx.expect((at > 1) && (at < labels.length - 1), `menu de la porte verrouillée : entrée du voisin après la serrure, avant le MJ (${labels.join(" | ")})`);
    ctx.expect((doorMenu?.seen?.[0]?.wall === wallId) && (doorMenu?.seen?.[0]?.token === fighter.id), `contexte doorMenu : ${JSON.stringify(doorMenu?.seen)}`);
    const quiet = await ctx.engine("placeMenu", { tokenId: fighter.id, wallId });
    ctx.expect(!(quiet?.labels ?? []).includes(PROBE) && (quiet?.labels?.length === labels.length - 1), `sans voisin, le menu est celui du moteur : ${quiet?.labels?.join(" | ")}`);
    const point = { x: home.x + (2 * grid) + (grid / 2), y: home.y + (2 * grid) + (grid / 2) };
    const ground = await ctx.engine("placeMenu", { tokenId: fighter.id, ...point, probe: PROBE });
    ctx.expect(ground?.labels?.[0] === PROBE, `menu d'une case : l'entrée du voisin en tête (${ground?.labels?.join(" | ")})`);
    ctx.expect((ground?.seen?.[0]?.point?.x === point.x) && (ground?.seen?.[0]?.point?.y === point.y), `contexte groundMenu : ${JSON.stringify(ground?.seen)}`);
  }
};
