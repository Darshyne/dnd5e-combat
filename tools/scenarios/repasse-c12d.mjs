/**
 * §312, sous-lot C12-d de la repasse terme par terme : budget du tour, coûts. Arène des sorts (Lanceur, Allié).
 *  - Souffle du dragon : lancé par le Lanceur sur l'Allié (au contact), l'Allié reçoit « Exhale » sur sa fiche — au DD de sorts du Lanceur,
 *    au niveau lancé ; la concentration du Lanceur finie, la copie part.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "repasse-c12d — Souffle du dragon donné à l'Allié (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Allié"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, ally] = await Promise.all(names.map(n => ctx.token(n)));
    const granted = async () => ((await ctx.call("get-actor", { actorId: ally.actorId })).items ?? []).find(i => i.flags?.[MODULE_ID]?.granted);
    const concentration = async () => (await ctx.effects(caster)).filter(e => (e.statuses ?? []).includes("concentrating"));
    ctx.restore(async () => {
      const g = await granted();
      if ( g ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: ally.actorId, itemId: g._id }).catch(() => {});
      for ( const e of await concentration() ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id }).catch(() => {});
    });
    const spell = await ctx.ensureItem(caster, `${PHB}.spells.Item.phbsplDragonsBre`, { system: { method: "atwill" } });
    const used = await ctx.use({ tokenId: caster.id, itemId: spell, activityId: "dnd5eactivity000", targetTokenIds: [ally.id], consume: false });
    ctx.log(`lancé : ${used.used ? "oui" : "non"}`);
    let g = null;
    for ( let n = 0; (n < 20) && !g; n++ ) { await pause(500); g = await granted(); }
    if ( !ctx.expect(!!g, "l'Allié reçoit « Exhale » sur sa fiche") ) return;
    const exhale = Object.values(g.system?.activities ?? {})[0];
    // Le DD de sorts calculé du Lanceur (la lecture de la fiche par le connecteur ne rend que la donnée source).
    const dc = (await ctx.engine("stats", { tokenId: caster.id }))?.spellDc ?? null;
    ctx.expect(Object.keys(g.system?.activities ?? {}).length === 1, "une seule activité : Exhale");
    ctx.expect((dc === null) ? (Number(exhale?.save?.dc?.formula) >= 10) : (exhale?.save?.dc?.formula === String(dc)),
      `un DD fixe, celui du Lanceur (${exhale?.save?.dc?.formula} ; Lanceur ${dc ?? "non lu"})`);
    ctx.log(`dés : ${JSON.stringify((exhale?.damage?.parts ?? []).map(p => `${p.number}d${p.denomination}`))}`);
    ctx.expect(exhale?.activation?.type === "action", `par une action de l'Allié (${exhale?.activation?.type})`);
    const conc = await concentration();
    if ( !ctx.expect(conc.length > 0, "le Lanceur se concentre") ) return;
    for ( const e of conc ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: caster.actorId, effectId: e._id }).catch(() => {});
    let gone = false;
    for ( let n = 0; (n < 20) && !gone; n++ ) { await pause(500); gone = !(await granted()); }
    ctx.expect(gone, "la concentration finie, la copie part");
  }
};
