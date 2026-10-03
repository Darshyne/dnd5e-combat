/**
 * Forme sauvage (SPEC §16.39), lue et écrite dans Foundry. dnd5e 6 fournit la transformation (activité « transform », mode
 * « cr », préréglage `wildshape` : PV, classe, dons, caractéristiques mentales gardés ; PV temporaires ; CA minimale du Cercle
 * de la Lune ; sorts du cercle — config.mjs:3545) et le retour (`Actor5e#revertOriginalForm`). Ce qui manquait, ici :
 *  - les **formes connues** du druide (flag `dnd5e-combat.forms` de l'acteur d'origine : uuids d'acteurs) ;
 *  - la transformation **au lancement**, dans la forme choisie, par le MJ actif (dnd5e ne transforme qu'au bouton de la carte,
 *    les tokens sélectionnés, et `transformInto` crée un acteur — ce qu'un joueur n'a pas toujours le droit de faire) ;
 *  - la **fin** : action Bonus « Reprendre sa forme » (un item posé sur la fiche transformée), durée (moitié du niveau de
 *    druide, en heures), Neutralisé ou 0 PV.
 */

import { MODULE_ID } from "../constants.mjs";
import { INCAPACITATING } from "../core/conditions.mjs";
import { formRefusal, formMustEnd, knownFormsMax } from "../core/wildshape.mjs";
import { expiryTime } from "../core/area.mjs";
import { readTimeFactors } from "./areas.mjs";
import { evalRuleFormula } from "./projectiles.mjs";

/** Une activité de Forme sauvage (ou de Formes du cercle) : transformation « cr » au préréglage `wildshape`. */
export function isWildShape(activity) {
  return (activity?.type === "transform") && (activity.transform?.mode === "cr") && (activity.transform?.preset === "wildshape");
}

/** L'acteur d'origine d'un acteur transformé (lui-même sinon). */
export function originalOf(actor) {
  if ( !actor?.isPolymorphed ) return actor;
  return game.actors.get(actor.getFlag("dnd5e", "originalActor")) ?? actor;
}

/** Le niveau de druide de l'acteur (d'origine). */
function druidLevel(actor) {
  return Number(originalOf(actor)?.classes?.druid?.system?.levels) || 0;
}

/** Les formes connues (uuids) et leur nombre maximal. */
export function knownForms(actor) {
  const original = originalOf(actor);
  return { forms: [...(original?.getFlag(MODULE_ID, "forms") ?? [])], max: knownFormsMax(druidLevel(actor)) };
}

/** Réécrit la liste des formes connues, sur l'acteur d'origine (son joueur le possède). */
export async function setKnownForms(actor, forms) {
  await originalOf(actor)?.setFlag(MODULE_ID, "forms", Array.from(new Set(forms)));
}

/** Ce qu'il faut savoir d'une forme pour la montrer et la juger. */
export async function formInfo(uuid) {
  const actor = await fromUuid(uuid).catch(() => null);
  if ( !actor ) return null;
  const cr = Number(actor.system?.details?.cr);
  return { uuid, name: actor.name, img: actor.img, cr: Number.isFinite(cr) ? cr : null,
    type: actor.system?.details?.type?.value ?? null, fly: Number(actor.system?.attributes?.movement?.fly) || 0 };
}

/** Les limites du profil que l'activité applique à ce niveau (dnd5e : le premier profil disponible). */
export function profileLimits(activity) {
  const profile = activity.availableProfiles?.[0] ?? activity.profiles?.[0];
  if ( !profile ) return { maxCr: null, types: [], noMovement: [] };
  const maxCr = (profile.cr === "") || (profile.cr === null) || (profile.cr === undefined) ? null : evalRuleFormula(String(profile.cr), activity, null);
  // `evalRuleFormula` arrondit à l'entier inférieur : un FP ¼ ou ½ se lit tel quel.
  const exact = Number(profile.cr);
  return { maxCr: Number.isFinite(exact) ? exact : maxCr, types: Array.from(profile.types ?? []), noMovement: Array.from(profile.movement ?? []) };
}

/** La forme est-elle permise par l'activité ? Le motif du refus, ou null. */
export function formRefusedBy(activity, form) {
  return formRefusal(form, profileLimits(activity));
}

/** L'heure du monde où la forme prend fin (« un nombre d'heures égal à la moitié de votre niveau de druide »), ou null. */
export function formExpiry(activity, now=game.time.worldTime) {
  const d = activity.duration ?? {};
  let value = Number(d.value);
  if ( !Number.isFinite(value) ) value = evalRuleFormula(String(d.value ?? ""), activity, NaN);
  return expiryTime(now, { value, units: d.units }, readTimeFactors());
}

/* -------------------------------------------- */
/*  Transformer, revenir (MJ actif)             */
/* -------------------------------------------- */

const REVERT_ACTIVITY = "dnd5eCombatRevrt";

/** L'action « Reprendre sa forme » posée sur une fiche transformée, ou null. */
export function revertActivityOf(actor) {
  const item = actor?.items?.find(i => i.getFlag(MODULE_ID, "revertForm"));
  return item?.system.activities?.get(REVERT_ACTIVITY) ?? item?.system.activities?.contents?.[0] ?? null;
}

