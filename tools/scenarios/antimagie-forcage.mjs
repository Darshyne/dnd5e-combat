/**
 * §436 (suite) : dans un Champ antimagie, un sort que dnd5e refuse sans aucun hook (`requireMagic`) reste forçable depuis la Barre de
 * DAS · Combat UI et depuis la fiche. Monde `dnd-6`, arène ; Champ antimagie et Trait de feu prêtés du Manuel des joueurs (à volonté).
 *  1. Le Magicien lance le Champ (pose sans clic du moteur) : statut `antimagic`.
 *  2. Barre (`darsh-dnd-ui` `api.mcp.barUse`, comme un clic sur la case) : Trait de feu → la fenêtre « le faire quand même » ;
 *     « Renoncer » : ni carte, ni alerte ; « Utiliser quand même » : carte marquée `overridden` (raison du champ), alerte au MJ.
 *  3. Fiche (`item.use`, comme un clic sur la fiche de dnd5e) : même fenêtre ; « Renoncer » : la carte de l'item, comme dnd5e l'aurait
 *     montrée, sans alerte ; « Utiliser quand même » : carte marquée, alerte au MJ.
 * Remet positions, effets, PV.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const FIELD_REASON = /no spell can be cast|aucun sort/i;

export default {
  name: "antimagie — sort forcé depuis la Barre de Combat UI et depuis la fiche",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Bandit"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, bandit] = await Promise.all(names.map(n => ctx.token(n)));
    const homes = new Map();
    for ( const t of [mage, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t),
      effects: new Set((await ctx.effects(t)).map(e => e._id ?? e.id)) });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${mage.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      const d = await legality(300);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      for ( const t of [mage, bandit] ) {
        const h = homes.get(t.id);
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !h.effects.has(e._id ?? e.id)) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(1500);
    });
    const grid = await ctx.gridSize();
    const m = homes.get(mage.id).pos;
    await ctx.call("move-token", { tokenId: bandit.id, x: m.x + 3 * grid, y: m.y, elevation: 0 });
    await pause(1200);
    const lend = id => ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
    const statuses = async t => new Set((await ctx.effects(t)).flatMap(e => e.statuses ?? []));

    // 1. Le Champ.
    const field = await lend("phbsplAntimagicF");
    const used = await ctx.engine("use", { tokenId: mage.id, itemId: field, activityType: "utility" });
    for ( const r of used.regions ?? [] ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: r.id }).catch(() => {}));
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 30000 }).catch(() => null);
    await pause(2500);
    if ( !ctx.expect((await statuses(mage)).has("antimagic"), "le Magicien porte le statut « antimagic »") ) return;

    const bolt = await lend("phbsplFireBolt00");
    const alerts = messages => messages.filter(msg => msg.flags?.[MODULE_ID]?.gmAlert);
    const usages = messages => messages.filter(msg => (msg.type === "usage") && (msg.flags?.[MODULE_ID]?.overridden?.length));
    const itemCards = messages => messages.filter(msg => msg.type === "item");
    const attempt = async (start, button) => {
      const since = await ctx.lastMessageId();
      await start();
      const d = await legality();
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button });
      if ( button === "go" ) {
        const more = await legality(2500);   // une autre raison (pas de cible désignée…) : passée outre aussi
        if ( more ) await ctx.call("answer-dialog", { id: more.id, button: "go" });
      }
      await pause(button === "go" ? 3500 : 2000);
      return ctx.messagesSince(since);
    };
    const forced = async (label, after) => {
      if ( !ctx.expect(!!after, `${label} : la fenêtre se rouvre`) ) return;
      const reasons = usages(after)[0]?.flags?.[MODULE_ID]?.overridden ?? [];
      ctx.expect(reasons.some(r => FIELD_REASON.test(r)), `${label}, forcé : la carte porte la raison du champ (${reasons.join(" | ")})`);
      const text = alerts(after)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
      ctx.expect(FIELD_REASON.test(text), `${label}, forcé : alerte au MJ avec la raison du champ (${text})`);
      ctx.expect((await statuses(mage)).has("antimagic"), `${label} : le Magicien porte toujours le statut après le forçage`);
      const card = usages(after)[0];
      if ( card ) await ctx.settle(card._id ?? card.id, { timeoutMs: 30000 }).catch(() => null);
    };

    // 2. Depuis la Barre de Combat UI.
    const probe = await ctx.call("call-module-api", { moduleId: "darsh-dnd-ui", fn: "barUse", args: { tokenId: mage.id, ref: "Item.none" } })
      .then(() => null).catch(err => err.message);
    const ui = ctx.expect(!probe, `la Barre de Combat UI répond (api.mcp.barUse)${probe ? ` — ${probe}` : ""}`);
    if ( ui ) {
      const bar = () => ctx.call("call-module-api", { moduleId: "darsh-dnd-ui", fn: "barUse", args: { tokenId: mage.id, ref: `Item.${bolt}` } });
      let after = await attempt(bar, "cancel");
      if ( ctx.expect(!!after, "Barre : Trait de feu dans le champ ouvre la fenêtre « le faire quand même »") ) {
        ctx.expect(!usages(after).length && !alerts(after).length, `Barre, renoncé : ni carte, ni alerte (${after.length} message(s))`);
      }
      await forced("Barre", await attempt(bar, "go"));
    } else ctx.log("DAS · Combat UI sans `api.mcp.barUse` : la Barre n'est pas jouée");

    // 3. Depuis la fiche.
    const sheet = () => ctx.engine("sheetUse", { tokenId: mage.id, itemId: bolt });
    let after = await attempt(sheet, "cancel");
    if ( ctx.expect(!!after, "Fiche : Trait de feu dans le champ ouvre la fenêtre « le faire quand même »") ) {
      ctx.expect(!usages(after).length && !alerts(after).length && (itemCards(after).length === 1),
        `Fiche, renoncé : la carte de l'item seule, comme dnd5e (${itemCards(after).length} carte(s) d'item, ${alerts(after).length} alerte(s))`);
    }
    await forced("Fiche", await attempt(sheet, "go"));

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
