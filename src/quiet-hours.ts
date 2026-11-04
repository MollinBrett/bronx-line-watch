import type { Alert } from "./mta.js";

/** Quiet hours run from QUIET_START (inclusive) to QUIET_END (exclusive), New York time. */
export const QUIET_START_HOUR = 23; // 11 PM
export const QUIET_END_HOUR = 5; // 5 AM

// Intl knows New York's daylight-saving rules, so we never do the UTC offset math ourselves.
// hourCycle "h23" gives 0-23 (some engines would otherwise say "24" for midnight).
const nyHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  hourCycle: "h23",
});

/** True between 11:00 PM and 4:59 AM in New York, whatever time zone the server runs in. */
export function isQuietHours(date: Date): boolean {
  const hour = Number(nyHour.formatToParts(date).find((p) => p.type === "hour")?.value);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * Should this alert be texted right now? At night we only wake people for suspensions
 * (e.g. "Suspended", "Part Suspended"): those can strand a rider. Telegram is not affected,
 * because a channel post doesn't buzz anyone's phone the way a text does (#19).
 */
export function shouldSendSms(alert: Alert, now: Date): boolean {
  return !isQuietHours(now) || alert.type.includes("Suspended");
}
