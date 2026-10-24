/**
 * §242 (issue #18) : ce que les jets demandés par le MJ lisent de dnd5e — le titre du test, les arguments du jet de dnd5e, le détail
 * des bonus (pour une interface qui les montre en tuiles, à la manière de BG3), et l'état de la carte de demande.
 *
 * La carte est celle de dnd5e (`type: "request"`, data/chat-message/request-message-data.mjs) : une ligne par personnage, son total,
 * réussite ou échec. Chaque jet porte nos flags `groupRollResult` / `groupRollActor` ; le MJ actif le relie à sa ligne
 * (runtime/group-roll.mjs). Le gestionnaire du bouton de la carte est le nôtre (`CONFIG.DND5E.requests`, config.mjs:4778), pour que le
 * joueur qui clique tombe sur la même fenêtre que s'il avait reçu la demande.
 */

import { MODULE_ID } from "../constants.mjs";
import { tally } from "../core/group-roll.mjs";
import { inspirationOf } from "./inspiration.mjs";

export const GROUP_FLAG = "groupRoll";
/** La clé du gestionnaire dans `CONFIG.DND5E.requests` (le champ `handler` de la carte). */
export const GROUP_HANDLER = `${MODULE_ID}.groupRoll`;

const abilityLabel = key => game.i18n.localize(CONFIG.DND5E.abilities?.[key]?.label ?? key ?? "");
const skillLabel = key => game.i18n.localize(CONFIG.DND5E.skills?.[key]?.label ?? key ?? "");
export const toolLabel = key => globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait: "tool" }) ?? key ?? "";

/** La caractéristique du test : celle demandée, sinon celle de la compétence ou de l'outil (sur la fiche, à défaut dans la config). */
export function abilityOf(request, actor=null) {
  if ( (request.type === "check") || (request.type === "save") ) return request.key;
  if ( request.ability ) return request.ability;
  if ( request.type === "skill" ) return actor?.system?.skills?.[request.key]?.ability ?? CONFIG.DND5E.skills?.[request.key]?.ability ?? "";
  return actor?.system?.tools?.[request.key]?.ability ?? CONFIG.DND5E.tools?.[request.key]?.ability ?? "int";
}

/** Le titre du test, dans les mots de dnd5e : « Test de Sagesse (Perspicacité) », « Sauvegarde de Force »… */
export function testTitle(request) {
  const ability = abilityLabel(abilityOf(request));
  switch ( request.type ) {
    case "check": return game.i18n.format("DND5E.AbilityPromptTitle", { ability });
    case "save": return game.i18n.format("DND5E.SavePromptTitle", { ability });
    case "skill": return game.i18n.format("DND5E.SkillPromptTitle", { skill: skillLabel(request.key), ability });
    default: return game.i18n.format("DND5E.ToolPromptTitle", { tool: toolLabel(request.key) });
  }
}

/** Le nom court de ce qu'on lance : la compétence, l'outil ou la caractéristique. */
export function keyLabel(request) {
  if ( request.type === "skill" ) return skillLabel(request.key);
  if ( request.type === "tool" ) return toolLabel(request.key);
  return abilityLabel(request.key);
}

/** L'acteur sait-il faire ce jet ? (un véhicule n'a pas de compétences, un groupe rien) */
export function canRoll(actor, request) {
  if ( !actor?.system?.abilities ) return false;
  return (request.type !== "skill") || !!actor.system.skills;
}

/**
 * Les trois arguments du jet de dnd5e (`config`, `dialog`, `message`) pour un acteur.
 * @param {object} request          La demande normalisée.
 * @param {object} options
 * @param {string} options.requestId  L'id de la carte de demande.
 * @param {Actor} options.actor
 * @param {boolean} [options.showDc]  Le DD entre dans le jet (dnd5e l'affiche) ; non quand il est caché à celui qui lance.
 * @param {{advantage?: boolean, disadvantage?: boolean, mode?: "advantage"|"disadvantage"|null}} [options.extra]  Ce que l'interface
 *   ajoute (Soutien : l'Avantage) ; `mode` force l'Avantage ou le Désavantage, quoi que disent la demande et la fiche.
 * @param {object} [options.flags]  Drapeaux d'autres modules à poser sur le message du jet (jamais ceux du moteur).
 */
