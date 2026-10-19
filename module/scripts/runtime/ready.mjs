/**
 * §211 : Se tenir prêt (Ready, règles 2024) — agir hors de son tour.
 *
 *  - À son tour, l'action de base « Se tenir prêt » (content/actions.mjs) dépense l'action ; sur le client qui l'a prise, une fenêtre
 *    demande quoi préparer (une attaque, un sort qui se lance par une action), le déclencheur — un ennemi arrive à portée de l'action,
 *    un ennemi attaque, un ennemi lance un sort — et, au choix, la seule créature qui le déclenche (une cible du moment). Le plan est
 *    rangé dans le budget du tour (`readied`) : il expire au début du prochain tour du combattant, comme le budget.
 *  - Un sort préparé est lancé maintenant : l'emplacement choisi est dépensé, la créature se concentre dessus (effet marqué
 *    `readied`) ; la concentration rompue, le sort est perdu ; non libéré au début de son tour, aussi.
 *  - Le déclencheur survenu, la Réaction est proposée à celui qui s'est tenu prêt (`askReaction`), contre la créature qui l'a
 *    déclenché : « arrive à portée » se joue quand elle y est arrivée — son déplacement est coupé là, puis reprend
 *    (runtime/reactions.mjs, `splitForReady`) ; « attaque » et « lance un sort », une fois l'action de l'ennemi résolue (MJ actif).
 *    Refuser laisse le plan armé (« vous pouvez ignorer le déclencheur ») ; le libérer le sert (runtime/turn.mjs, `readiedRelease`).
 * Le déplacement préparé (« se déplacer jusqu'à sa Vitesse ») reste à la table.
 */

import { MODULE_ID } from "../constants.mjs";
import { READY_TRIGGERS, readyPlanOf, readyTriggered } from "../core/ready.mjs";
import { readyOptionsOf, slotsFor, spendSlot, holdSpell } from "../adapter/ready.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { combatantFor, readBudget, writeBudget, distanceBetween } from "../adapter/turn.mjs";
import { readUnitFactors, lengthIn } from "../adapter/units.mjs";
import { reactionState } from "../adapter/reactions.mjs";
import { areEnemies } from "../adapter/factions.mjs";
import { canSee } from "../adapter/vision.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { isObjectToken } from "../adapter/bodies.mjs";
import { current } from "../core/action.mjs";
import { releaseReady } from "./reactions.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, notice, say, sleep } from "./shared.mjs";

/* -------------------------------------------- */
/*  Préparer                                    */
/* -------------------------------------------- */

