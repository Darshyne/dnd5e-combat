/**
 * §396 : la correction du MJ — rattraper une erreur en partie (décision de l'utilisateur, 2026-11-07) : remettre un effet, des dégâts
 * ou une concentration supprimés par erreur, appliquer ce qui ne l'a pas été. Le MJ « relance » l'activité à la place du joueur, en
 * choisissant ce qui doit vraiment se produire (fenêtre : ui/correction.mjs).
 *
 * Mode « cibles » (par défaut) : aucune utilisation de dnd5e, donc ni dialogue, ni jet d'attaque ou de sauvegarde, ni animation, ni son.
 *  - le niveau du sort : la copie mise à l'échelle de dnd5e (`Item5e#scaledClone`, chat-message.mjs:695) ;
 *  - la consommation, si demandée : `activity.consume` de dnd5e (mixin.mjs:328), comme une utilisation ;
 *  - la concentration, si demandée et si le sort l'exige : `Actor5e#beginConcentrating` (actor.mjs:1091) ;
 *  - une carte « Correction du MJ » (message `usage` : dnd5e y retrouve l'activité, le niveau et la concentration), chuchotée au MJ
 *    sauf case cochée ; le routeur la saute (`flags["dnd5e-combat"].correction`, adapter/vanilla-state.mjs) ;
 *  - par cible : l'issue choisie — attaque touchée (défaut), critique ou ratée ; sauvegarde ratée (défaut) ou réussie ;
 *  - les dégâts : aucun, au maximum, au minimum ou lancés (`getDamageConfig`, base-activity.mjs:839, puis `DamageRoll#evaluate`
 *    avec `maximize` / `minimize` du cœur), moitié ou rien sur une sauvegarde réussie selon `damage.onSave`, appliqués par
 *    `Actor5e#applyDamage` (résistances comprises) ;
 *  - les effets de l'activité (au niveau choisi, `applicableEffects`) par le plateau de dnd5e (`_applyEffectToActor`), qui les rattache
 *    à la concentration de la carte : la rompre les retire, comme en partie. Sur une sauvegarde réussie, seuls les profils `onSave`.
 * Ce que la correction pose redevient l'affaire de DAS (durées, sauvegardes répétées…).
 *
 * Mode « zone » (sort à zone qui dure) : une vraie utilisation (`activity.use`), sans dialogue, la zone à poser par le MJ, rien de
 * résolu à la pose (`quietPose` sur la carte, runtime/engine-areas.mjs) ; la concentration et la consommation selon la fenêtre.
 */

import { MODULE_ID } from "../constants.mjs";
import { applyEffectsToToken } from "../adapter/apply-effects.mjs";
import { areaRulesOf, isInstantaneous } from "../adapter/areas.mjs";
import { route } from "./router.mjs";
import { log, loc, esc } from "./shared.mjs";

export const DAMAGE_MODES = Object.freeze(["none", "max", "min", "random"]);
export const ATTACK_OUTCOMES = Object.freeze(["hit", "critical", "miss"]);
export const SAVE_OUTCOMES = Object.freeze(["failed", "success"]);

/** L'activité fait-elle un jet d'attaque, impose-t-elle une sauvegarde, a-t-elle des dégâts, des effets ? */
export function correctionShape(activity) {
  const parts = activity?.damage?.parts ?? (activity?.healing ? [activity.healing] : []);
  const zone = !!activity?.target?.template?.type && !isInstantaneous(activity) && !!areaRulesOf(activity);
  const item = activity?.item;
  const isSpell = item?.type === "spell";
  const base = isSpell ? (item.system.level ?? 0) : null;
  return {
    attack: activity?.type === "attack",
    save: activity?.type === "save",
    damage: (parts.length > 0) || (activity?.type === "heal"),
    effects: (activity?.effects?.length ?? 0) > 0,
    concentration: !!activity?.requiresConcentration || !!item?.requiresConcentration,
    consumption: !!(activity?.consumption?.targets?.length || activity?.requiresSpellSlot || activity?.activation?.type),
    zone,
    levels: (isSpell && base > 0 && activity?.canScale !== false) ? Array.from({ length: 10 - base }, (_, i) => base + i) : (isSpell ? [base] : []),
    level: base
  };
}

