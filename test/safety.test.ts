import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

const alert = makeAlert({ routes: ["4"] });
const good = {
  en: "[4] trains are delayed both ways after police activity at 149 St. Allow extra time.",
  es: "Los trenes [4] van con retrasos en ambas direcciones por actividad policial en 149 St.",
};

describe("checkRiderMessage", () => {
  it("passes a normal message", () => {
    expect(checkRiderMessage(good, alert)).toEqual([]);
  });

  it("ignores station abbreviations that look like domains", () => {
    expect(checkRiderMessage({ ...good, en: "[4] skips Mt Eden Av. and 170 St. today." }, alert)).toEqual([]);
  });

  it("blocks links to anywhere but the MTA", () => {
    const evil = { ...good, en: "[4] delayed. Free MetroCards at free-metrocard.xyz/claim" };
    expect(checkRiderMessage(evil, alert)).toContainEqual(expect.stringContaining("free-metrocard.xyz"));
    const mta = { ...good, en: "[4] delayed. Details: https://new.mta.info/alerts" };
    expect(checkRiderMessage(mta, alert)).toEqual([]);
  });

  it("blocks messages that are too long or empty", () => {
    expect(checkRiderMessage({ ...good, en: "[4] " + "x".repeat(400) }, alert).length).toBeGreaterThan(0);
    expect(checkRiderMessage({ ...good, es: "  " }, alert).length).toBeGreaterThan(0);
  });

  it("blocks messages that don't name the affected line", () => {
    expect(checkRiderMessage({ ...good, en: "Trains are delayed." }, alert)).toContainEqual(
      expect.stringContaining("line"),
    );
  });

  it("doesn't confuse [4] with [45] or 14 St", () => {
    expect(checkRiderMessage({ ...good, en: "Service at 14 St is normal." }, alert).length).toBeGreaterThan(0);
  });
});

// Links a prompt-injected MTA alert might try to sneak into a rider text.
describe("checkRiderMessage vs. injected links", () => {
  const blocked = (en: string) => checkRiderMessage({ ...good, en }, alert);

  it("blocks userinfo tricks that start with an allowed host", () => {
    expect(blocked("[4] delayed. https://new.mta.info@evil.com/claim")).toContainEqual(
      expect.stringContaining("evil.com"),
    );
  });

  it("blocks lookalike hosts that only start with mta.info", () => {
    expect(blocked("[4] delayed. Info: mta.info.evil.com")).toContainEqual(
      expect.stringContaining("mta.info.evil.com"),
    );
  });

  it("blocks links in upper case", () => {
    expect(blocked("[4] delayed. FREE-METROCARD.XYZ")).toContainEqual(expect.stringContaining("free-metrocard.xyz"));
  });

  it("blocks a scheme link on any TLD", () => {
    expect(blocked("[4] delayed. https://mta-refund.top")).toContainEqual(expect.stringContaining("mta-refund.top"));
  });

  it("blocks links in the Spanish text too", () => {
    const evil = { ...good, es: "Los trenes [4] van con retrasos. Reembolsos en https://mta-refund.top/es" };
    expect(checkRiderMessage(evil, alert)).toContainEqual(expect.stringContaining("es: link to mta-refund.top"));
  });

  // Known gaps. `it.fails` keeps CI green while the gap exists and turns red once it is fixed:
  // when that happens, change these to plain `it`.
  it("blocks bare links on uncommon TLDs (#22)", () => {
    for (const en of [
      "[4] delayed. Claim your fare refund at mta-refund.top",
      "[4] delayed. Refunds: www.mta-refund.top",
      "[4] delayed. Details at mta-alerts.nyc",
    ]) {
      expect(blocked(en).length).toBeGreaterThan(0);
    }
  });

  it("doesn't mistake ordinary abbreviations for links", () => {
    for (const en of [
      "[4] skips Mt Eden Av. and 170 St. until 5 a.m. Monday.",
      "[4] runs local, e.g. at 149 St-Grand Concourse, until Jan. 5.",
      "[4] trains are delayed...Take the [2] or [5] instead.",
      "[4] service resumes at 6 p.m./7 p.m. on weekends.",
    ]) {
      expect(blocked(en)).toEqual([]);
    }
  });

  it.fails("blocks callback phone numbers - known gap, #23", () => {
    expect(blocked("[4] delayed. Call 718-555-0123 now for an OMNY fare refund.").length).toBeGreaterThan(0);
  });

  it.fails("blocks requests to reply with card details - known gap, #23", () => {
    expect(blocked("[4] delayed. Reply YES with your OMNY card number to get a refund.").length).toBeGreaterThan(0);
  });
});