export function rollArguments(request, { requestId, actor, showDc=true, extra={}, flags={} }) {
  const config = {};
  if ( (request.type === "check") || (request.type === "save") ) config.ability = request.key;
  else config[request.type] = request.key;
  if ( request.ability && ((request.type === "skill") || (request.type === "tool")) ) config.ability = request.ability;
  if ( (extra.mode === "advantage") || (extra.mode === "disadvantage") ) {
    // Forcé : les deux écrits, pour l'emporter sur la fiche (dnd5e fusionne `config` par-dessus, actor.mjs:1394).
    config.advantage = extra.mode === "advantage";
    config.disadvantage = extra.mode === "disadvantage";
  }
  else {
    let advantage = !!(request.advantage || extra.advantage);
    let disadvantage = !!(request.disadvantage || extra.disadvantage);
    if ( advantage && disadvantage ) advantage = disadvantage = false;
    // Rien d'écrit quand c'est non : dnd5e fusionne `config` par-dessus l'Avantage que la fiche donne (actor.mjs:1394).
    if ( advantage ) config.advantage = true;
    if ( disadvantage ) config.disadvantage = true;
  }
  if ( showDc && (request.dc !== null) ) config.target = request.dc;
  // Les parties d'un jet s'ajoutent à celles de la fiche (`config.parts = [...config.parts, ...parts]`, actor.mjs:1499). Les options du jet
  // le marquent comme jet demandé : les dés « après avoir vu le jet » (Inspiration bardique…) passent alors par la demande, qui les compte
  // (runtime/group-roll.mjs), pas par runtime/roll-bonus.mjs.
  config.rolls = [{ ...(request.bonus ? { parts: [String(request.bonus)] } : {}), options: { [MODULE_ID]: { groupRoll: requestId } } }];
  const flavor = request.label ? `${request.label} — ${testTitle(request)}` : testTitle(request);
  const message = { data: {
    flavor,
    // `flags` : ce qu'une interface ajoute au message du jet (Combat UI : `dice-so-nice.skip`, ses dés remplacent ceux de Dice So Nice).
    // `groupRollPending` : le test n'est pas conclu tant que les dés d'après le jet (Inspiration bardique…) ne sont pas tranchés
    // (runtime/group-roll.mjs `bonusAfterRoll` le lève) — la carte, le verdict du groupe et le suivi du MJ attendent.
    flags: { ...flags, [MODULE_ID]: { groupRollResult: requestId, groupRollActor: actor.uuid, groupRollAids: extra.aids ?? [],
      groupRollForced: extra.mode ?? null, groupRollPending: true } }
  } };
  return [config, message];
}

/**
 * Ce que dnd5e combine pour ce jet : les chemins de la fiche, la catégorie de règles (`check` / `save`) et les données de jet (`roll` rempli
 * comme dnd5e le fait : actor.mjs:1376-1385 compétence/outil, :1600-1605 test/sauvegarde).
 */
function rollContext(actor, request) {
  const ability = abilityOf(request, actor);
  const rollData = actor.getRollData({ roll: true });
  if ( (request.type === "check") || (request.type === "save") ) {
    rollData.roll = { ...(rollData.roll ?? {}), ability, type: "ability" };
    return { category: request.type, rollData, paths: [`abilities.${ability}.${request.type}.roll`, `rolls.ability.${request.type}`] };
  }
  rollData.roll = { ...(rollData.roll ?? {}), ability, [request.type]: request.key, type: request.type };
  return { category: "check", rollData,
    paths: [`abilities.${ability}.check.roll`, "rolls.ability.check", `rolls.ability.${request.type}`, `${request.type}s.${request.key}.roll`] };
}

/**
 * L'Avantage et le Désavantage que dnd5e appliquera de lui-même à ce jet (fiche, effets, états, règles appliquées) — la même combinaison
 * que dnd5e au moment du jet (`D20RollModificationField.combineFields`, data/shared/d20-roll-modification-field.mjs:59 ; chemins et règles
 * comme documents/actor/actor.mjs:1386 pour une compétence ou un outil, :1606 pour un test ou une sauvegarde). Ce que décide une écoute
 * `dnd5e.preRoll…` au moment du jet (une règle du moteur) n'y est pas.
 * @returns {{advantage: boolean, disadvantage: boolean}}
 */
export function systemModeOf(actor, request) {
  const Field = globalThis.dnd5e?.dataModels?.shared?.D20RollModificationField;
  const none = { advantage: false, disadvantage: false };
  if ( !Field || !actor?.system?.abilities ) return none;
  const { paths, category, rollData } = rollContext(actor, request);
  try {
    const { advantage, disadvantage } = Field.combineFields(actor.system, paths, { rules: { category, actor, rollData } });
    return { advantage: !!advantage, disadvantage: !!disadvantage };
  } catch(err) {
    console.warn(`${MODULE_ID} | group roll: system Advantage not read`, err);
    return none;
  }
}

/** La méthode de jet de dnd5e pour ce type. */
export function rollMethodOf(actor, type) {
  const name = { check: "rollAbilityCheck", save: "rollSavingThrow", skill: "rollSkill", tool: "rollToolCheck" }[type];
  return actor?.[name]?.bind(actor) ?? null;
}

/* -------------------------------------------- */
/*  Détail des bonus                            */
/* -------------------------------------------- */

