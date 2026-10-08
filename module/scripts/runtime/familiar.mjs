/**
 * Familiers (SPEC §107) : vision à l'invocation, et la poche dimensionnelle d'Appel de familier (PHB 2024) — « par une action
 * Magie, vous pouvez congédier temporairement le familier dans une poche dimensionnelle » ; « par une action Magie tant qu'il
 * est congédié temporairement, vous pouvez le faire réapparaître dans un espace inoccupé à 9 m ou moins de vous ». Les actions
 * de base du familier sont posées par runtime/basics.mjs.
 *
 *  - Les intentions (`dismissFamiliar`, `recallFamiliar`) partent du client de celui qui agit : contrôle souple (§6) du
 *    budget du maître en combat (son action, à son tour), puis requête au MJ actif — un joueur ne crée ni ne supprime de token
 *    dans le monde de la table.
 *  - Chez le MJ actif, le congé : ce que le familier porte tombe au sol par le hook `dnd5e-combat.dropItems` (un module voisin
 *    qui s'en charge, §40.3 ; sans voisin, les objets restent sur sa fiche, gardés avec lui), ses combattants sont retirés, son
 *    token est noté dans la poche du maître (adapter/familiar.mjs) puis supprimé, l'action du maître est dépensée.
 *  - Le rappel : la poche est vidée PUIS le token recréé à la case choisie (le delta revient avec lui : PV, effets, items) ;
 *    sa création passe par les routes ordinaires d'une invocation — il rentre au combat de son maître et y lance sa propre
 *    initiative (§16.13, `initiative: "own"`), son heure de fin (Compagnon sauvage) reste celle de l'invocation
 *    (adapter/summons.mjs `noteSummonExpiry`).
 *  - Relancer le sort pendant que le familier est dans la poche en invoque un nouveau (dnd5e) : « un seul familier » — la
 *    poche se vide à la création du nouveau token.
 */

import { MODULE_ID } from "../constants.mjs";
import { POCKET_COST, carriedItemIds, recalledTokenData } from "../core/familiar.mjs";
import { isFamiliarItem, isFamiliarToken, masterOf, pocketOf, storeInPocket, emptyPocket, recallSpot } from "../adapter/familiar.mjs";
import { droppedByNeighbour } from "../adapter/orders.mjs";
import { budgetIssues, spendBudget } from "./neighbours.mjs";
import { askAnyway } from "./turn.mjs";
import { route } from "./router.mjs";
import { log, loc, notice } from "./shared.mjs";

export const POCKET_QUERY = `${MODULE_ID}.familiarPocket`;
export const RECALL_QUERY = `${MODULE_ID}.familiarRecall`;

/** Ce client peut-il congédier ce familier : il possède son maître (le MJ, toujours). */
export function canPocket(tokenDoc) {
  return !!tokenDoc && isFamiliarToken(tokenDoc) && (masterOf(tokenDoc)?.isOwner === true);
}

/** Ce client peut-il rappeler le familier de ce maître : il le possède, et sa poche n'est pas vide. */
export function canRecall(masterToken) {
  return !!masterToken?.actor?.isOwner && !!pocketOf(masterToken.actor);
}

/** Le familier gardé dans la poche du maître de ce token : `{ name, img }`, ou null. */
export function pocketedFamiliar(masterToken) {
  const pocket = pocketOf(masterToken?.actor);
  return pocket ? { name: pocket.name ?? pocket.token.name, img: pocket.img ?? null } : null;
}

/** Ce qui refuse la case sous ce point pour le rappel (texte court), ou null. */
export function recallRefusal(masterToken, point) {
  const spot = recallSpot(masterToken, point);
  if ( !spot ) return loc("Familier.PocheVide");
  if ( spot.problem === "far" ) return loc("Retour.HorsDePortee");
  if ( spot.problem === "occupied" ) return loc("Familier.CaseOccupee");
  return null;
}

/** Mode souple (§6) : en combat, l'action du maître — on dit ce qui cloche, il décide. Rend vrai pour continuer. */
async function legalForMaster(master, title) {
  const issues = budgetIssues(master, POCKET_COST);
  if ( !issues.length ) return true;
  return askAnyway(`${title} — ${master.name}`, issues.map(issue => loc(`Souci.${issue}`)));
}

function askGM(query, payload, here) {
  const gm = game.users.activeGM;
  if ( !gm ) { ui.notifications.warn(loc("Familier.SansMJ")); return false; }
  if ( gm.isSelf ) return here(payload, { user: game.user });
  return gm.query(query, payload, { timeout: 15000 }).catch(err => { console.warn(`${MODULE_ID} | familier`, err); return false; });
}

/**
 * Intention : congédier ce familier dans sa poche dimensionnelle. Rend vrai si c'est fait.
 * @param {TokenDocument} tokenDoc
 */
export async function dismissFamiliar(tokenDoc) {
  if ( !canPocket(tokenDoc) ) return false;
  const master = masterOf(tokenDoc);
  if ( !(await legalForMaster(master, loc("Familier.Renvoyer", { name: tokenDoc.name }))) ) return false;
  return (await askGM(POCKET_QUERY, { token: tokenDoc.uuid }, handlePocket)) === true;
}

/**
 * Intention : rappeler le familier du maître de ce token, sous ce point. Rend vrai si c'est fait ; faux si la case est
 * refusée (la visée peut continuer) ou si l'on a renoncé.
 * @param {TokenDocument} masterToken
 * @param {{x: number, y: number}} point
 */
