/**
 * §203–§204 : reprendre la traduction actuelle des compendiums (Babele, langue de ce client) pour un objet ou un acteur du monde
 * qui en vient et dont des textes sont restés dans la langue d'origine. Servi au diagnostic (« Textes restés dans la langue
 * d'origine », runtime/diagnostic/checks.mjs) et à la création (runtime/auto-translate.mjs). Les règles sont dans core/localize.mjs :
 * un champ n'est repris que s'il vaut encore exactement l'original ; identifiants et ids d'activités et d'effets ne changent pas.
 */
import { retranslateItem, retranslateActor } from "../core/localize.mjs";

/** La source de compendium d'un document (`_stats.compendiumSource`, sinon l'ancien `flags.core.sourceId`). */
export const sourceOf = doc => doc?._stats?.compendiumSource ?? doc?.flags?.core?.sourceId ?? null;

/** Un lecteur de références traduites, avec son cache : rend le document du compendium s'il porte la charge d'origine de Babele. */
export function referenceReader() {
  const cache = new Map();
  return async uuid => {
    if ( !uuid?.startsWith?.("Compendium.") ) return null;
    if ( !cache.has(uuid) ) cache.set(uuid, await fromUuid(uuid).catch(() => null));
    const doc = cache.get(uuid);
    return doc?.flags?.babele?.originalPayload ? doc : null;
  };
}

/** L'acteur de base d'un objet (celui d'un token non lié : son acteur du monde). */
function baseActor(item) {
  const actor = item.parent;
  if ( actor?.documentName !== "Actor" ) return null;
  return actor.isToken ? (game.actors.get(actor.token?.actorId) ?? null) : actor;
}

/**
 * Ce qu'il faut réécrire dans ce document. `fields` vide : rien. La référence d'un objet est celui de même id dans la créature
 * traduite dont vient sa fiche, sinon sa propre source.
 * @param {Item|Actor} doc
 * @param {Function} [reference]  Un lecteur (`referenceReader()`), partagé pour profiter du cache.
 * @returns {Promise<{ update: object, effects: object[], fields: string[] }>}
 */
export async function retranslationOf(doc, reference=referenceReader()) {
  const none = { update: {}, effects: [], fields: [] };
  if ( !game.babele || !doc ) return none;
  if ( doc.documentName === "Actor" ) {
    const ref = await reference(sourceOf(doc));
    if ( !ref ) return none;
    return { effects: [], ...retranslateActor(doc.toObject(), ref.flags.babele.originalPayload, ref.toObject()) };
  }
  const refActor = await reference(sourceOf(baseActor(doc)));
  let ref = refActor?.items?.get(doc.id) ?? null;
  if ( !ref?.flags?.babele?.originalPayload ) ref = await reference(sourceOf(doc));
  if ( !ref ) return none;
  return retranslateItem(doc.toObject(), ref.flags.babele.originalPayload, ref.toObject());
}

/**
 * Applique ce que `retranslationOf` a trouvé. Un document sans identifiant enregistré tient le sien de son nom (dnd5e,
 * documents/mixins/document.mjs:33) : le traduire changerait l'identifiant par lequel le moteur et dnd5e le reconnaissent. Celui
 * d'avant est figé avant de renommer.
 */
export async function applyRetranslation(doc, { update, effects }) {
  const data = { ...update };
  if ( ("name" in data) && !doc._source?.system?.identifier && doc.identifier ) data["system.identifier"] = doc.identifier;
  if ( Object.keys(data).length ) await doc.update(data);
  if ( effects?.length ) await doc.updateEmbeddedDocuments("ActiveEffect", effects);
}
