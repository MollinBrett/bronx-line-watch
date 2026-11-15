import { BRONX_STATIONS, type BronxStation } from "./bronx-stops.js";
import { BRONX_LINES } from "./filter.js";
import type { Alert } from "./mta.js";

/**
 * "My stations" (#49): a rider can name the stations they use and only hear about those.
 *
 * Privacy: a station list next to a phone number says roughly where someone lives and
 * works. Nothing in this file logs, and no error message here contains a rider's stations
 * or anything a rider typed.
 */

/** Most stations one rider can pick. Keeps confirmation texts short. */
export const MAX_STATIONS = 5;

/** The feed has express variants ("6X") that stop at stations listed under the local ("6"). */
function baseRoute(route: string): string {
  return route.endsWith("X") ? route.slice(0, -1) : route;
}

const COVERED_ROUTES = new Set([...BRONX_LINES].map(baseRoute));

/**
 * One station as a rider thinks of it: every platform group in the same MTA complex.
 * 149 St-Hostos is one choice, covering both the [2][5] stop and the [4] stop.
 */
export interface StationChoice {
  /** Exact MTA name plus its lines, e.g. "Fordham Rd (4)". The lines tell same-named stations apart. */
  label: string;
  name: string;
  stopIds: string[];
  routes: string[];
}

/** Stations a rider can pick: Bronx stations on a line this service covers. */
export const STATION_CHOICES: readonly StationChoice[] = (() => {
  const byComplex = new Map<string, BronxStation[]>();
  for (const s of BRONX_STATIONS) {
    if (!s.routes.some((r) => COVERED_ROUTES.has(r))) continue; // e.g. the [1], which we don't cover
    byComplex.set(s.complexId, [...(byComplex.get(s.complexId) ?? []), s]);
  }
  return [...byComplex.values()].map((group) => {
    const routes = [...new Set(group.flatMap((s) => s.routes))].sort();
    const name = group[0]!.name;
    return { label: `${name} (${routes.join(" ")})`, name, stopIds: group.map((s) => s.stopId), routes };
  });
})();

/**
 * Names riders still use after the MTA renamed a station. Keyed by the old name, pointing
 * at a stop ID of the station as it is listed today.
 */
const FORMER_NAMES: Record<string, string> = {
  "149 St-Grand Concourse": "222", // now 149 St-Hostos
};

const CHOICE_BY_STOP = new Map(STATION_CHOICES.flatMap((c) => c.stopIds.map((id) => [id, c] as const)));

/** The choice a stop ID belongs to, or undefined if it isn't a pickable Bronx station. */
export function choiceForStop(stopId: string): StationChoice | undefined {
  return CHOICE_BY_STOP.get(stopId);
}

/** The distinct stations behind a list of stop IDs, in first-seen order. Unknown IDs are skipped. */
export function choicesForStops(stopIds: readonly string[]): StationChoice[] {
  return [...new Set(stopIds.flatMap((id) => CHOICE_BY_STOP.get(id) ?? []))];
}

/**
 * Should a rider who picked these stations get this alert?
 * - The alert names stops: yes if one of them is theirs.
 * - The alert names no stops (line-wide): yes if one of their stations is on an affected line.
 */
export function alertReachesStations(alert: Pick<Alert, "routes" | "stops">, stopIds: readonly string[]): boolean {
  // Work with whole stations: one stop ID of a complex stands for all of its platforms.
  const mine = choicesForStops(stopIds);
  if (alert.stops.length > 0) return mine.some((c) => c.stopIds.some((id) => alert.stops.includes(id)));
  const affected = new Set(alert.routes.map(baseRoute));
  return mine.some((c) => c.routes.some((r) => affected.has(r)));
}

// ---------------------------------------------------------------------------------------
// Finding a station from what a rider typed

// A Map, not an object: riders type anything, and "constructor" must stay a plain word.
const WORDS = new Map(Object.entries({
  street: "st", streets: "sts", avenue: "av", ave: "av", road: "rd", boulevard: "blvd",
  parkway: "pkwy", square: "sq", east: "e", west: "w", mount: "mt", saint: "st",
  calle: "st", avenida: "av",
}));

/** Lowercase, drop accents and punctuation, and use the MTA's abbreviations ("149th Street" -> "149 st"). */
function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.replace(/^(\d+)(st|nd|rd|th)$/, "$1"))
    .map((t) => WORDS.get(t) ?? t);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

export type StationLookup =
  | { kind: "found"; station: StationChoice }
  | { kind: "ambiguous"; options: StationChoice[] }
  | { kind: "unknown" };

/**
 * Match what a rider typed to a Bronx station. Tries, in order: the exact name, a name
 * containing every word typed, then one small typo. A trailing line ("Fordham Rd 4",
 * "Fordham Rd D") picks between stations that share a name.
 */
export function findStation(typed: string): StationLookup {
  const want = tokens(typed);
  if (want.length === 0) return { kind: "unknown" };

  const named = [
    ...STATION_CHOICES.map((c) => ({ choice: c, name: tokens(c.name) })),
    ...Object.entries(FORMER_NAMES).map(([old, stopId]) => ({ choice: CHOICE_BY_STOP.get(stopId)!, name: tokens(old) })),
  ].map((n) => ({ ...n, lines: n.choice.routes.map((r) => r.toLowerCase()) }));
  const pick = (matches: StationChoice[], lines: string[] = []): StationLookup | null => {
    const found = [...new Set(matches)];
    if (found.length === 0) return null;
    if (found.length === 1) return { kind: "found", station: found[0]! };
    // "Gun Hill Rd 5" means the station served only by the [5], not the one on the [2][5].
    const only = found.filter((c) => c.routes.length === lines.length && c.routes.every((r) => lines.includes(r.toLowerCase())));
    return only.length === 1 ? { kind: "found", station: only[0]! } : { kind: "ambiguous", options: found };
  };

  // Words at the end that are line names narrow the search: "fordham rd b d" -> name "fordham rd", lines b, d.
  const attempts: { name: string[]; lines: string[] }[] = [{ name: want, lines: [] }];
  let split = want.length;
  while (split > 1 && COVERED_ROUTES.has(want[split - 1]!.toUpperCase())) split--;
  if (split < want.length) attempts.push({ name: want.slice(0, split), lines: want.slice(split) });

  for (const { name, lines } of attempts) {
    const onLines = named.filter((n) => lines.every((l) => n.lines.includes(l)));
    const exact = onLines.filter((n) => n.name.join(" ") === name.join(" "));
    const contains = onLines.filter((n) => name.every((t) => n.name.includes(t)));
    const result = pick(exact.map((n) => n.choice), lines) ?? pick(contains.map((n) => n.choice), lines);
    if (result) return result;
  }
  // One or two wrong letters ("Fordam Rd"). Only the name is compared, and a line the rider
  // gave still has to fit ("Fordam Rd 4"; never "Parkchester D"). Short names and names
  // with street numbers are skipped: "170 St" is one digit from "174 St".
  const { name, lines } = attempts.at(-1)!;
  const joined = name.join(" ");
  if (joined.length >= 7 && !/\d/.test(joined)) {
    const close = named.filter(
      (n) => lines.every((l) => n.lines.includes(l)) && editDistance(n.name.join(" "), joined) <= 2,
    );
    const result = pick(close.map((n) => n.choice), lines);
    if (result) return result;
  }
  return { kind: "unknown" };
}
