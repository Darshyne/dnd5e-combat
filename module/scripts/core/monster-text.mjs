/**
 * K1 (repasse des créatures, SPEC §322) : ce que le texte anglais d'origine d'une capacité de monstre dit de la FIN de ses états, et que
 * le Monster Manual 2024 n'écrit dans aucune donnée — les Tentacules du Charognard rampant, le Souffle euphorisant, les Spores du Vrock
 * « rejouent la sauvegarde à la fin de chacun de leurs tours » ; le Regard du Basilic et le Souffle de la Gorgone ont un premier échec
 * (Entravé) et un second (Pétrifié) ; le Souffle soporifique et le Regard du Chacal-garou « prennent fin si la cible subit des dégâts ».
 * Les règles de dnd5e ne le jouent pas : sans ce texte, l'état dure la minute entière (54 écarts hauts de la repasse).
 *
 * Lu comme M4 (`core/durations.mjs`) et M1 (`core/multiattack.mjs`) : le texte anglais, gardé par Babele sous un monde traduit. Rend des
 * déclarations du schéma du contenu (`triggers`, `via: "effect"`), que le contenu livré par identifiant remplace s'il en déclare.
 * Une capacité à plusieurs issues (Rayons oculaires : charme, paralysie, sommeil…) est lue par segment, et chaque règle ne vaut que pour
 * les effets dont l'état est nommé dans son segment (`fromEffect`).
 *
 * Pur : des chaînes et des objets simples.
 */

const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified",
  "poisoned", "prone", "restrained", "stunned", "unconscious"];

/** Texte lisible : enrichers résolus en « … » sauf les références d'état (« &Reference[Paralyzed] » → « Paralyzed »). */
export function plainText(html) {
  return String(html ?? "")
    .replace(/&(?:amp;)?Reference\[([A-Za-z]+)[^\]]*\](?:\{([^}]*)\})?/g, (_, id, label) => label || id)
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (_, label) => label || "…")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[’]/g, "'")
    .replace(/\s+/g, " ").trim();
}

/**
 * Les segments d'une capacité à plusieurs issues : « 1: Charm Ray. … 2: Paralyzing Ray. … » (Rayons oculaires), « First Roar. … Second
 * Roar. … » (Rugissement du Sphinx de la vaillance), sinon le texte entier. « First Failure: » (deux-points) n'en coupe pas.
 */
