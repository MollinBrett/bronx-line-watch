import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// The only check that ties a rider text to its alert is "names the affected line". It accepts
// any other line the text names, and a bare "4" (a time, a street) counts as naming the [4].
// A prompt-injected or hallucinated "[2] [5] [6] are suspended too" or "take the [6] instead"
// would reach every [4] subscriber (#84). The MTA writes every line it mentions in brackets,
// alternatives included, so a bracketed line found nowhere in the alert is invented.
const alert = makeAlert({
  routes: ["4"],
  header: "[4] trains are running with delays in both directions.",
  description: "",
});
const es = "Los trenes [4] van con retrasos en ambas direcciones.";
const en = "[4] trains are delayed in both directions. Allow extra time.";

describe("checkRiderMessage vs. lines the alert doesn't name", () => {
  it.fails("blocks lines the alert never mentions - known gap, #84", () => {
    for (const bad of [
      "[4] delayed both ways. [2] [5] [6] [B] [D] are suspended too. Avoid the subway today.",
      "[4] delayed both ways. Take the [6] instead.",
    ]) {
      expect(checkRiderMessage({ en: bad, es }, alert).length).toBeGreaterThan(0);
    }
    const esBad = "Los trenes [4] van con retraso. Tomen el [6] mejor.";
    expect(checkRiderMessage({ en, es: esBad }, alert).length).toBeGreaterThan(0);
  });

  it.fails("requires the line in brackets, not a bare digit or letter - known gap, #84", () => {
    expect(checkRiderMessage({ en: "All Bronx subway service is suspended for 4 hours. Stay home.", es }, alert).length).toBeGreaterThan(0);
    expect(checkRiderMessage({ en, es: "Todo el metro suspendido por 4 horas." }, alert).length).toBeGreaterThan(0);
    const bAlert = makeAlert({ routes: ["B"], header: "[B] trains are delayed." });
    expect(checkRiderMessage({ en: "No subway today. Plan B: take a cab.", es: "Trenes [B] con retraso." }, bAlert).length).toBeGreaterThan(0);
  });

  // Regression guards: caught today, must stay caught.
  it("blocks a text that names no line at all", () => {
    expect(checkRiderMessage({ en: "Subway service is suspended. Stay home.", es }, alert)).toContainEqual(
      expect.stringContaining("en: doesn't name the affected line"),
    );
  });

  // Allow cases: whatever the fix looks like, real rewrites must keep passing.
  it("allows alternatives the alert itself gives, in both languages", () => {
    const withAlts = makeAlert({
      routes: ["4"],
      header: "[4] trains are delayed at 149 St-Grand Concourse.",
      description: "For service, take the [2] or [5] to 149 St-Grand Concourse and transfer to a [4].",
    });
    expect(
      checkRiderMessage(
        {
          en: "[4] delayed at 149 St-Grand Concourse. Take the [2] or [5] there and switch to the [4].",
          es: "El [4] va con retraso en 149 St-Grand Concourse. Tomen el [2] o el [5] y cambien al [4].",
        },
        withAlts,
      ),
    ).toEqual([]);
  });

  it("allows multi-line and lettered routes", () => {
    const bd = makeAlert({ routes: ["B", "D"], header: "[B][D] trains are delayed." });
    expect(checkRiderMessage({ en: "[B] and [D] trains are delayed.", es: "Los trenes [B] y [D] van con retraso." }, bd)).toEqual([]);
    const sixX = makeAlert({ routes: ["6X"], header: "Pelham Bay Park-bound [6X] runs local." });
    expect(checkRiderMessage({ en: "[6X] runs local to Pelham Bay Park.", es: "El [6X] va local hasta Pelham Bay Park." }, sixX)).toEqual([]);
  });

  it("allows numbers in times and stations when the line is in brackets", () => {
    expect(checkRiderMessage({ en: "[4] trains are running about 4 minutes late at 149 St.", es }, alert)).toEqual([]);
  });
});
