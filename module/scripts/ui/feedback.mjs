/**
 * Retour visuel au-dessus des tokens, façon BG3 (SPEC §15.3) : « Critique ! », « Raté », l'abri, la
 * réaction, la sauvegarde — le texte défilant du cœur (`canvas.interface.createScrollingText`,
 * client/canvas/groups/interface.mjs:174), celui que dnd5e utilise pour les PV
 * (documents/actor/actor.mjs:3557). Les PV eux-mêmes restent au système.
 *
 * Consommateur passif : le hook `dnd5e-combat.resolution` n'est publié que chez le MJ actif, qui
 * exécute le moteur ; ici chaque client lit la résolution sur le drapeau du message, qu'il reçoit
 * comme tout le monde, et n'écrit que ce qui a changé depuis l'état précédent (core/feedback.mjs).
 * Rien n'est décidé, rien n'est écrit dans le monde.
 */

import { MODULE_ID } from "../constants.mjs";
import { feedbackBetween } from "../core/feedback.mjs";
import { route } from "../runtime/router.mjs";
import { loc } from "../runtime/shared.mjs";
import { resourceChangesOf } from "../adapter/limits.mjs";

/** Dernier état vu, par message. */
const seen = new Map();
/** Un message qu'on n'a jamais vu passer : on n'en montre les faits que s'il est récent (pas un vieux message rejoué). */
const FRESH_MS = 120000;
/** Écart entre deux textes sur un même token. */
const STAGGER_MS = 450;

const STYLES = {
  critical: { fill: 0xffd24a, fontSize: 30 },
  miss: { fill: 0xd0d0d0, fontSize: 24 },
  cover: { fill: 0x9ecbff, fontSize: 20 },
  reaction: { fill: 0xc49bff, fontSize: 22 },
  saveSuccess: { fill: 0x8fd18f, fontSize: 22 },
  saveFail: { fill: 0xe07a6a, fontSize: 22 },
  duplicate: { fill: 0xc49bff, fontSize: 22 },
  unaffected: { fill: 0xd0d0d0, fontSize: 20 },
  prompt: { fill: 0xffb347, fontSize: 24 },     // une invite (Rebond !, Taille !, projectile 2/3)
  refused: { fill: 0xff7070, fontSize: 22 },    // un refus (Déjà visé, Trop loin)
  ended: { fill: 0x9ecbff, fontSize: 20 },      // un effet qui cesse (Renvoi, Sommeil sur dégâts)
  gain: { fill: 0x8fd18f, fontSize: 22 },       // une ressource rendue (Regain sauvage : +1 Forme sauvage)
  spend: { fill: 0xffb347, fontSize: 20 }       // la ressource dépensée pour cela (−1 emplacement niv. 2)
};

function textOf(f) {
  switch ( f.kind ) {
    case "critical": return loc("Retour.Critique");
    case "miss": return loc("Retour.Rate");
    case "cover": return (f.degree === "total") ? loc("Retour.AbriTotal") : loc(`Abri.${f.degree}`);
    case "reaction": return f.name;
    case "saveSuccess": return loc("Retour.SauvegardeReussie");
    case "saveFail": return loc(f.auto ? "Retour.SauvegardeRateeOffice" : "Retour.SauvegardeRatee");
    case "duplicate": return loc("Retour.Replique");
    case "unaffected": return loc("Retour.NonAffecte");
    case "prompt": case "refused": case "ended": case "gain": case "spend": return f.text;
  }
  return null;
}

