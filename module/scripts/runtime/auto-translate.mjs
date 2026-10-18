/**
 * §204 : un objet ou un acteur créé depuis un compendium traduit (Babele) prend tout de suite la traduction de ce qui est resté
 * dans la langue d'origine — ce que le diagnostic « Textes restés dans la langue d'origine » répare après coup (§203). Cas vus :
 * un joueur sans droit de parcourir les fichiers (Babele ne traduit rien chez lui), un client réglé dans une autre langue, une
 * traduction qui ne traduit pas les noms d'effets (« Projectile percutant », enchantement « Walloping Ammunition »).
 *
 * Fait par le MJ actif, dans la langue de son client, à `createItem` / `createActor` (pour un acteur : lui et ses objets, créés
 * avec lui sans `createItem`). Même règle que le diagnostic (adapter/retranslate.mjs) : seuls les textes encore identiques à
 * l'original changent ; identifiants et ids d'activités et d'effets ne bougent pas. Réglage de monde `autoTranslate`.
 */
import { MODULE_ID } from "../constants.mjs";
import { referenceReader, retranslationOf, applyRetranslation, sourceOf } from "../adapter/retranslate.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const AUTO_TRANSLATE_SETTING = "autoTranslate";

const enabled = () => !!game.babele && game.settings.get(MODULE_ID, AUTO_TRANSLATE_SETTING);

async function retranslate(docs) {
  const reference = referenceReader();
  for ( const doc of docs ) {
    const plan = await retranslationOf(doc, reference);
    if ( !plan.fields.length ) continue;
    await applyRetranslation(doc, plan);
    log(`translation applied on creation: ${doc.name} (${[...new Set(plan.fields)].join(", ")})`);
  }
}

function onCreateItem(item) {
  if ( !enabled() ) return;
  // Sans source propre ni fiche venue d'un compendium : rien à reprendre (lecture évitée pour les objets faits main).
  if ( !sourceOf(item) && !sourceOf(item.parent) ) return;
  return retranslate([item]);
}

function onCreateActor(actor) {
  if ( !enabled() ) return;
  if ( !sourceOf(actor) && !actor.items.some(i => sourceOf(i)) ) return;
  return retranslate([actor, ...actor.items]);
}

export function registerAutoTranslate() {
  game.settings.register(MODULE_ID, AUTO_TRANSLATE_SETTING, {
    name: `DND5ECOMBAT.Reglage.${AUTO_TRANSLATE_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${AUTO_TRANSLATE_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  const executor = { executor: true };
  route("createItem", onCreateItem, { ...executor, label: "translation on creation: item left in the original language" });
  route("createActor", onCreateActor, { ...executor, label: "translation on creation: creature left in the original language" });
}
