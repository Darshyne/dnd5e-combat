/**
 * Ce qu'un message d'utilisation de dnd5e 6.0 demande au moteur : le PLAN de la machine d'action
 * (core/action.mjs) et ses cibles. Une activité sans plan garde son comportement natif.
 *
 * Vérifié dans dnd5e 6.0.3 :
 *  - le message d'utilisation (`type: "usage"`) porte `system.targets` et retrouve son activité par
 *    `getAssociatedActivity()` (documents/chat-message.mjs:690)
 *  - utiliser une activité d'attaque enchaîne son jet d'attaque (activity/attack.mjs:68-70) ; les
 *    activités `damage` et `heal` lancent ELLES-MÊMES leur jet à l'utilisation
 *    (damage.mjs:51, heal.mjs:60) — l'auteur n'a pas à le relancer ; une activité `save` ne lance rien
 *  - un soin crée un message `type: "healing"` (heal.mjs:69-73), de même forme qu'un message de dégâts
 *  - pour un sort à gabarit, le message est créé AVANT la pose de la zone
 *    (activity/mixin.mjs:293-296) : ses cibles ne valent rien, on attend la région
 *
 * Inventaire des packs 2024 du système (2026-09-21), ce qui a décidé des formes couvertes :
 * attaque avec effet au toucher 44 · activités `damage` 45 · `heal` 49 · utilitaire à effet 118 ·
 * sauvegarde 380 · attaque + sauvegarde sur le même item : 2 seulement — le chaînage s'y DÉCLARE
 * (`onHit.save` = id de l'activité de sauvegarde, dans le contenu ou `flags["dnd5e-combat"].onHit`
 * de l'item). Les attaques du Monster Manual, elles, se reconnaissent à leur forme et à leur amorce
 * (SPEC §18.4, M2, `core/riders.mjs`) ; leur porte de taille aussi (M3).
 */

import { MODULE_ID } from "../constants.mjs";
import { usageMetamagic } from "./metamagic.mjs";
import { OUTCOME_STEPS } from "../core/content.mjs";
import { siblingSaveOf, sizeGateOf } from "../core/riders.mjs";
import { chargeOnlyEffects } from "../core/variants.mjs";
import { variantPlanOf, useTimeVariant, advantageVariantOf } from "./variants.mjs";
import { contentOf, castItemOf, entryOfIdentifier } from "./content.mjs";
import { projectilesOf } from "./projectiles.mjs";
import { declarationsOfItem } from "./triggers.mjs";
import { isSpellCast, spellLevelOf, spellSchoolOf } from "./scrolls.mjs";
import { templateOf } from "./template.mjs";
import { isPotion, potionOfCast } from "./potions.mjs";

/** Clé stable d'un effet de l'activité (`_id` pour un effet de l'item, `uuid` pour un effet de référence). */
export const effectKey = e => e._id ?? e.uuid;

/**
 * Les effets que l'activité applique au niveau où elle est lancée : `applicableEffects` de dnd5e, qui filtre les profils
 * par `level.min`/`level.max` d'après `relevantLevel` (le niveau du sort de la copie mise à l'échelle,
 * `getAssociatedActivity({ scaled: true })`) — dnd5e 6.0.3, dnd5e.mjs:20091-20096 et :20165-20169. Sans ce filtre, Aide
 * posait ses huit effets « Niveau N : +X PV max » à la fois.
 */
export const applicableEffectsOf = activity => [...(activity?.applicableEffects ?? activity?.effects ?? []), ...poolEffectsOf(activity)];

/**
 * §37 : les effets de l'item que le contenu fait proposer par cette activité sans qu'elle les relie (`choice.pool`) — « Curse
 * Ability » de la Malédiction ne relie aucune de ses six malédictions de caractéristique. Même forme qu'un profil d'effet de
 * l'activité (`_id`, `effect`, `getEffect`), pour le plan, la question et l'application.
 */
export function poolEffectsOf(activity) {
  const item = activity?.item;
  const ids = item ? (contentOf(item).entry?.choice?.pool?.[activity.id] ?? []) : [];
  return ids.map(id => item.effects?.get(id)).filter(Boolean).map(effect => ({ _id: effect.id, effect, getEffect: async () => effect }));
}

