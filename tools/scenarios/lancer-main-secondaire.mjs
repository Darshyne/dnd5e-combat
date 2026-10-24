/**
 * §240 (issue #13) : une arme Légère et de Lancer (la Dague) propose au menu contextuel le lancer de la main secondaire (mode
 * `thrown-offhand` de dnd5e), qui coûte l'action Bonus comme l'attaque de la main secondaire.
 *  1. Au contact du Zombi, en combat, au tour du Magicien : coup de Dague dans l'action Attaquer (`lightAttack`).
 *  2. Le Magicien recule à trois cases : le menu du Zombi offre « Attaquer (main secondaire) » et « Lancer (main secondaire) : Dague »
 *     (une arme équipée qui a ces modes). §241 : l'attaque de base est la Dague ; aucune arme équipée, l'attaque à mains nues.
 *  3. L'entrée jouée : la Dague part en `thrown-offhand`, sans s'approcher ; action Bonus débitée, action inchangée.
 * Remet position, PV, quantité et équipement des armes, dernier mode retenu par dnd5e ; retire les tuiles posées (Dague tombée au sol).
 */
import { readFileSync } from "node:fs";

const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LANGS = ["en", "fr", "pt-BR"].map(l => JSON.parse(readFileSync(new URL(`../../module/lang/${l}.json`, import.meta.url), "utf-8")));
/** Le libellé d'une entrée de menu, dans l'une des langues du module (le client du MJ peut être dans n'importe laquelle). */
const labelsOf = (key, name) => LANGS.map(l => l[`DND5ECOMBAT.Menu.${key}`]?.replace("{name}", name)).filter(Boolean);

