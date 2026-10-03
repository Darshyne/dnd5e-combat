/**
 * Attaques multiples d'un monstre (SPEC §18.4, M1) : ce que l'action permet, lu dans le texte ANGLAIS d'origine de
 * l'item (sous Babele, `flags.babele.originalPayload.description`), puis ce qu'une suite d'utilisations y fait tenir.
 *
 * Le Monster Manual cite ses attaques en enrichers, lisibles sans deviner : `[[/item Rend]]` (nom anglais),
 * `[[/item .mmBite0000000000]]` (id de l'item), `[[/item .mmSpellcasting00.Activity.<id>]]` (activité), et les sorts en
 * `@UUID[Compendium.….spells.Item.<id>]{Nom}` ; quelques fiches écrivent le nom en clair (« three Slam attacks »).
 * Chaque référence devient une CLÉ (`id:…`, `name:…`, `activity:…`, `spell:…`) ; l'adaptateur donne les clés d'une
 * utilisation, et une utilisation tient dans le plan si l'une de ses clés y figure — rien n'est résolu d'avance.
 *
 * Formes reconnues (307 créatures du MM, balayage du 2026-09-26) :
 *  - « makes three Rend attacks »                          un groupe de 3
 *  - « makes two attacks, using A or B in any combination » un groupe de 2, A ou B
 *  - « makes one A attack and two B attacks »              deux groupes
 *  - « makes three A attacks or two B attacks »            deux options (idem « …, or it makes two C attacks »)
 *  - « It can replace one attack / any attack / the Claw attack with a use of X (or Y) », « … with a Bite attack »,
 *    « … with a use of Spellcasting to cast <sort> »       remplacement : prend la place d'une attaque
 *  - « … and uses X (if available) », « … and it can use Spellcasting to cast <sort> »   usage en plus
 *  - « uses Eye Rays three times » (Tyrannœils, Spectateur)  un groupe de 3 utilisations de la capacité
 *  - « makes as many Bite attacks as it has heads » (Hydre) : sans borne (le nombre de têtes n'est pas une donnée)
 * Coquilles du MM tolérées : « makes » absent (Tigre-garou), « attacks » absent (Ancien dragon de bronze), point collé.
 *
 * Pur : des chaînes et des objets simples.
 */

/**
 * L'identifiant d'Attaques multiples, quelle que soit la fiche : celui du MM 2024 (`multiattack`), ceux que dnd5e tire du nom
 * d'une fiche importée sans identifiant ou traduite (« Attaque multiple », « Attaques multiples », « Multiattaque »), et
 * ceux d'un nom à précision (« Multiattack (Human or Hybrid Form Only) » → `multiattack-human-or-hybrid-form-only`).
 */
export function isMultiattackId(id) {
  const s = String(id ?? "");
  return ["multiattack", "multiattaque", "attaque-multiple", "attaques-multiples"].some(base => (s === base) || s.startsWith(`${base}-`));
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
/** « Remplacer n'importe quelle attaque » : autant qu'il y en a. Pas d'Infinity : le plan voyage en JSON (budget). */
export const ANY = 99;

const PLAIN_NAME = "[A-Z][A-Za-z'’-]*(?:\\s+(?:of\\s+)?[A-Z(][A-Za-z'’()-]*)*";
const REF = `(?:«\\d+»|${PLAIN_NAME})`;
const NUM = "(one|two|three|four|five|six|seven|eight|\\d+)";

/**
 * Remplace les références par des jetons `«n»` et nettoie le HTML. Les jetons évitent qu'un point d'uuid coupe une phrase.
 * @returns {{text: string, refs: string[]}}  refs[n] = clé de la référence n
 */
export function tokenize(html) {
  const refs = [];
  const token = key => { refs.push(key); return ` «${refs.length - 1}» `; };
  const text = String(html ?? "")
    .replace(/@UUID\[([^\]]*\.spells\.Item\.[^\]]*)\](?:\{[^}]*\})?/g, (_, uuid) => token(`spell:${uuid}`))
    .replace(/\[\[\/item\s*([^\]]*)\]\](?:\{[^}]*\})?/g, (_, arg) => token(refKey(arg.trim())))
    .replace(/\[\[lookup[^\]]*\]\](?:\{[^}]*\})?/g, " it ")
    .replace(/\[\[[^\]]*\]\](?:\{[^}]*\})?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\(level \d+ version\)/gi, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/’/g, "'")
    .replace(/\s+/g, " ").replace(/\s+([.,])/g, "$1").replace(/\.(?=[A-Z])/g, ". ").trim();
  return { text, refs };
}

/** Clé d'un argument d'enricher `[[/item …]]`. */
function refKey(arg) {
  if ( !arg ) return "unknown:";
  const activity = arg.match(/\.Activity\.([A-Za-z0-9]{16})$/);
  if ( activity ) return `activity:${activity[1]}`;
  const id = arg.replace(/^\./, "");
  if ( /^[A-Za-z0-9]{16}$/.test(id) ) return `id:${id}`;
  return `name:${arg.toLowerCase()}`;
}

