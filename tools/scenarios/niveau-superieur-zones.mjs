/**
 * §406 : une activité qu'une zone relance plus tard garde le niveau de lancement — la Boule de feu à retardement lancée au niveau 9
 * (sort de niveau 7, montée 2) : quand sa zone tombe (`zoneEnd`), l'explosion « Trigger Explosion » (12d6, +1d6 par niveau) doit partir
 * à 14d6, pas 12d6 (avant le §406, `activity.use()` sans montée : dnd5e prenait l'emplacement de base). Joué dans l'« Arène des sorts ».
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const DBF = "Compendium.dnd-players-handbook.spells.Item.phbsplDelayedBla";
const CREATE = "9yLyrnGNwM8EL6Uy";
const UP = 2;
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "zone qui relance une activité au niveau de lancement — Boule de feu à retardement (§406)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const hp0 = await ctx.hp(target);
    const { sceneId } = await ctx.scene();
    ctx.restore(async () => {
      await ctx.removeEffectsFrom(caster, "delayed-blast-fireball");
      await ctx.setHp(target, hp0);
    });
    await ctx.ensureItem(caster, DBF);
    const regions = async () => ((await ctx.call("list-scene-objects", { sceneId, types: ["Region"] })).objects?.Region ?? []);
    const before = new Set((await regions()).map(r => r.id));

    // La bille posée sur la Cible, emplacement de niveau 9.
    const b = await ctx.box(target);
    const used = await ctx.use({ tokenId: caster.id, identifier: "delayed-blast-fireball", activityId: CREATE, consume: false,
      area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width / 2 },
      usageConfig: { scaling: UP, spell: { slot: `spell${7 + UP}` } } });
    ctx.expect(!!used?.usageMessageId, "la bille est posée (carte d'utilisation)");
    if ( !used?.usageMessageId ) return;
    await pause(2000);
    const zone = (await regions()).find(r => !before.has(r.id));
    ctx.expect(!!zone, "une zone qui dure est posée");
    if ( !zone ) return;

    // La zone tombe : l'explosion part de son centre.
    const mark = await ctx.lastMessageId();
    await ctx.call("delete-scene-object", { sceneId, type: "Region", objectId: zone.id });
    let formula = null;
    for ( let i = 0; (i < 40) && !formula; i++ ) {
      await pause(750);
      for ( const m of await ctx.messagesSince(mark) ) {
        for ( const raw of m.rolls ?? [] ) {
          const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
          if ( /\d+d6/.test(roll?.formula ?? "") && (m.type === "damage") ) formula = roll.formula;
        }
      }
    }
    ctx.expect(!!formula, "l'explosion lance ses dégâts quand la zone tombe");
    if ( !formula ) return;
    const n = Number(/^(\d+)d6/.exec(formula)?.[1] ?? 0);
    ctx.expect([12 + UP, 2 * (12 + UP)].includes(n), `explosion au niveau ${7 + UP} : ${formula} (attendu ${12 + UP}d6)`);
    // Les zones posées par l'explosion (instantanée) ou restées : retirées.
    for ( const r of (await regions()).filter(r => !before.has(r.id)) ) await ctx.call("delete-scene-object", { sceneId, type: "Region", objectId: r.id }).catch(() => {});
  }
};
