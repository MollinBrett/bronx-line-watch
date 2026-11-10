import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// A link to the allowed MTA host that carries more than a plain path: a query, a fragment, or a
// %-encoded or base64 target. If any MTA page redirects on a parameter, that's a full bypass (#80).
const alert = makeAlert({ routes: ["4"] });
const good = {
  en: "[4] trains are delayed both ways after police activity at 149 St. Allow extra time.",
  es: "Los trenes [4] van con retrasos en ambas direcciones por actividad policial en 149 St.",
};
const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

describe("checkRiderMessage vs. extra baggage on an allowed MTA link", () => {
  // Regression guards: caught today, must stay caught.
  it("blocks an attacker link that only mentions the MTA host in its query or fragment", () => {
    expect(blocked("[4] delayed. https://mta-refund.top/?u=new.mta.info")).toContainEqual(expect.stringContaining("mta-refund.top"));
    expect(blocked("[4] delayed. https://mta-refund.top#new.mta.info")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks the MTA host used as a subdomain prefix", () => {
    expect(blocked("[4] delayed. https://new.mta.info.mta-refund.top/alerts")).toContainEqual(
      expect.stringContaining("new.mta.info.mta-refund.top"),
    );
  });

  it("blocks a second link after a real MTA link, or after a bare query", () => {
    expect(blocked("[4] delayed. https://new.mta.info/alerts and https://mta-refund.top")).toContainEqual(
      expect.stringContaining("mta-refund.top"),
    );
    expect(blocked("[4] delayed. Details: new.mta.info?u=mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  // Allow cases: whatever the fix for #80 looks like, plain MTA links must keep passing.
  it("still passes plain MTA links", () => {
    for (const en of [
      "[4] delayed. Details: https://new.mta.info/alerts",
      "[4] delayed. Details: new.mta.info/planned-service-changes",
      "[4] delayed. Details at mta.info.",
    ]) {
      expect(blocked(en)).toEqual([]);
    }
  });

  // Known gap. `it.fails` keeps CI green while the gap exists and turns red once it's fixed:
  // when that happens, change this to plain `it`.
  it.fails("blocks an MTA link carrying a query, fragment or encoded target - known gap, #80", () => {
    for (const en of [
      "[4] delayed. Details: https://new.mta.info/r?u=https%3A%2F%2Fmta-refund%252Etop",
      "[4] delayed. Details: https://new.mta.info/r?u=aHR0cHM6Ly9tdGEtcmVmdW5kLnRvcA",
      "[4] delayed. Details: mta.info/out?to=mta-refund%2Etop",
      "[4] delayed. Details: new.mta.info/#/r/mta-refund%2Etop",
      "[4] delayed. Details: https://new.mta.info/go/mta-refund%252Etop",
    ]) {
      expect(blocked(en).length).toBeGreaterThan(0);
    }
  });
});
