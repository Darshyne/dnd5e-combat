/**
 * §213 : Armes improvisées (règles 2024) — demandées au MJ.
 *  - L'action de base « Arme improvisée » (content/actions.mjs, sans coût par elle-même) : le joueur nomme l'objet (« une chaise ») et
 *    le geste (frapper au corps à corps, ou lancer).
 *  - Le MJ actif reçoit la demande et décide : refuser ; accepter comme arme improvisée (1d4, le type de dégâts qu'il juge logique,
 *    portée de lancer 6/18 m) ; ou accepter « comme » une arme du jeu (`CONFIG.DND5E.weaponIds` : un pied de table comme un gourdin),
 *    dont la créature prend les dégâts, les propriétés et la maîtrise.
 *  - Accepté : une arme temporaire (`flags.dnd5e-combat.improvised`) est posée sur la fiche, et son attaque part aussitôt (en visée sans
 *    cible) — une attaque d'arme comme une autre (l'action Attaquer, Attaque supplémentaire). Arme improvisée : sans maîtrise, sauf le
 *    don Bagarreur de taverne (« maîtrise des armes improvisées » ; dnd5e ne la donne qu'au drapeau 2014 `tavernBrawlerFeat`,
 *    data/item/weapon.mjs:372). L'arme temporaire disparaît à la fin du tour de la créature, avec le combat, ou à la demande suivante.
 */

import { MODULE_ID } from "../constants.mjs";
import { basicActionOf } from "../adapter/basics.mjs";
import { identifierOf } from "../adapter/content.mjs";
import { tokenOf } from "../adapter/facts.mjs";
import { route } from "./router.mjs";
import { esc, log, loc, say, viaActiveGM } from "./shared.mjs";

export const IMPROVISED_QUERY = `${MODULE_ID}.improvised`;
const FLAG = "improvised";
/** Le temps laissé au MJ pour décider. */
const GM_TIMEOUT = 120000;
/** Types de dégâts proposés au MJ pour une arme improvisée. */
const DAMAGE_TYPES = ["bludgeoning", "piercing", "slashing", "fire", "cold", "acid", "lightning", "poison"];

/* -------------------------------------------- */
/*  Côté joueur : la demande                    */
/* -------------------------------------------- */

