/**
 * Le plan de la fenêtre de réglages « DAS · Core » (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/) : les onglets,
 * les réglages qu'ils rangent et les outils qu'ils ouvrent. Les réglages gardent leur clé et leur enregistrement d'origine — la
 * fenêtre ne fait que les montrer ; un réglage visible qui n'est rangé nulle part tombe dans le dernier onglet (`placeSettings`).
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les onglets, dans l'ordre. `tools` : les fenêtres qu'un bouton de l'onglet ouvre (MJ seulement). */
export const SETTINGS_TABS = Object.freeze([
  { id: "general", icon: "fa-solid fa-dragon", keys: ["automationLevel", "theaterOfMind", "etherealPlane", "provideBasicActions", "autoUsage", "autoTranslate", "realTimeClock", "groupRollSeconds"],
    tools: [{ id: "welcome", icon: "fa-solid fa-dragon" }, { id: "diagnostic", icon: "fa-solid fa-stethoscope" },
      { id: "reports", icon: "fa-solid fa-flag" }] },
  { id: "combat", icon: "fa-solid fa-shield-halved",
    keys: ["heroicInspiration", "cover", "aurasOnlyInCombat", "npcSaveChoice", "legendaryResistance", "portent", "combatWindowSeconds",
      "critMargin", "criticalMode", "criticalTable", "criticalNpc", "masteryRules", "sneakAttackMode", "nonLethalMenu", "endUnaffected"] },
  { id: "movement", icon: "fa-solid fa-shoe-prints",
    keys: ["climbSystem", "climbSystemButton", "altitude", "climbRules", "autoFall", "highJumpMenu", "fireSpread", "volumes", "clickToMove",
      "pathPreview", "teleportPlanning", "lockFailure"] },
  { id: "vision", icon: "fa-solid fa-eye",
    keys: ["vision", "passivePerception", "twilightDarkness", "visionCones", "coneAngles", "stealthRules", "surpriseFromStealth", "factionRules", "factionIcons",
      "lightIndicator"],
    tools: [{ id: "factions", icon: "fa-solid fa-flag" }] },
  { id: "mouse", icon: "fa-solid fa-crosshairs",
    keys: ["clickToAttack", "targetingMode", "fastAttack", "quickRolls", "ammoPrompt", "releaseTargets", "situationalCursor", "targetingBanner",
      "closeSheetOnUse", "hitChance", "hitChancePlayers"] },
  { id: "chat", icon: "fa-solid fa-comments",
    keys: ["chatLight", "chatCompact", "chatPurgeMax", "chatPurgeKeep", "syncAnimations", "animationWait"] },
  // §228 : les textes qui défilent sur les tokens — rythme, puis ce qui s'affiche.
  { id: "float", icon: "fa-solid fa-comment-dots",
    keys: ["feedbackText", "floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons",
      "timerHideSeconds", "floatAttacks", "floatHits", "floatAdvantage", "floatSaves", "floatCover", "floatReactions", "floatStrikes", "floatEffects", "floatResources", "floatPrompts"] },
  { id: "advanced", icon: "fa-solid fa-gears", keys: ["perfWarnMs", "automationBadges"] }
]);

/**
 * Range les réglages visibles dans les onglets : ceux du plan à leur place (dans l'ordre du plan), les autres à la fin du dernier
 * onglet — un réglage ajouté plus tard sans être rangé reste ainsi accessible. Le plan est celui du moteur par défaut, ou celui
 * qu'un module voisin déclare (`api.settings.registerWindow`) ; chaque onglet garde ses autres champs (libellé, outils).
 * @param {string[]} visibleKeys   Les clés des réglages du module déclarés visibles.
 * @param {Array<{id: string, keys: string[]}>} [tabs]
 * @returns {Array<object>}  Les onglets, chacun avec `keys` restreint aux réglages présents et `tools` (vide par défaut).
 */
export function placeSettings(visibleKeys, tabs=SETTINGS_TABS) {
  const present = new Set(visibleKeys);
  const placed = new Set(tabs.flatMap(t => t.keys ?? []));
  const orphans = visibleKeys.filter(k => !placed.has(k));
  return tabs.map((t, i) => ({
    ...t, tools: t.tools ?? [],
    keys: [...(t.keys ?? []).filter(k => present.has(k)), ...((i === tabs.length - 1) ? orphans : [])]
  }));
}

/**
 * Ce qu'un module voisin déclare pour sa fenêtre (`api.settings.registerWindow`) : rend la liste des problèmes (vide = valable).
 * `namespace` : l'id du module ; `tabs` : au moins un onglet, chacun avec un `id` unique et des `keys` (tableau de chaînes) ; chaque
 * outil a un `id` et une fonction `open`.
 */
export function validateWindow(def) {
  const problems = [];
  if ( !def || (typeof def.namespace !== "string") || !def.namespace ) problems.push("namespace: module id expected");
  if ( !Array.isArray(def?.tabs) || !def.tabs.length ) problems.push("tabs: at least one tab expected");
  const ids = new Set();
  for ( const [i, t] of (Array.isArray(def?.tabs) ? def.tabs : []).entries() ) {
    if ( !t?.id || ids.has(t.id) ) problems.push(`tabs[${i}]: unique id expected`);
    ids.add(t?.id);
    if ( !Array.isArray(t?.keys) || t.keys.some(k => typeof k !== "string") ) problems.push(`tabs[${i}].keys: array of setting keys expected`);
    for ( const [j, tool] of (t?.tools ?? []).entries() ) {
      if ( !tool?.id || (typeof tool.open !== "function") ) problems.push(`tabs[${i}].tools[${j}]: id and open() expected`);
    }
  }
  return problems;
}

/** Un réglage correspond-il à la recherche ? Nom et aide, sans casse ni accents. */
export function matchesQuery(query, ...texts) {
  const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = fold(query).trim();
  return !q || fold(texts.join(" ")).includes(q);
}
