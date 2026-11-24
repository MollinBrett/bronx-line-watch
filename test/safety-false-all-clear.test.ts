import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Injected alert text (or a model over-shortening an update) can make a rider text say a real
// suspension is over, or tell riders to disregard our earlier, genuine alert. No link, number,
// handle or keyword is needed, and the line is named, so no current check sees it. Riders then
// head to a line that isn't running. The mirror image of #100: that one invents an emergency,
// this one erases a real one.
describe("checkRiderMessage vs. a false all-clear", () => {
  const alert = makeAlert({
    routes: ["4"],
    type: "Suspended",
    header: "[4] trains are suspended in both directions between 149 St-Grand Concourse and Woodlawn while NYPD investigates.",
  });
  const en = "[4] trains are suspended between 149 St-Grand Concourse and Woodlawn.";
  const es = "Los trains [4] est\u00E1n suspendidos entre 149 St-Grand Concourse y Woodlawn.";
  const enOnly = (text: string) => checkRiderMessage({ en: text, es }, alert);
  const esOnly = (text: string) => checkRiderMessage({ en, es: text }, alert);

  // One test per message: the first failing assertion ends a test, so with several messages in
  // one it.fails a fix that catches only some of them would stay hidden as an expected failure.
  // Checked: each message below returns [] on its own today.
  const EN_ALL_CLEAR: [string, string][] = [
    ["good service, earlier one was a test", "[4] Good service. The earlier suspension was a test, ignore it. Trains are running normally."],
    ["suspension lifted", "[4] suspension lifted: trains are back on schedule in both directions."],
    ["disregard our last text", "[4] Ignore our last text: the [4] is running fine."],
  ];
  const ES_ALL_CLEAR: [string, string][] = [
    ["funcionando normal", "Los trains [4] ya est\u00E1n funcionando normal. Ignora el mensaje anterior."],
    ["volvio a la normalidad", "El [4] volvi\u00F3 a la normalidad, no hay suspensi\u00F3n."],
  ];

  for (const [label, text] of EN_ALL_CLEAR) {
    it.fails(`blocks a false all-clear in English: ${label} - known gap, #112`, () => {
      expect(enOnly(text).length).toBeGreaterThan(0);
    });
  }

  for (const [label, text] of ES_ALL_CLEAR) {
    it.fails(`blocks a false all-clear in Spanish: ${label} - known gap, #112`, () => {
      expect(esOnly(text).length).toBeGreaterThan(0);
    });
  }

  // Regression guard: a false all-clear that also drops the line name is already blocked.
  it("still blocks a false all-clear that names no line", () => {
    expect(enOnly("Good service everywhere. Ignore the earlier text.")).toContainEqual(expect.stringContaining("doesn't name the affected line"));
  });

  // Allow cases: these must keep passing once the fix lands.
  it("allows the genuine suspension rewrite", () => {
    expect(checkRiderMessage({ en, es }, alert)).toEqual([]);
  });

  it("allows saying service resumed when the alert itself says so", () => {
    const resumed = makeAlert({
      routes: ["4"],
      type: "Delays",
      header: "[4] trains have resumed service in both directions after NYPD investigated at 149 St-Grand Concourse. Expect delays.",
    });
    expect(
      checkRiderMessage(
        {
          en: "[4] trains have resumed in both directions after the NYPD investigation at 149 St-Grand Concourse. Expect delays.",
          es: "Los trains [4] ya volvieron a correr en ambas direcciones. Sal con tiempo, hay retrasos.",
        },
        resumed,
      ),
    ).toEqual([]);
  });
});