/** Les cibles : celles du MJ, ou le lanceur pour une activité sur soi. */
export function correctionTargets(activity) {
  const mine = Array.from(game.user.targets ?? []).map(t => t.document);
  if ( mine.length ) return mine;
  const self = (activity?.target?.affects?.type === "self") || (activity?.range?.units === "self" && !activity?.target?.affects?.type);
  const token = self ? (activity.actor?.getActiveTokens?.(false, true)?.[0] ?? null) : null;
  return token ? [token] : [];
}

/** La clé d'emplacement d'un niveau : l'emplacement ordinaire s'il en a, sinon celui du pacte s'il est de ce niveau. */
function slotKey(actor, level) {
  const spells = actor?.system?.spells ?? {};
  if ( (spells[`spell${level}`]?.max ?? 0) > 0 ) return `spell${level}`;
  if ( spells.pact?.level === level ) return "pact";
  return `spell${level}`;
}

/** Les jets de dégâts, déjà évalués (au maximum, au minimum ou au hasard). */
async function rollDamage(activity, { mode, critical }) {
  const config = activity.getDamageConfig({ isCritical: critical });
  const rolls = [];
  for ( const r of config.rolls ?? [] ) {
    const roll = CONFIG.Dice.DamageRoll.fromConfig(r, config);
    await roll.evaluate({ maximize: mode === "max", minimize: mode === "min", allowInteractive: false });
    rolls.push(roll);
  }
  return rolls;
}

/** Les dégâts d'une cible, à partir des jets : entiers, moitié, ou rien. */
function damagesFor(rolls, factor) {
  if ( !factor ) return [];
  return rolls.map(roll => ({
    value: Math.floor(roll.total * factor),
    type: roll.options.type ?? Array.from(roll.options.types ?? [])[0] ?? "",
    properties: new Set(roll.options.properties ?? [])
  })).filter(d => d.value > 0);
}

const typeLabel = type => game.i18n.localize(CONFIG.DND5E.damageTypes?.[type]?.label ?? CONFIG.DND5E.healingTypes?.[type]?.label ?? type);

/**
 * Applique une correction (MJ). Rend `{ ok, message, lines }` ou `{ ok: false, reason }`.
 * @param {object} input
 * @param {string} input.activity       uuid de l'activité (sur la fiche du personnage).
 * @param {number|null} [input.level]   Niveau du sort.
 * @param {string[]} [input.targets]    uuids des tokens ; à défaut, les cibles du MJ ou le lanceur.
 * @param {"none"|"max"|"min"|"random"} [input.damage="random"]
 * @param {"hit"|"critical"|"miss"} [input.attack="hit"]
 * @param {"failed"|"success"} [input.save="failed"]
 * @param {boolean} [input.concentration=true]
 * @param {boolean} [input.effects=true]
 * @param {boolean} [input.consume=false]
 * @param {"targets"|"zone"} [input.zone="targets"]
 * @param {boolean} [input.public=false]  La carte vue par toute la table.
 */
