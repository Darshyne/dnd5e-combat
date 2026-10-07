/**
 * Macro (à lancer en MJ, moteur ≥ 0.170.0 actif) : remet en état les fiches de créatures importées au format 2014 ou réglées
 * pour CPR (SPEC §64, d'après l'inventaire du 2026-10-03).
 *
 * Ce qu'elle fait, sur les acteurs du monde (les tokens non liés suivent leur acteur) :
 *  - IDENTIFIANTS : une capacité traduite dont l'identifiant (ou, s'il est vide, le nom) donne un identifiant français que le
 *    moteur ne connaît pas reçoit l'identifiant anglais sous lequel il en tient les règles — Tactique de meute → `pack-tactics`,
 *    Esquive instinctive → `uncanny-dodge`, Ascendance féerique → `fey-ancestry`, Forme brumeuse (brume vampirique au format
 *    2014) → `misty-form` (§105 : partager la case d'une autre créature) ;
 *  - ACTIONS DE BASE : les copies CPR de Foncer, Se désengager, Esquiver, Aider, Se cacher, Se préparer d'un PNJ (activités
 *    utilitaires sans les règles du moteur : le déplacement n'est pas doublé, Se cacher ne pose pas la Furtivité) sont remplacées,
 *    une pour une, par les actions de base du moteur (`api.basics.data`). Une action qui porte déjà la marque du moteur n'est
 *    jamais touchée.
 * Deux choix : « Rapport » (ne modifie rien) ou « Réparer ». Compte rendu dans le chat, en message privé au MJ. Rejouable : ce qui
 * est déjà réparé n'est plus proposé.
 */
(async () => {
  if ( !game.user.isGM ) return ui.notifications.warn("Réparation des créatures : réservé au MJ.");
  const engine = game.modules.get("dnd5e-combat");
  const basics = engine?.active ? engine.api?.basics : null;
  if ( !basics?.data ) return ui.notifications.error("Réparation des créatures : le moteur dnd5e-combat 0.170.0 ou plus récent doit être actif.");

  const RENAMED = { "tactique-de-meute": "pack-tactics", "esquive-instinctive": "uncanny-dodge", "ascendance-feerique": "fey-ancestry",
    "forme-brumeuse": "misty-form" };
  // Les actions de base, par identifiant d'une copie CPR (anglais, ou tiré du nom français quand l'identifiant est vide).
  const BASIC = {
    dash: "dash", course: "dash", foncer: "dash",
    disengage: "disengage", desengagement: "disengage", "se-desengager": "disengage",
    dodge: "dodge", esquive: "dodge", esquiver: "dodge",
    help: "help", aider: "help",
    hide: "hide", "se-cacher": "hide",
    ready: "ready", preparer: "ready", "se-preparer": "ready"
  };
  const kebab = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const idOf = item => item.system?.identifier || kebab(item.name);
  const isEngineBasic = item => !!item.getFlag("dnd5e-combat", "basicAction");

  const rows = [];
  for ( const actor of game.actors ) {
    if ( !["npc", "character"].includes(actor.type) ) continue;
    for ( const item of actor.items ) {
      const id = idOf(item);
      if ( RENAMED[id] && (item.system.identifier !== RENAMED[id]) ) rows.push({ actor, item, kind: "rename", to: RENAMED[id] });
      else if ( (actor.type === "npc") && (item.type === "feat") && BASIC[id] && !isEngineBasic(item) ) {
        rows.push({ actor, item, kind: "basic", to: BASIC[id] });
      }
    }
  }

  const renames = rows.filter(r => r.kind === "rename").length;
  const mode = await foundry.applications.api.DialogV2.wait({
    window: { title: "Réparation des créatures" },
    content: `<p>${renames} capacité(s) à renommer pour le moteur ; ${rows.length - renames} action(s) de base CPR à remplacer par
      celles du moteur, sur ${new Set(rows.filter(r => r.kind === "basic").map(r => r.actor.id)).size} PNJ.</p><p>« Rapport » ne modifie rien.</p>`,
    buttons: [{ action: "report", label: "Rapport", default: true }, { action: "repair", label: "Réparer" }],
    rejectClose: false
  });
  if ( !mode ) return;

  const lines = [];
  let repaired = 0;
  for ( const row of rows ) {
    const where = `<b>${row.actor.name}</b> — ${row.item.name}`;
    const what = row.kind === "rename" ? `identifiant ${row.item.system.identifier || "(vide)"} → <code>${row.to}</code>`
      : `copie CPR → action de base du moteur (${row.to})`;
    if ( mode === "report" ) { lines.push(`<li>${where} : ${what}</li>`); continue; }
    try {
      if ( row.kind === "rename" ) await row.item.update({ "system.identifier": row.to });
      else {
        // Une seule action de base du moteur par sorte : une seconde copie CPR de la même action est seulement retirée.
        const has = row.actor.items.some(i => i.getFlag("dnd5e-combat", "basicAction") === row.to);
        if ( !has ) await row.actor.createEmbeddedDocuments("Item", [basics.data(row.to)]);
        await row.item.delete();
      }
      repaired++;
      lines.push(`<li>${where} : ${what}</li>`);
    } catch(err) {
      console.error("Réparation des créatures |", row.actor.name, row.item.name, err);
      lines.push(`<li>${where} : <b>échec</b> — ${err.message}</li>`);
    }
  }
  const head = (mode === "report")
    ? `<p><b>Réparation des créatures — rapport</b> : rien n'a été modifié.</p>`
    : `<p><b>Réparation des créatures</b> : ${repaired} réparation(s).</p>`;
  await ChatMessage.create({ content: `${head}<ul>${lines.join("") || "<li>Rien à signaler.</li>"}</ul>`, whisper: [game.user.id],
    speaker: { alias: "Réparation des créatures" } });
})();
