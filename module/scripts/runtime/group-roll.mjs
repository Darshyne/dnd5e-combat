/**
 * §242 (issue #18) : jets demandés par le MJ à plusieurs personnages, à la manière de BG3.
 *
 *  - **Demande** (MJ) : `requestGroupRoll({ actors, type, key, dc, hideDc, advantage, disadvantage, bonus, label, group })` pose la
 *    carte de demande de dnd5e (`type: "request"`), une ligne par personnage, puis fait lancer chacun : le joueur connecté qui le
 *    possède reçoit la demande sur son écran (requête `user.query`, comme les sauvegardes du moteur) ; ce client lance pour les PNJ et
 *    les personnages sans joueur connecté, sans fenêtre. Rend la promesse du point final (`viewOf`, adapter/group-roll.mjs).
 *  - **Chez le joueur** : avant d'ouvrir quoi que ce soit, le hook `dnd5e-combat.groupRollPrompt` (`Hooks.callAll`) laisse une
 *    interface voisine prendre la demande à son compte (fenêtre à la BG3) : elle met dans `prompt.result` la promesse de son issue
 *    (une valeur de retour ne suffirait pas : un voisin écoute souvent par `Hooks.on`, qui l'ignore) ; le prompt lui donne de quoi
 *    faire (`roll()`, `aids`, `askAid()`, `breakdown`, `signal`). Sans preneur, la fenêtre de jet
 *    de dnd5e s'ouvre, avec la section « Aides » du moteur (ui/skill-aid.mjs). Au délai (réglage `groupRollSeconds`, 0 : sans limite)
 *    la fenêtre se ferme et le jet part tout seul, comme une sauvegarde de concentration (§141). Fermée par le joueur : rien n'est
 *    lancé, le bouton de la carte reste.
 *  - **Résultats** : chaque jet porte `flags.dnd5e-combat.groupRollResult` (la carte) et `groupRollActor` ; le MJ actif le relie à
 *    sa ligne de la carte, un à la fois. Pas le lien de dnd5e (`flags.dnd5e.requestResult`, request-message-data.mjs:141-188) : il
 *    réécrit toutes les lignes à partir de l'état local à chaque jet, et deux jets presque simultanés s'écraseraient.
 *    À chaque changement de la carte, sur chaque client, le hook `dnd5e-combat.groupRoll` (`Hooks.callAll`) donne le point, filtré
 *    pour un joueur quand le DD est caché (core/group-roll.mjs `visibleTo`) ; `final: true` la première fois que tout le monde a lancé.
 *
 * Le moteur ne nomme aucun module : un voisin pilote par `api.rolls.request` et affiche par les deux hooks.
 */

import { MODULE_ID } from "../constants.mjs";
import { normalizeRequest, visibleTo } from "../core/group-roll.mjs";
import {
  GROUP_FLAG, GROUP_HANDLER, rollArguments, rollMethodOf, canRoll, testTitle, keyLabel, breakdownOf, requestOf, viewOf, systemModeOf
} from "../adapter/group-roll.mjs";
import { rollerFor } from "../adapter/concentration.mjs";
import { closeRollDialogAfter } from "../adapter/dialogs.mjs";
import { aidsFor, isGuided } from "../adapter/skill-aid.mjs";
import { inspirationOf, offerInspiration, offerRollBonus, keptD20 } from "../adapter/inspiration.mjs";
import { requestSkillAid } from "./skill-aid.mjs";
import { levelAtLeast } from "./levels.mjs";
import { route } from "./router.mjs";
import { log, loc, sleep, isExecutor } from "./shared.mjs";

export const GROUP_ROLL_QUERY = `${MODULE_ID}.groupRoll`;
export const SECONDS_SETTING = "groupRollSeconds";

/** Le délai laissé au joueur, en secondes ; 0 : sans limite. */
const answerSeconds = () => Math.max(0, Number(game.settings.get(MODULE_ID, SECONDS_SETTING)) || 0);

