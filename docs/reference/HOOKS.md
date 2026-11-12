# Hooks

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

## Hooks émis par le moteur

40 hooks `dnd5e-combat.*`, relevés sur chaque `Hooks.call` / `Hooks.callAll` du code. **Annulable** : émis par
`Hooks.call` — un écouteur qui rend `false` arrête la suite. La description est le commentaire placé juste avant la constante
qui nomme le hook, sinon juste avant la ligne d'émission (la première qui en a un) ; les § renvoient au journal.

| Hook | Annulable | Arguments | Émis dans | § | Description |
|---|---|---|---|---|---|
| `dnd5e-combat.ammunition` |  | `item, ammoState(item)?.current ?? null` | `adapter/ammo.mjs` | §274 | §274 : sur chaque client, quand la munition retenue d'une arme change (DAS, ou la fenêtre de dnd5e après le jet) : `(item, ammoId)`, l'id de la munition que tirera le prochain jet, ou null. Lecture seule. |
| `dnd5e-combat.awaiting` |  | `awaitingList()` | `adapter/awaiting.mjs` | §381 | §381 : sur chaque client, à chaque changement du tableau des attentes qu'il connaît (une fenêtre de réaction, de choix ou de jet ouverte ou fermée quelque part, une attente oubliée) : `(entries)`, les attentes en cours,… |
| `dnd5e-combat.awaitingSettings` |  |  | `runtime/awaiting.mjs` |  | Un réglage d'affichage a changé, sur ce client (le dessin se refait). |
| `dnd5e-combat.claimClick` | oui | `event` | `ui/pointer-mouse.mjs` | §39.3 | §39.3 : sur ce client, à l'appui d'un clic gauche sur le plateau, avant que le moteur ne le traite : `(event)`. Annulable : un module voisin qui réclame le clic (fouiller un coffre, un cadavre, un tas au sol — Darsh Loo… |
| `dnd5e-combat.climbSystem` |  | `!!on` | `runtime/climb-system.mjs` | §224 | §224 : sur chaque client, quand le MJ bascule l'interrupteur de l'escalade et des chutes (réglage de monde `climbSystem`) : `(enabled)`, booléen. Lecture seule. |
| `dnd5e-combat.conesChanged` |  |  | `runtime/vision.mjs` | §182 | §182 : sur chaque client, quand le réglage des cônes de vision hors combat (créatures du MJ) ou celui de leurs angles par type de créature change : `dnd5e-combat.conesChanged`, sans argument — les cônes affichés se rede… |
| `dnd5e-combat.criticalHit` |  | `decision` | `adapter/criticals.mjs` | §207 | §207 : sur le client de l'attaquant, sur un coup critique, avant les dégâts : `(decision)`, `{ actor, activity, target, mode }`. Un écouteur peut changer `decision.mode` : « standard » (dés doublés), « choice », « table… |
| `dnd5e-combat.debug` |  | `debugApi` | `runtime/debug.mjs` | §380 | §380 : sur chaque client, au `setup` de Foundry (même moteur en veille) : `(debugApi)`, le débogueur — un voisin s'y déclare (`register`) et ajoute ses gestes à la piste (`trail`). |
| `dnd5e-combat.debugProbe` |  | `{ message }` | `runtime/testing-debug.mjs` |  | Une sonde pour les scénarios : un inscrit du routeur qui échoue exprès (message « DAS debug probe … »). |
| `dnd5e-combat.doorMenu` |  | `entries, context` | `ui/pointer-menu.mjs` | §247 | §247 : sur le client qui construit le menu d'une porte (clic droit, `api.ui.doorMenu`), hook `dnd5e-combat.doorMenu` : `(entries, { token, wall })` — `wall` le WallDocument ; pousser `{ icon, label, run(event) }` (une p… |
| `dnd5e-combat.doorUnlocked` |  | `{ door: wall, token, method }` | `runtime/doors.mjs` | §244 | §244 : chez le MJ actif, quand une porte verrouillée vient d'être ouverte par un essai réussi : `({ door, token, method })` — `door` le WallDocument, `token` le TokenDocument, `method` « pick », « force » ou « key ». Le… |
| `dnd5e-combat.dropItems` |  | `takers, { token, items }` | `adapter/orders.mjs` | §40.3 | §40.3 : chez le MJ actif, quand une créature lâche ce qu'elle tient (ordre « Lâche », familier qui part dans sa poche) : `(takers, { token, items })`. Un module qui pose les objets au sol pousse dans `takers` une `async… |
| `dnd5e-combat.etherealPlane` |  | `{ enabled: etherealPlaneOn() }` | `runtime/ethereal.mjs` | §225 | §225 : sur chaque client, quand le MJ allume ou coupe l'automatisation du plan Éthéré (réglage de monde) : `({ enabled })`. Lecture seule. |
| `dnd5e-combat.etherealView` | oui | `{ active: on }` | `ui/ethereal.mjs` | §225 | §225 : sur ce client, à chaque recalcul de sa vue (contrôle d'un token, état Éthéré posé ou retiré) : `({ active })` — son point de vue est-il dans l'Éthéré ? Annulable : `false` et le moteur ne grise pas la scène (le v… |
| `dnd5e-combat.eventTurn` |  | `{ combat, combatant, key: event?.key ?? null, data: event?.data ?? {} }` | `runtime/combat-events.mjs` | §250 | §250 : chez le MJ actif, quand vient le tour d'un évènement de l'initiative (`api.combat.addEvent`) : `({ combat, combatant, key, data })` — au module qui l'a posé d'agir, puis de passer le tour. Une fois par tour. |
| `dnd5e-combat.factionsChanged` |  | `{ scene }` | `runtime/factions.mjs` | §181 | §181 : sur ce client, après chaque rechargement de la table des factions (chargement, scène affichée, réglages, rancunes de la scène affichée ; et chez l'appelant de `assign` / `stance`) : `({ scene })`. Les auras se re… |
| `dnd5e-combat.feedback` | oui | `{ token: uuid, action, outcome, kind, text: noticeText(text, loc), sound: src }` | `runtime/shared.mjs` | §252 | §252 : sur le client qui agit, pour une action vue de toute la table, juste avant de jouer son son : `({ token, action, outcome, kind, text, sound })`. Annulable : `false` empêche le son seulement (le texte flottant est… |
| `dnd5e-combat.forced` | oui | `{ actor, item, reasons, targets, user: game.user }` | `runtime/forced.mjs` | §408 | §408 : sur le client de celui qui passe outre un refus du moteur, avant tout avertissement : `({ actor, item, reasons, targets, user })`. Annulable : `false` et le moteur ne prévient personne (ni texte flottant, ni aler… |
| `dnd5e-combat.gmAlert` | oui | `{ text, item: itemName, actor: actorDoc }` | `runtime/gm-alert.mjs` | §364 | §364 : chez le MJ actif, avant de poster une alerte MJ (et seulement si le réglage `gmAlerts` est allumé) : `({ text, item, actor })` — `item` le nom de l'item, `actor` l'acteur ou null. Annulable : `false` et ni carte,… |
| `dnd5e-combat.gmQueue` |  | `now` | `runtime/gm-queue.mjs` | §421 | §421 : chez un MJ, quand une ligne de sa file arrive, part ou reçoit son libellé : `(queue)`, `{ mine, players, blocked, count }` — ce que le moteur lui demande, les joueurs attendus, les actions dont l'auteur est parti… |
| `dnd5e-combat.groundMenu` |  | `entries, context` | `ui/pointer-menu.mjs` | §243 | §243 : sur le client qui construit le menu d'une case (clic droit, `api.ui.groundMenu`) : `(entries, { token, point })` — pousser `{ icon, label, run(event) }`, placées avant celles du moteur ; rien d'autre (le hook par… |
| `dnd5e-combat.groupRoll` |  | `{ ...shown, final, cancelled }` | `runtime/group-roll.mjs` | §242 | §242 : sur chaque client, à chaque changement d'une carte de jets demandés : le point de la carte (DD retiré pour un joueur quand il est caché), avec `final` (vrai une fois, quand tous ont lancé ou que c'est annulé) et… |
| `dnd5e-combat.groupRollPrompt` |  | `prompt` | `runtime/group-roll.mjs` | §242 | §242 : chez le joueur qui doit lancer, avant d'ouvrir la fenêtre de jet : `(prompt)` (champs décrits plus haut). Une interface qui prend la demande met dans `prompt.result` la promesse de son issue ; sans preneur, la fe… |
| `dnd5e-combat.localPrompts` |  | `localPrompts()` | `adapter/dialogs.mjs` | §422 | §422 : sur ce client, quand une fenêtre du moteur s'y ouvre ou s'y ferme : `(prompts)`, `[{ id, awaitingId, actor, title, text, buttons: [{ action, label, icon }], since }]`. Local : rien n'est diffusé (le texte d'une f… |
| `dnd5e-combat.lockAttempt` |  | `{ door: wall, token, ...attemptReport(method, outcome, total) }` | `runtime/doors.mjs` | §247 | §247 : chez le MJ actif, après chaque essai jugé sur une serrure (crocheter, forcer, clé) : `({ door, token, method, outcome, total })`, `outcome` « success », « failure » ou « gm » (pas de DD : le MJ tranche). Lecture… |
| `dnd5e-combat.masteryRest` |  | `actor` | `runtime/mastery-choices.mjs` | §222 | §222 : sur chaque client propriétaire de l'acteur, après un Repos long qui lui laisse changer des bottes d'arme : `(actor)`. Lecture seule. |
| `dnd5e-combat.noise` |  | `{ token, point: doorPoint(wall), scene: wall.parent, cause: "forceDoor", wall }` | `runtime/doors.mjs` | §244 | §244 : chez le MJ actif, un bruit à signaler aux modules qui font entendre les créatures : `({ token, point, scene, cause, wall })` — aujourd'hui seulement `cause: "forceDoor"`, émis à chaque essai pour forcer une porte… |
| `dnd5e-combat.notice` |  | `{ token: uuid, text: noticeText(text, loc), kind }`<br>`{ token, text: noticeText(text, loc), kind }` | `runtime/shared.mjs` | §252 | §252 : sur chaque client qui doit montrer un avis du moteur au-dessus d'un token (refus, invite, retour d'une action) : `({ token, text, kind })` — `token` un uuid, `text` déjà traduit. L'interface du moteur l'écrit en… |
| `dnd5e-combat.playerWaits` |  | `playerWaits()` | `adapter/player-wait.mjs` | §290 | §290 : sur le client qui pose une question à un joueur (en général le MJ actif), quand une attente commence ou finit : `(waits)`, `[{ id, userId, userName, actor, actorName, img, label, since }]`. Lecture seule ; la mêm… |
| `dnd5e-combat.refreshAuras` |  |  | `runtime/auras.mjs` |  | Sur chaque client, quand le réglage `aurasOnlyInCombat` change (sans argument) : les auras se recalculent. Un voisin peut l'émettre pour le même effet. |
| `dnd5e-combat.registerContent` |  | `(source, table, options) => registerExternal(source, table, options)` | `runtime/content.mjs` |  | Le hook par lequel le moteur demande leur contenu aux autres modules (à `setup`). |
| `dnd5e-combat.resolution` |  | `resolution, event` | `runtime/engine.mjs` | §5.6 | SPEC §5.6 : à chaque étape d'une résolution (verdict, sauvegardes, dégâts, effets…), sur le client qui l'exécute (le MJ actif) : `(resolution, event)` — l'état de la résolution et ce qui l'a fait avancer. Sortie en lect… |
| `dnd5e-combat.sneak` |  | `tokensOf(actor)[0] ?? null, false`<br>`tokensOf(actor)[0] ?? null, true`<br>`t, true` | `runtime/hide.mjs` | §183 | §183 : sur le client qui change l'état caché d'une créature : `(token, hidden)` — son premier token (TokenDocument, ou null) et le nouvel état. Lecture seule. |
| `dnd5e-combat.stealthNoticed` |  | `obs, target, { level: "suspicious", point, reason: "failed" }`<br>`obs, target, { level: "spotted", point, reason }` | `runtime/stealth.mjs` | §184 | §184 : chez le MJ actif, règles `bg3`, quand un ennemi remarque un token caché : `(observer, target, { level, point, reason })` — TokenDocuments ; `level` « suspicious » (un doute) ou « spotted » (repéré) ; `reason` « f… |
| `dnd5e-combat.successAtCost` |  | `{ actor, kind, accepted, cost: price, by: decidedBy }` | `runtime/success-at-cost.mjs` |  | Issue #32 : chez le MJ actif, après chaque réponse à une réussite offerte : `({ actor, kind, accepted, cost, by })` — `kind` « attack », « save » ou « check », `cost` le prix décrit, `by` « player » (le joueur a répondu… |
| `dnd5e-combat.successAtCostCandidate` |  | `{ ...publicOf(c), closed: true }`<br>`publicOf(c)` | `runtime/success-at-cost.mjs` |  | Issue #32 : chez le MJ actif, pour son interface, quand une occasion (un jet raté de peu, pendant la pause) s'ouvre, est prise par le MJ (`claimed`) ou se ferme (`closed: true`) : `({ id, token, actor, name, what, total… |
| `dnd5e-combat.summonOnTargets` |  | `takers, { activity, caster, targets }` | `runtime/summon-handover.mjs` | §118 | §118 : sur le client qui lance une invocation avec des cibles désignées : `(takers, { activity, caster, targets })`. Un module qui transforme les cibles pousse dans `takers` une `async ({ profile }) => boolean` ; la pos… |
| `dnd5e-combat.targeting` |  | `state` | `ui/pointer.mjs` | §118 | §118 : sur ce client seulement, à chaque changement de la visée qu'il attend : `(state)`, celui de `api.ui.targeting()`, null à la fermeture. |
| `dnd5e-combat.theater` |  | `!!on` | `runtime/theater.mjs` | §220 | §220 : sur chaque client, quand le MJ allume ou éteint le Théâtre de l'esprit (réglage de monde `theaterOfMind`) : `(active)`, booléen — allumé, le moteur n'automatise plus rien. Lecture seule. |
| `dnd5e-combat.tokenMenu` |  | `entries, { token, target, aggressive }` | `ui/pointer-menu.mjs` | §39.4 | §39.4 : sur le client qui construit le menu d'un autre token (clic droit, `api.ui.tokenMenu`) : `(entries, { token, target, aggressive })` — pousser `{ icon, label, run(event) }` dans `entries` ; rien d'autre (le hook p… |

## Moments

Chaque moment de `core/triggers.mjs` (`MOMENTS`) est publié par `announce()` en `dnd5e-combat.<moment>` (`Hooks.callAll`, avec le
contexte du moment) et sert de clé `on` aux déclarations de contenu.

| Moment | Sens |
|---|---|
| `isHit` | an attack just hit the creature (Shield: before damage; riposte, B9: on application) |
| `isDamaged` | the creature just took damage (Hellish Rebuke; via an effect: Sleep ending, Dominate replaying its save) |
| `leavesReach` | a hostile creature leaves reach (Opportunity Attack) |
| `enemyDisengages` | a hostile creature just took the Disengage action (Sentinel: reaction window; it is the source) |
| `enter` | a creature enters the area, or the area moves onto it |
| `turnStart` | the creature starts its turn in the area |
| `turnEnd` | the creature ends its turn in the area |
| `moves` | the creature moves within the area (per square traveled: Spike Growth; not on placement) |
| `preDamageRoll` | the actor is about to roll an activity's damage (bonus damage: Hex) |
| `hit` | an attack from the item just hit the target (on application: push, condition) |
| `failedSave` | the target just failed the item's saving throw (on application: push, condition) |
| `savedSave` | the target just succeeded on the item's saving throw (on application: temporary immunity mark) |
| `startOfTurn` | the creature starts its turn (declaration carried by an effect) |
| `endOfTurn` | the creature ends its turn (declaration carried by an effect) |
| `originTurnStart` | the creature that placed the effect starts its turn (declaration carried by the effect: its bearer takes damage) |
| `preAttackRoll` | the actor is about to make an attack roll against the target (advantage, disadvantage) |
| `castsSpell` | a hostile creature casts a spell within range and in sight (Counterspell: reaction window) |
| `isMissed` | an attack just missed the creature (Riposte, Disarming Attack: reaction window) |
| `enemyTurnEnd` | a hostile creature ends its turn (reaction window; it is the source) |
| `isTargeted` | a hostile creature is about to use an activity without attack roll that targets the creature (Shield against Magic Missile: reaction window) |
| `isAttacked` | a creature is about to attack the bearer (Sanctuary: the attacker's saving throw, via an effect; §34: the target's reaction window, before the roll — Shadowy Dodge) |
| `enemyAttacks` | a hostile creature is about to make an attack roll (Warding Flare: reaction window, before the roll) |
| `allyAttacks` | an allied creature is about to make an attack roll against an enemy (Cosmic Omen, Weal: reaction window, before the roll) |
| `gainsCondition` | the creature just gained a condition (reflexive shape-change: reaction window) |
| `allyIsHit` | another creature was just hit (Sentinel at Death's Door: reaction window, before damage) |
| `allyIsDamaged` | another creature is about to take damage (Projected Ward: reaction window, before application) |
| `enemyAttacked` | a hostile creature just made an attack roll, hit or miss, against anyone (Soul of Vengeance: reaction window; it is the source) |
| `falls` | the creature is about to take falling damage (Slow Fall: reaction window, before application) |
| `allyFalls` | another creature is about to take falling damage (Feather Fall: reaction window, before application) |

## Hooks d'autres espaces émis par le moteur

| Hook | Annulable | Émis dans |
|---|---|---|
| `dnd5e.createMeasuredTemplate` | oui | `adapter/self-area.mjs`, `adapter/storm.mjs` |
| `dnd5e.postCreateMeasuredTemplate` |  | `adapter/self-area.mjs`, `adapter/storm.mjs`, `ui/pointer.mjs` |
| `dnd5e.teleport` | oui | `runtime/teleport.mjs` |

## Hooks écoutés, dans l'ordre d'appel

133 hooks, relevés par `api.routes()` sur le module chargé au niveau d'automatisation « full ». Un seul écouteur par hook
(`runtime/router.mjs`) appelle les inscrits dans cet ordre, qui est celui des `register…()` de `dnd5e-combat.mjs`. **MJ** : l'inscrit
ne s'exécute que chez le MJ actif. **stop** : il peut annuler le hook en rendant `false`.

### `canvasReady`

1. debug: scene
2. factions: table refreshed
3. stealth: detection not scheduled
4. dead movements stopped
5. vision: sources destroyed
6. regions: polygons not prepared
7. auras: recalculation requested
8. granted speed not synced _(MJ)_
9. awaiting: hourglass not redrawn with the canvas
10. ethereal: view not updated
11. sneak: cones redrawn

### `canvasTearDown`

1. mouse: reset
2. vision: sources destroyed
3. success at a cost: not cleared
4. awaiting: hourglass not cleared with the canvas
5. timers: not cleared with the canvas
6. perception: hearing mark not drawn
7. ethereal: gray filter removed
8. sneak: layer removed

### `combatRound`

1. piloted object: turn skipped (round)

### `combatStart`

1. stealth: detection not scheduled
2. piloted object: turn skipped (start)
3. initiative event not announced _(MJ)_
4. budget: combat reset _(MJ)_
5. auras: recalculation requested
6. weapon mastery: Long Rest change not closed _(MJ)_
7. basic actions added _(MJ)_

### `combatTurn`

1. piloted object: turn skipped

### `combatTurnChange`

1. piloted object: turn not skipped _(MJ)_
2. summoned object: end of turn within range _(MJ)_
3. summoned object: start of turn within range _(MJ)_
4. Death Saving Throw not requested _(MJ)_
5. initiative event not announced _(MJ)_
6. targets released at end of turn
7. start-of-turn activity offered
8. budget: turn reset _(MJ)_
9. "enemy's end of turn" window not opened _(MJ)_
10. creature's turn: triggers interrupted _(MJ)_
11. area: trigger interrupted _(MJ)_
12. lingering terrain not removed _(MJ)_
13. cursed weapon: wrath not ended _(MJ)_
14. monster emanation _(MJ)_
15. regeneration at start of turn _(MJ)_
16. weapon mastery: mark not removed _(MJ)_
17. Heroic Warrior: inspiration not given _(MJ)_
18. feat turn start _(MJ)_
19. spell effect end not played _(MJ)_
20. effect end by distance at turn end: not judged _(MJ)_
21. study to escape: not offered _(MJ)_
22. Rage: end not evaluated _(MJ)_
23. swallow: turn not handled _(MJ)_
24. climbing: check not asked _(MJ)_
25. Ready: held spell not lost at turn start _(MJ)_
26. burning: start-of-turn fire damage not dealt _(MJ)_
27. improvised weapon: not removed at end of turn _(MJ)_
28. Blink: d6 not rolled _(MJ)_
29. flammable: not burnt out _(MJ)_
30. help: ends on the helper's turn _(MJ)_
31. Stealth Attack: cover not judged _(MJ)_
32. Compulsion: direction not played _(MJ)_
33. imposed command: not carried out _(MJ)_
34. control spells: turn behaviour not played _(MJ)_
35. involuntary change: not played _(MJ)_

### `controlToken`

1. path preview cleared
2. ethereal: view not updated
3. sneak: cones redrawn

### `createActiveEffect`

1. stealth: detection not scheduled
2. summon: ends on Incapacitated _(MJ)_
3. summon: not removed with its dead caster _(MJ)_
4. True Strike: attack not offered
5. cover preview: not refreshed after a cover status
6. "suffers a condition" window not opened _(MJ)_
7. Warding Bond: foreign damage sharing not disarmed _(MJ)_
8. vision: sources to rebuild
9. banishment: target not removed from the scene _(MJ)_
10. auras: recalculation requested
11. emanation on death _(MJ)_
12. regeneration: automatic Dead removed _(MJ)_
13. feat effect not synced _(MJ)_
14. effect end when Incapacitated: not played _(MJ)_
15. features held by Rage not synced _(MJ)_
16. Rage: end on condition not evaluated _(MJ)_
17. swallow: effect not tracked _(MJ)_
18. grapple: does it still hold? _(MJ)_
19. grapple: grappler's mark _(MJ)_
20. Prone: crawl mode not set or not removed _(MJ)_
21. climbing: fall not triggered _(MJ)_
22. fall: not triggered automatically _(MJ)_
23. burning: flammable zone not ignited on catching fire _(MJ)_
24. Exhaustion: level not raised by an item effect _(MJ)_
25. Blink: permanent Ethereal not removed _(MJ)_
26. Levitate: not lifted _(MJ)_
27. passive perception _(MJ)_
28. enchanted weapon: light not updated _(MJ)_
29. invisibility: not suspended _(MJ)_
30. Wild Shape: end if Incapacitated _(MJ)_
31. floating texts: effect
32. perception: display not refreshed
33. ethereal: view not updated
34. ethereal: movement action not switched _(MJ)_
35. sneak: cones redrawn

### `createActor`

1. translation on creation: creature left in the original language _(MJ)_
2. premium data: creature items not fixed on creation _(MJ)_
3. basic actions added _(MJ)_

### `createAmbientLight`

1. stealth: detection not scheduled
2. vision: sources to rebuild

### `createChatMessage`

1. resolution interrupted _(MJ)_
2. concentration: processing interrupted _(MJ)_
3. pool: recharge not written _(MJ)_
4. targets released
5. Flurry of Blows: targeting not opened
6. budget: spending not recorded _(MJ)_
7. Dispel Magic: nothing dispelled _(MJ)_
8. trace or mark not handled _(MJ)_
9. granted activity not given _(MJ)_
10. backfire: explosion chance not rolled _(MJ)_
11. weapon mastery: mark not used up _(MJ)_
12. maneuver: Bait and Switch or Commander's Strike not played _(MJ)_
13. Heroic Inspiration not offered on Initiative _(MJ)_
14. Initiative d20 not rerolled _(MJ)_
15. effect end when the caster targets another creature: not judged _(MJ)_
16. Rage: upkeep not recorded _(MJ)_
17. swallow / engulf: action not tracked _(MJ)_
18. fall damage not applied _(MJ)_
19. Ready: "attacks / casts a spell" trigger not checked _(MJ)_
20. effect ending on the caster's action not removed _(MJ)_
21. help _(MJ)_
22. group roll: result not processed
23. tether: not recorded _(MJ)_
24. single card: roll not folded
25. GM alert: not posted _(MJ)_
26. GM alert: banner not shown
27. chat log purge _(MJ)_
28. visual feedback: effect ending
29. group roll: tracker not opened

### `createCombatant`

1. feat effect not synced _(MJ)_
2. basic actions added _(MJ)_

### `createItem`

1. translation on creation: item left in the original language _(MJ)_
2. premium data: item not fixed on creation _(MJ)_
3. auras: recalculation requested
4. Elemental Adept: type not asked _(MJ)_
5. feat effect not synced _(MJ)_
6. features held by Rage not synced _(MJ)_
7. armor training: shield AC not updated _(MJ)_
8. granted speed not synced _(MJ)_
9. perception: Devil's Sight or blind hearing not granted after an update

### `createRegion`

1. area resolution interrupted _(MJ)_
2. regions: polygons not prepared
3. area: duration not recorded _(MJ)_
4. area: carried effects not applied _(MJ)_
5. area: difficult terrain not applied _(MJ)_
6. area: walls not raised _(MJ)_
7. wall: burning side not chosen _(MJ)_
8. zone light not placed _(MJ)_
9. vision: sources to rebuild
10. perception: display not refreshed
11. wall: ring side not asked

### `createSequencerEffect`

1. animations: start (Sequencer)

### `createToken`

1. summon: creature not attached _(MJ)_
2. piloted object: command on cast _(MJ)_
3. summon: duration not recorded _(MJ)_
4. summon: previous one not replaced _(MJ)_
5. auras: recalculation requested
6. feat effect not synced _(MJ)_
7. basic actions added _(MJ)_
8. familiar: pocket not emptied _(MJ)_
9. light object not handled _(MJ)_
10. sneak: cones redrawn

### `createWall`

1. vision: sources to rebuild

### `deleteActiveEffect`

1. stealth: detection not scheduled
2. stealth: detection not scheduled
3. concentration: areas not removed _(MJ)_
4. cover preview: not refreshed after a cover status
5. vision: sources to rebuild
6. banishment: target not returned _(MJ)_
7. granted activity not removed _(MJ)_
8. auras: recalculation requested
9. feat effect not synced _(MJ)_
10. effect end: next effect not applied _(MJ)_
11. features held by Rage not synced _(MJ)_
12. swallow: the swallowed creature doesn't leave _(MJ)_
13. grapple: does it still hold? _(MJ)_
14. grapple: grappler's mark _(MJ)_
15. Prone: crawl mode not set or not removed _(MJ)_
16. climbing: fall not triggered _(MJ)_
17. fall: not triggered automatically _(MJ)_
18. Ready: broken concentration not noted _(MJ)_
19. Levitate: not brought down _(MJ)_
20. passive perception _(MJ)_
21. enchanted weapon: light not updated _(MJ)_
22. invisibility: not restored _(MJ)_
23. light source: remaining time not kept _(MJ)_
24. tether: not forgotten _(MJ)_
25. floating texts: effect
26. perception: display not refreshed
27. ethereal: view not updated
28. ethereal: movement action not switched _(MJ)_
29. sneak: cones redrawn

### `deleteAmbientLight`

1. stealth: detection not scheduled
2. vision: sources to rebuild

### `deleteChatMessage`

1. budget: spending refunded on cancel _(MJ)_
2. group roll: cancellation not announced
3. visual feedback: forget
4. group roll: tracker not refreshed

### `deleteCombat`

1. stealth: detection not scheduled
2. deleteCombat
3. turn statuses not synchronized _(MJ)_
4. lingering terrain not removed with the combat _(MJ)_
5. auras: recalculation requested
6. critical marks not removed _(MJ)_
7. feat effect not synced _(MJ)_
8. improvised weapon: not removed with the combat _(MJ)_
9. flammable: fire not put out with the combat _(MJ)_
10. help: end of combat _(MJ)_
11. combat launch: music not restored _(MJ)_
12. sneak: cones redrawn

### `deleteCombatant`

1. turn statuses not synchronized _(MJ)_

### `deleteItem`

1. auras: recalculation requested
2. feat effect not synced _(MJ)_
3. features held by Rage not synced _(MJ)_
4. armor training: shield AC not updated _(MJ)_
5. granted speed not synced _(MJ)_
6. light source: not extinguished _(MJ)_
7. perception: Devil's Sight or blind hearing not granted after an update

### `deleteRegion`

1. area: ended without its activity (zoneEnd) _(MJ)_
2. area: bound effects not removed _(MJ)_
3. area: walls not removed _(MJ)_
4. wall: burning side not removed _(MJ)_
5. Reverse Gravity: fall not applied _(MJ)_
6. ground item: tile not removed _(MJ)_
7. flammable: light or held creatures left behind _(MJ)_
8. zone light not extinguished _(MJ)_
9. vision: sources to rebuild
10. perception: display not refreshed

### `deleteToken`

1. piloted object: spell not ended _(MJ)_
2. follow: the leader is gone
3. auras: recalculation requested
4. sneak: cones redrawn

### `deleteWall`

1. vision: sources to rebuild

### `destroyToken`

1. perception: hearing mark not drawn

### `dnd5e-combat.awaiting`

1. GM queue: not refreshed (awaiting)
2. awaiting: hourglass not drawn

### `dnd5e-combat.awaitingSettings`

1. awaiting: hourglass not refreshed after a setting change

### `dnd5e-combat.conesChanged`

1. sneak: cones redrawn

### `dnd5e-combat.debugProbe`

1. debug: probe (deliberate failure)

### `dnd5e-combat.etherealPlane`

1. ethereal: view not updated

### `dnd5e-combat.factionsChanged`

1. auras: recalculation requested
2. factions: window refresh

### `dnd5e-combat.gmQueue`

1. GM queue: panel not refreshed

### `dnd5e-combat.localPrompts`

1. GM queue: not refreshed (windows of this client)

### `dnd5e-combat.masteryRest`

1. weapon mastery window not opened after a Long Rest

### `dnd5e-combat.notice`

1. visual feedback: engine notice

### `dnd5e-combat.playerWaits`

1. GM queue: not refreshed (waits)

### `dnd5e-combat.refreshAuras`

1. auras: recalculation requested

### `dnd5e-combat.resolution`

1. debug: resolution
2. factions: grudge not recorded _(MJ)_
3. summoned object: damage cap not counted _(MJ)_
4. Dissonant Whispers: flight not played _(MJ)_
5. burst: explosion not played _(MJ)_
6. coatings: enchantment spent by a hit _(MJ)_
7. felled enemy: blessing not played _(MJ)_
8. weapon feeding its wielder: temporary Hit Points not given _(MJ)_
9. backfire: explosion chance not rolled _(MJ)_
10. emanation: immunity after saving throw _(MJ)_
11. drain on save or on hit: effect not applied _(MJ)_
12. curse: early end not offered _(MJ)_
13. weapon mastery not played _(MJ)_
14. Cunning Strikes not played _(MJ)_
15. critical mark not placed _(MJ)_
16. Monk: Stunning Strike or Open Hand Technique not offered _(MJ)_
17. smite: saving throw not played _(MJ)_
18. hit follow-up not offered _(MJ)_
19. maneuver: promised die not cleared _(MJ)_
20. Wails from the Grave not offered _(MJ)_
21. attack enchantment not removed _(MJ)_
22. concentration end when nobody is affected: not played _(MJ)_
23. Brutal Strike: effects not applied _(MJ)_
24. swallow: the frog doesn't spit out _(MJ)_
25. Skulker: hiding not kept _(MJ)_
26. imposed command: effect not placed _(MJ)_
27. control spells: dropped items not handled _(MJ)_

### `dnd5e-combat.sneak`

1. stealth: detection not scheduled
2. sneak: cones redrawn

### `dnd5e-combat.successAtCostCandidate`

1. success at a cost: GM pill

### `dnd5e-combat.theater`

1. theatre of the mind: path preview cleared

### `dnd5e.applyDamage`

1. pool: spending not written
2. 0 HP: death or failure not applied
3. regeneration: stop not recorded
4. drain: Hit Point maximum not reduced
5. bite: empowerment not offered
6. life steal: HP not regained
7. rise: damage not recorded
8. swallow: damage from inside not counted _(MJ)_
9. oil: not ignited
10. flammable: not ignited by fire damage

### `dnd5e.calculateDamage`

1. regeneration: damage types not read
2. Undead Fortitude: damage types not read
3. drain: drained portion not read
4. bite: amount not read
5. life steal: amount not read
6. oil: fire damage not noted
7. flammable: fire damage not noted
8. floating texts: damage by type

### `dnd5e.createMeasuredTemplate`

1. ranged area: within range, clear path _(stop)_
2. area: elevation slice not set

### `dnd5e.createScrollFromSpell`

1. scroll: contained spell

### `dnd5e.damageActor`

1. coven: HP not shared _(MJ)_
2. damage taken: bearer's effects not handled _(MJ)_
3. cursed weapon: wrath save not rolled _(MJ)_
4. floating texts: hit points

### `dnd5e.determineOccupiedGridSpaceBlocking`

1. space sharing: passage refused
2. objects: never block

### `dnd5e.determineOccupiedGridSpaceDifficult`

1. objects: no difficult terrain

### `dnd5e.getItemContextOptions`

1. light source: no menu entry
2. correction / without DAS: no menu entry

### `dnd5e.healActor`

1. coven: healing not shared _(MJ)_
2. floating texts: hit points

### `dnd5e.postAttackRollConfiguration`

1. attack roll range _(stop)_

### `dnd5e.postSummon`

1. summon: the caster's players not made owners
2. summon effects not moved to the caster

### `dnd5e.postUseActivity`

1. debug: use
2. shape change not played _(MJ)_
3. last stand: effects not removed _(MJ)_
4. straight-line dash: movement
5. teleportation: targeting not opened
6. metamagic not held
7. summon command not recorded
8. "once per turn" limit not recorded
9. legendary action not spent
10. summon on targets: neighbour summons
11. contest not played
12. self area: automatic placement
13. coating: weapon not coated
14. Boon of Spell Recall
15. maneuver: promised die or AC not applied
16. spell ended by a special function: not ended
17. escape
18. jump: Step of the Wind doubling not noted
19. Ready: readied action not chosen
20. improvised weapon: not requested
21. effect ending on spell or damage not removed
22. potion: conditions not removed
23. healer's kit: stabilization
24. hide
25. search
26. light object: the caster does not shed light
27. caster light: not lit
28. light source: not lit
29. Wild Shape: transformation not done
30. enchantment: weapon not enchanted
31. ethereal: Ethereal Jaunt / Stride not applied
32. Arcane Vigor: Hit Point Dice not spent
33. restoration: condition not removed
34. tinderbox: nothing lit

### `dnd5e.preActivityConsumption`

1. spell without Concentration at a higher level _(stop)_

### `dnd5e.preApplyDamage`

1. pool: damage not absorbed
2. 0 HP: failures not counted
3. damage taken: source not recorded
4. healing blocked
5. floating texts: damage by type

### `dnd5e.preApplyEnchantment`

1. pact weapon: enchantment not rewritten
2. self enchantment: profile not switched on _(stop)_

### `dnd5e.preBeginConcentrating`

1. without DAS: concentration not marked

### `dnd5e.preCalculateDamage`

1. damage absorption

### `dnd5e.preCombatRecovery`

1. initiative event: no combat recovery _(stop)_

### `dnd5e.preConfigureInitiative`

1. surprise: initiative Disadvantage

### `dnd5e.preCreateMeasuredTemplate`

1. straight-line dash: no area _(stop)_
2. cone or line: targeting around the caster (map) _(stop)_
3. self area: automatic placement (canvas) _(stop)_

### `dnd5e.preDisplayCardV2`

1. weapon mastery window not opened _(stop)_

### `dnd5e.preRollAbilityCheckV2`

1. Frightened: disadvantage on checks
2. Indomitable Might _(stop)_
3. armor training: ability check Disadvantage

### `dnd5e.preRollAttackV2`

1. attack roll without dialog _(stop)_
2. attack mode preselected _(stop)_
3. ammunition chosen _(stop)_
4. condition advantage and disadvantage _(stop)_
5. advantage and disadvantage given per target _(stop)_
6. Martial Arts: Dexterity with a Monk weapon (attack) _(stop)_

### `dnd5e.preRollConcentrationV2`

1. Mage Slayer: concentration _(stop)_

### `dnd5e.preRollDamageV2`

1. healing dice at their maximum _(stop)_
2. damage and healing without dialog _(stop)_
3. critical hit: noted on the damage card _(stop)_
4. riposte: superiority die _(stop)_
5. trigger bonus damage _(stop)_
6. damage: dice multiplied (area), type chosen _(stop)_
7. storm: extra die not added _(stop)_
8. coating: poison damage not added _(stop)_
9. Cleave: modifier _(stop)_
10. Sneak Attack _(stop)_
11. Fighter fighting styles _(stop)_
12. origin feats (damage) _(stop)_
13. Martial Arts: Dexterity with a Monk weapon (damage) _(stop)_
14. smite _(stop)_
15. maneuver: promised die _(stop)_
16. Toll the Dead: target's dice _(stop)_
17. off hand: Two-Weapon Fighting _(stop)_

### `dnd5e.preRollSavingThrowV2`

1. Indomitable Might _(stop)_
2. armor training: saving throw Disadvantage

### `dnd5e.preSummon`

1. summon on targets: handed to a neighbouring module _(stop)_

### `dnd5e.preSummonToken`

1. without DAS: summon not marked

### `dnd5e.preUseActivity`

1. without DAS: usage not marked
2. correction: quiet zone not marked
3. recast of a lasting spell _(stop)_
4. targeting: target expected _(stop)_
5. projectiles: one per target, the rest chained _(stop)_
6. use without dialog _(stop)_
7. metamagic: spell not modified _(stop)_
8. use legality _(stop)_
9. gates: Sanctuary, Counterspell, pre-attack reactions, Portent _(stop)_
10. summon on targets: neighbours asked
11. Ritual: cast without a spell slot _(stop)_
12. self area: without the "Place Template" box _(stop)_
13. Sneak Attack: item activity not redirected _(stop)_
14. Reckless Attack: prompt _(stop)_
15. swallow: Bite not refused _(stop)_
16. potion: concentration not removed
17. ground item: area placed on use, copy kept
18. light object: placed on cast _(stop)_
19. light source: dnd5e consumption not skipped

### `dnd5e.preUseLinkedSpell`

1. potion: casting not noted

### `dnd5e.renderChatMessage`

1. single card: render
2. verdict on the chat card
3. group roll: card
4. success at a cost: card
5. correction: undo button not shown

### `dnd5e.restCompleted`

1. summon: not dismissed at a Long Rest
2. Portent not rolled on Long Rest
3. Arcane Recovery not offered
4. uses not regained on a Short Rest
5. effect not faded on a Long Rest
6. weapon mastery: Long Rest change not offered

### `dnd5e.rollAbilityCheck`

1. empowerment not consumed
2. Heroic Inspiration not offered on a check
3. check die not offered
4. natural 1: check not read

### `dnd5e.rollAttack`

1. empowerment not consumed
2. natural 1: attack not read

### `dnd5e.rollAttackV2`

1. effect ending on attack roll not removed
2. hide: ends on attack roll

### `dnd5e.rollDeathSave`

1. natural 1: death saving throw not read

### `dnd5e.rollDeathSaveV2`

1. Death Saving Throw: Stable or Dead not applied

### `dnd5e.rollSavingThrow`

1. natural 1: saving throw not read
2. effect ending on saving throw not removed

### `dnd5e.rollSkill`

1. empowerment not consumed
2. Heroic Inspiration not offered on a check
3. check die not offered
4. natural 1: check not read

### `dnd5e.rollToolCheck`

1. empowerment not consumed
2. Heroic Inspiration not offered on a check
3. check die not offered
4. natural 1: check not read

### `dnd5e.summonToken`

1. familiar: vision not enabled
2. light object: color not applied

### `dnd5e.teleport`

1. teleport: destination _(stop)_

### `dropCanvasData`

1. factions: token drop _(stop)_

### `endedSequencerEffect`

1. animations: end (Sequencer)

### `getSceneControlButtons`

1. theatre of the mind: tool
2. climbing switch: tool
3. group roll: tool
4. GM queue: tool
5. combat launch: tool
6. factions: tool

### `getUserContextOptions`

1. connection test: player list menu entry missing

### `hoverToken`

1. perception: hearing mark not drawn

### `initializeVisionSources`

1. perception: Devil's Sight or blind hearing not granted

### `moveToken`

1. piloted object: command not paid _(MJ)_
2. summoned object: arriving within range _(MJ)_
3. Gust of Wind: extra cost not counted _(MJ)_
4. follow: the leader's path
5. area: bound effects not removed _(MJ)_
6. area: trigger interrupted _(MJ)_
7. area: carried effects not realigned _(MJ)_
8. auras: recalculation requested
9. effect end by distance: not judged _(MJ)_
10. swallow: the swallowed creatures don't follow _(MJ)_
11. grapple: the victim follows the grappler _(MJ)_
12. tether: break not judged _(MJ)_

### `pauseGame`

1. pause: walks stopped

### `preCreateActiveEffect`

1. climbing switch: Falling status _(stop)_
2. status icon always visible
3. spell effect end not recorded _(stop)_
4. potion: effect not completed
5. invisibility: not suspended
6. light effect not completed
7. effect: stale start not reset
8. effect: end on rest or next turn not applied
9. size: change not added

### `preCreateItem`

1. content: flags on creation _(stop)_
2. potion: cast spell not marked

### `preCreateMeasuredTemplate`

1. without DAS: template not marked

### `preCreateRegion`

1. without DAS: region not marked

### `preCreateToken`

1. factions: disposition from faction

### `preMoveToken`

1. hidden: half speed
2. movement: mode elevation _(stop)_
3. movement: cap and opportunity attacks _(stop)_
4. ceiling: staying under it _(stop)_

### `preUpdateActiveEffect`

1. status icon always visible
2. True Strike: enchantment expired too early _(stop)_

### `preUpdateActor`

1. weapon mastery choice not checked _(stop)_

### `preUpdateCombatant`

1. first Initiative not recorded

### `preUpdateItem`

1. content: flags on update _(stop)_

### `preUpdateRegion`

1. storm: cloud made visible

### `preUpdateToken`

1. movement mode: elevation _(stop)_

### `ready`

1. welcome screen
2. debug: relay
3. theatre of the mind: reminder
4. content: audit
5. scroll: spell index
6. factions: table refreshed
7. status icons: existing effects _(MJ)_
8. resuming pending resolutions _(MJ)_
9. movement modes: Better Levels setting
10. mouse: listeners not attached
11. real-time clock: not started
12. vision: API check
13. space: API check
14. weapon index not read
15. Elemental Adept: type not asked _(MJ)_
16. feat effect not synced _(MJ)_
17. basic actions added _(MJ)_
18. awaiting: not synchronised
19. familiar: vision not enabled _(MJ)_
20. climbing: out-of-combat checks
21. armor training: shield AC not updated _(MJ)_
22. granted speed not synced _(MJ)_
23. single card
24. light chat log
25. chat log purge on load _(MJ)_
26. floating texts: system texts muted
27. debug report: errors raised during loading not shown
28. settings window: late settings taken from Foundry's list

### `refreshToken`

1. perception: hearing mark not drawn
2. ethereal: ghost not drawn
3. sneak: cones redrawn

### `renderActivityChoiceDialog`

1. activity choice answered

### `renderBaseActorSheet`

1. automation badges
2. weapon mastery badges

### `renderCombatTracker`

1. budget in the tracker

### `renderGamePause`

1. combat launch: pause message not shown

### `renderSceneControls`

1. GM queue: count on the tool

### `renderSettings`

1. debug report: sidebar badge not updated
2. settings window: DAS button not added to the sidebar

### `renderSkillToolRollConfigurationDialog`

1. check aids not offered

### `renderTokenHUD`

1. factions: token HUD

### `renderWallConfig`

1. door lock: wall configuration section

### `setup`

1. debug: neighbours
2. theatre of the mind: state not read
3. climbing switch: state not read
4. content: other modules' tables
5. perception: detection modes not installed
6. ethereal switch: state not read
7. settings window: settings taken from Foundry's list

### `sightRefresh`

1. perception: Devil's Sight or blind hearing not granted again
2. sneak: cones redrawn

### `stopToken`

1. area: trigger interrupted _(MJ)_

### `updateActiveEffect`

1. concentration disabled: not ended _(MJ)_
2. summon: ends on Incapacitated _(MJ)_
3. Warding Bond: foreign damage sharing not disarmed _(MJ)_
4. vision: sources to rebuild
5. feat effect not synced _(MJ)_
6. features held by Rage not synced _(MJ)_
7. grapple: does it still hold? _(MJ)_
8. Prone: crawl mode not set or not removed _(MJ)_
9. climbing: fall not triggered _(MJ)_
10. fall: not triggered automatically _(MJ)_
11. enchanted weapon: light not updated _(MJ)_
12. invisibility: not restored _(MJ)_
13. light source: not burnt out _(MJ)_
14. floating texts: effect
15. perception: display not refreshed
16. ethereal: view not updated
17. ethereal: movement action not switched _(MJ)_
18. sneak: cones redrawn

### `updateActor`

1. piloted object: spell ends at 0 HP _(MJ)_
2. Dead / Unconscious / Stable not applied or not removed _(MJ)_
3. second phase not played _(MJ)_
4. vision: sources to rebuild
5. auras: recalculation requested
6. Undead Fortitude: saving throw not rolled _(MJ)_
7. feat effect not synced _(MJ)_
8. rise at 0 Hit Points not played _(MJ)_
9. effect end at 0 HP: not played _(MJ)_
10. Relentless Rage not played _(MJ)_
11. knocked out: not woken up _(MJ)_
12. armor training: shield AC not updated _(MJ)_
13. granted speed not synced _(MJ)_
14. Wild Shape: end at 0 Hit Points _(MJ)_
15. perception: Devil's Sight or blind hearing not granted after an update
16. weapon mastery window not refreshed
17. sneak: cones redrawn

### `updateAmbientLight`

1. stealth: detection not scheduled
2. vision: sources to rebuild

### `updateChatMessage`

1. chained damage roll
2. targets released
3. chained projectiles
4. GM queue: not refreshed (resolution)
5. group roll: progress not announced
6. visual feedback above tokens
7. success at a cost: card refresh
8. group roll: tracker not refreshed

### `updateCombat`

1. debug: turn
2. feat effect not synced _(MJ)_
3. second turn not removed _(MJ)_
4. sneak: cones redrawn

### `updateCombatant`

1. turn statuses not synchronized _(MJ)_
2. Initiative die not offered _(MJ)_
3. surprise: Surprised not removed _(MJ)_
4. combat launch: initiative not followed _(MJ)_
5. tracker: budget

### `updateItem`

1. ammunition choice announced
2. feat effect not synced _(MJ)_
3. effect end on armor: not played _(MJ)_
4. armor training: shield AC not updated _(MJ)_
5. granted speed not synced _(MJ)_
6. perception: Devil's Sight or blind hearing not granted after an update

### `updateRegion`

1. regions: polygons not prepared
2. area: trigger interrupted _(MJ)_
3. area: walls not moved _(MJ)_
4. wall: burning side not placed _(MJ)_
5. zone light not moved _(MJ)_
6. vision: sources to rebuild
7. perception: display not refreshed

### `updateScene`

1. factions: table refreshed
2. vision: sources to rebuild

### `updateSetting`

1. light chat log: setting changed

### `updateToken`

1. stealth: detection not scheduled
2. Dead / Unconscious not applied (unlinked token) _(MJ)_
3. second phase not played (unlinked token) _(MJ)_
4. follow: the leader moved
5. cover preview: not refreshed after a move
6. protection emanation: not ended on contact _(MJ)_
7. auras: recalculation requested
8. Undead Fortitude: saving throw not rolled (unlinked token) _(MJ)_
9. feat effect not synced _(MJ)_
10. rise at 0 Hit Points not played (unlinked token) _(MJ)_
11. Relentless Rage not played (unlinked token) _(MJ)_
12. grapple: does it still hold? _(MJ)_
13. climbing: status, flip or landing not applied _(MJ)_
14. burning: flammable zone not ignited by a burning creature _(MJ)_
15. combat launch: seen creature not shown _(MJ)_
16. passive perception _(MJ)_
17. tracker: movement
18. perception: Devil's Sight or blind hearing not granted after an update
19. sneak: cones redrawn

### `updateWall`

1. vision: sources to rebuild

### `updateWorldTime`

1. area: duration elapsed, not removed _(MJ)_
2. Wild Shape: end of duration _(MJ)_

### `userConnected`

1. debug: relay
2. awaiting: a disconnected user's prompts not cleared
3. GM queue: a roll due by a player who left
