import { describe, expect, it } from "vitest";
import { isActive, isRealtime, textworthy, touchesBronxLine } from "../src/filter.js";
import { makeAlert, sampleAlerts } from "./helpers.js";

describe("filters", () => {
  it("keeps Bronx lines and drops others", () => {
    expect(touchesBronxLine(makeAlert({ routes: ["D"] }))).toBe(true);
    expect(touchesBronxLine(makeAlert({ routes: ["L"] }))).toBe(false);
  });

  it("treats planned work as not real-time", () => {
    expect(isRealtime(makeAlert({ type: "Planned - Stops Skipped" }))).toBe(false);
    expect(isRealtime(makeAlert({ type: "Delays" }))).toBe(true);
  });

  it("respects active periods", () => {
    const a = makeAlert({ activePeriods: [{ start: 100, end: 200 }] });
    expect(isActive(a, 99)).toBe(false);
    expect(isActive(a, 150)).toBe(true);
    expect(isActive(a, 200)).toBe(false);
    expect(isActive(makeAlert({ activePeriods: [] }), 5)).toBe(true);
  });

  it("finds only real-time Bronx-line alerts in the real snapshot", () => {
    const now = 1793539447; // the snapshot's own timestamp
    const picked = textworthy(sampleAlerts, now);
    expect(picked.length).toBeGreaterThan(0);
    for (const a of picked) {
      expect(touchesBronxLine(a)).toBe(true);
      expect(a.type.startsWith("Planned")).toBe(false);
    }
  });
});
