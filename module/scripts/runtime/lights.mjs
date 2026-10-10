/**
 * Lumière et ténèbres des sorts en marche (SPEC §16.31) : quand dnd5e pose la zone, crée l'effet ou invoque l'objet, le
 * moteur y met la source que le cœur V14 sait rendre (adapter/lights.mjs). La vision simulée lit les ténèbres par le
 * contenu (adapter/vision.mjs, `blockingRegions`), pas par ces sources.
 */

import { MODULE_ID } from "../constants.mjs";
import { lightUpRegion, followRegion, extinguishRegion, addEffectLight, placeLightObject, lightRuleOf, lightChoiceOf,
  summonSizeOf, lightCaster, colorSummonedToken, extinguishLights, carriedLightOf, carriedLightEffect, setCarriedLight,
  dropCarriedLight, carriedSourceOf, remainingOf, burnOut, rememberBurn } from "../adapter/lights.mjs";
import { burnParts } from "../core/light.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { invalidateVision } from "../adapter/vision.mjs";
import { veilOnCreate, veilExisting, unveil, isRevealEffect } from "../adapter/reveal.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

export const EXTINGUISH_QUERY = `${MODULE_ID}.extinguish`;

/** Côté MJ actif : éteindre les lumières d'un item, pour un joueur qui possède son lanceur. */
async function handleExtinguish({ item: itemUuid }, { user }={}) {
  const item = await fromUuid(itemUuid);
  if ( !item || (user && !item.actor?.testUserPermission(user, "OWNER")) ) return 0;
  return extinguishLights(item);
}

/** Éteindre les lumières précédentes d'un item : par le MJ actif, qui peut retirer des tokens. */
async function extinguishBefore(item) {
  const gm = game.users.activeGM;
  if ( !gm ) return 0;
  if ( gm.isSelf ) return handleExtinguish({ item: item.uuid });
  return gm.query(EXTINGUISH_QUERY, { item: item.uuid }, { timeout: 10000 }).catch(() => 0);
}

/** §16.35 : intention « éteindre » (bouton de la fenêtre de choix) — les lumières de l'item s'éteignent, rien n'est lancé. */
export async function putOutLight(activity) {
  const n = await extinguishBefore(activity.item);
  log(`${activity.item.name}: ${n} light(s) extinguished`);
  return n;
}

/**
 * §16.35 : intention « lancer la lumière » (fenêtre de choix, ui/light.mjs) — `where` : « ground » (l'objet est posé, dans
 * la couleur choisie) ou « self » (le lanceur le tient et brille) ; `color` : couleur de la lumière. Relancer un sort
 * `single` (Lumière) éteint d'abord la précédente. Pas de fenêtre de taille : l'objet est Très petit ; un sort de niveau 1+
 * (Flamme éternelle) garde la fenêtre de dnd5e pour l'emplacement.
 * @param {Activity} activity
 * @param {[object, object, object]} usage   Configurations suspendues (utilisation, fenêtre, message).
 * @param {{where: "ground"|"self", color: string|null}} choice
 */
export async function castLight(activity, [config, dialog, message], { where, color }) {
  const rule = lightChoiceOf(activity);
  if ( !rule ) return null;
  if ( rule.single ) {
    const n = await extinguishBefore(activity.item);
    if ( n ) log(`${activity.item.name}: ${n} previous light(s) extinguished`);
  }
  const summons = { ...(config?.summons ?? {}), creatureSize: summonSizeOf(activity), [MODULE_ID]: { lightColor: color } };
  const use = { ...config, summons, create: { ...(config?.create ?? {}), summons: where === "ground" },
    [MODULE_ID]: { ...(config?.[MODULE_ID] ?? {}), lightChoice: where, lightColor: color } };
  const cantrip = (activity.item.system.level ?? 0) === 0;
  // « Sur moi » : le lanceur brille une fois l'utilisation faite (`dnd5e.postUseActivity`, ci-dessous) — même si la
  // légalité l'a suspendue puis relancée.
  return activity.use(use, cantrip ? { ...(dialog ?? {}), configure: false } : dialog, message);
}

