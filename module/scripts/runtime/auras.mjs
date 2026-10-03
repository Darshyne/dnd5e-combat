import { MODULE_ID } from "../constants.mjs";
import { auraRecipients, wantedAuraEffects, planAuraChanges } from "../core/aura.mjs";
import { convertLength } from "../core/units.mjs";
import {
  aurasOf, auraValue, auraCopiesOn, createAuraCopy, updateAuraCopy, removeAuraCopy, showAuraIcon, carriesOriginal
} from "../adapter/auras.mjs";
import { distanceBetween } from "../adapter/turn.mjs";
import { hasLineOfEffect } from "../adapter/cover.mjs";
import { readUnitFactors } from "../adapter/units.mjs";
import { enqueue } from "./queue.mjs";
import { route } from "./router.mjs";
import { log, isExecutor } from "./shared.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";

const isInactive = actor => actor.statuses.has("incapacitated") || actor.statuses.has("dead")
  || actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED);

/**
 * Réglage « auras en combat seulement » : hors combat, aucune aura n'est tenue et les copies
 * existantes sont retirées. Le calcul est léger, mais il tourne à chaque déplacement de token ;
 * en exploration, sur une grande scène, c'est du travail pour un bonus qui ne sert qu'aux rares
 * sauvegardes hors combat — que le MJ peut alors compter à la main.
 */
function aurasActiveOn(scene) {
  if ( !game.settings.get(MODULE_ID, "aurasOnlyInCombat") ) return true;
  return game.combats.some(c => c.started && (!c.scene || (c.scene.id === scene.id)));
}

/**
 * Remet les auras de la scène affichée d'aplomb : qui se tient dans quelle aura, et donc quelles
 * copies d'effet créer, corriger ou retirer. Tout est recalculé à chaque fois — les scènes de
 * combat comptent quelques dizaines de tokens — et seul l'écart est écrit.
 */
async function refreshScene(scene) {
  const tokens = scene.tokens.filter(t => t.actor && !t.hidden && !isObjectToken(t));
  const active = aurasActiveOn(scene);
  const factors = readUnitFactors();
  const gridUnits = scene.grid.units;
  const byUuid = new Map(tokens.map(t => [t.uuid, t]));
  const auraBySlot = new Map();   // `${source}|${key}` -> { aura, sourceToken }

  const auras = [];
  for ( const sourceToken of (active ? tokens : []) ) for ( const aura of aurasOf(sourceToken.actor) ) {
    let radius = aura.radius;
    try { radius = convertLength(aura.radius, aura.units, gridUnits, factors); } catch { /* unité inconnue : valeur brute */ }
    const source = {
      token: sourceToken.uuid, key: aura.key, disposition: sourceToken.disposition,
      inactive: isInactive(sourceToken.actor), radius, affects: aura.affects,
      includeSelf: aura.includeSelf === true, value: auraValue(aura, sourceToken.actor), types: aura.types ?? null
    };
    // P2 : distance en 3D ; une émanation est arrêtée par un abri total (plancher, mur plein) — testé
    // seulement pour qui est à portée, la ligne d'effet coûte des rayons.
    const candidates = tokens.map(t => {
      // §16.47 : qui porte déjà l'effet d'origine du sort n'en reçoit pas de copie.
      const distance = carriesOriginal(t.actor, aura) ? Infinity : (t === sourceToken ? 0 : distanceBetween(sourceToken, t).value);
      const lineOfEffect = ((t === sourceToken) || (distance > radius + 1e-6)) ? null : hasLineOfEffect(sourceToken, t);
      return { token: t.uuid, disposition: t.disposition, distance, lineOfEffect, type: t.actor.system.details?.type?.value ?? null };
    });
    auras.push({ source, recipients: auraRecipients(source, candidates) });
    auraBySlot.set(`${source.token}|${source.key}`, { aura, sourceToken });
  }

  const existing = tokens.flatMap(auraCopiesOn);
  const { create, update, remove } = planAuraChanges(existing, wantedAuraEffects(auras));
  const removed = new Set(remove.map(e => e.id));
  for ( const e of existing ) if ( !e.iconShown && !removed.has(e.id) ) await showAuraIcon(byUuid.get(e.target), e.id);
  for ( const e of remove ) {
    await removeAuraCopy(byUuid.get(e.target), e.id);
    log(`aura ${e.key} : retirée de ${byUuid.get(e.target)?.name}`);
  }
  for ( const w of update ) {
    const { aura, sourceToken } = auraBySlot.get(`${w.source}|${w.key}`);
    await updateAuraCopy(byUuid.get(w.target), w.id, aura, sourceToken, w.value);
    log(`aura ${w.key} : mise à jour sur ${byUuid.get(w.target)?.name} (${w.value})`);
  }
  for ( const w of create ) {
    const { aura, sourceToken } = auraBySlot.get(`${w.source}|${w.key}`);
    await createAuraCopy(byUuid.get(w.target), aura, sourceToken, w.value);
    log(`aura ${w.key} : ${byUuid.get(w.target)?.name} entre dans l'aura de ${sourceToken.name} (${w.value})`);
  }
}

export function registerAuras() {
  game.settings.register(MODULE_ID, "aurasOnlyInCombat", {
    name: "DND5ECOMBAT.Reglage.aurasOnlyInCombat.nom",
    hint: "DND5ECOMBAT.Reglage.aurasOnlyInCombat.aide",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => Hooks.callAll(`${MODULE_ID}.refreshAuras`)
  });

  // Un seul recalcul à la fois, et les rafales (déplacement de groupe) sont regroupées.
  const refresh = foundry.utils.debounce(() => {
    if ( !isExecutor() || !canvas?.scene ) return;
    enqueue("auras", () => refreshScene(canvas.scene))
      .catch(err => console.error(`${MODULE_ID} | auras : recalcul interrompu`, err));
  }, 200);

  const auras = { label: "auras : recalcul demandé" };
  const always = () => refresh();
  // Début et fin de combat : avec le réglage « en combat seulement », les auras s'allument et s'éteignent.
  for ( const hook of ["canvasReady", `${MODULE_ID}.refreshAuras`, "combatStart", "deleteCombat", "moveToken",
    "createToken", "deleteToken", "createItem", "deleteItem"] ) route(hook, always, auras);
  route("updateToken", (token, changes) => { if ( ("hidden" in changes) || ("disposition" in changes) ) refresh(); }, auras);
  // Un état qui éteint l'aura (neutralisé), un Charisme qui change, un item d'aura ajouté ou retiré.
  // Nos propres copies ne relancent rien : elles ne changent ni les porteurs ni les distances.
  const onEffect = effect => { if ( !effect.getFlag(MODULE_ID, "aura") ) refresh(); };
  route("createActiveEffect", onEffect, auras);
  route("deleteActiveEffect", onEffect, auras);
  route("updateActor", (actor, changes) => { if ( changes.system?.abilities ) refresh(); }, auras);
}
