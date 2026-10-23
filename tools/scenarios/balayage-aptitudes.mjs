/**
 * Balayage des dons, aptitudes de classe et de sous-classe et traits d'espèce du Manuel des joueurs qui ont une activité, dans l'« Arène
 * des sorts » (`tools/lib/balayage.mjs`). Prêtés au Lanceur (un PNJ sans classe) sans dépenser leurs utilisations : une aptitude dont
 * une formule cite son échelle de classe (`@scale.monk.die`) et qui échoue pour cela est notée « non jouée », pas en défaut. Ce qui ne
 * s'utilise pas (un don passif, une réaction déclenchée par le moteur) n'est pas couvert ici : ce sont les scénarios de règles.
 * Ne se joue que nommé : `node tools/scenario.mjs balayage-aptitudes`. Variables : `APTITUDES=lay-on-hands,second-wind`
 * (identifiants), `MOTEUR=1` (seulement celles que le moteur déclare), `DEPUIS=<identifiant>`, `PILE=1`.
 */
import { CONTENT } from "../../module/scripts/content/index.mjs";
import { sweep } from "../lib/balayage.mjs";
import { ARENE_SORTS } from "../lib/stages.mjs";

const only = (process.env.APTITUDES ?? "").split(",").filter(Boolean);
const PLAYED = new Set(["attack", "save", "damage", "heal", "utility", "enchant", "check"]);

export default {
  name: "balayage des dons et aptitudes du Manuel des joueurs (Arène des sorts)",
  scene: ARENE_SORTS.name,
  audit: true,
  run: ctx => sweep(ctx, {
    kind: "aptitudes",
    packs: ["dnd-players-handbook.feats", "dnd-players-handbook.classes", "dnd-players-handbook.origins"],
    select: d => {
      if ( d.type !== "feat" ) return false;
      const ident = d.system.identifier;
      if ( only.length ) return only.includes(ident);
      if ( process.env.MOTEUR && !CONTENT[ident] ) return false;
      return Object.values(d.system.activities ?? {}).some(a => PLAYED.has(a.type));
    },
    sortKey: d => `${d.system.requirements ?? ""}|${d.name}`,
    lend: {},
    consume: false
  })
};
