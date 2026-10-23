/**
 * Aptitudes passives du relevé des trous (SPEC §235), dans l'Arène des sorts : le Lanceur (PNJ sans classe : le sort prêté porte sa
 * classe, `sourceItem`), le Héros (Barbare pré-tiré : classe, Rage, armes), les Cibles. Chaque partie prête ses items et remet tout.
 *  - Incantation puissante (Druide) : Poussière d'étoile → les dégâts portent « @abilities.wis.mod » ; une dague → pas d'Attaque primitive ;
 *  - Incantation puissante (Clerc) : Flamme sacrée ratée → idem ;
 *  - Chasseur implacable : concentré sur la Marque du chasseur, 30 dégâts → pas de jet de concentration ; sans l'aptitude → un jet ;
 *  - Concentration fanatique : le Héros en Rage rate Éclat mental → relance proposée (réponse « Relancer »), une seule fois par Rage ;
 *  - Sorts psychiques : Décharge occulte → le type « psychique » est proposé, choisi, le jet est psychique ;
 *  - Athlète remarquable : coup critique du Héros (cible Paralysée au contact) à son tour → +moitié de Vitesse, désengagé ;
 *  - Inspiration de combat : le Lanceur inspire le Héros ; son coup → dé aux dégâts (réponse « oui ») ; touché → dé à la CA (Réaction,
 *    `autoReact: "first"`).
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const CLASSES = "Compendium.dnd-players-handbook.classes.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "aptitudes passives du relevé des trous (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Héros", "Cible", "Cible voisine"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, hero, target, other] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [caster, hero, target, other];
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));
    const lent = [];
    const lend = async (t, uuid, system={}) => { const id = await ctx.ensureItem(t, uuid, { system }); lent.push([t, id]); return id; };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const clearEffects = async () => {
      for ( const t of all ) for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const reset = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await unlend();
      await clearEffects();
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const settled = async used => (used?.usageMessageId ? ctx.settle(used.usageMessageId, { timeoutMs: 40000 }).catch(() => null) : null);
    const damageOf = async used => (await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "damage") ?? null;
    const bonusesOf = m => m?.flags?.["dnd5e-combat"]?.bonuses ?? [];
    /** Pendant `action`, répond aux fenêtres du MJ dont le texte correspond, par le premier bouton qui correspond. */
    const answering = async (rules, action) => {
      const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
      const seen = [];
      let done = false;
      const result = action().finally(() => { done = true; });
      for ( let after = 0; after < 6; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1200, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          known.add(d.id);
          const text = `${d.title ?? ""} ${d.content ?? d.text ?? ""}`;
          const rule = rules.find(([re]) => re.test(text));
          const b = rule ? (d.buttons ?? []).find(x => rule[1].test(`${x.action ?? ""} ${x.label ?? ""}`)) : (d.buttons ?? [])[0];
          if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
          seen.push({ text, answered: b?.label ?? b?.action ?? null });
        }
        if ( done ) after++;
      }
      return { result: await result, seen };
    };
    const startFight = async order => {
      await ctx.startCombat(order);
      const s = await ctx.combat();
      const c = s.combat ?? s.combats?.[0] ?? s;
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 10 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; i < 4; i++ ) {
        const now = (await ctx.combat()).combat ?? (await ctx.combat());
        if ( now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId === order[0].id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
    };
    const adjacent = async (t, to) => { const p = await ctx.position(to); await ctx.call("move-token", { tokenId: t.id, x: p.x + grid, y: p.y, elevation: 0 }); await pause(800); };

    await part("Incantation puissante (Druide)", async () => {
      await lend(caster, `${CLASSES}phbdrdElementalF`);
      await lend(caster, `${CLASSES}phbFuryPotentSpe`);
      const wisp = await lend(caster, `${SPELLS}phbsplStarryWisp`, { method: "atwill", sourceItem: "class:druid" });
      let damage = null;
      for ( let n = 1; (n <= 8) && !damage; n++ ) {
        const used = await ctx.use({ tokenId: caster.id, itemId: wisp, activityType: "attack", targetTokenIds: [target.id] });
        const r = await settled(used);
        if ( r?.targets?.[0]?.hit ) damage = await damageOf(used);
      }
      ctx.expect(!!damage, "Druide : Poussière d'étoile touche en 8 essais");
      ctx.expect(bonusesOf(damage).some(b => b.formula === "@abilities.wis.mod"), `Druide : + Sagesse aux dégâts (${JSON.stringify(bonusesOf(damage))})`);
      const dagger = await lend(caster, "Compendium.dnd-players-handbook.equipment.Item.phbwepDagger0000", { equipped: true });
      await adjacent(caster, target);
      let hitDamage = null;
      for ( let n = 1; (n <= 8) && !hitDamage; n++ ) {
        const used = await ctx.use({ tokenId: caster.id, itemId: dagger, activityType: "attack", targetTokenIds: [target.id] });
        const r = await settled(used);
        if ( r?.targets?.[0]?.hit ) hitDamage = await damageOf(used);
      }
      ctx.expect(!!hitDamage && !bonusesOf(hitDamage).some(b => b.damageType === "fire"), `Druide à Incantation puissante : pas d'Attaque primitive à la dague (${JSON.stringify(bonusesOf(hitDamage))})`);
    });

    await part("Incantation puissante (Clerc)", async () => {
      await lend(caster, `${CLASSES}phbclcBlessedStr`);
      await lend(caster, `${CLASSES}phbClcPotentSpel`);
      const flame = await lend(caster, `${SPELLS}phbsplSacredFlam`, { method: "atwill", sourceItem: "class:cleric" });
      let damage = null;
      for ( let n = 1; (n <= 10) && !damage; n++ ) {
        const used = await ctx.use({ tokenId: caster.id, itemId: flame, activityType: "save", targetTokenIds: [target.id] });
        const r = await settled(used);
        if ( r?.targets?.[0]?.save?.success === false ) damage = await damageOf(used);
      }
      ctx.expect(bonusesOf(damage).some(b => b.formula === "@abilities.wis.mod"), `Clerc : + Sagesse aux dégâts de la Flamme sacrée (${JSON.stringify(bonusesOf(damage))})`);
    });

    await part("Chasseur implacable", async () => {
      const mark = await lend(caster, `${SPELLS}phbsplHuntersMar`, { method: "atwill" });
      const relentless = await lend(caster, `${CLASSES}phbrgrRelentless`);
      await settled(await ctx.use({ tokenId: caster.id, itemId: mark, targetTokenIds: [target.id] }));
      await pause(1000);
      const concentrating = async () => (await ctx.effectsFrom(caster, "hunters-mark")).some(e => (e.statuses ?? []).includes("concentrating"));
      ctx.expect(await concentrating(), "Chasseur implacable : concentré sur la Marque du chasseur");
      await ctx.engineLog();
      await ctx.engine("hurt", { tokenId: caster.id, amount: 30, type: "necrotic" });
      await pause(3000);
      const kept = (await ctx.engineLog()).some(l => /concentration kept without a saving throw/.test(l));
      ctx.expect(kept && await concentrating(), "Chasseur implacable : 30 dégâts → concentration gardée, sans jet");
      await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: relentless });
      await pause(800);
      await ctx.engine("hurt", { tokenId: caster.id, amount: 30, type: "necrotic" });
      await pause(4000);
      ctx.expect((await ctx.engineLog()).some(l => /concentration saving throw/.test(l)), "sans Chasseur implacable : un jet de concentration");
    });

    await part("Concentration fanatique", async () => {
      await lend(hero, `${CLASSES}phbbrbFanaticalF`);
      const rage = await ctx.itemId(hero.id, "rage");
      await settled(await ctx.use({ tokenId: hero.id, itemId: rage, targetTokenIds: [hero.id] }));
      await pause(1000);
      ctx.expect((await ctx.effectsFrom(hero, "rage")).length > 0, "Concentration fanatique : le Héros est en Rage");
      const sliver = await lend(caster, `${SPELLS}phbsplMindSliver`, { method: "atwill" });
      let asked = null;
      for ( let n = 1; (n <= 12) && !asked; n++ ) {
        const { result, seen } = await answering([[/une fois par Rage|once per Rage/i, /yes|Relancer|Reroll/i]],
          () => ctx.use({ tokenId: caster.id, itemId: sliver, activityType: "save", targetTokenIds: [hero.id] }));
        await settled(result);
        if ( seen.some(s => /Rage/.test(s.text)) ) asked = seen;
      }
      ctx.expect(!!asked, "Concentration fanatique : relance proposée sur une sauvegarde ratée en Rage");
      const reroll = (await ctx.engineLog()).find(l => /die added to their saving throw/.test(l));
      ctx.expect(!!reroll, `Concentration fanatique : relance jouée (${reroll ?? "rien au journal"})`);
      let again = false;
      for ( let n = 1; (n <= 6) && !again; n++ ) {
        const { result, seen } = await answering([], () => ctx.use({ tokenId: caster.id, itemId: sliver, activityType: "save", targetTokenIds: [hero.id] }));
        await settled(result);
        if ( seen.some(s => /Rage/.test(s.text)) ) again = true;
      }
      ctx.expect(!again, "Concentration fanatique : pas de seconde relance dans la même Rage");
    });

    await part("Sorts psychiques", async () => {
      await lend(caster, `${CLASSES}phbwlkPsychicSpe`);
      const blast = await lend(caster, `${SPELLS}phbsplEldritchBl`, { method: "atwill", sourceItem: "class:warlock" });
      let damage = null;
      let seen = [];
      for ( let n = 1; (n <= 8) && !damage; n++ ) {
        const out = await answering([[/./, /psychic/i]], async () => {
          const used = await ctx.use({ tokenId: caster.id, itemId: blast, activityType: "attack", targetTokenIds: [target.id] });
          const r = await settled(used);
          return r?.targets?.[0]?.hit ? damageOf(used) : null;
        });
        damage = out.result;
        seen = out.seen;
      }
      ctx.expect(!!damage, "Sorts psychiques : Décharge occulte touche en 8 essais");
      ctx.expect(damage?.rolls?.[0]?.options?.type === "psychic", `Sorts psychiques : dégâts psychiques (${damage?.rolls?.map(r => r.options?.type).join(", ")} ; fenêtres : ${seen.map(s => s.answered).join(", ")})`);
    });

    await part("Athlète remarquable", async () => {
      await lend(hero, `${CLASSES}phbftrRemarkable`);
      await adjacent(other, hero);
      await ctx.call("set-status", { tokenId: other.id, statusId: "paralyzed", active: true });
      await startFight([hero, other]);
      const axe = await ctx.itemId(hero.id, "greataxe");
      let crit = false;
      for ( let n = 1; (n <= 6) && !crit; n++ ) {
        const r = await settled(await ctx.use({ tokenId: hero.id, itemId: axe, activityType: "attack", targetTokenIds: [other.id] }));
        crit = r?.targets?.[0]?.critical === true;
      }
      ctx.expect(crit, "Athlète remarquable : coup critique (cible Paralysée au contact)");
      await pause(1500);
      const budget = await ctx.engine("budget", { tokenId: hero.id });
      ctx.expect((budget?.bonusMove > 0) && budget?.disengaged === true, `Athlète remarquable : +${budget?.bonusMove} de déplacement, désengagé (${budget?.disengaged})`);
    });

    await part("Inspiration de combat", async () => {
      const bi = await lend(caster, `${CLASSES}phbbrdBardicInsp`);
      await lend(caster, `${CLASSES}phbbrdCombatInsp`);
      const inspire = async () => { await settled(await ctx.use({ tokenId: caster.id, itemId: bi, targetTokenIds: [hero.id], consume: false })); await pause(1000); };
      const inspired = async () => (await ctx.effectsFrom(hero, "bardic-inspiration")).length > 0;
      await inspire();
      ctx.expect(await inspired(), "Inspiration de combat : le Héros est inspiré");
      // Attaque : le dé aux dégâts d'un coup.
      await adjacent(hero, target);
      const axe = await ctx.itemId(hero.id, "greataxe");
      let offense = null;
      for ( let n = 1; (n <= 8) && !offense; n++ ) {
        const { result, seen } = await answering([[/Inspiration de combat|Combat Inspiration/i, /yes|Lancer|Roll/i]], async () => {
          const used = await ctx.use({ tokenId: hero.id, itemId: axe, activityType: "attack", targetTokenIds: [target.id] });
          await settled(used);
          return used;
        });
        if ( seen.some(s => /Inspiration de combat|Combat Inspiration/i.test(s.text)) ) offense = result;
      }
      ctx.expect(!!offense, "Inspiration de combat : dé proposé aux dégâts d'un coup");
      await pause(1500);
      ctx.expect((await ctx.engineLog()).some(l => /Combat Inspiration: \+\d+ damage/.test(l)) && !(await inspired()),
        "Inspiration de combat : dé ajouté aux dégâts, inspiration dépensée");
      // Défense : touché, la Réaction ajoute le dé à la CA.
      await inspire();
      // Les Cibles de l'arène n'ont aucun item : une dague prêtée.
      const club = await lend(target, "Compendium.dnd-players-handbook.equipment.Item.phbwepDagger0000", { equipped: true });
      let defended = false;
      for ( let n = 1; (n <= 15) && !defended && club; n++ ) {
        await settled(await ctx.use({ tokenId: target.id, itemId: club, activityType: "attack", targetTokenIds: [hero.id],
          usageConfig: { "dnd5e-combat": { confirmed: true, autoReact: "first" } } }));
        await pause(1200);
        defended = (await ctx.engineLog()).some(l => /Combat Inspiration, \+\d+ AC/.test(l));
      }
      ctx.expect(defended && !(await inspired()), "Inspiration de combat : touché → dé ajouté à la CA par la Réaction, inspiration dépensée");
    });
  }
};
