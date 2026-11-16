import { describe, expect, it } from "vitest";
import { BRONX_STOP_IDS } from "../src/bronx-stops.js";
import { isActive, isRealtime, textworthy, touchesBronxLine, touchesBronxStop } from "../src/filter.js";
import { makeAlert, sampleAlerts } from "./helpers.js";

const fixture = (id: string) => {
  const alert = sampleAlerts.find((a) => a.id === id);
  if (!alert) throw new Error(`${id} is not in the fixture`);
  return alert;
};

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

  it("drops an alert whose stations are all outside the Bronx (real snapshot)", () => {
    // [4][5][6] downtown trains skip 86 St, in Manhattan (stop 626).
    expect(touchesBronxStop(fixture("lmm:planned_work:36012"))).toBe(false);
    // [D] reroute that names only Brooklyn stations (B12-B23).
    expect(touchesBronxStop(fixture("lmm:planned_work:35567"))).toBe(false);
  });

  it("keeps an alert that names a Bronx station (real snapshot)", () => {
    // [4] skips 170 St, Mt Eden Av and 176 St; it names stops 409-413 (Burnside Av to 167 St).
    expect(touchesBronxStop(fixture("lmm:planned_work:36103"))).toBe(true);
    // [5] suspension naming Bronx stops (E 180 St to 149 St-Hostos) and Manhattan ones.
    // Any Bronx stop is enough.
    expect(touchesBronxStop(fixture("lmm:planned_work:35982"))).toBe(true);
  });

  it("keeps a line-wide alert that names no stations (real snapshot)", () => {
    // "[6] trains are running with delays in both directions..." lists no stop_id.
    expect(fixture("lmm:alert:274447:26").stops).toEqual([]);
    expect(touchesBronxStop(fixture("lmm:alert:274447:26"))).toBe(true);
    expect(touchesBronxStop(makeAlert({ stops: undefined }))).toBe(true);
  });

  it("counts a platform ID (626N, 615S) as its station", () => {
    expect(touchesBronxStop(makeAlert({ stops: ["615S"] }))).toBe(true); // E 149 St, Bronx
    expect(touchesBronxStop(makeAlert({ stops: ["626N"] }))).toBe(false); // 86 St, Manhattan
  });

  it("textworthy() drops a real-time alert about Manhattan stations only", () => {
    const astorPl = makeAlert({ routes: ["6"], stops: ["636"] }); // Astor Pl
    const e149 = makeAlert({ routes: ["6"], stops: ["615"] }); // E 149 St
    const lineWide = makeAlert({ routes: ["6"], stops: [] });
    expect(textworthy([astorPl, e149, lineWide], 1)).toEqual([e149, lineWide]);
  });

  it("has the 70 Bronx stations from the MTA list, and none outside it", () => {
    expect(BRONX_STOP_IDS.size).toBe(70);
    // Spot checks against the MTA "Subway Stations" dataset (Borough = Bx).
    for (const id of ["101", "201", "222", "416", "501", "601", "615", "619", "D01", "D11"]) {
      expect(BRONX_STOP_IDS.has(id), id).toBe(true);
    }
    // Marble Hill-225 St (106) is in Manhattan; 125 St (621), 86 St (626) and Astor Pl (636) too.
    for (const id of ["106", "621", "626", "636", "B12"]) expect(BRONX_STOP_IDS.has(id), id).toBe(false);
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
