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

/**
 * §83 : l'arène de test de `dnd-6` — une scène plate, un seul niveau, sans murs, aux dimensions et à la grille de Restored Keep (140 px,
 * 5 ft) : les coordonnées de référence ci-dessus y valent telles quelles. Un seul Zombi. Le lanceur (tools/scenario.mjs) y joue
 * tout scénario qui ne demande pas `scene: "keep"` (étages, planchers, escaliers), et y remet chaque token à sa place avant chacun.
 * Trouvée par son nom ; absente (autre monde), le lanceur joue sur la scène active, comme avant.
 */
export const ARENA = Object.freeze({
  name: "Arène de test",
  tokens: Object.freeze({ ...RESTORED_KEEP.tokens, "Âme-en-peine": [3640, 5460], Zombi: [2800, 4900] })
});

/**
 * L'« Arène des sorts » (2026-10-22, `tools/arene-sorts.mjs`) : scène plate de 40 × 20 cases de 140 px (5 ft), pour les balayages
 * des sorts et des aptitudes. Positions en cases du canevas (coin haut-gauche, marge de la scène comprise). Le Lanceur et l'Allié côte à côte ; la Cible à 4 cases (20 ft,
 * dans toute portée sauf le contact), sa voisine collée à elle, les cibles typées (mort-vivant, Grande, artificielle) à 15 ft au
 * moins de la Cible pour qu'une zone de 10 ft centrée sur elle ne les prenne pas, la Cible lointaine à 150 ft ; l'Ennemi au contact,
 * au-dessus du Lanceur, pour les émanations (Parole radieuse, Esprits gardiens) ; le Héros (un personnage) à l'écart, hors des zones.
 */
export const ARENE_SORTS = Object.freeze({
  name: "Arène des sorts",
  cols: 40, rows: 20, grid: 140,
  tokens: Object.freeze({
    "Lanceur": [5, 10], "Allié": [5, 11], "Héros": [2, 14], "Ennemi au contact": [5, 9], "Cible": [9, 10], "Cible voisine": [10, 10],
    "Mort-vivant": [9, 15], "Grande cible": [14, 4], "Créature artificielle": [9, 4], "Cible lointaine": [35, 10]
  })
});
