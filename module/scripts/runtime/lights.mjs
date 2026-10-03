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
  log(`${activity.item.name} : ${n} lumière(s) éteinte(s)`);
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
    if ( n ) log(`${activity.item.name} : ${n} lumière(s) précédente(s) éteinte(s)`);
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
    log(`zone : ${light.config.negative ? `ténèbres (${light.config.dim} ${region.parent.grid.units})`
      : `lumière ${light.config.bright}/${light.config.dim} ${region.parent.grid.units}`}${dispelled ? `, ${dispelled} zone(s) de ténèbres dissipée(s)` : ""}`);
  }, { executor: true, label: "lumière de zone non posée" });

  route("updateRegion", async (region, changes) => {
    if ( !("shapes" in changes) && !("elevation" in changes) ) return;
    if ( await followRegion(region) ) log("zone déplacée : sa lumière suit");
  }, { executor: true, label: "lumière de zone non déplacée" });

  route("deleteRegion", async region => {
    const n = await extinguishRegion(region);
    if ( n ) log(`zone retirée : ${n} lumière(s) éteinte(s)`);
  }, { executor: true, label: "lumière de zone non éteinte" });

  // Toute région peut porter des ténèbres : la vision simulée est à refaire quand l'une naît, bouge ou disparaît.
  for ( const hook of ["createRegion", "updateRegion", "deleteRegion"] ) route(hook, () => invalidateVision(), { label: "vision : sources à refaire" });

  // §16.36 : « ne peut pas bénéficier de l'état Invisible » jusque dans l'affichage — l'invisibilité d'une créature révélée
  // est suspendue, et reprend quand la révélation tombe (adapter/reveal.mjs).
  route("preCreateActiveEffect", effect => {
    if ( veilOnCreate(effect) ) log(`${effect.parent?.name ?? "?"} : ${effect.name} suspendu (révélé)`);
  }, { label: "invisibilité : non suspendue" });
  route("createActiveEffect", async effect => {
    if ( (effect.parent?.documentName !== "Actor") || !isRevealEffect(effect) ) return;
    const n = await veilExisting(effect.parent);
    if ( n ) log(`${effect.parent.name} : révélé par ${effect.name}, invisibilité suspendue`);
  }, { executor: true, label: "invisibilité : non suspendue" });
  const lifted = async (effect, gone) => {
    const n = await unveil(effect.parent, gone);
    if ( n ) log(`${effect.parent.name} : plus révélé, invisibilité rétablie`);
  };
  route("deleteActiveEffect", effect => (effect.parent?.documentName === "Actor") && isRevealEffect(effect) ? lifted(effect, effect) : null,
    { executor: true, label: "invisibilité : non rétablie" });
  route("updateActiveEffect", (effect, changes) => {
    if ( (effect.parent?.documentName !== "Actor") || !("disabled" in changes) || !isRevealEffect(effect) ) return null;
    return changes.disabled ? lifted(effect, effect) : veilExisting(effect.parent);
  }, { executor: true, label: "invisibilité : non rétablie" });

  route("preCreateActiveEffect", effect => {
    if ( addEffectLight(effect) ) log(`${effect.parent?.name ?? "?"} : ${effect.name} le fait briller`);
  }, { label: "effet lumineux non complété" });

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
  }, { cancellable: true, label: "objet lumineux : placé au lancement" });

  // §16.35 : la couleur choisie passe sur le token de l'objet, sur le client qui l'invoque.
  route("dnd5e.summonToken", (activity, profile, tokenData, options) => {
    if ( colorSummonedToken(activity, tokenData, options) ) log(`${activity.item.name} : lumière ${tokenData.light?.color}`);
  }, { label: "objet lumineux : couleur non appliquée" });

  route("dnd5e.postUseActivity", async (activity, usageConfig) => {
    const ours = usageConfig?.[MODULE_ID];
    if ( (ours?.lightChoice !== "self") || !lightChoiceOf(activity) ) return;
    if ( await lightCaster(activity, ours.lightColor ?? null) ) log(`${activity.actor.name} tient ${activity.item.name} : il brille`);
  }, { label: "objet lumineux : le lanceur ne brille pas" });

  CONFIG.queries[EXTINGUISH_QUERY] = handleExtinguish;

  // §52 : une source de lumière portée — son activité utilitaire l'allume, ou l'éteint si elle brûle déjà.
  route("dnd5e.postUseActivity", async activity => {
    const item = activity?.item;
    if ( (activity?.type !== "utility") || !carriedLightOf(item) || !item.actor?.isOwner ) return;
    const on = !carriedLightEffect(item);
    if ( await setCarriedLight(item, on) ) log(`${item.actor.name} : ${item.name} ${on ? "allumé(e)" : "éteint(e)"}`);
  }, { label: "source de lumière : non allumée" });
  // Elle quitte la fiche (lâchée, lancée, donnée) : elle s'éteint sur son ancien porteur.
  route("deleteItem", async item => {
    const n = carriedLightOf(item) ? await dropCarriedLight(item) : 0;
    if ( n ) log(`${item.parent?.name ?? "?"} : ${item.name} n'est plus porté(e), sa lumière s'éteint`);
  }, { executor: true, label: "source de lumière : non éteinte" });

  route("createToken", async tokenDoc => {
    const done = await placeLightObject(tokenDoc);
    if ( !done ) return;
    if ( done.extinguished ) log(`lumière : ${done.extinguished} lumière(s) du lancement précédent éteinte(s)`);
  }, { executor: true, label: "objet lumineux non traité" });
}
