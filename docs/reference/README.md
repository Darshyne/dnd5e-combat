# Référence du moteur

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

Ces pages sont relues dans le code à chaque génération ; elles disent **ce qui existe**, pas pourquoi. Après avoir ajouté une
fonction d'API, un hook, un réglage, une entrée de contenu ou un scénario : `npm run reference`, et commiter le résultat.

| Page | Pour répondre à |
|---|---|
| [API.md](API.md) | que publie `api`, avec quels arguments, et où est le code ? (343 chemins) |
| [HOOKS.md](HOOKS.md) | quels hooks le moteur émet-il (38), lesquels écoute-t-il, et dans quel ordre ? |
| [SETTINGS.md](SETTINGS.md) | quel réglage porte cette clé, sa portée, son défaut, son onglet ? (125) |
| [CONTENT.md](CONTENT.md) | quels items utilisent telle clé du contenu, tel moment, telle action ? |
| [SCENARIOS.md](SCENARIOS.md) | quel scénario vérifie quoi, sur quelle scène ? |

`surface.json` : la liste nue des chemins d'API, des hooks émis, des moments (publiés en `dnd5e-combat.<moment>`) et des clés de
réglage — le contrat que les modules voisins vérifient dans leurs propres tests (`tools/contract/`).