/** Les promesses des demandes faites depuis ce client, par id de carte. */
const pending = new Map();
/** Les cartes dont le point final a déjà été annoncé sur ce client. */
const announced = new Set();
/**
 * Les demandes ouvertes sur ce client (`carte|acteur` → `{ rolling, taken }`) : si le jet de ce personnage arrive d'ailleurs (le MJ a cliqué
 * la carte, un autre propriétaire a lancé), la fenêtre se ferme sans relancer — vu en jeu le 2026-10-24 : deux jets pour une même ligne.
 */
const open = new Map();
const openKey = (messageId, actorUuid) => `${messageId}|${actorUuid}`;

/* -------------------------------------------- */
/*  Demande                                     */
/* -------------------------------------------- */

/** Acteurs, tokens ou uuid → acteurs distincts (un token non lié garde son acteur synthétique). */
function actorsOf(list) {
  const out = new Map();
  for ( const entry of list ?? [] ) {
    let actor = entry;
    if ( typeof entry === "string" ) actor = fromUuidSync(entry);
    if ( actor?.actor ) actor = actor.actor;   // Token ou TokenDocument
    if ( (actor instanceof Actor) && !out.has(actor.uuid) ) out.set(actor.uuid, actor);
  }
  return [...out.values()];
}

/**
 * Pose la demande et fait lancer chacun. MJ seulement.
 * @param {object} options        La demande (core/group-roll.mjs `normalizeRequest`) et :
 * @param {Array<Actor|Token|TokenDocument|string>} options.actors
 * @returns {Promise<object>}     Le point final (adapter/group-roll.mjs `viewOf`), quand tout le monde a lancé ou que la carte est
 *   supprimée (`cancelled: true`).
 */
export async function requestGroupRoll({ actors, ...input }={}) {
  if ( !game.user.isGM ) throw new Error(`${MODULE_ID} | group roll: only a GM can request rolls`);
  const { request, error } = normalizeRequest(input);
  if ( error ) throw new Error(`${MODULE_ID} | group roll: ${error}`);
  const list = actorsOf(actors).filter(a => canRoll(a, request));
  if ( !list.length ) throw new Error(`${MODULE_ID} | group roll: no character can make this roll`);

  const targets = list.map(actor => ({ actor: actor.uuid, user: rollerFor(actor) }));
  const title = testTitle(request);
  const message = await ChatMessage.implementation.create({
    type: "request",
    speaker: { alias: title },
    content: "",
    system: { handler: GROUP_HANDLER, button: { icon: "fa-solid fa-dice-d20", label: keyLabel(request) }, targets },
    flags: { [MODULE_ID]: { [GROUP_FLAG]: request } }
  });
  const { promise, resolve } = Promise.withResolvers();
  pending.set(message.id, resolve);
  log(`group roll: ${title}${request.label ? ` (${request.label})` : ""}${request.dc !== null ? `, DC ${request.dc}${request.hideDc ? " hidden" : ""}` : ""}`
    + ` — ${list.map(a => a.name).join(", ")}`);

  // Les joueurs en parallèle ; ce client lance pour les autres, sans fenêtre.
  for ( const [i, actor] of list.entries() ) {
    const userId = targets[i].user;
    if ( userId ) askPlayer(userId, message, actor);
    else await rollFor(message, actor, { configure: false }).catch(err => console.error(`${MODULE_ID} | group roll: ${actor.name} not rolled`, err));
  }
  return promise;
}

