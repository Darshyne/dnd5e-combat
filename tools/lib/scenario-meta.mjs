/**
 * Ce qu'on sait d'un scénario sans le charger, lu dans son texte : son titre (`name`), sa scène (`scene`), son commentaire
 * d'en-tête et les § du journal qu'ils citent. Sert à la référence (`docs/reference/SCENARIOS.md`) et aux filtres du
 * lanceur (`node tools/scenario.mjs --list --grep zone`).
 */

/** `{ title, summary, doc, scene, refs }` d'après le texte d'un fichier de scénario. */
export function scenarioMeta(text) {
  const header = text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  const doc = header ? header[1].split("\n").map(line => line.replace(/^\s*\*?\s?/, "")).join(" ").replace(/\s+/g, " ").trim() : "";
  const named = text.match(/\bname:\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/);
  const title = (named?.[1] ?? named?.[2] ?? "").replace(/\\"/g, "\"");
  const scene = text.match(/\bscene:\s*"([^"]+)"/)?.[1] ?? "";
  const refs = [...new Set(`${doc} ${title}`.match(/§\d+(?:\.\d+)*/g) ?? [])];
  const summary = title.includes("—") ? title.slice(title.indexOf("—") + 1).trim() : (title || doc);
  return { title, summary, doc, scene, refs };
}

/** Minuscules sans accents, pour chercher « zone » dans « Zône » comme dans « zones ». */
export const plain = text => String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Un scénario passe-t-il les filtres ? `words` : il suffit d'un mot trouvé dans son nom de fichier, son titre ou son en-tête ;
 * `sections` : il cite l'un de ces § (« 239 » vaut pour §239 et §239.x) ; `scenes` : sa scène est l'une d'elles (« arene » : aucune
 * scène déclarée). Chaque famille de filtres donnée doit être satisfaite.
 */
export function matches(id, meta, { words=[], sections=[], scenes=[] }={}) {
  const haystack = plain(`${id} ${meta.title} ${meta.doc}`);
  if ( words.length && !words.some(word => haystack.includes(plain(word))) ) return false;
  if ( sections.length && !sections.some(section => meta.refs.some(ref => (ref === `§${section}`) || ref.startsWith(`§${section}.`))) ) return false;
  if ( scenes.length && !scenes.some(scene => (plain(scene) === "arene") ? !meta.scene : plain(meta.scene).includes(plain(scene))) ) return false;
  return true;
}
