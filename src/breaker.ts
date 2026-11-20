import { z } from "zod";
import { DEFAULT_LIMITS } from "./state.js";

/**
 * The circuit breaker (#56). The watcher counts what it spends and what it sends. When a count
 * would pass its limit, the breaker trips: the watcher pauses itself and stays paused, across
 * restarts too, until a person resumes it. Paused is the safe state.
 *
 * Nothing in this file touches the network or the disk. main.ts asks it before every Claude
 * call and before every alert goes out, and keeps its memory in the state file.
 */

/** Limits that trip the breaker. */
export interface Caps {
  /** Claude calls in any hour. A call the API turned away with an error is not counted: it isn't billed. */
  claudeCallsPerHour: number;
  /** Texts in any hour, over all subscribers. */
  textsPerHour: number;
  /** Texts in any 24 hours, over all subscribers. */
  textsPerDay: number;
  /** Messages in a row blocked by the safety check. It could be someone probing for a way past it. */
  safetyBlocksInARow: number;
}

export interface BreakerSettings extends Caps {
  /** Why PAUSED switches sending off, or null when it doesn't. */
  paused: string | null;
  /** At most this many alerts are announced per poll. The rest wait for the next one: not a trip. */
  alertsPerPoll: number;
  /** RESUME_AFTER_TRIP: the code of the one trip a person has decided to resume from. */
  resumeCode: string | null;
}

/**
 * The default text limits are per subscriber, since one alert is one text to each of them.
 * The busiest week measured on the English channel (Nov 12-19, 2026) had at most 12 alerts in an
 * hour and 78 in 24 hours: these are about twice and one and a half times that.
 */
export const TEXTS_PER_SUBSCRIBER = { hour: 24, day: 120 };
/** About twice the busiest hour measured (12 alerts, so at least 12 Claude calls). */
export const DEFAULT_CLAUDE_CALLS_PER_HOUR = 30;
export const DEFAULT_SAFETY_BLOCKS_IN_A_ROW = 3;
/** The alert to the operators is tried on this many polls, then given up on. */
export const MAX_ALERT_TRIES = 30;

/**
 * PAUSED is the switch a person flips. Only a clear "off" value leaves the watcher running:
 * a typo while trying to pause must never leave it sending.
 */
export function pausedBy(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (["", "false", "0", "no", "off"].includes(value)) return null;
  if (["true", "1", "yes", "on"].includes(value)) return "PAUSED is set";
  return "PAUSED is set to something that is not true or false, so it counts as true";
}

