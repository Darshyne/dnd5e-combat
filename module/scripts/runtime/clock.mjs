/**
 * §251 : l'horloge en temps réel (réglage de monde `realTimeClock`, coupé par défaut). Le MJ actif avance le temps du monde hors
 * combat, une seconde par seconde réelle, par pas d'un round (core/clock.mjs) : arrêtée pendant la pause et en combat (le cœur y
 * compte déjà 6 s par round), effacée devant un module qui fait déjà tourner l'horloge (Simple Timekeeping, Simple Calendar,
 * Calendaria…). Le moteur ne fait que lire le temps du monde partout ailleurs ; c'est le seul endroit où il le fait avancer de lui-même.
 */
import { MODULE_ID } from "../constants.mjs";
import { clockHalt, clockTick, rivalClock } from "../core/clock.mjs";
import { route } from "./router.mjs";
import { isExecutor, log } from "./shared.mjs";

export const CLOCK_SETTING = "realTimeClock";
const TICK_MS = 1000;

let counted = null;
let halted = undefined;

const enabled = () => {
  try { return game.settings.get(MODULE_ID, CLOCK_SETTING) === true; } catch { return false; }
};

const rival = () => rivalClock(id => game.modules.get(id)?.active === true);

/** Pourquoi l'horloge du moteur ne tourne pas (null : elle tourne) — pour l'API et les scénarios. */
export function clockState() {
  return clockHalt({ enabled: enabled(), executor: isExecutor(), rival: rival(), paused: game.paused === true,
    inCombat: game.combats?.some?.(c => c.started) === true });
}

async function tick() {
  const halt = clockState();
  if ( halt !== halted ) {
    if ( halt === "rival" ) log(`real-time clock: left to ${rival()}`);
    else if ( (halt === null) || (halted === null) ) log(`real-time clock: ${halt === null ? "running" : `stopped (${halt})`}`);
    halted = halt;
  }
  if ( halt !== null ) { counted = null; return; }
  const step = clockTick(counted, Date.now());
  counted = step.counted;
  if ( step.advance > 0 ) await game.time.advance(step.advance);
}

export function registerClock() {
  game.settings.register(MODULE_ID, CLOCK_SETTING, {
    name: `DND5ECOMBAT.Reglage.${CLOCK_SETTING}.Nom`, hint: `DND5ECOMBAT.Reglage.${CLOCK_SETTING}.Aide`,
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => { counted = null; }
  });
  route("ready", () => {
    setInterval(() => tick().catch(err => console.error(`${MODULE_ID} | real-time clock`, err)), TICK_MS);
  }, { label: "real-time clock: not started" });
}
