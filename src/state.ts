import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { Alert } from "./mta.js";

/** What we've already announced: alert id -> fingerprint of the text we announced. */
export interface State {
  announced: Record<string, string>;
  /**
   * Failed rewrites in a row, per alert, for the fingerprint they happened on (#65).
   * n: all failures (sets the backoff). bad: the ones where Claude answered but the answer
   * was unusable. retryAt: unix seconds before which the alert is not tried again.
   */
  failures?: Record<string, { fp: string; n: number; bad?: number; retryAt?: number }>;
}

/**
 * How a rewrite failed.
 * "output": Claude answered, but refused, hit max_tokens, or returned nothing parseable. Each
 *   try costs a full call and the same alert tends to fail the same way, so it gets a few
 *   tries (a refusal or a bad sample can be a one-off) and is then given up.
 * "api": the call itself failed (network, overload, 5xx, rate or spend limit). Nothing was
 *   generated, and the alert is still news when the API comes back, so it is retried for as
 *   long as the alert is active - but with a growing wait, not every poll.
 */
export type RewriteFailure = "output" | "api";

/** An alert whose rewrite keeps coming back unusable is given up after this many tries. */
export const MAX_OUTPUT_ATTEMPTS = 3;

/** Wait before retry number n+1: 1, 2, 4, 8 minutes, then every 15. */
export const RETRY_BASE_SECONDS = 60;
export const RETRY_MAX_SECONDS = 15 * 60;

export function retryDelaySeconds(failures: number): number {
  return Math.min(RETRY_BASE_SECONDS * 2 ** (failures - 1), RETRY_MAX_SECONDS);
}

export function fingerprint(alert: Alert): string {
  return createHash("sha256").update(`${alert.type}\n${alert.header}`).digest("hex").slice(0, 16);
}

/**
 * Decide which alerts are new (or changed) since last tick, and build the next state.
 * Alerts that ended drop out of state automatically, so a recurrence is announced again.
 * An alert waiting out a retry delay is neither announced nor marked as announced.
 */
export function planAnnouncements(
  candidates: Alert[],
  state: State,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { toAnnounce: Alert[]; next: State } {
  const next: State = { announced: {}, failures: {} };
  const toAnnounce: Alert[] = [];
  for (const alert of candidates) {
    const fp = fingerprint(alert);
    // Keep the failure count only while the alert text is unchanged; a new version starts over.
    const failed = state.failures?.[alert.id];
    const sameVersion = failed?.fp === fp ? failed : undefined;
    if (sameVersion) next.failures![alert.id] = sameVersion;
    if (state.announced[alert.id] === fp) {
      next.announced[alert.id] = fp;
    } else if ((sameVersion?.retryAt ?? 0) > nowSeconds) {
      // Still due, but not yet: leave it unannounced so a later poll picks it up.
    } else {
      next.announced[alert.id] = fp;
      toAnnounce.push(alert);
    }
  }
  return { toAnnounce, next };
}

/**
 * After a failed rewrite, decide whether to try again (#65), so an alert Claude can't rewrite
 * doesn't cost a call every poll. Retries wait retryDelaySeconds(). An "api" failure is
 * retried until the alert ends; an "output" failure is given up after MAX_OUTPUT_ATTEMPTS.
 * Giving up leaves the alert marked as announced - like a safety-blocked message - and a
 * changed alert (new fingerprint) gets a fresh start.
 */
export function afterRewriteFailure(
  next: State,
  alert: Alert,
  kind: RewriteFailure,
  nowSeconds: number,
): { retry: boolean; attempts: number; retryInSeconds: number } {
  const fp = fingerprint(alert);
  next.failures ??= {};
  const prev = next.failures[alert.id]?.fp === fp ? next.failures[alert.id] : undefined;
  const attempts = (prev?.n ?? 0) + 1;
  const bad = (prev?.bad ?? 0) + (kind === "output" ? 1 : 0);
  const retry = kind === "api" || bad < MAX_OUTPUT_ATTEMPTS;
  const retryInSeconds = retry ? retryDelaySeconds(attempts) : 0;
  next.failures[alert.id] = { fp, n: attempts, bad, ...(retry && { retryAt: nowSeconds + retryInSeconds }) };
  if (retry) delete next.announced[alert.id]; // offered again once the wait is over
  else next.announced[alert.id] = fp; // given up: not offered again until the text changes
  return { retry, attempts, retryInSeconds };
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