export default {
  name: "lancer de la main secondaire — au menu, action Bonus",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const size = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    await ctx.setHp(zombi, 15);   // deux coups de Dague (1d4 + 3 au plus chacun) ne le tuent pas : pas de mort en pleine résolution

    const daggerId = await ctx.itemId(mage.id, "dagger");
    const dagger = () => ctx.call("get-actor", { actorId: mage.actorId }).then(a => (a.items ?? []).find(i => i._id === daggerId));
    const d0 = await dagger();
    if ( !d0?.system?.properties?.includes?.("thr") || !d0.system.properties.includes("lgt") ) { ctx.log("Dague sans Légère + Lancer : non applicable"); return; }
    const setDagger = itemData => ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "_id", value: daggerId } });
    // dnd5e retient le dernier mode d'attaque de l'item (`flags.dnd5e.last`) : on le rend, comme la quantité.
    ctx.restore(async () => {
      const last = (await dagger())?.flags?.dnd5e?.last ?? {};
      const reset = Object.fromEntries(Object.entries(last).filter(([, v]) => /offhand|thrown/.test(v?.attackMode ?? ""))
        .map(([k]) => [`flags.dnd5e.last.${k}.attackMode`, "oneHanded"]));
      await setDagger({ "system.quantity": d0.system.quantity ?? 1, "system.equipped": d0.system.equipped === true, ...reset }).catch(() => {});
    });
    // Équipée (le menu ne propose que les armes en main), deux exemplaires : celle qu'on lance part.
    await setDagger({ "system.quantity": 2, "system.equipped": true });

    const tiles = async () => ((await ctx.call("list-scene-objects", { types: ["Tile"] })).objects?.Tile ?? []).map(t => t.id);
    const tiles0 = new Set(await tiles());
    ctx.restore(async () => {
      for ( const id of (await tiles()).filter(id => !tiles0.has(id)) ) await ctx.call("delete-scene-object", { type: "Tile", objectId: id }).catch(() => {});
    });

    const home = { x: mage.x, y: mage.y };
    const moveMage = async (x, y) => {
      const r = await ctx.call("move-token", { tokenId: mage.id, x, y });
      if ( !r?.moved ) throw new Error(`Magicien non déplacé en ${x},${y}`);
      await sleep(500);
    };
    ctx.restore(() => moveMage(home.x, home.y));
    await moveMage(zombi.x + size, zombi.y);

    await ctx.startCombat([mage, zombi]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === mage.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }

    /** La dépense consignée par le MJ sur la carte d'utilisation. */
    async function spentOn(usageMessageId, accept=() => true) {
      for ( const until = Date.now() + 8000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent && accept(spent) ) return spent;
      }
      return null;
    }

    // 1. Coup de Dague au contact, dans l'action Attaquer.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "oneHanded" } });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    const s1 = await spentOn(stab.usageMessageId);
    ctx.expect(s1?.after?.lightAttack === true, `Dague au contact : attaque d'arme Légère consignée (lightAttack ${s1?.after?.lightAttack})`);

    // 2. Trois cases plus loin : le menu.
    const far = { x: zombi.x + (3 * size), y: zombi.y };
    await moveMage(far.x, far.y);
    const name = d0.name;
    const { labels } = await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id });
    ctx.log(`menu du Zombi : ${labels.join(" | ")}`);
    const offThrow = labels.find(l => labelsOf("LancerMainSecondaire", name).includes(l));
    ctx.expect(!!offThrow, `« Lancer (main secondaire) : ${name} » au menu`);
    ctx.expect(labels.some(l => labelsOf("Lancer", name).includes(l)) && labels.some(l => labelsOf("MainSecondaire", name).includes(l)),
      "le lancer et la main secondaire y restent");
    if ( !offThrow ) return;

    // §241 : sans arme équipée, l'attaque de base est l'attaque à mains nues (les autres armes déséquipées le temps de la lecture).
    const armed = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [])
      .filter(i => (i.type === "weapon") && i.system?.equipped && (i.system.identifier !== "unarmed-strike"));
    ctx.expect((await ctx.engine("reachCheck", { tokenId: mage.id, targetId: zombi.id })).weapon === name, `attaque de base : la Dague équipée`);
    for ( const i of armed ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": false }, match: { path: "_id", value: i._id } });
    const unarmed = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i.system?.identifier === "unarmed-strike");
    const empty = await ctx.engine("reachCheck", { tokenId: mage.id, targetId: zombi.id });
    for ( const i of armed ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": true }, match: { path: "_id", value: i._id } });
    ctx.expect(!!unarmed && (empty.weapon === unarmed.name), `aucune arme équipée : attaque de base à mains nues (${empty.weapon})`);

    // 3. L'entrée jouée.
    const since = await ctx.lastMessageId();
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id, run: offThrow });
    // Une fenêtre de jet de dnd5e, si l'attaque rapide est coupée dans ce monde : jet normal.
    const dialog = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 3000 }).catch(() => null);
    for ( const w of dialog?.windows ?? [] ) await ctx.call("answer-dialog", { id: w.id, button: "normal" }).catch(() => {});
    let usage = null;
    for ( const until = Date.now() + 15000; !usage && (Date.now() < until); await sleep(500) ) {
      usage = (await ctx.messagesSince(since)).find(m => (m.flags?.[MODULE_ID]?.spent ?? m.flags?.spent)?.offhand === true) ?? null;
    }
    const spent = usage?.flags?.[MODULE_ID]?.spent ?? usage?.flags?.spent;
    ctx.expect(!!spent, "lancer de la main secondaire : dépense consignée en main secondaire");
    ctx.expect(spent?.after?.bonus === 0 && spent?.after?.action === spent?.before?.action,
      `action Bonus ${spent?.before?.bonus} → ${spent?.after?.bonus}, action inchangée (${spent?.before?.action} → ${spent?.after?.action})`);
    const pos = await ctx.position(mage);
    ctx.expect((pos.x === far.x) && (pos.y === far.y), `sans s'approcher (${pos.x},${pos.y})`);
    const mode = Object.values((await dagger())?.flags?.dnd5e?.last ?? {}).map(v => v?.attackMode).find(Boolean);
    ctx.expect(mode === "thrown-offhand", `mode retenu par dnd5e : ${mode}`);
    if ( usage ) await ctx.settle(usage.id).catch(() => null);
  }
};
