import { BRONX_STOP_IDS } from "./bronx-stops.js";
import type { Alert } from "./mta.js";

/**
 * Subway lines that serve the Bronx. An alert on one of these lines may still be
 * about stations in Manhattan or Brooklyn only; touchesBronxStop() catches that.
 */
export const BRONX_LINES = new Set(["2", "4", "5", "6", "6X", "B", "D"]);

export function touchesBronxLine(alert: Alert): boolean {
  return alert.routes.some((r) => BRONX_LINES.has(r));
}

/**
 * True if the alert names at least one Bronx station, or names no stations at all.
 * An alert with no stations is about a whole line (e.g. "[6] trains are delayed"),
 * and that reaches Bronx riders too, so it's kept. A [6] delay at Astor Pl names
 * only a Manhattan station, so it's dropped.
 */
export function touchesBronxStop(alert: Alert): boolean {
  const stops = alert.stops ?? [];
  if (stops.length === 0) return true;
  // The feed uses parent stations ("626"); a platform ID ("626N") counts as its station.
  return stops.some((s) => BRONX_STOP_IDS.has(s.replace(/[NS]$/, "")));
}

/**
 * Real-time disruptions are worth a text right away. Planned work ("Planned - ...")
 * is known days ahead and belongs in a digest instead - also an open issue.
 */
export function isRealtime(alert: Alert): boolean {
  return !alert.type.startsWith("Planned");
}

export function isActive(alert: Alert, nowSeconds: number): boolean {
  if (alert.activePeriods.length === 0) return true;
  return alert.activePeriods.some(
    (p) => p.start <= nowSeconds && (p.end === undefined || nowSeconds < p.end),
  );
}

/** The alerts that should trigger a text right now. */
export function textworthy(alerts: Alert[], nowSeconds: number): Alert[] {
  return alerts.filter(
    (a) => touchesBronxLine(a) && touchesBronxStop(a) && isRealtime(a) && isActive(a, nowSeconds),
  );
}