/** Les clés d'une liste « A or B », « A, B, or C », « (A) X or (B) Spellcasting to cast Y ». */
function refsOf(phrase, refs) {
  const out = [];
  for ( let part of phrase.split(/\s*(?:,\s*or\s+|,\s*|\bor\b|\band\b|\beither\b|\([A-Z]\))\s*/) ) {
    part = part.trim();
    if ( !part ) continue;
    // « Spellcasting to cast X » : c'est le sort qui compte.
    const cast = part.match(/to cast\s+(.*)$/i);
    if ( cast ) part = cast[1];
    for ( const m of part.matchAll(new RegExp(REF, "g")) ) {
      const t = m[0].match(/^«(\d+)»$/);
      out.push(t ? refs[Number(t[1])] : `name:${m[0].trim().toLowerCase()}`);
    }
  }
  return [...new Set(out.filter(k => k !== "unknown:"))];
}

const count = word => NUMBERS[word.toLowerCase()] ?? Number(word);

/** Les groupes d'une option : « two attacks, using A or B in any combination », « one A attack and two B attacks ». */
function groupsOf(option, refs) {
  const any = option.match(new RegExp(`${NUM} attacks?,? using (.*?) in any combination`, "i"));
  if ( any ) {
    const keys = refsOf(any[2], refs);
    return keys.length ? [{ n: count(any[1]), refs: keys }] : null;
  }
  const heads = option.match(new RegExp(`as many (${REF}) attacks as`, "i"));
  if ( heads ) return [{ n: ANY, refs: refsOf(heads[1], refs) }];
  const times = option.match(new RegExp(`^\\s*uses? (${REF}) (twice|thrice|${NUM} times)`, "i"));
  if ( times ) return [{ n: { twice: 2, thrice: 3 }[times[2].toLowerCase()] ?? count(times[3]), refs: refsOf(times[1], refs) }];
  const groups = [];
  const re = new RegExp(`${NUM}\\s+(${REF}(?:\\s*(?:,\\s*or|,|or)\\s+${REF})*)\\s+attacks?\\b`, "gi");
  for ( const m of option.matchAll(re) ) {
    const keys = refsOf(m[2], refs);
    if ( keys.length ) groups.push({ n: count(m[1]), refs: keys });
  }
  // « makes three Rend. » : le mot « attacks » manque (Ancien dragon de bronze).
  const bare = !groups.length && option.match(new RegExp(`^\\s*${NUM}\\s+(${REF})\\s*$`, "i"));
  if ( bare ) groups.push({ n: count(bare[1]), refs: refsOf(bare[2], refs) });
  return groups.length ? groups : null;
}

/**
 * Le plan d'Attaques multiples, ou null si le texte ne se laisse pas lire.
 * @param {string} html  description anglaise de l'item
 * @returns {{options: Array<Array<{n: number, refs: string[]}>>, replace: Array<{n: number, refs: string[], of: string[]|null}>,
 *   extra: Array<{refs: string[]}>}|null}
 */
export function parseMultiattack(html) {
  const { text, refs } = tokenize(html);
  const sentences = text.split(/(?<=\.)\s+/);
  let options = null;
  const replace = [];
  const extra = [];
  for ( let sentence of sentences ) {
    sentence = sentence.replace(/\.$/, "");
    // Remplacement.
    const rep = sentence.match(new RegExp(`can replace (one|two|any|the (${REF})) attacks? with (?:a use of |an? |one use of )?(.*?)(?: attack)?(?: if available)?$`, "i"));
    if ( rep ) {
      const keys = refsOf(rep[3], refs);
      if ( keys.length ) replace.push({ n: rep[2] ? 1 : (rep[1].toLowerCase() === "any" ? ANY : count(rep[1])), refs: keys, of: rep[2] ? refsOf(rep[2], refs) : null });
      continue;
    }
    if ( options ) continue;
    const start = sentence.search(new RegExp(`\\bmakes\\b|\\buses? ${REF} (?:twice|thrice|${NUM} times)|\\b${NUM} attacks?, using`, "i"));
    if ( start < 0 ) continue;
    let body = sentence.slice(start).replace(/^makes\b/i, "");
    // Usages en plus : « and uses X (if available) », « and it can use Spellcasting to cast X ».
    const plus = body.match(/,?\s*and (?:it )?(?:can )?uses?\s+(.*)$/i);
    if ( plus ) {
      const keys = refsOf(plus[1].replace(/\s*if available$/i, "").replace(/\s+if it .*$/i, ""), refs);
      if ( keys.length ) extra.push({ refs: keys });
      body = body.slice(0, plus.index);
    }
    // Options : « three A attacks or two B attacks », « one A attack and one B attack, or it makes two C attacks ».
    const parts = body.replace(new RegExp(`\\battacks?,?\\s+or\\s+(?:it makes\\s+)?(?=${NUM}\\b)`, "gi"), "attacks|").split("|");
    const parsed = parts.map(p => groupsOf(p, refs));
    if ( parsed.every(Boolean) ) options = parsed;
  }
  return options ? { options, replace, extra } : null;
}

