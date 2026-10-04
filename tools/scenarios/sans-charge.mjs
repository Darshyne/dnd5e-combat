/**
 * §77 : le Nuage fétide du Dretch (Monster Manual 2024) et le lancer sans charge du MJ. Le Dretch du monde (`mmDretch00000000`,
 * importé du compendium) est posé le temps du scénario au contact d'un token de la scène (la « cible »), en combat.
 *  - 1re utilisation : la charge 1/jour de l'item est dépensée (la donnée premium la cherchait sur l'activité : refusé) ;
 *    chaque créature à 3 m fait sa sauvegarde de Constitution ;
 *  - plus de charge : la fenêtre « Plus de charge » s'ouvre chez le MJ — « Renoncer » n'utilise rien, « Lancer quand même » lance
 *    sans rien consommer ;
 *  - la cible empoisonnée par le nuage, jusqu'à la fin de son tour suivant (`targetEnd` : la donnée disait « 1 tour » du cœur) : plus de
 *    Réaction ; son action prise, plus d'action Bonus.
 */
const DRETCH = "mmDretch00000000";
const ITEM = "mmFetidCloud0000";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "sans charge — Nuage fétide du Dretch, le MJ lance quand même",

  async run(ctx) {
    const dretch = await ctx.call("get-actor", { actorId: DRETCH }).catch(() => null);
    if ( !dretch?.items?.some(i => i._id === ITEM) ) { ctx.log("pas de Dretch du Monster Manual dans le monde : non applicable"); return; }
    const { tokens } = await ctx.scene();
    let ref = null;
    for ( const t of tokens.filter(t => t.actorId !== DRETCH) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( (a?.type === "npc") && a.items.some(i => Object.values(i.system?.activities ?? {}).some(x => x.type === "attack")) ) { ref = t; break; }
    }
    if ( !ref ) { ctx.log("aucun PNJ avec une attaque sur la scène : non applicable"); return; }
    const target = await ctx.token(ref.name);
    await ctx.setHp(target, 300);
    const grid = await ctx.gridSize();
    const at = await ctx.position(target);
    const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
    await ctx.call("place-token", { actorId: DRETCH, x: at.x + grid, y: at.y });
    const placed = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: placed.id }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Token", objectId: placed.id, data: { disposition: -1 } });
    await sleep(800);
    await ctx.startCombat([{ ...placed, actorId: placed.actorId ?? DRETCH }, target]);

    const saves = async since => (await ctx.messagesSince(since)).filter(m => /Constitution/i.test(m.flavor ?? ""));
    // Par l'API de test du moteur (`activity.use`, ressources dépensées) : le geste d'un clic — `use-activity` du connecteur ne pose pas
    // la zone sur soi.
    const cloud = () => ctx.call("call-module-api", { moduleId: MODULE_ID, fn: "use", args: { tokenId: placed.id, itemId: ITEM, activityType: "save", consume: true }, waitMs: 1500 }).catch(e => ({ error: e.message }));
    const warning = async known => {
      for ( let k = 0; k < 12; k++ ) {
        await sleep(400);
        const w = (await ctx.call("list-dialogs", {})).windows.find(x => !known.includes(x.id) && /charge/i.test(`${x.title} ${JSON.stringify(x.buttons ?? [])}`));
        if ( w ) return w;
      }
      return null;
    };
    const dialogs = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);

    // 1. La charge de l'item.
    let known = await dialogs();
    let since = await ctx.lastMessageId();
    await cloud();
    await sleep(3500);
    let w = await warning(known);
    if ( w ) {
      ctx.log("le Dretch du monde avait déjà dépensé sa charge : lancé quand même pour la suite");
      await ctx.call("answer-dialog", { id: w.id, button: w.buttons.find(b => /quand même|anyway/i.test(b.label ?? "")).action });
      await sleep(3500);
    }
    else ctx.expect((await saves(since)).length > 0, `1re utilisation : la charge de l'item est dépensée, sauvegardes de Constitution (${(await saves(since)).length})`);
    ctx.log((await ctx.engineLog()).filter(l => /utilisations de l'activité|charge/.test(l)).slice(-2).join(" / "));

    // 2. Plus de charge : « Renoncer ».
    known = await dialogs();
    since = await ctx.lastMessageId();
    await cloud();
    w = await warning(known);
    if ( !ctx.expect(!!w, "plus de charge : la fenêtre « Plus de charge » s'ouvre chez le MJ") ) return;
    await ctx.call("answer-dialog", { id: w.id, button: w.buttons.find(b => /Renoncer|Cancel/i.test(b.label ?? "")).action });
    await sleep(2500);
    ctx.expect(!(await saves(since)).length, "« Renoncer » : rien n'est lancé");

    // 3. « Lancer quand même », jusqu'à ce que la cible rate (20 essais au plus).
    let poisoned = null;
    for ( let n = 0; (n < 20) && !poisoned; n++ ) {
      known = await dialogs();
      since = await ctx.lastMessageId();
      await cloud();
      w = await warning(known);
      if ( !ctx.expect(!!w, `essai ${n + 1} : la fenêtre revient (rien n'a été consommé)`) ) return;
      await ctx.call("answer-dialog", { id: w.id, button: w.buttons.find(b => /quand même|anyway/i.test(b.label ?? "")).action });
      await sleep(4000);
      if ( n === 0 ) ctx.expect((await saves(since)).length > 0, "« Lancer quand même » : les sauvegardes sont jetées");
      poisoned = (await ctx.effects(target)).find(e => /Empoisonn|Poison/i.test(e.name));
    }
    if ( !ctx.expect(!!poisoned, `la cible rate et est Empoisonnée (${poisoned?.name})`) ) return;
    ctx.expect(poisoned.duration?.expiry === "targetEnd", `jusqu'à la fin de son tour suivant (${JSON.stringify(poisoned.duration ?? {})})`);

    // 4. Empoisonnée par le nuage : ni Réaction, ni action Bonus après son action.
    const ta = await ctx.call("get-actor", { actorId: target.actorId });
    const weapon = ta.items.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    const api = async (fn, args) => (await ctx.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 5000 })).result;
    const react = await api("issues", { tokenId: target.id, itemId: weapon._id, activityType: "attack", cost: "reaction" });
    ctx.expect(react.some(l => /Réaction|Reaction/.test(l)), `plus de Réaction (${react.join(" | ")})`);
    await ctx.use({ tokenId: target.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [placed.id], usageConfig: { [MODULE_ID]: { autoReact: "none", confirmed: true } } }).catch(() => null);
    await sleep(3000);
    const bonus = await api("issues", { tokenId: target.id, itemId: weapon._id, activityType: "attack", cost: "bonus" });
    ctx.expect(bonus.some(l => /pas les deux|not both/.test(l)), `son action prise : plus d'action Bonus (${bonus.join(" | ")})`);
  }
};