/**
 * Les effets de l'activité, avec leur moment. `condition` (facultative) : ce que la cible doit remplir pour les recevoir,
 * en JSON comme la condition d'une étape (M3 : porte de taille).
 */
const effectsOf = (activity, when, condition=null) => applicableEffectsOf(activity).map(e => ({
  id: effectKey(e), activity: activity.uuid, when: when(e), ...(condition ? { if: JSON.stringify(condition) } : {})
}));

/** M5 (§18.8) : la variante d'attaque que la situation désigne, pour la première cible du message. */
function attackVariant(message, activity, targets) {
  const { scene, token } = message.speaker ?? {};
  const attacker = game.scenes.get(scene)?.tokens.get(token) ?? null;
  const target = targets[0]?.token ? fromUuidSync(targets[0].token) : null;
  return attacker ? useTimeVariant(activity, attacker, target) : null;
}

/**
 * M5 (§18.8) : effets de l'attaque de BASE que sa variante de charge porte aussi — ils ne valent qu'après une charge
 * (Défense du Sanglier : « … moved 20+ feet straight toward it …, the target … has the Prone condition »).
 */
function chargeOnly(activity) {
  const plan = variantPlanOf(activity.item);
  return (plan && (plan.base === activity.id)) ? chargeOnlyEffects(plan) : [];
}

/** Les activités de l'item, en liste (`system.activities` est une collection). */
const activitiesOf = item => Array.from(item?.system?.activities?.values?.() ?? []);

/**
 * M3 (§18.4) : « If the target is a Large or smaller creature, it has the Prone condition ». La taille se lit dans
 * `target.affects.special` de l'activité ou dans la phrase « If the target is… » de la description.
 * @returns {object|null}  condition `{ "target.sizeAtMost": "lg" }`
 */
function sizeGate(activity) {
  const item = activity.item;
  const size = sizeGateOf({
    special: activity.target?.affects?.special ?? "",
    description: item?.system?.description?.value ?? "",
    specialOf: id => item?.system?.activities?.get?.(id)?.target?.affects?.special ?? ""
  });
  return size ? { "target.sizeAtMost": size } : null;
}

/**
 * La condition que la cible doit remplir pour recevoir les effets de l'attaque : la porte de taille (M3), et celle que le contenu
 * déclare (§71, `effectsIf` : « si la cible tombe à 0 PV en raison de cette attaque » → `{ "target.atZero": true }`, jugée après
 * les dégâts). Les deux : toutes deux.
 */
function effectGate(activity) {
  const conditions = [sizeGate(activity), contentOf(activity.item).entry?.effectsIf ?? null].filter(Boolean);
  return (conditions.length > 1) ? { all: conditions } : (conditions[0] ?? null);
}

/**
 * L'activité lance-t-elle des dégâts ? On lit la configuration du jet que dnd5e préparerait (`getDamageConfig`), pas
 * la seule liste des parties : une partie peut être vide (« Grapple » de la Main de Bigby : ni dés ni formule), et des
 * dégâts peuvent venir d'ailleurs (les flammes de la Sphère de feu : partie vide, `(niveau)d6` ajouté par l'invocation,
 * §16.15). Sans cette méthode, la liste des parties.
 */
function hasDamageParts(activity) {
  // §81 : des dégâts que la donnée met là où la règle n'en donne pas (Frappe piégeuse : sur la sauvegarde du lancement).
  if ( contentOf(activity.item).entry?.noDamage?.includes(activity.id) ) return false;
  if ( typeof activity.getDamageConfig !== "function" ) return (activity.damage?.parts?.length ?? 0) > 0;
  try { return (activity.getDamageConfig({})?.rolls ?? []).some(r => (r.parts ?? []).some(part => String(part ?? "").trim())); }
  catch { return (activity.damage?.parts?.length ?? 0) > 0; }
}

/**
 * `abilities` : toutes les caractéristiques permises (Lutte / Bousculade : Force OU Dextérité, au choix de
 * la cible) ; chaque cible jette la meilleure pour elle (adapter/saves.mjs). `ability` : la première,
 * pour ce qui ne dépend que d'une (échec d'office, journal).
 * @returns {{ability: string, abilities: string[], dc: number, onSave: string, activity: string}|null}
 */