/** La fenêtre « Se tenir prêt » ; null si elle est fermée. */
async function askPlan(actor, token) {
  const options = readyOptionsOf(actor);
  if ( !options.length ) { ui.notifications.warn(loc("Pret.Rien", { name: actor.name })); return null; }
  const targets = Array.from(game.user.targets ?? []).filter(t => t.document !== token).map(t => t.document);
  const opt = (value, label, selected=false) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const slotsOf = o => (o.spell && o.level > 0) ? slotsFor(actor, o.level) : [];
  const usable = options.filter(o => !o.spell || (o.level === 0) || slotsOf(o).length);
  if ( !usable.length ) { ui.notifications.warn(loc("Pret.Rien", { name: actor.name })); return null; }
  const content = `<p>${loc("Pret.Intro")}</p>
    <div class="form-group"><label>${loc("Pret.Action")}</label><select name="action">${usable.map((o, i) => opt(i, o.name)).join("")}</select></div>
    <div class="form-group"><label>${loc("Pret.Declencheur")}</label><select name="trigger">${READY_TRIGGERS.map(k => opt(k, loc(`Pret.Si.${k}`))).join("")}</select></div>
    <div class="form-group"><label>${loc("Pret.Qui")}</label><select name="target">${opt("", loc("Pret.NImporteQui"))}${targets.map(t => opt(t.uuid, t.name, targets.length === 1)).join("")}</select></div>
    <div class="form-group" data-slot><label>${loc("Pret.Emplacement")}</label><select name="slot"></select></div>
    <p class="hint">${loc("Pret.Aide")}</p>`;
  const fillSlots = root => {
    const choice = usable[Number(root.querySelector("select[name=action]")?.value) || 0];
    const slots = slotsOf(choice);
    const select = root.querySelector("select[name=slot]");
    select.innerHTML = slots.map(s => opt(s.key, loc("Pret.Niveau", { level: s.level, left: s.value }))).join("");
    root.querySelector("[data-slot]").hidden = !slots.length;
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Pret.Titre", { name: actor.name }) }, content, rejectClose: false, position: { width: 460 },
    render: (event, dialog) => {
      const root = dialog.element;
      fillSlots(root);
      root.querySelector("select[name=action]")?.addEventListener("change", () => fillSlots(root));
    },
    buttons: [
      { action: "ready", label: loc("Pret.Valider"), icon: "fa-solid fa-hourglass-half", default: true,
        callback: (event, button) => {
          const f = button.form.elements;
          return { option: usable[Number(f.action.value) || 0], trigger: f.trigger.value, target: f.target.value || null, slot: f.slot?.value || null };
        } },
      { action: "cancel", label: loc("Pret.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return (answer && (typeof answer === "object")) ? answer : null;
}

/** Le budget a-t-il déjà pris l'action « Se tenir prêt » (écrite par le MJ actif, runtime/turn.mjs) ? On l'attend un peu. */
async function readiedRecorded(combatant) {
  for ( let waited = 0; waited < 6000; waited += 200 ) {
    if ( readBudget(combatant).readied ) return true;
    await sleep(200);
  }
  return false;
}

/** `dnd5e.postUseActivity`, sur le client qui a pris l'action : la fenêtre, puis le plan au budget. */
async function onReadyUsed(activity) {
  if ( basicActionOf(activity?.item) !== "ready" ) return;
  const actor = activity.actor;
  const combatant = combatantFor(actor);
  const token = tokenOf(actor);
  if ( !combatant || !token || !actor.isOwner ) return;
  const answer = await askPlan(actor, token);
  if ( !answer ) { log(`${actor.name}: Ready taken, no readied action chosen`); return; }
  if ( !(await readiedRecorded(combatant)) ) log(`${actor.name}: Ready not recorded in the turn budget yet, the plan is written anyway`);
  await setReadyPlan(actor, answer);
}

/**
 * Range le plan au budget du combattant : un sort préparé est lancé maintenant (emplacement dépensé, Concentration). Aussi appelé par
 * les scénarios (`api.mcp.ready`). Rend le plan, ou null.
 * @param {Actor5e} actor
 * @param {{option: object, trigger: string, target?: string|null, slot?: string|null}} choice  `option` : de `readyOptionsOf`.
 */
export async function setReadyPlan(actor, { option, trigger, target: targetUuid=null, slot=null }) {
  const combatant = combatantFor(actor);
  const token = tokenOf(actor);
  if ( !combatant || !option || !READY_TRIGGERS.includes(trigger) ) return null;
  const target = targetUuid ? await fromUuid(targetUuid) : null;
  const plan = { activity: option.activity, name: option.name, img: option.img, trigger, reach: option.reach,
    target: target?.uuid ?? null, targetName: target?.name ?? null, slot: null, held: null };
  // Un sort préparé se lance maintenant : l'emplacement est dépensé, l'énergie retenue par la Concentration.
  if ( option.spell ) {
    const spell = await fromUuid(option.activity);
    if ( option.level > 0 ) {
      if ( !slot || !(await spendSlot(actor, slot)) ) { ui.notifications.warn(loc("Pret.SansEmplacement")); return null; }
      plan.slot = slot;
    }
    const held = spell ? await holdSpell(spell) : null;
    plan.held = held?.uuid ?? null;
  }
  await writeBudget(combatant, { ...readBudget(combatant), readied: plan });
  const when = loc(`Pret.Si.${trigger}`) + (plan.targetName ? ` (${plan.targetName})` : "");
  if ( token ) notice(token, loc("Pret.Annonce", { action: plan.name }), "info");
  await say({ actor, token }, loc("Pret.Carte", { name: esc(actor.name), action: esc(plan.name), when: esc(when) }));
  log(`${actor.name}: readies ${plan.name} — ${trigger}${plan.targetName ? ` (${plan.targetName})` : ""}${plan.slot ? `, slot ${plan.slot} spent, held` : ""}`);
  return plan;
}

/* -------------------------------------------- */
/*  Déclencheurs « attaque » et « lance un sort » */
/* -------------------------------------------- */

/** Attend que l'action née de ce message d'utilisation soit résolue (dégâts appliqués) ; sans résolution du moteur, un instant. */
async function actionSettled(usageId) {
  const related = () => game.messages.contents.map(m => current(m.getFlag(MODULE_ID, "resolution")))
    .filter(r => r && ((r.carrier === usageId) || (r.origin === usageId)));
  for ( let waited = 0; waited < 20000; waited += 250 ) {
    const all = related();
    if ( !all.length && (waited >= 1500) ) return;
    if ( all.length && all.every(r => ["done", "missed", "undone"].includes(r.step)) ) return;
    await sleep(250);
  }
}

/** MJ actif : une créature vient d'utiliser une attaque ou un sort — ceux qui s'étaient tenus prêts contre cela réagissent après. */
async function onUsage(message) {
  if ( !game.combat?.started ) return;
  const activity = message.getAssociatedActivity?.();
  const source = tokenOf(activity?.actor) ?? null;
  if ( !activity || !source?.parent ) return;
  const kinds = [];
  if ( activity.type === "attack" ) kinds.push("attacks");
  if ( activity.item?.type === "spell" ) kinds.push("casts");
  if ( !kinds.length ) return;
  const watchers = [];
  for ( const combatant of game.combat.combatants ) {
    const other = combatant.token;
    if ( !other?.actor || (other === source) || (other.parent !== source.parent) || isObjectToken(other) || combatant.isDefeated ) continue;
    const plan = readyPlanOf(readBudget(combatant));
    const kind = kinds.find(k => plan?.trigger === k);
    if ( kind ) watchers.push({ other, kind });
  }
  if ( !watchers.length ) return;
  await actionSettled(message.id);
  for ( const { other, kind } of watchers ) {
    const plan = readyPlanOf(readBudget(combatantFor(other.actor)));
    if ( !plan || ((other.actor.system.attributes?.hp?.value ?? 0) <= 0) || ((source.actor?.system.attributes?.hp?.value ?? 0) <= 0) ) continue;
    const state = { enemies: areEnemies(other, source), sees: canSee(other, source) ?? true, ...reactionState(other.actor) };
    if ( !readyTriggered(plan, { kind, source: source.uuid }, state) ) continue;
    // Hors de portée de l'action préparée : elle ne peut pas partir contre lui (la portée normale ; une portée illimitée passe).
    if ( plan.reach ) {
      const reach = lengthIn(plan.reach.value, plan.reach.units, source.parent.grid.units, readUnitFactors());
      if ( distanceBetween(other, source).value > reach + 1e-6 ) { log(`${source.name} ${kind}: out of ${other.name}'s readied ${plan.name} range`); continue; }
    }
    await releaseReady(other, source, kind);
  }
}

/* -------------------------------------------- */
/*  Fin du plan                                 */
/* -------------------------------------------- */

/** MJ actif, au début du tour d'un combattant : son sort préparé non libéré est perdu (le budget, lui, est remis à neuf). */
async function onTurnStart(combat, prior, now) {
  const actor = combat.combatants.get(now?.combatantId)?.actor;
  const held = (actor?.effects ?? []).filter(e => e.getFlag?.(MODULE_ID, "readied"));
  if ( !held.length ) return;
  await actor.deleteEmbeddedDocuments("ActiveEffect", held.map(e => e.id));
  const token = tokenOf(actor);
  if ( token ) notice(token, loc("Pret.Perdu"), "ended");
  log(`${actor.name}: readied spell not released before their turn, lost`);
}

/** MJ actif : la concentration qui retenait un sort préparé est rompue — le plan tombe (sauf s'il vient d'être libéré). */
async function onHeldEnded(effect) {
  if ( !effect.getFlag?.(MODULE_ID, "readied") ) return;
  const combatant = combatantFor(effect.parent);
  const plan = combatant ? readyPlanOf(readBudget(combatant)) : null;
  if ( !plan || (plan.held !== effect.uuid) ) return;
  await sleep(1500);   // libéré : la carte d'utilisation retire le plan d'elle-même (runtime/turn.mjs)
  const still = readyPlanOf(readBudget(combatant));
  if ( !still || (still.held !== effect.uuid) || game.messages.contents.slice(-10).some(m => m.getFlag(MODULE_ID, "readiedRelease")
    && (m.getAssociatedActor?.() === effect.parent)) ) return;
  await writeBudget(combatant, { ...readBudget(combatant), readied: false });
  const token = tokenOf(effect.parent);
  if ( token ) notice(token, loc("Pret.Perdu"), "ended");
  log(`${effect.parent.name}: concentration on the readied spell broken, the readied action is lost`);
}

export function registerReady() {
  route("dnd5e.postUseActivity", activity => { onReadyUsed(activity).catch(err => console.error(`${MODULE_ID} | Ready`, err)); },
    { label: "Ready: readied action not chosen" });
  route("createChatMessage", message => ((message.type === "usage") ? onUsage(message) : null),
    { executor: true, label: "Ready: \"attacks / casts a spell\" trigger not checked" });
  route("combatTurnChange", onTurnStart, { executor: true, label: "Ready: held spell not lost at turn start" });
  route("deleteActiveEffect", onHeldEnded, { executor: true, label: "Ready: broken concentration not noted" });
}
