import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Injected alert text can get Claude to add profanity, demeaning remarks, drug or alcohol
// promotion, or a political or commercial pitch to an otherwise real service change. None of
// these needs a link, number, handle or reply keyword, so no current check sees them. Carriers
// filter and can suspend an A2P sender over this content (CTIA's "SHAFT" rules: sex, hate,
// alcohol, firearms, tobacco/cannabis), so one bad text can stop every later alert, and
// docs/privacy.html promises riders "We never send advertising".
describe("checkRiderMessage vs. profane, hateful, drug/alcohol or promotional content", () => {
  const alert = makeAlert({ routes: ["4"] });
  const en = "[4] trains are delayed in both directions.";
  const es = "Los trains [4] van con retrasos en ambas direcciones.";
  const enOnly = (text: string) => checkRiderMessage({ en: text, es }, alert);
  const esOnly = (text: string) => checkRiderMessage({ en, es: text }, alert);

  it.fails("blocks profanity added to a real delay - known gap, #119", () => {
    expect(enOnly("[4] trains are delayed again. Screw the MTA, this sh*t never works.").length).toBeGreaterThan(0);
  });

  it.fails("blocks remarks that demean a group of riders - known gap, #119", () => {
    expect(enOnly("[4] delayed by a sick passenger. Thank the junkies who live on this train.").length).toBeGreaterThan(0);
  });

  it.fails("blocks cannabis or alcohol promotion - known gap, #119", () => {
    expect(enOnly("[4] delayed. Waiting a while? Cheap weed and cold beer at the deli by 149 St.").length).toBeGreaterThan(0);
  });

  it.fails("blocks a political or commercial pitch - known gap, #119", () => {
    expect(enOnly("[4] delayed. Tired of this? Vote NO on Prop 2 on Tuesday.").length).toBeGreaterThan(0);
  });

  it.fails("blocks the same in Spanish - known gap, #119", () => {
    expect(esOnly("Los trains [4] van con retrasos. La MTA es una mierda. Sal con tiempo.").length).toBeGreaterThan(0);
  });

  // Regression guards: the forms another check already catches.
  it("still blocks a promotion that carries a link", () => {
    expect(enOnly("[4] delayed. 20% off at bronx-deals.shop while you wait")).toContainEqual(expect.stringContaining("bronx-deals.shop"));
  });

  it("still blocks a promotion that drops the line name", () => {
    expect(enOnly("Trains are slow today. Vote NO on Prop 2 on Tuesday.")).toContainEqual(expect.stringContaining("doesn't name the affected line"));
  });

  // Allow cases: real Bronx station names and ordinary police or medical wording must keep
  // passing once the gap is fixed. A naive word list would block "Gun Hill Rd" or "Hunts Point".
  it("passes real station names and ordinary incident wording", () => {
    const lines25 = makeAlert({ routes: ["2", "5"] });
    expect(checkRiderMessage({
      en: "[2] and [5] trains skip Gun Hill Rd while police respond to an incident. Allow extra time.",
      es: "Los trains [2] y [5] no paran en Gun Hill Rd por actividad policial. Sal con tiempo.",
    }, lines25)).toEqual([]);
    const line6 = makeAlert({ routes: ["6"] });
    expect(checkRiderMessage({
      en: "[6] trains are delayed near Hunts Point Av after a sick passenger needed help.",
      es: "Los trains [6] van con retrasos cerca de Hunts Point Av por un pasajero enfermo.",
    }, line6)).toEqual([]);
  });
});
