/**
 * M5 (SPEC §18.8) : variantes d'une attaque de monstre. Le Monster Manual code « si la créature a chargé », « si la nuée est
 * En sang », « si le jet avait l'avantage » par une SECONDE activité d'attaque sur le même item, nommée d'après sa
 * condition (nom anglais d'origine, que Babele garde) :
 *  - « Moving Attack » / « Charging Attack », `activation.condition` « moved 20+ feet (straight toward the target) » ;
 *  - « Bloodied Attack » : la nuée (ou le Quaggoth) En sang ; le Faucon de sang : « if the target is Bloodied » ;
 *  - « Attack with Advantage » / « Attack at Advantage » (gobelins, Chimère, Capitaine éclaireur) ;
 *  - « Attacked if Grappling » (Mimique : la cible est agrippée par elle).
 * Le moteur choisit la bonne activité à la place du MJ : à l'utilisation pour ce qui se sait avant le jet (charge, En sang,
 * agrippée), au jet de dégâts pour l'avantage (« if the attack roll had Advantage » ne se sait qu'après le jet).
 *
 * Pur : des objets simples.
 */

/** Genre d'une activité d'attaque d'après son nom anglais, ou null pour l'attaque de base. */
function kindOf(name) {
  const n = String(name ?? "");
  if ( /\b(Moving|Charging) Attack\b/i.test(n) ) return "charge";
  if ( /\bBloodied Attack\b/i.test(n) ) return "bloodied";
  if ( /\bAttack (with|at) Advantage\b/i.test(n) ) return "advantage";
  if ( /\bif Grappling\b/i.test(n) ) return "grappled";
  return null;
}

/**
 * Les variantes d'un item, ou null s'il n'en a pas.
 * @param {Array<{id: string, type: string, name: string, condition?: string, effects?: string[]}>} activities
 *   `name` : nom anglais d'origine ; `effects` : ids des effets de l'activité.
 * @param {string} [description]  description anglaise de l'item (texte à plat ou HTML)
 * @returns {{base: string, baseEffects: string[], variants: Array<{id: string, kind: string, feet?: number, subject?: string, effects: string[]}>}|null}
 */
export function variantsOf(activities, description="") {
  const attacks = (activities ?? []).filter(a => a.type === "attack");
  if ( attacks.length < 2 ) return null;
  const text = String(description ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  const variants = [];
  let base = null;
  for ( const a of attacks ) {
    const kind = kindOf(a.name);
    if ( !kind ) { base ??= a; continue; }
    const v = { id: a.id, kind, effects: a.effects ?? [] };
    if ( kind === "charge" ) {
      const m = String(a.condition ?? "").match(/(\d+)\+?\s*(?:feet|ft)/i) ?? text.match(/moved (\d+)\+?\s*(?:feet|ft)/i);
      v.feet = m ? Number(m[1]) : 20;
    }
    if ( kind === "bloodied" ) v.subject = /if the target is (?:&Reference\[)?Bloodied/i.test(text) ? "target" : "self";
    variants.push(v);
  }
  if ( !base || !variants.length ) return null;
  return { base: base.id, baseEffects: base.effects ?? [], variants };
}

/**
 * La variante à utiliser avant le jet, ou null (l'attaque de base). L'avantage ne se juge pas ici.
 * @param {object} plan  rendu par `variantsOf`
 * @param {{selfBloodied?: boolean, targetBloodied?: boolean, chargedFeet?: number, grappledBySelf?: boolean}} facts
 * @returns {string|null}  id de l'activité
 */
export function chooseVariant(plan, facts={}) {
  for ( const v of plan?.variants ?? [] ) {
    if ( (v.kind === "charge") && ((facts.chargedFeet ?? 0) >= v.feet) ) return v.id;
    if ( (v.kind === "bloodied") && (v.subject === "self") && facts.selfBloodied ) return v.id;
    if ( (v.kind === "bloodied") && (v.subject === "target") && facts.targetBloodied ) return v.id;
    if ( (v.kind === "grappled") && facts.grappledBySelf ) return v.id;
  }
  return null;
}

/** La variante « si le jet avait l'avantage », à prendre pour les dégâts. */
export function advantageVariant(plan) {
  return plan?.variants.find(v => v.kind === "advantage")?.id ?? null;
}

/**
 * Effets de l'attaque de base que sa variante de charge porte aussi : ils ne valent qu'après une charge (le texte le dit :
 * « if … moved 20+ feet straight toward it …, the target … has the Prone condition »). Le MM les a parfois recopiés sur
 * l'attaque de base (Défense du Sanglier) : on les retire de l'attaque de base.
 */
export function chargeOnlyEffects(plan) {
  const charge = plan?.variants.find(v => v.kind === "charge");
  return charge ? plan.baseEffects.filter(id => charge.effects.includes(id)) : [];
}

/**
 * La charge en ligne droite qui précède l'attaque : la plus longue fin du trajet du tour qui va droit vers la cible.
 * Points en cases (coin haut-gauche ou centre, pourvu que ce soit le même repère), distance d'une case en pieds.
 * Droit : chaque point intermédiaire reste à moins d'une demi-case de la droite ; vers la cible : la distance à la cible
 * a baissé d'au moins 80 % du chemin parcouru. Longueur comptée en cases (diagonale = 1 case, règle de dnd5e par défaut).
 * @param {Array<{x: number, y: number}>} path  positions du tour, la dernière = position actuelle
 * @param {{x: number, y: number}} target
 * @param {number} cellFeet
 * @returns {number}  pieds parcourus en ligne droite vers la cible, 0 sinon
 */
export function straightChargeFeet(path, target, cellFeet) {
  const pts = (path ?? []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if ( pts.length < 2 ) return 0;
  const end = pts.at(-1);
  const euclid = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cells = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  let best = 0;
  for ( let k = pts.length - 2; k >= 0; k-- ) {
    const start = pts[k];
    const length = euclid(start, end);
    if ( length < 1e-6 ) continue;
    // Droit : les points entre start et end restent près de la droite.
    const straight = pts.slice(k + 1, -1).every(p => {
      const cross = Math.abs(((end.x - start.x) * (p.y - start.y)) - ((end.y - start.y) * (p.x - start.x)));
      return (cross / length) <= 0.5;
    });
    if ( !straight ) break;
    const closer = euclid(start, target) - euclid(end, target);
    if ( closer >= 0.8 * length ) best = Math.max(best, cells(start, end) * cellFeet);
  }
  return best;
}
