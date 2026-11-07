import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alert } from "./mta.js";

/** What we've already announced: alert id -> fingerprint of the text we announced. */
export interface State {
  announced: Record<string, string>;
  /** Failed rewrites in a row, per alert, for the fingerprint they happened on (#65). */
  failures?: Record<string, { fp: string; n: number }>;
}

/**
 * How a rewrite failed. "permanent": Claude refused, hit max_tokens, or returned nothing
 * parseable - the same input will fail the same way, so retrying only spends money.
 * "transient": the call threw (network, overload, 5xx) - worth a few more tries.
 */
export type RewriteFailure = "permanent" | "transient";

/** Transient failures are retried on the next polls, up to this many attempts in total. */
export const MAX_REWRITE_ATTEMPTS = 5;

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
  const next: State = { announced: {}, failures: {} };
  const toAnnounce: Alert[] = [];
  for (const alert of candidates) {
    const fp = fingerprint(alert);
    next.announced[alert.id] = fp;
    if (state.announced[alert.id] !== fp) toAnnounce.push(alert);
    // Keep the failure count only while the alert text is unchanged; a new version starts over.
    const failed = state.failures?.[alert.id];
    if (failed?.fp === fp) next.failures![alert.id] = failed;
  }
  return { toAnnounce, next };
}

/**
 * After a failed rewrite, decide whether to try again on the next poll (#65). A permanent
 * failure is never retried; a transient one is retried until MAX_REWRITE_ATTEMPTS. Giving up
 * leaves the alert marked as announced - like a safety-blocked message - so it isn't retried
 * every minute; a changed alert (new fingerprint) gets a fresh start.
 */
export function afterRewriteFailure(
  next: State,
  alert: Alert,
  kind: RewriteFailure,
): { retry: boolean; attempts: number } {
  const fp = fingerprint(alert);
  next.failures ??= {};
  const prev = next.failures[alert.id];
  const attempts = (prev?.fp === fp ? prev.n : 0) + 1;
  next.failures[alert.id] = { fp, n: attempts };
  const retry = kind === "transient" && attempts < MAX_REWRITE_ATTEMPTS;
  if (retry) delete next.announced[alert.id]; // offered again on the next poll
  return { retry, attempts };
}

/** A successful rewrite clears the alert's failure count. */
export function clearRewriteFailures(next: State, alertId: string): void {
  delete next.failures?.[alertId];
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