export async function recallFamiliar(masterToken, point) {
  if ( !canRecall(masterToken) ) return false;
  const refusal = recallRefusal(masterToken, point);
  if ( refusal ) { notice(masterToken, refusal, "refused"); return false; }
  const name = pocketedFamiliar(masterToken)?.name ?? "";
  if ( !(await legalForMaster(masterToken.actor, loc("Familier.Rappeler", { name }))) ) return false;
  return (await askGM(RECALL_QUERY, { token: masterToken.uuid, point: { x: point.x, y: point.y } }, handleRecall)) === true;
}

async function say(actor, key, data, flag) {
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${loc(key, data)}</p>`,
    flags: { [MODULE_ID]: { familiar: flag } }
  });
}

/** Côté MJ actif : le familier part dans la poche de son maître. */
export async function handlePocket({ token: tokenUuid }, { user }={}) {
  const token = await fromUuid(tokenUuid);
  const master = token ? masterOf(token) : null;
  if ( !master || (user && !master.testUserPermission(user, "OWNER")) ) return false;
  // « Il laisse dans son espace tout ce qu'il portait » : à un module voisin de le poser au sol.
  const carried = carriedItemIds(token.actor?.items.contents.map(i => i.toObject()), MODULE_ID)
    .map(id => token.actor.items.get(id)).filter(Boolean);
  const dropped = carried.length ? await droppedByNeighbour(token, carried) : false;
  if ( carried.length ) log(`${token.name} : ${carried.map(i => i.name).join(", ")} ${dropped ? "laissé(s) au sol" : "gardé(s) avec lui (aucun module ne pose au sol)"}`);
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter(c => (c.sceneId === token.parent.id) && (c.tokenId === token.id)).map(c => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  await storeInPocket(master, token);
  await token.delete();
  await spendBudget(master, POCKET_COST);
  await say(master, "Familier.Renvoye", { name: master.name, familiar: token.name }, { pocket: token.name });
  log(`${token.name} : dans la poche dimensionnelle de ${master.name}`);
  return true;
}

/** Côté MJ actif : le familier revient à la case choisie (refusée de nouveau ici si elle ne va plus). */
export async function handleRecall({ token: tokenUuid, point }, { user }={}) {
  const masterToken = await fromUuid(tokenUuid);
  const master = masterToken?.actor;
  const pocket = pocketOf(master);
  if ( !pocket || (user && !master.testUserPermission(user, "OWNER")) ) return false;
  const spot = recallSpot(masterToken, point);
  if ( !spot || spot.problem ) return false;
  if ( !game.actors.get(pocket.token.actorId) ) {
    ui.notifications.warn(loc("Familier.ActeurPerdu", { name: pocket.name }));
    return false;
  }
  const data = recalledTokenData(pocket.token, spot, MODULE_ID);
  await emptyPocket(master);
  let created = null;
  try { [created] = await masterToken.parent.createEmbeddedDocuments("Token", [data]); }
  catch(err) {
    console.error(`${MODULE_ID} | familier non rappelé`, err);
    await master.setFlag(MODULE_ID, "pocket", pocket);   // rien n'est perdu
    return false;
  }
  if ( !created ) { await master.setFlag(MODULE_ID, "pocket", pocket); return false; }
  await spendBudget(master, POCKET_COST);
  await say(master, "Familier.Rappele", { name: master.name, familiar: created.name }, { recall: created.name });
  log(`${created.name} : revenu de la poche dimensionnelle de ${master.name}`);
  return true;
}

/**
 * Vision : le token du familier voit (`sight.enabled`) — son joueur voit par ses yeux. dnd5e (réglage `senseVisionSync`)
 * règle ensuite portée et mode d'après ses sens, sans toucher à `enabled` (documents/token.mjs:77-80, 123-134). Le hook `dnd5e.summonToken` passe les données du token
 * avant leur création, sur le client qui invoque (documents/activity/summon.mjs:192, créées à :204).
 */
function onSummonToken(activity, profile, tokenData) {
  if ( !isFamiliarItem(activity?.item) ) return;
  if ( tokenData.sight?.enabled === true ) return;
  tokenData.sight = { ...(tokenData.sight ?? {}), enabled: true };
  log(`${tokenData.name} : familier, vision activée`);
}

/** MJ actif : les familiers déjà posés sans vision (invoqués avant cette version) la reçoivent. */
async function sightForPlaced() {
  for ( const scene of game.scenes ) {
    const updates = scene.tokens.filter(t => !t._source.sight?.enabled && isFamiliarToken(t)).map(t => ({ _id: t.id, "sight.enabled": true }));
    if ( !updates.length ) continue;
    await scene.updateEmbeddedDocuments("Token", updates);
    log(`${scene.name} : vision activée pour ${updates.length} familier(s)`);
  }
}

export function registerFamiliars() {
  CONFIG.queries[POCKET_QUERY] = handlePocket;
  CONFIG.queries[RECALL_QUERY] = handleRecall;
  route("dnd5e.summonToken", onSummonToken, { label: "familier : vision non activée" });
  route("ready", sightForPlaced, { executor: true, label: "familier : vision non activée" });
  // « Un seul familier » : un nouveau familier invoqué vide la poche (le rappel la vide AVANT de recréer le sien).
  route("createToken", async tokenDoc => {
    const master = isFamiliarToken(tokenDoc) ? masterOf(tokenDoc) : null;
    if ( !pocketOf(master) ) return;
    await emptyPocket(master);
    log(`${master.name} : nouveau familier (${tokenDoc.name}), l'ancien quitte la poche dimensionnelle`);
  }, { executor: true, label: "familier : poche non vidée" });
}
