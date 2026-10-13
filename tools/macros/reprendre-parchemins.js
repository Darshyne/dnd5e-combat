/**
 * Raccourci vers le diagnostic du monde de DAS · Core (SPEC §177), ouvert sur la vérification « parchemins de sort ».
 * La logique de cette macro vit désormais dans le module (runtime/diagnostic/checks.mjs, `scrolls`) : analyse sans rien écrire,
 * réparation de ce que le MJ coche, après une sauvegarde vérifiée dans le compendium « DAS · Sauvegardes » (restaurable).
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Diagnostic.MJSeul"));
if ( !api?.diagnostic?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
api.diagnostic.open({ check: "scrolls" });
