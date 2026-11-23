import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// A rider text that reports an emergency the alert never mentions (a bomb, a shooting, an
// evacuation, a fire) is a false alarm sent to every rider on the line, whether injected through
// the alert text or hallucinated from a vague "police activity" alert. It needs no link, number or
// reply keyword, so none of the other checks see it. An alarm word in the text, in either language,
// must have its English counterpart in the alert's type, header or description.
describe("checkRiderMessage vs. emergencies the alert doesn't mention", () => {
  // Header: "[4] trains are running with delays in both directions."
  const alert = makeAlert({ routes: ["4"] });
  const en = "[4] trains are delayed in both directions.";
  const es = "Los trains [4] van con retrasos en ambas direcciones.";
  const enOnly = (text: string) => checkRiderMessage({ en: text, es }, alert);
  const esOnly = (text: string) => checkRiderMessage({ en, es: text }, alert);

  // One test per message: the first failing assertion ends a test, so with several messages in
  // one it.fails a fix that catches only some of them would stay hidden as an expected failure.
  // Checked: each message below returns [] on its own today.
  const EN_INVENTED: [string, string][] = [
    ["bomb", "[4] trains suspended: police report a bomb at 149 St-Grand Concourse. Evacuate the area now."],
    ["shots fired", "[4] delayed. Shots fired near 161 St-Yankee Stadium. Stay indoors until police give the all clear."],
    ["smoke in the tunnel", "[4] delayed. Smoke in the tunnel. Do not enter any Bronx station."],
  ];
  const ES_INVENTED: [string, string][] = [
    ["tiroteo", "[4] con retrasos. Hay un tiroteo en la 149. Qu\u00E9date en casa."],
    ["amenaza de bomba", "Los trains [4] est\u00E1n suspendidos por amenaza de bomba. Desalojen las estaciones del Bronx."],
  ];

  for (const [label, text] of EN_INVENTED) {
    it.fails(`blocks an invented emergency in English: ${label} - known gap, #100`, () => {
      expect(enOnly(text).length).toBeGreaterThan(0);
    });
  }

  for (const [label, text] of ES_INVENTED) {
    it.fails(`blocks an invented emergency in Spanish: ${label} - known gap, #100`, () => {
      expect(esOnly(text).length).toBeGreaterThan(0);
    });
  }

  // Regression guard: an invented emergency that also drops the line name is already blocked.
  it("still blocks an invented emergency that names no line", () => {
    expect(enOnly("Bomb threat in the Bronx subway. Evacuate all stations now.")).toContainEqual(
      expect.stringContaining("doesn't name the affected line"),
    );
  });

  // Allow cases: these must keep passing once the gap is fixed.
  it("allows an emergency that the alert itself reports, in both languages", () => {
    const fire = makeAlert({
      routes: ["4"],
      header: "[4] trains are running with delays while FDNY responds to a fire near 149 St-Grand Concourse.",
    });
    expect(
      checkRiderMessage(
        {
          en: "[4] delayed both ways: FDNY is handling a fire near 149 St-Grand Concourse. Allow extra time.",
          es: "Los trains [4] van con retrasos: los bomberos atienden un incendio cerca de 149 St-Grand Concourse. Sal con tiempo.",
        },
        fire,
      ),
    ).toEqual([]);
  });

  it("allows Gun Hill Rd, bomberos, and ordinary police-activity wording", () => {
    // Gun Hill Rd is a real Bronx station on the [2] and [5]: "gun" alone is not an alarm.
    const gunHill = makeAlert({ routes: ["5"], header: "[5] trains are skipping Gun Hill Rd in both directions." });
    expect(
      checkRiderMessage(
        { en: "[5] trains skip Gun Hill Rd both ways. Ride to Pelham Pkwy and take a [5] back.", es: "Los trains [5] no paran en Gun Hill Rd." },
        gunHill,
      ),
    ).toEqual([]);
    // "bomberos" is firefighters, not a bomb.
    expect(esOnly("Los trains [4] van con retrasos mientras los bomberos revisan la v\u00EDa.")).toEqual([]);
    const nypd = makeAlert({
      routes: ["6"],
      header: "[6] trains are running with delays in both directions after NYPD responded to an unauthorized person on the track at E 149 St.",
    });
    expect(
      checkRiderMessage(
        {
          en: "[6] delayed both ways after NYPD responded to a person on the tracks at E 149 St. Allow extra time.",
          es: "Los trains [6] van con retrasos porque la polic\u00EDa respondi\u00F3 a una persona en las v\u00EDas en E 149 St. Sal con tiempo.",
        },
        nypd,
      ),
    ).toEqual([]);
  });
});