function saveOf(activity) {
  const dc = activity.save?.dc?.value;
  const abilities = Array.from(activity.save?.ability ?? []).filter(Boolean);
  if ( !Number.isFinite(dc) || !abilities.length ) return null;
  // §92 : la règle prime sur la donnée (`saveDamage` : Foulée effroyable, rien sur une réussite).
  const onSave = contentOf(activity.item).entry?.saveDamage?.[activity.id] ?? activity.damage?.onSave ?? "half";
  return { ability: abilities[0], abilities, dc, onSave, activity: activity.uuid };
}

/** Descripteurs de cible du message, réduits à ce que le cœur attend. */
const messageTargets = message => (message.system.targets ?? []).map(t => ({
  token: t.token, actor: t.actor, name: t.name, ac: t.ac ?? null
}));

/** Celui qui parle dans le message, comme cible (activité qui ne vise que soi). */
function selfTarget(message) {
  const { scene, token: id } = message.speaker ?? {};
  const token = game.scenes.get(scene)?.tokens.get(id);
  return token?.actor ? [{ token: token.uuid, actor: token.actor.uuid, name: token.name, ac: null }] : [];
}

/**
 * La sauvegarde qu'une attaque qui touche impose : celle que l'item déclare, sinon la sauvegarde sœur que la forme
 * de l'item annonce (M2, Griffe de la Goule).
 */
function chainedSave(activity) {
  const item = activity.item;
  const id = item ? (contentOf(item).entry?.onHit?.save ?? siblingSaveOf(activitiesOf(item), item.system?.description?.value ?? "")) : null;
  const sibling = id ? activity.item.system.activities?.get(id) : null;
  if ( sibling?.type !== "save" ) return null;
  const save = saveOf(sibling);
  return save ? { save: { ...save, chained: true }, effects: saveEffectsOf(sibling) } : null;
}

/**
 * Les étapes d'issue que le contenu déclare pour cet item (SPEC §16 : `move`, `status` sur `hit` ou
 * `failedSave`), portées par le plan avec leur condition ; le cœur les filtre par cible comme les effets,
 * l'adaptateur juge `if` au moment d'appliquer.
 * @param {Item5e} item
 * @param {string} moment   "hit" | "failedSave"
 * @param {string} when     "always" | "failedSave"
 */
function outcomeStepsOf(item, moment, when) {
  if ( !item ) return [];
  const out = [];
  // Une copie de sort porte aussi ce que déclare la capacité qui l'a lancée (`castItemOf`) : les dégâts « en plus » des
  // créatures d'un module tiers (un sort lancé avec des dégâts en plus) valent pour leur copie, pas pour le sort de tout le monde.
  const cast = castItemOf(item);
  for ( const d of [...declarationsOfItem(item), ...(cast ? declarationsOfItem(cast) : [])] ) {
    if ( !d.on.includes(moment) ) continue;
    // La condition voyage en JSON : écrite telle quelle dans un flag, Foundry éclaterait ses clés à points
    // (`"target.sizeAtMost"` → `{ target: { sizeAtMost } }`), vu en jeu le 2026-09-24 (scénario `traction`).
    for ( const step of d.do ) {
      // Dégâts d'issue (sans destinataire : la cible atteinte) ; `onSave: "half"` : aussi sur une réussite, à moitié.
      const outcomeDamage = (step.type === "damage") && !("to" in step);
      if ( !OUTCOME_STEPS.includes(step.type) && !outcomeDamage ) continue;
      const stepWhen = (outcomeDamage && (step.onSave === "half")) ? "always" : when;
      out.push({ when: stepWhen, if: d.if ? JSON.stringify(d.if) : null, name: d.name, ...step });
    }
  }
  return out;
}

/**
 * Les effets de l'activité de sauvegarde, avec leur moment : `savedEffects` du contenu (réussite seulement), `onSave` ;
 * `failMargins` (§19.6) : un écart de sauvegarde exigé (« si elle rate le jet de 5 ou plus »).
 */
function saveEffectsOf(activity) {
  const entry = activity.item ? contentOf(activity.item).entry : null;
  const saved = new Set(entry?.savedEffects ?? []);
  const margins = entry?.failMargins ?? {};
  return effectsOf(activity, e => saved.has(effectKey(e)) ? "saved" : (e.onSave === true ? "always" : "failedSave"))
    .map(e => (margins[e.id] ? { ...e, margin: margins[e.id] } : e));
}

