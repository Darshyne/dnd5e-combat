/**
 * §79 — Fins et durées des sorts.
 *  1. Charme-monstre (Manuel des joueurs, prêté sans emplacement au premier personnage joueur de la scène) sur le Zombi : des dégâts
 *     d'auteur inconnu ne le font pas cesser ; les dégâts du lanceur, si (« jusqu'à ce que vous ou vos alliés lui infligiez des
 *     dégâts », comme Charme-personne et Amitié avec les animaux).
 *  2. Rayon traçant du même lanceur, qui touche le Zombi : la marque posée prend fin à la fin du prochain tour du LANCEUR
 *     (`duration.expiry` « sourceEnd »), pas au tour du combattant suivant (durée « 1 tour » générique des données).
 * Les jets sont aléatoires : on rejoue jusqu'à rater la sauvegarde ou toucher.
 */
import { RESTORED_KEEP } from "../lib/stages.mjs";

const CHARM ="Compendium.dnd-players-handbook.spells.Item.phbsplCharmMonst";
const BOLT = "Compendium.dnd-players-handbook.spells.Item.phbsplGuidingBol";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "fins et durées — Charme-monstre cesse sur les dégâts du lanceur, marque du Rayon traçant jusqu'à la fin de son tour",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Zombi") ) { ctx.log("pas de Zombi sur la scène : non applicable"); return; }
    // Dans `dnd-6`, la distribution de référence, Zombi compris (à vue du Magicien) ; ailleurs, rien n'est posé.
    await ctx.stage({ ...RESTORED_KEEP, tokens: { ...RESTORED_KEEP.tokens, Zombi: [2800, 4900] } });
    let pcRef = null;
    for ( const t of tokens ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( a?.type === "character" ) { pcRef = t; break; }
    }
    if ( !pcRef ) { ctx.log("aucun personnage joueur sur la scène : non applicable"); return; }
    const caster = await ctx.token(pcRef.name);
    const zombi = await ctx.token("Zombi");
    const hp = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "dead"));
    ctx.restore(() => ctx.removeEffectsNamed(zombi, /charm|Rayon traçant|Guiding/i));
    const charmId = await ctx.ensureItem(caster, CHARM, { system: { method: "atwill" } });
    const boltId = await ctx.ensureItem(caster, BOLT, { system: { method: "atwill" } });
    const charmed = async () => (await ctx.effects(zombi)).filter(e => !e.disabled && /charm/i.test(e.name ?? ""));
    ctx.log(`lanceur : ${caster.name}`);

    // 1. Charme-monstre. Le Zombi reçoit 200 PV le temps du scénario : il doit survivre au Rayon traçant, pour que le charme
    // cesse par les dégâts du lanceur et non par la mort.
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    if ( !tok.actorLink ) {
      const max = tok.delta?.system?.attributes?.hp?.max ?? null;
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 200 } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": max } }));
    }
    await ctx.setHp(zombi, 200);
    let ok = false;
    for ( let i = 0; (i < 12) && !ok; i++ ) {
      const used = await ctx.use({ tokenId: caster.id, itemId: charmId, targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await sleep(800);
      ok = (await charmed()).length > 0;
    }
    if ( !ctx.expect(ok, "Charme-monstre posé sur le Zombi (sauvegarde ratée, 12 essais au plus)") ) return;
    await ctx.engine("hurt", { tokenId: zombi.id, amount: 3 });
    await sleep(1500);
    ctx.expect((await charmed()).length > 0, "3 dégâts d'auteur inconnu : le charme tient");

    // 2. Rayon traçant du lanceur : ses dégâts mettent fin au charme, sa marque dure jusqu'à la fin du prochain tour du lanceur.
    let hit = false;
    for ( let i = 0; (i < 15) && !hit; i++ ) {
      const used = await ctx.use({ tokenId: caster.id, itemId: boltId, targetTokenIds: [zombi.id] });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      hit = !!r?.targets?.[0]?.hit;
    }
    await sleep(2000);
    if ( !ctx.expect(hit, "Rayon traçant : touché (15 essais au plus)") ) return;
    const alive = await ctx.hp(zombi);
    ctx.expect(alive > 0, `le Zombi survit au Rayon traçant (${alive} PV)`);
    ctx.expect((await charmed()).length === 0, "dégâts infligés par le lanceur : le charme cesse");
    const mark = (await ctx.effects(zombi)).find(e => /Rayon traçant|Guiding Bolt/i.test(e.name ?? ""));
    if ( ctx.expect(!!mark, `marque du Rayon traçant posée (${(await ctx.effects(zombi)).map(e => e.name).join(", ")})`) ) {
      const d = mark.duration ?? {};
      // Sans valeur : la durée « 1 tour » générique est remplacée (le cœur range l'unité vide en « seconds »).
      ctx.expect(d.expiry === "sourceEnd" && !d.value,`marque : fin du prochain tour du lanceur (${JSON.stringify(d)})`);
    }
  }
};
