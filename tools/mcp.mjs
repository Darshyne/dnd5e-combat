#!/usr/bin/env node
// Appelle un tool du connecteur MCP universel par son transport HTTP (Streamable HTTP), sans
// dépendre de la liste d'outils figée d'une session Claude : l'extension de bureau embarque sa
// propre copie des définitions et ne voit pas les tools ajoutés depuis son empaquetage.
//
//   node tools/mcp.mjs <tool> '<json des paramètres>'      résultat sur stdout (JSON)
//   node tools/mcp.mjs --list                               noms des tools du serveur
//
// Le serveur doit tourner (lancer-connecteur.bat) et le monde être ouvert chez le MJ.
// Le client lui-même est dans lib/connector.mjs (partagé avec tools/scenario.mjs).

import { connect } from "./lib/connector.mjs";

const [tool, rawParams] = process.argv.slice(2);
if ( !tool ) {
  console.error("usage : node tools/mcp.mjs <tool> '<json>' | --list");
  process.exit(2);
}

try {
  const mcp = await connect();
  if ( tool === "--list" ) console.log((await mcp.list()).join("\n"));
  else {
    const result = await mcp.call(tool, rawParams ? JSON.parse(rawParams) : {});
    console.log((typeof result === "string") ? result : JSON.stringify(result, null, 2));
  }
} catch(err) {
  console.error(`mcp : ${err.message}`);
  process.exitCode = 1;
}
