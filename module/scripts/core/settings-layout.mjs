/**
 * Le plan de la fenêtre de réglages « DAS · Core » (2026-10-18, maquette validée par l'utilisateur : prive/maquettes/) : les onglets,
 * les réglages qu'ils rangent et les outils qu'ils ouvrent. Les réglages gardent leur clé et leur enregistrement d'origine — la
 * fenêtre ne fait que les montrer ; un réglage visible qui n'est rangé nulle part tombe dans le dernier onglet (`placeSettings`).
 *
 * Pur : aucune dépendance à Foundry.
 */

/**
 * Un groupe de réglages d'une même règle (demande de l'utilisateur, 2026-11-06, maquette validée : un cadre par règle, toujours ouvert,
 * les options d'une règle décalées sous elle et grisées tant que la règle est éteinte). `tag` : une étiquette discrète à droite du titre
 * (`house` : règle maison, `dmg` : aide du Guide du maître) ; `sub` : clé → `{ parent, off }`, l'option grisée quand la valeur de
 * `parent` est l'une de `off`. Libellé : `DND5ECOMBAT.Reglages.Groupe.<id>`.
 */
const g = (id, icon, keys, { tag=null, sub={} }={}) => ({ id, icon, keys, ...(tag ? { tag } : {}), sub });
const offIf = (parent, ...off) => ({ parent, off });

