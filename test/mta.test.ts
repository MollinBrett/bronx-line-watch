import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/mta.js";
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

  it("reads stop IDs from informed entities, deduped", () => {
    const [alert] = parseFeed({
      entity: [
        {
          id: "x",
          alert: {
            informed_entity: [
              { route_id: "4", stop_id: "413", direction_id: 0 },
              { route_id: "5", stop_id: "413" },
              { route_id: "4", stop_id: "412" },
              { route_id: "6" },
            ],
          },
        },
      ],
    });
    expect(alert!.stops).toEqual(["413", "412"]);
    expect(alert!.routes).toEqual(["4", "5", "6"]); // routes work as before
  });

  it("gives an alert with no stop IDs an empty stop list", () => {
    const [alert] = parseFeed({ entity: [{ id: "x", alert: { informed_entity: [{ route_id: "6" }] } }] });
    expect(alert!.stops).toEqual([]);
  });

  it("fails loudly if the MTA changes the feed shape", () => {
    expect(() => parseFeed({ entities: [] })).toThrow();
  });
});
