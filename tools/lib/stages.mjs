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

/**
 * Issue #32 : l'« Arène du succès à un prix » (`tools/arene-prix.mjs`) — scène plate de 12 × 8 cases de 140 px (5 ft). Le Héros (le
 * Guerrier pré-tiré du Manuel : un personnage joueur, le seul à qui l'aide s'applique par défaut) au contact du Mannequin (999 PV,
 * CA 15) ; le Lanceur (PNJ sans item, Flamme sacrée prêtée par le scénario) à 4 cases du Héros, pour la sauvegarde. Positions en cases.
 */
export const ARENE_PRIX = Object.freeze({
  name: "Arène du succès à un prix",
  cols: 12, rows: 8, grid: 140,
  tokens: Object.freeze({ "Héros du prix": [4, 4], "Mannequin": [5, 4], "Lanceur du prix": [4, 8] })
});

/**
 * §393 : l'« Arène des invocations » (`tools/arene-invocations.mjs`) — scène plate de 20 × 12 cases de 140 px (5 ft), pour ce que le
 * balayage des invocations ne peut pas tester dans l'Arène des sorts : ce qui vise une créature ou un objet. Le Lanceur (PNJ sans item,
 * emplacements 9 partout) ; à 2 cases le Cadavre (roturier mort : un humanoïde Moyen que darsh-loot sait relever — Doigt de mort,
 * Animation des morts sur un corps) et la Bête morte (loup mort : pas un humanoïde, refusée) ; le Héros (Barbare pré-tiré, porteur
 * d'armes : Arme élémentaire, enchantements) au contact du Lanceur ; la Victime (1 PV) à 4 cases. Les cases à droite restent libres
 * pour les créatures invoquées. Positions en cases.
 */
export const ARENE_INVOCATIONS = Object.freeze({
  name: "Arène des invocations",
  cols: 20, rows: 12, grid: 140,
  tokens: Object.freeze({ "Lanceur": [4, 6], "Héros": [4, 7], "Cadavre": [6, 6], "Bête morte": [6, 8], "Victime": [8, 5] }),
  // Morts par construction : le lanceur de scénarios ne les relève pas (`standUpDowned`).
  corpses: Object.freeze(["Cadavre", "Bête morte"])
});

/**
 * Issue #42 : l'« Arène de la vision » (`tools/arene-vision.mjs`) — scène plate de 40 × 12 cases de 140 px (5 ft), en pleine lumière,
 * pour juger qui voit qui (règles) et ce que montre l'écran d'un joueur. Les observateurs (possédés par `claude player`) à gauche :
 * l'Humain (Druide pré-tiré, aucune vision dans le noir), l'Occultiste du diable (Occultiste pré-tiré, gnome, + Vision du diable et
 * Ténèbres), le Rôdeur elfe (vision dans le noir 60 ft), la Vision véritable (120 ft) ; la Vision aveugle (30 ft) à 25 ft de la Cible
 * dans les ténèbres, au centre des Ténèbres que pose le scénario (sphère de 15 ft) ; la Cible derrière les ténèbres, éclairée, de l'autre
 * côté ; les observateurs ajoutés ensuite (Vibrations 60 ft, Sens tout et Voir l'invisible à 120 ft, modes du cœur posés sur le token) ;
 * la Cible dans le noir (obscurité ordinaire posée par le scénario), la Cible invisible (état Invisible, en pleine lumière) ; la Cible
 * au loin, éclairée, en haut à gauche, qu'aucune ligne de vue ne fait passer par les Ténèbres (témoin). Positions en cases
 * du canevas : la marge de la scène (10 % : 4 colonnes, 2 lignes) est exclue de la vision par le cœur (`visibility.mjs`, `inBuffer`) —
 * un observateur posé dedans ne voit rien de la scène.
 */
export const ARENE_VISION = Object.freeze({
  name: "Arène de la vision",
  cols: 40, rows: 12, grid: 140,
  tokens: Object.freeze({
    "Humain": [6, 6], "Occultiste du diable": [6, 8], "Rôdeur elfe": [6, 10], "Vision véritable": [6, 12], "Vision aveugle": [12, 8],
    "Vibrations": [12, 12], "Sens tout": [6, 4], "Voir l'invisible": [6, 2],
    "Cible dans les ténèbres": [17, 8], "Cible derrière les ténèbres": [23, 8], "Cible au loin": [10, 2],
    "Cible dans le noir": [14, 3], "Cible invisible": [10, 4]
  }),
  // La cible au centre des Ténèbres que pose le scénario `vision-tenebres`.
  darknessOn: "Cible dans les ténèbres",
  // L'obscurité ordinaire (région « Ajuster l'obscurité », sans sort) que pose le scénario autour de la Cible dans le noir : cases
  // [x, y, largeur, hauteur], loin des observateurs et des Ténèbres.
  dark: Object.freeze([13, 2, 4, 3])
});

/**
 * Issue #44 (§408) : l'« Arène des refus » (`tools/arene-refus.mjs`) — scène plate de 36 × 10 cases de 140 px (5 ft), pour les refus du
 * contrôle de légalité et leur passage outre. Les pré-tirés niveau 1 du Manuel, personnages joueurs (`claude player` en est
 * propriétaire) : le Mage (bâton équipé, Rayon de givre 60 ft, Détection de la magie en rituel), le Clerc (masse et bouclier équipés,
 * amulette sacrée : les deux mains prises), le Guerrier (épée à deux mains). Le Mannequin (999 PV) au contact du Mage ; la Cible lointaine
 * à 31 cases (155 ft), hors de toute portée de sort mineur. Positions en cases du canevas, marge comprise (4 cases à gauche, 1 en haut).
 */
export const ARENE_REFUS = Object.freeze({
  name: "Arène des refus",
  cols: 36, rows: 10, grid: 140,
  tokens: Object.freeze({ "Mage des refus": [6, 5], "Clerc des refus": [6, 7], "Guerrier des refus": [6, 3], "Mannequin des refus": [7, 5],
    "Cible lointaine des refus": [37, 5] })
});
