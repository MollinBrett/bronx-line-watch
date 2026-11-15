import { describe, expect, it } from "vitest";
import { checkRiderMessage } from "../src/safety.js";
import { makeAlert } from "./helpers.js";

// Twilio treats replies of STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE or OPTOUT as an
// opt-out and removes the number (docs/privacy.html, docs/terms.html). Injected alert text that gets
// Claude to tell riders to "reply STOP" unsubscribes everyone who follows it, with no link or phone
// number for the other checks to catch. Rider texts never need to ask for a reply.
describe("checkRiderMessage vs. reply-keyword instructions", () => {
  const alert = makeAlert({ routes: ["4"] });
  const es = "Los trenes [4] van con retrasos en ambas direcciones.";
  const enOnly = (en: string) => checkRiderMessage({ en, es }, alert);
  const esOnly = (esText: string) =>
    checkRiderMessage({ en: "[4] trains are delayed in both directions.", es: esText }, alert);

  it.fails("blocks texts telling riders to reply an opt-out keyword - known gap, #88", () => {
    expect(enOnly("[4] delayed both ways. Reply STOP to confirm you still want [4] alerts.").length).toBeGreaterThan(0);
    expect(enOnly("[4] delayed. Alerts are moving to a new number: text QUIT to switch.").length).toBeGreaterThan(0);
    expect(enOnly("[4] delayed. Send UNSUBSCRIBE now to get delay credits.").length).toBeGreaterThan(0);
    expect(esOnly("[4] con retrasos. Responde STOP para seguir recibiendo alertas.").length).toBeGreaterThan(0);
    expect(esOnly("[4] con retrasos. Env\u00EDa CANCEL para confirmar.").length).toBeGreaterThan(0);
  });

  it.fails("blocks texts telling riders to reply any keyword - known gap, #88", () => {
    // Not opt-outs, but a rider text never needs a reply, and replies reach our Twilio number (#23).
    expect(enOnly("[4] delayed. Reply YES for updates.").length).toBeGreaterThan(0);
    expect(esOnly("[4] con retrasos. Escribe ESPANOL al 511.").length).toBeGreaterThan(0);
  });

  // Regression guards: the reply-instruction forms that already fail another check.
  it("still blocks a reply instruction that carries a link", () => {
    expect(enOnly("[4] delayed. Reply STOP or visit mta-optout.top")).toContainEqual(expect.stringContaining("mta-optout.top"));
  });

  it("still blocks a reply instruction that drops the line name", () => {
    expect(enOnly("Reply STOP to keep getting alerts.")).toContainEqual(expect.stringContaining("doesn't name the affected line"));
  });

  // Allow cases: "stop" as an ordinary word must keep passing once the gap is fixed.
  it("passes ordinary uses of stop, end and cancel", () => {
    expect(enOnly("[4] trains skip the 138 St stop. Ride to 149 St and take a downtown [4] back.")).toEqual([]);
    expect(enOnly("[4] trains end at 149 St-Grand Concourse. Northbound service is canceled.")).toEqual([]);
    expect(esOnly("Los trenes [4] no paran en 138 St. Bajen en 149 St-Grand Concourse.")).toEqual([]);
  });
});
