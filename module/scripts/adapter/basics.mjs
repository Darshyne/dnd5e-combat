/**
 * Les items d'actions de base (content/actions.mjs) côté Foundry : les construire, les reconnaître,
 * savoir ce qui manque à un acteur. Un item « feat » à une activité « utilitaire » qui coûte une
 * action : dnd5e le lance comme n'importe quel autre, le moteur en tire l'effet sur le budget
 * (runtime/turn.mjs, `basicAction` du cœur).
 */

import { MODULE_ID } from "../constants.mjs";
import { BASIC_ACTIONS } from "../content/actions.mjs";
import { contentOf } from "./content.mjs";

/** La clé d'action de base d'un item (« dash »…), ou null. */
export function basicActionOf(item) {
  const kind = item?.getFlag?.(MODULE_ID, "basicAction") ?? null;
  return kind && BASIC_ACTIONS[kind] ? kind : null;
}

/**
 * L'action de base que prend une activité : celle de son item d'action de base, sinon celle que le contenu déclare pour elle
 * (`basicActions` : Ruse du Roublard, « Se cacher » par une action Bonus — §20).
 */
export function basicActionOfActivity(activity, chosen=null) {
  if ( !activity?.item ) return null;
  const declared = contentOf(activity.item).entry?.basicActions?.[activity.id] ?? null;
  // §65 : une action au choix (Échappée agile) — celle que l'auteur a choisie à l'utilisation, sinon aucune.
  if ( declared?.choose ) return declared.choose.includes(chosen) ? chosen : null;
  return basicActionOf(activity.item) ?? declared;
}

/** §65 : les actions de base parmi lesquelles l'auteur choisit à l'utilisation de cette activité, ou null. */
export function basicChoiceOf(activity) {
  const declared = activity?.item ? contentOf(activity.item).entry?.basicActions?.[activity.id] : null;
  return Array.isArray(declared?.choose) ? declared.choose : null;
}

/** Attaque à mains nues 2024 : une arme « naturelle », une attaque et la sauvegarde « Lutte / Bousculade ». */
function unarmedStrikeData(def, text) {
  const effectText = key => game.i18n.localize(`DND5ECOMBAT.Action.unarmed.Effet.${key}`);
  const target = { affects: { type: "creature", count: "1" }, prompt: false };
  const effects = Object.entries(def.effects).map(([key, e]) => ({
    _id: e.id, name: effectText(key), img: e.img, transfer: false, disabled: false, showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    statuses: e.status ? [e.status] : [], changes: [],
    flags: e.push ? { [MODULE_ID]: { push: e.push } } : {}
  }));
  return {
    name: text("Nom"),
    type: "weapon",
    img: def.img,
    system: {
      identifier: def.identifier,
      description: { value: `<p>${text("Texte")}</p>` },
      type: { value: "natural", baseItem: "" },
      proficient: 1,
      equipped: false,
      range: { reach: 5, units: "ft" },
      damage: { base: { number: null, denomination: 0, types: ["bludgeoning"], custom: { enabled: true, formula: "1 + @abilities.str.mod" } } },
      activities: {
        [def.activityId]: {
          _id: def.activityId, type: "attack", activation: { type: "action", value: 1 }, target,
          attack: { ability: "str", type: { value: "melee", classification: "unarmed" } },
          damage: { includeBase: true, parts: [] }
        },
        [def.saveActivityId]: {
          _id: def.saveActivityId, type: "save", name: text("Lutte"), activation: { type: "action", value: 1 }, target,
          range: { override: true, units: "touch" },
          effects: effects.map(e => ({ _id: e._id, onSave: false })),
          damage: { parts: [], onSave: "none" },
          save: { ability: ["str", "dex"], dc: { calculation: "str", formula: "" } }
        }
      }
    },
    effects,
    flags: { [MODULE_ID]: { basicAction: "unarmed" } }
  };
}

/** Les données d'item d'une action de base, dans la langue de ce client. */
export function basicActionData(kind) {
  const def = BASIC_ACTIONS[kind];
  const text = key => game.i18n.localize(`DND5ECOMBAT.Action.${kind}.${key}`);
  if ( kind === "unarmed" ) return unarmedStrikeData(def, text);
  return {
    name: text("Nom"),
    type: "feat",
    img: def.img,
    system: {
      identifier: `dnd5e-combat-${kind}`,
      description: { value: `<p>${text("Texte")}</p>` },
      activities: {
        [def.activityId]: { _id: def.activityId, type: "utility", activation: { type: "action", value: 1 }, ...(def.activity ?? {}) }
      }
    },
    flags: { [MODULE_ID]: { basicAction: kind } }
  };
}

/** Les actions de base qu'un acteur n'a pas encore. Une attaque à mains nues de classe (Moine, Barbare) tient lieu de la nôtre. */
export function missingBasicActions(actor) {
  const owned = new Set(actor.items.map(basicActionOf).filter(Boolean));
  const identifiers = new Set(actor.items.map(i => i.system.identifier).filter(Boolean));
  return Object.entries(BASIC_ACTIONS)
    .filter(([kind, def]) => !owned.has(kind) && !(def.identifier && identifiers.has(def.identifier)))
    .map(([kind]) => kind);
}

/** La sauvegarde « Lutte / Bousculade » de l'attaque à mains nues d'un acteur (la nôtre ou celle d'une classe), ou null. */
export function grappleShoveOf(actor) {
  const item = actor?.items.find(i => (i.system.identifier === "unarmed-strike") && (i.type === "weapon"));
  return item?.system.activities?.find(a => a.type === "save") ?? null;
}

/** L'attaque à mains nues d'un acteur, ou null. */
export function unarmedAttackOf(actor) {
  const item = actor?.items.find(i => (i.system.identifier === "unarmed-strike") && (i.type === "weapon"));
  return item?.system.activities?.find(a => a.type === "attack") ?? null;
}

/** L'activité de Soutien (action de base) d'un acteur, ou null. */
export function helpActivityOf(actor) {
  const item = actor?.items.find(i => basicActionOf(i) === "help");
  return item?.system.activities?.contents?.[0] ?? null;
}

/** Une poussée portée par un effet d'activité (« repoussé » de la Bousculade), ou null. */
export function pushOf(effect) {
  return effect?.getFlag?.(MODULE_ID, "push") ?? effect?.flags?.[MODULE_ID]?.push ?? null;
}
