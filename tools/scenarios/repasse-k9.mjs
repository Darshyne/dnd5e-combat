/**
 * §330, lot K9 de la repasse des créatures : portes de taille (sur une sauvegarde) et de type. Arène des sorts : le Lanceur (PNJ), la
 * Cible (taille M), la Grande cible (G), le Mort-vivant.
 *  - Coup de bouclier du Gladiateur (« si la cible est de taille M ou inférieure, À terre ») : la Cible tombe, la Grande cible non ;
 *  - Regard soporifique du Chacal-garou (« les Artificiels et Morts-vivants réussissent d'office ») : le Mort-vivant n'est pas affecté.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k9 — portes de taille (sauvegarde) et de type lues dans le texte (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Grande cible", "Mort-vivant"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    if ( !JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target, large, undead] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const clearOn = async (t, ...idents) => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const where = data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${scene}.Token.${t.id}.Actor.${data.actorId}` };
      for ( const e of await ctx.effectsFrom(t, ...idents) ) await ctx.call("remove-embedded-effect", { ...where, effectId: e.id }).catch(() => {});
      await ctx.call("set-status", { tokenId: t.id, statusId: "prone", active: false }).catch(() => {});
    };
    ctx.restore(async () => {
      for ( const t of [target, large, undead] ) { await clearOn(t, "shield-bash", "sleep-gaze"); await ctx.setHp(t, 999).catch(() => {}); }
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const besideAndFail = async (t, itemId, activityId, ident) => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 });
      await pause(800);
      for ( let i = 0; i < 20; i++ ) {
        await clearOn(t, ident);
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId, activityId, activityType: "save", targetTokenIds: [t.id], consume: false });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        const entry = r?.targets?.find(x => x.name === t.name);
        if ( entry?.save?.success === false ) return { failed: true, entry };
        if ( entry?.unaffected || (r && !entry) ) return { failed: false, unaffected: true };
      }
      return { failed: false };
    };
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];

    const bash = await lend(`${MM}.mmGladiator00000.Item.mmShieldBash0000`);
    let r = await besideAndFail(target, bash, "eIErvLccVVCXiCSl", "shield-bash");
    if ( ctx.expect(r.failed, "la Cible rate la sauvegarde du Coup de bouclier (20 essais au plus)") ) ctx.expect((await statuses(target)).includes("prone"), "taille M : À terre");
    r = await besideAndFail(large, bash, "eIErvLccVVCXiCSl", "shield-bash");
    if ( ctx.expect(r.failed, "la Grande cible rate la sauvegarde (20 essais au plus)") ) ctx.expect(!(await statuses(large)).includes("prone"), `taille G : pas À terre (${(await statuses(large)).join(", ") || "aucun état"})`);

    const gaze = await lend(`${MM}.mmJackalwere0000.Item.mmSleepGaze00000`);
    const p = await ctx.position(undead);
    await ctx.call("move-token", { tokenId: caster.id, x: p.x - grid, y: p.y, elevation: 0 });
    await pause(800);
    let slept = false;
    for ( let i = 0; i < 6; i++ ) {
      const u = await ctx.use({ tokenId: caster.id, itemId: gaze, activityType: "save", targetTokenIds: [undead.id], consume: false });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      if ( (await statuses(undead)).includes("unconscious") ) slept = true;
    }
    ctx.expect(!slept, "Mort-vivant : jamais endormi par le Regard (6 essais)");
  }
};
