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
    // K12 (§333) : aussi « against melee attack rolls (including the triggering attack) until the start of its next turn » (Posture
    // défensive) — l'effet « +N CA » de l'item dure alors jusqu'au début de son tour.
    const ac = text.match(/\badds? (\d+|…) to its AC against (?:that|the|the triggering) attack/i)
      ?? text.match(/\badds? (\d+|…) to its AC against (?:melee )?attack rolls \(including the triggering attack\)/i);
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
export function monsterRecurring(html, effects=[], activities=[]) {
  const raw = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
  const out = {};
  const triggers = [];
  // §334 : un enricher sans activité (« [[/damage average]] », ou « 3 ([[/r 1d6]]) Piercing damage ») — l'unique activité de dégâts.
  const damageActivities = activities.filter(a => a.type === "damage");
  for ( const sentence of raw.split(/(?<=\.)\s+(?=[A-Z])/) ) {
    // §334 : « at the start of each of the water elemental's turns » — le tour de la créature qui a posé l'effet (`originTurnStart`).
    const turn = sentence.match(/\bat the (start|end) of each of (its|the [^.]*?['’]s|his|her) turns\b/i);
    const moment = turn?.[1];
    const ofOrigin = !!turn && /^the /i.test(turn[2]);
    if ( ofOrigin && (moment.toLowerCase() !== "start") ) continue;
    const activity = sentence.match(/\[\[\/damage[^\]]*\bactivity=([A-Za-z0-9]{16})/)?.[1]
      ?? (((/\[\[\/damage\b/.test(sentence) || /\bdamage\b/i.test(sentence)) && (damageActivities.length === 1)) ? damageActivities[0].id : null);
    if ( !moment || !activity ) continue;
    if ( /\b(?:swallowed|engulfed)\b/i.test(sentence) || /\bdeals?\b[^.]*\bto (?:any|each) creature\b/i.test(sentence) ) continue;
    if ( !/\b(?:takes|loses)\b/i.test(sentence) ) continue;
    const named = conditionsIn(plainText(sentence).replace(/\bgrapple\b/i, "grappled"));
    const ids = effects.filter(e => (e.statuses ?? []).some(s => named.includes(s))).map(e => e.id);
    const on = ofOrigin ? "originTurnStart" : (moment.toLowerCase() === "start" ? "startOfTurn" : "endOfTurn");
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
  // K9 (§334) : aussi « Constructs and Undead automatically succeed on this save », « each creature … that isn't an Undead », « and
  // isn't a Construct or an Undead » (Cri funeste, Perturbation de la vie, Visage horrifiant, Marionnettiste du sang).
  const m = text.match(/\(([A-Za-z ,]+?) succeed automatically\)/i) ?? text.match(/\bsucceeds automatically if it is an? ([A-Za-z ,]+?(?: or an? [A-Za-z]+)?)\)?(?:[.;,]|$)/i)
    ?? text.match(/\b((?:Constructs|Undead|Oozes|Plants|Elementals)(?:,? (?:and|or) (?:Constructs|Undead|Oozes|Plants|Elementals))*) automatically succeed on this save/i)
    ?? text.match(/\b(?:that|and) isn['’]t an? ((?:Construct|Undead|Ooze|Plant|Elemental)(?: or an? (?:Construct|Undead|Ooze|Plant|Elemental))*)\b/i);
  if ( !m ) return null;
  // Une porte de sauvegarde se dit avant la première issue (« Failure: ») : ailleurs, la clause vaut pour autre chose (PV temporaires
  // de la Morsure du Souverain lézard : « a creature that isn't a Construct or an Undead »).
  const failure = text.search(/\bFailure\s*:/i);
  if ( !/\bSaving Throw\b/i.test(text) || ((failure >= 0) && (m.index > failure)) ) return null;
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
    // §334 : aussi « it starts burning » (Contact du magmin) — l'état En feu de dnd5e.
    const m = sentence.match(/\b(?:it|the target) has the (Prone|Restrained|Blinded|Deafened|Frightened|Poisoned|Stunned|Incapacitated|Paralyzed) condition\b/i)
      ?? sentence.match(/\b(?:it|the target) starts (burning)\b/i);
    if ( !m || /\b(?:While|until it takes damage|If this damage|reduces the target to 0)\b/i.test(sentence) ) continue;
    // Un état posé par le moteur n'a pas de durée : la seule durée lue est un tour (`effectEnds` « status:<état> », §334) —
    // « until the start of the wyvern's next turn » (le lanceur), « until the end of its next turn » (la cible).
    const turn = sentence.match(/\buntil the (start|end) of (?:the \S+?['’]s|its) next turn\b/i);
    const ends = turn ? `${/\bof its next turn/i.test(turn[0]) ? "bearer" : "caster"}Turn${(turn[1].toLowerCase() === "start") ? "Start" : "End"}` : null;
    if ( !ends && /\buntil (?:the (?:start|end)|the grapple ends)\b|\bfor (?:\d+|one|an?|…) (?:round|minute|hour|…)|\bon an? \d/i.test(sentence) ) continue;
    const status = m[1].toLowerCase();
    const before = sentences.slice(0, i).join(" ");
    const failure = /\bFailure\s*:/i.test(sentence) || (/\bFailure\s*:/i.test(before) && !/\bSuccess\s*:[^]*$/i.test(before.split(/\bFailure\s*:/i).at(-1)));
    const on = (save && failure) ? "failedSave" : ((attack && !save) ? "hit" : null);
    if ( !on || statusesOf(on === "hit" ? "attack" : "save").has(status) ) continue;
    const size = sentence.match(/\bIf the target is an? (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1];
    out.push({ on, ...(size ? { if: { "target.sizeAtMost": SIZE_KEYS[size.toLowerCase()] } } : {}), do: [{ type: "status", status }], ...(ends ? { ends } : {}) });
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

/**
 * K12 (SPEC §333) : « each creature in a 30-foot Emanation … that can see the doppelganger » (Visage troublant, Visage horrifiant,
 * Chair qui se défait) → `targets.unaffectedIf: { "target.seesSource": false }` : une créature qui ne voit pas la source n'est pas
 * affectée. Seulement pour une capacité à sauvegarde.
 */
export function monsterSightGate(html, activities=[]) {
  if ( !activities.some(a => a.type === "save") ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  return /\b(?:each|any)\b[^.:]{0,120}\bthat can see (?:the \S|it\b|him\b|her\b)/i.test(text) ? { "target.seesSource": false } : null;
}

/**
 * K1 (SPEC §334) : « Success: The target is immune to this cloaker's Moan for the next 24 hours » (Gémissement, Regard soporifique,
 * Visage horrifiant, Regard glaçant…) → sur une sauvegarde réussie, une marque `immune:<identifiant>` de cette durée ; la porte
 * `target.hasMark` écarte ensuite la créature marquée (ni sauvegarde, ni effet). Pas pour une attaque (Morsure des lycanthropes : la
 * porte écarterait aussi les dégâts du coup ; l'immunité à la malédiction y reste au MJ).
 * @param {string} html
 * @param {string} identifier
 * @param {Array<{type: string}>} [activities]
 * @returns {{trigger: object, gate: object}|null}
 */
export function monsterImmunity(html, identifier, activities=[]) {
  if ( !identifier || activities.some(a => a.type === "attack") ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\bSuccess\s*:\s*The target is immune to [^.]*? for (?:the next )?(\d+|an?|one) (minute|hour)s?\b/i);
  if ( !m ) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const seconds = n * ((m[2].toLowerCase() === "hour") ? 3600 : 60);
  const mark = `immune:${identifier}`;
  return { trigger: { on: "savedSave", do: [{ type: "mark", mark, label: "Marque.Immunite", seconds }] }, gate: { "target.hasMark": mark } };
}

/**
 * §334 : la durée que le texte donne à l'effet d'une capacité, quand elle se compte en tours (la donnée met souvent « 1 tour », qui tombe
 * au début du tour du combattant suivant) :
 *  - « the target has the Restrained condition until the end of its next turn » → `effectEnds` de l'effet qui porte cet état :
 *    `bearerTurnEnd` (« its ») ou `casterTurnEnd` (« the spy master's ») ; de même « start » ;
 *  - « the target can't take Reactions until … » sur un effet sans état → `noReactions` de cet effet, et sa durée ;
 *  - « the creature can't regain Hit Points » sur un effet sans état → `blocksHealing` de cet effet.
 * Un texte à plusieurs segments (rayons numérotés) est laissé.
 * @param {string} html
 * @param {{activities?: Array<{type: string, effects?: string[]}>, effects?: Array<{id: string, statuses?: string[]}>}} [data]
 * @returns {{effectEnds?: object, noReactions?: string[], blocksHealing?: string[]}}
 */
export function monsterEffectDurations(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text || (segments(text).length > 1) ) return out;
  const cited = new Set(activities.flatMap(a => a.effects ?? []));
  const own = effects.filter(e => cited.has(e.id));
  const bare = own.filter(e => !(e.statuses ?? []).length);
  const endOf = m => `${/^its$/i.test(m[2]) ? "bearer" : "caster"}Turn${(m[1].toLowerCase() === "start") ? "Start" : "End"}`;
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    const turn = sentence.match(/\buntil the (start|end) of (its|the [^.]*?['’]s|his|her) next turn\b/i);
    if ( !turn || /^(?:his|her)$/i.test(turn[2]) ) continue;
    const status = sentence.match(/\bhas the (Prone|Restrained|Blinded|Deafened|Frightened|Poisoned|Stunned|Incapacitated|Paralyzed|Charmed|Grappled) condition\b/i)?.[1]?.toLowerCase();
    if ( status ) {
      for ( const e of own.filter(e => (e.statuses ?? []).includes(status)) ) (out.effectEnds ??= {})[e.id] = endOf(turn);
      continue;
    }
    if ( /\bcan[’']t take (?:a Bonus Action or )?Reactions?\b|\bcan[’']t take a Bonus or Reaction\b/i.test(sentence) && (bare.length === 1) ) {
      out.noReactions = [bare[0].id];
      (out.effectEnds ??= {})[bare[0].id] = endOf(turn);
    }
  }
  if ( (bare.length === 1) && /\b(?:the creature|the target) can[’']t regain Hit Points\b/i.test(text) ) out.blocksHealing = [bare[0].id];
  return out;
}

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/**
 * §334 : la fenêtre d'une Réaction de monstre, d'après son déclencheur (« Trigger: … », ou la condition d'activation de l'activité de
 * Réaction) — la Réaction est proposée (`use`) au moment correspondant du moteur :
 *  - « misses the kuo-toa with a melee attack roll » → `isMissed` (corps à corps) ;
 *  - « hits it with an attack roll », « An attack roll hits the … », « is hit by an attack roll » → `isHit` ;
 *  - « makes an attack roll against it » → `isAttacked` ;
 *  - « takes Piercing or Slashing damage », « is subjected to Cold damage », « deals damage to it » → `isDamaged` (types gardés) ;
 *  - « within 30 feet … casts a spell » → `castsSpell`.
 * Le sujet doit être la créature elle-même (pas « A Bloodied creature … takes damage »). Rien pour les autres déclencheurs.
 * @param {string} html
 * @param {string[]} [conditions]  conditions d'activation des activités de Réaction
 * @param {boolean} [outward]      l'activité de Réaction vise une autre créature (`use` sur la source du déclencheur)
 * @param {string|null} [activity] l'id de l'activité de Réaction
 * @returns {object[]} déclarations `triggers`
 */
export function monsterReactionWindow(html, conditions=[], outward=false, activity=null) {
  // Une Réaction qui vise une autre créature (sauvegarde, attaque, dégâts : Bouclier collant) part sur celle qui l'a déclenchée ; l'activité
  // de Réaction est nommée (l'item en a parfois d'autres : les tests pour se libérer du Bouclier collant).
  const use = [{ type: "use", ...(activity ? { activity } : {}), ...(outward ? { target: "source" } : {}) }];
  const text = plainText(html);
  const declared = text.match(/\bTrigger\s*:\s*([^]*?)(?=\bResponse\b|$)/i)?.[1] ?? "";
  const sources = [declared, ...conditions.map(c => plainText(c))].map(s => s.trim()).filter(s => s && !/^[….\s]*$/.test(s));
  for ( const t of sources ) {
    if ( /\bmiss(?:es|ed)\b[^.]*\bmelee attack roll\b/i.test(t) ) return [{ on: "isMissed", if: { "activity.isMelee": true }, do: use }];
    if ( /\ban attack roll hits (?:it|him|her|the \S+|[A-Z]\w+)\b|\bhits (?:it|him|her|the \S+) with an attack roll\b|\bis hit by an? (?:melee )?attack roll\b/i.test(t) ) {
      return [{ on: "isHit", ...(/\bmelee attack roll\b/i.test(t) ? { if: { "activity.isMelee": true } } : {}), do: use }];
    }
    if ( /\bmakes an attack roll against (?:it|him|her|them)\b/i.test(t) ) return [{ on: "isAttacked", do: use }];
    // Le sujet est la créature (« The shoggoth … », « Laurie … »), ou sous-entendu dans la condition (« takes Acid … damage »).
    if ( /^(?:the|it|takes|is|[A-Z][a-z]+)\b/i.test(t) && !/^(?:A|An|Another|Each)\b/.test(t) ) {
      const dmg = t.match(/\b(?:takes|is subjected to) ((?:[A-Za-z]+, )*[A-Za-z]+(?:,? or [A-Za-z]+)?) damage\b/i);
      if ( dmg ) {
        const types = DAMAGE_TYPES.filter(k => new RegExp(`\\b${k}\\b`, "i").test(dmg[1]));
        return [{ on: "isDamaged", ...(types.length ? { if: { "damage.hasType": types } } : {}), do: use }];
      }
      if ( /\btakes damage\b/i.test(t) ) return [{ on: "isDamaged", do: use }];
    }
    if ( /\bdeals damage to (?:it|him|her)\b/i.test(t) ) return [{ on: "isDamaged", do: use }];
    if ( /\bcasts a spell\b/i.test(t) ) return [{ on: "castsSpell", do: use }];
  }
  return [];
}

/**
 * §334 : l'Avantage que la condition d'activation d'une attaque donne (« with Advantage if the target doesn't have all its Hit Points »,
 * « … if the target is Grappled by the bugbear ») — le texte du bloc ne le dit que par `[[lookup @activation.condition]]`. Pour les
 * attaques de l'item seulement.
 * @param {string[]} conditions   conditions d'activation des activités d'attaque
 * @param {string|null} identifier
 * @returns {object[]} déclarations `triggers`
 */
export function monsterActivationAdvantage(conditions=[], identifier=null) {
  if ( !identifier ) return [];
  for ( const raw of conditions ) {
    const c = plainText(raw ?? "");
    if ( !/\bwith Advantage if\b/i.test(c) ) continue;
    let condition = null;
    if ( /\bdoesn['’]t have all (?:of )?its Hit Points?\b/i.test(c) ) condition = { "target.wounded": true };
    else if ( /\bis Grappled by (?:the \S+|it|him|her)\b/i.test(c) ) condition = { "target.grappledBySource": true };
    if ( condition ) return [{ on: "preAttackRoll", if: { all: [condition, { "activity.identifier": identifier }] }, do: [{ type: "advantage" }] }];
  }
  return [];
}

/**
 * §334 : « Attack rolls against the displacer beast have Disadvantage » (Déplacement, Forme floue, Forme incompréhensible) — une
 * déclaration `preAttackRoll` portée par l'item de la CIBLE (`defends: true`) : Désavantage, sauf si elle est Neutralisée quand le texte
 * le dit (« suppressed while … Incapacitated », « unless … has the Incapacitated condition »).
 * @param {string} html
 * @returns {object[]} déclarations `triggers`
 */
export function monsterDefense(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  if ( !/\bAttack rolls against (?:the \S+|it|him|her) (?:have|are made with) Disadvantage\b/i.test(text) ) return [];
  const incapacitated = /\bIncapacitated\b/i.test(text);
  return [{ on: "preAttackRoll", defends: true, ...(incapacitated ? { if: { not: { "target.hasStatus": "incapacitated" } } } : {}), do: [{ type: "disadvantage" }] }];
}

/**
 * §334 : « If the target is a Huge or smaller creature and the elephant moved 20+ feet straight toward it immediately before the hit,
 * the target has the Prone condition » sur une attaque à UNE activité (sans variante de charge, M5) → `effectsIf` : les effets de
 * l'attaque ne passent qu'après une charge de cette longueur (fait `source.chargedFeet`).
 * @param {string} html
 * @param {Array<{type: string}>} [activities]
 * @returns {object|null}  condition `effectsIf`
 */
export function monsterChargeGate(html, activities=[]) {
  if ( activities.filter(a => a.type === "attack").length !== 1 ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\bmoved (\d+)\+? feet (?:straight )?toward (?:it|the target|them) immediately before the hit\b/i);
  return m ? { "source.chargedFeet": Number(m[1]) } : null;
}

/**
 * §334 : « While in sunlight, the drider has Disadvantage on ability checks and attack rolls », « While in Bright Light, the cloaker has
 * Disadvantage on attack rolls » → Désavantage aux jets d'attaque de la créature au soleil (`source.inSunlight` : la lumière globale de
 * la scène, pas une torche) ou en lumière vive (`source.inBrightLight`). Les tests de caractéristique restent au MJ.
 * @param {string} html
 * @returns {object[]} déclarations `triggers`
 */
export function monsterLightSensitivity(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const m = text.match(/\bWhile (?:it is )?in (sunlight|Bright Light)\b[^.]*\bDisadvantage on (?:[^.]*\b)?attack rolls\b/i);
  if ( !m ) return [];
  const fact = /^sunlight$/i.test(m[1]) ? "source.inSunlight" : "source.inBrightLight";
  return [{ on: "preAttackRoll", if: { [fact]: true }, do: [{ type: "disadvantage" }] }];
}