/** L'item de l'action Bonus « Reprendre sa forme » (HUD, fiche, menu du clic droit). */
function revertItemData() {
  return {
    name: game.i18n.localize("DND5ECOMBAT.Forme.Reprendre"), type: "feat", img: "icons/magic/nature/wolf-paw-glow-large-green.webp",
    system: {
      description: { value: `<p>${game.i18n.localize("DND5ECOMBAT.Forme.ReprendreAide")}</p>` },
      activities: { [REVERT_ACTIVITY]: { _id: REVERT_ACTIVITY, type: "utility", activation: { type: "bonus", value: 1 },
        range: { units: "self" }, target: { affects: { type: "self" } } } }
    },
    flags: { [MODULE_ID]: { revertForm: true } }
  };
}

/**
 * Transforme l'acteur dans la forme `sourceUuid`, selon les réglages de l'activité — en revenant d'abord à la forme d'origine
 * s'il en porte déjà une (« utiliser Forme sauvage de nouveau » change de forme). MJ actif.
 * @returns {Promise<Actor|null>}  L'acteur transformé.
 */
export async function transformActor(actor, source, activity) {
  let original = actor;
  if ( actor.isPolymorphed ) original = (await actor.revertOriginalForm({ renderSheet: false })) ?? originalOf(actor);
  await original.transformInto(await withConcreteImage(source), activity.settings, { renderSheet: false });
  const shaped = game.actors.filter(a => a.isPolymorphed && (a.getFlag("dnd5e", "originalActor") === original.id))
    .sort((a, b) => (b._stats?.createdTime ?? 0) - (a._stats?.createdTime ?? 0))[0] ?? null;
  if ( !shaped ) return null;
  await shaped.setFlag(MODULE_ID, "wildShape", { item: activity.item?.name ?? null, expiresAt: formExpiry(activity) });
  if ( !revertActivityOf(shaped) ) await shaped.createEmbeddedDocuments("Item", [revertItemData()]);
  return shaped;
}

/**
 * Une créature dont le token prend une image au hasard (`randomImg`, motif `wolf-*.webp` du Manuel des monstres) : dnd5e
 * recopie le motif tel quel dans le token transformé, que le cœur ne sait pas charger (vu en jeu : « Invalid Asset
 * …/wolf-*.webp »). On transforme vers une copie en mémoire (jamais écrite) dont l'image est tirée parmi celles du motif.
 */
async function withConcreteImage(source) {
  const proto = source.prototypeToken;
  const subject = String(proto?.ring?.subject?.texture ?? "");
  if ( !proto?.randomImg && !String(proto?.texture?.src ?? "").includes("*") && !subject.includes("*") ) return source;
  // `getTokenImages` peut rendre le motif lui-même, non résolu (vu en jeu) : on le résout alors comme le cœur, par le
  // navigateur de fichiers.
  let images = [...(await source.getTokenImages().catch(() => []))].filter(i => i && !String(i).includes("*")).sort();
  if ( !images.length && String(proto?.texture?.src ?? "").includes("*") ) images = await wildcardFiles(proto.texture.src);
  const pick = images.length ? Math.floor(Math.random() * images.length) : 0;
  const changes = { "prototypeToken.randomImg": false, "prototypeToken.texture.src": images[pick] ?? source.img };
  // L'anneau dynamique de dnd5e a sa propre image de sujet, en motif lui aussi (`subjects/wolf-*.webp`) : la même variante.
  if ( subject.includes("*") ) {
    const subjects = await wildcardFiles(subject);
    changes["prototypeToken.ring.subject.texture"] = subjects.length ? subjects[pick % subjects.length] : null;
  }
  // `clone` ne développe pas les clés pointées.
  return source.clone(foundry.utils.expandObject(changes), { keepId: true });
}

/** Les fichiers d'un motif (`…/wolf-*.webp`), triés, comme le cœur les liste pour les images de token. */
async function wildcardFiles(path) {
  try {
    const result = await CONFIG.ux.FilePicker.browse("data", path, { wildcard: true });
    return [...(result?.files ?? [])].sort();
  } catch { return []; }
}

/** Revient à la forme d'origine. MJ actif. */
export async function revertForm(actor) {
  if ( !actor?.isPolymorphed ) return null;
  return actor.revertOriginalForm({ renderSheet: false });
}

/** Un acteur en Forme sauvage (posée par le moteur). */
export function isWildShaped(actor) {
  return !!actor?.isPolymorphed && !!actor.getFlag(MODULE_ID, "wildShape");
}

/** La forme de cet acteur doit-elle prendre fin (Neutralisé, 0 PV) ? */
export function formShouldEnd(actor) {
  if ( !isWildShaped(actor) ) return false;
  return formMustEnd({ hp: actor.system?.attributes?.hp?.value, statuses: Array.from(actor.statuses ?? []) }, INCAPACITATING);
}

/** Les acteurs dont la forme a fait son temps. */
export function expiredForms(now=game.time.worldTime) {
  return game.actors.filter(a => {
    const at = isWildShaped(a) ? a.getFlag(MODULE_ID, "wildShape")?.expiresAt : null;
    return Number.isFinite(at) && (at <= now);
  });
}
