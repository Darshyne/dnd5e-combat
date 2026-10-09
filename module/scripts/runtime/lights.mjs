/**
 * Lumière et ténèbres des sorts en marche (SPEC §16.31) : quand dnd5e pose la zone, crée l'effet ou invoque l'objet, le
 * moteur y met la source que le cœur V14 sait rendre (adapter/lights.mjs). La vision simulée lit les ténèbres par le
 * contenu (adapter/vision.mjs, `blockingRegions`), pas par ces sources.
 */

import { MODULE_ID } from "../constants.mjs";
import { lightUpRegion, followRegion, extinguishRegion, addEffectLight, placeLightObject, lightRuleOf, lightChoiceOf,
  summonSizeOf, lightCaster, colorSummonedToken, extinguishLights, carriedLightOf, carriedLightEffect, setCarriedLight,
  dropCarriedLight } from "../adapter/lights.mjs";
import { invalidateVision } from "../adapter/vision.mjs";
import { veilOnCreate, veilExisting, unveil, isRevealEffect } from "../adapter/reveal.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

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

  // §52 : une source de lumière portée — son activité utilitaire l'allume, ou l'éteint si elle brûle déjà.
  route("dnd5e.postUseActivity", async activity => {
    const item = activity?.item;
    if ( (activity?.type !== "utility") || !carriedLightOf(item) || !item.actor?.isOwner ) return;
    const on = !carriedLightEffect(item);
    if ( await setCarriedLight(item, on) ) log(`${item.actor.name}: ${item.name} ${on ? "lit" : "extinguished"}`);
  }, { label: "light source: not lit" });
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
