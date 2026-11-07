/**
 * §383 (issue #38) : la fenêtre « Choisir la forme » d'une invocation lancée sans la fenêtre de dnd5e (barre d'actions, manette).
 * Une carte par forme (image et nom de la créature, nom du profil quand il en a un — Vengeur / Défenseur), plus la taille ou le
 * type de créature quand l'activité en propose plusieurs. Un clic sur une carte invoque cette forme (s'il n'y a rien d'autre à
 * choisir) ; « Invoquer » prend la carte cochée. Elle s'ouvre sur l'écran de celui qui lance (le joueur chez lui, le MJ chez lui),
 * avec le sablier « en attente » au-dessus du lanceur pour la table (§381). L'interface demande ; runtime/summon-handover.mjs lance.
 *
 * §385 : pour « jusqu'à N » créatures (contenu `summon.chooseCount`, Création de morts-vivants), aussi le **nombre** (1 à N, N selon le
 * niveau) et, ouverte depuis la fiche, le **niveau** (les emplacements qui restent) — les formes permises et N suivent le niveau
 * (blêmes et nécrophages au niveau 8, momies au 9).
 */

import { loc, esc } from "../runtime/shared.mjs";
import { summonChoicesOf, summonCountAt, summonProfilesAt, castLevelsOf, preferredSummonUuid } from "../adapter/summons.mjs";
import { countChoices } from "../core/summon.mjs";
import { whileAwaiting } from "../adapter/awaiting.mjs";

/** Le libellé de dnd5e pour un profil (nom, sinon « FP x ou moins », sinon le nom de la créature ; « 2 × » devant un nombre). */
function profileLabel(activity, profile, rollData) {
  const dialog = globalThis.dnd5e?.applications?.activity?.SummonUsageDialog;
  try {
    if ( dialog?.prototype?.getProfileLabel ) return dialog.prototype.getProfileLabel.call({ activity }, profile, rollData);
  } catch(err) { /* repli ci-dessous */ }
  return profile.name || fromUuidSync(profile.uuid, { strict: false })?.name || "—";
}

/** Une forme : son id, son libellé, l'image et le nom de la créature (index du compendium, traduit par Babele s'il l'est). */
function formOf(activity, profile, rollData, { bare=false }={}) {
  // §386 : la créature réellement invoquée (Monster Manual 2024 plutôt que SRD 2014).
  const uuid = profile.uuid ? preferredSummonUuid(profile.uuid) : null;
  const actor = uuid ? fromUuidSync(uuid, { strict: false }) : null;
  // Sans nom de profil, celui de la créature réellement invoquée (Monster Manual, traduit par le MM-fr).
  const native = profileLabel(activity, profile, rollData);
  const times = /^\s*\d+\s*×\s*/.exec(native)?.[0] ?? "";
  let label = (!profile.name && actor?.name) ? `${times}${actor.name}` : native;
  // Le nombre se choisit à part : pas de « 3 × » devant le nom.
  if ( bare ) label = label.replace(/^\s*\d+\s*×\s*/, "");
  const creature = actor?.name ?? null;
  return { id: profile._id, label, creature: (creature && !label.includes(creature)) ? creature : null,
    img: actor?.img || activity.item?.img || "icons/svg/mystery-man.svg" };
}

function cardsHtml(forms, picked) {
  return forms.map(f => `
    <label class="dnd5e-combat-form${f.id === picked ? " picked" : ""}" data-profile="${esc(f.id)}" title="${esc(f.creature ?? f.label)}">
      <input type="radio" name="profile" value="${esc(f.id)}"${f.id === picked ? " checked" : ""} hidden>
      <img src="${esc(f.img)}" alt="">
      <span class="name">${esc(f.label)}</span>
      ${f.creature ? `<span class="cr">${esc(f.creature)}</span>` : ""}
    </label>`).join("");
}

function selectHtml(name, label, values, labels, current) {
  const options = values.map(v => `<option value="${esc(v)}"${String(v) === String(current) ? " selected" : ""}>${esc(labels[v]?.label ?? labels[v] ?? v)}</option>`).join("");
  return `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="${name}">${options}</select></div></div>`;
}

/**
 * Demande la forme. Rend `{ profile, creatureSize?, creatureType?, slot?, count? }`, ou null si l'on renonce (fenêtre fermée : rien
 * n'est lancé).
 * @param {Activity} activity  L'activité « summon » (copie mise à l'échelle comprise : les profils disponibles suivent le niveau).
 * @param {object} [current]   Ce que dnd5e a préparé (`usageConfig.summons`), coché d'avance.
 * @param {{ chooseCount?: boolean, countFormula?: string|null, chooseLevel?: boolean, slot?: string|null }} [options]  §385, §387.
 */