function segments(text) {
  const parts = text.split(/(?=\b\d{1,2}\s*:\s*[A-Z][A-Za-z' ]{2,40}\.)|(?=\b(?:First|Second|Third|Fourth|Fifth) [A-Z][a-z]+\.\s)/);
  return parts.length > 1 ? parts : [text];
}

/** Les états nommés dans un passage (« has the Paralyzed condition »). */
export function conditionsIn(text) {
  return CONDITIONS.filter(c => new RegExp(`\\b${c}\\b`, "i").test(text));
}

/**
 * Les règles de fin lues dans un segment.
 * @returns {{resave: {on: string, tally?: object}|null, endsOnDamage: boolean, resaveOnDamage: boolean}}
 */
export function readEndings(text) {
  let resave = null;
  // Premier échec puis second : « First Failure: … repeats the save at the end of its next turn … Second Failure: … has the Petrified
  // condition », ou « … until the end of its next turn, at which point / when it repeats the save. Second Failure: … ».
  const second = text.match(/\bSecond Failure\s*:\s*([^]*)$/i);
  if ( second && /\b(?:repeats? the save at the end of its next turn|end of its next turn,? (?:at which point|when) it repeats the save)\b/i.test(text.slice(0, second.index)) ) {
    const status = conditionsIn(second[1].split(/\binstead of\b/i)[0])[0] ?? null;
    resave = { on: "endOfTurn", tally: { successes: 1, failures: 1, ...(status ? { status } : {}) } };
  } else {
    // « repeats the save at the end of each of its turns », ou « At the end of each of its turns, the target repeats the … save »
    // (Griffe bannissante de l'Arcanaloth, Création de tourbillon du Djinn, Frayeur du Quasit).
    const m = text.match(/\brepeats? the (?:[A-Za-z…]+ )?sav(?:e|ing throw) at the (end|start) of each of its turns\b/i)
      ?? text.match(/\bAt the (end|start) of each of its turns, the target repeats the (?:[A-Za-z…]+ )?sav(?:e|ing throw)\b/i);
    if ( m ) resave = { on: m[1].toLowerCase() === "end" ? "endOfTurn" : "startOfTurn" };
  }
  // « … for 1 minute or until it takes damage », « This effect ends for the target if it takes damage », « The condition ends if the
  // target takes damage », « succeeds automatically … if it takes damage » (Bourdonnement du Chasme). Pas « whenever it takes damage »
  // (sauvegarde rejouée), ni « an X condition, which ends early if … » (Dard du Pseudodragon : seul l'Inconscient tombe, pas l'effet),
  // ni les dégâts subis ailleurs (« takes damage while … »).
  const endsOnDamage = /\b(?:until (?:it|the target) takes damage|(?:the (?:effect|condition) )?ends?(?: for the target)? if (?:it|the target) takes damage|(?:succeeds|ends) automatically[^.]*\bif it takes damage)\b/i.test(text)
    && !/\bwhich ends early if the target takes damage\b/i.test(text);
  const resaveOnDamage = /\brepeats? the (?:[A-Za-z]+ )?save (?:whenever|each time) it takes damage\b/i.test(text);
  return { resave, endsOnDamage, resaveOnDamage };
}

/** L'activité d'un segment numéroté (« 9: Disintegration Ray. » → l'activité nommée « 9: … »), ou null. */
function activityOfSegment(part, activities) {
  const n = part.match(/^\s*(\d{1,2})\s*:/)?.[1];
  if ( !n ) return null;
  return activities.find(a => new RegExp(`^\\s*${n}\\s*:`).test(a.name ?? ""))?.id ?? null;
}

const DEATH = /\b(?:dies|die|kills? (?:it|the target)|is killed|disintegrates?|turns? to dust|dissolves? into ash)\b/i;
// Ce qui, AVANT les 0 PV, montre que la phrase parle d'autre chose que de la cible tuée (le porteur, un objet, une stabilisation).
const NOT_THE_TARGET = /\b(?:only if|instead|becomes Stable|tome|gem|rope|bag|canister|limb|body|possession|curse)\b/i;

/**
 * K2 (SPEC §323) : la mort que le texte promet, lue dans une capacité de monstre.
 *  - « If this damage reduces the target to 0 Hit Points, it dies / the X kills it / it disintegrates into dust », « A Humanoid reduced
 *    to 0 Hit Points by this damage dies », « A creature dies and turns to dust if reduced to 0 Hit Points by this attack » →
 *    `killsAtZero` (avec `types: ["humanoid"]`, `sizeAtMost` quand le texte les dit, `activities` pour un segment numéroté) ;
 *  - « If the target has N Hit Points or fewer, it dies / it drops to 0 Hit Points. Otherwise … damage » → `hpTiers` : à N PV ou moins,
 *    pas de dégâts, mort (`statuses: ["dead"]`) ou PV à 0 (`zero: true` — la règle des 0 PV du moteur décide ensuite) ; au-dessus, les
 *    dégâts sans l'effet « Mort » que la donnée pose d'office (Toucher de la mort d'Ankhtepot).
 * Pas les phrases qui parlent du porteur (« dies only if… », le tome, la gemme), ni « becomes Stable », ni « rises as », ni « instead ».
 * @param {string} html
 * @param {{activities?: Array<{id: string, name: string}>, effects?: Array<{id: string, statuses: string[]}>}} [data]
 * @returns {{killsAtZero?: object|true, hpTiers?: object[]}}
 */
export function monsterDeaths(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text ) return out;
  const parts = segments(text);
  const kills = [];
  for ( const part of parts ) {
    const activity = (parts.length > 1) ? activityOfSegment(part, activities) : null;
    if ( (parts.length > 1) && !activity ) continue;
    for ( const sentence of part.split(/(?<=\.)\s+/) ) {
      const zero = sentence.search(/\b0 Hit Points\b/i);
      if ( (zero < 0) || !DEATH.test(sentence) || /\bbecomes Stable\b/i.test(sentence) ) continue;
      const before = sentence.slice(0, zero);
      if ( NOT_THE_TARGET.test(before) || !/\b(?:target|creature|Humanoid)\b/i.test(before) ) continue;
      const rule = {};
      if ( /\bHumanoid\b/.test(sentence) ) rule.types = ["humanoid"];
      const size = sentence.match(/\b(Tiny|Small|Medium|Large|Huge) or smaller\b/i)?.[1];
      if ( size ) rule.sizeAtMost = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge" }[size.toLowerCase()];
      if ( activity ) rule.activities = [activity];
      kills.push(rule);
    }
    const tier = part.match(/\bIf the (?:target|creature|[a-z]+|…) has (\d+) Hit Points or fewer, it (dies|drops to 0 Hit Points)\b/i);
    if ( tier ) {
      const atMost = Number(tier[1]);
      const low = { atMost, damage: false, ...(/^dies$/i.test(tier[2]) ? { statuses: ["dead"] } : { zero: true }), ...(activity ? { activities: [activity] } : {}) };
      const deadEffects = effects.filter(e => (e.statuses ?? []).includes("dead")).map(e => e.id);
      const high = deadEffects.length ? { effects: effects.filter(e => !deadEffects.includes(e.id)).map(e => e.id) } : {};
      if ( activity ) high.activities = [activity];
      out.hpTiers = [...(out.hpTiers ?? []), low, high];
    }
  }
  if ( kills.length ) {
    const merged = {};
    if ( kills.every(k => k.types) ) merged.types = kills[0].types;
    if ( kills.every(k => k.sizeAtMost) ) merged.sizeAtMost = kills[0].sizeAtMost;
    if ( kills.every(k => k.activities) ) merged.activities = [...new Set(kills.flatMap(k => k.activities))];
    out.killsAtZero = Object.keys(merged).length ? merged : true;
  }
  return out;
}

/**
 * K3 (SPEC §324) : un seul des effets de la capacité, quand le texte le dit — dnd5e pose sinon tous ceux de l'activité.
 *  - « a condition determined by rolling 1d4: on a 1, Charmed; on a 2, Frightened… » → `{ effects: "one", roll: true, order }` (les
 *    effets dans l'ordre où le texte nomme leurs états) ;
 *  - « the Charmed or Frightened condition (the X's choice) » → `{ effects: "one" }` ;
 *  - « X chooses a damage type » (un effet par type dans la donnée : Malédiction de l'Œil omniscient) → `{ effects: "one" }`.
 * Pas une capacité à plusieurs segments (Rayons oculaires : le dé choisit l'activité, pas l'effet).
 * @param {string} html
 * @param {Array<{id: string, statuses: string[]}>} effects
 * @returns {{effects: "one", roll?: true, order?: string[]}|null}
 */
export function monsterChoice(html, effects=[]) {
  const text = plainText(html);
  if ( !text || (effects.length < 2) || (segments(text).length > 1) ) return null;
  const rolled = text.match(/\b(?:determined by rolling|roll(?:ing)? (?:a )?)1?d(\d+)\b([^]*)$/i);
  if ( rolled ) {
    const rest = rolled[2].slice(0, 400);
    const order = [];
    for ( const m of rest.matchAll(/\bon an? \d+\s*,\s*(?:the target has the )?([A-Za-z]+)/gi) ) {
      const e = effects.find(x => (x.statuses ?? []).includes(m[1].toLowerCase()) && !order.includes(x.id));
      if ( e ) order.push(e.id);
    }
    if ( order.length >= 2 ) return { effects: "one", roll: true, order };
  }
  if ( /\bthe [A-Za-z]+ or [A-Za-z]+ condition \([^)]*\bchoice\)/i.test(text) ) return { effects: "one" };
  // « suffers one of the following effects of the X's choice » (Cimeterre de l'Amiral pirate), « shape-shifts to resemble a rat (…),
  // a raven (…), or a spider (…) » (Changement d'aspect du Diablotin, du Quasit : une forme à la fois).
  if ( /\bone of the following effects(?: of the [^.:]*'s choice| \([^)]*\bchoice\))/i.test(text) ) return { effects: "one" };
  // « the target has the X's choice of (A) the Charmed condition … or (B) the Prone condition » (Distorsion psychique du Githzerai,
  // Galvaniser les alliés d'Ez d'Avenir).
  if ( /\bchoice of \(A\)[^]*\bor \(B\)/i.test(text) ) return { effects: "one" };
  if ( /\bshape-shifts? to resemble an? [A-Za-z -]+ \([^)]*\), an? [A-Za-z -]+ \([^)]*\),? or an? [A-Za-z -]+/i.test(text) ) return { effects: "one" };
  if ( /\bchooses a damage type\b/i.test(text) ) return { effects: "one" };
  return null;
}

/**
 * Les déclarations de fin d'une capacité de monstre, d'après son texte anglais.
 * @param {string} html                                         description anglaise d'origine
 * @param {Array<{id: string, statuses: string[]}>} effects     effets de l'item (pour rattacher une règle à son issue)
 * @returns {object[]}  déclarations `triggers` (schéma du contenu), vide s'il n'y a rien à lire
 */
export function monsterEndings(html, effects=[]) {
  const text = plainText(html);
  if ( !text ) return [];
  const parts = segments(text);
  const out = [];
  for ( const part of parts ) {
    const { resave, endsOnDamage, resaveOnDamage } = readEndings(part);
    if ( !resave && !endsOnDamage && !resaveOnDamage ) continue;
    // Une seule issue (ou des effets sans état) : la règle vaut pour tout effet de l'item ; sinon pour les effets dont l'état est nommé ici.
    let from = [null];
    if ( parts.length > 1 ) {
      const named = conditionsIn(part);
      const ids = effects.filter(e => (e.statuses ?? []).some(s => named.includes(s))).map(e => e.id);
      if ( !ids.length ) continue;
      from = ids;
    }
    for ( const id of from ) {
      const at = id ? { fromEffect: id } : {};
      if ( resave ) out.push({ on: resave.on, via: "effect", ...at, do: [{ type: "resave", ...(resave.tally ? { tally: resave.tally } : {}) }] });
      if ( resaveOnDamage ) out.push({ on: "isDamaged", via: "effect", ...at, do: [{ type: "resave" }] });
      else if ( endsOnDamage ) out.push({ on: "isDamaged", via: "effect", ...at, do: [{ type: "remove" }] });
    }
  }
  return out;
}
