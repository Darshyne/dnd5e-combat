/**
 * §181 : les factions au jeu — réglages, table du cœur tenue à jour, disposition déduite, rancunes, API.
 *
 * - La table du cœur (`core/factions.mjs`) est rechargée au chargement du canevas, au changement du réglage et quand les rancunes
 *   de la scène affichée changent ; hook `dnd5e-combat.factionsChanged` ensuite (les auras se recalculent).
 * - **Disposition déduite** (MJ actif) : seule une relation **explicite** d'une faction avec les PJ (`party`) pose la disposition de
 *   ses tokens (hostile → Hostile, neutre → Neutre, alliée → Amical), à la création du token, à l'affectation et au changement de
 *   la matrice. Sans relation explicite, la disposition reste au MJ.
 * - **Rancune** (MJ actif, sortie de résolution d'une attaque) : attaquer une créature dont la faction n'est pas hostile à la vôtre,
 *   **d'après une relation explicite de la matrice**, rend les deux factions hostiles sur cette scène (flag `grudges`). Sans
 *   relation explicite, rien ne change : c'est ce qui garde un monde sans factions tel qu'il était.
 */

import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";
import { pairKey, normalizeFactions, suggestedRelations, dispositionFor, factionRelation, RELATIONS } from "../core/factions.mjs";
import {
  FACTIONS_SETTING, RULES_SETTING, NONE, PARTY, defaultFactions, refreshFactionTable, factionSettings, factionOf, sideOf,
  relationBetween, factionName, explicitFaction
} from "../adapter/factions.mjs";


/** Recharger la table et prévenir (auras, voisins). */
function changed(scene=canvas?.scene ?? null) {
  refreshFactionTable(scene);
  Hooks.callAll(`${MODULE_ID}.factionsChanged`, { scene });
}

/* -------------------------------------------- */
/*  Réglage                                      */
/* -------------------------------------------- */

/** Écrire le réglage (MJ) : normalisé, puis dispositions resynchronisées. */
export async function saveFactions(value) {
  const before = factionSettings();
  const next = normalizeFactions(value);
  await game.settings.set(MODULE_ID, FACTIONS_SETTING, next);
  const touched = next.factions.map(f => f.id)
    .filter(id => (before.relations[pairKey(id, PARTY)] ?? null) !== (next.relations[pairKey(id, PARTY)] ?? null));
  if ( touched.length ) await syncDispositions({ factions: touched });
  return next;
}

/** Ajouter une faction (id tiré du nom). Rend son id. */
export async function addFaction({ name, color }={}) {
  const current = factionSettings();
  const base = (name ?? "faction").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40) || "faction";
  let id = base;
  for ( let n = 2; current.factions.some(f => f.id === id); n++ ) id = `${base}-${n}`;
  await saveFactions({ ...current, factions: [...current.factions, { id, name: name ?? id, color: color ?? "#888888", rules: {} }] });
  return id;
}

/** Retirer une faction : ses relations partent avec elle ; les flags qui la nomment sont ignorés (faction inconnue). */
export async function removeFaction(id) {
  if ( id === PARTY ) return false;
  const current = factionSettings();
  await saveFactions({ ...current, factions: current.factions.filter(f => f.id !== id) });
  return true;
}

/** Poser une relation (`null` : suivre la disposition). */
export async function setRelation(a, b, relation) {
  if ( a === b ) return;
  const current = factionSettings();
  const relations = { ...current.relations };
  if ( RELATIONS.includes(relation) ) relations[pairKey(a, b)] = relation;
  else delete relations[pairKey(a, b)];
  await saveFactions({ ...current, relations });
}

/** Les relations suggérées, sous celles déjà posées. */
export async function applySuggested() {
  const current = factionSettings();
  await saveFactions({ ...current, relations: { ...suggestedRelations(current.factions), ...current.relations } });
}

/* -------------------------------------------- */
/*  Affectation                                  */
/* -------------------------------------------- */

const docOf = t => t?.document ?? t ?? null;

/**
 * Affecter des tokens (ou des acteurs) à une faction ; `null` : retirer l'affectation (retour aux règles), `"none"` : aucune
 * faction. Un acteur : vaut pour tous ses tokens qui n'en ont pas une à eux.
 */
export async function assignFaction(documents, id) {
  const list = (Array.isArray(documents) ? documents : [documents]).map(docOf).filter(Boolean);
  for ( const d of list ) {
    if ( (id === null) || (id === undefined) ) await d.unsetFlag(MODULE_ID, "faction");
    else await d.setFlag(MODULE_ID, "faction", id);
  }
  // Un acteur affecté : ses tokens qui portaient leur propre faction gardent la leur ; on resynchronise tout ce qui en dépend.
  await syncDispositions({ documents: list });
  changed();
  return list.length;
}

/* -------------------------------------------- */
/*  Disposition déduite                          */
/* -------------------------------------------- */

/** Les tokens à remettre d'aplomb : ceux des factions touchées, ou ceux de ces documents (tokens, ou tokens de ces acteurs). */
async function syncDispositions({ factions=null, documents=null }={}) {
  if ( !game.user.isGM ) return;
  refreshFactionTable();
  const actors = new Set((documents ?? []).filter(d => d.documentName === "Actor"));
  const tokens = new Set((documents ?? []).filter(d => d.documentName === "Token"));
  for ( const scene of game.scenes ) {
    const updates = [];
    for ( const token of scene.tokens ) {
      const concerned = factions ? factions.includes(factionOf(token))
        : (tokens.has(token) || actors.has(token.baseActor) || actors.has(token.actor));
      if ( !concerned || token.getFlag(MODULE_ID, "stance") ) continue;
      const wanted = dispositionFor(factionOf(token));
      if ( (wanted !== null) && (wanted !== token.disposition) ) updates.push({ _id: token.id, disposition: wanted });
    }
    if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, { [MODULE_ID]: { faction: true } });
  }
}

