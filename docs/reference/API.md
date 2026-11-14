# API publique — `game.modules.get("dnd5e-combat").api`

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

337 fonctions dans 34 groupes, relevées sur l'objet réel du module chargé. La description est le
commentaire de la fonction dans le code (début seulement) ; le fichier est relatif à `module/scripts/`. Les valeurs non
fonctions (`active`, `reason`…) sont l'état du module. `mcp` : fonctions de test du connecteur, MJ seulement.

## `api`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.active` | _boolean_ |  |  |
| `api.approach` | `(token, { cells, level=null, target=null, reachCells=1, seeing=false }={})` | `runtime/actions.mjs` | §39.1 : marche publique (`api.approach`), pour les modules qui veulent faire aller un token quelque part par le chemin du moteur — A*, portes ouvertes en chemin, attaques d'opportunité, budget du tour — sans qu'il conna… |
| `api.drop` | `(token)` | `runtime/neighbours.mjs` | §180 : lâcher ce que la créature tient (comme l'ordre « Lâche » d'Injonction : au sol si un voisin en fait une pile, sinon déséquipé). Rend `{ items, pile, kept }` (adapter/orders.mjs `dropHeld`). |
| `api.flee` | `(token, anchor, { extra=0, dryRun=false }={})` | `runtime/actions.mjs` | §180 : s'éloigner d'une menace (un voisin : la fuite d'un PNJ). « Aussi loin que le déplacement du tour le permet » — plus `extra` (la Vitesse : un Sprint pris d'abord) —, par l'A* du moteur et sa marche (attaques d'opp… |
| `api.gap` | `(a, b)` | `dnd5e-combat.mjs` | §196 : l'écart de deux tokens en cases (3D, et son vide vertical), pour un voisin qui juge une allonge — null s'il ne se mesure pas. |
| `api.level` | `()` | `runtime/levels.mjs` | Le niveau en vigueur sur ce client. |
| `api.levelAtLeast` | `(min)` | `runtime/levels.mjs` | Le niveau en vigueur comprend-il ce qui demande `min` ? |
| `api.light` | `(token)` | `ui/illumination.mjs` | La lumière où se tient un token, pour une interface (`api.light`, demandée par Darsh UI DnD5 le 2026-09-27). @param {Token\|TokenDocument} token @returns {{key: "bright"\|"dim"\|"dark"\|"magical", icon: string, name: string… |
| `api.path` | `(token, { cells=null, level=null, target=null, reachCells=1, seeing=false }={}, { maxCost=null, extra=0 }={})` | `runtime/actions.mjs` | §179 : un chemin sans le parcourir — vers des cases (`cells`, `level`) ou une cible (`target`, `reachCells`, `seeing`). `maxCost` : le plafond de coût à tester (défaut : ce qui reste au token ce tour, Infinity hors comb… |
| `api.reason` | _valeur_ |  |  |
| `api.routes` | `()` | `runtime/router.mjs` | Qui écoute quoi, dans quel ordre : pour l'inspection (`api.routes()`). |
| `api.save` | `(actor, { ability, dc, advantage=false, disadvantage=false, flavor=null }={})` | `runtime/neighbours.mjs` | §180 : une sauvegarde demandée à une créature hors d'une résolution (un voisin : le test de moral d'un PNJ), lancée sans fenêtre, visible dans le chat comme les sauvegardes des PNJ que le moteur lance. Rend `{ total, d2… |
| `api.skippedRoutes` | `()` | `runtime/router.mjs` | Les inscriptions écartées par `withoutRoutes` : `[{ hook, label, feature }]`. |
| `api.stopWalks` | `()` | `adapter/movement.mjs` | §102 : arrête toutes les marches du moteur lancées par ce client (chaque token, au prochain point de contrôle) ; ne rend rien. |
| `api.unitFactors` | _valeur_ |  |  |

## `api.ammo`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ammo.options` | `(item, activity=null)` | `dnd5e-combat.mjs` | Les munitions que l'arme peut tirer et celle que son prochain jet tirerait : `{ options, current, ask }`, ou null si elle n'en tire pas. |
| `api.ammo.set` | `(item, ammoId)` | `adapter/ammo.mjs` | Retient une munition pour les prochaines attaques de l'arme (toutes ses activités d'attaque), et l'annonce (hook `dnd5e-combat.ammunition`, `(item, ammoId)`, sur chaque client par la mise à jour de l'item). @param {Item… |

## `api.atCost`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.atCost.candidates` | `()` | `runtime/success-at-cost.mjs` | Les occasions ouvertes (interface, menu, scénarios). |
| `api.atCost.dismiss` | `(id)` | `runtime/success-at-cost.mjs` | Le MJ laisse passer l'occasion (pastille fermée) : l'échec reste, tout de suite. |
| `api.atCost.enabled` | `()` | `runtime/success-at-cost.mjs` | Issue #32 : la règle « succès à un prix » est-elle allumée (réglage de monde, coupé par défaut) ? |
| `api.atCost.margin` | _number_ |  |  |
| `api.atCost.offer` | `(id, { cost }={})` | `runtime/success-at-cost.mjs` | Le MJ prend l'occasion : la pause s'arrête, sa fenêtre décrit le prix (sauf `cost` donné : macro, scénario), puis la question au joueur. Rend true si le joueur a accepté. @param {string} id @param {{cost?: string}} [opt… |
| `api.atCost.offerOnMessage` | `(messageId, { what, cost }={})` | `runtime/success-at-cost.mjs` | Le MJ offre le succès à un prix sur un jet déjà posé (bouton de la carte). Accepté : le jet est marqué par le MJ actif. @param {string} messageId Le message du jet. @param {{what: string, cost?: string}} options |
| `api.atCost.offerOnRow` | `(cardId, row, { cost }={})` | `runtime/success-at-cost.mjs` | Une ligne de jet demandé (§242) : le DD vient de la demande (le jet n'a pas de cible quand le DD est caché). |

## `api.basics`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.basics.data` | `(kind)` | `adapter/basics.mjs` | Les données d'item d'une action de base, dans la langue de ce client. |
| `api.basics.take` | `(actor, kind)` | `runtime/neighbours.mjs` | §179 : faire prendre une action de base à une créature en combat (Foncer, Se désengager, Esquiver), comme son item le ferait : l'action dépensée et l'état du tour posé (déplacement doublé, pas d'attaque d'opportunité, E… |

## `api.budget`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.budget.issues` | `(actor, cost="action")` | `runtime/neighbours.mjs` | Ce qui empêche cette dépense (« notYourTurn », « noAction », « noBonus », « noReaction ») ; liste vide si elle est possible, ou si l'acteur n'est pas en combat. @param {Actor} actor @param {"action"\|"bonus"\|"reaction"}… |
| `api.budget.spend` | `(actor, cost="action")` | `runtime/neighbours.mjs` | Dépenser une action (ou une action Bonus, une réaction) du budget de cet acteur, s'il est en combat. À appeler chez le MJ actif (le budget est un drapeau du combattant). Rend vrai si une dépense a été écrite. |

## `api.climb`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.climb.ceiling` | `(token)` | `runtime/climb.mjs` | Grimper jusqu'au plafond (test des règles « maison » s'il est dû) ; client qui possède le token → booléen. |
| `api.climb.down` | `(token, { cells=null }={})` | `runtime/climb.mjs` | Descendre le long du mur (ou du plafond) de `cells` cases (sans `cells` : la fenêtre) ; client qui possède le token → booléen. |
| `api.climb.drop` | `(token)` | `runtime/climb.mjs` | Lâcher le mur ou le plafond (chute volontaire) ; faux si le token ne grimpe pas ou n'est pas à ce client. |
| `api.climb.edges` | `(token)` | `runtime/climb.mjs` | §216 : les bords d'où le token peut se laisser pendre pour descendre le long du mur : `[{ dir, x, y, elevation, level, drop }]`. |
| `api.climb.enabled` | `()` | `core/climb-system.mjs` | Le système d'escalade et de chute est-il allumé ? |
| `api.climb.entries` | `(token)` | `runtime/climb.mjs` | Les entrées d'escalade du menu du token (`{ icon, label, run }` : Grimper au mur, au plafond, Descendre, Se laisser tomber…). |
| `api.climb.grab` | `(token, edge)` | `runtime/climb.mjs` | §216 : « S'agripper au bord » `edge` (un élément de `edges`) ; client qui possède le token → booléen. |
| `api.climb.holds` | `(token, cell)` | `runtime/climb.mjs` | §196 : ce grimpeur tiendrait-il sur cette case (coin haut-gauche, à sa hauteur) — au mur, un mur à grimper la touche ; au plafond, le plafond y est à sa hauteur (et ne glisse pas sous des Pantoufles) ? Toujours vrai pou… |
| `api.climb.run` | `(token, { cells=null }={})` | `runtime/climb.mjs` | §195 : « Courir sur le mur » (Mouvement acrobatique du moine), sans test ; comme `up` → booléen. |
| `api.climb.setEnabled` | `(on)` | `runtime/climb-system.mjs` | Allume ou coupe le système d'escalade et de chute (MJ). |
| `api.climb.state` | `(token)` | `runtime/climb.mjs` | §196 : l'état d'escalade d'un token, pour une interface ou une IA — ce que le moteur tient (mode, drapeau, statut) et ce que son menu proposerait maintenant. null sans token ni acteur. @param {Token\|TokenDocument} token… |
| `api.climb.toward` | `(token, target, { reachCells=1 }={})` | `runtime/climb.mjs` | §196 : rejoindre une cible hors d'allonge par le vide vertical (au mur, au plafond près d'un mur) en grimpant — le cas simple : aller au pied du mur à côté d'elle (`api.approach`, dans le budget du tour), puis monter le… |
| `api.climb.up` | `(token, { cells=null }={})` | `runtime/climb.mjs` | Grimper au mur de `cells` cases (sans `cells` : la fenêtre « combien de cases ») ; client qui possède le token → booléen. |

## `api.combat`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.combat.addEvent` | `({ combat=game.combat, name, img=null, initiative=20, rounds=1, key=null, data={}, hidden=false }={})` | `runtime/combat-events.mjs` | Ajouter un évènement au combat. `rounds` : combien de rounds il joue à partir du round courant (1 par défaut : ce round seulement ; null : jusqu'à ce qu'on le retire). Un évènement de même `key` déjà là est remplacé. @r… |
| `api.combat.events` | `(combat=game.combat)` | `runtime/combat-events.mjs` | Les évènements d'un combat. |
| `api.combat.isEvent` | `(combatant)` | `runtime/combat-events.mjs` | Un évènement du combat (pas une créature) ? |
| `api.combat.removeEvent` | `(target, combat=game.combat)` | `runtime/combat-events.mjs` | Retirer un évènement (par sa clé ou le combattant). |

## `api.combatLaunch`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.combatLaunch.begin` | `()` | `runtime/combat-launch.mjs` | MJ : la pause pour toute la table, avec son message. |
| `api.combatLaunch.cancel` | `()` | `runtime/combat-launch.mjs` | MJ : la fenêtre fermée sans lancer — la pause d'avant revient. |
| `api.combatLaunch.candidates` | `(scene=canvas.scene)` | `runtime/combat-launch.mjs` | Les tokens de la scène, rangés pour la fenêtre (core/combat-launch.mjs `classify`). |
| `api.combatLaunch.launch` | `({ participants=[], npcAuto=true, grouped=false, playlist=null }={})` | `runtime/combat-launch.mjs` | MJ : lance le combat. @param {object} input @param {Array<{uuid: string, surprised?: boolean}>} input.participants @param {boolean} [input.npcAuto=true] Les PNJ lancent leur initiative tout seuls. @param {boolean} [inpu… |
| `api.combatLaunch.open` | `()` | `ui/combat-launch.mjs` | Ouvre la fenêtre (MJ) : la pause d'abord. |
| `api.combatLaunch.pending` | `()` | `runtime/combat-launch.mjs` | Un lancement de combat est-il en cours (pause posée par `begin`, participants pas encore choisis) ? Réglage de monde, tout client. |

## `api.content`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.content.builtin` | _données (869 clés)_ |  |  |
| `api.content.facts` | _liste (65)_ |  |  |
| `api.content.identifierOf` | `(item)` | `adapter/content.mjs` | L'identifiant sous lequel un item est reconnu, et d'où il vient. §19.9 : un item premium sans identifiant (Ravenloft) en reçoit un à sa création sur une fiche — dnd5e 6 l'écrit d'après le nom (documents/item.mjs:1146, `… |
| `api.content.inspect` | `(actor)` | `adapter/content.mjs` | Pour l'inspection en jeu : ce que chaque item d'un acteur déclare, et d'où. |
| `api.content.of` | `(item)` | `adapter/content.mjs` | L'entrée effective d'un item, couches combinées. `null` si rien n'est déclaré nulle part. @returns {{entry: object\|null, identifier: string\|null, layers: {module: boolean, world: boolean, item: boolean}}} |
| `api.content.recipes.build` | `(recipes=[], ctx={})` | `core/recipes.mjs` | L'entrée du schéma tirée d'une liste de recettes. Les déclencheurs s'ajoutent, `usageLimits` se fusionne par activité, une clé `unique` ne vient qu'une fois. `base` : une entrée existante sur laquelle construire (repris… |
| `api.content.recipes.condition` | `(clauses=[], { at="condition", errors=[] }={})` | `core/recipes.mjs` | Une condition du moteur (core/triggers.mjs, `holds`) à partir de clauses `{ fact, arg?, not? }`, toutes requises. Aucune clause : `null` (pas de condition). Les problèmes vont dans `errors` (voir `issue`). |
| `api.content.recipes.factOptions` | _données (4 clés)_ |  |  |
| `api.content.recipes.facts` | _données (25 clés)_ |  |  |
| `api.content.recipes.fieldKinds` | _liste (11)_ |  |  |
| `api.content.recipes.list` | _données (15 clés)_ |  |  |
| `api.content.recipes.publicKeys` | _liste (7)_ |  |  |
| `api.content.recipes.version` | _number_ |  |  |
| `api.content.register` | `(source, table, { sources={} }={})` | `runtime/content.mjs` | Enregistre la table de contenu d'un autre module (voir l'en-tête). Validée entrée par entrée comme le contenu livré. @param {string} source L'id du module qui l'apporte. @param {Record<string, object>} table `{ identifi… |
| `api.content.registered` | `()` | `content/index.mjs` | Ce qui est enregistré : `{ source: [identifiants] }`. |
| `api.content.set` | `(identifier, entry)` | `adapter/content.mjs` | Écrit (ou retire, avec `null`) l'entrée d'un identifiant dans la surcouche du monde. MJ uniquement. |
| `api.content.shipped` | _données (869 clés)_ |  |  |
| `api.content.sources` | `()` | `content/index.mjs` | Les sources enregistrées : `{ source: { id de document: identifiant } }`. |
| `api.content.unregister` | `(source)` | `content/index.mjs` | Retire la table d'un module (et ses sources, §277). @returns {boolean} Si elle était enregistrée. |
| `api.content.validate` | `(entry)` | `runtime/content.mjs` | Les erreurs d'une entrée de contenu (`string[]`, vide = valide), contre le schéma `core/content/entry.mjs`. Ne change rien. |
| `api.content.validateSources` | `(sources)` | `core/content/entry.mjs` | §277 : les erreurs d'une table de sources `{ id de document: identifiant }` — les correspondances qu'un module enregistre avec sa table (`api.content.register(source, table, { sources })`) pour des items qui n'ont pas d… |
| `api.content.version` | _number_ |  |  |
| `api.content.world` | `()` | `adapter/content.mjs` | La surcouche du monde : `{ identifiant: entrée }`, tenue par le MJ. |

## `api.correction`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.correction.apply` | `(input)` | `runtime/correction.mjs` | Applique une correction (MJ). Rend `{ ok, message, lines }` ou `{ ok: false, reason }`. @param {object} input @param {string} input.activity uuid de l'activité (sur la fiche du personnage). @param {number\|null} [input.l… |
| `api.correction.open` | `(subject)` | `ui/correction.mjs` | Ouvre la fenêtre de correction (MJ) sur un objet ou une activité. |
| `api.correction.shape` | `(activity)` | `runtime/correction.mjs` | L'activité fait-elle un jet d'attaque, impose-t-elle une sauvegarde, a-t-elle des dégâts, des effets ? |
| `api.correction.undo` | `(messageId)` | `runtime/correction.mjs` | MJ : défait une correction — les PV rendus en écart (les dégâts reviennent, un soin est repris), Inconscient / Mort retirés s'ils sont venus avec ces dégâts et que la créature a de nouveau des PV, les effets posés retir… |

## `api.debug`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.debug.clear` | `()` | `runtime/debug.mjs` | Vide, sur ce client, les erreurs relevées, la piste, les lignes gardées et ce qui attendait d'être envoyé au MJ actif. |
| `api.debug.enabled` | `()` | `runtime/debug.mjs` | La capture tourne-t-elle sur ce client (réglage client `debugCapture`) ? |
| `api.debug.errors` | `()` | `runtime/debug.mjs` | Les erreurs relevées, groupées par signature, la plus récente d'abord — chez le MJ actif, celles que les joueurs lui envoient comprises. |
| `api.debug.logs` | `()` | `runtime/debug.mjs` | Les lignes de console des modules de la suite gardées en mode détaillé (300 au plus) sur ce client. |
| `api.debug.onError` | `(fn)` | `runtime/debug.mjs` | Écouter les nouvelles erreurs (la pastille de l'interface) ; rend une fonction pour arrêter. |
| `api.debug.open` | `({ token=null }={})` | `ui/debug-report.mjs` | Ouvre la fenêtre (ou la ramène devant). `token` : le contexte joint, depuis le menu contextuel. |
| `api.debug.openConnectionTest` | `(userId)` | `ui/connection-test.mjs` | Ouvre la fenêtre du test pour un joueur et le lance (ou ramène devant celle déjà ouverte). |
| `api.debug.register` | `({ module, repo=null, collect=null }={})` | `runtime/debug.mjs` | Un voisin se déclare : `{ module, repo?, collect? }` — `collect()` rend une section d'environnement (valeurs simples). |
| `api.debug.registered` | `()` | `runtime/debug.mjs` | Les voisins déclarés par `register` : `[{ module, repo, collect }]`. |
| `api.debug.testConnection` | `(target, { count=PING_COUNT, progress=() => {} }={})` | `runtime/connection.mjs` | Le test, chez le MJ : allers-retours puis sonde, comparés à son propre client. @param {User\|string} target @param {object} [options] @param {number} [options.count] Nombre d'allers-retours. @param {(step: string) => voi… |
| `api.debug.total` | `(which)` | `runtime/debug.mjs` | Le nombre d'erreurs relevées : `total()` toutes ; `total("suite")` les erreurs DAS ; `total("others")` hors DAS. |
| `api.debug.trail` | `(module, kind, text)` | `runtime/debug.mjs` | Un geste d'un voisin dans la piste : `trail(module, kind, text)`. |
| `api.debug.trailList` | `()` | `runtime/debug.mjs` | La piste de ce client : ses 50 derniers gestes DAS (et ceux des voisins), du plus ancien au plus récent. |
| `api.debug.verbose` | `(on)` | `runtime/debug.mjs` | Sans argument : le mode détaillé de ce client est-il allumé ? Avec `on` : l'allume ou l'éteint sur ce client, et rend le nouvel état. |
| `api.debug.verboseEverywhere` | `(on)` | `runtime/debug.mjs` | Le MJ : le mode détaillé chez tous les clients connectés (les autres à la réception de la requête). |

## `api.diagnostic`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.diagnostic.open` | `({ check=null }={})` | `ui/diagnostic.mjs` | Pour l'API et les macros : ouvrir le diagnostic, éventuellement sur une seule vérification. |

## `api.ethereal`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ethereal.enabled` | `()` | `runtime/ethereal.mjs` | L'automatisation du plan Éthéré est-elle allumée (réglage de monde `etherealPlane`) ? Hook `dnd5e-combat.etherealPlane`. |
| `api.ethereal.is` | `(t)` | `runtime/ethereal.mjs` | La créature (token, document ou acteur) est-elle dans le plan Éthéré (état `ethereal` de dnd5e) ? |
| `api.ethereal.perceives` | `(observer, target)` | `runtime/ethereal.mjs` | L'observateur peut-il percevoir la cible quant au plan (même plan : oui ; sinon la règle du cœur) ? Le reste de la vue n'est pas jugé. |
| `api.ethereal.setEnabled` | `(on)` | `runtime/ethereal.mjs` | MJ : allume (`on` absent ou vrai) ou coupe l'automatisation du plan Éthéré → la promesse du réglage écrit ; null pour un joueur. |
| `api.ethereal.toggle` | `(tokens=null, active=null)` | `runtime/ethereal.mjs` | Bascule l'état Éthéré des tokens donnés (par défaut les tokens contrôlés). `active` : true / false force le sens ; sans lui, chaque token passe de l'un à l'autre — sauf un groupe mixte, qui passe tout entier dans l'Éthé… |

## `api.factions`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.factions.add` | `({ name, color }={})` | `runtime/factions.mjs` | Ajouter une faction (id tiré du nom). Rend son id. |
| `api.factions.assign` | `(documents, id)` | `runtime/factions.mjs` | Pose la faction `id` (null : la retire) sur des tokens ou des acteurs — droit d'écrire ces documents requis (le MJ) ; rend leur nombre. |
| `api.factions.explicit` | `(token)` | `runtime/factions.mjs` | La faction posée à la main (token, sinon acteur), sans les règles ni `party` ; null si aucune. |
| `api.factions.grudge` | `(a, b, { clear=false, scene=canvas?.scene }={})` | `runtime/factions.mjs` | Rend deux camps (ids de faction ou uuid de token) hostiles sur une scène (la scène affichée par défaut), ou lève cette rancune (`clear`) ; écrit la scène (MJ) et rend la liste des rancunes. |
| `api.factions.grudges` | `(scene=canvas?.scene)` | `runtime/factions.mjs` | Les rancunes d'une scène (la scène affichée par défaut) : `[[a, b], …]`. |
| `api.factions.list` | `()` | `runtime/factions.mjs` | Les factions du réglage, chacune avec son nom affiché (`label`). |
| `api.factions.name` | `(id)` | `runtime/factions.mjs` | Le nom affiché de la faction `id` (traduit, sauf si le MJ l'a renommée). |
| `api.factions.NONE` | _string_ |  |  |
| `api.factions.of` | `(token)` | `runtime/factions.mjs` | L'id de faction d'un token (posée sur le token, sinon sur l'acteur, sinon `party` pour un PJ, sinon les règles du réglage), ou null. |
| `api.factions.open` | `()` | `dnd5e-combat.mjs` | Ouvre (ou ramène devant) la fenêtre des factions sur ce client. |
| `api.factions.PARTY` | _string_ |  |  |
| `api.factions.relation` | `(a, b)` | `runtime/factions.mjs` | La relation de deux tokens : `"hostile"`, `"neutral"` ou `"allied"` (matrice des factions, sinon déduite des dispositions). |
| `api.factions.relations` | `()` | `runtime/factions.mjs` | Une copie de la matrice des relations : `{ "<id>\|<id>": relation }` (une paire absente suit la disposition). |
| `api.factions.remove` | `(id)` | `runtime/factions.mjs` | Retirer une faction : ses relations partent avec elle ; les flags qui la nomment sont ignorés (faction inconnue). |
| `api.factions.setRelation` | `(a, b, relation)` | `runtime/factions.mjs` | Poser une relation (`null` : suivre la disposition). |
| `api.factions.side` | `(token)` | `runtime/factions.mjs` | Le camp d'un token tel que le moteur le compare : `{ disposition, faction, uuid, stance }`. |
| `api.factions.stance` | `(token, stance=null)` | `runtime/factions.mjs` | Poser ou lever l'attitude d'un token (`"neutral"` : rendu, l'ennemi de personne hors de sa faction). |
| `api.factions.suggest` | `()` | `runtime/factions.mjs` | Les relations suggérées, sous celles déjà posées. |

## `api.floats`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.floats.export` | `()` | `ui/float-theme.mjs` | Le thème du monde, en JSON d'export. |
| `api.floats.fonts` | `()` | `ui/feedback.mjs` | Les familles de polices de ce monde : celles du cœur et des modules, et celles que le MJ a ajoutées (Polices supplémentaires). |
| `api.floats.import` | `(json)` | `ui/float-theme.mjs` | Importe un thème (texte JSON ou objet) pour la table : allures et rythme. MJ seulement. @returns {Promise<{kinds: number, problems: string[]}>} |
| `api.floats.open` | `()` | `ui/float-theme.mjs` | Ouvre la fenêtre (MJ). |
| `api.floats.play` | `(token, kind, text, extra={})` | `ui/feedback.mjs` | §400 : rejoue une sorte sur un token (essai depuis la fenêtre du thème, `api.floats.play`). |
| `api.floats.reset` | `()` | `ui/float-theme.mjs` | Revient à l'allure d'origine (le thème vide). |
| `api.floats.try` | `(kind)` | `ui/float-theme.mjs` | Essaie une sorte sur le token sélectionné (ou rien, avec un avis). |

## `api.gm`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.gm.alert` | `({ text, item=null, actor=null })` | `runtime/gm-alert.mjs` | Signale au MJ ce qui lui revient. Depuis n'importe quel client : la carte est créée par le MJ actif. @param {{ text: string, item?: Item\|string\|null, actor?: Actor\|null }} alert |
| `api.gm.forced` | `({ actor, item=null, reasons, targets=[], token=null })` | `runtime/forced.mjs` | Prévient le MJ et la table qu'une règle a été passée outre. @param {object} forced @param {Actor5e\|null} forced.actor Qui agit. @param {Item5e\|string\|null} [forced.item] Ce qui est utilisé (ou son nom). @param {string[]… |

## `api.heroic`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.heroic.has` | `(actor)` | `adapter/heroic.mjs` | Le personnage joueur a-t-il l'Inspiration héroïque ? |
| `api.heroic.mode` | `()` | `adapter/heroic.mjs` | Le réglage de ce client : « on », « failure » ou « off » (« on » s'il n'est pas lisible). |
| `api.heroic.set` | `(actor, on)` | `dnd5e-combat.mjs` | MJ : donne (`on` vrai) ou retire l'Inspiration héroïque d'un personnage joueur, avec une carte de chat → vrai si elle a changé. |

## `api.mastery`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.mastery.judge` | `(actor, keys)` | `ui/mastery.mjs` | Juge un choix de bottes (`keys` : identifiants d'arme) pour l'acteur, sans rien écrire → `{ ok, reason, slots, removed }`. |
| `api.mastery.open` | `(actor)` | `ui/mastery.mjs` | §222 : ouvre, sur ce client, la fenêtre des bottes d'arme de l'acteur (déjà ouverte : elle passe devant). |
| `api.mastery.sources` | `(actor)` | `ui/mastery.mjs` | Les sources de bottes d'arme de l'acteur (avancements « Trait » en mode « mastery » de ses classes, sous-classes et dons), lues dans ses items. |

## `api.mcp`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.mcp.actionEnd` | `({ tokenId, targetId=null })` | `runtime/testing-rules.mjs` | §43.2 : sans `targetId`, le token `tokenId` s'échappe de son agrippement ; avec, il met fin au premier effet de la cible que son action termine → `{ done }`. |
| `api.mcp.advanceTime` | `({ seconds })` | `runtime/testing.mjs` | MJ : avance le temps du monde de `seconds` secondes (`game.time.advance`) → `{ worldTime }`. |
| `api.mcp.animations` | `()` | `runtime/animations.mjs` | Les animations suivies et le relevé récent (test). |
| `api.mcp.atCost` | `({ action="list", id=null, cost, card=null, tokenId=null, message=null }={})` | `runtime/testing.mjs` | Issue #32 : succès à un prix, pour les scénarios — `list` (les pauses ouvertes chez le MJ actif), `offer` (une pause prise ; `cost` donné : sans la fenêtre du MJ), `dismiss`, `row` (une ligne d'un jet demandé, `card` +… |
| `api.mcp.attackReasons` | `({ attackerId, targetId, itemId, attackMode=null })` | `runtime/testing-rules.mjs` | Les raisons d'Avantage et de Désavantage que le moteur donnerait à cette attaque (core/conditions.mjs), et les créatures hostiles au contact de l'attaquant — pour comprendre un jet « normal » inattendu. |
| `api.mcp.awaiting` | `({ action="list", tokenId=null, kind="reaction", seconds=null }={})` | `runtime/testing.mjs` | §381 : `action` « list » (les attentes connues de ce client), « open » (une fenêtre sonde marquée pour `tokenId`) ou « result » (sa réponse). |
| `api.mcp.barrier` | `({ attackerId, targetId, itemId, activityType=null })` | `runtime/testing.mjs` | O9h (§363) : la barrière qui empêche cette action d'atteindre sa cible (Coquille antivie, Parchemin de protection), ou null. |
| `api.mcp.budget` | `({ tokenId })` | `runtime/testing-rules.mjs` | §20 : le budget du tour d'un combattant (action, action Bonus, Foncer, Se désengager, Vitesse à 0, déplacement en plus). |
| `api.mcp.burning` | `({ tokenId, extinguish: put=false }={})` | `runtime/testing-rules.mjs` | §212 : En feu, pour un scénario — l'état, et `extinguish` : éteindre ses flammes comme l'entrée du menu. |
| `api.mcp.castFromBar` | `({ tokenId, itemId, slot=null, x, y, sheet=false, type="summon", targetIds=null })` | `runtime/testing-areas.mjs` | MJ : lance l'activité `type` (invocation par défaut) comme la barre de DAS · Combat UI, sans attendre la fenêtre ni consommer (sauf `sheet: true`) → `{ started, profiles }` ; ce qui est posé se lit par `summonCaptured`. |
| `api.mcp.castPicked` | `({ targetIds=[], upgrade=false, ...args })` | `runtime/testing.mjs` | §293 : ce que fait « Utiliser » de la fenêtre — `targetIds` cochés, `upgrade` : la case de l'activité qui remplace. |
| `api.mcp.catalyst` | `({ tokenId })` | `runtime/testing-rules.mjs` | §289 : Seconde peau — le MJ déclare le catalyseur vécu (menu du token). |
| `api.mcp.chainCheck` | `({ tokenId, itemId, targetIds })` | `runtime/testing-areas.mjs` | §286 : Chaîne d'éclairs — les cibles (après la première) trop loin de la première, par nom. |
| `api.mcp.chatCards` | `({ count=6 }={})` | `runtime/testing.mjs` | §58 : les dernières cartes du journal telles que le MJ les voit — type, repliée ou non (`display` calculé), résumé des jets de la carte unique et verdict. Lecture seule. |
| `api.mcp.clickCard` | `({ id, index=0 })` | `runtime/testing.mjs` | §391 : clique la carte n° `index` (les grisées exclues) d'une fenêtre du moteur à cartes (`.dnd5e-combat-form` : arme d'Arme élémentaire, forme d'invocation, forme sauvage…), comme un joueur — le connecteur sait remplir… |
| `api.mcp.climb` | `({ tokenId, cells, acrobatic=false })` | `runtime/testing-moves.mjs` | Grimper de `cells` cases, comme l'entrée de menu (sans fenêtre), et attendre la montée ; `acrobatic` : « Courir sur le mur » (§195). |
| `api.mcp.climbCeiling` | `({ tokenId })` | `runtime/testing-moves.mjs` | §192 lot 2 : « Grimper au plafond », comme l'entrée de menu, et attendre la montée. |
| `api.mcp.climbDown` | `({ tokenId, cells })` | `runtime/testing-moves.mjs` | §192 lot 2 : « Descendre le long du mur » de `cells` cases, comme l'entrée de menu (sans fenêtre). |
| `api.mcp.climbHolds` | `({ tokenId, cell })` | `runtime/testing-moves.mjs` | §196 : `api.climb.holds` sur une case (`cell` : { i, j }) — le grimpeur y tiendrait-il ? |
| `api.mcp.climbState` | `({ tokenId })` | `runtime/testing-moves.mjs` | L'état d'un grimpeur (ou d'un candidat) : murs touchés, mode, statut, ce qu'il peut monter, règles du monde ; §192 lot 2 : le plafond. |
| `api.mcp.climbToward` | `({ tokenId, targetId, reachCells=1 })` | `runtime/testing-moves.mjs` | §196 : `api.climb.toward` — grimper jusqu'à l'allonge d'une cible ; rend son résultat, les positions et l'écart (3D) avant / après. |
| `api.mcp.clock` | `()` | `runtime/testing.mjs` | §251 : l'état de l'horloge en temps réel du moteur (null : elle tourne) et le temps du monde. |
| `api.mcp.closeWindow` | `({ id })` | `runtime/testing.mjs` | Ferme une fenêtre (un dialogue fermé vaut « non » : le déplacement mis en pause par le cœur se termine). |
| `api.mcp.concentrate` | `({ tokenId, itemId })` | `runtime/testing-rules.mjs` | §285 : le lanceur se concentre sur la première activité de l'item (l'effet de concentration de dnd5e), sans rien lancer. |
| `api.mcp.connectionTest` | `({ userId, count=5 }={})` | `runtime/testing-debug.mjs` | §388 : le test de connexion d'un joueur connecté, comme l'entrée du menu de la liste des joueurs le lance (sans la fenêtre). |
| `api.mcp.controls` | `({ tokenId=null }={})` | `runtime/testing.mjs` | §220, §224 : les boutons du moteur dans la barre d'outils des jetons (`present`, `active`) et, pour un token, ce que l'escalade propose dans son menu (libellés) — l'interrupteur de l'escalade lu par le scénario `escalad… |
| `api.mcp.controlToken` | `({ tokenId=null }={})` | `runtime/testing-vision.mjs` | Issue #42 : sélectionne un token sur le client du MJ (sa vision devient celle de l'écran), ou relâche tout (`tokenId` null) — pour rejouer le geste d'un MJ : le token déjà sélectionné, puis un état posé, sans remise en… |
| `api.mcp.cover` | `({ attackerId, targetId, itemId=null, effective=false })` | `runtime/testing-rules.mjs` | §172 : l'abri de la cible contre l'attaquant, tel que le verdict le calculera (`coverFor`), ou null. |
| `api.mcp.coverPreview` | `({ attackerId, targetId, itemId })` | `runtime/testing-rules.mjs` | #33 : l'aperçu de l'abri (`api.ui.cover`) de la cible contre l'attaque d'un item de l'attaquant, sur ce client (le MJ : tout). |
| `api.mcp.damageTypes` | `({ tokenId, itemId })` | `runtime/testing-areas.mjs` | §288 : les types de dégâts au choix de l'attaque d'un item (Coup au but : celui de l'arme ou radiant), tels que le jet les proposera. |
| `api.mcp.dash` | `({ tokenId, itemId, x, y, preview=false })` | `runtime/testing-moves.mjs` | §57 : une ruée en ligne droite (Frappe du vent) vers une case donnée (coin haut-gauche), sans la visée : le même contrôle de la case, les mêmes cibles, la même utilisation sans gabarit. `preview: true` : seulement les c… |
| `api.mcp.debugClear` | `()` | `runtime/testing-debug.mjs` | Efface ce que ce client a relevé (erreurs, piste, journal). |
| `api.mcp.debugReport` | `({ description="", includeNames=false, token=null, all=false }={})` | `runtime/testing-debug.mjs` | Le rapport de ce client (MJ) : groupes relevés, Markdown, longueur du JSON et de l'adresse GitHub, dépôts proposés. Par défaut, comme la fenêtre, sans les entrées hors de la suite ; `all` les retient toutes. |
| `api.mcp.debugThrow` | `({ message="test", via="route" }={})` | `runtime/testing-debug.mjs` | Fait échouer la sonde du routeur (`via: "route"`) ou rejette une promesse non attrapée (`via: "rejection"`). |
| `api.mcp.debugVerbose` | `({ on }={})` | `runtime/testing-debug.mjs` | Le mode détaillé de ce client, et un envoi immédiat vers le MJ actif (sans effet chez lui). |
| `api.mcp.diagnosticBackups` | `()` | `runtime/testing.mjs` | Les sauvegardes du diagnostic du monde, la plus récente d'abord : `[{ id, uuid, name, date, roots, checks }]`. |
| `api.mcp.diagnosticForget` | `({ uuids=[], dropPack=false, actors=[] }={})` | `runtime/testing.mjs` | Après un scénario : retire ces entrées de sauvegarde, et le compendium s'il est vide et que le scénario l'a créé (`dropPack`). |
| `api.mcp.diagnosticRepair` | `({ checks=null, roots=null, options={} }={})` | `runtime/testing.mjs` | Répare les tâches réparables de ces vérifications dont la racine est l'un de ces uuid (toutes si `roots` est absent), avec ces options de vérification (`{ [checkId]: { [optionId]: valeur } }`). |
| `api.mcp.diagnosticRestore` | `({ uuid })` | `runtime/testing.mjs` | MJ : restaure la sauvegarde `uuid` du diagnostic, après avoir sauvegardé l'état actuel des mêmes documents → `{ lines, before }`. |
| `api.mcp.diagnosticScan` | `({ checks=null }={})` | `runtime/testing.mjs` | Analyse (rien n'est écrit) : les tâches, sans leurs fonctions. |
| `api.mcp.door` | `({ tokenId, wallId, open=true })` | `runtime/testing-moves.mjs` | §152 : ouvrir ou fermer une porte comme l'entrée « Ouvrir / Fermer » du menu (`setDoorOpen` : s'avancer au contact par `approachDoor`, puis agir). Rend l'état de la porte et la position du token après coup. |
| `api.mcp.dropDown` | `({ tokenId })` | `runtime/testing-moves.mjs` | « Se laisser tomber » : chute volontaire, comme l'entrée de menu. |
| `api.mcp.effectOrigins` | `({ tokenId })` | `runtime/testing-rules.mjs` | §53 : pour chaque effet d'un token, l'item d'origine que le moteur retrouve (item détruit : relu dans le message). |
| `api.mcp.enchant` | `({ tokenId, itemId, activityId, targetItemId, profile=null })` | `runtime/testing-rules.mjs` | §29 : applique l'enchantement d'une activité (son premier profil, ou `profile`) à un item de l'acteur — ce que dnd5e fait par un glisser-déposer sur la carte (Décharge répulsive sur la Décharge occulte). Rend l'id de l'… |
| `api.mcp.endings` | `({ tokenId })` | `runtime/testing-rules.mjs` | §43.2 : les effets auxquels une action met fin — ceux du token (`own`), ceux qu'un autre lui retire (`byOther`) ; et le geste : sans `targetId`, le token prend « S'échapper » pour lui-même ; avec, il met fin au premier… |
| `api.mcp.etherealWalls` | `({ tokenId, point })` | `runtime/testing-rules.mjs` | §225, lot 3 : les murs qui arrêtent le voyage éthéré, vus du token, et si un pas de son centre à `point` en franchit un. |
| `api.mcp.factions` | `({ op="state", tokenIds=[], faction=null, actor=false, a, b, relation=null, aId, bId, name, value, clear=false, stance=null }={})` | `runtime/testing-rules.mjs` | §181 : les factions, pour un scénario. `op` : `state` (réglage, rancunes, factions des tokens donnés), `snapshot` / `restore` (le réglage entier, `value`), `add` ({ name } → id), `relation` ({ a, b } faction ids, `relat… |
| `api.mcp.familiar` | `({ tokenId, clear=false })` | `runtime/testing-moves.mjs` | §107 : l'état d'un familier ou d'un maître — familier reconnu, vision, actions de base, poche dimensionnelle (le familier gardé et ses PV ; `clear` la vide) ; et les gestes : congé (`tokenId` du familier), rappel (`toke… |
| `api.mcp.familiarPocket` | `({ tokenId })` | `runtime/testing-moves.mjs` | §107 : le familier `tokenId` part dans sa poche dimensionnelle (comme l'entrée de menu) → `{ done }`. |
| `api.mcp.familiarRecall` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §107 : le maître `tokenId` rappelle son familier à `point` → `{ done, refusal, tokens }` (les familiers de la scène, avec leurs PV). |
| `api.mcp.flammable` | `({ tokenId, ignite: light=false, regionId=null, fireAt=null })` | `runtime/testing-rules.mjs` | §188 : les zones inflammables de la scène (en feu ou non) et celles que ce token peut allumer ; `ignite` : embrase la première qu'il peut allumer (ou `regionId`), comme l'entrée « Allumer » du menu. |
| `api.mcp.flight` | `({ tokenId, run=false })` | `runtime/testing-moves.mjs` | §238 : ce que le menu propose pour le vol à un token (choix, libellés) ; `run` : le jouer, comme un clic sur l'entrée. |
| `api.mcp.follow` | `({ followerId, leaderId })` | `runtime/testing-moves.mjs` | §41.3 : l'ordre de suivre, de ne plus suivre, et qui suit qui. |
| `api.mcp.followState` | `({ tokenId })` | `runtime/testing-moves.mjs` | Qui le token `tokenId` suit, qui le suit, et sa position : `{ leader, followers, position }` (§41.3). Lecture seule. |
| `api.mcp.forcePlayerWait` | `({ id=null }={})` | `runtime/testing.mjs` | §290 : forcer une attente (`{ id }`, ou la plus ancienne). |
| `api.mcp.foreignSetting` | `({ namespace, key, value })` | `runtime/testing.mjs` | MJ : lit un réglage de monde d'un autre espace (`namespace.key`) et, avec `value`, l'écrit → `{ key, before, now }`, ou `{ absent: true }`. |
| `api.mcp.fortified` | `({ tokenId })` | `runtime/testing-rules.mjs` | §289 : Faveur de vigueur — le bonus de Constitution accordé maintenant à un soin (0 s'il est déjà pris depuis le début de son tour). |
| `api.mcp.gmAlerts` | `()` | `runtime/testing.mjs` | §364 : les alertes MJ affichées dans le bandeau de ce client (textes). |
| `api.mcp.gmQueue` | `()` | `runtime/testing.mjs` | §421 : la File du MJ — `{ mine, players, blocked, count, window }` (`window` : le panneau est-il ouvert ?). |
| `api.mcp.gmQueueAnswer` | `({ id, action })` | `runtime/testing.mjs` | §422 : le MJ répond depuis sa file — le bouton `action` de la fenêtre de la ligne `id` de « À moi de décider ». |
| `api.mcp.gmQueueForce` | `({ id })` | `runtime/testing.mjs` | §421 : le MJ force la ligne `id` de « J'attends un joueur ». |
| `api.mcp.gmQueueRoll` | `({ id })` | `runtime/testing.mjs` | §421 : le MJ lance à la place d'un auteur parti le jet de la ligne `id` de « Bloqué ». |
| `api.mcp.grab` | `({ tokenId, dir=null })` | `runtime/testing-moves.mjs` | §216 : « S'agripper au bord » vers `dir` (ou le premier bord), comme l'entrée de menu ; rend les bords proposés et la position. |
| `api.mcp.grappleState` | `({ tokenId })` | `runtime/testing-rules.mjs` | K4 (§325) : les empoignades que subit un token — DD d'évasion, allonge de la prise, prise tenue. |
| `api.mcp.groupRoll` | `({ tokenIds=[], wait=true, ...request })` | `runtime/testing-rules.mjs` | §242 : une demande de jets aux tokens donnés, comme le bouton « Demander » ; `wait: false` rend la carte tout de suite (les joueurs peuvent prendre leur temps), sinon le point final. |
| `api.mcp.groupRollBreakdown` | `({ tokenId, ...request })` | `runtime/testing-rules.mjs` | §242 : les tuiles du bonus de l'acteur du token `tokenId` pour la demande donnée (comme `api.rolls.breakdown`). |
| `api.mcp.groupRollForce` | `({ id, tokenId })` | `runtime/testing-rules.mjs` | §242 : « Lancer pour lui » sur une ligne de la carte (refusé si elle a déjà un jet), et le mode du système pour une demande. |
| `api.mcp.groupRollMode` | `({ tokenId, ...request })` | `runtime/testing-rules.mjs` | §242 : l'Avantage / le Désavantage que dnd5e donnera à l'acteur du token `tokenId` pour la demande (comme `api.rolls.mode`). |
| `api.mcp.groupRollState` | `({ id })` | `runtime/testing-rules.mjs` | §242 : le point d'une carte de demande, et les tuiles de bonus d'un token pour une demande. |
| `api.mcp.hampered` | `({ tokenId })` | `runtime/testing.mjs` | §134 : Rapide — le nom de l'item qui donne le Désavantage aux attaques d'opportunité contre l'acteur du token `tokenId`, ou null. |
| `api.mcp.heal` | `({ tokenId, amount })` | `runtime/testing-rules.mjs` | §23 : soigne un token comme le ferait un sort (`applyDamage` de type « healing ») ; rend ses PV avant et après. |
| `api.mcp.hoist` | `({ tokenId, dir=null })` | `runtime/testing-moves.mjs` | §209 : se hisser sur le rebord `dir` (« n », « s », « e », « w » ; le premier sinon), comme l'entrée de menu. |
| `api.mcp.hood` | `({ actorId, itemId, down=null })` | `runtime/testing.mjs` | §346 : baisse (`down: true`) ou lève le capuchon d'une source allumée. |
| `api.mcp.hurt` | `({ tokenId, amount, type="bludgeoning", properties=[] })` | `runtime/testing-rules.mjs` | §23 : des dégâts à un token, par `applyDamage` (résistances comprises) ; rend ses PV avant et après. |
| `api.mcp.identify` | `({ tokenId })` | `runtime/testing-rules.mjs` | §19.9 : sous quel identifiant le moteur reconnaît chaque item d'un token, d'où il le tient (item, source, compendium, nom) et les clés de contenu qui s'y attachent — pour les items premium sans identifiant (Ravenloft),… |
| `api.mcp.inventory` | `({ types=null, textLength=700 }={})` | `runtime/testing.mjs` | L'inventaire des capacités du monde (acteurs du monde, pas les tokens non liés) : une ligne par identifiant et type d'item, avec qui la porte, ce que le moteur en connaît (`rules` : les clés de contenu), ses activités,… |
| `api.mcp.issues` | `({ tokenId, itemId, activityType=null, cost=null })` | `runtime/testing-rules.mjs` | Ce qui cloche dans une utilisation (légalité du tour, états), sans l'utiliser ; `cost` force le coût (« bonus », « reaction »). |
| `api.mcp.itemData` | `({ tokenId, itemId, paths=[] })` | `runtime/testing-rules.mjs` | §335 : la donnée source d'un objet d'un token, aux chemins demandés (`effect:<id>:<chemin>` pour un effet de l'objet) — ce qu'une correction de donnée premium a écrit. |
| `api.mcp.jump` | `({ tokenId, cell, high=false })` | `runtime/testing-moves.mjs` | §208 : un saut comme l'entrée de menu (« Sauter ici », « Sauter en hauteur ici »), vers le centre de `cell`. Rend les positions avant et après, ce que le saut permettait (`options`, en pieds), les avertissements affiché… |
| `api.mcp.lightState` | `({ actorId, itemId })` | `runtime/testing.mjs` | §121 : l'état d'une source portée (allumée, temps restant, combustible), ou null si elle n'est plus là. |
| `api.mcp.lock` | `({ tokenId, wallId, method="pick", total=null })` | `runtime/testing-moves.mjs` | §244 : une serrure de porte. Sans `total`, le chemin du menu (s'avancer, payer l'action en combat, lancer le test, juger) ; avec `total`, le jugement du MJ actif seul, pour un résultat voulu. Rend le verdict, l'état de… |
| `api.mcp.longRest` | `({ tokenId })` | `runtime/testing.mjs` | §305 : un Repos long du token, sans fenêtre ni carte (le hook `dnd5e.restCompleted` part comme au repos d'un joueur). |
| `api.mcp.makeScroll` | `({ tokenId, spellUuid, quantity=1 })` | `runtime/testing.mjs` | O8g (§350) : un parchemin de sort fait comme dnd5e le fait depuis un compendium (`createScrollFromSpell`), donné à l'acteur du token. |
| `api.mcp.masteries` | `({ actorId, keys=null })` | `runtime/testing-rules.mjs` | §222 : les bottes choisies d'un acteur — sources, places, choix enregistré, ce que le Repos long laisse changer, et le verdict de la règle pour `keys` s'il est donné. |
| `api.mcp.menu` | `({ tokenId, targetId, run=null })` | `runtime/testing.mjs` | §240 : les entrées du menu contextuel de `targetId` pour `tokenId` (pris en main le temps de la lecture), lues par l'API publique `api.ui.tokenMenu` — `runtime/` n'importe pas `ui/`. `run` : lance l'entrée de ce libellé… |
| `api.mcp.move` | `({ tokenId, cell, point, levelId, action, stopAfterMs, pauseAfterMs })` | `runtime/testing-moves.mjs` | Déplace le token comme un clic de déplacement (`moveTo` : A*, portes, escaliers, attaques d'opportunité, budget), et attend qu'il soit arrivé. Rend les positions avant / après et les fenêtres ouvertes pendant le déplace… |
| `api.mcp.movement` | `({ tokenId })` | `runtime/testing-moves.mjs` | Le budget de déplacement du token dans le combat en cours (null hors combat). |
| `api.mcp.naturalOne` | `({ tokenId })` | `runtime/testing-rules.mjs` | §93 : ce qu'un 1 naturel déclenche chez la créature (le jet lui-même ne se force pas) — sans l'attendre : le scénario répond. |
| `api.mcp.overrideContent` | `({ identifier, entry=null })` | `runtime/testing-rules.mjs` | §27 : pose (ou retire, `entry: null`) l'entrée d'un identifiant dans la surcouche du monde, et rend celle qu'il y avait — pour qu'un scénario la remette (Incantation puissante à la place d'Impact divin). |
| `api.mcp.owners` | `({ tokenId })` | `runtime/testing-areas.mjs` | O8f (§349) : la disposition d'un token et les joueurs (non MJ, ou « default ») qui ont au moins un droit sur son acteur du monde. |
| `api.mcp.perceived` | `({ observerId, targetIds=[] })` | `runtime/testing-rules.mjs` | §62 : ce que le client voit à l'écran par les yeux d'un token — le MJ en prend le contrôle (sa vision devient celle de ce token), on lit `isVisible` et le filtre de détection de chaque cible (le contour de l'ouïe, ou d'… |
| `api.mcp.perf` | `({ limit=20, reset=false }={})` | `runtime/testing.mjs` | §98 : le relevé des temps du moteur sur le client du MJ (les `limit` lignes les plus coûteuses), et les tâches longues. |
| `api.mcp.pickTargets` | `(args)` | `runtime/testing.mjs` | §293 : la liste « créatures de votre choix dans un rayon » qu'aurait la fenêtre (sans ce que voit l'utilisateur). |
| `api.mcp.placeItemEffect` | `({ tokenId, casterId, itemId, effectId, uuid=null })` | `runtime/testing-rules.mjs` | §285 : pose sur un token l'effet `effectId` de l'item `itemId` du lanceur `casterId`, avec son id (comme l'application de dnd5e) et l'item pour origine — ce que l'échec de la sauvegarde aurait posé, sans le hasard du je… |
| `api.mcp.placeMenu` | `({ tokenId, wallId=null, x=null, y=null, probe=null })` | `runtime/testing.mjs` | §243, §247 : les entrées du menu d'une porte (`wallId`) ou d'une case (`x`, `y`) pour `tokenId`, lues par l'API publique (`api.ui.doorMenu`, `api.ui.groundMenu`), avec celles des voisins. `probe` : une entrée d'essai aj… |
| `api.mcp.placeRegionAt` | `({ x, y })` | `runtime/testing-areas.mjs` | §70 : valide la pose de région en cours (`RegionLayer#placeRegion` : celle de dnd5e pour la zone d'un sort, ou la visée de l'éclair) au point (x, y) de la scène, comme un clic : la forme y est centrée, puis la fin de `#… |
| `api.mcp.plan` | `({ tokenId, cell, point, levelId, maxCost })` | `runtime/testing-moves.mjs` | Le chemin que prendrait le moteur, sans bouger. `maxCost` : plafond de coût (unité de la grille), sinon celui du tour. |
| `api.mcp.planning` | `()` | `runtime/testing-areas.mjs` | La visée d'une téléportation en cours sur ce client : celle du moteur, et la planification du cœur (`_movementPlanningContext`). |
| `api.mcp.portent` | `({ tokenId, roll=false, rolls=null, clear=false })` | `runtime/testing-rules.mjs` | §36 : les jets notés du Présage d'un token — `roll: true` les lance comme au Repos long ; `rolls: [n…]` les fixe (scénario : des valeurs connues) ; `clear: true` les efface. Rend le nombre de d20 du devin et son état. |
| `api.mcp.range` | `({ tokenId, itemId, activityType=null })` | `runtime/testing-rules.mjs` | §236 : la portée que le moteur applique à une activité (règles de contenu comprises : Sniper de sorts, Fureur élémentaire améliorée). |
| `api.mcp.rangeCheck` | `({ tokenId, itemId, targetIds=[], activityType=null })` | `runtime/testing-rules.mjs` | O8h (§351) : les soucis de portée (hors de portée, portée longue, trop près) d'une activité contre ces cibles, désignées ici. |
| `api.mcp.rangedPlacement` | `({ tokenId, itemId, shapes })` | `runtime/testing-areas.mjs` | §286 : ce que la pose refuserait pour ces formes de l'activité de zone de l'item (`far`, `hidden`, `apart` — cubes non contigus), ou null ; sans ouvrir la pose de dnd5e. `shapes` : formes de région en pixels (`circle` {… |
| `api.mcp.rawMove` | `({ tokenId, cell=null, elevation=null, action=null, settleMs=1500 })` | `runtime/testing-moves.mjs` | §224 : un déplacement « à la main », comme le glisser ou le champ d'élévation du HUD — `token.move` d'un seul point (case `cell`, sinon sur place) à `elevation` (sinon la sienne), dans le mode `action` (sinon le sien),… |
| `api.mcp.reachCheck` | `({ tokenId, targetId, engage: doEngage=false, approach: doApproach=false })` | `runtime/testing-moves.mjs` | §192 lot 2 : ce que l'attaque de base de `tokenId` pense de `targetId` — écart en cases (3D), vide vertical, trop haut pour une approche, et le verdict de portée ; `engage: true` lance l'attaque de base comme un clic su… |
| `api.mcp.ready` | `({ tokenId, name=null, trigger="enters", targetId=null }={})` | `runtime/testing-rules.mjs` | §211 : Se tenir prêt, pour un scénario — sans `name`, ce que le token peut préparer et son plan ; avec, le plan rangé (l'option dont le nom contient `name`, le déclencheur, la créature `targetId`, l'emplacement le plus… |
| `api.mcp.reload` | `()` | `runtime/testing.mjs` | Le F5 du client du MJ, pour qu'il relise le code du moteur après un changement : la réponse part avant le rechargement. Réservé au MJ ; `call-module-api` n'existe que dans un monde où le réglage « Outils de test » du co… |
| `api.mcp.removeItemEffect` | `({ actorId, itemId, effectId })` | `runtime/testing.mjs` | §346 : retire un effet d'un item de l'acteur (un enchantement appliqué). |
| `api.mcp.reports` | `()` | `runtime/testing.mjs` | Les items signalés en partie par le MJ (SPEC §9.2), pour le bilan relu par Claude. |
| `api.mcp.restoreItem` | `({ actorId, itemData })` | `runtime/testing.mjs` | Rend un item à un acteur sous son identifiant d'origine (`keepId`), pour un scénario qui le lui a fait perdre (Lâche d'Injonction posée en tas par un module voisin) : le connecteur crée toujours un nouvel identifiant, e… |
| `api.mcp.rollCard` | `({ messageId })` | `runtime/testing.mjs` | Le clic sur « Dégâts » ou « Soins » d'une carte d'utilisation dont le moteur attend le jet de l'auteur (soins, dégâts laissés au système) : ce que le connecteur ne fait pas seul (il ne lance que les attaques). Même chem… |
| `api.mcp.rollCheck` | `({ tokenId, skill=null, ability=null })` | `runtime/testing-rules.mjs` | §90 : un test de compétence (`skill`) ou de caractéristique (`ability`), sans fenêtre ; ce qui suit le jet (dé ajouté) n'est pas attendu. |
| `api.mcp.rollSave` | `({ tokenId, ability })` | `runtime/testing-rules.mjs` | §23 : un jet de sauvegarde du token, sans fenêtre ; rend sa formule et son total. |
| `api.mcp.runMacro` | `({ uuid }={})` | `runtime/testing.mjs` | MJ : exécute la macro `uuid` sans l'attendre (une erreur part en console) → `{ started }` (son nom). |
| `api.mcp.saveChance` | `({ casterId, targetId, itemId, activityId=null })` | `runtime/testing-rules.mjs` | La chance d'échec de la sauvegarde que la pastille afficherait (§15.3), pour la comparer au vrai jet. |
| `api.mcp.scatter` | `({ tokenId, pickUp: take=false })` | `runtime/testing-rules.mjs` | §187 : les objets répandus de la scène (chausse-trapes, billes) et ceux que ce token peut ramasser ; `pickUp` : ramasse le premier, comme l'entrée « Ramasser » du menu. |
| `api.mcp.screenAfterUpdate` | `({ observerId, targetIds=[] })` | `runtime/testing-vision.mjs` | Issue #42, suite (Archibald) : l'écran de l'observateur APRÈS une mise à jour de son acteur, sans remise en place de toutes les sources — la préparation des données du token effaçait les modes en mémoire (Vision du diab… |
| `api.mcp.screenHere` | `({ targetIds=[] }={})` | `runtime/testing-vision.mjs` | Ce que CE client montre des tokens de la scène affichée, avec les tokens qu'il contrôle (ou tous ceux qu'il possède quand il n'en contrôle aucun : la vue d'un joueur). Sans MJ requis, pour un client joueur. `targetIds`… |
| `api.mcp.scrollReading` | `({ tokenId, itemId })` | `runtime/testing.mjs` | O8g (§350) : ce que le moteur juge d'un parchemin pour son porteur (`scrollReadingFor`), activité par activité. |
| `api.mcp.sees` | `({ observerId, targetId })` | `runtime/testing-rules.mjs` | §182 : l'observateur voit-il la cible (vision du moteur), et son cône. |
| `api.mcp.sequencer` | `({ end=null }={})` | `runtime/testing.mjs` | Les effets et sons en cours de Sequencer (module tiers : les animations de Boss Loot / BLFX), et la fin de ceux qu'on désigne — pour que le lanceur de scénarios termine ce qu'un scénario a fait naître (vu le 2026-09-29… |
| `api.mcp.setOwners` | `({ actorId, users=[], level=3 })` | `runtime/testing-vision.mjs` | Donne un acteur du monde à des joueurs (propriétaires), par leurs noms — le connecteur ignore `ownership` à la création et à la mise à jour d'un acteur. Pour les arènes (tools/arene-vision.mjs : les observateurs à `clau… |
| `api.mcp.setting` | `({ key, value })` | `runtime/testing.mjs` | Un réglage du moteur (et de lui seul) : rend la valeur d'avant, pour qu'un scénario la remette ; `value` absent : lecture seule. Réservé au MJ (§38.4 : le scénario `presage` désactive le Présage le temps d'une partie). |
| `api.mcp.settingsChanged` | `()` | `runtime/testing.mjs` | Les réglages de monde du moteur qui ne sont pas à leur valeur par défaut (lecture seule) : ce que la table a choisi. |
| `api.mcp.shortRest` | `({ tokenId })` | `runtime/testing.mjs` | C12-j : un Repos court du token, sans fenêtre (les dés de vie ne sont pas dépensés). |
| `api.mcp.sightIssues` | `({ tokenId, identifier, targetIds=[] })` | `runtime/testing-vision.mjs` | Issue #42 : le souci « {name} n'est pas en vue : ce sort vise une créature que vous voyez » d'une visée, sans ouvrir la fenêtre de légalité — le même calcul que runtime/turn.mjs (`sightRequired` de l'activité, puis `can… |
| `api.mcp.skillAid` | `({ tokenId, helperTokenId, kind, skill=null, tool=null })` | `runtime/testing-rules.mjs` | §113 : l'aide demandée comme le ferait le bouton de la fenêtre ; rend si elle est donnée, et si l'Assistance est posée (attendue 10 s). |
| `api.mcp.skillAids` | `({ tokenId, skill=null, tool=null })` | `runtime/testing-rules.mjs` | §113 : les aides que la fenêtre d'un test de compétence ou d'outil proposerait à ce token. |
| `api.mcp.stairs` | `({ tokenId })` | `runtime/testing-moves.mjs` | Les escaliers et échelles de la scène, avec les cases qu'ils couvrent (centre dans la région). |
| `api.mcp.stairsAt` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §41.2 : où mène l'escalier sous ce point pour ce token (ce que lit le curseur et le menu). |
| `api.mcp.stand` | `({ tokenId })` | `runtime/testing-rules.mjs` | §285 : se relever (`standUp`), pour un scénario — rend s'il s'est relevé et si l'entrée du menu est offerte. |
| `api.mcp.stats` | `({ tokenId })` | `runtime/testing-rules.mjs` | Les valeurs calculées d'un token (données préparées par dnd5e, que le connecteur ne rend pas : il lit la source) : CA, vitesses, PV, bonus aux attaques et aux sauvegardes — pour vérifier un effet passif sans passer par… |
| `api.mcp.status` | `()` | `runtime/testing.mjs` | L'état du client qui exécute (le MJ du connecteur) : version et heure de chargement du moteur, et s'il est le MJ actif — celui qui exécute le moteur (`game.users.activeGM`). `tools/reload.mjs` s'en sert pour savoir que… |
| `api.mcp.stealth` | `({ op="state", tokenId, on=true }={})` | `runtime/testing-rules.mjs` | §184 : la Furtivité BG3, pour un scénario. `op` : `state` \| `set` ({ on }) \| `check` \| `forget`. |
| `api.mcp.storm` | `({ tokenId, itemId })` | `runtime/testing-areas.mjs` | §70 : l'orage d'un item sur la scène (nuage, « déjà là », visée en cours). |
| `api.mcp.stormStrike` | `({ x, y })` | `runtime/testing-areas.mjs` | §70 : le clic de la visée de l'éclair (un point de la scène) : la pose du cœur est fermée, l'éclair posé au point. |
| `api.mcp.summonAt` | `({ tokenId, itemId, activityId=null, profile=null, actorUuid=null, x, y })` | `runtime/testing-areas.mjs` | MJ : utilise l'activité d'invocation de l'item (`activityId`, sinon la première) sans rien consommer, puis pose les créatures du profil (`profile`, sinon le premier) à la case `x`, `y` → `{ messageId, tokens: [{ id, nam… |
| `api.mcp.summonCaptured` | `()` | `runtime/testing-areas.mjs` | §383 : ce que la dernière `castFromBar` a invoqué (profil reçu par dnd5e, tokens posés), ou null tant que rien n'est parti. |
| `api.mcp.takeStairs` | `({ tokenId, point, levelId })` | `runtime/testing-moves.mjs` | §41.2 : prendre l'escalier sous ce point jusqu'à `levelId`, comme un clic dessus (sans le dialogue du cœur). |
| `api.mcp.teleport` | `({ tokenId, itemId, x, y, passengers=[] })` | `runtime/testing-moves.mjs` | Une destination de téléportation de soi (Foulée brumeuse), comme la rendrait le clic de la planification du cœur : le plan passe par le même point de contrôle (`dnd5e.teleport`, que le moteur tient : portée, case occupé… |
| `api.mcp.teleportPick` | `({ x, y })` | `runtime/testing-moves.mjs` | §67 ter : le clic du moteur pendant la visée d'une téléportation (un point de la scène), sans la souris. |
| `api.mcp.threats` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §23 : qui menacerait d'une attaque d'opportunité un déplacement en ligne droite jusqu'à ce point (noms). |
| `api.mcp.timer` | `({ tokenId, seconds=5, label="" }={})` | `dnd5e-combat.mjs` | Lance chez tous les clients une minuterie de `seconds` s au-dessus du token `tokenId` de la scène affichée → `{ id }`. |
| `api.mcp.toggleLight` | `({ actorId, itemId, on=null })` | `runtime/testing.mjs` | §121 : allumer ou éteindre une source portée sans passer par son activité (la Torche n'en a pas), comme le menu de l'inventaire ; rend le résultat et l'état de la source. `on` absent : l'inverse. |
| `api.mcp.tokenLight` | `({ tokenId })` | `runtime/testing-areas.mjs` | §287 : la lumière du token telle que la rendent ses effets (`token.light.*` appliqués par le cœur), pas celle de sa source. |
| `api.mcp.transpose` | `({ tokenId })` | `runtime/testing-moves.mjs` | §38.2 : l'échange de place du Troc du filou, comme l'entrée du menu (depuis l'illusion ou son lanceur) ; positions avant / après. |
| `api.mcp.unfollow` | `({ tokenId })` | `runtime/testing-moves.mjs` | Le token `tokenId` (scène affichée) cesse de suivre son meneur (§41.3) → `{ stopped }`. |
| `api.mcp.upkeep` | `({ tokenId, maintain=false })` | `runtime/testing-rules.mjs` | §285 : l'entretien d'un sort (Couronne du dément) — l'état, l'entrée du menu offerte, et `maintain` : l'action Magie prise. |
| `api.mcp.use` | `({ tokenId, itemId, activityType=null, activityId=null, extra=null, consume=false })` | `runtime/testing-rules.mjs` | Une activité utilisée comme au clic (§47) : pose de zone de dnd5e comprise — à la différence de `use-activity` du connecteur, qui la coupe (`create.measuredTemplate: false`). Sans emplacement ; la fenêtre de dnd5e, si e… |
| `api.mcp.view` | `({ levelId })` | `runtime/testing-moves.mjs` | Affiche un niveau de la scène chez le MJ (un déplacement du moteur fait suivre la vue : le scénario la rend). |
| `api.mcp.viewScene` | `({ sceneId })` | `runtime/testing.mjs` | Affiche une scène chez le MJ (`Scene#view`) : activer une scène déjà active ne change pas ce que le MJ regarde (vu le 2026-10-22 : un balayage joué contre l'Arène de test, affichée, l'Arène des sorts étant active). Rend… |
| `api.mcp.visionMatrix` | `({ observerIds=[], targetIds=[], screen=true })` | `runtime/testing-vision.mjs` | La vision de chaque paire : règles et écran. @param {{observerIds: string[], targetIds: string[], screen?: boolean}} args @returns {{vision: boolean, rows: Array<{observer: string, target: string, rules: object, screen:… |
| `api.mcp.waits` | `()` | `runtime/testing.mjs` | §290 : les attentes du MJ (fenêtres du combat sans délai) — `{ waits: [...], window: bool }`. |
| `api.mcp.wall` | `({ tokenId, itemId, activityId=null, points })` | `runtime/testing-areas.mjs` | §162 : un mur posé par points, comme la visée de l'interface le ferait après les clics (ui/pointer.mjs, `aimWall`) : l'activité est utilisée avec les points (`aimed: { type: "wall", points }`), la région et ses murs sui… |
| `api.mcp.wallSide` | `({ regionId, flip=false })` | `runtime/testing-areas.mjs` | §169 : l'état d'un mur à face brûlante — son côté, sa face brûlante (id, formes), ses murs du cœur ; `flip: true` la retourne d'abord (comme l'entrée du menu du lanceur). |
| `api.mcp.windows` | `()` | `runtime/testing-shared.mjs` | Les fenêtres ouvertes chez le MJ (ApplicationV2) : pour retrouver un dialogue qu'un déplacement bloqué attend. |

## `api.nonLethal`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.nonLethal.get` | `(actor)` | `adapter/knockout.mjs` | Les coups de cet acteur sont-ils non létaux ? |
| `api.nonLethal.knockedOut` | `(actor)` | `adapter/knockout.mjs` | La créature est-elle assommée (Inconsciente à 1 PV par un coup non létal) ? |
| `api.nonLethal.set` | `(actor, on)` | `adapter/knockout.mjs` | Active ou coupe les coups non létaux de cet acteur. |

## `api.perf`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.perf.longTasks` | `()` | `runtime/perf.mjs` | Les « tâches longues » du navigateur depuis le chargement ou `reset()` : `{ count, totalMs, maxMs, sinceMinutes }` (Chromium seulement). |
| `api.perf.report` | `()` | `runtime/perf.mjs` | Le temps passé par chaque inscrit du routeur sur ce client, le plus coûteux d'abord : `[{ hook, label, calls, totalMs, avgMs, maxMs, slow, asyncMaxMs }]`. |
| `api.perf.reset` | `()` | `runtime/perf.mjs` | Remet à zéro le relevé de ce client (temps des inscrits, avertissements, tâches longues). |
| `api.perf.table` | `(limit=25)` | `runtime/perf.mjs` | Affiche en console les `limit` lignes les plus coûteuses de `report()`, puis les tâches longues ; ne rend rien. |

## `api.queue`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.queue.answer` | `(id, action)` | `runtime/gm-queue.mjs` | §422 : le MJ répond depuis sa file à ce que le moteur lui demande — le bouton `action` de la fenêtre de la ligne `id` de `mine`, comme s'il l'avait cliqué dans la fenêtre. Rend false si la ligne n'a pas (ou plus) de fen… |
| `api.queue.force` | `(id)` | `runtime/gm-queue.mjs` | Le MJ force la ligne `id` de « J'attends un joueur » : sa fenêtre se ferme chez lui avec la réponse que le délai aurait donnée. La table le voit (texte au-dessus du token). Rend false si la ligne n'existe plus, ou chez… |
| `api.queue.list` | `()` | `runtime/gm-queue.mjs` | MJ : la file — `{ mine, players, blocked, count }` (ce que le moteur lui demande, les joueurs attendus, les actions dont l'auteur est parti) ; vide chez un joueur. Une ligne : `{ id, userId, userName, actor, kind, label… |
| `api.queue.open` | `()` | `ui/player-waits.mjs` | Ouvre (ou ramène devant) le panneau « File du MJ », MJ seulement. |
| `api.queue.roll` | `(id)` | `runtime/gm-queue.mjs` | Le MJ lance à la place d'un auteur parti le jet que doit la ligne `id` de « Bloqué » (ou l'identifiant de son message). MJ actif. @param {string} id |

## `api.releaseNotes`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.releaseNotes.open` | `({ since=null }={})` | `ui/release-notes.mjs` | Pour l'API, l'accueil et les réglages : ouvrir le message de mise à jour. `since` : la dernière version vue (les notes des versions sorties depuis) ; sans elle, les dernières notes. |

## `api.reports`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.reports.clear` | `(uuid)` | `ui/automation.mjs` | Retire le signalement d'un item (par uuid), ou tous sans argument ; écrit un réglage de monde (MJ). |
| `api.reports.list` | `()` | `ui/automation.mjs` | Les items signalés par le MJ (réglage de monde) : `{ uuid de l'item: { actor, actorUuid, item, identifier, note, at } }`. |
| `api.reports.open` | `()` | `ui/automation.mjs` | Ouvre le panneau du bilan sur ce client. |
| `api.reports.text` | `()` | `ui/automation.mjs` | Le bilan des signalements en texte brut, par acteur, à coller dans une conversation. |

## `api.rolls`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.rolls.breakdown` | `(actor, input)` | `runtime/group-roll.mjs` | Les tuiles du bonus d'un acteur pour une demande (`{ type, key, … }` comme `request`) : `[{ kind, label, value, … }]`, indicatives ; [] si la demande est invalide. |
| `api.rolls.force` | `(messageId, actorUuid)` | `runtime/group-roll.mjs` | MJ : lance pour un personnage qui tarde (fenêtre de suivi). Sa fenêtre se ferme chez son joueur (le jet arrive d'ailleurs). @returns {Promise<boolean>} true si un jet a été fait. |
| `api.rolls.mode` | `(actor, input)` | `runtime/group-roll.mjs` | L'Avantage / le Désavantage que dnd5e donnera de lui-même à cet acteur pour la demande (fiche, effets, états) : `{ advantage, disadvantage }`. |
| `api.rolls.open` | `({ actors=[], values={} }={})` | `ui/group-roll.mjs` | Ouvre la fenêtre de demande (MJ). `actors` : acteurs, tokens ou uuid cochés d'office ; `values` : les champs pré-remplis (`type`, `key`, `dc`, `hideDc`, `mode`, `bonus`, `label`, `group`). |
| `api.rolls.request` | `({ actors, ...input }={})` | `runtime/group-roll.mjs` | Pose la demande et fait lancer chacun. MJ seulement. @param {object} options La demande (core/group-roll.mjs `normalizeRequest`) et : @param {Array<Actor\|Token\|TokenDocument\|string>} options.actors @returns {Promise<obj… |
| `api.rolls.title` | `(input)` | `runtime/group-roll.mjs` | Le titre du test demandé, dans les mots de dnd5e (« Test de Sagesse (Perspicacité) ») ; "" si la demande est invalide. |
| `api.rolls.tracker` | `()` | `ui/group-roll-tracker.mjs` | Ouvre (ou ramène devant) la fenêtre de suivi, MJ seulement. |
| `api.rolls.view` | `(messageId)` | `runtime/group-roll.mjs` | Le point d'une carte, pour un voisin (filtré pour un joueur quand le DD est caché). |

## `api.scrolls`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.scrolls.spellOf` | `(item)` | `adapter/scrolls.mjs` | Le sort d'un parchemin `{ identifier, level, school }`, ou null (pas un parchemin, ou sort introuvable). Un parchemin fait depuis un compendium (`createScrollFromCompendiumSpell`, documents/item.mjs) ne recopie pas le s… |

## `api.settings`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.settings.open` | `(ns=MODULE_ID)` | `ui/settings.mjs` | La fenêtre, ouverte sur l'onglet d'un module (le moteur par défaut). |
| `api.settings.registerWindow` | `(def)` | `ui/settings.mjs` | `api.settings.registerWindow(def)` : un module voisin range ses réglages en sous-onglets dans son onglet de la fenêtre DAS. À appeler à son `init` (ou son `setup`), après avoir déclaré ses réglages. `def` : `{ namespace… |

## `api.sneak`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.sneak.check` | `()` | `runtime/stealth.mjs` | Règles `bg3` : juge tout de suite la scène affichée (qui entre dans la vue de qui, tests de Discrétion, repérages). À lancer chez le MJ actif. |
| `api.sneak.is` | `(token)` | `adapter/stealth.mjs` | Le token (ou l'acteur) est-il caché ? |
| `api.sneak.rules` | `()` | `runtime/stealth.mjs` | Les règles de furtivité du monde (réglage `stealthRules`) : `"2024"` ou `"bg3"`. |
| `api.sneak.set` | `(token, on=undefined)` | `runtime/stealth.mjs` | Se cacher ou ne plus l'être (`on` absent : basculer). |
| `api.sneak.spottedBy` | `(token)` | `adapter/stealth.mjs` | Les tokens qui ont repéré ce token caché (ids, règles BG3). |
| `api.sneak.toggle` | `(token)` | `runtime/stealth.mjs` | Bascule l'action Furtivité du token (caché ↔ visible), comme le raccourci Alt+C → `{ hidden, … }` (le résultat de `set`). |

## `api.theater`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.theater.active` | `()` | `runtime/theater-state.mjs` | Le Théâtre de l'esprit est-il actif (les automatisations coupées) ? |
| `api.theater.set` | `(on)` | `runtime/theater.mjs` | Bascule le Théâtre de l'esprit (MJ). |

## `api.ui`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ui.awaiting` | `()` | `ui/awaiting.mjs` | `api.ui.awaiting()` : les attentes en cours connues de ce client (forme publique), et ce que ce client en montre. |
| `api.ui.budget` | `(combatant)` | `ui/api.mjs` | Le budget du tour d'un combattant, tel que le moteur le juge : une action reste disponible tant que l'action Attaquer a des attaques à donner ; la réaction suit « pas deux dans le même tour » (§19.6). null hors d'un com… |
| `api.ui.carriedLight` | `(item)` | `ui/api.mjs` | L'état d'une source de lumière portée (item ou uuid) : `{ uuid, name, img, lit, left, full, fuel }`, ou null si l'item n'en est pas une. |
| `api.ui.carriedLights` | `(actor)` | `ui/api.mjs` | §121 : `carriedLights(actor)` — les sources de lumière portées de l'acteur : `{ uuid, name, img, lit, left, full, fuel }` (`left`, `full` en secondes ou null ; `fuel` : `{ identifier, name, quantity }` ou null). `toggle… |
| `api.ui.cell` | `(activity)` | `ui/api.mjs` | §205 : les raisons (`issues`) et le coût (`cost`) d'une case d'interface en un seul calcul. Les deux passent par `useIssues` : une barre qui les demandait séparément le faisait deux fois par case (28 cases : ~14 ms chac… |
| `api.ui.cost` | `(activity)` | `ui/api.mjs` | §137 : ce que coûterait cette activité au budget du tour, tel que le moteur le jugera — « action », « bonus », « reaction », autre chose ou null. Diffère de l'activation de la donnée quand une règle la change (Observate… |
| `api.ui.cover` | `(attacker, target, activity, options={})` | `ui/api.mjs` | #33 : l'abri qu'aurait `target` contre une attaque de `attacker` avec `activity`, tel que CE client peut le montrer — le calcul du verdict, mais un joueur ne compte que les créatures qu'il voit (l'invisible ne se trahit… |
| `api.ui.doorMenu` | `(wall)` | `ui/pointer-menu.mjs` | Le menu d'une porte (`wall` : Wall, WallDocument ou id) et celui d'une case (`point` : `{ x, y }` de la scène) pour le token en main, comme `menuEntriesFor` : les mêmes entrées que le clic droit, celles des voisins comp… |
| `api.ui.globalLight` | `()` | `ui/illumination.mjs` | Ce que donne la lumière globale de la scène affichée, selon les règles du moteur (§16.52 : plage d'obscurité, « vive », crépuscule) — pour un module d'affichage qui veut le même « plein jour » que les règles (`api.ui.gl… |
| `api.ui.groundMenu` | `(point)` | `ui/pointer-menu.mjs` | Le menu d'une case (`point` : `{ x, y }` de la scène) pour le token en main : `[{ icon, label, run }]`, voisins compris ; vide sans token en main. |
| `api.ui.issues` | `(activity, options={})` | `ui/api.mjs` | Ce qui cloche si cette activité était utilisée maintenant, avant de savoir qui elle vise (budget et tour, emplacement déjà lancé ce tour, Silence, limites d'usage, états qui empêchent d'agir, Rage) : les raisons, tradui… |
| `api.ui.light` | `(token)` | `ui/illumination.mjs` | La lumière où se tient un token, pour une interface (`api.light`, demandée par Darsh UI DnD5 le 2026-09-27). @param {Token\|TokenDocument} token @returns {{key: "bright"\|"dim"\|"dark"\|"magical", icon: string, name: string… |
| `api.ui.movableZone` | `(activity)` | `ui/api.mjs` | §111 : l'activité a-t-elle une zone déplaçable déjà posée (Rayon de lune) ? L'utiliser la déplace alors (ui/pointer.mjs, §16.14) : rien n'est lancé, aucun emplacement n'est dépensé — une interface ne doit ni la griser f… |
| `api.ui.movement` | `(token)` | `ui/api.mjs` | Le déplacement du tour d'un token en combat, dans l'unité de la grille : dépensé (escaliers et relevé compris, téléportations exclues), permis (vitesse, Foncer, déplacement ouvert par un effet), et ce qui reste **réelle… |
| `api.ui.multiattackLeft` | `(actor)` | `ui/api.mjs` | §18.19 : ce qui reste des Attaques multiples ouvertes ce tour par cet acteur — uuids des items encore jouables (`left`), de ceux du plan qui n'ont plus rien (`spent`), noms des premiers. null sans plan ouvert. @param {A… |
| `api.ui.ritual` | `(activity)` | `ui/api.mjs` | §139 : comment ce sort se lancerait maintenant — « ritual » : en rituel d'office (sans emplacement, même non préparé avec Savoir rituel) ; « ask » : le joueur choisira rituel ou emplacement ; « none » : comme d'habitude… |
| `api.ui.targeting` | `()` | `ui/pointer.mjs` | §118 : la visée que ce client attend, pour les modules voisins (`api.ui.targeting()`) — tant qu'elle est ouverte, le clic gauche est au moteur, quel que soit ce qu'il y a sous la souris (cadavre, coffre, marchand). `{ t… |
| `api.ui.timer` | `({ token, seconds, label="", icon="gear", id=null }={})` | `ui/timers.mjs` | Lance une minuterie au-dessus d'un token, chez tous les clients connectés. @param {{token: TokenDocument\|Token\|string, seconds: number, label?: string, icon?: string, id?: string}} options @returns {{id: string, done: P… |
| `api.ui.toggleLight` | `(item, on=null)` | `ui/api.mjs` | §121 : allume ou éteint une source portée (item ou uuid ; `on` absent : l'inverse), sur le client du porteur → `{ changed, lit?, left?, refilled?, reason? }`. |
| `api.ui.tokenMenu` | `(target)` | `ui/pointer-menu.mjs` | §41.4 : les entrées du menu contextuel d'un token, pour une interface qui veut les offrir ailleurs que sur le canevas (le portrait du Groupe de Darsh UI DnD5) : ce que le token en main (le seul contrôlé, à soi) peut fai… |
| `api.ui.wards` | `(actor)` | `ui/api.mjs` | §108 : les réserves qui absorbent les dégâts de cet acteur, actives (Égide arcanique créée depuis le dernier repos long) : points restants et maximum (les utilisations de l'item, adapter/absorb.mjs). Vide sans réserve a… |

## `api.vanilla`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.vanilla.is` | `(x)` | `adapter/vanilla-state.mjs` | Ce document, ces données ou cette configuration viennent-ils d'une action lancée sans DAS ? Suit les liens de dnd5e vers la carte d'origine ou la concentration (un niveau, pas de chaîne). |
| `api.vanilla.use` | `(subject, { event=null }={})` | `runtime/vanilla.mjs` | Utilise un objet ou une activité par dnd5e seul (§395). Un objet à plusieurs activités ouvre le choix de dnd5e. @param {Item\|object} subject Item5e ou activité. @param {object} [options] @param {Event} [options.event] L… |

## `api.vision`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.vision.canHear` | `(observer, target)` | `dnd5e-combat.mjs` | §186 : l'ouïe du moteur pour un voisin (lecture seule) — murs et planchers qui arrêtent le son, Assourdi, cible cachée ; sans portée. |
| `api.vision.canSee` | `(observer, target)` | `dnd5e-combat.mjs` | §178 : la vision du moteur pour un voisin (lecture seule) — null quand la vision simulée est coupée ou ne peut pas juger. |
| `api.vision.cone` | `(token)` | `dnd5e-combat.mjs` | §182 : le cône de vision d'une créature (`{ angle, rotation }`, convention du cœur), ou null quand elle voit à 360°. |

## `api.waits`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.waits.force` | `(id)` | `dnd5e-combat.mjs` | MJ : force l'attente `id` (le client du joueur résout ses fenêtres comme au bout du délai) → vrai si l'attente existait ; faux pour un joueur. |
| `api.waits.list` | `()` | `adapter/player-wait.mjs` | Les attentes en cours, la plus ancienne d'abord. |
| `api.waits.open` | `()` | `ui/player-waits.mjs` | Ouvre (ou ramène devant) le panneau « File du MJ », MJ seulement. |

## `api.welcome`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.welcome.open` | `()` | `ui/welcome.mjs` | Pour l'API : ouvrir l'accueil. |
