import { readFileSync } from "node:fs";
import { parseFeed, type Alert } from "../src/mta.js";

export const sampleAlerts: Alert[] = parseFeed(
  JSON.parse(readFileSync(new URL("./fixtures/mta-alerts-sample.json", import.meta.url), "utf8")),
);

export function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: "test:1",
    routes: ["4"],
    type: "Delays",
    header: "[4] trains are running with delays in both directions.",
    description: "",
    activePeriods: [{ start: 0 }],
    updatedAt: 0,
    ...overrides,
  };
}