/** Un token posé : la disposition que sa faction impose, si elle en impose une. */
function onPreCreateToken(token, data) {
  const wanted = dispositionFor(factionOf(token));
  if ( (wanted !== null) && (wanted !== token.disposition) ) token.updateSource({ disposition: wanted });
}

/* -------------------------------------------- */
/*  Rancunes                                     */
/* -------------------------------------------- */

/** Rendre deux camps hostiles sur une scène (ids de faction ou uuid de token) ; `clear` : lever cette rancune (ou toutes). */
export async function grudge(scene, a, b, { clear=false }={}) {
  if ( !scene ) return [];
  let list = (scene.getFlag(MODULE_ID, "grudges") ?? []).filter(g => Array.isArray(g) && (g.length === 2));
  const same = ([x, y]) => ((x === a) && (y === b)) || ((x === b) && (y === a));
  if ( clear ) list = (a && b) ? list.filter(g => !same(g)) : [];
  else if ( a && b && (a !== b) && !list.some(same) ) list = [...list, [a, b]];
  else return list;
  await scene.setFlag(MODULE_ID, "grudges", list);
  return list;
}

/** Sortie de résolution d'une attaque : la victime d'une faction non hostile (relation explicite) en garde rancune. */
async function onResolution(resolution) {
  if ( !resolution?.plan?.attack ) return;
  const scene = canvas.scene;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const attacker = source?.isToken ? source.token : source?.getActiveTokens?.(false, true)?.find(t => t.parent === scene)?.document;
  if ( !attacker || (attacker.parent !== scene) ) return;
  const a = sideOf(attacker);
  for ( const t of resolution.targets ?? [] ) {
    const target = fromUuidSync(t.token ?? "", { strict: false });
    if ( !target || (target === attacker) || (target.parent !== scene) ) continue;
    const b = sideOf(target);
    if ( !a.faction || !b.faction || (a.faction === b.faction) ) continue;
    const relation = factionRelation(a, b);
    if ( !relation || (relation === "hostile") ) continue;
    await grudge(scene, a.faction, b.faction);
    log(`factions: ${a.faction} attacked ${b.faction} — grudge on this scene`);
    // Une rancune envers les PJ : la disposition des tokens de la victime suit, sur cette scène.
    const other = a.faction === PARTY ? b.faction : (b.faction === PARTY ? a.faction : null);
    if ( other ) {
      const updates = scene.tokens.filter(tok => (factionOf(tok) === other) && !tok.getFlag(MODULE_ID, "stance") && (tok.disposition !== -1))
        .map(tok => ({ _id: tok.id, disposition: -1 }));
      if ( updates.length ) await scene.updateEmbeddedDocuments("Token", updates, { [MODULE_ID]: { faction: true } });
    }
  }
}

/* -------------------------------------------- */
/*  API et inscription                           */
/* -------------------------------------------- */

/** `api.factions` (§181) : lecture pour tous, écriture pour le MJ. */
export const factionsApi = Object.freeze({
  of: token => factionOf(token),
  explicit: token => explicitFaction(token),
  relation: (a, b) => relationBetween(a, b),
  side: token => sideOf(token),
  list: () => factionSettings().factions.map(f => ({ ...f, label: factionName(f) })),
  relations: () => ({ ...factionSettings().relations }),
  name: id => factionName(factionSettings().factions.find(f => f.id === id)),
  assign: (documents, id) => assignFaction(documents, id),
  setRelation, add: addFaction, remove: removeFaction, suggest: applySuggested,
  grudge: (a, b, { clear=false, scene=canvas?.scene }={}) => grudge(scene, a, b, { clear }),
  grudges: (scene=canvas?.scene) => scene?.getFlag(MODULE_ID, "grudges") ?? [],
  /** Poser ou lever l'attitude d'un token (`"neutral"` : rendu, l'ennemi de personne hors de sa faction). */
  stance: async (token, stance=null) => {
    const d = docOf(token);
    if ( stance ) await d.setFlag(MODULE_ID, "stance", stance);
    else await d.unsetFlag(MODULE_ID, "stance");
    changed();
  },
  NONE, PARTY
});

export function registerFactions() {
  game.settings.register(MODULE_ID, FACTIONS_SETTING, {
    scope: "world", config: false, type: Object, default: defaultFactions(),
    onChange: () => changed()
  });
  game.settings.register(MODULE_ID, RULES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${RULES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true, onChange: () => changed()
  });
  refreshFactionTable(null);
  const label = { label: "factions: table refreshed" };
  route("ready", () => changed(), label);
  route("canvasReady", canvas => changed(canvas.scene), label);
  route("updateScene", (scene, changes) => {
    if ( (scene === canvas?.scene) && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) changed(scene);
  }, label);
  route("preCreateToken", onPreCreateToken, { label: "factions: disposition from faction" });
  route(`${MODULE_ID}.resolution`, onResolution, { executor: true, label: "factions: grudge not recorded" });
}