function wholeNumber(name: string, raw: string | undefined, fallback: number): number {
  const value = (raw ?? "").trim();
  if (value === "") return fallback;
  if (!/^\d{1,9}$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a whole number, 1 or more; got "${value.slice(0, 20)}"`);
  }
  return Number(value);
}

/** POLL_SECONDS. Blank means the default; anything under 10 seconds would hammer the feed in a loop. */
export function pollSecondsFromEnv(raw: string | undefined): number {
  const value = (raw ?? "").trim();
  if (value === "") return 60;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 10) {
    throw new Error(`POLL_SECONDS must be a number of seconds, 10 or more; got "${value.slice(0, 20)}"`);
  }
  return seconds;
}

/** The breaker's settings. `subscribers` sets the default text limits; a limit that is set is a total. */
export function breakerSettingsFromEnv(subscribers: number, env = process.env): BreakerSettings {
  const {
    PAUSED,
    RESUME_AFTER_TRIP,
    MAX_ALERTS_PER_POLL,
    MAX_CLAUDE_CALLS_PER_HOUR,
    MAX_TEXTS_PER_HOUR,
    MAX_TEXTS_PER_DAY,
    MAX_SAFETY_BLOCKS_IN_A_ROW,
  } = env;
  const people = Math.max(subscribers, 1);
  return {
    paused: pausedBy(PAUSED),
    resumeCode: RESUME_AFTER_TRIP?.trim() || null,
    alertsPerPoll: wholeNumber("MAX_ALERTS_PER_POLL", MAX_ALERTS_PER_POLL, DEFAULT_LIMITS.maxPerTick),
    claudeCallsPerHour: wholeNumber("MAX_CLAUDE_CALLS_PER_HOUR", MAX_CLAUDE_CALLS_PER_HOUR, DEFAULT_CLAUDE_CALLS_PER_HOUR),
    textsPerHour: wholeNumber("MAX_TEXTS_PER_HOUR", MAX_TEXTS_PER_HOUR, TEXTS_PER_SUBSCRIBER.hour * people),
    textsPerDay: wholeNumber("MAX_TEXTS_PER_DAY", MAX_TEXTS_PER_DAY, TEXTS_PER_SUBSCRIBER.day * people),
    safetyBlocksInARow: wholeNumber("MAX_SAFETY_BLOCKS_IN_A_ROW", MAX_SAFETY_BLOCKS_IN_A_ROW, DEFAULT_SAFETY_BLOCKS_IN_A_ROW),
  };
}

const REASONS = ["texts-per-hour", "texts-per-day", "claude-calls-per-hour", "safety-blocks", "unreadable-memory"] as const;
export type TripReason = (typeof REASONS)[number];

const whole = z.number().int().nonnegative();
/** Counts in buckets of time: bucket number -> count. */
const Buckets = z.record(z.string().regex(/^\d{1,12}$/), whole);

const TripSchema = z.object({
  /** When it tripped, Unix seconds. Also the code a person gives to resume. */
  at: whole,
  reason: z.enum(REASONS),
  /** What had been counted when it tripped. */
  count: whole,
  /** What was about to be added to it. */
  wanted: whole,
  limit: whole,
  /** Whether the operators have been told, and how many times that was tried. */
  alerted: z.boolean(),
  alertTries: whole,
});
export type Trip = z.infer<typeof TripSchema>;

const BreakerSchema = z.object({
  tripped: TripSchema.optional(),
  /** Claude calls, per minute. */
  claudeCalls: Buckets,
  /** Texts, per minute (for the hourly limit) and per hour (for the daily one). */
  texts: Buckets,
  textsByHour: Buckets,
  /** How many messages in a row the safety check has blocked. */
  safetyBlocks: whole,
});
/** The breaker's memory, saved in the state file as `breaker`. */
export type Breaker = z.infer<typeof BreakerSchema>;

export function freshBreaker(): Breaker {
  return { claudeCalls: {}, texts: {}, textsByHour: {}, safetyBlocks: 0 };
}

/**
 * A rolling total kept in buckets. "The last hour" is the 60 one-minute buckets before the
 * current one, plus the current one: between 60 and 61 minutes, never less than an hour.
 */
interface Span {
  bucketSeconds: number;
  buckets: number;
}
const HOUR: Span = { bucketSeconds: 60, buckets: 60 };
const DAY: Span = { bucketSeconds: 60 * 60, buckets: 24 };

const bucketOf = (span: Span, nowSeconds: number) => Math.floor(nowSeconds / span.bucketSeconds);

/** A bucket dated in the future (the clock went back) still counts: when unsure, count more. */
function total(counts: Record<string, number>, span: Span, nowSeconds: number): number {
  const oldest = bucketOf(span, nowSeconds) - span.buckets;
  let sum = 0;
  for (const [bucket, n] of Object.entries(counts)) if (Number(bucket) >= oldest) sum += n;
  return sum;
}

function add(counts: Record<string, number>, span: Span, nowSeconds: number, n: number): void {
  const oldest = bucketOf(span, nowSeconds) - span.buckets;
  for (const bucket of Object.keys(counts)) if (Number(bucket) < oldest) delete counts[bucket];
  if (n === 0) return;
  const current = String(bucketOf(span, nowSeconds));
  counts[current] = Math.max(0, (counts[current] ?? 0) + n);
}

function trip(b: Breaker, reason: TripReason, count: number, wanted: number, limit: number, nowSeconds: number): void {
  b.tripped ??= { at: nowSeconds, reason, count, wanted, limit, alerted: false, alertTries: 0 };
}

/**
 * Ask before one Claude call. True: it fits under the limit and is now counted.
 * False: the breaker has tripped (now or earlier) and the call must not be made.
 */
export function allowClaudeCall(b: Breaker, caps: Caps, nowSeconds: number): boolean {
  if (b.tripped) return false;
  const used = total(b.claudeCalls, HOUR, nowSeconds);
  if (used + 1 > caps.claudeCallsPerHour) {
    trip(b, "claude-calls-per-hour", used, 1, caps.claudeCallsPerHour, nowSeconds);
    return false;
  }
  add(b.claudeCalls, HOUR, nowSeconds, 1);
  return true;
}

/** Take back the count for a Claude call the API turned away, at the same `nowSeconds` it was allowed. */
export function claudeCallNotBilled(b: Breaker, nowSeconds: number): void {
  add(b.claudeCalls, HOUR, nowSeconds, -1);
}

/**
 * Ask before sending one alert as `n` texts. True: they fit under both limits and are now
 * counted, whether or not every send then succeeds. False: the breaker has tripped and none of
 * them may be sent. An alert goes to everyone or to no one.
 */
export function allowTexts(b: Breaker, caps: Caps, n: number, nowSeconds: number): boolean {
  if (b.tripped) return false;
  const hour = total(b.texts, HOUR, nowSeconds);
  if (hour + n > caps.textsPerHour) {
    trip(b, "texts-per-hour", hour, n, caps.textsPerHour, nowSeconds);
    return false;
  }
  const day = total(b.textsByHour, DAY, nowSeconds);
  if (day + n > caps.textsPerDay) {
    trip(b, "texts-per-day", day, n, caps.textsPerDay, nowSeconds);
    return false;
  }
  add(b.texts, HOUR, nowSeconds, n);
  add(b.textsByHour, DAY, nowSeconds, n);
  return true;
}

/** Tell the breaker how a safety check went. Enough blocks in a row trip it; one pass starts the count again. */
export function recordSafetyCheck(b: Breaker, caps: Caps, blocked: boolean, nowSeconds: number): void {
  if (!blocked) {
    b.safetyBlocks = 0;
    return;
  }
  b.safetyBlocks += 1;
  if (b.safetyBlocks >= caps.safetyBlocksInARow) {
    trip(b, "safety-blocks", b.safetyBlocks, 0, caps.safetyBlocksInARow, nowSeconds);
  }
}

/** The code a person sets as RESUME_AFTER_TRIP to resume from this trip, and only this one. */
export function resumeCode(t: Trip): string {
  return String(t.at);
}

/**
 * The breaker as it was saved, for the first poll after a start.
 * - Nothing saved: a fresh breaker.
 * - Saved but unreadable: tripped. The watcher can't tell what it already sent, so it stays off.
 * - Saved as tripped: still tripped, unless RESUME_AFTER_TRIP holds that trip's code. Then it
 *   starts fresh. A code left in place never resumes a later trip, because each has its own.
 */
export function restoreBreaker(
  saved: unknown,
  resume: string | null,
  nowSeconds: number,
): { breaker: Breaker; note: string | null } {
  if (saved === undefined) return { breaker: freshBreaker(), note: null };
  const parsed = BreakerSchema.safeParse(saved);
  if (!parsed.success) {
    const breaker = freshBreaker();
    trip(breaker, "unreadable-memory", 0, 0, 0, nowSeconds);
    return { breaker, note: "the breaker's memory in the state file can't be read, so it is treated as tripped" };
  }
  const breaker = parsed.data;
  if (breaker.tripped && resume === resumeCode(breaker.tripped)) {
    return { breaker: freshBreaker(), note: `resumed by RESUME_AFTER_TRIP=${resume}; every count starts again from zero` };
  }
  return { breaker, note: null };
}

/** What tripped, with the numbers. Fixed words and numbers only. */
export function tripReason(t: Trip): string {
  switch (t.reason) {
    case "texts-per-hour":
      return `${t.count} texts in the last hour and ${t.wanted} more about to go out; the limit is ${t.limit}`;
    case "texts-per-day":
      return `${t.count} texts in the last 24 hours and ${t.wanted} more about to go out; the limit is ${t.limit}`;
    case "claude-calls-per-hour":
      return `${t.count} Claude calls in the last hour; the limit is ${t.limit}`;
    case "safety-blocks":
      return `the safety check blocked ${t.count} messages in a row; the limit is ${t.limit}`;
    case "unreadable-memory":
      return "its record of what it has sent could not be read";
  }
}

const NEW_YORK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/** When it tripped, in New York time: "Nov 19, 02:13 EST". */
export function tripTime(t: Trip): string {
  return NEW_YORK.format(new Date(t.at * 1000));
}

/**
 * The alert for the operators' private chat. It is built only from fixed words and numbers:
 * never from an MTA alert, an alert id, or anything Claude wrote, because it is sent without
 * the rider safety check. It has no file names or addresses a phone would turn into a link.
 */
export function tripMessage(t: Trip): string {
  return [
    `Bronx Line Watch paused itself on ${tripTime(t)}.`,
    `Why: ${tripReason(t)}.`,
    "It is still running and watching the feed, but it sends nothing to riders and makes no Claude calls until a person resumes it. Alerts that come in meanwhile are never sent.",
    `To resume: first find out what went wrong (the Render logs say). Then in Render, on the service's Environment page, set RESUME_AFTER_TRIP to ${resumeCode(t)} and choose Save and deploy.`,
    "To keep it off even through a new deploy, set PAUSED to true there as well.",
  ].join("\n\n");
}
