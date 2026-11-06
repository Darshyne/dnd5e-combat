/**
 * #33 : le texte de l'aperçu de l'abri (adapter/cover-preview.mjs), pur — la traduction est passée en argument.
 * Une ligne principale (« Dégagé », « Abri partiel +2 CA », « Abri total — bloqué », « Abri partiel ignoré (Tireur d'élite) »)
 * et une ligne de source (« par : obstacle, créature »), sans détail que le joueur ne connaîtrait pas : des catégories, et le
 * nom d'un sort de zone visible sur la scène.
 */

/** L'ordre d'affichage des sources. */
const ORDER = ["manual", "wall", "surface", "creature", "grapple", "zone"];

/**
 * @param {import("../adapter/cover-preview.mjs").CoverPreview} preview
 * @param {(key: string, data?: object) => string} t   Traduction d'une clé `Apercu.*` (sans l'espace de noms).
 * @returns {{css: string, main: string, sub: string|null}|null}
 */
export function coverPreviewText(preview, t) {
  if ( !preview ) return null;
  if ( preview.ignored ) {
    return { css: "ignored", main: t("Apercu.Ignore", { cover: t(`Apercu.Nom.${preview.ignored.degree}`), by: preview.ignored.by }), sub: null };
  }
  if ( preview.degree === "none" ) return { css: "clear", main: t("Apercu.Degage"), sub: null };
  const main = (preview.bonus === null) ? t("Apercu.Total") : t("Apercu.Bonus", { cover: t(`Apercu.Nom.${preview.degree}`), bonus: preview.bonus });
  const sources = [...new Set(preview.sources ?? [])]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .map(s => ((s === "zone") && preview.zone) ? preview.zone : t(`Apercu.Source.${s}`));
  return { css: preview.degree, main, sub: sources.length ? t("Apercu.Par", { sources: sources.join(", ") }) : null };
}