const DICE = /[+-]?\s*\d*d\d+(?:[a-z]+\d*)*/gi;
const signed = n => (n >= 0 ? `+${n}` : `${n}`);
const changesOf = effect => effect.system?.changes ?? effect.changes ?? [];

/** Les chemins de bonus (chaînes de dnd5e 6, avec dés possibles) qui comptent pour ce jet. */
function bonusPaths(request, ability) {
  const check = [`abilities.${ability}.check.roll.bonus`, "rolls.ability.check.bonus"];
  switch ( request.type ) {
    case "save": return [`abilities.${ability}.save.roll.bonus`, "rolls.ability.save.bonus"];
    case "skill": return [`skills.${request.key}.roll.bonus`, ...check, "rolls.ability.skill.bonus"];
    case "tool": return [`tools.${request.key}.roll.bonus`, ...check, "rolls.ability.tool.bonus"];
    default: return check;
  }
}

/**
 * Les clés d'avant dnd5e 6 qu'un effet écrit encore (l'Assistance du PHB : `system.skills.slt.bonuses.check`, vu en jeu le 2026-10-24)
 * et que dnd5e convertit en appliquant l'effet (common.mjs:96 et suivantes).
 */
function legacyPath(path) {
  let m;
  if ( (m = path.match(/^(skills|tools)\.(\w+)\.roll\.bonus$/)) ) return `${m[1]}.${m[2]}.bonuses.check`;
  if ( (m = path.match(/^abilities\.(\w+)\.(check|save)\.roll\.bonus$/)) ) return `abilities.${m[1]}.bonuses.${m[2]}`;
  if ( (m = path.match(/^rolls\.ability\.(\w+)\.bonus$/)) ) return `bonuses.abilities.${m[1]}`;
  return null;
}

/** L'effet actif qui écrit ce chemin, ou null. */
function effectWriting(actor, path) {
  const keys = [`system.${path}`, legacyPath(path) && `system.${legacyPath(path)}`].filter(Boolean);
  for ( const effect of actor.appliedEffects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    if ( changesOf(effect).some(c => keys.includes(String(c.key ?? ""))) ) return effect;
  }
  return null;
}

/** L'image d'un effet pour une tuile : celle de son objet d'origine (le sort d'Assistance), sinon la sienne. */
function effectImage(effect) {
  let origin = null;
  try { origin = effect.origin ? fromUuidSync(effect.origin, { strict: false }) : null; } catch { origin = null; }
  const item = (origin instanceof Item) ? origin : origin?.item ?? origin?.parent;
  return ((item instanceof Item) && item.img) || effect.img || null;
}

/**
 * Le détail de ce qui s'ajoute au d20, lu sur la fiche préparée (effets compris) — pour une interface qui montre une tuile par
 * source, à la manière de BG3. Indicatif : le jet de dnd5e fait foi (une règle appliquée au moment du jet n'y paraît pas).
 * @returns {Array<{kind: "ability"|"proficiency"|"bonus"|"dice"|"exhaustion"|"request"|"inspiration", label: string, value: string,
 *   img?: string, key?: string, reserve?: boolean}>}  `key` : la caractéristique (tuile `ability`) ; `reserve` : un dé qui ne s'ajoute
 *   qu'après un échec, si le joueur le veut (l'Inspiration bardique déjà reçue) — hors du bonus total.
 */