/**
 * Élargit chaque clé du plan à toutes celles du même item de la fiche : « Claw » par son nom et `.mmClaw…` par son id
 * désignent la même Griffe (Chimère : « replace the Claw attack », le groupe la cite par id).
 * @param {object} plan
 * @param {Array<string[]>} catalog  les clés de chaque item (et de chaque activité d'incantation) de la fiche
 */
export function expandPlan(plan, catalog) {
  if ( !plan ) return null;
  const widen = refs => [...new Set((refs ?? []).flatMap(k => [k, ...catalog.filter(keys => keys.includes(k)).flat()]))];
  return {
    options: plan.options.map(groups => groups.map(g => ({ ...g, refs: widen(g.refs) }))),
    replace: plan.replace.map(r => ({ ...r, refs: widen(r.refs), of: r.of ? widen(r.of) : null })),
    extra: plan.extra.map(e => ({ ...e, refs: widen(e.refs) }))
  };
}

/** Nombre d'attaques de l'option la plus longue (affichage « attaques 1/3 »). */
export function attackCount(plan) {
  return Math.max(0, ...(plan?.options ?? []).map(groups => groups.reduce((s, g) => s + g.n, 0)));
}

/**
 * La suite d'utilisations tient-elle dans le plan ? Chaque utilisation se range : attaque d'un groupe qui la cite,
 * remplacement (prend la place d'une attaque d'un groupe, celui du `of` s'il est dit), ou usage en plus (une fois
 * chacun). Essai de toutes les répartitions : quelques utilisations au plus.
 * @param {object} plan  rendu par `parseMultiattack`
 * @param {Array<string[]>} uses  les clés de chaque utilisation, dans l'ordre
 * @returns {{attacks: number}|null}  attaques comptées (hors usages en plus), ou null si la suite ne tient pas
 */
export function fitMultiattack(plan, uses) {
  if ( !plan ) return null;
  const has = (keys, list) => keys.some(k => list.includes(k));
  for ( const groups of plan.options ) {
    const free = groups.map(g => g.n);
    const replaced = plan.replace.map(() => 0);
    const extraUsed = plan.extra.map(() => false);
    let attacks = 0;
    const place = i => {
      if ( i === uses.length ) return true;
      const keys = uses[i];
      for ( const [g, group] of groups.entries() ) {
        if ( (free[g] < 1) || !has(keys, group.refs) ) continue;
        free[g]--; attacks++;
        if ( place(i + 1) ) return true;
        free[g]++; attacks--;
      }
      for ( const [r, rule] of plan.replace.entries() ) {
        if ( (replaced[r] >= rule.n) || !has(keys, rule.refs) ) continue;
        for ( const [g, group] of groups.entries() ) {
          if ( (free[g] < 1) || (rule.of && !has(rule.of, group.refs)) ) continue;
          free[g]--; replaced[r]++; attacks++;
          if ( place(i + 1) ) return true;
          free[g]++; replaced[r]--; attacks--;
        }
      }
      for ( const [e, rule] of plan.extra.entries() ) {
        if ( extraUsed[e] || !has(keys, rule.refs) ) continue;
        extraUsed[e] = true;
        if ( place(i + 1) ) return true;
        extraUsed[e] = false;
      }
      return false;
    };
    if ( place(0) ) return { attacks };
  }
  return null;
}

/**
 * §18.19 : ce qui reste d'Attaques multiples ouvertes, item par item (HUD, suivi de combat). Un item fait partie du plan si
 * l'une de ses utilisations y tient seule ; il y tient encore si elle tient après celles déjà faites.
 * @param {object} plan
 * @param {string[][]} used                                  Clés des utilisations déjà faites.
 * @param {Array<{id: string, uses: string[][]}>} candidates  Chaque item, avec les clés de chacune de ses activités.
 * @returns {{left: string[], spent: string[]}}  `left` : encore jouables ; `spent` : du plan, mais plus rien pour eux.
 */
export function multiattackStatus(plan, used, candidates) {
  const left = [];
  const spent = [];
  if ( !plan ) return { left, spent };
  for ( const { id, uses } of candidates ) {
    if ( !uses.some(keys => fitMultiattack(plan, [keys])) ) continue;
    if ( uses.some(keys => fitMultiattack(plan, [...used, keys])) ) left.push(id);
    else spent.push(id);
  }
  return { left, spent };
}