/** La demande au joueur ; s'il ne répond pas (déconnecté), ce client lance pour lui. */
function askPlayer(userId, message, actor) {
  const seconds = answerSeconds();
  // Sans limite côté joueur : la requête attend une heure (il peut aussi lancer plus tard depuis la carte).
  const timeout = (seconds ? seconds + 30 : 3600) * 1000;
  game.users.get(userId).query(GROUP_ROLL_QUERY, { request: message.id, actor: actor.uuid }, { timeout })
    .then(answer => {
      if ( answer === "cancelled" ) log(`group roll: ${actor.name}'s player closed the roll window (the card button stays)`);
    })
    .catch(async err => {
      if ( resultOf(game.messages.get(message.id), actor) ) return;
      console.warn(`${MODULE_ID} | group roll: no answer for ${actor.name}, rolled by the GM`, err);
      await rollFor(message, actor, { configure: false }).catch(e => console.error(`${MODULE_ID} | group roll: ${actor.name} not rolled`, e));
    });
}

/** Le jet déjà relié à la ligne de cet acteur, ou null. */
function resultOf(message, actor) {
  return message?.system?.targets?.find(t => t.actor === actor.uuid)?.result ?? null;
}

/**
 * Le jet de dnd5e pour un acteur de la demande.
 * @param {ChatMessage} message
 * @param {Actor} actor
 * @param {{configure?: boolean, advantage?: boolean, disadvantage?: boolean}} [options]
 * @returns {Promise<ChatMessage|true|null>}  Le message du jet (true s'il n'est pas lisible), ou null (fenêtre fermée).
 */
async function rollFor(message, actor, { configure=false, advantage=false, disadvantage=false, mode=null, aids=[], flags={}, deferBonus=false }={}) {
  const request = requestOf(message);
  const method = rollMethodOf(actor, request?.type);
  if ( !method ) return null;
  const [config, messageConfig] = rollArguments(request, { requestId: message.id, actor, showDc: !request.hideDc,
    extra: { advantage, disadvantage, mode, aids }, flags });
  const rolls = await method(config, { configure }, messageConfig);
  if ( !rolls?.length ) return null;
  // Le jet de dnd5e ne rend que ses `D20Roll` : le message se retrouve par nos flags (le plus récent pour cet acteur).
  const posted = game.messages.contents.findLast(m => (m.getFlag(MODULE_ID, "groupRollResult") === message.id)
    && (m.getFlag(MODULE_ID, "groupRollActor") === actor.uuid));
  // Les dés « après avoir vu le jet » : tout de suite, sauf quand l'interface les demande elle-même après avoir montré le résultat.
  if ( posted && !deferBonus ) await bonusAfterRoll(message, actor, posted);
  return posted ?? true;
}

/**
 * Les dés que la créature ajoute après avoir vu son jet — un dé d'aptitude sur un test (Embuscade, Autorité naturelle… : runtime/roll-bonus.mjs
 * pour les jets libres), puis l'Inspiration bardique qu'elle porte, « quand elle rate un Test d20 » (tests et sauvegardes) — comptés dans le
 * total de la demande : flag `groupRollBonus` `{ total, parts }` sur le jet (le jet de dnd5e n'est pas réécrit). DD visible : rien sur une
 * réussite ; DD caché : la question ne le dit pas (et rien n'est proposé sur une réussite).
 * @returns {Promise<{added: number, parts: Array<{kind: string, value: number, helper?: string, img?: string}>}>}
 */
async function bonusAfterRoll(message, actor, posted) {
  const none = { added: 0, parts: [] };
  if ( !(posted instanceof ChatMessage) || (posted.getFlag(MODULE_ID, "groupRollPending") !== true) ) return none;
  try { return await decideBonus(message, actor, posted); }
  finally {
    // Tranché (ou rien à proposer) : le test se conclut — la carte, le verdict et le suivi du MJ le voient maintenant.
    await posted.setFlag(MODULE_ID, "groupRollPending", false).catch(err => console.warn(`${MODULE_ID} | group roll: result not released`, err));
  }
}

