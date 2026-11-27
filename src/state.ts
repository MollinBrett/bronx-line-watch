import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alert } from "./mta.js";

/**
 * What we've already announced, keyed by alert id. Times are Unix seconds.
 * `lastSeen` and `lastSent` are optional so a state file written before they existed still loads.
 */
export interface State {
  /** alert id -> fingerprint of the text we announced. */
  announced: Record<string, string>;
  /** alert id -> when the alert was last in the feed. */
  lastSeen?: Record<string, number>;
  /** alert id -> when we last announced it. */
  lastSent?: Record<string, number>;
}

/** What is in the state file: the state, plus the circuit breaker's memory (src/breaker.ts, #56). */
export type SavedState = State & { breaker?: unknown };

/** Limits on how much one poll may send (#40). */
export interface Limits {
  /** At most this many alerts are announced per poll; the rest wait for the next one. */
  maxPerTick: number;
  /** More new alerts than this in one poll is treated as a broken feed: nothing is sent. */
  floodAbove: number;
  /** The same alert id is not announced again sooner than this, even if its text changes. */
  minReannounceSeconds: number;
  /** An alert that left the feed is remembered this long, so a feed blip doesn't re-send it. */
  rememberSeconds: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxPerTick: 5,
  floodAbove: 10,
  minReannounceSeconds: 15 * 60,
  rememberSeconds: 6 * 60 * 60,
};

export function fingerprint(alert: Alert): string {
  return createHash("sha256").update(`${alert.type}\n${alert.header}`).digest("hex").slice(0, 16);
}

// Alert ids come from the feed. On an ordinary object, the id "__proto__" is never stored and
// reads back as Object.prototype, so that alert would look new on every poll (#96). These maps
// have no prototype, and reads go through own().
function emptyMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function own<T>(map: Record<string, T> | undefined, id: string): T | undefined {
  return map && Object.hasOwn(map, id) ? map[id] : undefined;
}

function emptyState(): Required<State> {
  return { announced: emptyMap(), lastSeen: emptyMap(), lastSent: emptyMap() };
}

/** Copy one alert's entries from `from` into `to`, with `lastSeen` set to `seen`. */
function carry(to: Required<State>, from: State, id: string, seen: number): void {
  const fp = own(from.announced, id);
  if (fp !== undefined) to.announced[id] = fp;
  to.lastSeen[id] = seen;
  const sent = own(from.lastSent, id);
  if (sent !== undefined) to.lastSent[id] = sent;
}

/**
 * Everything in the feed marked as already announced, and nothing to send: for the first run,
 * and for every poll while the watcher is paused (#56). Given the `previous` state, what it
 * remembers is kept, so an alert announced before a pause is not announced again after it.
 */
export function primed(candidates: Alert[], nowSeconds: number, previous?: State, limits: Limits = DEFAULT_LIMITS): State {
  const next = emptyState();
  for (const alert of candidates) {
    if (previous) carry(next, previous, alert.id, nowSeconds);
    next.announced[alert.id] = fingerprint(alert);
    next.lastSeen[alert.id] = nowSeconds;
  }
  if (previous) carryVanished(next, previous, nowSeconds, limits.rememberSeconds);
  return next;
}

/** Keep alerts that left the feed recently; forget the ones gone longer than `rememberSeconds`. */
function carryVanished(next: Required<State>, state: State, nowSeconds: number, rememberSeconds: number): void {
  for (const id of Object.keys(state.announced)) {
    if (Object.hasOwn(next.lastSeen, id)) continue; // still in the feed
    // A state file from before lastSeen existed: start the clock now.
    const seen = own(state.lastSeen, id) ?? nowSeconds;
    if (nowSeconds - seen < rememberSeconds) carry(next, state, id, seen);
  }
}

/**
 * Decide which alerts are new or materially changed, and the state to save afterwards.
 *
 * - An alert that left the feed is remembered for a while, so one bad poll doesn't re-send it.
 * - The same alert id is not announced twice within `minReannounceSeconds`; a change in that
 *   window is announced once the window is over.
 * - At most `maxPerTick` alerts are announced per poll. `deferred` counts the ones left for later.
 * - More than `floodAbove` new alerts at once is a `flood`: nothing is sent and they are all
 *   marked as announced, the same way the first run is handled.
 */
export function planAnnouncements(
  candidates: Alert[],
  state: State,
  nowSeconds: number,
  limits: Limits = DEFAULT_LIMITS,
): { toAnnounce: Alert[]; next: State; deferred: number; flood: boolean } {
  const next = emptyState();
  const fresh: Alert[] = [];
  for (const alert of candidates) {
    carry(next, state, alert.id, nowSeconds);
    if (own(state.announced, alert.id) === fingerprint(alert)) continue; // already announced
    const sent = own(state.lastSent, alert.id);
    if (sent !== undefined && nowSeconds - sent < limits.minReannounceSeconds) continue; // too soon
    fresh.push(alert);
  }
  carryVanished(next, state, nowSeconds, limits.rememberSeconds);

  if (fresh.length > limits.floodAbove) {
    for (const alert of fresh) next.announced[alert.id] = fingerprint(alert);
    return { toAnnounce: [], next, deferred: 0, flood: true };
  }

  // Alerts over the cap keep their old entry (or none), so they are still new on the next poll.
  const toAnnounce = fresh.slice(0, limits.maxPerTick);
  for (const alert of toAnnounce) {
    next.announced[alert.id] = fingerprint(alert);
    next.lastSent[alert.id] = nowSeconds;
  }
  return { toAnnounce, next, deferred: fresh.length - toAnnounce.length, flood: false };
}

/** Forget an alert completely, so the next poll treats it as new. */
export function forget(state: State, id: string): void {
  delete state.announced[id];
  if (state.lastSeen) delete state.lastSeen[id];
  if (state.lastSent) delete state.lastSent[id];
}

/** A copy of `state` without the given alert ids. */
export function without(state: State, ids: Iterable<string>): State {
  const copy: State = {
    announced: Object.assign(emptyMap<string>(), state.announced),
    lastSeen: Object.assign(emptyMap<number>(), state.lastSeen),
    lastSent: Object.assign(emptyMap<number>(), state.lastSent),
  };
  for (const id of ids) forget(copy, id);
  return copy;
}

/** Returns null when there is no state file yet (first run). */
export async function loadState(path: string): Promise<SavedState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SavedState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveState(path: string, state: SavedState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path); // atomic: a crash mid-write never leaves a half-written file
}
