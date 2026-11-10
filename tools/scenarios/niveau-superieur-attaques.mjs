/**
 * §404 : sorts d'attaque lancés avec un emplacement de niveau supérieur — joués dans l'« Arène des sorts ». Chaque sort est lancé deux
 * niveaux au-dessus du sien par le Lanceur sur la Cible (999 PV) ; au premier coup qui touche, la formule des dégâts doit avoir les
 * dés « Using a Higher-Level Spell Slot » (deux de plus). La Flèche acide de Melf : aussi sur un raté (la moitié des dégâts), et
 * l'effet « Lingering Acid » posé au toucher garde la montée (`flags.dnd5e.scaling`, que lisent ses dégâts de fin de tour).
 * `SORTS=<identifiant,…>` ne joue que ceux-là.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const MODULE_ID = "dnd5e-combat";
const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.SORTS ?? "").split(",").map(s => s.trim()).filter(Boolean);

// [identifiant, id PHB, niveau du sort, dés de base (nombre, faces)]
const SPELLS = [
  ["chromatic-orb", "phbsplChromaticO", 1, 3, 8],
  ["guiding-bolt", "phbsplGuidingBol", 1, 4, 6],
  ["ray-of-sickness", "phbsplRayofSickn", 1, 2, 8],
  ["witch-bolt", "phbsplWitchBolt0", 1, 2, 12],
  ["melfs-acid-arrow", "phbsplMelfsAcidA", 2, 4, 4],
  ["vampiric-touch", "phbsplVampiricTo", 3, 3, 6]
];
const UP = 2;

export default {
  name: "sorts d'attaque lancés à un niveau supérieur — dés en plus (§404)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const hp0 = await ctx.hp(target);
    const ids = SPELLS.map(s => s[0]);
    ctx.restore(async () => {
      await ctx.removeEffectsFrom(target, ...ids);
      await ctx.removeEffectsFrom(caster, ...ids);
      await ctx.setHp(target, hp0);
    });

    /** La formule du premier jet d'un message de dégâts. */
    const formulaOf = async id => {
      const m = (await ctx.call("list-chat-messages", { limit: 60 })).messages?.find(x => x.id === id);
      const raw = m?.rolls?.[0];
      const roll = (typeof raw === "string") ? JSON.parse(raw) : raw;
      return roll?.formula ?? null;
    };

    for ( const [identifier, phbId, level, number, faces] of SPELLS ) {
      if ( only.length && !only.includes(identifier) ) continue;
      await ctx.ensureItem(caster, PHB(phbId));
      const cast = level + UP;
      const want = `${number + UP}d${faces}`;
      // Un critique double les dés (`8d4` pour une Flèche à 4d4) : le compte attendu, ou son double.
      const diceOk = formula => {
        const m = /^(\d+)d(\d+)/.exec(formula ?? "");
        return !!m && (Number(m[2]) === faces) && [number + UP, 2 * (number + UP)].includes(Number(m[1]));
      };
      const needMiss = identifier === "melfs-acid-arrow";
      const seen = {};
      for ( let n = 1; (n <= 20) && !(seen.hit && (!needMiss || seen.miss)); n++ ) {
        await ctx.setHp(target, 999);
        await ctx.removeEffectsFrom(target, identifier);
        await ctx.removeEffectsFrom(caster, identifier);
        const used = await ctx.use({ tokenId: caster.id, identifier, activityType: "attack", consume: false, targetTokenIds: [target.id],
          usageConfig: { scaling: UP, spell: { slot: `spell${cast}` }, [MODULE_ID]: { damageType: "acid" } } });
        const r = used?.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 60000 }).catch(() => null) : null;
        if ( !r?.damageRoll?.messageId ) continue;
        const key = r.targets?.[0]?.hit ? "hit" : "miss";
        if ( seen[key] ) continue;
        seen[key] = await formulaOf(r.damageRoll.messageId);
        if ( (key === "hit") && needMiss ) {
          await pause(1000);
          const lingering = (await ctx.effects(target)).find(e => (e._id === "NgglkyjzTbDh5Loa") || /Lingering Acid|Acide persistant/i.test(e.name ?? ""));
          ctx.expect(Number(lingering?.flags?.dnd5e?.scaling) === UP,
            `Flèche acide niveau ${cast} : « Lingering Acid » garde la montée (scaling ${lingering?.flags?.dnd5e?.scaling ?? "absent"})`);
        }
      }
      ctx.expect(!!seen.hit, `${identifier} : un coup au but en 20 essais`);
      if ( seen.hit ) ctx.expect(diceOk(seen.hit), `${identifier} niveau ${cast}, touché : ${seen.hit} (attendu ${want})`);
      if ( needMiss ) {
        ctx.expect(!!seen.miss, `${identifier} : un raté en 20 essais`);
        if ( seen.miss ) ctx.expect(diceOk(seen.miss), `${identifier} niveau ${cast}, raté : ${seen.miss} (moitié de ${want})`);
      }
    }
  }
};
