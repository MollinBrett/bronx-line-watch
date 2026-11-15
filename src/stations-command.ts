import type { Lang } from "./sms.js";
import { MAX_STATIONS, choicesForStops, findStation, type StationChoice } from "./stations.js";

/**
 * The STATIONS / ESTACIONES text command (#49): show, set, or clear a rider's stations.
 *
 * These are pure functions. Receiving texts and saving the result is the incoming-SMS
 * webhook's job (#16); until that exists nothing calls this in production.
 *
 * Safety: a reply is built only from our own wording and MTA station names from
 * src/bronx-stops.ts. Nothing the rider typed is ever copied into a reply, so a stranger
 * can't use this command to make our number send a link or a message of their choosing.
 */

export type StationsCommand =
  | { lang: Lang; action: "show" }
  | { lang: Lang; action: "clear" }
  | { lang: Lang; action: "set"; names: string[] };

/** Parse an incoming text. Returns null if it isn't a stations command. */
export function parseStationsCommand(body: string): StationsCommand | null {
  const m = /^\s*(stations|estaciones)\b[\s:]*(.*)$/isu.exec(body.normalize("NFKC"));
  if (!m) return null;
  const lang: Lang = m[1]!.toLowerCase() === "estaciones" ? "es" : "en";
  const rest = m[2]!.trim();
  if (!rest) return { lang, action: "show" };
  if (/^(all|todas?|todo)$/i.test(rest)) return { lang, action: "clear" };
  const names = rest.split(/[,;\n]+/).map((n) => n.trim()).filter(Boolean);
  return names.length ? { lang, action: "set", names } : { lang, action: "show" };
}

export interface StationsReply {
  /** The text to send back. Station names stay as the MTA writes them, in both languages. */
  reply: string;
  /** The rider's new stop IDs, `null` to clear them, or `undefined` to leave them as they are. */
  stations?: string[] | null;
}

const list = (choices: StationChoice[]): string => choices.map((c) => c.label).join(", ");

const COPY = {
  en: {
    showNone: `Bronx Line Watch: you get alerts for every Bronx station. To pick yours (up to ${MAX_STATIONS}), reply STATIONS and their names, like: STATIONS Fordham Rd 4, Parkchester`,
    show: (s: string) => `Bronx Line Watch: your stations: ${s}. To change, reply STATIONS and the names, or STATIONS ALL.`,
    saved: (s: string) => `Bronx Line Watch: saved. You'll get alerts for: ${s}. To change, reply STATIONS and the names, or STATIONS ALL.`,
    cleared: "Bronx Line Watch: done. You'll get alerts for every Bronx station again.",
    unknown: (n: number) => `Bronx Line Watch: nothing changed. We couldn't find station #${n} on your list among Bronx stations on the 2, 4, 5, 6, B or D. Check the name on the subway map and try again.`,
    ambiguous: (n: number, s: string) => `Bronx Line Watch: nothing changed. Station #${n} on your list could be: ${s}. Reply again with the line after the name, like: STATIONS Fordham Rd 4`,
    tooMany: `Bronx Line Watch: nothing changed. You can pick up to ${MAX_STATIONS} stations. Reply STATIONS with ${MAX_STATIONS} or fewer.`,
  },
  es: {
    showNone: `Bronx Line Watch: recibes alertas de todas las estaciones del Bronx. Para elegir las tuyas (hasta ${MAX_STATIONS}), responde ESTACIONES y sus nombres, por ejemplo: ESTACIONES Fordham Rd 4, Parkchester`,
    show: (s: string) => `Bronx Line Watch: tus estaciones: ${s}. Para cambiar, responde ESTACIONES y los nombres, o ESTACIONES TODAS.`,
    saved: (s: string) => `Bronx Line Watch: guardado. Vas a recibir alertas de: ${s}. Para cambiar, responde ESTACIONES y los nombres, o ESTACIONES TODAS.`,
    cleared: "Bronx Line Watch: listo. Vas a recibir alertas de todas las estaciones del Bronx otra vez.",
    unknown: (n: number) => `Bronx Line Watch: no cambiamos nada. No encontramos la estación #${n} de tu lista entre las estaciones del Bronx de las líneas 2, 4, 5, 6, B o D. Revisa el nombre en el mapa del subway e intenta otra vez.`,
    ambiguous: (n: number, s: string) => `Bronx Line Watch: no cambiamos nada. La estación #${n} de tu lista puede ser: ${s}. Responde otra vez con la línea después del nombre, por ejemplo: ESTACIONES Fordham Rd 4`,
    tooMany: `Bronx Line Watch: no cambiamos nada. Puedes elegir hasta ${MAX_STATIONS} estaciones. Responde ESTACIONES con ${MAX_STATIONS} o menos.`,
  },
} as const;

/** How many same-named options to spell out before the reply gets too long for a text. */
const MAX_OPTIONS_SHOWN = 4;

/**
 * Work out the reply to a stations command and what to save.
 * A list is saved only if every name on it is understood: a half-saved list would text
 * someone about the wrong stations without them knowing.
 */
export function answerStationsCommand(cmd: StationsCommand, current: readonly string[] | undefined): StationsReply {
  const copy = COPY[cmd.lang];
  if (cmd.action === "show") {
    const mine = choicesForStops(current ?? []);
    return { reply: mine.length ? copy.show(list(mine)) : copy.showNone };
  }
  if (cmd.action === "clear") return { reply: copy.cleared, stations: null };

  const picked: StationChoice[] = [];
  for (const [i, name] of cmd.names.entries()) {
    const found = findStation(name);
    if (found.kind === "unknown") return { reply: copy.unknown(i + 1) };
    if (found.kind === "ambiguous") {
      return { reply: copy.ambiguous(i + 1, list(found.options.slice(0, MAX_OPTIONS_SHOWN))) };
    }
    if (!picked.includes(found.station)) picked.push(found.station);
  }
  if (picked.length > MAX_STATIONS) return { reply: copy.tooMany };
  return { reply: copy.saved(list(picked)), stations: picked.flatMap((c) => c.stopIds) };
}