async function decideBonus(message, actor, posted) {
  const none = { added: 0, parts: [] };
  const request = requestOf(message);
  const roll = posted?.rolls?.[0];
  if ( !request || !Number.isFinite(roll?.total) || posted.getFlag(MODULE_ID, "groupRollBonus") ) return none;
  const dc = request.dc;
  const shownDc = request.hideDc ? null : dc;
  if ( (dc !== null) && (roll.total >= dc) ) return none;
  const what = keyLabel(request);
  const parts = [];
  let added = 0;
  // Hors combat, le joueur a le temps de lire : le délai de la demande (au moins 20 s), pas celui des fenêtres de combat (10 s — vu par
  // l'utilisateur : la question se refermait avant qu'il puisse s'en servir).
  const seconds = Math.max(20, answerSeconds() || 60);
  if ( request.type !== "save" ) {
    const n = await offerRollBonus(actor, { kind: "check", what, total: roll.total, needed: shownDc,
      skill: request.type === "skill" ? request.key : null, d20: keptD20(roll), seconds });
    if ( n ) { added += n; parts.push({ kind: "feature", value: n }); }
  }
  if ( (dc === null) || ((roll.total + added) < dc) ) {
    const inspiration = inspirationOf(actor);
    const save = request.type === "save";
    const n = await offerInspiration(actor, { what: save ? testTitle(request) : what, total: roll.total + added, needed: shownDc,
      test: !save, save, seconds });
    if ( n ) {
      added += n;
      parts.push({ kind: "inspiration", value: n, helper: inspiration?.bard ?? "", img: inspiration?.source?.img ?? null });
    }
  }
  if ( !added ) return none;
  await posted.setFlag(MODULE_ID, "groupRollBonus", { total: added, parts });
  log(`group roll: ${actor.name} adds ${added} after the roll (${parts.map(p => p.kind).join(", ")}), ${roll.total} → ${roll.total + added}`);
  return { added, parts };
}

/* -------------------------------------------- */
/*  Chez celui qui lance                        */
/* -------------------------------------------- */

/** Attend que l'effet d'une aide soit posé (la résolution passe par le MJ actif). */
async function untilApplied(test, ms=10000) {
  for ( let waited = 0; waited < ms; waited += 250 ) {
    if ( test() ) return true;
    await sleep(250);
  }
  return false;
}

/**
 * La demande, sur le client qui lance pour `actor` : une interface voisine la prend, sinon la fenêtre de jet de dnd5e.
 * @returns {Promise<"rolled"|"cancelled">}
 */