/** §121 : un temps restant lisible (« 5 h 20 », « 45 min »). */
export function burnLabel(seconds) {
  if ( !Number.isFinite(seconds) ) return "";
  const { h, m } = burnParts(seconds);
  return h ? loc("Lumiere.DureeH", { h, m: String(m).padStart(2, "0") }) : loc("Lumiere.DureeM", { m });
}

/**
 * §121 : allumer ou éteindre une source portée (`on` absent : l'inverse de son état), sur le client du porteur — activité de
 * la source, boîte à amadou, menu de l'inventaire, HUD. Le porteur voit ce qui s'est passé au-dessus de son token.
 * @returns {Promise<{changed: boolean, lit?: boolean, left?: number|null, refilled?: string|null, reason?: string}>}
 */
export async function toggleCarriedLight(item, on=null) {
  if ( !item?.actor?.isOwner || !carriedLightOf(item) ) return { changed: false, reason: "notLight" };
  const want = (on === null) ? !carriedLightEffect(item) : on;
  const result = await setCarriedLight(item, want);
  const token = tokenOf(item.actor);
  if ( result.reason === "noFuel" ) {
    notice(token, loc("Lumiere.PasDeCombustible", { item: item.name }));
    ui.notifications?.warn(loc("Lumiere.PasDeCombustible", { item: item.name }));
  }
  if ( result.reason === "noHand" ) {
    const text = loc("Lumiere.PasDeMain", { item: item.name, held: result.held.join(", ") });
    notice(token, loc("Lumiere.PasDeMainCourt"));
    ui.notifications?.warn(text);
  }
  if ( !result.changed ) return result;
  const left = burnLabel(result.left);
  if ( result.refilled ) notice(token, loc("Lumiere.Recharge", { item: item.name, fuel: result.refilled }), "gain");
  notice(token, loc(result.lit ? "Lumiere.Allumee" : "Lumiere.Eteinte", { item: item.name, left }), result.lit ? "gain" : "ended");
  log(`${item.actor.name}: ${item.name} ${result.lit ? "lit" : "put out"}${Number.isFinite(result.left) ? ` (${Math.round(result.left / 60)} min left)` : ""}${result.refilled ? `, refilled with ${result.refilled}` : ""}`);
  return result;
}

/**
 * §121 : la source s'est consumée — l'effet part, la torche aussi ; le porteur et le MJ l'apprennent. MJ actif. Une seule fois par
 * effet : le cœur le marque expiré (`updateActiveEffect`) et le moteur retire les effets expirés (`deleteActiveEffect` qui suit).
 */
const burning = new Set();
async function onBurnOut(effect) {
  const actor = effect.parent;
  if ( burning.has(effect.uuid) ) return;
  burning.add(effect.uuid);
  setTimeout(() => burning.delete(effect.uuid), 10000);
  const done = await burnOut(effect);
  if ( !done ) return;
  const text = loc(done.empty ? "Lumiere.Vide" : "Lumiere.Consumee", { item: done.item, name: actor?.name ?? "" });
  notice(tokenOf(actor), text, "ended");
  const owners = game.users.filter(u => u.isGM || (actor && actor.testUserPermission(u, "OWNER"))).map(u => u.id);
  await ChatMessage.implementation.create({ content: `<p>${text}</p>`, whisper: owners,
    speaker: ChatMessage.implementation.getSpeaker({ actor }), flags: { [MODULE_ID]: { burnOut: { item: done.item, consumed: done.consumed } } } });
  log(`${actor?.name}: ${done.item} burnt out${done.consumed ? (done.gone ? " (last one, removed)" : " (one fewer)") : " (empty)"}`);
}