/** Sauvegarde répétée (brique « resave ») : le message ne demande que la sauvegarde, rien n'est appliqué. */
function resavePlan(message, activity, common, targets) {
  const save = saveOf(activity);
  if ( !save ) return null;
  return { ...common, targets, plan: { save: { ...save, chained: false }, damage: null, effects: [], steps: [] } };
}

/**
 * Le nom d'un effet de l'activité, pour la question posée à l'auteur. Lu sur l'item (ou la référence de compendium déjà en
 * cache), pas par `profile.effect` : dnd5e 6.0 le déprécie au profit de `getEffect()`, asynchrone (un avertissement par effet,
 * dix-huit pour Assistance).
 */
const effectLabel = (e, item) => item?.effects?.get?.(e._id)?.name ?? (e.uuid ? fromUuidSync(e.uuid, { strict: false })?.name : null)
  ?? e.uuid ?? e._id;

/**
 * Effets EXCLUSIFS (contenu `choice: { effects: "one" }`, Maléfice) : le plan porte la question,
 * une option par effet propre à l'activité ; le cœur retient l'application jusqu'à la réponse.
 * Rien à choisir avec un seul effet.
 */
function withChoice(activity, plan) {
  // §53 : la potion qui a fait lancer ce sort en impose un effet (`potionEffect` : Croissance → agrandir) — pas de question.
  const potion = potionOfCast(activity?.item);
  const imposed = potion?.identifier ? entryOfIdentifier(potion.identifier)?.potionEffect : null;
  // L'effet est donné, pas subi : pas de sauvegarde (celle d'Agrandissement/rapetissement vaut pour une cible non consentante).
  if ( imposed ) return { ...plan, save: null, effects: (plan.effects ?? []).filter(e => e.id === imposed).map(e => ({ ...e, when: "always" })) };
  const choice = activity.item ? contentOf(activity.item).entry?.choice : null;
  if ( choice?.effects !== "one" ) return plan;   // `pool` seul : effets reliés, rien à choisir (§53)
  // Une attaque qui enchaîne sa sauvegarde sœur (§19.8 : poussée ou Agrippée) : les effets de la sœur.
  const chained = plan.save?.chained ? activity.item.system.activities?.get(plan.save.activity?.split(".").pop()) : null;
  const own = applicableEffectsOf(chained ?? activity).map(e => ({ id: effectKey(e), label: effectLabel(e, (chained ?? activity).item) }));
  if ( own.length < 2 ) return plan;
  return { ...plan, choice: { prompt: choice.prompt ?? null, options: own } };
}

/**
 * §53 : le sort qu'une potion fait lancer est-il pour le buveur ? Oui (« vous gagnez l'effet du sort »), sauf la potion qui « permet
 * de lancer » le sort sur une autre créature (`castTargets` : Amitié avec les animaux).
 */
export function potionCastsOnDrinker(item) {
  const potion = potionOfCast(item);
  return !!potion && !entryOfIdentifier(potion.identifier)?.castTargets;
}

/**
 * @param {ChatMessage} message  Message de type "usage".
 * @returns {{activity: string, source: string|null, origin: string, plan: object, targets: object[],
 *   area: boolean}|null}  null : rien à résoudre, le comportement natif reste.
 */
export function readUsage(message) {
  const usage = readPlan(message);
  if ( !usage ) return null;
  const activity = message.getAssociatedActivity?.({ scaled: true });
  return { ...usage, plan: casterRules(activity, withChoice(activity, usage.plan), message) };
}

/**
 * §28 : ce que les aptitudes du lanceur changent au plan d'un sort — Sort mineur appuyé (`potent` : un tour de magie à dégâts,
 * raté ou sauvegardé, fait la moitié des dégâts) ; Façonneur de sorts (`sculpt` : dans un sort d'Évocation à sauvegarde,
 * jusqu'à 1 + son niveau alliés réussissent d'office et ne subissent rien).
 */
