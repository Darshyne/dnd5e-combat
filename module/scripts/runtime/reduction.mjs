/**
 * Réduction et absorption de dégâts (SPEC §16.11, B14) : la réserve (Égide arcanique) sur `dnd5e.preApplyDamage`,
 * AVANT les 0 PV (runtime/death.mjs : ce qui est absorbé n'atteint pas la créature) — l'ordre des `register…()` de
 * dnd5e-combat.mjs le tient. L'Esquive instinctive (moitié des dégâts d'une attaque) est une réaction (core/action.mjs,
 * `halved`) ; le Lien protecteur, un partage sur `isDamaged` (runtime/triggers.mjs).
 */

import { MODULE_ID } from "../constants.mjs";
import { absorbDamage, spendPools, rechargePools } from "../adapter/absorb.mjs";
import { route } from "./router.mjs";
import { log } from "./shared.mjs";

export function registerReduction() {
  route("dnd5e.preApplyDamage", absorbDamage, { label: "réserve : dégâts non absorbés" });
  route("dnd5e.applyDamage", async (actor, amount, options) => {
    const pools = await spendPools(actor, options);
    for ( const p of pools ) log(`${p.name} : absorbe ${p.take} dégâts pour ${actor.name}`);
  }, { label: "réserve : dépense non écrite" });
  route("createChatMessage", async message => {
    if ( (message.type !== "usage") || message.getFlag(MODULE_ID, "areaTick") || message.getFlag(MODULE_ID, "resave") ) return;
    for ( const r of await rechargePools(message) ) log(`${r.name} : +${r.gained}`);
  }, { executor: true, label: "réserve : recharge non écrite" });
}
