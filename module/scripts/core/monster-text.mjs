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
 * K6 (SPEC §327) : ce que le texte d'une capacité de monstre dit des Réactions.
 *  - une parade : une activité de Réaction dont la réponse « adds N to its AC against that attack » (Contre-attaque du Commandant,
 *    Riposte du Capitaine pirate, Posture défensive, Tourbillon de sable) → la déclaration de la Parade du MM (`isHit`, `use`, `penalty`
 *    de N, ou du bonus de maîtrise quand le texte renvoie à une valeur calculée) ; « melee attack » dans le déclencheur : contre le corps à
 *    corps seulement ;
 *  - « can't take Reactions » → `noReactions` (le porteur d'un effet de l'item) ; « either an action or a Bonus Action », « an action or
 *    a Bonus Action, not both » → `actionOrBonus`.
 * @param {string} html
 * @param {{reaction?: boolean}} [data]  l'item a-t-il une activité de Réaction
 * @returns {{triggers?: object[], noReactions?: true, actionOrBonus?: true}}
 */
export function monsterReactions(html, { reaction=false, acEffect=null }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text ) return out;
  if ( reaction ) {
    const ac = text.match(/\badds? (\d+|…) to its AC against (?:that|the|the triggering) attack/i);
    if ( ac ) {
      const melee = /\bTrigger\s*:[^]*?\bmelee attack\b/i.test(text.split(/\bResponse\s*:/i)[0] ?? "");
      // La donnée porte l'effet « +N CA » (Contre-attaque, Riposte, Tourbillon de sable) : comme Bouclier — proposée si N peut faire
      // rater le coup, l'effet posé, le coup rejugé. Sans effet (Parade) : le bonus retiré au jet.
      if ( Number.isFinite(acEffect) ) out.triggers = [{ on: "isHit", if: { "hit.stoppableBy": acEffect, ...(melee ? { "activity.isMelee": true } : {}) }, do: [{ type: "use" }] }];
      else out.triggers = [{ on: "isHit", ...(melee ? { if: { "activity.isMelee": true } } : {}),
        do: [{ type: "use" }, { type: "penalty", formula: /^\d+$/.test(ac[1]) ? ac[1] : "@prof" }] }];
    }
  }
  // Une capacité à rayons numérotés : la restriction d'un rayon vaudrait pour tous ses effets — laissée.
  if ( segments(text).length > 1 ) return out;
  if ( /\bcan(?:'|no)t take (?:any )?Reactions\b/i.test(text) ) out.noReactions = true;
  if ( /\b(?:either )?an action or a Bonus Action(?:,? (?:but )?not both)?\b[^.]*\b(?:on|during) its turn\b|\bcan take (?:only )?(?:either )?an action or a Bonus Action\b/i.test(text) ) out.actionOrBonus = true;
  return out;
}

/**
 * K7 (SPEC §328) : ce que la capacité inflige à son porteur tour après tour, et les soins qu'elle bloque.
 *  - « the target takes [[/damage … activity=<id>]] damage at the start (end) of each of its turns », « loses […] Hit Points at the start of
 *    each of its turns » → `{ on: startOfTurn|endOfTurn, via: "effect", do: [{ type: "damage", to: "bearer", activity }] }`, pour les
 *    effets dont la phrase nomme l'état (« While Poisoned », « Until the grapple ends » → Agrippé), sinon pour tous ; pas une créature
 *    avalée ou engloutie (la brique Avaler s'en charge, §18.17), ni des dégâts que le porteur inflige autour de lui (« deals … to any
 *    creature ») ;
 *  - « can't regain Hit Points » (le texte parle de la cible) → `blocksHealing`.
 * Lit le HTML brut : l'enricher `[[/damage … activity=…]]` nomme l'activité de dégâts de la capacité.
 * @param {string} html
 * @param {Array<{id: string, statuses: string[]}>} [effects]
 * @returns {{triggers?: object[], blocksHealing?: true}}
 */
export function monsterRecurring(html, effects=[]) {
  const raw = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const out = {};
  const triggers = [];
  for ( const sentence of raw.split(/(?<=\.)\s+(?=[A-Z])/) ) {
    const moment = sentence.match(/\bat the (start|end) of each of its turns\b/i)?.[1];
    const activity = sentence.match(/\[\[\/damage[^\]]*\bactivity=([A-Za-z0-9]{16})/)?.[1];
    if ( !moment || !activity ) continue;
    if ( /\b(?:swallowed|engulfed)\b/i.test(sentence) || /\bdeals?\b[^.]*\bto (?:any|each) creature\b/i.test(sentence) ) continue;
    if ( !/\b(?:takes|loses)\b/i.test(sentence) ) continue;
    const named = conditionsIn(plainText(sentence).replace(/\bgrapple\b/i, "grappled"));
    const ids = effects.filter(e => (e.statuses ?? []).some(s => named.includes(s))).map(e => e.id);
    const on = moment.toLowerCase() === "start" ? "startOfTurn" : "endOfTurn";
    const step = { type: "damage", to: "bearer", activity };
    if ( ids.length && (ids.length < effects.length) ) for ( const id of ids ) triggers.push({ on, via: "effect", fromEffect: id, do: [step] });
    else triggers.push({ on, via: "effect", do: [step] });
  }
  // Plusieurs dégâts récurrents pour tous les effets à la fois (deux sérums de la Seringue) : lequel va avec quel effet n'est pas dit.
  const ambiguous = triggers.filter(t => !t.fromEffect).length > 1;
  const text = plainText(html);
  // Rayons numérotés : la règle d'un rayon vaudrait pour tous ses effets — laissée.
  const several = segments(text).length > 1;
  if ( triggers.length && !ambiguous && !several ) out.triggers = triggers;
  if ( !several && /\bthe target can(?:'|’|no)t regain Hit Points\b|\bUntil (?:this poison|the curse) ends, the target can(?:'|’|no)t regain Hit Points\b/i.test(text) ) out.blocksHealing = true;
  // « Whenever the golem is subjected to Fire damage, it (takes no damage and instead) regains … Hit Points equal to the Fire damage dealt ».
  const absorbs = [...text.matchAll(/\bWhenever (?:the )?[^.]*? is subjected to ([A-Za-z]+) damage, (?:it takes no damage and instead )?(?:it )?regains a number of Hit Points equal to the \1 damage dealt/gi)]
    .map(m => m[1].toLowerCase());
  if ( absorbs.length ) out.absorbsDamage = [...new Set(absorbs)];
  return out;
}

/**
 * K8 (SPEC §329) : poussées et tractions d'une capacité de monstre — « the target is pushed up to 10 feet straight away from the X »,
 * « pulled up to 15 feet straight toward the X » → `{ on: failedSave|hit, do: [{ type: "move", mode, distance, units: "ft" }] }` ; « If the
 * target is a Huge or smaller creature » / « Large or smaller » → `if: { "target.sizeAtMost" }`. Sur une sauvegarde : après « Failure » ;
 * sinon sur une attaque : au toucher. Pas une distance renvoyée à une valeur calculée (« pushed up to … »), ni « into the X's space ».
 * @param {string} html
 * @param {{save?: boolean, attack?: boolean}} [kinds]  les activités de l'item
 * @returns {object[]} déclarations `triggers`
 */
export function monsterPushes(html, { save=false, attack=false }={}) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const out = [];
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    const m = sentence.match(/\b(pushed|pulled) up to (\d+) feet(?: straight)? (?:away from|toward)\b/i);
    // Ni « pushed or pulled » (au choix), ni une traction vers le centre d'une zone (Implosion) : pas vers la créature.
    if ( !m || /\bor (?:pushed|pulled)\b/i.test(sentence) || /\bcenter\b/i.test(sentence) ) continue;
    const before = text.slice(0, text.indexOf(sentence));
    const failure = /\bFailure\s*:/i.test(sentence) || (/\bFailure\s*:[^]*$/i.test(before) && !/\bSuccess\s*:[^]*$/i.test(before.split(/\bFailure\s*:/i).at(-1)));
    const on = (save && failure) ? "failedSave" : (attack ? "hit" : null);
    if ( !on ) continue;
    const size = sentence.match(/\bIf the target is an? (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1]
      ?? before.split(/(?<=\.)\s+/).at(-1)?.match(/\bIf the target is an? (Tiny|Small|Medium|Large|Huge) or smaller\b/i)?.[1];
    const sizeAtMost = size ? { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" }[size.toLowerCase()] : null;
    out.push({ on, ...(sizeAtMost ? { if: { "target.sizeAtMost": sizeAtMost } } : {}),
      do: [{ type: "move", mode: /^pushed$/i.test(m[1]) ? "push" : "pull", distance: Number(m[2]), units: "ft" }] });
  }
  return out;
}

/**
 * K9 (SPEC §330) : la porte de type d'une capacité de monstre — « (Constructs and Undead succeed automatically) », « the target succeeds
 * automatically if it is a Construct or an Undead » → `targets.unaffectedIf` (un des types). Pas « a creature that isn't a Construct », qui
 * sert souvent à une autre clause (PV temporaires de la Morsure du Souverain lézard). Pas une capacité à rayons numérotés.
 * @param {string} html
 * @returns {{unaffectedIf: object}|null}
 */
export function monsterTypeGate(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\(([A-Za-z ,]+?) succeed automatically\)/i) ?? text.match(/\bsucceeds automatically if it is an? ([A-Za-z ,]+?(?: or an? [A-Za-z]+)?)\)?(?:[.;,]|$)/i);
  if ( !m ) return null;
  const TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
  const types = TYPES.filter(t => new RegExp(`\\b${t}s?\\b`, "i").test(m[1]));
  if ( !types.length ) return null;
  return { unaffectedIf: (types.length === 1) ? { "target.creatureType": types[0] } : { any: types.map(t => ({ "target.creatureType": t })) } };
}

