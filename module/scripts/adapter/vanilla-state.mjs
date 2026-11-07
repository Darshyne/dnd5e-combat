/**
 * §395 : « Lancer sans DAS » — une action passe par dnd5e seul, comme pendant le Théâtre de l'esprit (§220), mais pour elle seule et
 * tout ce qui en découle jusqu'à sa fin (décision de l'utilisateur, 2026-11-07).
 *
 * Le marqueur est `flags["dnd5e-combat"].vanilla` : posé sur la configuration d'utilisation par l'appelant, recopié sur la carte
 * d'utilisation, l'effet de concentration, les zones et les créatures invoquées (runtime/vanilla.mjs). Ce qui en découle se reconnaît
 * par les liens que dnd5e garde déjà : un jet par la carte d'origine (`system.origin`, `options.originatingMessage`), un effet posé
 * par la carte (`system.origin.message`) ou rattaché à une concentration marquée (`flags.dnd5e.dependentOn`).
 *
 * `flags["dnd5e-combat"].correction` (§396, carte « Correction du MJ ») est sautée par le routeur, elle seule : ce que la correction
 * pose (effets, concentration) redevient l'affaire de DAS.
 *
 * Sans import, comme theater-state.mjs : le routeur le lit à chaque hook. Les globaux (`game`, `fromUuidSync`) ne sont lus qu'à l'appel,
 * et seulement quand un lien est à suivre : le fichier se teste hors de Foundry.
 */

const ID = "dnd5e-combat";

/** Durée pendant laquelle une activité lancée sans DAS marque ce qu'elle crée sur ce client (zone posée, invocation…). */
export const PENDING_MS = 120000;

/** uuid d'activité ou d'objet → échéance (ms). Local au client qui lance : c'est lui qui crée la concentration, la zone, l'invocation. */
const pending = new Map();

/** Note qu'une activité (et son objet) vient d'être lancée sans DAS sur ce client. */
export function markPending(uuids, now=Date.now()) {
  for ( const uuid of uuids ) if ( uuid ) pending.set(uuid, now + PENDING_MS);
}

/** Une utilisation ordinaire de cette activité / de cet objet : ce qu'elle crée redevient l'affaire de DAS. */
export function clearPending(uuids) {
  for ( const uuid of uuids ) pending.delete(uuid);
}

/** Cette activité ou cet objet a-t-il été lancé sans DAS il y a peu, sur ce client ? */
export function isPending(uuid, now=Date.now()) {
  if ( !uuid || !pending.size ) return false;
  const until = pending.get(uuid);
  if ( until === undefined ) return false;
  if ( until < now ) { pending.delete(uuid); return false; }
  return true;
}

/** Vide l'état (tests). */
export function resetVanilla() {
  pending.clear();
}

const flagsOf = x => x?.flags?.[ID] ?? x?._source?.flags?.[ID] ?? null;

/** Le document ou les données portent-ils le marqueur « sans DAS » ? */
export function hasVanillaFlag(x) {
  return !!flagsOf(x)?.vanilla;
}

const lookupMessage = ref => {
  if ( !ref ) return null;
  if ( typeof ref === "object" ) return ref;
  if ( typeof ref !== "string" ) return null;
  const messages = globalThis.game?.messages;
  return messages?.get?.(ref) ?? (ref.includes(".") ? globalThis.fromUuidSync?.(ref, { strict: false }) ?? null : null);
};

const lookupUuid = uuid => ((typeof uuid === "string") ? globalThis.fromUuidSync?.(uuid, { strict: false }) ?? null : null);

/** Ce message, ou la carte dont il découle (un jet de dégâts de la carte d'utilisation), est-il marqué ? */
function messageVanilla(ref) {
  const message = lookupMessage(ref);
  if ( !message ) return false;
  if ( hasVanillaFlag(message) ) return true;
  const origin = message.system?.origin;
  return !!origin && (typeof origin !== "object" || origin.documentName === "ChatMessage") && hasVanillaFlag(lookupMessage(origin));
}

/**
 * Ce document, ces données ou cette configuration viennent-ils d'une action lancée sans DAS ? Suit les liens de dnd5e vers la carte
 * d'origine ou la concentration (un niveau, pas de chaîne).
 */
export function isVanilla(x) {
  if ( !x || (typeof x !== "object") ) return false;
  if ( x[ID]?.vanilla ) return true;                       // configuration d'utilisation
  if ( hasVanillaFlag(x) ) return true;                    // document marqué, données de création
  if ( hasVanillaFlag(x.data) ) return true;               // configuration de message (`data.flags`)
  if ( pending.size && (isPending(x.uuid) || isPending(x.subject?.uuid)) ) return true;   // activité en cours, config de jet
  const system = x.system ?? x.data?.system ?? null;
  const origin = system?.origin;
  if ( origin ) {
    // Jet rattaché à sa carte (attack.mjs:69, damage.mjs:52 : `system.origin` = id du message ; ChatMessage5e le résout en document).
    if ( (typeof origin === "string") || (origin.documentName === "ChatMessage") ) {
      if ( messageVanilla(origin) ) return true;
    }
    // Effet posé par la carte (effect-application.mjs:253 : `system.origin.message`).
    else if ( origin.message && messageVanilla(origin.message) ) return true;
  }
  // Un Roll (basic-roll.mjs:177), les options de applyDamage (chat-message.mjs:502 : le message de dégâts, lui-même issu de la carte).
  const originating = x.options?.originatingMessage ?? x.originatingMessage;
  if ( originating && messageVanilla(originating) ) return true;
  const dependentOn = x.flags?.dnd5e?.dependentOn;   // effet rattaché à une concentration (effect-application.mjs:247)
  if ( dependentOn && hasVanillaFlag(lookupUuid(dependentOn)) ) return true;
  return false;
}

/** Faut-il que le routeur se taise pour ces arguments de hook ? Les quatre premiers, et le premier élément d'une liste (des jets). */
export function concernsVanilla(args) {
  const n = Math.min(args?.length ?? 0, 4);
  for ( let i = 0; i < n; i++ ) {
    const a = args[i];
    if ( Array.isArray(a) ) { if ( a.length && isVanilla(a[0]) ) return true; continue; }
    if ( isVanilla(a) ) return true;
    if ( flagsOf(a)?.correction ) return true;              // §396 : la carte de correction elle-même
  }
  return false;
}
