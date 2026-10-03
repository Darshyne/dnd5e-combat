/**
 * Client du connecteur MCP universel par son transport HTTP (Streamable HTTP), sans dépendre de
 * la liste d'outils figée d'une session Claude. Partagé par `tools/mcp.mjs` (un appel) et
 * `tools/scenario.mjs` (une suite d'appels). Le serveur doit tourner et le monde être ouvert chez
 * le MJ : c'est SON client qui exécute, avec le code du moteur qu'il a chargé (F5 après un pull).
 */

export const DEFAULT_URL = "http://localhost:31416/mcp";

export async function connect({ url=process.env.MCP_URL ?? DEFAULT_URL, client="dnd5e-combat-tests" }={}) {
  let sessionId = null;
  let nextId = 1;

  async function rpc(method, params, { notification=false }={}) {
    const body = { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
    if ( !notification ) body.id = nextId++;
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    if ( sessionId ) headers["Mcp-Session-Id"] = sessionId;
    let response;
    try { response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) }); }
    catch(err) { throw new Error(`connecteur injoignable sur ${url} (${err.cause?.code ?? err.message}) : lancer le serveur`); }
    sessionId ??= response.headers.get("mcp-session-id");
    if ( notification ) return null;
    const text = await response.text();
    if ( !response.ok ) throw new Error(`HTTP ${response.status} : ${text.slice(0, 300)}`);
    // Réponse JSON directe, ou flux SSE dont la dernière ligne « data: » porte la réponse.
    const payload = text.trimStart().startsWith("{") ? text
      : text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).pop();
    const message = JSON.parse(payload);
    if ( message.error ) throw new Error(`${message.error.code} ${message.error.message}`);
    return message.result;
  }

  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: client, version: "1" } });
  await rpc("notifications/initialized", undefined, { notification: true });

  return {
    /** Les noms des tools du serveur. */
    async list() {
      const { tools } = await rpc("tools/list", {});
      return tools.map(t => t.name);
    },

    /**
     * Appelle un tool. Rend l'objet JSON de la réponse (ou le texte brut). Une réponse en erreur
     * du tool lève, avec son texte.
     */
    async call(tool, args={}) {
      const result = await rpc("tools/call", { name: tool, arguments: args });
      const text = (result.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
      if ( result.isError ) throw new Error(`${tool} : ${text}`);
      try { return JSON.parse(text); }
      catch { return text; }
    }
  };
}
