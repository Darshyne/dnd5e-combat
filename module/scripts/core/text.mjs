/**
 * Texte d'une description d'item (HTML de dnd5e) ramené à du texte simple, pour les règles qui lisent la phrase d'un bloc de
 * stats : entités, jets en ligne (`[[…]]` → « … »), renvois `&Reference[x]{…}` → « x », balises, espaces insécables,
 * apostrophe typographique. Fonction pure, sans Foundry.
 */
export const plainStatText = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…")
  .replace(/&Reference\[([^\]]+)\](?:\{[^}]*\})?/g, "$1").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/’/g, "'").replace(/\s+/g, " ");
