/**
 * §86 : une zone que le contenu fait poser d'office (`selfZone`, par id d'activité). Présence royale de Yolande (« Surround Self »)
 * et Invocation d'êtres sylvestres (« Cast ») ont bien une émanation de 10 ft — héritée de la cible de l'item (`override: false`) —,
 * mais `target.prompt` est faux : dnd5e ne prévoit aucune pose (`create.measuredTemplate`, activity/mixin.mjs:451), donc ni zone ni
 * rejeu. Le contenu dit « pose-la » et donne le gabarit, qui ne sert que si la donnée n'en a pas. §91 : une activité qui n'est pas de
 * portée personnelle (Interdiction, au contact) fait poser ce gabarit à la souris (runtime/self-area.mjs, `withTemplate`). Lu par la pose sur soi
 * (adapter/self-area.mjs, runtime/self-area.mjs), la tranche d'élévation et la sphère (adapter/space.mjs), le plan (adapter/usage.mjs).
 */

import { contentOf } from "./content.mjs";

/** Le gabarit que le contenu déclare pour cette activité, ou null. */
function declaredZone(activity) {
  return activity?.item ? (contentOf(activity.item).entry?.selfZone?.[activity.id] ?? null) : null;
}

/**
 * Le gabarit de l'activité : celui de la donnée s'il a un type, sinon celui que le contenu déclare.
 * @param {Activity} activity
 * @returns {{type: string, size?: number, width?: number, height?: number, units?: string, count?: number|string,
 *   stationary?: boolean}|null}
 */
export function templateOf(activity) {
  const own = activity?.target?.template;
  if ( own?.type ) return own;
  const declared = declaredZone(activity);
  return declared ? { count: 1, ...declared } : null;
}

/**
 * §91 : l'activité vue avec le gabarit fourni — pour la pose à la souris de dnd5e (`TemplatePlacement.fromActivity`, qui ne lit
 * que `target.template`, l'item, l'uuid, `getRollData` et `getUsageToken`). Rien n'est écrit : un mandataire en lecture.
 * @param {Activity} activity
 * @returns {Activity}
 */
export function withTemplate(activity) {
  const target = { ...activity.target, template: templateOf(activity) };
  return new Proxy(activity, {
    get(object, key) {
      if ( key === "target" ) return target;
      const value = Reflect.get(object, key, object);
      return (typeof value === "function") ? value.bind(object) : value;
    }
  });
}

/** Le contenu fait-il poser la zone de cette activité d'office, que dnd5e la prévoie ou non ? */
export function suppliesTemplate(activity) {
  return !!declaredZone(activity);
}
