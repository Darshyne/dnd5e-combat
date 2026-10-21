/**
 * §225 : fait passer les tokens sélectionnés dans le plan Éthéré, ou les en fait revenir (l'état « Éthéré » de dnd5e, le même que dans
 * le menu des états du HUD du token). Un groupe mixte passe tout entier dans l'Éthéré.
 */
const api = game.modules.get("dnd5e-combat")?.api;
if ( !api?.ethereal?.toggle ) return ui.notifications.error(game.i18n.localize("DND5ECOMBAT.Diagnostic.MoteurRequis"));
if ( !canvas.tokens.controlled.length ) return ui.notifications.warn(game.i18n.localize("DND5ECOMBAT.Ethere.AucunToken"));
const done = await api.ethereal.toggle();
const names = list => list.map(r => r.name).join(", ");
const entered = done.filter(r => r.ethereal);
const left = done.filter(r => !r.ethereal);
if ( entered.length ) ui.notifications.info(game.i18n.format("DND5ECOMBAT.Ethere.Entre", { names: names(entered) }));
if ( left.length ) ui.notifications.info(game.i18n.format("DND5ECOMBAT.Ethere.Sort", { names: names(left) }));