export async function promptGroupRoll(message, actor) {
  const request = requestOf(message);
  if ( !request || !actor ) return "cancelled";
  if ( resultOf(message, actor) ) return "rolled";
  const seconds = answerSeconds();
  const controller = new AbortController();
  let done = null;   // le message du jet, une fois lancé
  const key = openKey(message.id, actor.uuid);
  const { promise: takenElsewhere, resolve: taken } = Promise.withResolvers();
  const entry = { rolling: false, taken: () => { controller.abort("taken"); closeRollDialogAfter(actor, () => {}, 0); taken("taken"); } };
  open.set(key, entry);
  const granted = [];   // les aides accordées, notées sur le jet (fenêtre de suivi du MJ)
  let deferred = false;   // l'interface demandera elle-même les dés d'après le jet (`afterRoll`)
  let bonus = null;
  const afterRoll = async () => {
    if ( bonus ) return bonus;
    bonus = (done instanceof ChatMessage) ? bonusAfterRoll(message, actor, done) : Promise.resolve({ added: 0, parts: [] });
    return bonus;
  };
  const roll = async ({ advantage=false, disadvantage=false, mode=null, configure=false, flags={}, deferBonus=false }={}) => {
    if ( done ) return done;
    if ( resultOf(game.messages.get(message.id), actor) ) return null;   // déjà lancé ailleurs : pas de second jet
    entry.rolling = true;
    deferred = deferBonus;
    try { done = await rollFor(message, actor, { configure, advantage, disadvantage, mode, aids: granted, flags, deferBonus }); }
    finally { entry.rolling = !!done; }
    return done;
  };
  try { return await runPrompt(); }
  finally { open.delete(key); }

  async function runPrompt() {
    const test = { skill: request.type === "skill" ? request.key : null, tool: request.type === "tool" ? request.key : null };
    const aids = ((test.skill || test.tool) && levelAtLeast("full")) ? aidsFor(actor, test) : [];
    const askedKinds = new Set();
    /**
     * Ce que reçoit une interface voisine (hook `dnd5e-combat.groupRollPrompt`). Les champs :
     *  `request` (DD retiré quand il est caché à ce client), `title`, `actor`, `breakdown` (adapter/group-roll.mjs `breakdownOf`),
     *  `aids` (aides possibles d'un test de compétence ou d'outil, adapter/skill-aid.mjs `aidsFor`), `askAid(aid)` → true si accordée
     *  (Soutien : passer alors `advantage: true` à `roll` ; une seule aide de chaque sorte par jet, la seconde rend false),
     *  `mode` : l'Avantage / le Désavantage que dnd5e appliquera de lui-même (`{ advantage, disadvantage }`, fiche, effets, états),
     *  `roll({ advantage, disadvantage, mode, flags })` → le message du jet (une fois) ; `mode` "advantage" | "disadvantage" force l'un
     *  ou l'autre quoi que disent la demande et la fiche ; `flags` : drapeaux d'autres modules posés sur ce message ; `deferBonus` : les
     *  dés d'après le jet (Inspiration bardique…) attendront `afterRoll()` → `{ added, parts }` (l'interface montre d'abord le résultat),
     *  `deadline` (ms depuis l'époque, ou null), `signal` (annulé au délai — fermer sa fenêtre, le moteur lance — ou quand le jet arrive
     *  d'ailleurs — fermer sa fenêtre, rien à lancer), `result` (à remplir).
     */
    const prompt = {
      request: request.hideDc && !game.user.isGM ? { ...request, dc: null } : { ...request },
      title: testTitle(request), message, actor, breakdown: breakdownOf(actor, request), aids, mode: systemModeOf(actor, request),
      askAid: async aid => {
        // Une aide de chaque sorte par jet : deux Assistances ne se cumulent pas, une créature n'a qu'un dé d'Inspiration bardique à la
        // fois, l'Avantage ne se cumule pas. Une sorte déjà demandée (en attente ou accordée) n'est plus demandée.
        if ( askedKinds.has(aid.kind) ) return false;
        askedKinds.add(aid.kind);
        const ok = await requestSkillAid({ kind: aid.kind, helper: aid.helper, tester: aid.tester, ...test });
        if ( !ok ) askedKinds.delete(aid.kind);   // refusée : une autre du même genre peut être demandée
        else granted.push({ kind: aid.kind, helper: aid.helper.name, img: aid.token?.texture?.src ?? aid.helper.img ?? null });
        if ( ok && (aid.kind === "guidance") ) await untilApplied(() => isGuided(actor, test.skill));
        if ( ok && (aid.kind === "inspiration") ) await untilApplied(() => !!inspirationOf(actor));
        return ok;
      },
      roll, afterRoll, deadline: seconds ? Date.now() + (seconds * 1000) : null, signal: controller.signal, result: null
    };
    Hooks.callAll(`${MODULE_ID}.groupRollPrompt`, prompt);
    const claimed = typeof prompt.result?.then === "function";
    if ( claimed ) {
      let timer = null;
      // Le délai ne vaut que tant que le joueur n'a pas lancé : une fois les dés partis, la fenêtre attend la fin (le dé d'Inspiration
      // bardique proposé après un échec — vu par l'utilisateur : la fenêtre se fermait avant qu'il puisse s'en servir).
      const expired = seconds ? new Promise(r => {
        const check = () => { if ( entry.rolling || done ) return; r("expired"); };
        timer = setTimeout(check, seconds * 1000);
      }) : null;
      const answer = await Promise.race([prompt.result.then(() => "answered", err => {
        console.error(`${MODULE_ID} | group roll: the roll window failed`, err);
        return "answered";
      }), takenElsewhere, ...(expired ? [expired] : [])]);
      clearTimeout(timer);
      if ( answer === "taken" ) {
        log(`group roll: ${actor.name} already rolled elsewhere, window closed`);
        return "rolled";
      }
      // Les dés d'après le jet que l'interface n'a pas demandés (fermée trop tôt) : maintenant.
      if ( done && deferred ) await afterRoll();
      if ( answer === "expired" ) {
        controller.abort("expired");
        await roll();
        log(`group roll: ${actor.name} did not roll in time, rolled automatically`);
      }
      return done ? "rolled" : "cancelled";
    }

    // Sans preneur : la fenêtre de dnd5e (et sa section « Aides »), fermée au délai.
    let timedOut = false;
    const cancel = seconds ? closeRollDialogAfter(actor, () => { timedOut = true; }, seconds) : () => {};
    ui.notifications.info(loc("JetGroupe.Demande", { name: actor.name, test: prompt.title }));
    await roll({ configure: true });
    cancel();
    if ( !done && timedOut ) {
      await roll();
      log(`group roll: ${actor.name} did not roll in time, rolled automatically`);
    }
    return done || controller.signal.aborted ? "rolled" : "cancelled";
  }
}

