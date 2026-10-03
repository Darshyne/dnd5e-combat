/**
 * Ce qu'une attaque de monstre porte AU TOUCHER, lu dans la forme de l'item (SPEC §18.4, M2 et M3) — jamais par id
 * d'activité, qui change d'une créature à l'autre dans le Monster Manual.
 *
 *  - M2 : sauvegarde sœur. Griffe de la Goule : une activité d'attaque et UNE activité de sauvegarde sans gabarit,
 *    qui vise une seule créature, et ne s'utilise pas à part (pas en action bonus ni en réaction) — la sauvegarde que
 *    le toucher impose. Le MM lui donne tantôt une activation vide ou « spéciale », tantôt « action » comme l'attaque
 *    (Blême, Chien de la mort, lycanthropes) : l'action est donc admise. La forme ne suffit pas : le Coup à mains nues
 *    du PHB (Lutte/Bousculade), la Dague venimeuse ou le Bâton de flétrissement l'ont aussi, sans que leur sauvegarde
 *    suive le toucher. Le discriminant est la formule d'amorce du MM, « is subjected to the following effect » /
 *    « must make the following saving throw » (« est soumise à l'effet suivant » en français), hors d'une phrase
 *    « Whenever… » (Otyugh : la sauvegarde vient après un repos long, pas au toucher). Deux sauvegardes (Morsure
 *    pétrifiante : premier échec, puis répétée) ou une zone (Explosion de terre du Dao, émanation autour de la cible) :
 *    on ne devine pas, le contenu le déclare (`onHit.save`).
 *  - M3 : porte de taille. « If the target is a Large or smaller creature, it has the Prone condition » — l'état
 *    (ou la poussée) ne vaut que pour une cible de cette taille au plus. Lue dans `target.affects.special` de
 *    l'activité, ou dans la phrase « If the target is… » de la description ; en anglais et dans la traduction
 *    française (« Si la cible est une créature de taille G ou inférieure »), que Babele écrit dans les deux champs.
 *
 * Pur : des objets simples, aucune référence à Foundry.
 */

/** Tailles de dnd5e, par leur nom anglais et leur abréviation française (PHB-fr). */
const SIZE_WORDS = {
  tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg",
  tp: "tiny", p: "sm", m: "med", g: "lg", tg: "huge", gig: "grg"
};

const SIZE_EN = /\b(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i;
const SIZE_FR = /\btaille (TP|P|M|G|TG|Gig)\.? ou inf[ée]rieure\b/i;

/**
 * La taille maximale écrite dans un bout de texte (« Large or smaller », « de taille G ou inférieure »).
 * @param {string} text
 * @returns {string|null}  clé de taille de dnd5e ("lg"…), null si le texte n'en dit rien
 */
export function sizeLimitIn(text) {
  const match = String(text ?? "").match(SIZE_EN) ?? String(text ?? "").match(SIZE_FR);
  return match ? SIZE_WORDS[match[1].toLowerCase()] ?? null : null;
}

/** Début d'une phrase qui pose une condition sur la cible. */
const TARGET_CLAUSE = /(?:^|[.>]\s*)(?:If (?:the )?target is|Si la cible est)\b([^.]*)/gi;

/**
 * La porte de taille d'une attaque : `target.affects.special` de l'activité d'abord, sinon la première phrase
 * « If the target is… » de la description qui nomme une taille. Les enrichers `[[lookup @target.affects.special
 * activity=ID]]` y sont remplacés par la valeur de cette activité (le MM écrit souvent la taille ainsi).
 * @param {object} args
 * @param {string} [args.special]      `target.affects.special` de l'activité d'attaque
 * @param {string} [args.description]  description de l'item (HTML)
 * @param {(id: string) => string} [args.specialOf]  `affects.special` d'une activité sœur, par id
 * @returns {string|null}
 */
export function sizeGateOf({ special="", description="", specialOf=() => "" }={}) {
  const own = sizeLimitIn(special);
  if ( own ) return own;
  const text = String(description ?? "")
    .replace(/\[\[lookup @target\.affects\.special activity=(\w+)\]\](?:\{[^}]*\})?/g, (_, id) => specialOf(id) ?? "")
    // Les autres enrichers contiennent des points (`@target.affects.type`) qui couperaient la phrase.
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " … ")
    .replace(/<[^>]+>/g, " ");
  for ( const [, clause] of text.matchAll(TARGET_CLAUSE) ) {
    const size = sizeLimitIn(clause);
    if ( size ) return size;
  }
  return null;
}

/** Activations admises pour une sauvegarde sœur : aucune, spéciale, ou l'action de l'attaque elle-même. */
const DEPENDENT_ACTIVATIONS = new Set(["", "special", "none", "action"]);

/** Amorce du MM : « it is subjected to the following effect », « must make the following saving throw », et en français. */
const LEAD_IN = /(subjected to the following effect|must make the following saving throw|soumise? à l'effet suivant|subit (en outre )?l'effet suivant|(doit|devra) (faire|effectuer) (le jet de sauvegarde|la sauvegarde) suivant)/i;
const NOT_ON_HIT = /\b(Whenever|Each time|Chaque fois|Lorsqu'elle termine|Quand elle termine)\b/i;

/** La description annonce-t-elle une sauvegarde qui suit le toucher ? */
export function announcesHitSave(description) {
  const text = String(description ?? "").replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " … ").replace(/<[^>]+>/g, " ").replace(/’/g, "'");
  return text.split(/(?<=[.:])\s+/).some(sentence => LEAD_IN.test(sentence) && !NOT_ON_HIT.test(sentence));
}

/**
 * La sauvegarde sœur qu'une attaque impose au toucher, reconnue à sa forme et à l'amorce de sa description.
 * @param {object[]} activities  toutes les activités de l'item : { id, type, activation: { type }, target: { template: { type }, affects: { count } } }
 * @param {string} description   description de l'item (HTML)
 * @returns {string|null}  id de l'activité de sauvegarde
 */
export function siblingSaveOf(activities, description) {
  if ( !announcesHitSave(description) ) return null;
  const list = Array.from(activities ?? []);
  if ( !list.some(a => a?.type === "attack") ) return null;
  const saves = list.filter(a => a?.type === "save");
  if ( saves.length !== 1 ) return null;
  const [save] = saves;
  if ( !DEPENDENT_ACTIVATIONS.has(save.activation?.type ?? "") ) return null;
  if ( save.target?.template?.type ) return null;
  const count = String(save.target?.affects?.count ?? "").trim();
  if ( count && (count !== "1") ) return null;
  return save.id ?? null;
}
