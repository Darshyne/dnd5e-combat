/**
 * Fonctions de test (api.mcp) : la vision (issue #42). Pour chaque paire observateur → cible, ce que jugent les règles (`canSee`, ce qui
 * décide d'un souci « n'est pas en vue » et des raisons d'Avantage / Désavantage) et ses ingrédients (zone qui bloque la vue, distance,
 * Vision du diable, ouïe, ligne de vue), puis ce que montre l'écran par les yeux de l'observateur (`Token#isVisible` et le filtre de
 * détection : contour de l'ouïe ou d'un mode spécial). Rien n'est écrit dans un document.
 *
 *  - `visionMatrix` : sur le client du MJ (le contrôle de chaque observateur est pris le temps de la lecture, puis rendu) ;
 *  - `screenHere` : sur N'IMPORTE QUEL client (un joueur dans le navigateur intégré) — ce que ce client voit, avec les tokens qu'il
 *    contrôle, sans rien changer.
 */

import { canSee, blockedBetween, devilsSightRange, isVisionAvailable, hasLineOfSight } from "../adapter/vision.mjs";
import { canHear } from "../adapter/hearing.mjs";
import { sightRequired } from "../adapter/conditions.mjs";
import { committedPosition, distanceBetween, tokenCenter } from "../adapter/turn.mjs";
import { sleep } from "./shared.mjs";
import { gmOnly, viewedToken } from "./testing-shared.mjs";

const HEARING = [0.55, 0.8, 1, 1];   // ui/perception.mjs, contour de l'ouïe

/** Le filtre de détection d'un token affiché : null, « ouïe » (contour du moteur), ou les couleurs d'un autre contour. */
function filterOf(token) {
  const filter = token.detectionFilter;
  if ( !filter ) return null;
  const color = filter.uniforms?.outlineColor;
  if ( !color ) return "other";
  const rounded = Array.from(color).map(c => Math.round(c * 100) / 100);
  return rounded.every((c, i) => c === HEARING[i]) ? "hearing" : rounded;
}

/** Ce que ce client montre d'une cible : non affichée, affichée nette, ou affichée par un contour. */
function shownAs(token) {
  if ( !token?.isVisible ) return "hidden";
  const filter = filterOf(token);
  return filter ? ((filter === "hearing") ? "heard" : "outline") : "seen";
}

/** Les ingrédients des règles pour une paire (positions validées). */
function rulesFor(observer, target) {
  const blocked = blockedBetween(observer, target);
  const eye = observer.getVisionOrigin?.(committedPosition(observer)) ?? tokenCenter(observer);
  const level = canvas.scene.levels?.get?.(observer.level);
  const devil = devilsSightRange(observer);
  return {
    sees: canSee(observer, target),
    blocked: (blocked.fog || blocked.darkness) ? Object.keys(blocked).filter(k => blocked[k]) : [],
    distance: Math.round(distanceBetween(observer, target).value * 10) / 10,
    lineOfSight: hasLineOfSight(eye, target, level),
    lineOfSightThroughDarkness: hasLineOfSight(eye, target, level, { throughDarkness: true }),
    devilsSight: devil || null,
    hears: canHear(observer, target),
    darkvision: observer.actor?.system.attributes?.senses?.ranges?.darkvision ?? null,
    modes: Object.keys(observer.detectionModes ?? {})
  };
}

/**
 * La vision de chaque paire : règles et écran.
 * @param {{observerIds: string[], targetIds: string[], screen?: boolean}} args
 * @returns {{vision: boolean, rows: Array<{observer: string, target: string, rules: object, screen: string|null}>}}
 */