function casterRules(activity, plan, message=null) {
  const item = activity?.item;
  const actor = activity?.actor;
  if ( !isSpellCast(item) || !actor ) return plan;   // §48 : un parchemin aussi
  const has = key => actor.items.some(i => contentOf(i).entry?.[key] === true);
  const level = spellLevelOf(item);
  const out = { ...plan };
  if ( plan.damage && (level === 0) && has("potentCantrip") ) out.potent = true;
  if ( plan.save && (spellSchoolOf(item) === "evo") && has("sculptSpells") ) out.sculpt = 1 + level;
  // §32 : Métamagie portée par la carte — Sort prévenant : autant d'alliés que le modificateur de Charisme (au moins un) réussissent
  // d'office, comme le Façonneur de sorts ; Sort intensifié : la première cible hostile a le Désavantage (adapter/saves.mjs).
  const meta = usageMetamagic(message);
  if ( plan.save && meta.includes("careful") ) out.sculpt = Math.max(out.sculpt ?? 0, Math.max(1, Number(actor.system.abilities?.cha?.mod) || 0));
  if ( plan.save && meta.includes("heightened") ) out.heightened = true;
  return out;
}

/**
 * L'activité attend-elle la pose de son gabarit ? Pas une ruée en ligne droite (§57, Frappe du vent) : son gabarit de ligne
 * n'est pas posé, les créatures près du trajet sont les cibles du message (`flags.dnd5e-combat.dash`).
 */
// §86 : le gabarit de la donnée, ou celui que le contenu fournit (adapter/template.mjs).
const templated = (activity, message) => !!templateOf(activity)?.type && !message.getFlag?.(MODULE_ID, "dash");

