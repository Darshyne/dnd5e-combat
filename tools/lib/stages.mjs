/**
 * Distributions de scène : où se tiennent les tokens qu'un scénario suppose en place. Un scénario qui place ses cibles par
 * rapport à d'autres tokens (« le Bandit trois cases au-dessus du Magicien ») ne tient que si ceux-ci sont là où il a été
 * écrit ; `ctx.stage(…)` (tools/scenario.mjs) pose la distribution au début du scénario et remet chaque token où il était
 * à la fin — l'utilisateur peut laisser les tokens de son monde où il veut entre deux passes (SPEC §40.6).
 *
 * `scene` : identifiant de la scène (ailleurs, rien n'est posé) ; `level` : niveau de la scène où se joue la distribution ;
 * `tokens` : nom → [x, y], coin haut-gauche du token, en pixels, élévation 0. Un token absent de la scène est ignoré.
 */

/**
 * Restored Keep (`dnd-6`), rez-de-chaussée : les « positions de référence » relevées au SPEC §11, celles avec lesquelles les
 * scénarios ont été écrits. Les Zombis et l'Âme-en-peine n'en sont pas : aucun scénario ne place ses cibles par rapport à eux.
 */
export const RESTORED_KEEP = Object.freeze({
  scene: "rklRestoredKeepC",
  level: "rcWKCTvbgKJhN2DV",
  tokens: Object.freeze({
    Magicien: [3080, 4760], Paladin: [3220, 5460], Guerrier: [2800, 5180], Roublard: [3080, 5600], Mage: [3360, 4480],
    Occultiste: [3500, 4760], Bandit: [2940, 4620], Clerc: [3640, 4900], Ensorceleur: [3500, 5600], Moine: [2940, 5740],
    Druide: [3080, 5740], "Rôdeur": [3220, 5740], Barde: [3360, 5740]
  })
});