export async function visionMatrix({ observerIds=[], targetIds=[], screen=true }) {
  gmOnly();
  const observers = observerIds.map(id => viewedToken({ tokenId: id }));
  const targets = targetIds.map(id => viewedToken({ tokenId: id }));
  const rows = [];
  const before = canvas.tokens.controlled.map(t => t.id);
  try {
    for ( const observer of observers ) {
      let shown = null;
      if ( screen ) {
        observer.object.control({ releaseOthers: true });
        canvas.perception.update({ initializeVision: true });
        // Les sources de vision refaites tout de suite : sans image (fenêtre du MJ en arrière-plan), `isVisible` lisait encore celles de
        // l'observateur précédent.
        canvas.perception.applyRenderFlags();
        await sleep(400);
        shown = Object.fromEntries(targets.map(t => [t.id, shownAs(t.object)]));
      }
      for ( const target of targets ) {
        if ( target === observer ) continue;
        rows.push({ observer: observer.name, observerId: observer.id, target: target.name, targetId: target.id,
          rules: rulesFor(observer, target), screen: shown?.[target.id] ?? null });
      }
    }
  }
  finally {
    if ( screen ) {
      canvas.tokens.releaseAll();
      for ( const id of before ) canvas.tokens.get(id)?.control({ releaseOthers: false });
      canvas.perception.update({ initializeVision: true });
    }
  }
  return { vision: isVisionAvailable(), rows };
}

/**
 * Ce que CE client montre des tokens de la scène affichée, avec les tokens qu'il contrôle (ou tous ceux qu'il possède quand il n'en
 * contrôle aucun : la vue d'un joueur). Sans MJ requis, pour un client joueur. `targetIds` vide : tous les tokens.
 */
export function screenHere({ targetIds=[] }={}) {
  if ( !canvas?.ready ) throw new Error("no scene displayed");
  const tokens = targetIds.length ? targetIds.map(id => canvas.tokens.get(id)).filter(Boolean) : canvas.tokens.placeables;
  return {
    user: game.user.name, isGM: game.user.isGM, vision: isVisionAvailable(), scene: canvas.scene.name,
    controlled: canvas.tokens.controlled.map(t => t.name),
    tokens: tokens.map(t => ({ name: t.name, id: t.id, shown: shownAs(t) }))
  };
}

/**
 * Donne un acteur du monde à des joueurs (propriétaires), par leurs noms — le connecteur ignore `ownership` à la création et à la mise à
 * jour d'un acteur. Pour les arènes (tools/arene-vision.mjs : les observateurs à `claude player`). Les autres droits ne bougent pas.
 * @param {{actorId: string, users: string[], level?: number}} args
 */
export async function setOwners({ actorId, users=[], level=3 }) {
  gmOnly();
  const actor = game.actors.get(actorId);
  if ( !actor ) throw new Error(`actor ${actorId} not found`);
  const ids = users.map(name => game.users.getName(name)?.id ?? null);
  const missing = users.filter((_, i) => !ids[i]);
  if ( missing.length ) throw new Error(`unknown users: ${missing.join(", ")}`);
  await actor.update({ ownership: Object.fromEntries(ids.map(id => [id, level])) });
  return { actor: actor.name, ownership: actor.ownership };
}

/**
 * Issue #42 : le souci « {name} n'est pas en vue : ce sort vise une créature que vous voyez » d'une visée, sans ouvrir la fenêtre de
 * légalité — le même calcul que runtime/turn.mjs (`sightRequired` de l'activité, puis `canSee` de l'auteur vers chaque cible).
 * @param {{tokenId: string, identifier: string, targetIds: string[]}} args
 * @returns {{requiresSight: boolean, unseen: string[]}}
 */
export function sightIssues({ tokenId, identifier, targetIds=[] }) {
  const origin = viewedToken({ tokenId });
  const item = origin.actor?.items.find(i => i.system?.identifier === identifier);
  const activity = item?.system.activities.contents[0];
  if ( !activity ) throw new Error(`no activity for ${identifier}`);
  const requires = sightRequired(activity);
  const targets = targetIds.map(id => viewedToken({ tokenId: id }));
  return { requiresSight: requires, unseen: requires ? targets.filter(t => canSee(origin, t) === false).map(t => t.name) : [] };
}