/**
 * K10 (SPEC §331) : l'Avantage conditionnel d'une capacité de monstre, déclaré comme la Tactique de meute (`preAttackRoll`, `advantage`) :
 *  - « Advantage on attack rolls against any creature that doesn't have all its Hit Points » (Frénésie sanguinaire) → `target.wounded` ;
 *  - « While Bloodied, the X has Advantage on attack rolls » (Fureur du péril) → `source.hasStatus: bloodied` ;
 *  - « Advantage on … against a creature Grappled by it / it is grappling » → `target.grappledBySource` ;
 *  - « Advantage on attack rolls against a creature that has the Frightened condition » → `target.hasStatus`.
 * « this attack » (la Morsure de l'Ankheg contre celle qu'il agrippe) : seulement pour les attaques de l'item (`activity.identifier`).
 * @param {string} html
 * @param {string|null} [identifier]  identifiant de l'item, pour « this attack »
 * @returns {object[]} déclarations `triggers`
 */
export function monsterAdvantage(html, identifier=null) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const out = [];
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    if ( !/\bhas Advantage on (?:attack rolls|this attack|the attack|its attack)/i.test(sentence) && !/\bAdvantage on attack rolls\b/i.test(sentence) ) continue;
    let condition = null;
    if ( /\bdoesn(?:'|’)t have all (?:its|of its) Hit Points\b/i.test(sentence) ) condition = { "target.wounded": true };
    else if ( /\bWhile (?:it is )?Bloodied\b/i.test(sentence) ) condition = { "source.hasStatus": "bloodied" };
    else if ( /\b(?:Grappled by it|it is grappling|it has Grappled)\b/i.test(sentence) ) condition = { "target.grappledBySource": true };
    else {
      const status = sentence.match(/\bagainst (?:(?:a|any) (?:creature|target)|targets|creatures) (?:that (?:has|have)|with) the ([A-Za-z]+) condition\b/i)?.[1];
      if ( status && conditionsIn(status).length ) condition = { "target.hasStatus": status.toLowerCase() };
    }
    if ( !condition ) continue;
    const own = /\b(?:this|the) attack\b/i.test(sentence) && identifier;
    out.push({ on: "preAttackRoll", if: own ? { all: [condition, { "activity.identifier": identifier }] } : condition, do: [{ type: "advantage" }] });
  }
  return out;
}