/** La requête, chez le joueur. */
async function handleGroupRollQuery({ request: id, actor: uuid }) {
  const message = game.messages.get(id);
  const actor = await fromUuid(uuid);
  if ( !message || !actor ) return "cancelled";
  return promptGroupRoll(message, actor);
}

/** Le bouton de la carte (`CONFIG.DND5E.requests`) : la même fenêtre. Rien n'est rendu, pour que dnd5e ne relie pas le jet lui-même. */
async function handleCardButton(actor, message) {
  await promptGroupRoll(message, actor);
  return null;
}

/* -------------------------------------------- */
/*  Résultats                                   */
/* -------------------------------------------- */

let linking = Promise.resolve();

/** MJ actif : relie un jet à sa ligne de la carte, un à la fois (chaque écriture part de l'état écrit par la précédente). */
function link(result) {
  const flag = result.getFlag(MODULE_ID, "groupRollResult");
  const actorUuid = result.getFlag(MODULE_ID, "groupRollActor");
  if ( !flag || !actorUuid ) return;
  linking = linking.then(async () => {
    const message = game.messages.get(flag);
    if ( !message ) return;
    const targets = message.system.toObject().targets ?? [];
    const index = targets.findIndex(t => t.actor === actorUuid);
    if ( (index < 0) || (targets[index].result === result.id) ) return;
    // Le premier jet compte : un second (le MJ a cliqué la carte pendant que le joueur lançait) ne remplace pas le premier.
    if ( targets[index].result ) {
      log(`group roll: a second roll for ${fromUuidSync(actorUuid)?.name ?? actorUuid} is ignored (the first one counts)`);
      return;
    }
    targets[index].result = result.id;
    await message.update({ "system.targets": targets });
  }).catch(err => console.error(`${MODULE_ID} | group roll: result not linked`, err));
}

/** Le point d'une carte, annoncé sur ce client. */
function announce(message, { cancelled=false }={}) {
  const view = viewOf(message);
  if ( !view ) return;
  const final = cancelled || (view.done && !announced.has(message.id));
  if ( final ) announced.add(message.id);
  const shown = visibleTo(view, { gm: game.user.isGM });
  Hooks.callAll(`${MODULE_ID}.groupRoll`, { ...shown, final, cancelled });
  if ( final && pending.has(message.id) ) {
    pending.get(message.id)({ ...view, cancelled });
    pending.delete(message.id);
    if ( !cancelled ) log(`group roll: ${testTitle(view.request)} — ${view.entries.map(e => `${e.name} ${e.total}`).join(", ")}`
      + `${view.success === null ? "" : view.success ? " (success)" : " (failure)"}`);
  }
}

