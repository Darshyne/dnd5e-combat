/**
 * O1 (SPEC §335) : un objet premium dont la donnée est fausse (coût d'une activité, charges, DD, dégâts, effet porté) est corrigé dès sa
 * création par le MJ actif, à `createItem` / `createActor` (pour un acteur : ses objets, créés avec lui sans `createItem`). Ce qui existe
 * déjà se corrige par le diagnostic (« Données premium corrigées »). Réglage de monde `dataFixes`.
 */
import { MODULE_ID } from "../constants.mjs";
import { dataFixPlanOf, applyDataFixes } from "../adapter/data-fixes.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export const DATA_FIXES_SETTING = "dataFixes";

const enabled = () => game.settings.get(MODULE_ID, DATA_FIXES_SETTING);

async function fix(items) {
  for ( const item of items ) {
    const plan = dataFixPlanOf(item);
    if ( !plan ) continue;
    await applyDataFixes(item, plan);
    log(`premium data fixed on creation: ${item.name} (${plan.fields.join(", ")})`);
  }
}

export function registerDataFixes() {
  game.settings.register(MODULE_ID, DATA_FIXES_SETTING, {
    name: `DND5ECOMBAT.Reglage.${DATA_FIXES_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${DATA_FIXES_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: true
  });
  const executor = { executor: true };
  route("createItem", (item, options) => ((enabled() && !options?.[MODULE_ID]?.dataFix) ? fix([item]) : null),
    { ...executor, label: "premium data: item not fixed on creation" });
  route("createActor", actor => (enabled() ? fix([...actor.items]) : null), { ...executor, label: "premium data: creature items not fixed on creation" });
}
