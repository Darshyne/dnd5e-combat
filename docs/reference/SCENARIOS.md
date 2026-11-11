# Scénarios en jeu

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

325 scénarios (`tools/scenarios/`), joués dans le client du MJ par le connecteur : `node tools/reload.mjs && node
tools/scenario.mjs <noms>`. **Scène** : vide = l'« Arène de test » ; sinon la scène que le scénario demande (sauté si elle manque).
Les scénarios d'un sous-dossier ne font pas partie de la passe complète : `node tools/scenario.mjs tools/scenarios/<dossier>`. Les
`balayage-*` ne se jouent que nommés. Choisir sans connaître les noms : `--grep <mot>`, `--section <§>`, `--scene <nom>` ; `--list` montre
la sélection sans rien jouer.

## Passe complète

| Scénario | Scène | § | Ce qu'il vérifie |
|---|---|---|---|
| `a-terre` |  | §17.1 | Mort / Inconscient à 0 PV, même hors combat |
| `abri-grotte` |  | §239 | case coupée par un mur de grotte : pas d'abri derrière soi |
| `abri` |  |  | créature interposée, abri partiel +2 |
| `actions-tour` |  | §15.2 | Pointe, Dague, Dague en main secondaire |
| `agrandissement` |  | §16.58 | Agrandissement (token 2×2), Rapetissement, retour à la taille d'origine |
| `alerte-mj` |  | §364 §366 §365 | bandeau, carte chuchotée, filtre d'activité, réglage |
| `apercu-abri` |  |  | sources, état posé à la main, cohérence avec le verdict |
| `appel-de-la-foudre` |  | §70 | nuage qui reste, éclair visé dessous, orage déjà là, relance |
| `aptitudes-generiques` |  | §278 §281 §279 | Essai : pugnace |
| `arme-improvisee` |  | §213 | demande au MJ, accepter, refuser, comme une arme |
| `armes-de-sort` |  | §16.41 | Lame de feu, Arme élémentaire |
| `armure-sans-formation` |  | §214 | Désavantage Force/Dextérité, pas de sorts, bouclier sans bonus |
| `ascendance` |  | §16.25 | Ascendance féerique |
| `assommer` |  | §210 | coups non létaux, réveil, surprise à l'initiative |
| `attaque-puis-lutte` |  |  | Attaque supplémentaire, la Bousculade remplace une attaque |
| `attaque` |  |  | Trait de feu → Zombi |
| `attaques-multiples` |  | §18.6 | Ours brun : une Morsure et une Griffe |
| `attente-sablier` |  | §381 | sablier : publiée à l'ouverture, retirée à la réponse, au délai, à l'annulation |
| `audit-pj` |  |  | audit d'une fiche de PJ (Arène des sorts, copie de la fiche) |
| `aura-sacree` |  | §86 | aura, Désavantage des attaquants, un Mort-vivant qui touche au corps à corps est Aveuglé s'il rate |
| `auras-bonus` |  | §18.12 | Autorité, Commandement des morts-vivants, Bravoure |
| `auras-monstres` |  | §18.11 | Aura de feu (fin de tour), Puanteur (début de tour) |
| `avaler` |  | §18.17 | Béhir : avalé, abri total, emporté, dégâts, régurgité, libéré |
| `avant-attaque` |  | §34 §36 | Esquive des ombres, Éclat protecteur, Présage cosmique (Péril, Fortune) |
| `avantage-declare` |  | §16 | Tactique de meute (allié au contact), Lueurs féeriques (effet sur la cible) |
| `balayage-aptitudes` |  |  | balayage des dons et aptitudes du Manuel des joueurs (Arène des sorts) |
| `balayage-enchantements` |  | §391 §77 §16.39 | balayage des enchantements et transformations à plusieurs profils (barre, sans emplacement) |
| `balayage-invocations` |  | §389 §77 §384 §386 | §389 (issue #38) : balayage des invocations par les VRAIS chemins de lancement — les balayages de sorts et d'aptitudes (`tools/lib/balayage.mjs`) sautent les activités « summon »… |
| `balayage-sorts` |  | §406 | balayage des sorts du Manuel des joueurs (Arène des sorts) |
| `bannissement` |  | §265 | la cible disparaît, puis revient (au plus proche si sa case est prise) |
| `barbare` |  | §22 | Rage (entretien, fin), Bond instinctif, Témérité, Frénésie, Fureur divine, Rage implacable |
| `barde` |  | §33 | Inspiration bardique (attaque, sauvegarde), Mots cinglants |
| `bottes` |  | §21 | Écorchure, Sape, Ouverture, Ralentissement, Renversement, Poussée, Enchaînement |
| `bouclier-de-feu` |  | §266 | l'effet fait briller le lanceur |
| `bourrasque` |  | §37.3 | poussée à la pose, rejeu en fin de tour |
| `briques-367` |  | §367 | Marche dans l'ombre selon la lumière, Tempête de vengeance sans tir |
| `caresse-survivant` |  | §120 | Alara |
| `chance-sauvegarde` |  | §15.3 | calcul = vrai jet, Bénédiction, échec d'office |
| `chance-tenebreux` |  | §38 | 1d10 ajouté à une sauvegarde ratée |
| `chausse-trapes` |  | §187 | la zone reste, on s'arrête dessus, on la ramasse |
| `choix-sorts` |  | §401 | choix laissés au lanceur par le texte des sorts (§401) |
| `chute-niveaux` | keep | §218 | après un saut, ou en bougeant un token en chute |
| `clerc` |  | §27 | Impact divin, Incantation puissante, Prêtre de guerre, Disciple de la Vie, Guérisseur béni, Guérison suprême |
| `college-esprits` |  | §96 | Esprits vengeur, brute, couard, diseur de bonne aventure, prêtre, de l'ombre ; Canalisation renforcée |
| `compteur-action-fin` |  | §43 | Pétrification, Danse irrésistible d'Otto, Sommeil |
| `concentration-zero` |  | §303 | 0 PV = fin de la Concentration (Mur de feu, Rayon de lune, mort sur le coup) |
| `cones` |  | §182 | hors combat, une créature du MJ ne voit que devant elle |
| `contresort` |  | §16 | un hostile contre le Rayon de givre du Magicien |
| `cordon-de-fleches` |  | §75 | une sauvegarde à chaque entrée, quatre projectiles puis la fin |
| `crapaud` |  | §45 | Engloutissement posé par le moteur, acide en fin de tour, libéré à la mort |
| `critiques` |  | §207 | écart à la CA, table de critiques, choix de l'attaquant |
| `dague-des-ombres` |  | §71 | stabilisée, empoisonnée et paralysée seulement à 0 PV |
| `debogueur` |  | §380 | erreurs regroupées, piste, rapport sans noms |
| `defenses` |  | §16.46 | Voile défensif, Résistance |
| `degats-bonus` |  | §16 | Maître d'armes lourdes (+ maîtrise), Voile spirituel (+1d8 nécrotique à 10 ft) |
| `diagnostic-ddb` |  | §245 §257 | objet DDB aux ids d'activité changés signalé, puis remplacé par l'officiel, avec et sans verrou |
| `diagnostic-effets` |  | §202 | enchantement perdu rétabli, au nom de l'objet traduit |
| `diagnostic-traduction` |  | §203 | textes restés en anglais, traduction du compendium reprise |
| `diagnostic` |  | §177 | analyse, réparation sauvegardée, restauration exacte |
| `dissipation` |  | §37.2 | d'office, par un test, par l'emplacement |
| `dons-lot-7` |  | §289 | fins des dons sombres de Ravenloft, Seconde peau, Faveur de vigueur |
| `dons-ravenloft` |  | §94 | Cri surnaturel, Symbiose, Survivant, Savoir d'une vie passée, Hurlement, Bond féroce, Chercher |
| `dons-sombres` |  | §93 | 1 naturel (Anatomie aberrante, Guetteurs, Être symbiotique) |
| `druide` |  | §30 | Attaques primitives, Foulée sélène, Courroux des mers |
| `duel-force` |  | §270 | fin quand le lanceur attaque un autre, ou qu'un allié blesse la cible |
| `duree-texte` |  | §18.7 | Empoisonné jusqu'au début du prochain tour de l'attaquant |
| `duree` |  | §16.37 | Lumière du jour prend fin avec l'heure du monde |
| `ecarts-sorts-2` |  | §403 | écarts moyens des sorts, second lot (§403) |
| `ecarts-sorts` |  | §402 | écarts moyens des sorts corrigés (§402) |
| `egide-projetee` |  | §38 | l'égide du Magicien absorbe les dégâts du Guerrier |
| `elevation` |  | §14.2 | une zone au sol épargne une créature en vol |
| `emanations-sur-soi` |  | §86 §47 | Présence royale de Yolande, Invocation d'êtres sylvestres (alliés épargnés) |
| `empoignade` |  | §15.2 | désavantage, rupture à distance, s'échapper |
| `en-feu` |  | §212 | brûlures, éteindre, propagation |
| `engloutir` |  | §18.21 | en marchant, s'échapper, cible non agrippée, sauvegarde répétée |
| `ensorceleur` |  | §32 | Sorcellerie innée, Sorts accéléré, intensifié, prévenant, subtil |
| `entrave` |  | §16.54 | Enchevêtrement, S'échapper par un test de Force (Athlétisme) |
| `epuisement` |  |  | malus aux Tests d20, Vitesse, Mort au niveau 6 |
| `escalade-contenu` | Escalade | §195 | Athlète, Pattes d'araignée, Mouvement acrobatique, Pantoufles et surface glissante |
| `escalade-interrupteur` | Escalade | §224 | l'interrupteur du MJ : hauteur libre, rien ne tombe, puis le sol de nouveau |
| `escalade-niveau` | keep | §209 §216 | se hisser sur un toit, s'agripper au bord, pas à travers un plafond, chemin et coût en combat |
| `escalade-voisins` | Escalade | §196 | api.climb (état, tenue au mur, rejoindre une cible), marche loin du mur refusée |
| `escalade` | Escalade | §192 | grimper au mur, marcher le long, chute, budget, règles maison |
| `escalier-direct` | keep | §41.2 | un clic sur l'escalier change de niveau, sans dialogue |
| `escaliers` | keep | §14.2 §18.26 | l'A* du moteur change de niveau par un escalier |
| `especes` |  | §31 §295 | Acharnement, Ascendance gigante, Révélation céleste, Poussée d'adrénaline, Forme de géant |
| `esprits-gardiens` |  |  | à la pose, puis fin de tour du Zombi dans l'émanation |
| `ethere-interrupteur` |  | §225 | l'interrupteur du MJ coupe toute la gestion, sans rien déplacer |
| `ethere-murs` |  | §225 | les murs se traversent, sauf les murs de force ; pas de chute |
| `ethere-retour` |  | §225 | retour sur une case occupée (repoussé, dégâts de force), chute au retour, Saut éthéré |
| `ethere` |  | §225 | ni cible, ni zone, ni attaque d'opportunité, ni case bloquée d'un plan à l'autre |
| `factions` |  | §181 | bandit et zombi ennemis par la matrice, rancune, disposition déduite |
| `familier` |  | §107 | actions de base, vision, poche dimensionnelle |
| `fee-ange` |  | §92 | Foulée des fées, Échappatoire brumeuse, Ange vengeur |
| `fenetres-sans-delai` |  | §290 | le MJ voit qui il attend, et force |
| `feu-gregeois` |  | §49 | En feu, dégâts au début du tour, s'éteindre à terre |
| `fin-sur-degats` |  | §16.7 | Motif hypnotique cesse, Fou rire rejoue sa sauvegarde |
| `fins-de-sorts-suite` |  | §42.2 | Assassin imaginaire, Sphère de vitriol, léthargie de Hâte, Châtiment de fournaise |
| `fins-de-sorts` |  | §42.2 | Fou rire de Tasha (PHB), Lenteur, Sanctuaire |
| `fins-et-durees` |  | §79 | Charme-monstre cesse sur les dégâts du lanceur, marque du Rayon traçant jusqu'à la fin de son tour |
| `fins-generiques` |  | §258 | armure enfilée, personne d'affecté, lien trop loin |
| `forme-gazeuse` |  | §269 | ni attaque ni sort |
| `forme-sauvage` |  | §16.39 | prendre une forme, la quitter, la perdre à 0 PV |
| `frappe-occulte` |  | §47 | proposée au toucher, emplacement de pacte, À terre, une fois par tour |
| `frappe-piegeuse` |  | §206 | proposée après un coup d'arme, jet de Force, Avantage des créatures Grandes |
| `furtivite-bg3` |  | §184 | BG3 : repéré en pleine lumière, tests à l'entrée dans le noir, doute puis repéré |
| `furtivite-repaire` | Redbrand Hideout [30x20] | §184 §186 | BG3 dans le repaire : pièce sombre, doute puis repéré, pièce éclairée |
| `furtivite` |  | §15.2 §185 | caché (DD, invisible pour les ennemis seuls), fin à l'attaque et au sort verbal |
| `guerrier` |  | §21 | Fougue, Décalage tactique, Attaques avisées, Héros du champ d'honneur, Armes à deux mains, Armes de jet |
| `hadar-piegeuse` |  | §80 | Faim de Hadar (froid au début du tour, acide à la fin) et Frappe piégeuse (dégâts au début du tour) |
| `heroique` |  | §282 | Inspiration héroïque (attaque, dégâts) |
| `huile-au-sol` |  | §188 | lancer, flaque, embrasement, toile qui brûle |
| `huile` |  | §54 | couvert d'huile, puis le feu l'enflamme |
| `injonction-monstre` | keep | §16.59 §40.3 | Lâche sur un monstre : l'équipement tombe, ses attaques non |
| `injonction` |  | §16.59 §40.3 | Rampe, Halte, Approche, Fuis, Lâche |
| `invocations-ciblees` | Arène des invocations | §393 §118 §388 | cadavre relevé par Doigt de mort et Animation des morts, bête morte refusée (Arène des invocations) |
| `invocations-duree` |  | §198 | la Main du mage disparaît à la fin de sa durée, la monture reste |
| `invocations-forme` |  | §383 | la forme se choisit quand la barre saute la fenêtre de dnd5e (Céleste, Élémentaire) |
| `invocations-zero` |  | §259 | une monture d'Appel de destrier disparaît à 0 PV |
| `jets-demandes` |  | §242 | test de groupe, DD caché, un jet par ligne, mode du système |
| `lame-assoiffee` |  | §16.25 | Lame assoiffée |
| `lancer-main-secondaire` |  | §240 §241 | au menu, action Bonus |
| `lenteur-attaque` |  | §267 | une seule attaque par action Attaquer |
| `lumieres-duree` |  | §121 | durée, extinction, huile, torche consumée |
| `lumieres` |  | §52 §121 | lampe, lanterne sourde, torche par la boîte à amadou |
| `lutte` |  | §15.2 | repoussé, agrippé, choix fait d'avance |
| `magicien` |  | §28 | Sort mineur appuyé, Façonneur de sorts, Évocation améliorée, Calque illusoire |
| `main-libre` | Arène des refus | §409 | composante somatique, Mage de guerre, Neutralisé et sort long |
| `maitre-de-guerre-2` |  | §90 | Attaque précise, Embuscade, Frappe commandée, Chassé-croisé, Balayage |
| `maitre-de-guerre` |  | §87 | Croc-en-jambe, Attaque provocante (dé de supériorité, sauvegarde) |
| `malediction` |  | §37 | caractéristique, attaques, actions, résilience |
| `marche-interrompue` |  | §99 §166 | clic ailleurs, pause |
| `marque` |  | §16.12 | Rayon traçant consommé par l'attaque suivante, Moquerie cruelle par la sienne |
| `metres` | metres | §5.7 | une scène à 1,5 m par case : Vitesse, portée, allonge |
| `meute-invisible` |  | §368 | la meute épargne une créature que le lanceur ne voit pas |
| `modes` | keep | §17.4 | vol, marche, fouissement : élévation cohérente |
| `moine` |  | §24 | Arts martiaux, Déluge de coups, main ouverte, Frappe étourdissante, Défense patiente, Pas du vent, Parade |
| `monstres-toucher` |  | §18.4 | porte de taille (M3) et sauvegarde sœur (M2) |
| `mort-explosive` |  | §18.14 | le Méphite explose en mourant |
| `mur-de-feu` |  | §169 §170 §171 | sans diagonale, opaque, face brûlante, traversée, anneau |
| `murmures-fuite` |  | §147 §152 | Murmures dissonants : la fuite par la Réaction |
| `murs-epais` |  | §172 | Mur d'épines, Barrière de lames : sur les cases, ×4, traversée, anneau, abri |
| `murs-fins` |  | §173 | vent, glace, pierre, force, prismatique : sans diagonale, apparition, abri, anneau, couches |
| `niveau-superieur-attaques` |  | §404 | dés en plus (§404) |
| `niveau-superieur-zones` |  | §406 | Boule de feu à retardement (§406) |
| `niveaux` | keep | §14.2 | un plancher arrête la zone et l'attaque |
| `occultiste` |  | §29 | Décharge répulsive, Buveuse de vie, Âme radieuse, Défenses envoûtantes |
| `orbe` |  | §16.27 | type choisi, rebond (interactif : choisir un type, puis cliquer la seconde cible) |
| `ouie` |  | §62 | invisible ou dans la brume : entendu ; assourdi ou caché : rien ; cible cachée refusée |
| `pacte` |  | §16.45 | type choisi, Charisme, un seul pacte |
| `paladin` |  | §25 | Châtiment divin, Châtiment de tonnerre (sauvegarde), refus, Vœu d'inimitié |
| `partage-case` |  | §105 | Forme d'air, Nuée |
| `passifs-releve-2` |  | §236 | aptitudes passives du relevé des trous, niveaux 9 à 20 (Arène des sorts) |
| `passifs-releve` |  | §235 | aptitudes passives du relevé des trous (Arène des sorts) |
| `plafond` | Escalade | §192 | Pattes d'araignée, marche au plafond, hors d'allonge, retournement, descente, chute, DD 20 maison |
| `porte-passager` |  | §264 | le passager suit le lanceur |
| `porte-serrure` |  | §244 §247 §243 | crocheter, forcer, clé, DD caché |
| `porte` |  | §18.24 §152 §147 | ouvrir et fermer une porte à distance |
| `potions-audit` |  | §53 | ce que chacune fait vraiment |
| `potions-dmg` |  | §53 | bues et consommées |
| `potions` |  | §51 | boire, donner, relever, version du Guide |
| `poussee` |  | §16 | Vague tonnante repousse le Zombi de 10 ft sur un échec |
| `presage` |  | §36 §38.4 | jets notés, attaque, sauvegarde, une fois par tour |
| `pret` |  | §211 | arrive à portée, attaque, sort préparé |
| `projectile-contresort` |  | §119 | Contresort refusé, une seule fenêtre (§119) |
| `projectiles` |  | §16.27 | Projectile magique, Rayon ardent, Décharge occulte |
| `protection-contre-la-mort` |  | §73 | à 1 PV au lieu de 0, puis le sort prend fin |
| `protection-mal-bien` |  | §268 | ni Charmé ni Effrayé par un fiélon |
| `rampe` |  | §17.2 | À terre : mode ramper posé et retiré |
| `ravenloft-options` |  | §19.9 | Morsure vampirique, Attraction de la mort, Retour à la vie, Chemin vers la tombe, Sentinelle au seuil de la mort |
| `reduction` |  | §16.11 §156 | Égide arcanique, Esquive instinctive, Lien protecteur |
| `refus-clics` | Arène des refus | §411 | attaque, menu, zone hors de portée, téléportation |
| `regeneration` |  | §18.13 | soin au début du tour, coupée par le feu, troll à 0 PV |
| `regle-forcee` | Arène des refus | §408 | fenêtre de légalité, alerte au MJ, carte marquée |
| `releve-sorts-1` |  | §157 | Flou, Assassin imaginaire, Duel forcé, État cadavérique, châtiments, Repli expéditif |
| `releve-sorts-2` |  | §157 | Melf, Fracassement, Héroïsme, Sommeil, Hâte, Bouclier |
| `releve-sorts-3` |  | §158 | zones qui durent |
| `releve-sorts-4` |  | §159 | auras et invocations |
| `releve-sorts-5` |  | §160 | soins, états, seuils de PV |
| `releve-sorts-6` |  | §161 §403 | invisibilité, Injonction, Télékinésie, Otiluke, Globe, Clignotement, élémentaires mineurs |
| `releve-sorts-7` |  | §162 | Mur de force, Mur de feu, Mur prismatique, Cage de force |
| `releve-sorts-8` |  | §163 | Champ antimagie, Coquille antivie |
| `releve-sorts-9` |  | §164 §309 | Lévitation, Inversion de la gravité, Embruns, Vif carquois, élémentaire, céleste, Grêle d'épines |
| `renvoi-choix` |  | §293 | Renvoi des morts-vivants : liste des créatures à 9 m, Calcination à la place |
| `renvoi` |  | §16.25 | Calcination des morts-vivants |
| `repasse-arc` |  | §353 | Arc du serment : Avantage, abri et longue portée contre l'ennemi juré |
| `repasse-c1` |  | §295 | corrections déclaratives de la repasse (Arène des sorts) |
| `repasse-c10` |  | §305 | invocations : destrier à la mort du lanceur, Compagnon sauvage au Repos long (Arène des sorts) |
| `repasse-c11` |  | §306 | Troisième œil, Illusions améliorées (Arène des sorts) |
| `repasse-c12a` |  | §316 | Rage persistante à l'initiative (Arène des sorts) |
| `repasse-c12b` |  | §309 §403 | Invocation de céleste à la pose, Métal brûlant, Choc de vie, Aura de protection contre la magie, Rage en armure lourde |
| `repasse-c12c` |  | §311 | Compagnon primitif sur ordre, familier sans attaque, Plénitude stellaire (Arène des sorts) |
| `repasse-c12d` |  | §312 | Souffle du dragon donné à l'Allié (Arène des sorts) |
| `repasse-c12e` |  | §308 | Coup brutal, Défense multiattaque, Maléfice occulte, Mot de pouvoir étourdissant, Fragilisation occulte, Vision ombreuse |
| `repasse-c12f` |  | §310 | Défenses envoûtantes, Désintégration, Toucher du médecin, Modification de mémoire (Arène des sorts) |
| `repasse-c12g` |  | §313 | Double illusoire, Main de l'ultime miséricorde, Toucher restaurateur, Concentration parfaite (Arène des sorts) |
| `repasse-c12h` |  | §314 | Décharge répulsive sur un autre tour de magie, vol de Révélation charnelle (Arène des sorts) |
| `repasse-c12i` |  | §315 | Tireur embusqué : un tir raté ne révèle pas (Arène des sorts) |
| `repasse-c12j` |  | §317 | Source d'inspiration au Repos court (Arène des sorts) |
| `repasse-c2` |  | §296 | créatures de votre choix, plafond, réserve à répartir (Arène des sorts) |
| `repasse-c3` |  | §298 | coût d'action : Magie de guerre, Arme sacrée (Arène des sorts) |
| `repasse-c4` |  | §299 | Rage (aptitudes tenues), fins sur Neutralisé (Arène des sorts) |
| `repasse-c5` |  | §300 | zones, émanations, entrées (Arène des sorts) |
| `repasse-c6` |  | §301 | réactions : Interception, Représailles, Chute ralentie, Feuille morte (Arène des sorts) |
| `repasse-c7` |  | §302 | Avantage et Désavantage oubliés (Arène des sorts) |
| `repasse-c8` |  | §303 | Protection contre la mort contre Mot de pouvoir mortel, Aide à pleins PV (Arène des sorts) |
| `repasse-c9` |  | §304 | Faveur du destin regagnée à l'initiative (Arène des sorts) |
| `repasse-k1` |  | §322 | fin des états de monstre lue dans le texte : sauvegarde répétée, fin sur dégâts, second échec (Arène des sorts) |
| `repasse-k10` |  | §331 | Avantage conditionnel des monstres lu dans le texte (Arène des sorts) |
| `repasse-k10b` |  | §334 | Avantage de la condition d'activation, Désavantage contre la créature (Arène des sorts) |
| `repasse-k10c` |  | §334 | À terre seulement après une charge (Arène des sorts) |
| `repasse-k10d` |  | §334 | Désavantage au soleil (Arène des sorts) |
| `repasse-k11` |  | §332 | pas de dégâts sur une réussite quand le texte n'en donne pas (Arène des sorts) |
| `repasse-k12` |  | §333 | capacités propres des monstres lues dans le texte (Arène des sorts) |
| `repasse-k12b` |  | §333 | CA du Miasme, Épuisement, porte « qui voit la créature » (Arène des sorts) |
| `repasse-k12c` |  | §333 | porte Mort-vivant d'un effet de sauvegarde, Invisibilité rompue à l'attaque (Arène des sorts) |
| `repasse-k12d` |  | §333 | Posture défensive lue dans le texte (Arène des sorts) |
| `repasse-k1b` |  | §334 | immunité temporaire après une réussite, porte « qui n'est pas un Mort-vivant » (Arène des sorts) |
| `repasse-k1c` |  | §334 | identifiant par créature, porte « à 0 PV », porte « Charmé » (Arène des sorts) |
| `repasse-k1d` |  | §334 | Esquive : rien sur une réussite (Arène des sorts) |
| `repasse-k2` |  | §323 | mort à 0 PV et paliers de PV lus dans le texte des monstres (Arène des sorts) |
| `repasse-k3` |  | §324 | un seul effet (tiré ou au choix), Domination d'esprit, Malédiction funeste (Arène des sorts) |
| `repasse-k4` |  | §325 | empoignade des monstres : allonge de la prise, DD d'évasion de la donnée (Arène des sorts) |
| `repasse-k5` |  | §326 | actions légendaires : dépense, attaque annoncée gratuite, une par tour (Arène des sorts) |
| `repasse-k6` |  | §327 | Réactions des monstres : parade lue dans le texte, identifiants propres, Réactions perdues (Arène des sorts) |
| `repasse-k6b` |  | §334 | Réactions de monstres proposées d'après leur déclencheur (Arène des sorts) |
| `repasse-k7` |  | §328 | dégâts récurrents, soins bloqués, absorption lus dans le texte des monstres (Arène des sorts) |
| `repasse-k7b` |  | §334 | dégâts au début du tour de la créature qui a posé l'effet (Arène des sorts) |
| `repasse-k7c` |  | §334 | En feu au toucher, Réactions perdues lues dans le texte (Arène des sorts) |
| `repasse-k8` |  | §329 | poussées des monstres lues dans le texte (Arène des sorts) |
| `repasse-k8b` |  | §334 | poussées « pushes the target … away from itself » (Arène des sorts) |
| `repasse-k9` |  | §330 | portes de taille (sauvegarde) et de type lues dans le texte (Arène des sorts) |
| `repasse-marteau` |  | §352 | Marteau de tonnerre : coup de tonnerre autour de la cible touchée |
| `repasse-mj` |  | §366 | Amitié rompue par le lanceur, Avantage aux attaques du Bouffon |
| `repasse-o1` |  | §335 | donnée premium des objets corrigée à la création et par le diagnostic |
| `repasse-o2` |  | §336 | sauvegardes et défenses d'objets (porté et harmonisé, Antidote, Broche de défense) |
| `repasse-o3` |  | §337 | Baguette de paralysie (durée, sauvegarde répétée), Huile de taggit (réveil) |
| `repasse-o4` |  | §338 | lancers qui remplacent une attaque, zone qui prend son origine, invocation d'objet au combat |
| `repasse-o5a` |  | §339 | propriétés Lourde (Désavantage sous 13) et Chargement (un tir par action) |
| `repasse-o5b` |  | §340 | dégâts en plus contre un type de créature (Vengeresse sacrée enchantée, Épée radieuse) |
| `repasse-o5c` |  | §341 | Anneau du bélier (poussée), Bâton percussif et Épée acérée (règles attachées) |
| `repasse-o6` |  | §342 | Anneau d'esquive totale (réaction, porté seulement), réactions d'objets attachées |
| `repasse-o7` |  | §343 | Cape de déplacement, Bracelets de défense, Anneau d'action libre |
| `repasse-o8a` |  | §344 | Sceptre d'absorption et Bâton du thaumaturge : un sort qui ne vise que le porteur est annulé |
| `repasse-o8b` |  | §345 | Dague venimeuse enduite et Tueuse de géants : sauvegarde de la cible au toucher |
| `repasse-o8c` |  | §346 | capuchon de la Lanterne à capuchon, lumière d'une arme enchantée (Langue de feu, Épée sélène) |
| `repasse-o8d` |  | §347 | Bouclier antiprojectiles et Bouclier d'attraction : défenses contre les attaques à distance |
| `repasse-o8e` |  | §348 | Hache du berserker et Arc du serment : Désavantage avec les autres armes |
| `repasse-o8f` |  | §349 | Le Crâne et le Parchemin d'invocation de titan : invocations hostiles |
| `repasse-o8g` |  | §350 | parchemins de sort : liste de classe, test au-dessus du niveau, Utilisation d'objets magiques |
| `repasse-o8h` |  | §351 | Mangonneau : une cible trop près ne peut pas être touchée |
| `repasse-o9a` |  | §354 | poisons, pièges, talismans, Voleuse de vie, Sceptre de suzeraineté, Masse d'anéantissement, Liens de fer, adamantium |
| `repasse-o9b` |  | §355 | Fléau d'ébène, Noirtranchant, Épée voleuse de vie, Demonomicon |
| `repasse-o9c` |  | §356 | Hache du berserker et Épée vengeresse : la colère quand le porteur est blessé |
| `repasse-o9d` |  | §357 | crocheter sans outils de voleur, forcer avec un Pied-de-biche |
| `repasse-o9e` |  | §358 | Bouclier gardesort : Désavantage aux attaques de sort |
| `repasse-o9f` |  | §359 | Huile éthérée sans cible, Menottes, Corde d'enchevêtrement |
| `repasse-o9g` |  | §360 | Anneau d'invisibilité, Le Bouffon |
| `repasse-o9g2` |  | §361 | Cape elfique : Perception passive des ennemis −5 |
| `repasse-o9g3` |  | §362 | Bottes de rapidité : talons claqués, Vitesse doublée, attaques d'opportunité au Désavantage |
| `repasse-o9h` |  | §363 | Poison, othur, pugilistes, résistance, perle, cor, parchemin, poussière, huile, dynamite |
| `repasse-rayons` |  | §334 | rayons oculaires du Tyrannœil (Arène des sorts) |
| `repliques` |  | §16.25 | Rahadin, chambellan du château |
| `resistances` |  | §18.9 | à la magie, légendaire |
| `ressources-forcees` | Arène des refus | §410 | emplacement, préparation, utilisations |
| `revele` |  | §16.36 | Poussière d'étoile annule Invisible |
| `riposte` |  | §16.9 | Bouclier de feu (chaud), Armure d'Agathys |
| `robustesse` |  | §61 | sauvegarde à 0 PV, DD 5 + dégâts, pas sur un critique |
| `rodeur` |  | §26 §223 | Marque du chasseur, Frappe effroyable, Tueur de colosses, Tueur implacable, Chasseur précis |
| `roublard-choix` |  | §223 | Attaque sournoise au choix, activité de l'item |
| `roublard` |  | §20 | Attaque sournoise, Frappe malicieuse, Ruse, Visée appliquée, Esquive totale, Insaisissable, Assassinat |
| `sanctuaire` |  | §16 | le Zombi doit réussir une sauvegarde pour attaquer le Magicien |
| `sans-charge` |  | §77 | Nuage fétide du Dretch, le MJ lance quand même |
| `sans-opportunite` |  | §18.15 | Agile, Rôder |
| `saut` |  | §208 | longueur avec et sans élan, Bottes, atterrissage, chute automatique |
| `sauvegarde-repetee` |  | §16 §16.8 | Immobilisation de personne, fin de tour du Guerrier |
| `sauvegarde-zone` |  |  | Mains brûlantes sur un Zombi |
| `silence` |  | §37.4 §226 | effet porté dans la zone, entrée, sortie, fin |
| `sort-reactif` |  | §16.26 | Mage de guerre (interactif : choisir un sort dans la fenêtre) |
| `sorts-alara` |  | §16.47 | Invisibilité, Assistance, Stabilisation, Restauration partielle, Passage sans trace |
| `sorts-clerc-druide` |  |  | effets au niveau lancé, effets au choix, poison, retour à la vie |
| `sorts-codes` |  | §300 | Protection contre le mal et le bien, Lien de protection, Cécité/surdité, Tempête de neige, Aura de vitalité, Convocation de fée |
| `sorts-courants` |  | §283 | Sphère glacée d'Otiluke, Contamination, Lenteur (échec des sorts somatiques) |
| `sorts-couverts` |  |  | bonus, CA, vitesse, soins, dégâts, cibles |
| `sorts-lot-1` |  | §37.5 | Soins, Lueur d'espoir, Prière, Charme, Apaisement, Couteau de glace, Chauffer le métal, Épines, Vision |
| `sorts-lot-2` |  | §284 §208 | Danse d'Otto, Épine mentale, Aliénation, Prémonition (effets vides dans la donnée) |
| `sorts-lot-3` |  | §285 | Terreur, Mauvais œil, Confusion, Couronne du dément, Fou rire de Tasha (contrôle) |
| `sorts-lot-4` |  | §286 | Nuée de météores, Tempête de feu, Chaîne d'éclairs (zones multiples, cibles choisies) |
| `sorts-lot-5` |  | §287 | Rayon de soleil, Ténèbres qui dissipent les lumières de sort (lumières) |
| `sorts-lot-6` |  | §288 | Flèche de foudre, Dissipation du mal et du bien, Dédale, Coup au but (données du PHB) |
| `sorts-restants` |  |  | Représailles infernales, Vigueur arcanique, Foulée brumeuse |
| `sous-classes-ravenloft` |  | §95 | Patron Mort-vivant, Sorcellerie de l'ombre, Fantôme, Gardien creux |
| `soutien-intention` |  | §15.2 | avantage d'un allié, action préparée |
| `sphere-otiluke` |  | §232 | cible consentante, rien ne traverse |
| `succes-a-un-prix` | Arène du succès à un prix | §242 | attaque, pastille, pause, sauvegarde, jet demandé |
| `suivre` | keep | §41.3 | un token en suit un autre, la boucle refusée, l'ordre qui tombe |
| `taille` |  | §16.26 | Taille |
| `telekinesie` |  |  | Poussée télékinésique repousse le Zombi de 5 ft sur un échec |
| `tenaille` |  | §369 | Avantage de part et d'autre, pas sur des côtés voisins, ni avec un allié Neutralisé |
| `tenebres` |  | §16.31 | Ténèbres, Poussière d'étoile, Lumière du jour |
| `tentacules-reussite` |  |  | rien sur une sauvegarde réussie (Manuel et SRD) |
| `terrain-grele` |  | §261 | le terrain difficile reste jusqu'à la fin du prochain tour du lanceur |
| `theatre` |  | §220 | automatisations en pause, puis rétablies |
| `tours-de-magie` |  | §23 | Rayon de givre, Contact glacial, Éclat mental, Poigne électrique, Glas, Amitié, Frappe assurée |
| `traction` |  |  | Fouet d'épines attire le Zombi de 10 ft au toucher |
| `traduction-creation` |  | §204 | objets et créatures restés en anglais |
| `trait-ensorcele` |  | §16.43 | lien, action Bonus, rupture hors de portée |
| `troc-du-filou` |  | §38.2 | échange de place avec l'illusion, une fois par tour |
| `trousse-de-soins` |  | §50 | stabiliser une créature à 0 PV |
| `types-immunites` |  | §16.8 | pas un humanoïde, immunisé contre l'Épuisement, contre Empoisonné |
| `vague-destructrice` |  | §263 | les alliés du lanceur sont épargnés |
| `variantes-attaque` |  | §18.8 | charge, En sang, avantage |
| `vision-tenebres` |  | §62 | Ténèbres, Vision du diable, vision dans le noir, vision véritable, vision aveugle (Arène de la vision) |
| `vision-zones` |  |  | brume, Silence, murs (vue, son), vibrations et vol (Arène de la vision) |
| `vision` |  |  | non vu, invisible, aveuglé |
| `vol-menu` | keep | §238 | s'envoler et atterrir selon la Vitesse de vol |
| `zero-pv` |  | §17 | dégâts à 0 PV (échec), jet contre la mort au début du tour |
| `zone-duree` |  |  | Rayon de lune, fin de tour du Zombi dedans |
| `zone-soeur` |  | §16 §16.8 | Nuage nauséabond, début de tour du Guerrier dedans |
| `zone-sur-soi` |  | §47 | émanation posée sur le lanceur sans clic (Esprits gardiens) |

## `ravenloft/`

| Scénario | Scène | § | Ce qu'il vérifie |
|---|---|---|---|
| `benediction` |  | §16.25 | Bénédiction du Ténébreux |
| `brume-vampirique` |  | §105 | Forme brumeuse, Drain de vie, Caresse dévitalisante |
| `drain` |  | §18.16 §105 | Absorption de vie, Morsure du Vampire, Drain d'énergie |
| `fiches-2014` |  |  | Attaques multiples sans identifiant ou traduites, sauvegarde au toucher |
| `pj-quatre` |  | §65 | Échappée agile au choix, Eau bénite, Suggestion, Anneau de chaleur maudit |
