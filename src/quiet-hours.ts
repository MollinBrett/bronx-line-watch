import type { Alert } from "./mta.js";
import { wantsAlert, type Subscriber } from "./sms.js";

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
 * Should this alert be texted to this subscriber right now? Quiet hours are opt-in: New Yorkers
 * keep odd hours, and someone waiting on a platform at 2 AM needs the delay text. Only riders
 * who asked for quiet hours are held back at night, and even they still get suspensions
 * (e.g. "Suspended", "Part Suspended"): those can strand a rider. Telegram is not affected (#19).
 */
export function shouldSendSms(alert: Alert, sub: Subscriber, now: Date): boolean {
  return !sub.quiet || !isQuietHours(now) || alert.type.includes("Suspended");
}

/**
 * Text every subscriber who wants this alert, checking quiet hours again before *each* text.
 * Sending is one request at a time, so a loop that starts at 10:59:59 PM can still be running
 * after 11 PM. Checking once up front would let those later texts wake a rider who asked for
 * quiet hours; checking every time holds theirs back the moment quiet hours begin.
 *
 * `send` does the actual texting and must handle its own errors (main.ts logs and moves on),
 * so one failed text never stops the rest. `send` and `now` are passed in so tests can use a
 * fake clock instead of real texts. Returns how many subscribers were held back for quiet hours.
 */
export async function textSubscribers(
  alert: Alert,
  subscribers: Subscriber[],
  send: (sub: Subscriber) => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<{ heldBack: number }> {
  let heldBack = 0;
  for (const sub of subscribers) {
    if (!wantsAlert(sub, alert.routes)) continue; // they only asked for other lines
    if (shouldSendSms(alert, sub, now())) await send(sub);
    else heldBack++;
  }
  return { heldBack };
}
