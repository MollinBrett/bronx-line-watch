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