/**
 * K11 (SPEC §332) : la donnée donne la moitié des dégâts sur une réussite (`onSave: half`) là où le texte ne donne rien — une clause
 * « Success: » sans dégâts (« The target is immune… », « can't take this action again… »), ou aucune clause « Success: » (Arc tueur du
 * Solar) → `saveDamage: { <activité>: "none" }` ; à l'inverse « Success: Half damage » sur une donnée `none` → `"half"`. « Success: [[/damage]] damage » (la moitié calculée par l'enricher) n'en est pas.
 * @param {string} html
 * @param {Array<{id: string, type: string, onSave?: string}>} activities
 * @returns {object|null}  `saveDamage`
 */
export function monsterSaveDamage(html, activities=[]) {
  const saves = activities.filter(a => (a.type === "save") && ["half", "none", "full"].includes(a.onSave));
  if ( !saves.length ) return null;
  const raw = String(html ?? "").replace(/<[^>]+>/g, " ");
  if ( !/\bFailure\s*:/i.test(raw) || (segments(plainText(html)).length > 1) ) return null;
  const success = raw.match(/\bSuccess\s*:\s*([^]*?)(?=\b(?:Failure|First Failure|Second Failure|Failure or Success)\s*:|$)/i)?.[1] ?? null;
  // « Success: Half damage » quand la donnée ne donne rien (Enveloppement du Cube gélatineux).
  if ( (success !== null) && /^\s*half (?:the |as much )?damage/i.test(success) ) {
    const nones = saves.filter(a => a.onSave === "none");
    return nones.length ? Object.fromEntries(nones.map(a => [a.id, "half"])) : null;
  }
  if ( (success !== null) && (/\bdamage\b|\bhalf\b/i.test(success)) ) return null;
  const halves = saves.filter(a => ["half", "full"].includes(a.onSave));
  return halves.length ? Object.fromEntries(halves.map(a => [a.id, "none"])) : null;
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

/** Taille écrite en anglais → clé de taille dnd5e. */
const SIZE_KEYS = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

/**
 * K12 (SPEC §333) : l'état que le texte pose et que la donnée oublie — « If the target is a Large or smaller creature, it has the
 * Prone condition » sur une attaque sans effet (Décharge aquatique, Coup de l'Élémentaire de l'eau), « Failure: The target has the
 * Restrained condition » sur une sauvegarde dont l'activité ne cite pas l'effet (Filet collant). Au toucher pour une attaque, sur
 * la sauvegarde ratée pour une sauvegarde ; limite de taille gardée. Rien quand une activité du même genre pose déjà cet état,
 * ni pour une phrase conditionnelle (« While », « If this damage reduces », « until it takes damage »).
 * @param {string} html
 * @param {{activities?: Array<{type: string, effects?: string[]}>, effects?: Array<{id: string, statuses?: string[]}>}} [data]
 * @returns {object[]} déclarations `triggers`
 */
export function monsterMissingStatus(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) || /\bone of the following\b/i.test(text) ) return [];
  const statusesOf = kind => new Set(activities.filter(a => a.type === kind).flatMap(a => a.effects ?? [])
    .flatMap(id => effects.find(e => e.id === id)?.statuses ?? []));
  const save = activities.some(a => a.type === "save");
  const attack = activities.some(a => a.type === "attack");
  const out = [];
  const sentences = text.split(/(?<=\.)\s+/);
  for ( const [i, sentence] of sentences.entries() ) {
    const m = sentence.match(/\b(?:it|the target) has the (Prone|Restrained|Blinded|Deafened|Frightened|Poisoned|Stunned|Incapacitated|Paralyzed) condition\b/i);
    if ( !m || /\b(?:While|until it takes damage|If this damage|reduces the target to 0)\b/i.test(sentence) ) continue;
    // Un état posé par le moteur n'a pas de durée : seulement ceux qui n'en ont pas (À terre, Entravé « until the net is destroyed »).
    if ( /\buntil (?:the (?:start|end)|the grapple ends)\b|\bfor (?:\d+|one|an?|…) (?:round|minute|hour|…)|\bon an? \d/i.test(sentence) ) continue;
    const status = m[1].toLowerCase();
    const before = sentences.slice(0, i).join(" ");
    const failure = /\bFailure\s*:/i.test(sentence) || (/\bFailure\s*:/i.test(before) && !/\bSuccess\s*:[^]*$/i.test(before.split(/\bFailure\s*:/i).at(-1)));
    const on = (save && failure) ? "failedSave" : ((attack && !save) ? "hit" : null);
    if ( !on || statusesOf(on === "hit" ? "attack" : "save").has(status) ) continue;
    const size = sentence.match(/\bIf the target is an? (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1];
    out.push({ on, ...(size ? { if: { "target.sizeAtMost": SIZE_KEYS[size.toLowerCase()] } } : {}), do: [{ type: "status", status }] });
  }
  return out;
}