export function breakdownOf(actor, request) {
  const system = actor?.system;
  if ( !system?.abilities ) return [];
  const ability = abilityOf(request, actor);
  const tiles = [];
  const mod = Number(system.abilities[ability]?.mod ?? 0);
  tiles.push({ kind: "ability", key: ability, label: abilityLabel(ability), value: signed(mod) });

  let source = null;
  if ( request.type === "check" ) source = system.abilities[ability]?.check;
  else if ( request.type === "save" ) source = system.abilities[ability]?.save;
  else if ( request.type === "skill" ) source = system.skills?.[request.key];
  else source = system.tools?.[request.key];
  const prof = source?.prof;
  if ( prof && (Number(prof.multiplier) > 0) && (Number(prof.flat) !== 0) ) {
    tiles.push({ kind: "proficiency", label: keyLabel(request), value: signed(Number(prof.flat)), multiplier: Number(prof.multiplier) });
  }
  const numeric = Number(source?.bonus ?? 0);
  if ( numeric ) tiles.push({ kind: "bonus", label: game.i18n.localize("DND5E.Bonus"), value: signed(numeric) });

  for ( const path of bonusPaths(request, ability) ) {
    const raw = String(foundry.utils.getProperty(system, path) ?? "");
    const dice = raw.match(DICE);
    if ( !dice ) continue;
    const effect = effectWriting(actor, path);
    for ( const term of dice ) {
      const value = term.replace(/\s+/g, "");
      tiles.push({ kind: "dice", label: effect?.name ?? game.i18n.localize("DND5E.Bonus"), value: /^[+-]/.test(value) ? value : `+${value}`,
        img: effect ? effectImage(effect) : null });
    }
  }
  // dnd5e 6 : les bonus portés par des « règles appliquées » d'effets (`check:bonus`, `save:bonus`, et `d20:bonus` pour tout Test d20 —
  // documents/applied-rules.mjs:57-62), filtrées par leurs conditions comme au jet (`filterWith`). Leurs parts fixes sont déjà dans le bonus
  // de la fiche (`ruleBonus`, creature.mjs:300) ; leurs dés n'y sont pas — c'est ainsi qu'une Assistance posée par une règle échappait
  // aux tuiles (vu par l'utilisateur le 2026-10-24).
  const Rules = globalThis.dnd5e?.documents?.AppliedRules;
  if ( Rules ) {
    const { category, rollData } = rollContext(actor, request);
    try {
      for ( const rule of Rules.collect(`${category}:bonus`, actor).filterWith(rollData) ) {
        const dice = String(rule.value ?? "").match(DICE);
        for ( const term of dice ?? [] ) {
          const value = term.replace(/\s+/g, "");
          tiles.push({ kind: "dice", label: rule.effect?.name ?? game.i18n.localize("DND5E.Bonus"),
            value: /^[+-]/.test(value) ? value : `+${value}`, img: rule.effect ? effectImage(rule.effect) : null });
        }
      }
    } catch(err) { console.warn(`${MODULE_ID} | group roll: applied rules not read`, err); }
  }
  const reduction = Number(actor.conditionRollReduction ?? 0);
  if ( reduction ) tiles.push({ kind: "exhaustion", label: game.i18n.localize(CONFIG.DND5E.conditionTypes?.exhaustion?.name ?? "Exhaustion"),
    value: signed(reduction) });
  if ( request.bonus ) tiles.push({ kind: "request", label: "", value: signed(request.bonus) });
  // Une Inspiration bardique déjà reçue : elle ne s'ajoute qu'après un échec (PHB 2024), au choix du joueur.
  const inspiration = inspirationOf(actor);
  if ( inspiration ) tiles.push({ kind: "inspiration", label: inspiration.bard, value: `+${inspiration.formula}`, reserve: true,
    img: inspiration.source?.img ?? null });
  return tiles;
}

/* -------------------------------------------- */
/*  La carte                                    */
/* -------------------------------------------- */

/** La demande portée par une carte, ou null. */
export function requestOf(message) {
  return message?.getFlag?.(MODULE_ID, GROUP_FLAG) ?? null;
}

/**
 * L'état d'une carte de demande : chaque personnage (acteur, joueur, total) et le compte (core/group-roll.mjs `tally`).
 * @param {ChatMessage} message
 * @returns {object|null}  `{ id, request, entries: [{actor, uuid, name, img, user, total, status, success, message}], …tally }`.
 */
export function viewOf(message) {
  const request = requestOf(message);
  if ( !request || (message.type !== "request") ) return null;
  const entries = (message.system?.targets ?? []).map(t => {
    const actor = fromUuidSync(t.actor);
    const result = t.result ?? null;
    const roll = result?.rolls?.[0] ?? null;
    // Le dé ajouté après le jet (Inspiration bardique…) compte dans le total (runtime/group-roll.mjs `bonusAfterRoll`).
    const bonus = result?.getFlag?.(MODULE_ID, "groupRollBonus") ?? null;
    // En décision (dé d'Inspiration bardique proposé, pas encore tranché) : pas encore de total, le test attend.
    const deciding = result?.getFlag?.(MODULE_ID, "groupRollPending") === true;
    const total = (Number.isFinite(roll?.total) && !deciding) ? roll.total + (Number(bonus?.total) || 0) : null;
    // Ce que le jet a eu : Avantage / Désavantage (D20Roll#hasAdvantage, dice/d20-roll.mjs), aides accordées, mode forcé.
    return { uuid: t.actor, actor, name: actor?.name ?? "?", img: actor?.img ?? null, user: t.user?.id ?? null, total,
      d20: roll?.d20?.total ?? null, message: result?.id ?? null,
      advantage: !!roll?.hasAdvantage, disadvantage: !!roll?.hasDisadvantage,
      aids: [...(result?.getFlag?.(MODULE_ID, "groupRollAids") ?? []), ...(bonus?.parts ?? []).filter(p => p.helper)],
      forced: result?.getFlag?.(MODULE_ID, "groupRollForced") ?? null, bonus: Number(bonus?.total) || 0, deciding,
      rolled: Number.isFinite(roll?.total) ? roll.total : null,
      by: result?.author?.id ?? null };
  });
  return { id: message.id, request, ...tally(request, entries) };
}
