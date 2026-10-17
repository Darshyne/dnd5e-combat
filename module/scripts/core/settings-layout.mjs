/**
 * Le plan de la fenêtre de réglages « DAS · Core » (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/) : les onglets,
 * les réglages qu'ils rangent et les outils qu'ils ouvrent. Les réglages gardent leur clé et leur enregistrement d'origine — la
 * fenêtre ne fait que les montrer ; un réglage visible qui n'est rangé nulle part tombe dans le dernier onglet (`placeSettings`).
 *
 * Pur : aucune dépendance à Foundry.
 */

/** Les onglets, dans l'ordre. `tools` : les fenêtres qu'un bouton de l'onglet ouvre (MJ seulement). */
export const SETTINGS_TABS = Object.freeze([
  { id: "general", icon: "fa-solid fa-dragon", keys: ["automationLevel", "provideBasicActions", "autoUsage"],
    tools: [{ id: "welcome", icon: "fa-solid fa-dragon" }, { id: "diagnostic", icon: "fa-solid fa-stethoscope" },
      { id: "reports", icon: "fa-solid fa-flag" }] },
  { id: "combat", icon: "fa-solid fa-shield-halved",
    keys: ["cover", "aurasOnlyInCombat", "npcSaveChoice", "legendaryResistance", "portent", "combatWindowSeconds"] },
  { id: "movement", icon: "fa-solid fa-shoe-prints",
    keys: ["altitude", "volumes", "faceMovement", "clickToMove", "pathPreview", "teleportPlanning"] },
  { id: "vision", icon: "fa-solid fa-eye",
    keys: ["vision", "passivePerception", "twilightDarkness", "visionCones", "coneAngles", "stealthRules", "factionRules", "factionIcons",
      "lightIndicator"],
    tools: [{ id: "factions", icon: "fa-solid fa-flag" }] },
  { id: "mouse", icon: "fa-solid fa-crosshairs",
    keys: ["clickToAttack", "targetingMode", "fastAttack", "quickRolls", "releaseTargets", "situationalCursor", "targetingBanner",
      "closeSheetOnUse", "hitChance", "hitChancePlayers"] },
  { id: "chat", icon: "fa-solid fa-comments",
    keys: ["chatLight", "chatCompact", "chatPurgeMax", "chatPurgeKeep", "syncAnimations", "animationWait", "feedbackText"] },
  { id: "advanced", icon: "fa-solid fa-gears", keys: ["perfWarnMs", "automationBadges"] }
]);

/**
 * Range les réglages visibles dans les onglets : ceux du plan à leur place (dans l'ordre du plan), les autres à la fin du dernier
 * onglet — un réglage ajouté plus tard sans être rangé reste ainsi accessible.
 * @param {string[]} visibleKeys   Les clés des réglages du module déclarés visibles.
 * @returns {Array<{id: string, icon: string, keys: string[], tools: object[]}>}
 */
export function placeSettings(visibleKeys) {
  const present = new Set(visibleKeys);
  const placed = new Set(SETTINGS_TABS.flatMap(t => t.keys));
  const orphans = visibleKeys.filter(k => !placed.has(k));
  return SETTINGS_TABS.map((t, i) => ({
    id: t.id, icon: t.icon, tools: t.tools ?? [],
    keys: [...t.keys.filter(k => present.has(k)), ...((i === SETTINGS_TABS.length - 1) ? orphans : [])]
  }));
}

/** Un réglage correspond-il à la recherche ? Nom et aide, sans casse ni accents. */
export function matchesQuery(query, ...texts) {
  const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = fold(query).trim();
  return !q || fold(texts.join(" ")).includes(q);
}
