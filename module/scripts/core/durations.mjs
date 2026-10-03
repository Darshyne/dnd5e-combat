/**
 * M4 (SPEC §18.7) : la durée d'un état écrite dans le texte — « until the end of its next turn », « jusqu'au début du tour
 * suivant du monstre » — traduite en expiration native de dnd5e 6 (`duration.expiry`, active-effect.mjs:112 et 881-908) :
 *  - `targetStart` / `targetEnd` : au début / à la fin du prochain tour de la créature qui porte l'effet ;
 *  - `sourceStart` / `sourceEnd` : au début / à la fin du prochain tour de celle qui l'a posé.
 * Le système saute le tour où l'effet a été posé : « la fin de son prochain tour » tient comme écrit.
 *
 * Qui est « son » ? En anglais « its » et « the target's » : le porteur (sur soi-même, porteur et source se confondent) ;
 * « the <monstre>'s », « the attacking creature's », « the user's », « your » : la source. En français (MM-fr, PHB-fr),
 * « son tour suivant », « son propre tour » et « de la cible » : le porteur ; « du tour suivant du / de la / de l' <X> »
 * et « votre » : la source.
 *
 * Pur : des chaînes.
 */

const PATTERNS = [
  // Anglais.
  { re: /until the (start|end) of (?:its|their|the target's) (?:own )?next turn/gi, who: "target" },
  { re: /until the (start|end) of (?:your|the (?!target's)[^.;,]{1,60}?'s) next turn/gi, who: "source" },
  // Français.
  { re: /jusqu'(?:au (début)|à la (fin)) de son (?:propre )?tour suivant/gi, who: "target" },
  { re: /jusqu'(?:au (début)|à la (fin)) du (?:prochain )?tour (?:suivant )?de la cible/gi, who: "target" },
  { re: /jusqu'(?:au (début)|à la (fin)) de votre (?:prochain )?tour(?: suivant)?/gi, who: "source" },
  { re: /jusqu'(?:au (début)|à la (fin)) du (?:prochain )?tour suivant (?:du|de la|de l'|des)(?! cible)/gi, who: "source" }
];

const EDGE = { start: "Start", end: "End", "début": "Start", fin: "End" };

/** Texte à plat : enrichers et balises retirés, apostrophes droites. */
export function plainText(html) {
  return String(html ?? "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\[\[lookup[^\]]*\]\](?:\{([^}]*)\})?/g, (_, label) => label ?? "it")
    .replace(/&Reference\[(\w+)[^\]]*\]/g, "«$1»")
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ").trim();
}

/**
 * Le texte nomme-t-il l'un de ces états ? La description propre d'un effet qui nomme son état fait foi, même sans durée :
 * on ne va pas chercher dans l'item la durée d'un autre effet du même état (Tyran de la mort : deux rayons posent Entravé).
 */
export function namesStatus(html, statuses=[]) {
  const wanted = new Set(statuses.map(s => String(s).toLowerCase()));
  return [...plainText(html).matchAll(/«(\w+)»/g)].some(m => wanted.has(m[1].toLowerCase()));
}

/** Toutes les durées d'une phrase, dans l'ordre. */
function expiriesIn(sentence) {
  const found = [];
  for ( const { re, who } of PATTERNS ) {
    for ( const m of sentence.matchAll(re) ) {
      const edge = EDGE[(m[1] ?? m[2] ?? "").toLowerCase()];
      if ( edge ) found.push({ at: m.index, expiry: `${who}${edge}` });
    }
  }
  return found.sort((a, b) => a.at - b.at).map(f => f.expiry);
}

/**
 * L'expiration à poser d'après un texte, ou null s'il n'en dit rien de sûr.
 *  - Effet qui porte des états : seule compte la phrase qui en nomme un (`&Reference[Paralyzed]`). Une durée écrite
 *    ailleurs appartient à autre chose (Mot de pouvoir étourdissant : « Speed 0 until the start of your next turn » n'est
 *    pas la durée d'Étourdi ; Technique de la paume : la Renverse n'expire pas avec la Déroute).
 *  - Effet sans état : seulement si `alone` (le texte est la description de l'effet lui-même) et qu'il n'y a qu'une durée.
 * @param {string} html
 * @param {string[]} [statuses]  états de l'effet (« paralyzed »…)
 * @param {{alone?: boolean}} [options]
 * @returns {"targetStart"|"targetEnd"|"sourceStart"|"sourceEnd"|null}
 */
export function expiryFromText(html, statuses=[], { alone=false }={}) {
  const text = plainText(html);
  if ( !text ) return null;
  const sentences = text.split(/(?<=[.;:])\s+/);
  const wanted = new Set(statuses.map(s => String(s).toLowerCase()));
  if ( wanted.size ) {
    for ( const sentence of sentences ) {
      // La durée qui SUIT la mention de l'état (Psion githzerai : « (A) Charmed until the start… or (B) Prone » — la
      // Renverse n'a pas la durée du Charme).
      const mention = [...sentence.matchAll(/«(\w+)»/g)].find(m => wanted.has(m[1].toLowerCase()));
      const found = mention ? expiriesIn(sentence.slice(mention.index)) : [];
      if ( found.length ) return found[0];
    }
    return null;
  }
  if ( !alone ) return null;
  const all = [...new Set(sentences.flatMap(expiriesIn))];
  return (all.length === 1) ? all[0] : null;
}
