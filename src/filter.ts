import type { Alert } from "./mta.js";

/**
 * Subway lines that serve the Bronx. Note: an alert on one of these lines may only
 * affect stations in Manhattan or Brooklyn - narrowing to Bronx stations is an open issue.
 */
export const BRONX_LINES = new Set(["2", "4", "5", "6", "6X", "B", "D"]);

export function touchesBronxLine(alert: Alert): boolean {
  return alert.routes.some((r) => BRONX_LINES.has(r));
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
  return alerts.filter((a) => touchesBronxLine(a) && isRealtime(a) && isActive(a, nowSeconds));
}
