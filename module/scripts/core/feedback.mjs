/**
 * Retour visuel au-dessus des tokens (SPEC §15.3) : ce qu'une résolution vient d'apprendre, entre
 * deux de ses états — verdict d'attaque (critique, raté), abri, réaction, sauvegarde. Chaque fait
 * n'apparaît qu'une fois : on compare l'état précédent au nouveau. Fonctions pures, aucune
 * dépendance à Foundry ; l'affichage est dans ui/feedback.mjs.
 */

/**
 * @typedef {object} Feedback
 * @property {string} token   UUID du token au-dessus duquel écrire.
 * @property {"hit"|"critical"|"miss"|"cover"|"reaction"|"saveSuccess"|"saveFail"|"duplicate"|"unaffected"} kind
 *           `hit` : un coup qui touche sans critique (§228 : affiché seulement si le MJ le veut, ou par son jet)
 *           `duplicate` : une réplique d'Image miroir a pris le coup (§16.25) ; `unaffected` : l'action ne peut pas l'affecter (§16.8)
 * @property {string} [degree]  Abri : "half", "threeQuarters", "total".
 * @property {string} [name]    Réaction : son nom.
 * @property {boolean} [auto]   Sauvegarde ratée d'office (état).
 * @property {number} [roll]    §228 : le total du jet d'attaque (verdict) ou de sauvegarde, quand il est connu.
 */

const blank = { hit: null, critical: false, cover: null, reaction: null, save: null, duplicate: null, unaffected: null };

/**
 * Les faits nouveaux d'une résolution.
 * @param {object|null} before  État précédent (null : rien de connu).
 * @param {object} after        Nouvel état.
 * @returns {Feedback[]}
 */
export function feedbackBetween(before, after) {
  if ( !after?.targets?.length || (after.step === "undone") ) return [];
  const previous = new Map((before?.targets ?? []).map(t => [t.token, t]));
  const out = [];
  const attackTotal = Number.isFinite(after.attack?.roll?.total) ? { roll: after.attack.roll.total } : {};
  for ( const t of after.targets ) {
    const b = previous.get(t.token) ?? blank;
    const judged = (t.hit !== null) && (t.hit !== undefined);
    const newlyJudged = judged && ((b.hit === null) || (b.hit === undefined));
    if ( newlyJudged && t.cover?.degree && (t.cover.degree !== "none") ) out.push({ token: t.token, kind: "cover", degree: t.cover.degree });
    if ( t.reaction && !b.reaction ) out.push({ token: t.token, kind: "reaction", name: t.reaction });
    if ( t.unaffected && !b.unaffected ) out.push({ token: t.token, kind: "unaffected" });
    if ( t.duplicate?.taken && !b.duplicate?.taken ) out.push({ token: t.token, kind: "duplicate" });
    else if ( judged && (newlyJudged || (b.hit !== t.hit) || (b.critical !== t.critical)) ) {
      if ( t.hit === false ) out.push({ token: t.token, kind: "miss", ...attackTotal });
      else if ( t.critical ) out.push({ token: t.token, kind: "critical", ...attackTotal });
      else if ( t.hit === true ) out.push({ token: t.token, kind: "hit", ...attackTotal });
    }
    // §169 : un rejeu sans sauvegarde (`noSave`) n'en annonce aucune.
    if ( t.save && !b.save && (t.save.auto !== "noSave") ) {
      out.push({ token: t.token, kind: t.save.success ? "saveSuccess" : "saveFail", auto: !!t.save.auto,
        ...(Number.isFinite(t.save.total) ? { roll: t.save.total } : {}) });
    }
  }
  return out;
}

/**
 * §16.40 : les ressources qu'une utilisation rend ou dépense, à montrer au-dessus du token — seulement pour une activité qui
 * **rend** quelque chose (une consommation négative : Regain sauvage), pour ne pas écrire « −1 emplacement » à chaque sort.
 * @param {Array<{type: "itemUses"|"spellSlots", value: number, name?: string, level?: number}>} targets
 * @returns {Array<{kind: "gain"|"spend", type: string, n: number, name?: string, level?: number}>}
 */
export function resourceFeedback(targets) {
  const usable = (targets ?? []).filter(t => ["itemUses", "spellSlots"].includes(t.type) && Number.isFinite(t.value) && (t.value !== 0));
  if ( !usable.some(t => t.value < 0) ) return [];
  return usable.map(t => ({ kind: t.value < 0 ? "gain" : "spend", type: t.type, n: Math.abs(t.value),
    ...(t.name ? { name: t.name } : {}), ...(Number.isFinite(t.level) ? { level: t.level } : {}) }));
}
