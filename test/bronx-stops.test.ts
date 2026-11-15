import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRONX_STATIONS, BRONX_STOP_IDS } from "../src/bronx-stops.js";

// The MTA file has no quoted commas in the columns read here, and a row that did would
// fail the comparison below rather than slip through.
const [header, ...rows] = readFileSync(new URL("../data/gtfs/mta-subway-stations.csv", import.meta.url), "utf8")
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split(","));
const col = (name: string) => header!.indexOf(name);

describe("Bronx stop list (#14, #49)", () => {
  it("matches the MTA station file row for row, so nobody edits it by hand", () => {
    const fromCsv = rows
      .filter((r) => r[col("Borough")] === "Bx")
      .map((r) => ({
        stopId: r[col("GTFS Stop ID")],
        complexId: r[col("Complex ID")],
        name: r[col("Stop Name")],
        routes: r[col("Daytime Routes")]!.split(" "),
      }))
      .sort((a, b) => a.stopId!.localeCompare(b.stopId!));
    expect(fromCsv.length).toBeGreaterThan(60);
    expect(BRONX_STATIONS).toEqual(fromCsv);
  });

  it("holds parent station IDs only, and no station from another borough", () => {
    for (const id of BRONX_STOP_IDS) expect(id).toMatch(/^[A-Z0-9]{3}$/);
    expect(BRONX_STOP_IDS.has("401")).toBe(true); // Woodlawn
    expect(BRONX_STOP_IDS.has("D05")).toBe(true); // Fordham Rd (B D)
    expect(BRONX_STOP_IDS.has("626")).toBe(false); // 86 St, Manhattan
    expect(BRONX_STOP_IDS.has("B23")).toBe(false); // Brooklyn
  });
});