/** Les onglets, dans l'ordre. `tools` : les fenêtres qu'un bouton de l'onglet ouvre (MJ seulement) ; `groups` : les cadres. */
export const SETTINGS_TABS = Object.freeze([
  { id: "general", icon: "fa-solid fa-dragon", keys: ["automationLevel", "theaterOfMind", "etherealPlane", "provideBasicActions", "autoUsage", "autoTranslate", "dataFixes", "realTimeClock", "groupRollSeconds", "sidebarButton"],
    groups: [
      g("automation", "fa-solid fa-gauge", ["automationLevel", "theaterOfMind", "autoUsage", "provideBasicActions"]),
      g("ethereal", "fa-solid fa-ghost", ["etherealPlane"]),
      g("data", "fa-solid fa-language", ["autoTranslate", "dataFixes"]),
      g("time", "fa-solid fa-clock", ["realTimeClock"]),
      g("groupRoll", "fa-solid fa-dice-d20", ["groupRollSeconds"]),
      g("interface", "fa-solid fa-window-maximize", ["sidebarButton"])
    ],
    tools: [{ id: "welcome", icon: "fa-solid fa-dragon" }, { id: "diagnostic", icon: "fa-solid fa-stethoscope" },
      { id: "reports", icon: "fa-solid fa-flag" }] },
  { id: "combat", icon: "fa-solid fa-shield-halved",
    keys: ["heroicInspiration", "cover", "flanking", "flankingSide", "flankingConga", "aurasOnlyInCombat", "npcSaveChoice", "legendaryResistance", "portent", "combatWindowUnlimited", "combatWindowSeconds",
      "critMargin", "criticalMode", "criticalTable", "criticalNpc", "successAtCost", "successAtCostHold", "masteryRules", "sneakAttackMode", "nonLethalMenu", "endUnaffected"],
    groups: [
      g("combatGeneral", "fa-solid fa-shield-halved", ["aurasOnlyInCombat", "endUnaffected", "combatWindowUnlimited", "combatWindowSeconds"],
        { sub: { combatWindowSeconds: offIf("combatWindowUnlimited", true) } }),
      g("cover", "fa-solid fa-block-brick", ["cover"]),
      g("flanking", "fa-solid fa-people-arrows", ["flanking", "flankingSide", "flankingConga"],
        { tag: "house", sub: { flankingSide: offIf("flanking", "off"), flankingConga: offIf("flanking", "off") } }),
      g("gmCreatures", "fa-solid fa-crown", ["npcSaveChoice", "legendaryResistance"]),
      g("criticals", "fa-solid fa-burst", ["critMargin", "criticalMode", "criticalTable", "criticalNpc"],
        { tag: "house", sub: { criticalTable: offIf("criticalMode", "standard"), criticalNpc: offIf("criticalMode", "standard") } }),
      g("successAtCost", "fa-solid fa-scale-balanced", ["successAtCost", "successAtCostHold"],
        { tag: "dmg", sub: { successAtCostHold: offIf("successAtCost", false) } }),
      g("weapons", "fa-solid fa-khanda", ["masteryRules", "sneakAttackMode", "nonLethalMenu"]),
      g("rollAids", "fa-solid fa-star", ["portent", "heroicInspiration"])
    ] },
  { id: "movement", icon: "fa-solid fa-shoe-prints",
    keys: ["climbSystem", "climbSystemButton", "altitude", "climbRules", "autoFall", "highJumpMenu", "fireSpread", "volumes", "clickToMove",
      "pathPreview", "teleportPlanning", "lockFailure"],
    groups: [
      g("climb", "fa-solid fa-person-hiking", ["climbSystem", "climbSystemButton", "climbRules", "autoFall", "highJumpMenu"],
        { sub: { climbRules: offIf("climbSystem", false), autoFall: offIf("climbSystem", false), highJumpMenu: offIf("climbSystem", false) } }),
      g("height", "fa-solid fa-arrows-up-down", ["altitude", "volumes"]),
      g("mouseMove", "fa-solid fa-route", ["clickToMove", "pathPreview", "teleportPlanning"]),
      g("fire", "fa-solid fa-fire", ["fireSpread"], { tag: "house" }),
      g("doors", "fa-solid fa-door-closed", ["lockFailure"])
    ] },
  { id: "vision", icon: "fa-solid fa-eye",
    keys: ["vision", "passivePerception", "twilightDarkness", "visionCones", "coneAngles", "stealthRules", "surpriseFromStealth", "factionRules", "factionIcons",
      "lightIndicator"],
    groups: [
      g("sight", "fa-solid fa-eye", ["vision", "passivePerception", "twilightDarkness", "lightIndicator"]),
      g("cones", "fa-solid fa-binoculars", ["visionCones", "coneAngles"], { sub: { coneAngles: offIf("visionCones", false) } }),
      g("stealth", "fa-solid fa-user-ninja", ["stealthRules", "surpriseFromStealth"]),
      g("factions", "fa-solid fa-flag", ["factionRules", "factionIcons"])
    ],
    tools: [{ id: "factions", icon: "fa-solid fa-flag" }] },
  { id: "mouse", icon: "fa-solid fa-crosshairs",
    keys: ["clickToAttack", "targetingMode", "fastAttack", "quickRolls", "ammoPrompt", "releaseTargets", "situationalCursor", "targetingBanner",
      "closeSheetOnUse", "hitChance", "hitChancePlayers", "coverPreview", "attackLine"],
    groups: [
      g("clickAttack", "fa-solid fa-hand-pointer", ["clickToAttack", "fastAttack", "quickRolls", "ammoPrompt"]),
      g("targeting", "fa-solid fa-crosshairs", ["targetingMode", "releaseTargets", "targetingBanner", "situationalCursor"]),
      g("hitChance", "fa-solid fa-percent", ["hitChance", "hitChancePlayers", "coverPreview", "attackLine"]),
      g("sheet", "fa-solid fa-id-card", ["closeSheetOnUse"])
    ] },
  { id: "chat", icon: "fa-solid fa-comments",
    keys: ["chatLight", "chatCompact", "chatPurgeMax", "chatPurgeKeep", "syncAnimations", "animationWait", "gmAlerts", "gmAlertBanner", "gmAlertSeconds"],
    groups: [
      g("cards", "fa-solid fa-message", ["chatLight", "chatCompact"]),
      g("purge", "fa-solid fa-broom", ["chatPurgeMax", "chatPurgeKeep"]),
      g("animations", "fa-solid fa-wand-sparkles", ["syncAnimations", "animationWait"], { sub: { animationWait: offIf("syncAnimations", false) } }),
      g("gmAlerts", "fa-solid fa-triangle-exclamation", ["gmAlerts", "gmAlertBanner", "gmAlertSeconds"],
        { sub: { gmAlertBanner: offIf("gmAlerts", false), gmAlertSeconds: offIf("gmAlertBanner", false) } })
    ] },
  // §228 : les textes qui défilent sur les tokens — rythme, puis ce qui s'affiche.
  { id: "float", icon: "fa-solid fa-comment-dots",
    keys: ["feedbackText", "floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons",
      "timerHideSeconds", "floatAttacks", "floatHits", "floatAdvantage", "floatSaves", "floatChecks", "floatCover", "floatReactions", "floatStrikes", "floatEffects", "floatResources", "floatPrompts"],
    groups: [
      g("floatLook", "fa-solid fa-sliders", ["feedbackText", "floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons"],
        { sub: Object.fromEntries(["floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons"]
          .map(k => [k, offIf("feedbackText", false)])) }),
      g("floatWhat", "fa-solid fa-list-check", ["floatAttacks", "floatHits", "floatAdvantage", "floatSaves", "floatChecks", "floatCover", "floatReactions",
        "floatStrikes", "floatEffects", "floatResources", "floatPrompts"]),
      g("timers", "fa-solid fa-gear", ["timerHideSeconds"])
    ] },
  { id: "advanced", icon: "fa-solid fa-gears", keys: ["perfWarnMs", "automationBadges"] }
]);

/**
 * Les cadres d'un onglet pour ces réglages (déjà filtrés : présents, visibles, d'une portée) : chaque groupe avec ses clés présentes, dans
 * l'ordre du groupe ; ce qu'aucun groupe ne range, dans un dernier cadre `other`. Un onglet sans `groups` : un seul cadre sans titre
 * (`id: null`), comme avant. Les cadres vides sont omis.
 * @param {string[]} keys
 * @param {Array<{id: string, keys: string[]}>|undefined} groups
 * @returns {Array<{id: string|null, icon?: string, tag?: string, sub: object, keys: string[]}>}
 */