export async function askSummonForm(activity, current={}, { chooseCount=false, countFormula=null, chooseLevel=false, slot=null }={}) {
  const choices = summonChoicesOf(activity);
  const baseRollData = activity.getRollData?.() ?? {};
  const baseLevel = Number(activity.item?.system?.level) || 0;
  // Les niveaux proposés (depuis la fiche), sinon le niveau de l'emplacement déjà choisi (barre) ou celui du sort.
  const levels = chooseLevel ? castLevelsOf(activity) : [];
  const fixedLevel = Math.max(baseLevel, Number(activity.actor?.system?.spells?.[slot]?.level) || baseLevel);
  let level = levels.length ? levels[0].level : fixedLevel;
  let slotKey = levels.length ? levels[0].slot : null;
  const rollAt = lvl => ({ ...baseRollData, item: { ...(baseRollData.item ?? {}), level: lvl } });
  // §390 : une forme dont le nombre tombe à 0 à ce niveau (objet TG avec un modificateur d'incantation de 2) n'est pas proposée.
  const profilesAt = lvl => (chooseCount
    ? summonProfilesAt(activity, lvl).filter(p => summonCountAt(activity, p, lvl, countFormula) !== 0)
    : Array.from(activity.availableProfiles ?? []));
  if ( !profilesAt(level).length ) return null;

  let picked = profilesAt(level).some(p => p._id === current.profile) ? current.profile : profilesAt(level)[0]._id;
  const sizes = Array.from(activity.creatureSizes ?? []);
  const types = Array.from(activity.creatureTypes ?? []);
  const fixed = [
    choices.size ? selectHtml("creatureSize", loc("Invocation.Taille"), sizes, CONFIG.DND5E.actorSizes, current.creatureSize ?? sizes[0]) : "",
    choices.type ? selectHtml("creatureType", loc("Invocation.Type"), types, CONFIG.DND5E.creatureTypes, current.creatureType ?? types[0]) : ""
  ].join("");
  const levelHtml = (levels.length > 1)
    ? selectHtml("level", loc("Invocation.Niveau"), levels.map((l, i) => i),
      Object.fromEntries(levels.map((l, i) => [i, loc("Invocation.NiveauLibelle", { level: l.level, slot: l.label ?? "", left: l.left })])), 0)
    : "";

  /** Les cartes et le nombre au niveau courant. */
  const body = () => {
    const profiles = profilesAt(level);
    if ( !profiles.some(p => p._id === picked) ) picked = profiles[0]?._id ?? null;
    const forms = profiles.map(p => formOf(activity, p, rollAt(level), { bare: chooseCount }));
    const profile = profiles.find(p => p._id === picked);
    const counts = chooseCount ? countChoices(summonCountAt(activity, profile, level, countFormula)) : [];
    const countHtml = counts.length
      ? selectHtml("count", loc("Invocation.Nombre"), counts, {}, counts[counts.length - 1]) : "";
    return `<div class="dnd5e-combat-forms">${cardsHtml(forms, picked)}</div>${countHtml}`;
  };
  const quick = !choices.size && !choices.type && !chooseCount && !(levels.length > 1);
  const content = `<p class="hint">${esc(loc(quick ? "Invocation.ChoisirClic" : "Invocation.Choisir"))}</p>
    ${levelHtml}<div class="dnd5e-combat-summon-body">${body()}</div>${fixed}`;
  const read = form => {
    const data = new foundry.applications.ux.FormDataExtended(form).object;
    // Le nombre borné au maximum de la forme cochée à ce niveau (une forme changée sans clic garderait celui d'une autre).
    const max = chooseCount ? summonCountAt(activity, profilesAt(level).find(p => p._id === (data.profile || picked)), level, countFormula) : null;
    const count = (Number(data.count) > 0) ? (max ? Math.min(Number(data.count), max) : Number(data.count)) : null;
    return { profile: data.profile || picked, ...(choices.size ? { creatureSize: data.creatureSize } : {}),
      ...(choices.type ? { creatureType: data.creatureType } : {}),
      ...(slotKey ? { slot: slotKey } : {}), ...(count ? { count } : {}) };
  };
  const ask = () => foundry.applications.api.DialogV2.wait({
    window: { title: activity.item.name, icon: "fa-solid fa-spaghetti-monster-flying" },
    classes: ["dnd5e-combat-summon-form"],
    position: { width: Math.min(140 * Math.max(Array.from(activity.profiles ?? []).length, 2) + 60, 640) },
    content,
    buttons: [{ action: "summon", label: loc("Invocation.Invoquer"), icon: "fa-solid fa-spaghetti-monster-flying", default: true,
      callback: (event, button) => read(button.form) }],
    render: (event, dialog) => {
      const root = dialog.element;
      const wire = () => {
        for ( const card of root.querySelectorAll(".dnd5e-combat-form") ) {
          // Une forme cochée autrement que par un clic (clavier) : le nombre suit aussi.
          card.querySelector("input[type=radio]")?.addEventListener("change", () => {
            picked = card.dataset.profile;
            if ( chooseCount ) refresh();
          });
          card.addEventListener("click", () => {
            picked = card.dataset.profile;
            root.querySelectorAll(".dnd5e-combat-form").forEach(c => c.classList.toggle("picked", c === card));
            const radio = card.querySelector("input[type=radio]");
            if ( radio ) radio.checked = true;
            if ( quick ) return root.querySelector('button[data-action="summon"]')?.click();
            if ( chooseCount ) refresh();
          });
        }
      };
      const refresh = () => {
        const holder = root.querySelector(".dnd5e-combat-summon-body");
        if ( holder ) holder.innerHTML = body();
        wire();
      };
      root.querySelector('select[name="level"]')?.addEventListener("change", ev => {
        const chosen = levels[Number(ev.currentTarget.value)] ?? levels[0];
        level = chosen.level;
        slotKey = chosen.slot;
        refresh();
      });
      wire();
    },
    rejectClose: false
  }).catch(() => null);
  const answer = await whileAwaiting(activity.actor ?? null, "choice", ask);
  return (answer && (typeof answer === "object")) ? answer : null;
}
