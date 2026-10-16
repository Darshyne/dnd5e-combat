/**
 * Attaque supplémentaire et Lutte / Bousculade (retour de table du 2026-10-16 : « l'interface considère parfois que le joueur
 * n'a plus d'action alors qu'il en reste une », classes à deux attaques). Le Paladin (niveau 8, Attaque supplémentaire) au contact
 * du Zombi :
 *  1. une attaque d'épée : l'action Attaquer est ouverte, une attaque reste (budget du moteur et `api.ui.budget`) ;
 *  2. la Bousculade de la Frappe à mains nues remplace la seconde attaque : aucun souci de légalité ;
 *  3. utilisée, elle consomme cette seconde attaque — plus rien ensuite.
 * Remet le Zombi et le Paladin à leur place (le filet du lanceur remet PV et effets).
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "attaque puis lutte — Attaque supplémentaire, la Bousculade remplace une attaque",

  async run(ctx) {
    const paladin = await ctx.token("Paladin");
    const zombi = await ctx.token("Zombi");
    const size = await ctx.gridSize();
    const move = (token, x, y) => ctx.call("move-token", { tokenId: token.id, x, y });
    ctx.restore(() => move(paladin, paladin.x, paladin.y));
    ctx.restore(() => move(zombi, zombi.x, zombi.y));
    await move(paladin, zombi.x + size, zombi.y);

    await ctx.startCombat([paladin, zombi]);
    const sword = await ctx.itemId(paladin.id, "longsword");
    let unarmed = null;
    for ( const until = Date.now() + 6000; !unarmed && (Date.now() < until); await sleep(400) ) {
      unarmed = await ctx.itemId(paladin.id, "unarmed-strike").catch(() => null);
    }
    if ( !ctx.expect(!!sword && !!unarmed, `épée longue et Frappe à mains nues sur le Paladin (${sword ?? "—"}, ${unarmed ?? "—"})`) ) return;

    // 1. Une attaque d'épée.
    const used = await ctx.use({ tokenId: paladin.id, itemId: sword, activityType: "attack", targetTokenIds: [zombi.id], consume: false,
      usageConfig: { [MODULE_ID]: { confirmed: true } } });
    await ctx.settle(used.usageMessageId).catch(() => null);
    await sleep(800);
    const b = await ctx.engine("budget", { tokenId: paladin.id });
    ctx.expect((b?.attacks?.granted === 2) && (b?.attacks?.used === 1),
      `après une attaque : ${b?.attacks?.used}/${b?.attacks?.granted} attaque(s), action ${b?.action}`);

    // 2. La Bousculade remplace la seconde attaque.
    const before = await ctx.engine("issues", { tokenId: paladin.id, itemId: unarmed, activityType: "save" });
    ctx.expect(!before.length, `Bousculade après une attaque : ${before.join(" ; ") || "aucun souci"}`);

    // 2 bis. Un objet « Bousculer » à part (le « Bousculer » des exemples de Midi-QOL, gardé sur une fiche de joueur) : de même.
    const shoveItem = await ctx.call("upsert-actor-item", { actorId: paladin.actorId, itemData: { name: "Bousculer (test)", type: "feat",
      system: { identifier: "shove", activities: { dnd5eShoveTest00: { _id: "dnd5eShoveTest00", type: "utility", activation: { type: "action" } } } } },
      match: { path: "system.identifier", value: "shove" } });
    const shoveId = shoveItem.itemId ?? shoveItem.id ?? shoveItem.item?._id ?? await ctx.itemId(paladin.id, "shove");
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: paladin.actorId, itemId: shoveId }).catch(() => {}));
    const midi = await ctx.engine("issues", { tokenId: paladin.id, itemId: shoveId });
    ctx.expect(!midi.length, `objet « Bousculer » à part après une attaque : ${midi.join(" ; ") || "aucun souci"}`);

    // 3. Utilisée, elle prend la seconde attaque.
    const shove = await ctx.use({ tokenId: paladin.id, itemId: unarmed, activityType: "save", targetTokenIds: [zombi.id], consume: false,
      usageConfig: { [MODULE_ID]: { confirmed: true, saveChoice: "best", choice: "dnd5eCombatPush0" } } });
    await ctx.settle(shove.usageMessageId).catch(() => null);
    await sleep(1200);
    const after = await ctx.engine("budget", { tokenId: paladin.id });
    ctx.expect((after?.attacks?.used === 2) && (after?.action === 0),
      `après la Bousculade : ${after?.attacks?.used}/${after?.attacks?.granted} attaque(s), action ${after?.action}`);
    const last = await ctx.engine("issues", { tokenId: paladin.id, itemId: sword, activityType: "attack" });
    ctx.expect(last.length > 0, `une troisième attaque est refusée (${last.join(" ; ") || "aucun souci"})`);
  }
};
