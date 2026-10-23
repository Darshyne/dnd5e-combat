/**
 * Tentacules noirs d'Evard (relevé des trous, 2026-10-22), dans l'Arène des sorts : « sur un échec, elle subit 3d6 dégâts » — rien sur
 * une réussite. La donnée du Manuel porte `onSave: "half"` ; le contenu la corrige (`saveDamage`). `releve-sorts-3` jouait le sort sans
 * regarder ce cas. On relance jusqu'à voir une réussite et un échec (15 essais au plus) : réussite → aucun PV perdu, échec → PV perdus =
 * dégâts consignés, et Entravé. Le sort du Manuel, puis celui du SRD (`black-tentacles`, mêmes ids).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Tentacules noirs d'Evard — rien sur une sauvegarde réussie (Manuel et SRD)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const [caster, target, other] = await Promise.all(["Lanceur", "Cible", "Cible voisine"].map(n => ctx.token(n)));
    const box = await ctx.box(target);
    const g = ARENE_SORTS.grid;
    for ( const uuid of ["Compendium.dnd-players-handbook.spells.Item.phbsplEvardsBlac", "Compendium.dnd5e.spells24.phbsplEvardsBlac"] ) {
      const itemId = await ctx.ensureItem(caster, uuid, { system: { method: "atwill" } });
      const seen = { success: false, failure: false };
      for ( let n = 1; (n <= 15) && !(seen.success && seen.failure); n++ ) {
        for ( const t of [target, other] ) { await ctx.removeStatusEffects(t, "restrained").catch(() => {}); await ctx.setHp(t, 999); }
        const used = await ctx.use({ tokenId: caster.id, itemId, activityType: "save", targetTokenIds: [target.id, other.id], consume: false,
          area: { shape: "rectangle", x: box.x - g / 2, y: box.y - g / 2, width: 4 * g, height: 2 * g } });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 30000 });
        await pause(1500);
        for ( const t of r.targets ?? [] ) {
          const tok = [target, other].find(x => x.name === t.name);
          if ( !tok || (t.save?.success === undefined) ) continue;
          const lost = 999 - await ctx.hp(tok);
          if ( t.save.success ) {
            seen.success = true;
            ctx.expect(lost === 0, `${uuid.split(".")[1]} : ${t.name} réussit (${t.save.total ?? "?"}) → ${lost} PV perdus (0 attendu)`);
          }
          else {
            seen.failure = true;
            ctx.expect((lost > 0) && (lost === t.damage?.applied), `${uuid.split(".")[1]} : ${t.name} rate → ${lost} PV perdus, ${t.damage?.applied} consignés`);
          }
        }
        // La zone de l'essai : retirée avant le suivant (elle rejouerait sa sauvegarde à l'entrée).
        const { objects } = await ctx.call("list-scene-objects", { types: ["Region"] });
        for ( const reg of objects.Region ?? [] ) await ctx.call("delete-scene-object", { type: "Region", objectId: reg.id }).catch(() => {});
      }
      ctx.expect(seen.success && seen.failure, `${uuid.split(".")[1]} : une réussite et un échec vus en 15 essais`);
      for ( const t of [target, other] ) { await ctx.removeStatusEffects(t, "restrained").catch(() => {}); await ctx.setHp(t, 999); }
    }
  }
};