/** La fenêtre du joueur : l'objet et le geste ; null si fermée. */
async function askObject(actor) {
  const content = `<p>${loc("Improvise.Intro")}</p>
    <div class="form-group"><label>${loc("Improvise.Objet")}</label><input type="text" name="object" placeholder="${esc(loc("Improvise.Exemple"))}" autofocus></div>
    <div class="form-group"><label>${loc("Improvise.Geste")}</label><select name="mode">
      <option value="melee">${loc("Improvise.Frapper")}</option><option value="thrown">${loc("Improvise.Lancer")}</option></select></div>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Improvise.Titre", { name: actor.name }) }, content, rejectClose: false, position: { width: 420 },
    buttons: [
      { action: "ask", label: loc("Improvise.Demander"), icon: "fa-solid fa-paper-plane", default: true,
        callback: (event, button) => ({ object: button.form.elements.object.value.trim(), mode: button.form.elements.mode.value }) },
      { action: "cancel", label: loc("Improvise.Annuler"), icon: "fa-solid fa-xmark" }
    ]
  });
  return (answer && (typeof answer === "object") && answer.object) ? answer : null;
}

/* -------------------------------------------- */
/*  Côté MJ : la décision                       */
/* -------------------------------------------- */

/** Les armes du jeu proposées au MJ (`CONFIG.DND5E.weaponIds`), par nom. */
function weaponChoices() {
  return Object.entries(CONFIG.DND5E.weaponIds ?? {})
    .map(([id, uuid]) => ({ id, name: fromUuidSync(uuid, { strict: false })?.name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/** MJ actif : la demande d'un joueur — refuser, ou accepter (arme improvisée, ou comme une arme du jeu). */
async function handleRequest({ actor: actorUuid, object, mode, user }) {
  const actor = await fromUuid(actorUuid ?? "");
  if ( !actor ) return { accepted: false };
  const opt = (value, label) => `<option value="${esc(value)}">${esc(label)}</option>`;
  const asker = game.users.get(user)?.name ?? "";
  const content = `<p>${loc("Improvise.DemandeMJ", { user: esc(asker), name: esc(actor.name), object: esc(object), mode: esc(loc(mode === "thrown" ? "Improvise.Lancer" : "Improvise.Frapper")) })}</p>
    <div class="form-group"><label>${loc("Improvise.CommeQuoi")}</label><select name="as">
      ${opt("", loc("Improvise.Improvisee"))}${weaponChoices().map(w => opt(w.id, loc("Improvise.Comme", { weapon: w.name }))).join("")}</select></div>
    <div class="form-group"><label>${loc("Improvise.TypeDegats")}</label><select name="type">
      ${DAMAGE_TYPES.map(t => opt(t, game.i18n.localize(CONFIG.DND5E.damageTypes[t]?.label ?? t))).join("")}</select></div>
    <p class="hint">${loc("Improvise.AideMJ")}</p>`;
  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Improvise.TitreMJ") }, content, rejectClose: false, position: { width: 460 },
    buttons: [
      { action: "accept", label: loc("Improvise.Accepter"), icon: "fa-solid fa-check", default: true,
        callback: (event, button) => ({ accepted: true, as: button.form.elements.as.value || null, type: button.form.elements.type.value }) },
      { action: "refuse", label: loc("Improvise.Refuser"), icon: "fa-solid fa-ban", callback: () => ({ accepted: false }) }
    ]
  });
  const verdict = (answer && (typeof answer === "object")) ? answer : { accepted: false };
  log(`improvised weapon asked by ${actor.name} (${object}, ${mode}): ${verdict.accepted ? `accepted${verdict.as ? ` as ${verdict.as}` : ` (1d4 ${verdict.type})`}` : "refused"}`);
  return verdict;
}

/* -------------------------------------------- */
/*  L'arme temporaire                           */
/* -------------------------------------------- */

/** Le don Bagarreur de taverne (2024) donne la maîtrise des armes improvisées. */
const tavernBrawler = actor => (actor?.items ?? []).some(i => identifierOf(i).id === "tavern-brawler") || !!actor?.getFlag?.("dnd5e", "tavernBrawlerFeat");

/** Les données de l'arme improvisée générique : 1d4 du type choisi, à lancer 6/18 m si lancée. */
function improvisedData(actor, { object, mode, type }) {
  const thrown = mode === "thrown";
  const activityId = "dnd5eCombatImprv";
  return {
    name: loc("Improvise.NomArme", { object }),
    type: "weapon",
    img: "icons/svg/hanging-sign.svg",
    system: {
      description: { value: `<p>${loc("Improvise.TexteArme")}</p>` },
      type: { value: "improv", baseItem: "" },
      proficient: tavernBrawler(actor) ? 1 : 0,
      equipped: true,
      quantity: 1,
      properties: thrown ? ["thr"] : [],
      range: thrown ? { value: 20, long: 60, reach: 5, units: "ft" } : { reach: 5, units: "ft" },
      damage: { base: { number: 1, denomination: 4, types: [type || "bludgeoning"] } },
      activities: {
        [activityId]: { _id: activityId, type: "attack", activation: { type: "action", value: 1 },
          target: { affects: { type: "creature", count: "1" }, prompt: false },
          attack: { ability: "", type: { value: "melee", classification: "weapon" } }, damage: { includeBase: true, parts: [] } }
      }
    }
  };
}

/** Les données d'une arme du jeu prise « comme » : la sienne, renommée d'après l'objet. */
async function asWeaponData(weaponId, { object }) {
  const source = await fromUuid(CONFIG.DND5E.weaponIds?.[weaponId] ?? "");
  if ( !source ) return null;
  const data = source.toObject();
  delete data._id;
  data.name = loc("Improvise.NomComme", { object, weapon: source.name });
  data.system.equipped = true;
  data.system.quantity = 1;
  return data;
}

/** Retire les armes temporaires de cet acteur. */
async function dropTemporary(actor) {
  const ids = (actor?.items ?? []).filter(i => i.getFlag(MODULE_ID, FLAG)).map(i => i.id);
  if ( ids.length ) await actor.deleteEmbeddedDocuments("Item", ids);
}

/** `dnd5e.postUseActivity`, sur le client qui a pris l'action : la demande, la décision du MJ, l'arme posée et l'attaque. */
async function onImprovisedUsed(activity) {
  if ( basicActionOf(activity?.item) !== "improvised" ) return;
  const actor = activity.actor;
  if ( !actor?.isOwner ) return;
  const request = await askObject(actor);
  if ( !request ) return;
  const token = tokenOf(actor);
  ui.notifications.info(loc("Improvise.Attente"));
  const verdict = await viaActiveGM(IMPROVISED_QUERY, handleRequest, { actor: actor.uuid, ...request, user: game.user.id },
    { timeout: GM_TIMEOUT, noGm: "Improvise.SansMJ", fallback: { accepted: false } });
  if ( !verdict?.accepted ) {
    ui.notifications.warn(loc("Improvise.Refuse", { object: request.object }));
    await say({ actor, token }, loc("Improvise.CarteRefus", { name: esc(actor.name), object: esc(request.object) }));
    return;
  }
  const data = verdict.as ? await asWeaponData(verdict.as, request) : improvisedData(actor, { ...request, type: verdict.type });
  if ( !data ) return;
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [FLAG]: { object: request.object, mode: request.mode } } };
  await dropTemporary(actor);
  const [item] = await actor.createEmbeddedDocuments("Item", [data]);
  const attack = item?.system.activities?.find(a => a.type === "attack");
  await say({ actor, token }, loc("Improvise.CarteAccord", { name: esc(actor.name), object: esc(request.object), weapon: esc(item?.name ?? "") }));
  log(`${actor.name}: improvised weapon ${item?.name} (${request.mode})`);
  if ( !attack ) return;
  // Lancer : le mode « lancer » de dnd5e, tenu par le moteur jusqu'au jet (§150) — une arme du jeu sans Lancer reste lancée comme le
  // MJ l'a acceptée.
  const thrown = (request.mode === "thrown") && item.system.properties?.has?.("thr");
  await attack.use({ [MODULE_ID]: thrown ? { attackMode: "thrown" } : {} });
}

/** MJ actif : à la fin du tour d'une créature, ses armes temporaires disparaissent (avec le combat aussi). */
function onTurnEnd(combat, prior) {
  const actor = combat.combatants.get(prior?.combatantId)?.actor;
  if ( actor ) dropTemporary(actor).catch(err => console.error(`${MODULE_ID} | improvised weapon`, err));
}

async function onCombatEnd(combat) {
  for ( const combatant of combat.combatants ) await dropTemporary(combatant.actor).catch(() => {});
}

export function registerImprovised() {
  CONFIG.queries[IMPROVISED_QUERY] = handleRequest;
  route("dnd5e.postUseActivity", activity => { onImprovisedUsed(activity).catch(err => console.error(`${MODULE_ID} | improvised weapon`, err)); },
    { label: "improvised weapon: not requested" });
  route("combatTurnChange", onTurnEnd, { executor: true, label: "improvised weapon: not removed at end of turn" });
  route("deleteCombat", onCombatEnd, { executor: true, label: "improvised weapon: not removed with the combat" });
}
