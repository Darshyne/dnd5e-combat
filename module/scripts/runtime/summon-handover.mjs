/**
 * §118 : une invocation lancée SUR des cibles, reprise par un module voisin. *Animation des morts* (PHB 2024) est une activité
 * « summon » (profils Squelette / Zombi) qui vise un cadavre ; *Doigt de mort* en a une seconde, « Relever un zombi ». dnd5e
 * poserait une créature neuve à côté ; un module qui sait transformer la cible elle-même (un cadavre relevé à sa place) le dit ici.
 *
 * Sur le client qui lance, à `dnd5e.preUseActivity` (après la visée : les cibles sont désignées), le moteur appelle
 * `Hooks.callAll("dnd5e-combat.summonOnTargets", takers, { activity, caster, targets })`. Un module qui s'en charge pousse dans
 * `takers` une fonction `async ({ profile }) => boolean` (le profil choisi dans la fenêtre de dnd5e, `activity.profiles[]`) —
 * vrai : il s'en est chargé (fait, ou refusé avec son propre message). S'il y en a une, la pose de dnd5e est sautée
 * (`dnd5e.preSummon`, documents/activity/summon.mjs:138, annulé) ; à `dnd5e.postUseActivity` (mixin.mjs:307 : emplacement dépensé, carte publiée) les preneurs sont appelés dans l'ordre,
 * le premier qui répond vrai l'emporte. Si aucun n'aboutit (erreur ou faux), la pose ordinaire de dnd5e est relancée
 * (`placeSummons`), si ce client a le droit d'invoquer. La reprise ne dépend pas de ce droit (`canSummon`, summon.mjs:54 : création
 * de tokens + « Allow Summoning ») : un voisin peut faire faire l'invocation par le MJ. Le moteur ne nomme aucun module (même forme
 * que `dropItems`, adapter/orders.mjs).
 */
import { MODULE_ID } from "../constants.mjs";
import { route } from "./router.mjs";

/**
 * Les invocations reprises en cours, par uuid d'activité (l'activité remise à l'échelle garde son id) : `{ takers, at }`. Une
 * utilisation annulée après la demande (légalité, fenêtre fermée) n'arrive jamais à `postUseActivity` : passé ce délai, la reprise
 * est oubliée et le bouton « Invoquer » de la carte pose de nouveau normalement.
 */
const claimed = new Map();
const CLAIM_TTL_MS = 120_000;

function liveClaim(activity) {
  const claim = claimed.get(activity?.uuid);
  if ( claim && ((Date.now() - claim.at) > CLAIM_TTL_MS) ) claimed.delete(activity.uuid);
  return claimed.get(activity?.uuid) ?? null;
}

function onPreUse(activity) {
  if ( activity?.type !== "summon" ) return;
  claimed.delete(activity.uuid);
  const caster = activity.getUsageToken?.() ?? null;
  const targets = Array.from(game.user.targets).map(t => t.document).filter(t => t && (t !== caster));
  if ( !targets.length ) return;
  const takers = [];
  Hooks.callAll(`${MODULE_ID}.summonOnTargets`, takers, { activity, caster, targets });
  const kept = takers.filter(t => typeof t === "function");
  if ( kept.length ) claimed.set(activity.uuid, { takers: kept, at: Date.now() });
}

/** dnd5e s'apprête à poser l'invocation : un voisin l'a reprise, on ne pose rien. */
function onPreSummon(activity) {
  return liveClaim(activity) ? false : undefined;
}

function onPostUse(activity, usageConfig) {
  const claim = liveClaim(activity);
  if ( !claim ) return;
  const takers = claim.takers;
  claimed.delete(activity.uuid);
  const options = usageConfig?.summons ?? {};
  const profile = activity.profiles?.find(p => p._id === options.profile) ?? activity.availableProfiles?.[0] ?? null;
  return handOver(activity, options, profile, takers);
}

async function handOver(activity, options, profile, takers) {
  for ( const take of takers ) {
    try { if ( (await take({ profile })) === true ) return; }
    catch(err) { console.warn(`${MODULE_ID} | summon on targets: a neighbouring module failed`, err); }
  }
  // Personne n'a abouti : la pose ordinaire de dnd5e (plus rien n'est réclamé pour cette activité).
  if ( activity.canSummon && canvas.scene && profile ) await activity.placeSummons({ ...options, profile: profile._id });
}

export function registerSummonHandover() {
  route("dnd5e.preUseActivity", onPreUse, { label: "summon on targets: neighbours asked" });
  route("dnd5e.preSummon", onPreSummon, { cancellable: true, label: "summon on targets: handed to a neighbouring module" });
  route("dnd5e.postUseActivity", onPostUse, { label: "summon on targets: neighbour summons" });
}
