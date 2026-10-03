/**
 * Actions de base du moteur posées par erreur sur les tas d'Item Piles (SPEC §16.60, le 2026-09-27).
 * Macro de monde, à lancer par le MJ, **une fois le moteur en 0.118.0 ou plus** (avant, il les reposerait au chargement).
 * Deux choix : « Rapport » n'écrit rien et rend le compte rendu dans le chat (chuchoté au MJ), « Retirer » nettoie.
 *
 * Avant la 0.118.0, le moteur donnait ses actions de base (Pointe, Désengagement, Esquive, S'échapper, Intention, Furtivité,
 * Chercher, Soutien, Attaque à mains nues) à tout acteur de type « character » — dont l'acteur par défaut d'Item Piles,
 * « Default Item Pile » (et tout acteur de tas de ce type). Un tas posé sur la carte en hérite : il les montre comme butin, et
 * Item Piles peut nommer le tas d'après l'une d'elles.
 *
 * Ne touche QU'aux items que le moteur a posés (`flags["dnd5e-combat"].basicAction`), et seulement sur les acteurs de tas
 * (`flags["item-piles"].data.enabled`) : acteurs du monde, puis tokens non liés de toutes les scènes (items recopiés dans
 * leur delta). Aucun autre acteur, aucun autre item.
 */
// « Rapport » n'écrit rien (compte rendu chuchoté au MJ) ; « Retirer » applique.
if ( !game.user.isGM ) return ui.notifications.warn("Actions de base des tas d'Item Piles : réservé au MJ.");
const choice = await foundry.applications.api.DialogV2.wait({
  window: { title: "Actions de base des tas d'Item Piles" },
  content: "<p>« Rapport » ne modifie rien.</p>",
  buttons: [{ action: "report", label: "Rapport", default: true }, { action: "apply", label: "Retirer" }],
  rejectClose: false
});
if ( !choice ) return;
const DRY = choice !== "apply";

const isPile = actor => actor?.flags?.["item-piles"]?.data?.enabled === true;
const isBasic = item => !!item.flags?.["dnd5e-combat"]?.basicAction;
const lines = [];
let total = 0;

async function clean(actor, where) {
  if ( !isPile(actor) ) return;
  const basics = actor.items.filter(isBasic);
  if ( !basics.length ) return;
  total += basics.length;
  lines.push(`<li><strong>${foundry.utils.escapeHTML(where)}</strong> : ${basics.map(i => foundry.utils.escapeHTML(i.name)).join(", ")}</li>`);
  if ( !DRY ) await actor.deleteEmbeddedDocuments("Item", basics.map(i => i.id));
}

// 1. Acteurs du monde (dont « Default Item Pile »).
for ( const actor of game.actors ) await clean(actor, `Acteur « ${actor.name} »`);

// 2. Tokens non liés : les items que le delta a recopiés (les autres viennent de l'acteur de base, déjà nettoyé).
for ( const scene of game.scenes ) {
  for ( const token of scene.tokens ) {
    if ( token.actorLink || !token.actor || !isPile(token.actor) ) continue;
    const own = new Set((token.delta?.items ?? []).map(i => i.id));
    const basics = token.actor.items.filter(i => isBasic(i) && own.has(i.id));
    if ( !basics.length ) continue;
    total += basics.length;
    lines.push(`<li><strong>${foundry.utils.escapeHTML(`Tas « ${token.name} », scène « ${scene.name} »`)}</strong> : ${basics.map(i => foundry.utils.escapeHTML(i.name)).join(", ")}</li>`);
    if ( !DRY ) await token.actor.deleteEmbeddedDocuments("Item", basics.map(i => i.id));
  }
}

const head = DRY ? "Rapport : rien n'a été modifié." : "Nettoyage fait.";
const body = total ? `<p>${total} action(s) de base ${DRY ? "à retirer" : "retirée(s)"} :</p><ul>${lines.join("")}</ul>`
  : "<p>Aucune action de base sur un tas d'Item Piles : rien à faire.</p>";
await ChatMessage.create({
  content: `<h3>Tas d'Item Piles — actions de base du moteur</h3><p>${head}</p>${body}`,
  whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id)
});
