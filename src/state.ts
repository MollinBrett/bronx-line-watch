import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alert } from "./mta.js";

/** What we've already announced: alert id -> fingerprint of the text we announced. */
export interface State {
  announced: Record<string, string>;
}

export function fingerprint(alert: Alert): string {
  return createHash("sha256").update(`${alert.type}\n${alert.header}`).digest("hex").slice(0, 16);
}

/**
 * Decide which alerts are new or materially changed, and the state to save afterwards.
 * Alerts that vanished from the candidates are forgotten, so a re-issued alert is announced again.
 */
export function planAnnouncements(
  candidates: Alert[],
  state: State,
): { toAnnounce: Alert[]; next: State } {
  const next: State = { announced: {} };
  const toAnnounce: Alert[] = [];
  for (const alert of candidates) {
    const fp = fingerprint(alert);
    next.announced[alert.id] = fp;
    if (state.announced[alert.id] !== fp) toAnnounce.push(alert);
  }
  return { toAnnounce, next };
}

/** Returns null when there is no state file yet (first run). */
export async function loadState(path: string): Promise<State | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as State;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path); // atomic: a crash mid-write never leaves a half-written file
}