/**
 * K12 (SPEC §333) : « the target can't make Opportunity Attacks until … » (Fouet d'os, Coup effroyable) → `noOpportunityAttacks`,
 * porté par l'effet de l'item ; seulement si l'item a un effet.
 */
export function monsterNoOpportunity(html, effects=[]) {
  if ( !effects.length ) return false;
  return /\bcan[’']t (?:make|take) Opportunity ?(?:Attacks?)?/i.test(plainText(html));
}

/**
 * K12 (SPEC §333) : « takes the Dash, the Disengage, or Hide action » (Ruse), « takes the Dash and Disengage actions » (Hâte du
 * Golem d'argile) → `basicActions` de l'activité utilitaire : « or » au choix, « and » toutes.
 * @param {string} html
 * @param {Array<{id: string, type: string}>} activities
 */
export function monsterBasicActions(html, activities=[]) {
  const utility = activities.find(a => a.type === "utility");
  if ( !utility ) return null;
  const m = plainText(html).match(/\btakes the ((?:(?:the |, |,? (?:and|or) )*(?:Dash|Disengage|Hide|Dodge))+) actions?\b/i);
  if ( !m ) return null;
  const actions = [...m[1].matchAll(/\b(Dash|Disengage|Hide|Dodge)\b/gi)].map(x => x[1].toLowerCase());
  if ( !actions.length ) return null;
  const rule = (actions.length === 1) ? actions[0] : (/\bor\b/i.test(m[1]) ? { choose: actions } : actions);
  return { [utility.id]: rule };
}
