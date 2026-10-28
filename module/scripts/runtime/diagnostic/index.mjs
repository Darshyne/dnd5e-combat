/**
 * Le diagnostic du monde (SPEC §177) : analyser (rien n'est écrit), puis réparer ce que le MJ a coché — après une sauvegarde
 * vérifiée de chaque document touché. Si la sauvegarde échoue ou est incomplète, rien n'est modifié. Chaque tâche est réparée
 * seule : une erreur n'arrête pas les suivantes et se lit dans le compte rendu. Une sauvegarde se restaure (backup.mjs).
 */
import { MODULE_ID } from "../../constants.mjs";
import { uniqueRoots } from "../../core/backup.mjs";
import { CHECKS } from "./checks.mjs";
import { createBackup, listBackups, restoreBackup } from "./backup.mjs";
import { loc, log } from "../shared.mjs";

let busy = false;

/** Analyse : `{ [checkId]: tâches }`. Chaque tâche reçoit un id stable pour cette analyse. N'écrit rien. */
export async function scanWorld(ids=null) {
  if ( !game.user.isGM ) throw new Error("only a GM can run the diagnostic");
  const out = {};
  for ( const check of CHECKS ) {
    if ( ids && !ids.includes(check.id) ) continue;
    try {
      out[check.id] = (await check.scan()).map((task, i) => ({ ...task, check: check.id, id: `${check.id}.${i}` }));
    } catch(err) {
      console.error(`${MODULE_ID} | diagnostic ${check.id}`, err);
      out[check.id] = [{ check: check.id, id: `${check.id}.error`, where: "", text: loc("Diagnostic.AnalyseEchec", { error: err.message }) }];
    }
  }
  return out;
}

/**
 * Répare ces tâches. Rend `{ backup, results: [{ task, ok, line }] }`. Lève si la sauvegarde n'a pas pu être faite (rien n'a
 * alors été modifié). `options` : `{ [checkId]: { [optionId]: valeur } }`, les options d'une vérification (`check.options`),
 * passées à l'`apply` de chacune de ses tâches.
 */
export async function repairTasks(tasks, options={}) {
  if ( !game.user.isGM ) throw new Error("only a GM can repair");
  if ( busy ) throw new Error(loc("Diagnostic.Occupe"));
  const todo = tasks.filter(t => typeof t.apply === "function" && t.root);
  if ( !todo.length ) return { backup: null, results: [] };
  busy = true;
  try {
    const backup = await createBackup(uniqueRoots(todo), { label: loc("Diagnostic.Titre"), checks: [...new Set(todo.map(t => t.check))] });
    const results = [];
    for ( const task of todo ) {
      try {
        results.push({ task, ok: true, line: await task.apply(options[task.check] ?? {}) });
      } catch(err) {
        console.error(`${MODULE_ID} | repair ${task.id}`, err);
        results.push({ task, ok: false, line: loc("Diagnostic.ReparationEchec", { error: foundry.utils.escapeHTML(err.message) }) });
      }
    }
    log(`diagnostic: ${results.filter(r => r.ok).length}/${results.length} repaired, backup ${backup.name}`);
    return { backup, results };
  } finally {
    busy = false;
  }
}

/** Restaure une sauvegarde (après en avoir fait une de l'état actuel). */
export async function restore(uuid) {
  if ( busy ) throw new Error(loc("Diagnostic.Occupe"));
  busy = true;
  try { return await restoreBackup(uuid); }
  finally { busy = false; }
}

export { CHECKS, listBackups };
