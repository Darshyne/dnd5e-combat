/**
 * §397 : ouvre la fenêtre « Lancer un combat » de DAS · Core (MJ) — le jeu se met en pause, on choisit les participants et les surpris,
 * puis le combat commence et chacun lance son initiative. La même chose que le bouton « Lancer un combat » de la barre d'outils.
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !api?.combatLaunch?.open ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
if ( !game.user.isGM ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Lancement.MJ"));
await api.combatLaunch.open();
