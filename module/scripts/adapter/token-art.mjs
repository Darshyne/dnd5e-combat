/**
 * Image fixe d'un token pour une balise `<img>` (2026-11-13) : une texture de token peut être une vidéo (`.webm` de JB2A posé par
 * DAS · Animations sur une invocation, ou par un MJ), qu'une `<img>` montre cassée. Pour une vidéo : sa vignette si le cœur l'a déjà
 * calculée (`game.video.thumbs`, client/helpers/media/video-helper.mjs:190), sinon l'image de l'acteur, sinon l'icône par défaut.
 * Même test que le cœur (`VideoHelper.hasVideoExtension`, video-helper.mjs:100).
 * @param {TokenDocument|Token} token
 * @param {string|null} [fallback]   image à préférer à celle de l'acteur
 * @returns {string}
 */
export function tokenArt(token, fallback = null) {
  const doc = token?.document ?? token;
  const src = doc?.texture?.src ?? "";
  const video = foundry.helpers.media.VideoHelper;
  if ( !video.hasVideoExtension(src) ) return src || fallback || doc?.actor?.img || "";
  const still = [game.video?.thumbs?.get(src), fallback, doc?.actor?.img].find(s => s && !video.hasVideoExtension(s));
  return still ?? CONST.DEFAULT_TOKEN;
}