export async function applyCorrection(input) {
  if ( !game.user.isGM ) return { ok: false, reason: "gm" };
  const original = fromUuidSync(input.activity ?? "", { strict: false });
  const actor = original?.actor;
  if ( !original || !actor ) return { ok: false, reason: "activity" };
  const shape = correctionShape(original);
  const level = shape.levels.includes(Number(input.level)) ? Number(input.level) : shape.level;
  const scaling = (Number.isFinite(level) && Number.isFinite(shape.level)) ? Math.max(0, level - shape.level) : 0;
  const whisper = input.public ? [] : game.users.filter(u => u.isGM).map(u => u.id);

  if ( (input.zone === "zone") && shape.zone ) return correctZone(original, { level, input, whisper });

  const item = scaling ? original.item.scaledClone(scaling) : original.item;
  const activity = item.system.activities.get(original.id);
  const lines = [];
  let deltas = null;

  // Consommation, comme une utilisation (emplacement du niveau choisi, ressources de l'activité).
  if ( input.consume ) {
    const usageConfig = activity._prepareUsageConfig({ spell: Number.isFinite(level) && activity.requiresSpellSlot ? { slot: slotKey(actor, level) } : undefined, scaling });
    const consumeConfig = { data: {} };
    const updates = await activity.consume(usageConfig, consumeConfig);
    if ( updates === false ) return { ok: false, reason: "consume" };
    // Ce que dnd5e a consommé (mixin.mjs:357, `system.deltas`) : « Annuler » le rend par `activity.refund` (mixin.mjs:385).
    deltas = consumeConfig.data.system?.deltas ?? null;
    lines.push(loc("Correction.Ligne.Consomme"));
  }

  // Concentration du lanceur, au niveau choisi.
  let concentration = null;
  if ( input.concentration !== false && shape.concentration && !game.settings.get("dnd5e", "disableConcentration") ) {
    concentration = await actor.beginConcentrating(activity, { "flags.dnd5e.scaling": scaling }) ?? null;
    if ( concentration ) lines.push(loc("Correction.Ligne.Concentration"));
  }

  const tokens = (input.targets?.length ? input.targets.map(u => fromUuidSync(u, { strict: false })) : correctionTargets(original)).filter(t => t?.actor);
  const attack = ATTACK_OUTCOMES.includes(input.attack) ? input.attack : "hit";
  const save = SAVE_OUTCOMES.includes(input.save) ? input.save : "failed";
  const mode = DAMAGE_MODES.includes(input.damage) ? input.damage : "random";
  const hits = !shape.attack || (attack !== "miss");
  const saved = shape.save && (save === "success");

  // Dégâts : un seul jet pour toutes les cibles, comme en partie.
  const rolls = (shape.damage && hits && (mode !== "none")) ? await rollDamage(activity, { mode, critical: shape.attack && (attack === "critical") }) : [];
  const onSave = activity.damage?.onSave ?? "half";
  const factor = saved ? ({ half: 0.5, full: 1 }[onSave] ?? 0) : 1;

  // Effets au niveau choisi ; sur une sauvegarde réussie, seuls ceux qui s'appliquent quand même.
  const profiles = (input.effects !== false && hits) ? (activity.applicableEffects ?? []).filter(p => !saved || p.onSave) : [];
  const refs = profiles.map(p => ({ id: p._id, activity: activity.uuid }));

  const outcome = shape.attack ? loc(`Correction.Attaque.${attack}`) : (shape.save ? loc(`Correction.Sauvegarde.${save}`) : null);
  const perTarget = tokens.map(t => ({ token: t, damages: damagesFor(rolls, factor) }));
  for ( const { token, damages } of perTarget ) {
    const dmg = damages.map(d => `${d.value} ${typeLabel(d.type)}`).join(", ");
    const names = profiles.map(p => item.effects.get(p._id)?.name).filter(Boolean).join(", ");
    lines.push(loc("Correction.Ligne.Cible", { name: token.name, what: [outcome, dmg, names].filter(Boolean).join(" · ") || loc("Correction.Ligne.Rien") }));
  }
  if ( !tokens.length ) lines.push(loc("Correction.Ligne.SansCible"));

  const levelText = (Number(level) > 0) && (item.type === "spell") ? ` (${loc("Correction.Niveau", { level })})` : "";
  const content = `<div class="das-correction-card">
    <p class="das-correction-card__title"><i class="fa-solid fa-screwdriver-wrench"></i> ${esc(loc("Correction.Carte"))}</p>
    <p><strong>${esc(actor.name)}</strong> — ${esc(original.item.name)}${esc(levelText)}</p>
    <ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
  const message = await ChatMessage.implementation.create({
    type: "usage", content, whisper,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    system: { ...activity.messageSources, concentration: concentration?.id ?? null, scaling, ...(deltas ? { deltas } : {}) },
    flags: { [MODULE_ID]: { correction: { activity: original.uuid, level, attack, save, damage: mode, by: game.user.id } } }
  });

  // Ce que « Annuler » défera : les PV (en écart, pour ne pas écraser ce qui a changé depuis), les effets posés, la concentration.
  const undo = { hp: [], effects: [], concentration: concentration?.uuid ?? null, statuses: [] };
  for ( const { token, damages } of perTarget ) {
    if ( refs.length ) undo.effects.push(...await applyEffectsToToken(message, token.uuid, refs));
    if ( !damages.length ) continue;
    const before = hpOf(token.actor);
    const had = new Set(token.actor.statuses ?? []);
    await token.actor.applyDamage(damages);
    const after = hpOf(token.actor);
    undo.hp.push({ actor: token.actor.uuid, value: before.value - after.value, temp: before.temp - after.temp });
    undo.statuses.push({ actor: token.actor.uuid, had: [...had] });
  }
  await message.setFlag(MODULE_ID, "correction", { ...message.getFlag(MODULE_ID, "correction"), undo });
  log(`correction: ${original.item.name} by ${actor.name} on ${tokens.map(t => t.name).join(", ") || "nobody"}`);
  return { ok: true, message: message?.id ?? null, lines };
}

/** Mode « zone » : une vraie utilisation, sans dialogue, la zone posée par le MJ ; rien ne se résout à la pose. */
async function correctZone(original, { level, input, whisper }) {
  const actor = original.actor;
  const usage = {
    spell: Number.isFinite(level) && original.requiresSpellSlot ? { slot: slotKey(actor, level) } : undefined,
    concentration: { begin: input.concentration !== false },
    create: { measuredTemplate: true },
    subsequentActions: false,
    [MODULE_ID]: { confirmed: true, quietPose: true }
  };
  if ( !input.consume ) usage.consume = false;
  // dnd5e choisit la visibilité de sa carte par le mode du message (mixin.mjs:787, `ChatMessage.applyMode` du cœur) : « gm » la chuchote au MJ.
  const regionsBefore = new Set(canvas.scene?.regions.map(r => r.id) ?? []);
  const effectsBefore = new Set(actor.effects.map(e => e.id));
  const results = await original.use(usage, { configure: false },
    { rollMode: whisper.length ? "gm" : "public", data: { flavor: loc("Correction.Carte") } });
  // « Annuler » : la zone posée et la concentration reprise. Pas sous `correction` : la carte doit rester celle du moteur (la zone la lit).
  const message = results?.message instanceof ChatMessage ? results.message : game.messages.get(results?.message?.id ?? "");
  if ( message ) {
    const regions = (canvas.scene?.regions ?? []).filter(r => !regionsBefore.has(r.id) && [r.getFlag("dnd5e", "item"), r.getFlag("dnd5e", "activity")]
      .some(u => [original.uuid, original.item.uuid].includes(u))).map(r => r.uuid);
    const concentration = actor.effects.find(e => !effectsBefore.has(e.id) && e.statuses?.has("concentrating"))?.uuid ?? null;
    await message.setFlag(MODULE_ID, "correctionUndo", { activity: original.uuid, regions, concentration, effects: [], hp: [], statuses: [] });
  }
  log(`correction: zone of ${original.item.name} placed again for ${actor.name}`);
  return { ok: !!results, message: results?.message?.id ?? null, lines: [loc("Correction.Ligne.Zone")] };
}

const hpOf = actor => {
  const hp = actor?.system?.attributes?.hp ?? {};
  return { value: Number(hp.value) || 0, temp: Number(hp.temp) || 0 };
};

/** Ce qu'« Annuler » défait sur une carte de correction, ou null (déjà annulée, rien à défaire). */
export function undoOf(message) {
  if ( !message || message.getFlag(MODULE_ID, "correctionUndone") ) return null;
  return message.getFlag(MODULE_ID, "correction")?.undo ?? message.getFlag(MODULE_ID, "correctionUndo") ?? null;
}

/**
 * MJ : défait une correction — les PV rendus en écart (les dégâts reviennent, un soin est repris), Inconscient / Mort retirés s'ils
 * sont venus avec ces dégâts et que la créature a de nouveau des PV, les effets posés retirés, la concentration reprise rompue (et ce
 * qui en dépend, zone comprise), les régions de la zone retirées, la consommation rendue par dnd5e (`activity.refund`).
 */
export async function undoCorrection(messageId) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const undo = undoOf(message);
  if ( !undo ) return false;
  for ( const { actor: uuid, value, temp } of undo.hp ?? [] ) {
    const actor = fromUuidSync(uuid, { strict: false });
    if ( !actor ) continue;
    const hp = actor.system.attributes.hp;
    const max = (Number(hp.max) || 0) + (Number(hp.tempmax) || 0);
    await actor.update({ "system.attributes.hp.value": Math.clamp((Number(hp.value) || 0) + value, 0, max || Infinity),
      "system.attributes.hp.temp": Math.max(0, (Number(hp.temp) || 0) + temp) });
  }
  for ( const { actor: uuid, had } of undo.statuses ?? [] ) {
    const actor = fromUuidSync(uuid, { strict: false });
    if ( !actor || !((Number(actor.system.attributes.hp.value) || 0) > 0) ) continue;
    for ( const status of ["dead", "unconscious"] ) {
      if ( !had.includes(status) && actor.statuses.has(status) ) await actor.toggleStatusEffect(status, { active: false });
    }
  }
  // Ce qui est déjà parti (rompu avec la concentration, retiré à la main) est ignoré.
  const remove = async uuid => {
    const doc = fromUuidSync(uuid, { strict: false });
    if ( doc && !doc.isDeleted ) await doc.delete().catch(() => null);
  };
  for ( const uuid of undo.effects ?? [] ) await remove(uuid);
  // La zone avant la concentration : rompre celle-ci la fait retirer par le moteur (runtime/concentration.mjs), en même temps que nous.
  for ( const uuid of undo.regions ?? [] ) await remove(uuid);
  if ( undo.concentration ) {
    const effect = fromUuidSync(undo.concentration, { strict: false });
    if ( effect && !effect.isDeleted ) await (effect.parent?.endConcentration ? effect.parent.endConcentration(effect) : effect.delete()).catch(() => null);
  }
  if ( message.system?.deltas ) {
    const activity = fromUuidSync(message.getFlag(MODULE_ID, "correction")?.activity ?? undo.activity ?? "", { strict: false });
    if ( activity?.refund ) {
      await activity.refund(message.system.deltas);
      await message.update({ "system.deltas": null });
    }
  }
  await message.setFlag(MODULE_ID, "correctionUndone", true);
  log(`correction undone (${message.id})`);
  return true;
}

function onPreUse(_activity, usageConfig, _dialogConfig, messageConfig) {
  if ( usageConfig?.[MODULE_ID]?.quietPose && messageConfig ) foundry.utils.setProperty(messageConfig, `data.flags.${MODULE_ID}.quietPose`, true);
}

export const correctionApi = Object.freeze({ apply: applyCorrection, shape: correctionShape, undo: undoCorrection });

export function registerCorrection() {
  route("dnd5e.preUseActivity", onPreUse, { label: "correction: quiet zone not marked" });
}
