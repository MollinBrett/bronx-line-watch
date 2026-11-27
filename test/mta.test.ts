import { describe, expect, it } from "vitest";
import { parentStopId, parseFeed } from "../src/mta.js";
import { sampleAlerts } from "./helpers.js";

describe("parseFeed", () => {
  it("parses a real MTA feed snapshot", () => {
    expect(sampleAlerts.length).toBe(15);
    for (const a of sampleAlerts) {
      expect(a.id).toBeTruthy();
      expect(a.header).toBeTruthy();
      expect(a.type).not.toBe("Unknown");
    }
  });

  it("uses plain English text, not the HTML variant", () => {
    for (const a of sampleAlerts) expect(a.header).not.toMatch(/<p>|<strong>/);
  });

  it("dedupes routes", () => {
    const [alert] = parseFeed({
      entity: [
        {
          id: "x",
          alert: { informed_entity: [{ route_id: "4" }, { route_id: "4" }, { route_id: "5" }] },
        },
      ],
    });
    expect(alert!.routes).toEqual(["4", "5"]);
  });

  it("reads stop IDs and normalizes platforms to the parent station (#49)", () => {
    const [alert] = parseFeed({
      entity: [
        {
          id: "x",
          alert: {
            informed_entity: [
              { route_id: "4", stop_id: "401N" },
              { route_id: "4", stop_id: "401S" },
              { route_id: "D", stop_id: "D05" },
              { route_id: "4" },
            ],
          },
        },
      ],
    });
    expect(alert!.stops).toEqual(["401", "D05"]);
    expect(parentStopId("d05n")).toBe("D05");
    expect(parentStopId("S18")).toBe("S18"); // a station ID that happens to start with S
  });

  it("gives line-wide alerts an empty stop list", () => {
    const [alert] = parseFeed({ entity: [{ id: "x", alert: { informed_entity: [{ route_id: "6" }] } }] });
    expect(alert!.stops).toEqual([]);
  });

  it("drops an entry whose id is not shaped like an alert id, and keeps the rest (#96)", () => {
    const entity = ["__proto__", "", "a b", "lmm:alert:1", "lmm:planned_work:2"].map((id) => ({ id, alert: {} }));
    expect(parseFeed({ entity }).map((a) => a.id)).toEqual(["lmm:alert:1", "lmm:planned_work:2"]);
  });

  it("fails loudly if the MTA changes the feed shape", () => {
    expect(() => parseFeed({ entities: [] })).toThrow();
  });
});