function readPlan(message) {
  const activity = message.getAssociatedActivity?.({ scaled: true });
  if ( !activity ) return null;
  const common = { activity: activity.uuid, source: message.getAssociatedActor?.()?.uuid ?? null, origin: message.id, area: false };
  // Image miroir (§16.25) : « portée personnelle », sans type de cible dans dnd5e — ses répliques se posent sur le lanceur.
  // §51 : portée « personnelle », sans zone, utilisée sans cible désignée — c'est l'utilisateur (la Potion de guérison du Guide
  // du maître : « personnelle », cible « une créature » sans nombre ; sans cela, personne n'était soigné). Les soins seulement :
  // une capacité utilitaire à portée personnelle (Rage…) a ses effets posés par d'autres chemins.
  // §101 : de même une potion « au toucher » (Potion de guérison importante du Guide du maître, seule de sa famille à porter
  // « contact, une créature ») : boire ou faire boire — désignée, la cible ; sans cible, le buveur.
  const untargetedSelf = (activity.type === "heal") && !activity.target?.template?.type && !(message.system?.targets?.length)
    && ((activity.range?.units === "self") || (isPotion(activity.item) && (activity.range?.units === "touch")));
  // §53 : une potion « sur soi » est pour le buveur, quel que soit le type d'activité (Invisibilité, Force de géant, Potion de
  // poison…) et même si une autre créature est encore visée ; de même le sort qu'une potion fait lancer (Rapidité : Hâte,
  // Croissance…), quelle que soit sa portée — « quand vous buvez cette potion, vous gagnez l'effet du sort ».
  const potionSelf = !activity.target?.template?.type
    && ((isPotion(activity.item) && (activity.range?.units === "self")) || potionCastsOnDrinker(activity.item));
  const self = (activity.target?.affects?.type === "self") || untargetedSelf || potionSelf
    || (!!activity.item && (contentOf(activity.item).entry?.duplicates === true));
  const targets = self ? selfTarget(message) : messageTargets(message);
  if ( message.getFlag?.(MODULE_ID, "resave") ) return resavePlan(message, activity, common, targets);

  switch ( activity.type ) {
    case "attack": {
      const chain = chainedSave(activity);
      // M5 (§18.8) : la variante qui vaut avant le jet (charge, En sang, cible agrippée) donne ses effets et ses dégâts ;
      // l'attaque reste celle de base (même jet). La variante « avantage » se juge au jet de dégâts.
      const variant = attackVariant(message, activity, targets);
      const source = variant?.activity ?? activity;
      const advantage = advantageVariantOf(activity);
      return { ...common, targets, plan: {
        attack: true,
        damage: hasDamageParts(activity) ? "author" : null,
        save: chain?.save ?? null,
        variant: variant ? { activity: variant.activity.uuid, kind: variant.kind, name: variant.activity.name } : null,
        damageFrom: [variant?.activity.uuid, advantage?.uuid].filter(Boolean),
        effects: [...effectsOf(source, () => "always", effectGate(source)).filter(e => variant || !chargeOnly(activity).includes(e.id)), ...(chain?.effects ?? [])],
        steps: [...outcomeStepsOf(activity.item, "hit", "always"), ...(chain ? outcomeStepsOf(activity.item, "failedSave", "failedSave") : [])]
      } };
    }
    case "save": {
      const save = saveOf(activity);
      if ( !save ) {
        // Donnée d'item abîmée et non réparable (adapter/saves.mjs, repairSaveAbility) : on le dit au lieu de se taire.
        console.warn(`${MODULE_ID} | ${activity.item?.name} : sauvegarde sans caractéristique ou sans DD, non automatisée`, activity);
        if ( game.user.isGM ) ui.notifications.warn(game.i18n.format("DND5ECOMBAT.SauvegardeIncomplete", { item: activity.item?.name }));
        return null;
      }
      return { ...common, targets, area: templated(activity, message), plan: {
        save: { ...save, chained: false },
        damage: hasDamageParts(activity) ? "author" : null,
        effects: saveEffectsOf(activity),
        steps: outcomeStepsOf(activity.item, "failedSave", "failedSave")
      } };
    }
    case "damage":
      // §89 : une activité de dégâts dont le contenu retire les dégâts (`noDamage` : Feinte) pose encore ses effets, comme un utilitaire.
      if ( !hasDamageParts(activity) ) {
        return applicableEffectsOf(activity).length ? { ...common, targets, plan: { effects: effectsOf(activity, () => "always") } } : null;
      }
      // Une activité de dégâts utilisée après le toucher (Frappe occulte, §16.19) porte les étapes « au toucher » du contenu.
      // À gabarit (Nuage de dagues, Croissance d'épines, §16.20), c'est une zone : ses cibles sont ceux qu'elle recouvre.
      // Rejouée par une zone (`areaTick`), personne n'a cliqué : c'est le moteur qui lance les dés.
      // Projectile magique (§16.27) : chaque projectile est un lancement à part, dont le moteur lance les dégâts
      // (runtime/projectiles.mjs coupe le jet enchaîné de dnd5e et enchaîne les suivants).
      const dart = projectilesOf(activity.item)?.attack === false;
      return { ...common, targets, area: templated(activity, message), plan: {
        damage: (message.getFlag?.(MODULE_ID, "areaTick") || dart) ? "author" : "system", effects: effectsOf(activity, () => "always"),
        steps: outcomeStepsOf(activity.item, "hit", "always") } };
    case "heal":
      if ( !activity.healing?.formula ) return null;
      // §24 : Parade — le « soin » n'est qu'un montant retiré aux dégâts (adapter/reactions.mjs) : rien à appliquer.
      if ( message.getFlag?.(MODULE_ID, "reduceOnly") ) return null;
      return { ...common, targets, plan: { damage: "system", heal: true, effects: effectsOf(activity, () => "always") } };
    case "utility":
      if ( !applicableEffectsOf(activity).length ) return null;
      // Une activité qui prend une action de base (Ruse : Se cacher, §20) : le moteur la fait (runtime/hide.mjs) ; l'effet
      // « Hiding » de l'item n'est pas posé.
      if ( contentOf(activity.item).entry?.basicActions?.[activity.id] ) return null;
      // §90 : un dé ajouté à la CA (Chassé-croisé : un effet par valeur du dé dans la donnée) — runtime/maneuver-dice.mjs pose le bon.
      if ( contentOf(activity.item).entry?.rolledAc?.activity === activity.id ) return null;
      // §72 : un test en opposition (`contest`) — l'effet ne se pose que gagné (runtime/contest.mjs).
      const contest = contentOf(activity.item).entry?.contest;
      if ( contest && (!contest.activity || (contest.activity === activity.id)) ) return null;
      return { ...common, targets, plan: { effects: effectsOf(activity, () => "always") } };
    default:
      return null;
  }
}
