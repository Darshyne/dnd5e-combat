/**
 * #33 : aperçu de l'abri (`api.ui.cover`, pastille au curseur). Lu côté MJ, il doit dire la même chose que le calcul du verdict
 * (`cover`), et en plus : « none » quand il n'y a rien, la source (« creature » pour un Guerrier interposé), l'état d'abri posé
 * à la main (source « manual », que le verdict laisse à dnd5e). Le filtre côté joueur (créatures invisibles non comptées) ne se
 * vérifie pas d'ici : à essayer avec `claude player`.
 */
import { coveringCell } from "./abri.mjs";

export default {
  name: "aperçu de l'abri — sources, état posé à la main, cohérence avec le verdict",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const itemId = await ctx.itemId(sorc.id, "fire-bolt");
    const home = { x: guerrier.x, y: guerrier.y };
    const place = async (x, y) => {
      const moved = await ctx.call("move-token", { tokenId: guerrier.id, x, y });
      if ( !moved?.moved ) throw new Error(`Guerrier non déplacé en ${x},${y}`);
    };
    ctx.restore(() => place(home.x, home.y));
    const preview = () => ctx.engine("coverPreview", { attackerId: sorc.id, targetId: zombi.id, itemId });
    const verdict = () => ctx.engine("cover", { attackerId: sorc.id, targetId: zombi.id, itemId, effective: true });

    // 1. Guerrier à sa place : l'aperçu = le verdict (« none » quand le verdict ne donne rien).
    let p = await preview();
    let v = await verdict();
    ctx.log(`à sa place : aperçu ${p?.degree} (${(p?.sources ?? []).join(", ") || "—"}), verdict ${v?.degree ?? "aucun"}`);
    ctx.expect(!!p && (p.degree === (v?.degree ?? "none")), "aperçu et verdict d'accord");
    if ( p?.degree === "none" ) ctx.expect(p.sources.length === 0, "dégagé : aucune source");

    // 2. Guerrier interposé : abri partiel par créature.
    const size = await ctx.gridSize();
    const { tokens } = await ctx.scene();
    const cell = coveringCell({ sorc, zombi, guerrier, tokens, size });
    if ( cell ) {
      await place(cell.x, cell.y);
      p = await preview();
      v = await verdict();
      ctx.log(`Guerrier interposé : aperçu ${p?.degree} (${(p?.sources ?? []).join(", ")}), verdict ${v?.degree ?? "aucun"}`);
      ctx.expect(p?.degree === (v?.degree ?? "none"), "interposé : aperçu et verdict d'accord");
      ctx.expect((p?.degree === "half") ? p.sources.includes("creature") : (p?.degree !== "none"), "interposé : la créature est citée comme source");
      await place(home.x, home.y);
    }
    else ctx.log("aucune case libre où le Guerrier couvrirait : étape 2 non applicable");

    // 3. Abri posé à la main : rendu tel quel, source « manual » (le verdict le laisse à dnd5e : null).
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "coverThreeQuarters", active: true });
    ctx.restore(() => ctx.call("set-status", { tokenId: zombi.id, statusId: "coverThreeQuarters", active: false }).catch(() => {}));
    await new Promise(r => setTimeout(r, 400));
    p = await preview();
    ctx.expect(p?.manual === true && p.degree === "threeQuarters" && p.bonus === 5 && p.sources[0] === "manual",
      `état posé : abri supérieur +5, posé par le MJ (${JSON.stringify(p)})`);
    ctx.expect(!(await verdict()), "état posé : le verdict n'ajoute rien (dnd5e l'a dans la CA)");
  }
};
