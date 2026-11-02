/**
 * §324, lot K3 de la repasse des créatures : un seul des effets d'une capacité de monstre, quand le texte le dit (`monsterChoice`), et
 * deux défauts de donnée corrigés par contenu. Arène des sorts : le Lanceur (PNJ) reçoit des capacités prêtées depuis les fiches du
 * Monster Manual et de Ravenloft, contre l'« Ennemi au contact ».
 *  - Lame du chaos (Slaad de la mort) : un seul état tiré au d4, le jet visible ;
 *  - Cimeterre (Amiral pirate) : Charmé OU Empoisonné, au choix du MJ (la fenêtre est répondue) ;
 *  - Domination d'esprit (Aboleth) : l'effet Charmé est enfin posé sur un échec ;
 *  - Malédiction funeste (Vagabond des Brumes) : Aveuglé ET Assourdi.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const CONDITIONS = ["charmed", "frightened", "poisoned", "incapacitated"];

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k3 — un seul effet (tiré ou au choix), Domination d'esprit, Malédiction funeste (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Ennemi au contact"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") || !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Monster Manual ou Ravenloft absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const IDENTS = ["chaos-blade", "scimitar", "dominate-mind", "death-curse"];
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const fromIdent = ident => ctx.effectsFrom(target, ident);
    const clear = async () => {
      const scene = (await ctx.scene()).sceneId;
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: target.id });
      for ( const e of await ctx.effectsFrom(target, ...IDENTS) ) {
        await ctx.call("remove-embedded-effect", { uuid: `Scene.${scene}.Token.${target.id}.Actor.${data.actorId}`, effectId: e.id }).catch(() => {});
      }
    };
    ctx.restore(async () => {
      await clear();
      await ctx.setHp(target, 999).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await clear();
      await pause(600);
    };
    /** Attaque jusqu'à un toucher (20 essais), en répondant au besoin à la fenêtre de choix (premier bouton). */
    const hitWith = async (itemId, activityId, { answer=false }={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(400);
        const known = answer ? (await ctx.call("list-dialogs", {})).windows.map(w => w.id) : [];
        const u = await ctx.use({ tokenId: caster.id, itemId, activityId, activityType: "attack", targetTokenIds: [target.id], rollDamage: true });
        let answered = null;
        if ( answer ) {
          for ( let k = 0; (k < 12) && !answered; k++ ) {
            const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 1000, details: true }).catch(() => null);
            const d = r?.windows?.[0];
            if ( d?.buttons?.length ) { answered = d.buttons[0].label; await ctx.call("answer-dialog", { id: d.id, button: d.buttons[0].action ?? d.buttons[0].label }).catch(() => {}); }
          }
        }
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        if ( r?.targets?.find(t => t.name === target.name)?.hit === true ) return { usage: u.usageMessageId, answered };
      }
      return null;
    };
    const untilFail = async (itemId, activityId, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        await clear();
        await pause(400);
        const u = await ctx.use({ tokenId: caster.id, itemId, activityId, activityType: "save", targetTokenIds: [target.id], consume: false, ...extra });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1500);
        if ( r?.targets?.find(t => t.name === target.name)?.save?.success === false ) return u.usageMessageId;
      }
      return null;
    };

    await part("Lame du chaos", async () => {
      const blade = await lend("Compendium.dnd-monster-manual.actors.Actor.mmDeathSlaad0000.Item.yDu5v2Fj4bPhdXgS");
      const hit = await hitWith(blade, "5crQOQ7WFvdEx8FM");
      if ( !ctx.expect(!!hit, "la Lame du chaos touche (20 essais au plus)") ) return;
      const st = (await fromIdent("chaos-blade")).flatMap(e => e.statuses).filter(s => CONDITIONS.includes(s));
      ctx.expect(st.length === 1, `un seul état tiré (${st.join(", ") || "aucun"})`);
      const rolled = (await ctx.messagesSince(hit.usage)).some(m => (m.rolls ?? []).some(r => /^1d4$/.test(String(r.formula ?? "").trim())));
      ctx.expect(rolled, "le d4 est lancé dans le chat");
    });

    await part("Cimeterre de l'Amiral", async () => {
      const blade = await lend("Compendium.dnd-monster-manual.actors.Actor.mmPirateAdmiral0.Item.mn8aFoITI9CPUN4B");
      const hit = await hitWith(blade, "YOx3cikY6oPu6Ojh", { answer: true });
      if ( !ctx.expect(!!hit, "le Cimeterre touche (20 essais au plus)") ) return;
      ctx.expect(!!hit.answered, `la fenêtre de choix s'ouvre (« ${hit.answered ?? "aucune"} » choisi)`);
      const st = (await fromIdent("scimitar")).flatMap(e => e.statuses).filter(s => ["charmed", "poisoned"].includes(s));
      ctx.expect(st.length === 1, `un seul état au choix (${st.join(", ") || "aucun"})`);
    });

    await part("Domination d'esprit", async () => {
      const dominate = await lend("Compendium.dnd-monster-manual.actors.Actor.mmAboleth0000000.Item.yiiKNaJ2svcUWqLi");
      // La donnée porte un gabarit : la zone est posée sur l'Ennemi.
      const since = await untilFail(dominate, "zdXAMnjaOcsVmLZP", { area: { shape: "rectangle", ...(await ctx.box(target)) } });
      if ( !ctx.expect(!!since, "l'Ennemi rate la sauvegarde (20 essais au plus)") ) return;
      const st = (await fromIdent("dominate-mind")).flatMap(e => e.statuses);
      ctx.expect(st.includes("charmed"), `sauvegarde ratée : Charmé posé (${st.join(", ") || "rien"})`);
    });

    await part("Malédiction funeste", async () => {
      const curse = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwMistWanderer0.Item.l6d1OBt43z55RdbY");
      const box = await ctx.box(target);
      const since = await untilFail(curse, "97fLrn5B9O40FbQM", { area: { shape: "rectangle", ...box } });
      if ( !ctx.expect(!!since, "l'Ennemi rate la sauvegarde (20 essais au plus)") ) return;
      const st = (await fromIdent("death-curse")).flatMap(e => e.statuses);
      ctx.expect(st.includes("blinded") && st.includes("deafened"), `Aveuglé et Assourdi (${st.join(", ") || "rien"})`);
    });
  }
};
