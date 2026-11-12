/**
 * §417 : le réglage « Action impossible » (`refusalMode`, cadre « Déroulement ») — ce que devient un refus du moteur, côté MJ, sur
 * l'« Arène des refus » (`node tools/arene-refus.mjs`), une attaque ou un sort lancés depuis la fiche sur la Cible lointaine (155 ft) :
 *  1. `window` : la fenêtre « hors de portée » avec « utiliser quand même » ; renoncé, rien ne part.
 *  2. `strict` : le MJ garde la fenêtre entière (le joueur, lui, ne peut que renoncer : à vérifier avec `claude player`).
 *  3. `notice` : aucune fenêtre ; la javeline du Guerrier part, la carte est marquée, UNE alerte MJ (§416 : le jet ne redemande pas).
 *  4. `off` : aucune fenêtre ; la Flamme sacrée du Clerc part, sans marque ni alerte.
 * Un lanceur différent par étape : forcer une portée la tient pour acquise 60 s par activité et cibles (`acknowledge`, runtime/turn.mjs).
 * Le réglage est remis à sa valeur d'avant.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déroulement : action impossible — fenêtre, refus strict, simple avertissement, aucun contrôle",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const fighter = await ctx.token("Guerrier des refus");
    const cleric = await ctx.token("Clerc des refus");
    const far = await ctx.token("Cible lointaine des refus");
    const bolt = await ctx.ensureItem(mage, `${PHB}phbsplFireBolt00`);
    const javelin = await ctx.itemId(fighter.id, "javelin").catch(() => null);
    const flame = await ctx.itemId(cleric.id, "sacred-flame").catch(() => null);
    const script = async code => (await ctx.call("run-script", { code }))?.result;

    const before = (await ctx.engine("setting", { key: "refusalMode" }))?.now ?? "level";
    const mode = value => ctx.engine("setting", { key: "refusalMode", value });
    ctx.restore(() => mode(before));

    const legality = async (name, ms=6000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      for ( const t of [mage, fighter, cleric] ) {
        const d = await legality(t.name, 300);
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      }
    });
    /** Depuis la fiche : la cible désignée, puis `activity.use()` sans rien de confirmé — le chemin d'un clic sur l'objet. */
    const useFromSheet = (token, itemId, type) => script(`const t = canvas.tokens.get("${token.id}");
      canvas.tokens.get("${far.id}").setTarget(true, { releaseOthers: true });
      const activity = t.actor.items.get("${itemId}").system.activities.find(a => a.type === "${type}");
      activity.use(); return true;`);
    const buttonsOf = d => (d?.buttons ?? []).map(b => b.action);
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const marked = messages => messages.filter(m => m.flags?.[MODULE_ID]?.overridden?.length);
    const types = messages => messages.map(m => m.type).join(", ") || "aucun message";

    // 1 et 2. La fenêtre — celle de tous (`window`), celle que le MJ garde en refus strict.
    for ( const value of ["window", "strict"] ) {
      await mode(value);
      const since = await ctx.lastMessageId();
      await useFromSheet(mage, bolt, "attack");
      const d = await legality(mage.name);
      ctx.expect(!!d && buttonsOf(d).includes("go"), `${value} : la fenêtre s'ouvre chez le MJ, avec « utiliser quand même » (${buttonsOf(d).join(", ") || "pas de fenêtre"})`);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(1500);
      const after = await ctx.messagesSince(since);
      ctx.expect(!after.length, `${value} : renoncé, rien ne part (${types(after)})`);
    }

    // 3. Simple avertissement : l'action part, marquée, le MJ prévenu une fois.
    if ( ctx.expect(!!javelin, "le Guerrier des refus a une javeline") ) {
      await mode("notice");
      const since = await ctx.lastMessageId();
      await useFromSheet(fighter, javelin, "attack");
      const d = await legality(fighter.name, 3000);
      ctx.expect(!d, "notice : aucune fenêtre");
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(5000);
      const after = await ctx.messagesSince(since);
      ctx.expect(after.some(m => m.type === "attack"), `notice : l'attaque part (${types(after)})`);
      ctx.expect(marked(after).length > 0, "notice : la carte est marquée « forcé »");
      ctx.expect(alerts(after).length === 1, `notice : une seule alerte MJ (${alerts(after).length})`);
    }

    // 4. Aucun contrôle : l'action part, rien n'est signalé.
    if ( ctx.expect(!!flame, "le Clerc des refus a la Flamme sacrée") ) {
      await mode("off");
      const since = await ctx.lastMessageId();
      await useFromSheet(cleric, flame, "save");
      const d = await legality(cleric.name, 3000);
      ctx.expect(!d, "off : aucune fenêtre");
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(5000);
      const after = await ctx.messagesSince(since);
      ctx.expect(after.some(m => m.type === "usage"), `off : le sort part (${types(after)})`);
      ctx.expect(!marked(after).length && !alerts(after).length, `off : ni marque ni alerte (${marked(after).length} marque(s), ${alerts(after).length} alerte(s))`);
    }
  }
};