function show(feedback) {
  const delays = new Map();
  for ( const f of feedback ) {
    const token = fromUuidSync(f.token)?.object;
    if ( !token?.visible || token.document.isSecret ) continue;
    const raw = textOf(f);
    if ( !raw ) continue;
    const text = raw.charAt(0).toLocaleUpperCase() + raw.slice(1);   // « abri partiel » vient d'une clé partagée avec le chat
    const delay = delays.get(f.token) ?? 0;
    delays.set(f.token, delay + STAGGER_MS);
    setTimeout(() => {
      if ( !canvas?.ready || !token.visible ) return;
      // Sous le token, en descendant : dnd5e écrit les PV depuis le centre, ancrés au-dessus et en
      // montant (actor.mjs:3557) — partir du même point superposait « Sauvegarde ratée » et « -12 ».
      const { x, y } = token.center;
      // §41.3 : si la vue change pendant le défilement (un escalier : autre niveau, le canevas est redessiné), le cœur détruit
      // le texte avec le canevas puis une seconde fois à la fin de son animation — sa promesse échoue (« Cannot read
      // properties of null (reading 'off') », PreciseText.destroy). Rien à rattraper : le texte n'est plus là.
      canvas.interface.createScrollingText({ x, y: y + (token.h / 2) }, text, {
        anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM, direction: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
        stroke: 0x000000, strokeThickness: 4, jitter: 0.15, duration: 2200, ...STYLES[f.kind]
      })?.catch?.(() => {});
    }, delay);
  }
}

/**
 * Un avis au-dessus d'un token, sur ce client : invite (« Rebond ! »), refus (« Déjà visé »), fin d'effet. Les invites et
 * refus sont ceux de qui agit — lui seul les voit, comme la visée qu'ils accompagnent.
 */
export function floatNotice(token, text, kind="prompt") {
  if ( !text || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  show([{ token: token?.uuid ?? token, kind, text }]);
}

/** Un effet qui cesse sur dégâts (runtime/triggers.mjs, message `ended`) : chez tout le monde, au-dessus de celui qui le portait. */
/** §16.40 : ce qu'une utilisation a rendu ou dépensé (Regain sauvage), au-dessus du token de l'utilisateur, chez tout le monde. */
function resourceText(c) {
  const sign = c.kind === "gain" ? "+" : "−";
  return c.type === "spellSlots" ? loc("Retour.Emplacement", { sign, n: c.n, level: c.level }) : loc("Retour.Utilisation", { sign, n: c.n, item: c.name ?? "" });
}

function onCreateMessage(message) {
  if ( (message.type === "usage") && game.settings.get(MODULE_ID, "feedbackText") && canvas?.ready
    && ((Date.now() - (message.timestamp ?? 0)) <= FRESH_MS) ) {
    const changes = resourceChangesOf(message);
    const actor = changes.length ? message.getAssociatedActor?.() : null;
    const token = actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0];
    if ( token ) show(changes.map(c => ({ token: token.uuid, kind: c.kind, text: resourceText(c) })));
  }
  const ended = message.getFlag?.(MODULE_ID, "ended");
  if ( !ended?.actor || !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( (Date.now() - (message.timestamp ?? 0)) > FRESH_MS ) return;
  const actor = fromUuidSync(ended.actor, { strict: false });
  const token = actor?.getActiveTokens?.(false, true)?.[0];
  if ( token ) show([{ token: token.uuid, kind: "ended", text: loc("Retour.FinEffet", { item: fromUuidSync(ended.effect, { strict: false })?.name ?? ended.item ?? "" }) }]);
}

function onUpdateMessage(message, changes) {
  if ( !changes.flags?.[MODULE_ID]?.resolution ) return;
  const after = message.getFlag(MODULE_ID, "resolution");
  if ( !after ) return;
  const known = seen.has(message.id);
  const before = seen.get(message.id) ?? null;
  seen.set(message.id, foundry.utils.deepClone(after));
  if ( !game.settings.get(MODULE_ID, "feedbackText") || !canvas?.ready ) return;
  if ( !known && ((Date.now() - (message.timestamp ?? 0)) > FRESH_MS) ) return;
  show(feedbackBetween(before, after));
}

export function registerFeedback() {
  game.settings.register(MODULE_ID, "feedbackText", { scope: "client", config: true, type: Boolean, default: true,
    name: "DND5ECOMBAT.Reglage.feedbackText.Nom", hint: "DND5ECOMBAT.Reglage.feedbackText.Aide" });
  route("updateChatMessage", onUpdateMessage, { label: "visual feedback above tokens" });
  route("deleteChatMessage", message => seen.delete(message.id), { label: "visual feedback: forget" });
  route(`${MODULE_ID}.notice`, n => floatNotice(n.token, n.text, n.kind), { label: "visual feedback: engine notice" });
  route("createChatMessage", onCreateMessage, { label: "visual feedback: effect ending" });
}