/**
 * MJ : lance pour un personnage qui tarde (fenêtre de suivi). Sa fenêtre se ferme chez son joueur (le jet arrive d'ailleurs).
 * @returns {Promise<boolean>}  true si un jet a été fait.
 */
export async function forceGroupRoll(messageId, actorUuid) {
  if ( !game.user.isGM ) return false;
  const message = game.messages.get(messageId);
  const actor = await fromUuid(actorUuid);
  if ( !message || !actor || resultOf(message, actor) ) return false;
  const rolled = await rollFor(message, actor, { configure: false });
  if ( rolled ) log(`group roll: ${actor.name} rolled by the GM (forced)`);
  return !!rolled;
}

/** Le point d'une carte, pour un voisin (filtré pour un joueur quand le DD est caché). */
export function groupRollView(messageId) {
  const view = viewOf(game.messages.get(messageId));
  return view ? visibleTo(view, { gm: game.user.isGM }) : null;
}

export const rollsApi = Object.freeze({
  request: requestGroupRoll,
  view: groupRollView,
  force: forceGroupRoll,
  breakdown: (actor, input) => {
    const { request } = normalizeRequest(input);
    return request ? breakdownOf(actor, request) : [];
  },
  mode: (actor, input) => {
    const { request } = normalizeRequest(input);
    return request ? systemModeOf(actor, request) : { advantage: false, disadvantage: false };
  },
  title: input => {
    const { request } = normalizeRequest(input);
    return request ? testTitle(request) : "";
  }
});

export function registerGroupRoll() {
  game.settings.register(MODULE_ID, SECONDS_SETTING, {
    name: `DND5ECOMBAT.Reglage.${SECONDS_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${SECONDS_SETTING}.Aide`,
    scope: "world", config: true, type: Number, default: 60, range: { min: 0, max: 300, step: 5 }
  });
  CONFIG.queries[GROUP_ROLL_QUERY] = handleGroupRollQuery;   // sur tous les clients : c'est le joueur qui répond
  // Le bouton de la carte de dnd5e appelle `CONFIG.DND5E.requests[handler](actor, message, data, { event })` (request-message-data.mjs:136) ;
  // `CONFIG.DND5E` est posé par le `init` du système, qui passe avant celui des modules.
  if ( CONFIG.DND5E?.requests ) CONFIG.DND5E.requests[GROUP_HANDLER] = handleCardButton;
  // Hors Théâtre de l'esprit compris : c'est un outil du MJ, pas une règle.
  route("createChatMessage", message => {
    if ( message.getFlag(MODULE_ID, "groupRollResult") ) {
      if ( isExecutor() ) link(message);
      return;
    }
    if ( requestOf(message) ) announce(message);
  }, { always: true, label: "group roll: result not processed" });
  route("updateChatMessage", message => {
    // Le jet d'un personnage a changé (dé d'Inspiration bardique tranché, ajouté) : sa carte se redessine et le point repart.
    const cardId = message.getFlag(MODULE_ID, "groupRollResult");
    if ( cardId ) {
      const card = game.messages.get(cardId);
      if ( card ) {
        ui.chat?.updateMessage?.(card);
        announce(card);
      }
      return;
    }
    if ( !requestOf(message) ) return;
    // Une demande ouverte ici dont le jet vient d'arriver d'ailleurs : sa fenêtre se ferme.
    for ( const target of message.system?.targets ?? [] ) {
      const entry = open.get(openKey(message.id, target.actor));
      if ( entry && target.result && !entry.rolling ) entry.taken();
    }
    announce(message);
  }, { always: true, label: "group roll: progress not announced" });
  route("deleteChatMessage", message => {
    if ( !requestOf(message) ) return;
    if ( !announced.has(message.id) || pending.has(message.id) ) announce(message, { cancelled: true });
  }, { always: true, label: "group roll: cancellation not announced" });
}
