/**
 * Audit des potions du Guide du maître et du Manuel des joueurs (SPEC §53) — un diagnostic, pas un test : le Guerrier boit chaque
 * potion (sans cible désignée, comme un joueur qui boit) et l'on relève ce qui en sort — effets posés et sur qui, PV, PV temporaires,
 * états, sort lancé. `ONLY=speed,flying` ne boit que les potions dont l'identifiant contient l'un de ces mots. Remet tout.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const PACKS = ["dnd-dungeon-masters-guide.equipment", "dnd-players-handbook.equipment"];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "audit des potions — ce que chacune fait vraiment",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Guerrier") ) { ctx.log("Guerrier requis : non applicable"); return; }
    await ctx.stage(RESTORED_KEEP);
    const g = await ctx.token("Guerrier");
    const actorId = (await ctx.call("get-scene-object", { type: "Token", objectId: g.id })).data.actorId;
    const hp0 = await ctx.hp(g);
    const actor = async () => ctx.call("get-actor", { actorId });
    const baseEffects = new Set(((await actor()).effects ?? []).map(e => e._id));
    const baseItems = new Set(((await actor()).items ?? []).map(i => i._id));
    const reset = async () => {
      const a = await actor();
      for ( const e of a.effects ?? [] ) if ( !baseEffects.has(e._id) ) await ctx.call("remove-embedded-effect", { documentType: "Actor", id: actorId, effectId: e._id }).catch(() => {});
      // Les copies de sort d'abord laissées : retirer la potion les emporte (dnd5e, data/item/templates/activities.mjs:503-508) ; les
      // retirer aussi faisait « Item … does not exist! » dans la console du MJ. On relit la fiche pour ce qui reste.
      const removeAll = list => Promise.all(list.filter(i => !baseItems.has(i._id))
        .map(i => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: i._id }).catch(() => {})));
      await removeAll((a.items ?? []).filter(i => !i.flags?.dnd5e?.cachedFor));
      // dnd5e retire la copie sans l'attendre (`deleteEmbeddedDocuments` non attendu, :508) : relue trop tôt, elle était encore là et
      // partait deux fois (Potion de rapidité, une passe sur deux). On lui laisse le temps.
      if ( (a.items ?? []).some(i => !baseItems.has(i._id) && i.flags?.dnd5e?.cachedFor) ) await pause(1000);
      await removeAll((await actor()).items ?? []);
      await ctx.call("update-actor", { actorId, actorData: { "system.attributes.hp.value": Math.max(1, (hp0 ?? 20) - 12), "system.attributes.hp.temp": 0 } });
    };
    ctx.restore(async () => { await reset(); if ( hp0 !== null ) await ctx.setHp(g, hp0); });

    const only = (process.env.ONLY ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const potions = [];
    for ( const pack of PACKS ) {
      const r = await ctx.call("list-compendium-entries", { packId: pack }).catch(() => null);
      for ( const e of (Array.isArray(r) ? r : (r?.entries ?? [])) ) if ( e.type === "consumable" ) potions.push({ pack, ...e });
    }
    const seen = new Set();
    // Les erreurs de la console relevées potion par potion (le tampon se vide à chaque lecture) : chacune est rattachée à sa ligne.
    const errors = [];
    await ctx.clientErrors();
    for ( const p of potions ) {
      const uuid = p.uuid;
      const { data } = await ctx.call("get-compendium-entry", { uuid }).catch(() => ({ data: null }));
      if ( (data?.type !== "consumable") || (data.system?.type?.value !== "potion") ) continue;
      const id = data.system.identifier;
      if ( seen.has(id) || (only.length && !only.some(o => id.includes(o))) ) continue;
      seen.add(id);
      await reset();
      await pause(500);
      const { _id, folder, ownership, _stats, ...itemData } = data;
      const added = await ctx.call("upsert-embedded-item", { documentType: "Actor", id: actorId, itemData, match: { path: "name", value: data.name } });
      const activities = Object.values(data.system.activities ?? {});
      const first = activities[0];
      if ( !first ) { ctx.log(`${id} : aucune activité`); continue; }
      const before = await actor();
      const since = await ctx.lastMessageId();
      const windowsBefore = new Set((await ctx.engine("windows")).map(w => w.id));
      let outcome = "";
      try {
        const used = await ctx.use({ tokenId: g.id, itemId: added.itemId, activityType: first.type, targetTokenIds: [], consume: false });
        await pause(1200);
        if ( ["heal", "damage", "save"].includes(first.type) ) await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(err => { outcome += ` (carte : ${err.message.slice(0, 60)})`; });
        await ctx.settle(used.usageMessageId, { timeoutMs: 15000 }).catch(() => null);
      } catch ( err ) { outcome += ` ÉCHEC ${err.message.slice(0, 80)}`; }
      await pause(2500);
      // Un sort à plusieurs activités (Détection des pensées de la potion de Lecture des pensées) ouvre le choix d'activité de
      // dnd5e chez le MJ : à la table le joueur choisit ; ici on le note et on le ferme, sinon il reste sur l'écran.
      const opened = (await ctx.engine("windows")).filter(w => !windowsBefore.has(w.id));
      for ( const w of opened ) await ctx.engine("closeWindow", { id: w.id }).catch(() => {});
      if ( opened.length ) outcome += ` (fenêtre : ${opened.map(w => w.title ?? w.className).join(", ")})`;
      const after = await actor();
      const fx = (after.effects ?? []).filter(e => !baseEffects.has(e._id) && !(e.statuses ?? []).includes("bloodied")).map(e => `${e.name}${(e.statuses ?? []).length ? `[${e.statuses.join(",")}]` : ""}${process.env.DETAIL ? ` ‹origine ${String(e.origin ?? "").split(".").slice(-2).join(".")}, message ${e.system?.origin?.message ? "oui" : "non"}›` : ""}`);
      const items = (after.items ?? []).filter(i => !baseItems.has(i._id) && (i._id !== added.itemId)).map(i => `${i.name}(${i.type})`);
      const hp = (after.system?.attributes?.hp?.value ?? 0) - (before.system?.attributes?.hp?.value ?? 0);
      const temp = (after.system?.attributes?.hp?.temp ?? 0) - (before.system?.attributes?.hp?.temp ?? 0);
      const engine = (await ctx.messagesSince(since)).filter(m => m.flags?.["dnd5e-combat"]).map(m => {
        const r = m.flags["dnd5e-combat"].resolution;
        return r ? `résolution ${r.step}, ${r.targets?.length ?? 0} cible(s)` : Object.keys(m.flags["dnd5e-combat"]).join("/");
      });
      ctx.log(`${id.padEnd(32)} ${first.type.padEnd(8)} effets : ${fx.join(", ") || "—"} | PV ${hp >= 0 ? "+" : ""}${hp}${temp ? `, temp +${temp}` : ""}`
        + `${items.length ? ` | items : ${items.join(", ")}` : ""} | moteur : ${engine.join(" ; ") || "—"}${outcome}`);
      await reset();
      await pause(800);
      const fresh = (await ctx.clientErrors()).map(e => `${id} : ${e.message ?? e.text}`);
      if ( fresh.length ) { errors.push(...fresh); ctx.log(`  ⚠ ${fresh.join(" | ").slice(0, 300)}`); }
    }
    errors.push(...(await ctx.clientErrors()).map(e => e.message ?? e.text));
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.join(" | ").slice(0, 400)}` : ""}`);
  }
};
