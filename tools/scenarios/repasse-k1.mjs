/**
 * §322, lot K1 de la repasse des créatures : la fin des états d'une capacité de monstre, lue dans son texte anglais d'origine
 * (`core/monster-text.mjs`). Arène des sorts : le Lanceur (PNJ) reçoit des capacités prêtées depuis les fiches du Monster Manual, contre
 * l'« Ennemi au contact ».
 *  - Spores pacificatrices (Myconide adulte) : Étourdi, sauvegarde rejouée à la fin de chacun de ses tours ; réussie, l'état tombe ;
 *  - Regard soporifique (Chacal-garou) : Inconscient, tombe dès que la cible subit des dégâts ;
 *  - Regard pétrifiant (Basilic) : premier échec Entravé, sauvegarde à la fin de son prochain tour ; second échec, Pétrifié.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const MM = "Compendium.dnd-monster-manual.actors.Actor";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k1 — fin des états de monstre lue dans le texte : sauvegarde répétée, fin sur dégâts, second échec (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const lent = [];
    const lend = async (uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    // Les effets de l'Ennemi qui viennent de ces capacités, par leur identifiant (api.mcp.effectOrigins).
    const IDENTS = ["pacifying-spores", "sleep-gaze", "petrifying-gaze"];
    const fromIdent = async ident => ctx.effectsFrom(target, ident);
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      for ( const e of await ctx.effectsFrom(target, ...IDENTS) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}`, effectId: e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
      await pause(800);
    };
    ctx.restore(async () => {
      await reset();
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    /** Utilise la sauvegarde jusqu'à un échec de la cible (20 essais) ; rend l'id du message d'utilisation. */
    const untilFail = async (itemId, activityId, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(500);
        const used = await ctx.use({ tokenId: caster.id, itemId, activityId, activityType: "save", targetTokenIds: [target.id], consume: false, ...extra });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1200);
        if ( r?.targets?.find(t => t.name === target.name)?.save?.success === false ) return used.usageMessageId;
      }
      return null;
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([caster, target]);
      const combat = await state();
      for ( const [t, v] of [[caster, 20], [target, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== caster.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === caster.id;
    };
    const resavesSince = async since => (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);

    await part("Spores pacificatrices", async () => {
      const item = await lend(`${MM}.mmMyconidAdult00.Item.mmPacifyingSpore`);
      if ( !ctx.expect(await fight(), "combat : au tour du Lanceur") ) return;
      const since = await untilFail(item, "6c9CieCQWV7XsKLy");
      if ( !ctx.expect(!!since, "l'Ennemi rate la sauvegarde des spores (20 essais au plus)") ) return;
      ctx.expect((await fromIdent("pacifying-spores")).some(e => e.statuses.includes("stunned")), "Étourdi posé");
      let resave = null;
      for ( let turn = 0; (turn < 3) && !resave; turn++ ) {
        await ctx.nextTurn();
        await pause(3000);
        resave = (await resavesSince(since))[0] ?? null;
      }
      if ( !ctx.expect(!!resave, "la sauvegarde est rejouée à la fin du tour de l'Ennemi") ) return;
      ctx.expect(resave.flags[MODULE_ID].resave.moment === "endOfTurn", `moment : ${resave.flags[MODULE_ID].resave.moment}`);
      const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
      const save = r?.targets?.find(t => t.name === target.name)?.save;
      await pause(1500);
      const still = (await fromIdent("pacifying-spores")).some(e => e.statuses.includes("stunned"));
      if ( save ) ctx.expect(save.success ? !still : still, `${save.success ? "réussie" : "ratée"} (${save.total}) : Étourdi ${still ? "reste" : "tombe"}`);
    });

    await part("Regard soporifique", async () => {
      const item = await lend(`${MM}.mmJackalwere0000.Item.mmSleepGaze00000`);
      const since = await untilFail(item, "TXstlDE42CZicPAk");
      if ( !ctx.expect(!!since, "l'Ennemi rate la sauvegarde du regard (20 essais au plus)") ) return;
      ctx.expect((await fromIdent("sleep-gaze")).some(e => e.statuses.includes("unconscious")), "Inconscient posé");
      await ctx.engine("hurt", { tokenId: target.id, amount: 3 });
      let gone = false;
      for ( let i = 0; (i < 10) && !gone; i++ ) { await pause(500); gone = !(await fromIdent("sleep-gaze")).length; }
      ctx.expect(gone, "dégâts subis : l'Inconscient tombe");
    });

    await part("Regard pétrifiant", async () => {
      const item = await lend(`${MM}.mmBasilisk000000.Item.mmPetrifyingGaze`);
      if ( !ctx.expect(await fight(), "combat : au tour du Lanceur") ) return;
      const box = await ctx.box(target);
      const since = await untilFail(item, "mN9aF1WkHQWLIN4B", { area: { shape: "rectangle", ...box } });
      if ( !ctx.expect(!!since, "l'Ennemi rate le premier jet (20 essais au plus)") ) return;
      const first = await fromIdent("petrifying-gaze");
      ctx.expect(first.some(e => (e.statuses ?? []).includes("restrained")), `premier échec : Entravé (${first.flatMap(e => e.statuses ?? []).join(", ")})`);
      let resave = null;
      for ( let turn = 0; (turn < 3) && !resave; turn++ ) {
        await ctx.nextTurn();
        await pause(3000);
        resave = (await resavesSince(since))[0] ?? null;
      }
      if ( !ctx.expect(!!resave, "la seconde sauvegarde est rejouée à la fin du tour de l'Ennemi") ) return;
      ctx.expect(!!resave.flags[MODULE_ID].resave.tally, "sauvegarde comptée (second échec)");
      const r = await ctx.settle(resave.id, { timeoutMs: 45000 }).catch(() => null);
      const save = r?.targets?.find(t => t.name === target.name)?.save;
      await pause(1500);
      const now = (await fromIdent("petrifying-gaze")).filter(e => !e.disabled);
      const statuses = now.flatMap(e => e.statuses ?? []);
      if ( save?.success ) ctx.expect(!now.length || !statuses.includes("restrained"), `seconde sauvegarde réussie (${save.total}) : l'effet tombe`);
      else if ( save ) ctx.expect(statuses.includes("petrified"), `second échec (${save.total}) : Pétrifié (${statuses.join(", ")})`);
    });
  }
};
