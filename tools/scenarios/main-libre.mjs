/**
 * §409 (issue #44, lot 2) : composante somatique et main libre ; lanceur Neutralisé. « Arène des refus » (`node tools/arene-refus.mjs`),
 * pré-tirés niveau 1 du Manuel, personnages joueurs (réglage `somaticHands` à « pc »).
 *  1. Le Clerc, masse et bouclier en main, lance Flamme sacrée (V, S) : la fenêtre dit « pas de main libre » et nomme les deux objets.
 *  2. Le Mage, bâton (Polyvalent) d'une main, lance Rayon de givre (V, S) : une main libre, aucune fenêtre.
 *  3. Le Clerc reçoit Mage de guerre : Flamme sacrée passe sans fenêtre.
 *  4. Réglage « pas de contrôle » : sans Mage de guerre, le Clerc lance sans fenêtre.
 *  5. Le Mage, Neutralisé, lance Alarme (1 minute, rituel ; prêté) : la fenêtre dit qu'un Neutralisé ne lance pas de sort, même sans
 *     coût d'action.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "main libre — composante somatique, Mage de guerre, Neutralisé et sort long",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const cleric = await ctx.token("Clerc des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const flame = await ctx.itemId(cleric.id, "sacred-flame");
    const ray = await ctx.itemId(mage.id, "ray-of-frost");

    /** La fenêtre de légalité de ce token, ou null après `ms`. */
    const legality = async (name, ms=6000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      for ( const n of [mage.name, cleric.name] ) {
        const d = await legality(n, 300);
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      }
    });
    const textOf = d => [d?.title, d?.content, d?.text, ...(d?.lines ?? [])].filter(Boolean).join(" ");
    /** Lance ; rend la fenêtre (refermée par « Renoncer ») ou null si l'utilisation est passée sans fenêtre. */
    const attempt = async (token, itemId, activityType, target) => {
      await ctx.call("use-activity", { tokenId: token.id, itemId, activityType, configure: false,
        ...(target ? { targetTokenIds: [target.id] } : {}), usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
      const d = await legality(token.name, 4000);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(1500);
      return d;
    };

    // 1. Masse et bouclier.
    let d = await attempt(cleric, flame, "save", dummy);
    ctx.expect(!!d, "Clerc, masse et bouclier : la fenêtre s'ouvre");
    const said = textOf(d);
    ctx.expect(/free hand|main libre/i.test(said) && /Mace|Masse/.test(said) && /Shield|Bouclier/.test(said), `elle dit « pas de main libre » et nomme les objets (${said.slice(0, 200)})`);

    // 2. Bâton d'une main.
    d = await attempt(mage, ray, "attack", dummy);
    ctx.expect(!d, `Mage, bâton d'une main : aucune fenêtre${d ? ` (${textOf(d).slice(0, 160)})` : ""}`);

    // 3. Mage de guerre.
    await ctx.ensureItem(cleric, PHB + "feats.Item.phbftWarCaster00");
    d = await attempt(cleric, flame, "save", dummy);
    ctx.expect(!d, `Mage de guerre : Flamme sacrée sans fenêtre${d ? ` (${textOf(d).slice(0, 160)})` : ""}`);
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: (await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id })).data.actorId,
      itemId: await ctx.itemId(cleric.id, "war-caster") }).catch(() => {});

    // 4. Réglage éteint.
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "somaticHands", value: "off" });
    ctx.restore(() => ctx.call("set-setting", { namespace: MODULE_ID, key: "somaticHands", value: "pc" }).catch(() => {}));
    d = await attempt(cleric, flame, "save", dummy);
    ctx.expect(!d, `« pas de contrôle » : Flamme sacrée sans fenêtre${d ? ` (${textOf(d).slice(0, 160)})` : ""}`);
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "somaticHands", value: "pc" });

    // 5. Neutralisé, sort d'une minute (rituel).
    const alarm = await ctx.ensureItem(mage, PHB + "spells.Item.phbsplAlarm00000", { system: { method: "atwill" } });
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: true });
    ctx.restore(() => ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false }).catch(() => {}));
    d = await attempt(mage, alarm, "utility", null);
    const why = textOf(d);
    ctx.expect(!!d && /Incapacitated|Neutralisé/.test(why) && /spell|sort/i.test(why), `Neutralisé, Alarme (1 minute) : refusé (${why.slice(0, 200)})`);
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false });

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