export function groupSettings(keys, groups) {
  if ( !groups?.length ) return keys.length ? [{ id: null, sub: {}, keys: [...keys] }] : [];
  const present = new Set(keys);
  const placed = new Set();
  const out = [];
  for ( const group of groups ) {
    const own = (group.keys ?? []).filter(k => present.has(k) && !placed.has(k));
    own.forEach(k => placed.add(k));
    if ( own.length ) out.push({ ...group, sub: group.sub ?? {}, keys: own });
  }
  const rest = keys.filter(k => !placed.has(k));
  if ( rest.length ) out.push({ id: "other", icon: "fa-solid fa-ellipsis", sub: {}, keys: rest });
  return out;
}

/**
 * Une option d'une règle : `{ sub, off }` — `sub` : elle se range sous sa règle (sa règle est dans le même cadre, avant elle) ; `off` :
 * grisée, la règle étant éteinte (`valueOf(parent)` vaut l'une des valeurs `off`). Une option dont la règle a elle-même été éteinte
 * plus haut est éteinte aussi.
 * @param {string} key
 * @param {{keys: string[], sub: object}} group
 * @param {(key: string) => any} valueOf  La valeur en vigueur (en attente d'enregistrement comprise).
 */
export function subState(key, group, valueOf, seen=new Set()) {
  const rule = group?.sub?.[key];
  if ( !rule || seen.has(key) ) return { sub: false, off: false };
  seen.add(key);
  const above = group.keys.indexOf(rule.parent);
  const sub = (above >= 0) && (above < group.keys.indexOf(key));
  const off = (rule.off ?? []).some(v => Object.is(v, valueOf(rule.parent)))
    || subState(rule.parent, group, valueOf, seen).off;
  return { sub, off };
}

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
    // 2026-11-06 : des cadres par règle, facultatifs — chacun un `id` et des `keys` ; `sub` : clé → `{ parent, off: [...] }`.
    if ( (t?.groups !== undefined) && !Array.isArray(t.groups) ) problems.push(`tabs[${i}].groups: array expected`);
    for ( const [j, group] of (Array.isArray(t?.groups) ? t.groups : []).entries() ) {
      if ( !group?.id || !Array.isArray(group.keys) ) problems.push(`tabs[${i}].groups[${j}]: id and keys expected`);
      for ( const [key, rule] of Object.entries(group?.sub ?? {}) ) {
        if ( !rule?.parent || !Array.isArray(rule.off) ) problems.push(`tabs[${i}].groups[${j}].sub.${key}: parent and off[] expected`);
      }
    }
    for ( const [j, tool] of (t?.tools ?? []).entries() ) {
      if ( !tool?.id || (typeof tool.open !== "function") ) problems.push(`tabs[${i}].tools[${j}]: id and open() expected`);
    }
  }
  // §291 : l'onglet du module dans la rangée du haut — `end` (à droite, après les autres), `kind: "workshop"` (un atelier : des outils
  // en cartes), `icon`.
  const tab = def?.tab;
  if ( (tab !== undefined) && ((typeof tab !== "object") || (tab === null)) ) problems.push("tab: object expected");
  else if ( tab?.kind && !["settings", "workshop"].includes(tab.kind) ) problems.push("tab.kind: \"settings\" or \"workshop\" expected");
  return problems;
}

/** Un réglage correspond-il à la recherche ? Nom et aide, sans casse ni accents. */
export function matchesQuery(query, ...texts) {
  const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = fold(query).trim();
  return !q || fold(texts.join(" ")).includes(q);
}

/**
 * §291 : un module de la suite se reconnaît à son titre public, « DAS · … » (décision de l'utilisateur, 2026-10-05) — le moteur ne
 * nomme aucun voisin. Le point médian peut être entouré d'espaces quelconques.
 */
export function isSuiteTitle(title) {
  return /^DAS\s*·\s*\S/.test(String(title ?? ""));
}

/** Le nom court d'un module de la suite, pour son onglet : « DAS · Combat UI » → « Combat UI ». */
export function shortTitle(title) {
  return String(title ?? "").replace(/^DAS\s*·\s*/, "").trim() || String(title ?? "");
}

/**
 * Les onglets de modules dans l'ordre : le moteur d'abord, puis par nom, et à la fin ceux qui le demandent (`end` : un atelier).
 * `modules` : `[{ id, title, end? }]`.
 */
export function orderModules(modules, coreId) {
  return [...modules].sort((a, b) => ((b.id === coreId) - (a.id === coreId)) || ((!!a.end) - (!!b.end))
    || String(a.title).localeCompare(String(b.title)));
}