export function registerLights() {
  route("createRegion", async region => {
    const done = await lightUpRegion(region);
    if ( !done ) return;
    const { light, dispelled } = done;
    log(`zone: ${light.config.negative ? `darkness (${light.config.dim} ${region.parent.grid.units})`
      : `light ${light.config.bright}/${light.config.dim} ${region.parent.grid.units}`}${dispelled ? `, ${dispelled} darkness zone(s) dispelled` : ""}`);
  }, { executor: true, label: "zone light not placed" });

  route("updateRegion", async (region, changes) => {
    if ( !("shapes" in changes) && !("elevation" in changes) ) return;
    if ( await followRegion(region) ) log("zone moved: its light follows");
  }, { executor: true, label: "zone light not moved" });

  route("deleteRegion", async region => {
    const n = await extinguishRegion(region);
    if ( n ) log(`zone removed: ${n} light(s) extinguished`);
  }, { executor: true, label: "zone light not extinguished" });

  // Toute région peut porter des ténèbres : la vision simulée est à refaire quand l'une naît, bouge ou disparaît.
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion"] ) route(hook, () => invalidateVision(), { label: "vision: sources to rebuild" });

  // §16.36 : « ne peut pas bénéficier de l'état Invisible » jusque dans l'affichage — l'invisibilité d'une créature révélée
  // est suspendue, et reprend quand la révélation tombe (adapter/reveal.mjs).
  route("preCreateActiveEffect", effect => {
    if ( veilOnCreate(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} suspended (revealed)`);
  }, { label: "invisibility: not suspended" });
  route("createActiveEffect", async effect => {
    if ( (effect.parent?.documentName !== "Actor") || !isRevealEffect(effect) ) return;
    const n = await veilExisting(effect.parent);
    if ( n ) log(`${effect.parent.name}: revealed by ${effect.name}, invisibility suspended`);
  }, { executor: true, label: "invisibility: not suspended" });
  const lifted = async (effect, gone) => {
    const n = await unveil(effect.parent, gone);
    if ( n ) log(`${effect.parent.name}: no longer revealed, invisibility restored`);
  };
  route("deleteActiveEffect", effect => (effect.parent?.documentName === "Actor") && isRevealEffect(effect) ? lifted(effect, effect) : null,
    { executor: true, label: "invisibility: not restored" });
  route("updateActiveEffect", (effect, changes) => {
    if ( (effect.parent?.documentName !== "Actor") || !("disabled" in changes) || !isRevealEffect(effect) ) return null;
    return changes.disabled ? lifted(effect, effect) : veilExisting(effect.parent);
  }, { executor: true, label: "invisibility: not restored" });

  route("preCreateActiveEffect", effect => {
    if ( addEffectLight(effect) ) log(`${effect.parent?.name ?? "?"}: ${effect.name} makes it shed light`);
  }, { label: "light effect not completed" });

  // Lumière, Flamme éternelle : le PHB leur donne `summon.prompt: false` — dnd5e ne place alors rien au lancement, il faut
  // cliquer « Invoquer » sur la carte (documents/activity/summon.mjs:68). Vu en jeu : « rien ne se passe, juste un message de
  // chat ». L'objet lumineux se pose au lancement. Après la légalité et les portes (dernier inscrit) : jamais rien d'annulé ici.
  route("dnd5e.preUseActivity", (activity, usageConfig) => {
    if ( (activity?.type !== "summon") || (lightRuleOf(activity.item)?.on !== "summon") ) return;
    if ( (usageConfig.create === false) || !activity.canSummon || !canvas?.scene ) return;
    // §16.35 : « sur moi » — rien à poser, le lanceur brille (castLight).
    if ( usageConfig[MODULE_ID]?.lightChoice === "self" ) return;
    usageConfig.create ??= {};
    usageConfig.create.summons = true;
    usageConfig.summons ??= {};
    usageConfig.summons.creatureSize = summonSizeOf(activity) ?? usageConfig.summons.creatureSize;
  }, { cancellable: true, label: "light object: placed on cast" });

  // §16.35 : la couleur choisie passe sur le token de l'objet, sur le client qui l'invoque.
  route("dnd5e.summonToken", (activity, profile, tokenData, options) => {
    if ( colorSummonedToken(activity, tokenData, options) ) log(`${activity.item.name}: light ${tokenData.light?.color}`);
  }, { label: "light object: color not applied" });

  route("dnd5e.postUseActivity", async (activity, usageConfig) => {
    const ours = usageConfig?.[MODULE_ID];
    if ( (ours?.lightChoice !== "self") || !lightChoiceOf(activity) ) return;
    if ( await lightCaster(activity, ours.lightColor ?? null) ) log(`${activity.actor.name} holds ${activity.item.name}: it sheds light`);
  }, { label: "light object: the caster does not shed light" });

  CONFIG.queries[EXTINGUISH_QUERY] = handleExtinguish;

  // §121 : le moteur tient la durée et le combustible — dnd5e ne dépense rien à l'activité de la source (sans quoi la Bougie,
  // « autoDestroy », disparaissait à l'allumage et s'éteignait aussitôt, et la Lampe, sa seule utilisation dépensée, ne s'éteignait plus).
  route("dnd5e.preUseActivity", (activity, usageConfig) => {
    if ( (activity?.type !== "utility") || !carriedLightOf(activity.item) ) return;
    usageConfig.consume = false;
  }, { label: "light source: dnd5e consumption not skipped" });
  // §52 : une source de lumière portée — son activité utilitaire l'allume, ou l'éteint si elle brûle déjà.
  route("dnd5e.postUseActivity", async activity => {
    const item = activity?.item;
    if ( (activity?.type !== "utility") || !carriedLightOf(item) || !item.actor?.isOwner ) return;
    await toggleCarriedLight(item);
  }, { label: "light source: not lit" });
  // §121 : arrivée au bout de sa durée, le cœur V14 marque l'effet expiré (`CONFIG.ActiveEffect.expiryAction` « update »,
  // client/helpers/active-effect-registry.mjs:146) — ou le supprime (« delete »). Retiré à la main avant : le temps restant se note.
  // Hors combat, dnd5e supprime aussitôt l'effet expiré (documents/active-effect.mjs:803-806) : c'est le `deleteActiveEffect` qui suit
  // qui le consume. En combat il reste, suspendu : on le consume ici, s'il est encore là une seconde plus tard.
  route("updateActiveEffect", (effect, changes) => {
    if ( !carriedSourceOf(effect) || (changes?.duration?.expired !== true) ) return;
    setTimeout(() => { if ( effect.parent?.effects?.has(effect.id) ) onBurnOut(effect); }, 1000);
  }, { executor: true, label: "light source: not burnt out" });
  route("deleteActiveEffect", async (effect, options) => {
    if ( !carriedSourceOf(effect) || options?.[MODULE_ID]?.putOut ) return;
    const left = remainingOf(effect);
    if ( Number.isFinite(left) && (left <= 0) ) return onBurnOut(effect);
    const kept = await rememberBurn(effect);
    if ( kept !== null ) log(`${effect.parent?.name}: ${effect.name} put out by hand, ${Math.round(kept / 60)} min left`);
  }, { executor: true, label: "light source: remaining time not kept" });
  // Elle quitte la fiche (lâchée, lancée, donnée) : elle s'éteint sur son ancien porteur.
  route("deleteItem", async item => {
    const n = carriedLightOf(item) ? await dropCarriedLight(item) : 0;
    if ( n ) log(`${item.parent?.name ?? "?"}: ${item.name} no longer carried, its light goes out`);
  }, { executor: true, label: "light source: not extinguished" });

  route("createToken", async tokenDoc => {
    const done = await placeLightObject(tokenDoc);
    if ( !done ) return;
    if ( done.extinguished ) log(`light: ${done.extinguished} light(s) from the previous cast extinguished`);
  }, { executor: true, label: "light object not handled" });
}
