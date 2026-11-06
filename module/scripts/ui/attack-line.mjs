/**
 * #33 (suite) : la ligne de visée au ciblage — de l'attaquant (à sa case d'arrivée s'il approche) à la cible, verte où la vue
 * est dégagée, orange à partir de ce qui donne un abri, rouge à partir d'un abri total ou au-delà de la portée, bleue quand
 * l'attaquant ne voit pas sa cible ; la distance écrite au milieu. Dessinée chez ce client seul (`canvas.controls`), effacée
 * avec la pastille du curseur ; rien n'est posé sur la scène. Réglage de monde `attackLine`, désactivé par défaut.
 */

import { MODULE_ID } from "../constants.mjs";
import { attackLineOf } from "../adapter/attack-line.mjs";
import { loc } from "../runtime/shared.mjs";

const COLORS = { clear: 0x4fc35a, unseen: 0x4a9ce8, cover: 0xf09a2a, blocked: 0xe0473c };
let layer = null;

/** La ligne est-elle en service (réglage de monde) ? */
export function attackLineOn() {
  try { return game.settings.get(MODULE_ID, "attackLine") === true; } catch { return false; }
}

function container() {
  if ( layer && !layer.destroyed && layer.parent ) return layer;
  if ( !canvas?.controls ) return null;
  layer = new PIXI.Container();
  layer.eventMode = "none";
  canvas.controls.addChild(layer);
  return layer;
}

/** La ligne est-elle dessinée ? */
export function attackLineShown() {
  return !!layer && !layer.destroyed && (layer.children.length > 0);
}

export function hideAttackLine() {
  if ( layer && !layer.destroyed ) layer.removeChildren().forEach(c => c.destroy());
}

/** Le texte de la distance : « 35 ft », « 35 ft · longue portée », « 70 ft · hors de portée ». */
function distanceText(line) {
  const value = Math.round(line.distance.value * 10) / 10;
  let text;
  try { text = dnd5e.utils.formatLength(value, line.distance.units); }
  catch { text = `${value} ${line.distance.units}`; }
  if ( line.range === "longRange" ) text += ` · ${loc("LigneVisee.Longue")}`;
  else if ( line.range === "outOfRange" ) text += ` · ${loc("LigneVisee.HorsPortee")}`;
  return text;
}

/**
 * Trace la ligne de visée d'`attacker` vers `target` pour `activity` (une attaque).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]  `posA` : position d'arrivée de l'attaquant ; `unreachable` : tout en rouge.
 */
export function showAttackLine(attacker, target, activity, options={}) {
  if ( !attackLineOn() ) return hideAttackLine();
  let line = null;
  try { line = attackLineOf(attacker, target, activity, options); }
  catch(err) { console.warn(`${MODULE_ID} | attack line`, err); }
  const root = line ? container() : null;
  if ( !root ) return hideAttackLine();
  hideAttackLine();
  const { from, to } = line;
  const at = t => ({ x: from.x + ((to.x - from.x) * t), y: from.y + ((to.y - from.y) * t) });
  const width = Math.max(4, canvas.dimensions.size / 14);
  const g = new PIXI.Graphics();
  // Un liseré sombre sous toute la ligne, lisible sur n'importe quelle carte.
  g.lineStyle({ width: width + 4, color: 0x000000, alpha: 0.55, cap: PIXI.LINE_CAP.ROUND });
  g.moveTo(from.x, from.y).lineTo(to.x, to.y);
  for ( const s of line.segments ) {
    const a = at(s.from), b = at(s.to);
    g.lineStyle({ width, color: COLORS[s.kind], alpha: 0.95, cap: PIXI.LINE_CAP.ROUND });
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  // Une marque à chaque changement de couleur : là où l'obstacle, ou la fin de la portée, coupe la ligne.
  for ( const s of line.segments.slice(1) ) {
    const p = at(s.from);
    g.lineStyle({ width: 2, color: 0x000000, alpha: 0.8 });
    g.beginFill(COLORS[s.kind], 1).drawCircle(p.x, p.y, width * 1.2).endFill();
  }
  root.addChild(g);

  const { PreciseText } = foundry.canvas.containers;
  const style = PreciseText.getTextStyle({ fill: 0xffffff, fontSize: Math.max(16, canvas.dimensions.size / 4), stroke: 0x000000, strokeThickness: 4 });
  const label = new PreciseText(distanceText(line), style);
  label.anchor.set(0.5, 1);
  const mid = at(0.5);
  label.position.set(mid.x, mid.y - (width * 2));
  root.addChild(label);
}

export function registerAttackLine() {
  game.settings.register(MODULE_ID, "attackLine", { scope: "world", config: true, type: Boolean, default: false,
    name: "DND5ECOMBAT.Reglage.attackLine.Nom", hint: "DND5ECOMBAT.Reglage.attackLine.Aide" });
}
