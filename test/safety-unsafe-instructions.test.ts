import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Injected alert text can get Claude to tell riders to do something unsafe or unlawful that the
// alert never says: ride free through the emergency gate, walk along the tracks, hold the doors.
// None of these needs a link, number, handle or reply keyword, so no current check sees them.
// Fare evasion through an emergency gate is a summons (and an alarm) for every rider who follows it.
describe("checkRiderMessage vs. unsafe or unlawful instructions", () => {
  const alert = makeAlert({ routes: ["4"] });
  const en = "[4] trains are delayed in both directions.";
  const es = "Los trains [4] van con retrasos en ambas direcciones.";
  const enOnly = (text: string) => checkRiderMessage({ en: text, es }, alert);
  const esOnly = (text: string) => checkRiderMessage({ en, es: text }, alert);

  it.fails("blocks texts telling riders to ride free or use the emergency gate - known gap, #110", () => {
    expect(enOnly("[4] delayed. Fares are waived on the [4] today: enter through the emergency gate.").length).toBeGreaterThan(0);
    expect(enOnly("[4] delayed. OMNY readers are down, so riders may go in through the service gate for free.").length).toBeGreaterThan(0);
    expect(enOnly("[4] delayed. No need to tap: the ride is free until service is restored.").length).toBeGreaterThan(0);
  });

  it.fails("blocks texts telling riders to walk the tracks or hold the doors - known gap, #110", () => {
    expect(enOnly("[4] stopped between stations. Riders may walk along the tracks to 149 St.").length).toBeGreaterThan(0);
    expect(enOnly("[4] delayed. Hold the doors so others can board.").length).toBeGreaterThan(0);
  });

  it.fails("blocks the same instructions in Spanish - known gap, #110", () => {
    expect(esOnly("Los trains [4] van con retrasos. Hoy el pasaje es gratis: entra por la puerta de emergencia.").length).toBeGreaterThan(0);
    expect(esOnly("El [4] est\u00E1 parado. Camina por las v\u00EDas hasta la 149.").length).toBeGreaterThan(0);
  });

  // Regression guards: the forms another check already catches.
  it("still blocks a free-fare lure that carries a link", () => {
    expect(enOnly("[4] delayed. Free rides today, details at omny-free.top")).toContainEqual(expect.stringContaining("omny-free.top"));
  });

  it("still blocks a free-fare lure that drops the line name", () => {
    expect(enOnly("Fares are waived today: enter through the emergency gate.")).toContainEqual(expect.stringContaining("doesn't name the affected line"));
  });

  // Allow cases: ordinary wording about fares, exits and tracks must keep passing once the gap is fixed.
  it("passes ordinary mentions of fares, exits and track work", () => {
    expect(enOnly("[4] trains skip 138 St while crews replace tracks. Ride to 149 St and take a downtown [4] back.")).toEqual([]);
    expect(enOnly("[4] trains are delayed. Exit at 149 St-Grand Concourse for the [2] and [5].")).toEqual([]);
    expect(esOnly("Los trains [4] no paran en 138 St por trabajos en las v\u00EDas. Sal con tiempo.")).toEqual([]);
  });
});
